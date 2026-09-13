/**
 * @file ExploracaoCombate.js
 * @description Cena de exploração e combate (Client 100% Subordinado ao Server Node.js)
 */

import { SERVER_URL, sendMessage } from './networkConfig.js';

// Loot & Inimigos, Passo 1d (Elite roxo adicionado no Passo 2c) — DEBUG VISUAL, não arte final:
// cor sólida por tipo (mobs.nome_inimigo) só pra identificar em teste. Some quando o sprite Godot
// chegar. Fallback cobre qualquer nome fora do mapa (tipo novo no banco que ainda não foi mapeado
// aqui).
const ENEMY_COLOR_BY_NOME = {
    'Comum': 0x888888, // cinza
    'Fraco': 0x00cc44, // verde
    'Medio': 0xffaa00, // amarelo/laranja
    'Forte': 0xff0000, // vermelho
    'Elite': 0x9900ff, // roxo — raro (peso_spawn baixo, Passo 2a), mais durão e mais XP
    'Boss':  0xff2200  // vermelho vivo / fogo contrastante com borda — P3 Sub-passo C1
};
const ENEMY_COLOR_FALLBACK = 0xffffff;
const PORTAL_BOSS_ENTRY = { x: 300, y: 1000 };
const PORTAL_BOSS_RADIUS = 240;
const PORTAL_BOSS_MIN_LEVEL = 3;

export class ExploracaoCombate extends Phaser.Scene {

    constructor() {
        super('ExploracaoCombate');
    }

    create() {
        // Causa A (teste de campo Fase 2): playerStats/myId NÃO eram resetados aqui, então
        // sobreviviam zumbis a um scene.restart() — o guard `if (!this.playerStats) return`
        // do update() parava de proteger porque o objeto antigo continuava truthy.
        this.playerStats = null;
        this.myId = null;
        this.physics.world.setBounds(0, 0, 2000, 2000);
        this.cameras.main.setBounds(0, 0, 2000, 2000);
        this.cameras.main.setBackgroundColor('#0b1d3a');

        this.add.text(10, 10, 'SISTEMA ONLINE - ESC para voltar', { color: '#00ff00' }).setScrollFactor(0);
        // S4 (Round 2): indicador transitório de subida de nível — texto simples, some sozinho.
        this.levelUpText = this.add.text(10, 30, '', { color: '#00ffff', fontSize: '18px' }).setScrollFactor(0);
        this.player = this.add.rectangle(1000, 1000, 40, 40, 0x00ffff);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);
        this.player.invulnerable = false;
        this.player.setVisible(false);
        this.playerVisual = this.add.rectangle(this.player.x, this.player.y, 40, 40, 0x00ffff);
        this.portalState = { active: false, progress: 0, occupants: 0, required_level: PORTAL_BOSS_MIN_LEVEL };
        this.portalVisual = this.add.rectangle(PORTAL_BOSS_ENTRY.x, PORTAL_BOSS_ENTRY.y, PORTAL_BOSS_RADIUS * 2, PORTAL_BOSS_RADIUS * 2, 0x00ff66, 0.12)
            .setStrokeStyle(3, 0x00ff66);
        this.portalLabel = this.add.text(PORTAL_BOSS_ENTRY.x, PORTAL_BOSS_ENTRY.y - PORTAL_BOSS_RADIUS - 20, 'PORTAL', {
            color: '#00ff66',
            fontSize: '18px',
            backgroundColor: '#00000080',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5);
        this.portalProgressText = this.add.text(PORTAL_BOSS_ENTRY.x, PORTAL_BOSS_ENTRY.y - PORTAL_BOSS_RADIUS - 42, `NÍVEL ${PORTAL_BOSS_MIN_LEVEL}+`, {
            color: '#ffffff',
            fontSize: '14px',
            backgroundColor: '#00000080',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5);
        // Imunidade de respawn (Round 2, correção do congelamento de movimento): flag própria,
        // separada de `invulnerable` (knockback). NÃO gateia movimento nem o collider de ataque —
        // só a proteção contra dano é autoritária no servidor. Gancho reservado para feedback
        // visual futuro (blink/tint); nenhum efeito implementado ainda.
        this.player.respawnShield = false;

        this.playerHpGraphics = this.add.graphics();
        // Registrado após o POST_UPDATE da física: a barra acompanha a posição final do sprite.
        this.events.on('postupdate', this.renderPlayerHp, this);
        // S5 (Round 2): lerp fracionário + roundPixels produzia tremida vertical (câmera
        // perseguindo por uma faixa grande, arredondando scroll fracionário a cada frame).
        // Segue direto (lerp=1, default) e mantém roundPixels — nitidez pronta para quando a
        // arte real (Godot) chegar; suavização fica pra decidir com o sprite real em mãos.
        this.cameras.main.startFollow(this.playerVisual, false);

        // Throttle de player_move: update() acompanha o render, rede limitada a ~20Hz.
        this.moveSendAccumulator = 0;
        this.MOVE_SEND_INTERVAL_MS = 50;
        this.movePayload = { type: 'player_move', x: 0, y: 0, vx: 0, vy: 0 };

        // ─────────────────────────────────────────────────────────────────
        // SETUP MULTIPLAYER (DADOS LOCAIS ESPELHANDO O SERVIDOR)
        // ─────────────────────────────────────────────────────────────────
        this.otherPlayers = new Map();
        this.enemyData = new Map();
        this.itensData = new Map();

        this.enemiesGroup = this.physics.add.group();
        this.itensNoChaoGroup = this.physics.add.group();

        // Colisões de Interação (Eventos enviados para o Servidor)
        this.physics.add.collider(this.player, this.enemiesGroup, (p, enemySprite) => {
            if (!this.player.invulnerable && this.socket && this.socket.readyState === WebSocket.OPEN) {
                sendMessage(this.socket, { type: 'attack_enemy', enemyId: enemySprite.serverId });

                // Cooldown local para não flodar a rede
                this.player.invulnerable = true;
                this.time.delayedCall(500, () => this.player.invulnerable = false);
                
                // Knockback Visual
                const angle = Phaser.Math.Angle.Between(enemySprite.x, enemySprite.y, p.x, p.y);
                p.body.setVelocity(Math.cos(angle) * 500, Math.sin(angle) * 500);
            }
        });

        // Coleta de itens (Passo 5c) — usamos overlap em vez de collider para o jogador não tropeçar no item
        this.physics.add.overlap(this.player, this.itensNoChaoGroup, (p, itemSprite) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN && !itemSprite.isBeingCollected) {
                itemSprite.isBeingCollected = true; // Trava local para evitar spam do mesmo item
                sendMessage(this.socket, { type: 'pickup_item', dropId: itemSprite.dropId });
            }
        });

        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.keyboard.once('keydown-ESC', () => this.scene.start('Loading', { destino: 'HubCentral' }));

        // Tela de inventário (Passo 1, Round 3): abre/fecha com TAB ou clique no ícone da UIScene
        // (evento 'inventory_toggle'). Enquanto aberta, o jogador fica estático — a imunidade real
        // é autoritária no servidor (inventory_open/close + guarda em attack_enemy/player_move);
        // aqui só espelhamos o estado pra travar o input local e evitar tráfego de movimento inútil.
        this.inventoryOpen = false;
        this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB); // senão o browser tira o foco do canvas
        this.onInventoryToggle = () => this.toggleInventoryScreen();
        this.input.keyboard.on('keydown-TAB', this.onInventoryToggle);
        this.game.events.on('inventory_toggle', this.onInventoryToggle);

        // Debug tp boss (Passo 3a)
        this.input.keyboard.on('keydown-T', () => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                sendMessage(this.socket, { type: 'debug_tp_boss' });
            }
        });

        this.initMultiplayer();

        // UIScene (inventário) roda em paralelo — só desenha o que o servidor manda via EventBus.
        this.scene.launch('UIScene');
        this.onInventoryAction = (msg) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) sendMessage(this.socket, msg);
        };
        this.game.events.on('inventory_action', this.onInventoryAction);

        this.events.once('shutdown', () => {
            this.events.off('postupdate', this.renderPlayerHp, this);
            this.input.keyboard.removeAllListeners('keydown-ESC');
            this.input.keyboard.removeAllListeners('keydown-T');
            this.input.keyboard.off('keydown-TAB', this.onInventoryToggle);
            this.game.events.off('inventory_toggle', this.onInventoryToggle);
            this.game.events.off('inventory_action', this.onInventoryAction);
            this.scene.stop('UIScene');
            this.playerHpGraphics.destroy();
            this.portalVisual.destroy();
            this.portalLabel.destroy();
            this.portalProgressText.destroy();
            this.enemyData.forEach(data => { data.hpGraphics.destroy(); data.nameText.destroy(); });
            this.otherPlayers.forEach(rp => rp.hpGraphics.destroy());
            if (this.socket) this.socket.close();
        });
    }

    initMultiplayer() {
        this.socket = new WebSocket(SERVER_URL);

        // Join automático (item 3): cobre tanto a primeira conexão quanto a reabertura do
        // socket após scene.restart() — initMultiplayer() roda de novo em todo create().
        // O id vem do registry, gravado pela SelecaoPersonagem.
        this.socket.onopen = () => {
            console.log('Conectado ao servidor autoritário!');
            const personagemId = this.registry.get('personagem_id');
            if (personagemId === undefined || personagemId === null) {
                console.error('[ExploracaoCombate] Sem personagem_id no registry — join não enviado.');
                return;
            }
            sendMessage(this.socket, { type: 'join', personagem_id: personagemId });
        };

        // Despacho por mapa de handlers em vez de cadeia if/else (fase2_spec.md Pacote 5, §5.1.1).
        this.messageHandlers = {
            welcome: this.handleWelcome.bind(this),
            player_joined: this.handlePlayerJoined.bind(this),
            player_left: this.handlePlayerLeft.bind(this),
            combat_event: this.handleCombatEvent.bind(this),
            enemy_died: this.handleEnemyDied.bind(this),
            enemy_spawned: this.handleEnemySpawned.bind(this),
            player_died: this.handlePlayerDied.bind(this),
            level_up: this.handleLevelUp.bind(this),
            xp_update: this.handleXpUpdate.bind(this),
            inventory_update: this.handleInventoryUpdate.bind(this),
            stats_updated: this.handleStatsUpdated.bind(this),
            state_update: this.handleStateUpdate.bind(this),
            item_dropped: this.handleItemDropped.bind(this),
            item_removed: this.handleItemRemoved.bind(this),
            portal_feedback: this.handlePortalFeedback.bind(this),
            force_teleport: this.handleForceTeleport.bind(this)
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const handler = this.messageHandlers[data.type];
            if (handler) handler(data);
            else console.warn('[ExploracaoCombate] Mensagem sem handler registrado:', data.type, data);
        };
    }

    // ─────────────────────────────────────────────────────────────────
    // HANDLERS DE MENSAGENS DO SERVIDOR
    // ─────────────────────────────────────────────────────────────────

    // CARREGAMENTO INICIAL DO MUNDO
    handleWelcome(data) {
        this.myId = data.id;
        this.playerStats = data.state.players[this.myId];
        this.playerStats.xp_proximo_nivel = data.xp_proximo_nivel;
        this.playerVisual.setPosition(this.player.x, this.player.y);

        for (const pid in data.state.players) {
            if (pid !== this.myId) this.spawnRemotePlayer(data.state.players[pid]);
        }
        for (const eid in data.state.enemies) this.spawnEnemy(data.state.enemies[eid]);
        
        // Renderiza os itens que já estão no chão ao entrar no jogo (Passo 5b)
        for (const dropId in data.state.itensNoChao) {
            this.spawnItem(data.state.itensNoChao[dropId]);
        }

        // Respawn (Round 1): servidor concedeu invulnerabilidade autoritária de 3s (ver join em
        // server.js). Correção Round 2 (bug do movimento congelado): usa `respawnShield`, flag
        // própria que não gateia movimento nem o collider de ataque — a proteção real contra dano
        // já é garantida no servidor, independente do client. Antes reaproveitava `invulnerable`
        // (do knockback), o que travava o jogador parado em cima do inimigo por 3s.
        if (data.reviveu) {
            this.player.respawnShield = true;
            this.time.delayedCall(3000, () => this.player.respawnShield = false);
        }

        // Estado inicial de inventário/atributos pra UIScene (já veio dentro do welcome)
        this.game.events.emit('inventory_update', { personagem_id: this.myId, itens: this.playerStats.inventario });
        this.atualizarStatsUI();
    }

    // OUTROS JOGADORES ENTRANDO/SAINDO
    handlePlayerJoined(data) {
        if (data.player.id === this.myId) return;
        // Causa B (Round 2): reconexão rápida do mesmo id mandava um segundo player_joined antes
        // do player_left do anterior chegar — spawnRemotePlayer criava um sprite novo sem destruir
        // o velho, que virava órfão (visível, nunca atualizado por state_update, nunca removido).
        // Idempotente: se o id já existe, destrói o sprite/graphics velho antes de recriar.
        if (this.otherPlayers.has(data.player.id)) {
            const rp = this.otherPlayers.get(data.player.id);
            rp.hpGraphics.destroy();
            rp.sprite.destroy();
            this.otherPlayers.delete(data.player.id);
        }
        this.spawnRemotePlayer(data.player);
    }

    handlePlayerLeft(data) {
        if (this.otherPlayers.has(data.id)) {
            const rp = this.otherPlayers.get(data.id);
            rp.hpGraphics.destroy();
            rp.sprite.destroy();
            this.otherPlayers.delete(data.id);
        }
    }

    // RESPAWN CONTÍNUO DE INIMIGOS (Causa C, Round 2): state_update não cria inimigo novo,
    // só atualiza os que o client já conhece — inimigo novo precisa de aviso próprio.
    handleEnemySpawned(data) {
        this.spawnEnemy(data.enemy);
    }

    // RESULTADO DE COMBATE (HP UPDATE)
    handleCombatEvent(data) {
        if (data.playerId === this.myId) {
            this.playerStats.hp_atual = data.player_hp;
            this.atualizarStatsUI();
        } else if (this.otherPlayers.has(data.playerId)) {
            this.otherPlayers.get(data.playerId).hp_atual = data.player_hp;
        }
        if (this.enemyData.has(data.enemyId)) {
            this.enemyData.get(data.enemyId).hp_atual = data.enemy_hp;
        }
    }

    // EVENTOS DE MORTE
    handleEnemyDied(data) {
        if (this.enemyData.has(data.enemyId)) {
            const e = this.enemyData.get(data.enemyId);
            e.hpGraphics.destroy();
            e.nameText.destroy();
            e.sprite.destroy();
            this.enemyData.delete(data.enemyId);
        }
    }

    handlePlayerDied(data) {
        if (data.playerId === this.myId) {
            this.scene.restart(); // Renasce (FSM trata o shutdown)
        } else if (this.otherPlayers.has(data.playerId)) {
            const rp = this.otherPlayers.get(data.playerId);
            rp.hpGraphics.destroy();
            rp.sprite.destroy();
            this.otherPlayers.delete(data.playerId);
        }
    }

    // SUBIDA DE NÍVEL (reusa o mesmo canal 'stats_updated' que a UIScene já ouve)
    handleLevelUp(data) {
        if (data.personagem_id !== this.myId) return;
        this.playerStats.nivel = data.nivel;
        this.playerStats.hp_max = data.hp_max;
        this.playerStats.dano_base = data.dano_base;
        this.playerStats.defesa_base = data.defesa_base;
        this.playerStats.hp_atual = data.hp_atual;
        this.atualizarStatsUI();

        // Indicador transitório (S4): texto simples que aparece e some sozinho após 3s.
        // `remove()` cancela o delayedCall anterior se subir 2 níveis em sequência rápida,
        // pra não sumir o texto do nível mais novo antes da hora.
        this.levelUpText.setText(`NÍVEL ${data.nivel}!`);
        if (this.levelUpTimer) this.levelUpTimer.remove();
        this.levelUpTimer = this.time.delayedCall(3000, () => this.levelUpText.setText(''));
    }

    // BARRA DE XP: canal próprio (não reusa stats_updated) porque dispara a cada golpe, não só
    // em mudança de hp/atributos — servidor manda experiencia/nivel/xp_proximo_nivel prontos.
    handleXpUpdate(data) {
        if (data.personagem_id !== this.myId) return;
        this.playerStats.experiencia = data.experiencia;
        this.playerStats.nivel = data.nivel;
        this.playerStats.xp_proximo_nivel = data.xp_proximo_nivel;
        this.atualizarStatsUI();
    }

    // TELA DE INVENTÁRIO (Passo 1, Round 3): alterna estado local, avisa o servidor (autoridade
    // real de imunidade/estático) e avisa a UIScene pra abrir/fechar a moldura visual.
    toggleInventoryScreen() {
        this.inventoryOpen = !this.inventoryOpen;
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            sendMessage(this.socket, { type: this.inventoryOpen ? 'inventory_open' : 'inventory_close' });
        }
        this.game.events.emit('inventory_screen_state', { open: this.inventoryOpen });
    }

    // INVENTÁRIO / ATRIBUTOS (autoridade 100% do servidor — client só espelha e repassa pro EventBus)
    handleInventoryUpdate(data) {
        if (data.personagem_id !== this.myId) return;
        this.playerStats.inventario = data.itens;
        this.game.events.emit('inventory_update', data);
    }

    handleStatsUpdated(data) {
        if (data.personagem_id !== this.myId) return;
        this.playerStats.hp_max = data.hp_max;
        this.playerStats.dano_base = data.dano_base;
        this.playerStats.defesa_base = data.defesa_base;
        this.playerStats.hp_atual = data.hp_atual;
        this.atualizarStatsUI();
    }

    // Centraliza o emit de 'stats_updated' a partir do `playerStats` atual — evita repetir o
    // mesmo shape em todo handler que muda hp_atual/hp_max/dano_base/defesa_base (Bug #2 do
    // teste de campo: handleCombatEvent atualizava hp_atual mas não avisava a UIScene).
    atualizarStatsUI() {
        this.game.events.emit('stats_updated', {
            personagem_id: this.myId,
            nivel: this.playerStats.nivel,
            hp_max: this.playerStats.hp_max,
            dano_base: this.playerStats.dano_base,
            defesa_base: this.playerStats.defesa_base,
            hp_atual: this.playerStats.hp_atual,
            experiencia: this.playerStats.experiencia,
            xp_proximo_nivel: this.playerStats.xp_proximo_nivel
        });
    }

    // SYNC DE POSIÇÕES (20Hz)
    handleStateUpdate(data) {
        // Players Remotos
        for (const pid in data.players) {
            if (pid !== this.myId && this.otherPlayers.has(pid)) {
                const rp = this.otherPlayers.get(pid);
                rp.targetX = data.players[pid].x;
                rp.targetY = data.players[pid].y;
            }
        }
        // Inimigos Controlados pelo Servidor
        for (const eid in data.enemies) {
            if (this.enemyData.has(eid)) {
                const e = this.enemyData.get(eid);
                e.targetX = data.enemies[eid].x;
                e.targetY = data.enemies[eid].y;
            }
        }

        if (data.portal) {
            this.portalState = data.portal;
            this.refreshPortalUi();
        }
    }

    // ITENS NO CHÃO (Passo 5b)
    handleItemDropped(data) {
        this.spawnItem(data.item);
    }

    handleItemRemoved(data) {
        if (this.itensData.has(data.dropId)) {
            const itemObj = this.itensData.get(data.dropId);
            itemObj.sprite.destroy();
            this.itensData.delete(data.dropId);
        }
    }

    handleForceTeleport(data) {
        // Salto autoritário: tira o player local de onde estava e força nova posição
        this.player.setPosition(data.x, data.y);
        this.playerVisual.setPosition(data.x, data.y);

        // Os destinos 1000 (mapa normal) e 5000 (arena) ficam separados pelo corte 3000.
        if (data.x >= 3000 && data.y >= 3000) {
            this.physics.world.setBounds(4000, 4000, 2000, 2000);
            this.cameras.main.setBounds(4000, 4000, 2000, 2000);
        } else {
            this.physics.world.setBounds(0, 0, 2000, 2000);
            this.cameras.main.setBounds(0, 0, 2000, 2000);
        }

        // Força envio imediato para alinhar o servidor sem esperar o próximo tick de 50ms
        this.movePayload.x = this.player.x;
        this.movePayload.y = this.player.y;
        this.movePayload.vx = 0;
        this.movePayload.vy = 0;
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            sendMessage(this.socket, this.movePayload);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // FUNÇÕES DE SPAWN (RENDERIZAÇÃO LOCAL)
    // ─────────────────────────────────────────────────────────────────
    handlePortalFeedback(data) {
        this.game.events.emit('portal_feedback_ui', {
            message: data.message ?? 'Nível insuficiente para entrar na arena.'
        });
    }

    refreshPortalUi() {
        if (!this.portalState) return;
        const progressPct = Math.max(0, Math.min(100, Math.round((this.portalState.progress ?? 0) * 100)));
        this.portalLabel.setText(this.portalState.active ? 'CANALIZANDO' : 'PORTAL');
        this.portalProgressText.setText(
            this.portalState.active
                ? `${progressPct}%  |  nível ${PORTAL_BOSS_MIN_LEVEL}+`
                : `nível ${PORTAL_BOSS_MIN_LEVEL}+`
        );
    }

    spawnRemotePlayer(state) {
        const sprite = this.add.rectangle(state.x, state.y, 40, 40, 0x0000ff);
        this.otherPlayers.set(state.id, {
            sprite: sprite, targetX: state.x, targetY: state.y,
            hp_atual: state.hp_atual, hp_max: state.hp_max, hpGraphics: this.add.graphics()
        });
    }

    spawnEnemy(state) {
        const isBoss = Boolean(state.is_boss || state.nome === 'Boss');
        const cor = ENEMY_COLOR_BY_NOME[state.nome] ?? ENEMY_COLOR_FALLBACK;
        const size = isBoss ? 60 : 30;
        const sprite = this.add.rectangle(state.x, state.y, size, size, cor);
        if (isBoss) {
            sprite.setStrokeStyle(3, 0xffffff); // Borda branca para contraste máximo
        }
        this.physics.add.existing(sprite);
        sprite.body.setImmovable(true); // O Cliente não empurra fisicamente o inimigo
        sprite.serverId = state.id;
        this.enemiesGroup.add(sprite);
        const nameOffsetY = isBoss ? -50 : -40;
        const nameText = this.add.text(state.x, state.y + nameOffsetY, state.nome ?? '', {
            color: isBoss ? '#ffcc00' : '#ffffff',
            fontSize: isBoss ? '15px' : '12px',
            fontStyle: isBoss ? 'bold' : 'normal'
        }).setOrigin(0.5);
        this.enemyData.set(state.id, {
            sprite: sprite, targetX: state.x, targetY: state.y,
            hp_atual: state.hp_atual, hp_max: state.hp_max, hpGraphics: this.add.graphics(),
            nameText: nameText,
            is_boss: isBoss
        });
    }

    // Desenha o item no chão (Passo 5b)
    spawnItem(itemData) {
        console.log(`[CLIENT] Renderizando item ${itemData.nome} em ${itemData.x}, ${itemData.y}`);
        
        // Fallback visual: retângulo amarelo maior e mais visível
        const sprite = this.add.rectangle(itemData.x, itemData.y, 30, 30, 0xffff00);
        sprite.setStrokeStyle(4, 0xffa500); // Borda laranja
        sprite.setDepth(100); // Garante que ficará por cima de tudo
        
        this.physics.add.existing(sprite);
        sprite.body.setImmovable(true);
        // Ajusta a hitbox para facilitar a coleta
        sprite.body.setSize(40, 40);
        
        sprite.dropId = itemData.id;
        sprite.isBeingCollected = false; // flag local
        this.itensNoChaoGroup.add(sprite);

        this.itensData.set(itemData.id, { sprite: sprite, data: itemData });
    }

    // ─────────────────────────────────────────────────────────────────
    // LOOP PRINCIPAL (cadência do render; envio de rede throttled a 20Hz)
    // ─────────────────────────────────────────────────────────────────
    update(time, delta) {
        if (!this.playerStats) return; // Espera o handshake do server

        // 1. Movimentação Local Predita (SÓ PERMITE SE NÃO ESTIVER EM KNOCKBACK NEM COM O INVENTÁRIO ABERTO)
        if (this.inventoryOpen) {
            this.player.body.setVelocity(0); // estático — zera até velocidade residual de knockback
        } else if (!this.player.invulnerable) {
            this.player.body.setVelocity(0);

            // Usa o bounds dinâmico real da engine de física para evitar o cabo-de-guerra visual
            const wb = this.physics.world.bounds;
            const halfW = this.player.body.width / 2;
            const halfH = this.player.body.height / 2;

            if (this.cursors.left.isDown && this.player.x > wb.x + halfW) this.player.body.setVelocityX(-300);
            else if (this.cursors.right.isDown && this.player.x < wb.right - halfW) this.player.body.setVelocityX(300);

            if (this.cursors.up.isDown && this.player.y > wb.y + halfH) this.player.body.setVelocityY(-300);
            else if (this.cursors.down.isDown && this.player.y < wb.bottom - halfH) this.player.body.setVelocityY(300);
        }

        // 2. Interpola Inimigos e Renderiza HP
        this.enemyData.forEach(e => {
            e.sprite.x = Phaser.Math.Linear(e.sprite.x, e.targetX, 0.15);
            e.sprite.y = Phaser.Math.Linear(e.sprite.y, e.targetY, 0.15);
            
            // Sincroniza o corpo físico interno com a nova posição visual para acerto perfeito
            if (e.sprite.body) {
                e.sprite.body.position.x = e.sprite.x - e.sprite.body.width / 2;
                e.sprite.body.position.y = e.sprite.y - e.sprite.body.height / 2;
            }
            
            const barWidth = e.is_boss ? 70 : 30;
            const hpOffsetY = e.is_boss ? -38 : -25;
            const nameOffsetY = e.is_boss ? -50 : -40;
            this.drawHpBar(e.hpGraphics, e.sprite.x, e.sprite.y + hpOffsetY, e.hp_atual, e.hp_max, barWidth);
            e.nameText.setPosition(e.sprite.x, e.sprite.y + nameOffsetY);
        });

        // 3. Interpola o jogador local para o que o jogador realmente vê
        this.playerVisual.x = Phaser.Math.Linear(this.playerVisual.x, this.player.x, 0.5);
        this.playerVisual.y = Phaser.Math.Linear(this.playerVisual.y, this.player.y, 0.5);

        // 4. Interpola Jogadores Remotos e Renderiza HP
        this.otherPlayers.forEach(rp => {
            rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.targetX, 0.15);
            rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.targetY, 0.15);
            this.drawHpBar(rp.hpGraphics, rp.sprite.x, rp.sprite.y - 30, rp.hp_atual, rp.hp_max, 40);
        });

        // 5. Envia Atualização (throttled a ~20Hz, payload reutilizado)
        this.moveSendAccumulator += delta;
        if (this.moveSendAccumulator >= this.MOVE_SEND_INTERVAL_MS) {
            this.moveSendAccumulator -= this.MOVE_SEND_INTERVAL_MS;
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.movePayload.x = this.player.x;
                this.movePayload.y = this.player.y;
                this.movePayload.vx = this.player.body.velocity.x;
                this.movePayload.vy = this.player.body.velocity.y;
                sendMessage(this.socket, this.movePayload);
            }
        }
    }

    renderPlayerHp() {
        if (!this.playerStats) return;
        this.drawHpBar(this.playerHpGraphics, this.playerVisual.x, this.playerVisual.y - 30, this.playerStats.hp_atual, this.playerStats.hp_max, 40);
    }

    drawHpBar(graphics, x, y, hp, maxHp, width) {
        graphics.clear();
        if (hp <= 0) return;
        const percent = Math.max(0, hp / maxHp);
        const bgX = x - width / 2;
        graphics.fillStyle(0x000000, 0.8);
        graphics.fillRect(bgX, y, width, 6);
        const color = percent > 0.5 ? 0x00ff00 : (percent > 0.25 ? 0xffff00 : 0xff0000);
        graphics.fillStyle(color, 1);
        graphics.fillRect(bgX, y, width * percent, 6);
    }
}
