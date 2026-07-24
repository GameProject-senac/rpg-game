/**
 * @file ExploracaoCombate.js
 * @description Cena de exploração e combate (Client 100% Subordinado ao Server Node.js)
 */

export class ExploracaoCombate extends Phaser.Scene {

    constructor() {
        super('ExploracaoCombate');
    }

    create() {
        this.score = 0;
        this.physics.world.setBounds(0, 0, 2000, 2000);
        this.cameras.main.setBounds(0, 0, 2000, 2000);

        this.add.text(10, 10, 'SISTEMA ONLINE - ESC para voltar', { color: '#00ff00' }).setScrollFactor(0);
        this.scoreText = this.add.text(10, 30, 'DADOS COLETADOS: 0', { color: '#ffff00', fontSize: '20px' }).setScrollFactor(0);

        this.player = this.add.rectangle(1000, 1000, 40, 40, 0x00ffff);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);
        this.player.invulnerable = false;
        
        this.playerHpGraphics = this.add.graphics();
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

        // Throttle de envio de player_move: 60Hz de update() -> no máximo 20Hz de rede (fase2_spec.md Pacote 3).
        this.moveSendAccumulator = 0;
        this.MOVE_SEND_INTERVAL_MS = 50;
        this.movePayload = { type: 'player_move', x: 0, y: 0, vx: 0, vy: 0 };

        // ─────────────────────────────────────────────────────────────────
        // SETUP MULTIPLAYER (DADOS LOCAIS ESPELHANDO O SERVIDOR)
        // ─────────────────────────────────────────────────────────────────
        this.otherPlayers = new Map();
        this.enemyData = new Map();
        this.itemData = new Map();
        
        this.enemiesGroup = this.physics.add.group();
        this.itemsGroup = this.physics.add.group();
        
        // Colisões de Interação (Eventos enviados para o Servidor)
        this.physics.add.overlap(this.player, this.itemsGroup, (p, itemSprite) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'pickup_item', itemId: itemSprite.serverId }));
                // Oculta localmente (Client-side Prediction)
                itemSprite.setVisible(false);
                itemSprite.body.enable = false;
            }
        });

        this.physics.add.collider(this.player, this.enemiesGroup, (p, enemySprite) => {
            if (!this.player.invulnerable && this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'attack_enemy', enemyId: enemySprite.serverId }));
                
                // Cooldown local para não flodar a rede
                this.player.invulnerable = true;
                this.time.delayedCall(500, () => this.player.invulnerable = false);
                
                // Knockback Visual
                const angle = Phaser.Math.Angle.Between(enemySprite.x, enemySprite.y, p.x, p.y);
                p.body.setVelocity(Math.cos(angle) * 500, Math.sin(angle) * 500);
            }
        });

        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.keyboard.once('keydown-ESC', () => this.scene.start('Loading', { destino: 'HubCentral' }));

        this.initMultiplayer();

        // UIScene (inventário) roda em paralelo — só desenha o que o servidor manda via EventBus.
        this.scene.launch('UIScene');
        this.onInventoryAction = (msg) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
        };
        this.game.events.on('inventory_action', this.onInventoryAction);

        this.events.once('shutdown', () => {
            this.input.keyboard.removeAllListeners('keydown-ESC');
            this.game.events.off('inventory_action', this.onInventoryAction);
            this.scene.stop('UIScene');
            this.playerHpGraphics.destroy();
            this.enemyData.forEach(data => data.hpGraphics.destroy());
            this.otherPlayers.forEach(rp => rp.hpGraphics.destroy());
            if (this.socket) this.socket.close();
        });
    }

    initMultiplayer() {
        this.socket = new WebSocket('ws://localhost:8080');
        this.socket.onopen = () => console.log('Conectado ao servidor autoritário!');

        // Despacho por mapa de handlers em vez de cadeia if/else (fase2_spec.md Pacote 5, §5.1.1).
        this.messageHandlers = {
            welcome: this.handleWelcome.bind(this),
            player_joined: this.handlePlayerJoined.bind(this),
            player_left: this.handlePlayerLeft.bind(this),
            item_despawned: this.handleItemDespawned.bind(this),
            items_respawned: this.handleItemsRespawned.bind(this),
            combat_event: this.handleCombatEvent.bind(this),
            enemy_died: this.handleEnemyDied.bind(this),
            player_died: this.handlePlayerDied.bind(this),
            level_up: this.handleLevelUp.bind(this),
            inventory_update: this.handleInventoryUpdate.bind(this),
            stats_updated: this.handleStatsUpdated.bind(this),
            state_update: this.handleStateUpdate.bind(this)
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const handler = this.messageHandlers[data.type];
            if (handler) handler(data);
        };
    }

    // ─────────────────────────────────────────────────────────────────
    // HANDLERS DE MENSAGENS DO SERVIDOR
    // ─────────────────────────────────────────────────────────────────

    // CARREGAMENTO INICIAL DO MUNDO
    handleWelcome(data) {
        this.myId = data.id;
        this.playerStats = data.state.players[this.myId];

        for (const pid in data.state.players) {
            if (pid !== this.myId) this.spawnRemotePlayer(data.state.players[pid]);
        }
        for (const eid in data.state.enemies) this.spawnEnemy(data.state.enemies[eid]);
        for (const iid in data.state.items) this.spawnItem(data.state.items[iid]);

        // Estado inicial de inventário/atributos pra UIScene (já veio dentro do welcome)
        this.game.events.emit('inventory_update', { personagem_id: this.myId, itens: this.playerStats.inventario });
        this.game.events.emit('stats_updated', {
            personagem_id: this.myId,
            hp_max: this.playerStats.hp_max,
            dano_base: this.playerStats.dano_base,
            defesa_base: this.playerStats.defesa_base,
            hp_atual: this.playerStats.hp_atual
        });
    }

    // OUTROS JOGADORES ENTRANDO/SAINDO
    handlePlayerJoined(data) {
        if (data.player.id !== this.myId) this.spawnRemotePlayer(data.player);
    }

    handlePlayerLeft(data) {
        if (this.otherPlayers.has(data.id)) {
            const rp = this.otherPlayers.get(data.id);
            rp.hpGraphics.destroy();
            rp.sprite.destroy();
            this.otherPlayers.delete(data.id);
        }
    }

    // COLETA DE ITENS
    handleItemDespawned(data) {
        if (data.playerId === this.myId) {
            this.score += 10;
            this.scoreText.setText('DADOS COLETADOS: ' + this.score);
        }
        if (this.itemData.has(data.itemId)) {
            this.itemData.get(data.itemId).destroy();
            this.itemData.delete(data.itemId);
        }
    }

    handleItemsRespawned(data) {
        for (const iid in data.items) {
            this.spawnItem(data.items[iid]);
        }
    }

    // RESULTADO DE COMBATE (HP UPDATE)
    handleCombatEvent(data) {
        if (data.playerId === this.myId) {
            this.playerStats.hp_atual = data.player_hp;
        } else if (this.otherPlayers.has(data.playerId)) {
            this.otherPlayers.get(data.playerId).hp_atual = data.player_hp;
        }
        if (this.enemyData.has(data.enemyId)) {
            this.enemyData.get(data.enemyId).hp_atual = data.enemy_hp;
        }
    }

    // EVENTOS DE MORTE
    handleEnemyDied(data) {
        if (data.killerId === this.myId) {
            this.score += 50;
            this.scoreText.setText('DADOS COLETADOS: ' + this.score);
        }
        if (this.enemyData.has(data.enemyId)) {
            const e = this.enemyData.get(data.enemyId);
            e.hpGraphics.destroy();
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
        this.game.events.emit('stats_updated', data);
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
        this.game.events.emit('stats_updated', data);
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
    }

    // ─────────────────────────────────────────────────────────────────
    // FUNÇÕES DE SPAWN (RENDERIZAÇÃO LOCAL)
    // ─────────────────────────────────────────────────────────────────
    spawnRemotePlayer(state) {
        const sprite = this.add.rectangle(state.x, state.y, 40, 40, 0x0000ff);
        this.otherPlayers.set(state.id, {
            sprite: sprite, targetX: state.x, targetY: state.y,
            hp_atual: state.hp_atual, hp_max: state.hp_max, hpGraphics: this.add.graphics()
        });
    }

    spawnEnemy(state) {
        const sprite = this.add.rectangle(state.x, state.y, 30, 30, 0xff0000);
        this.physics.add.existing(sprite);
        sprite.body.setImmovable(true); // O Cliente não empurra fisicamente o inimigo
        sprite.serverId = state.id;
        this.enemiesGroup.add(sprite);
        this.enemyData.set(state.id, {
            sprite: sprite, targetX: state.x, targetY: state.y,
            hp_atual: state.hp_atual, hp_max: state.hp_max, hpGraphics: this.add.graphics()
        });
    }

    spawnItem(state) {
        const sprite = this.add.rectangle(state.x, state.y, 20, 20, 0xffff00);
        this.physics.add.existing(sprite, false);
        sprite.serverId = state.id;
        this.itemsGroup.add(sprite);
        this.itemData.set(state.id, sprite);
    }

    // ─────────────────────────────────────────────────────────────────
    // LOOP PRINCIPAL (60Hz de render; envio de rede throttled a 20Hz)
    // ─────────────────────────────────────────────────────────────────
    update(time, delta) {
        if (!this.playerStats) return; // Espera o handshake do server

        // 1. Movimentação Local Predita (SÓ PERMITE SE NÃO ESTIVER EM KNOCKBACK)
        if (!this.player.invulnerable) {
            this.player.body.setVelocity(0);
            if (this.cursors.left.isDown) this.player.body.setVelocityX(-300);
            else if (this.cursors.right.isDown) this.player.body.setVelocityX(300);
            if (this.cursors.up.isDown) this.player.body.setVelocityY(-300);
            else if (this.cursors.down.isDown) this.player.body.setVelocityY(300);
        }

        // 2. Renderiza Próprio HP
        this.drawHpBar(this.playerHpGraphics, this.player.x, this.player.y - 30, this.playerStats.hp_atual, this.playerStats.hp_max, 40);

        // 3. Interpola Inimigos e Renderiza HP
        this.enemyData.forEach(e => {
            e.sprite.x = Phaser.Math.Linear(e.sprite.x, e.targetX, 0.15);
            e.sprite.y = Phaser.Math.Linear(e.sprite.y, e.targetY, 0.15);
            
            // Sincroniza o corpo físico interno com a nova posição visual para acerto perfeito
            if (e.sprite.body) {
                e.sprite.body.position.x = e.sprite.x - e.sprite.body.width / 2;
                e.sprite.body.position.y = e.sprite.y - e.sprite.body.height / 2;
            }
            
            this.drawHpBar(e.hpGraphics, e.sprite.x, e.sprite.y - 25, e.hp_atual, e.hp_max, 30);
        });

        // 4. Interpola Jogadores Remotos e Renderiza HP
        this.otherPlayers.forEach(rp => {
            rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.targetX, 0.15);
            rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.targetY, 0.15);
            this.drawHpBar(rp.hpGraphics, rp.sprite.x, rp.sprite.y - 30, rp.hp_atual, rp.hp_max, 40);
        });

        // 5. Envia Atualização (throttled a ~20Hz, payload reutilizado — zero alocação por frame)
        this.moveSendAccumulator += delta;
        if (this.moveSendAccumulator >= this.MOVE_SEND_INTERVAL_MS) {
            this.moveSendAccumulator -= this.MOVE_SEND_INTERVAL_MS;
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.movePayload.x = this.player.x;
                this.movePayload.y = this.player.y;
                this.movePayload.vx = this.player.body.velocity.x;
                this.movePayload.vy = this.player.body.velocity.y;
                this.socket.send(JSON.stringify(this.movePayload));
            }
        }
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