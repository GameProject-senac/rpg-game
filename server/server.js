const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Semente de nascimento por classe. Valores arbitrários de teste (não finais).
// Representa o estado base no nível 1, antes de qualquer buff de nível.
const CLASSES = {
    guerreiro: { hp_max: 100, dano_base: 25, defesa_base: 5 },
    mago:      { hp_max: 60,  dano_base: 40, defesa_base: 3 },
    arqueiro:  { hp_max: 70,  dano_base: 35, defesa_base: 3 },
    suporte:   { hp_max: 80,  dano_base: 20, defesa_base: 4 },
    tanque:    { hp_max: 150, dano_base: 15, defesa_base: 8 }
};

const BUFF_HP = 10;
const BUFF_DANO = 5;
const BUFF_DEFESA = 2;
const XP_POR_INIMIGO = 50; // fase2_spec.md Apêndice A (confirmado no Pacote 2)

// Deriva os atributos efetivos (hp_max/dano_base/defesa_base) a partir do molde da classe + buff de nível.
// Usado tanto no carregamento (join) quanto na subida de nível.
function calcularAtributosEfetivos(classe, nivel) {
    const molde = CLASSES[classe];
    if (!molde) return null;
    const niveisAcima = nivel - 1;
    return {
        hp_max: molde.hp_max + niveisAcima * BUFF_HP,
        dano_base: molde.dano_base + niveisAcima * BUFF_DANO,
        defesa_base: molde.defesa_base + niveisAcima * BUFF_DEFESA
    };
}

// Catálogo de itens. Valores arbitrários de teste (não finais). Só 'Equipamento' pode ser equipado.
const ITENS = {
    espada_enferrujada: { tipo: 'Equipamento', bonus_dano: 10, bonus_defesa: 0, bonus_hp: 0 },
    escudo_improvisado: { tipo: 'Equipamento', bonus_dano: 0, bonus_defesa: 5, bonus_hp: 20 }
};

// Soma os bônus dos itens equipados de um inventário (array de linhas da tabela `inventario`).
function calcularBonusEquipados(inventario) {
    const bonus = { bonus_hp: 0, bonus_dano: 0, bonus_defesa: 0 };
    for (const item of inventario) {
        if (!item.equipado) continue;
        const def = ITENS[item.item_id];
        if (!def) continue;
        bonus.bonus_hp += def.bonus_hp;
        bonus.bonus_dano += def.bonus_dano;
        bonus.bonus_defesa += def.bonus_defesa;
    }
    return bonus;
}

// Recálculo único de atributos efetivos: base da classe+nível (calcularAtributosEfetivos)
// + soma dos itens equipados. Nunca persiste hp_max/dano_base/defesa_base em `personagens`
// (fase2_spec.md §1/§4.5 — modelo de recálculo, sem segundo sistema de atributos).
function recalcularAtributosEfetivos(player) {
    const base = calcularAtributosEfetivos(player.classe, player.nivel);
    const bonus = calcularBonusEquipados(player.inventario);
    player.hp_max = base.hp_max + bonus.bonus_hp;
    player.dano_base = base.dano_base + bonus.bonus_dano;
    player.defesa_base = base.defesa_base + bonus.bonus_defesa;
}

const wss = new WebSocket.Server({ port: 8080 });
console.log('🚀 Servidor WebSocket AUTORITÁRIO iniciado (Tick Rate: 20Hz)');

// O estado supremo do jogo agora reside aqui
const gameState = {
    players: {},
    enemies: {}
};

// Trava de sessão em memória: personagem_id ativos no momento (efêmera, não persiste).
const activeSessions = new Set();

// Sinal transitório de respawn (mesmo padrão de `activeSessions`, chave = personagem_id):
// populado no INSTANTE da morte, consumido (removido) no PRÓXIMO join daquele personagem.
// Corrige o bug de invulnerabilidade permanente — antes, `reviveu` era recalculado do
// `hp_atual` do banco a cada join, e como a cura só existe em memória (grava no banco só via
// snapshot/liberarPersonagem), a condição nunca deixava de ser verdadeira e a invulnerabilidade
// era reconcedida indefinidamente. Agora é ligada ao EVENTO de morte, não ao estado persistido.
const respawnPendente = new Set();

// Remove um personagem da autoridade do servidor de forma SÍNCRONA (gameState.players e
// activeSessions liberados antes de qualquer await) — usada tanto no close do socket quanto
// na morte do jogador, para não depender do timing do handshake de close (corrida corrigida
// no teste de campo da Fase 2: join do reconecte chegando antes do close antigo ser processado).
// A gravação no banco roda em background sem bloquear a liberação.
function liberarPersonagem(player) {
    delete gameState.players[player.id];
    activeSessions.delete(player.id);
    pool.query(
        'UPDATE personagens SET posicao_x = ?, posicao_y = ?, hp_atual = ?, nivel = ?, experiencia = ? WHERE id = ?',
        [player.x, player.y, player.hp_atual, player.nivel, player.experiencia, player.id]
    ).catch(err => console.error(`[liberarPersonagem] Erro ao gravar estado final de ${player.id}:`, err));
}

let nextEnemyId = 1;

// Pontos fixos de spawn de inimigo — reusados tanto na população inicial quanto no respawn
// contínuo (Causa C, Round 2, §8.12).
const ENEMY_SPAWN_POINTS = [
    { x: 200, y: 200, vx: 150, vy: 200 },
    { x: 1800, y: 1800, vx: -200, vy: -150 },
    { x: 200, y: 1800, vx: 200, vy: -150 },
    { x: 1800, y: 200, vx: -150, vy: 200 }
];
const ENEMY_HP = 50, ENEMY_DANO = 15, ENEMY_DEFESA = 2;
const ENEMY_POPULATION_CAP = 7;
let nextEnemySpawnPoint = 0;

// 1. Gerador de Inimigos (Server-side)
function spawnEnemy(x, y, vx, vy, hp, dano, defesa) {
    const id = `enemy_${nextEnemyId++}`;
    gameState.enemies[id] = { id, x, y, vx, vy, hp_atual: hp, hp_max: hp, dano_base: dano, defesa_base: defesa };
    return gameState.enemies[id];
}

// População inicial: os mesmos 3 primeiros pontos fixos de sempre.
for (let i = 0; i < 3; i++) {
    const p = ENEMY_SPAWN_POINTS[i % ENEMY_SPAWN_POINTS.length];
    spawnEnemy(p.x, p.y, p.vx, p.vy, ENEMY_HP, ENEMY_DANO, ENEMY_DEFESA);
}
nextEnemySpawnPoint = 3 % ENEMY_SPAWN_POINTS.length; // respawn contínuo cicla a partir daqui

wss.on('connection', (ws) => {
    console.log('[+] Conexão WebSocket estabelecida (aguardando join)');

    // Identidade da conexão: só existe após um 'join' bem-sucedido.
    let personagemId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // Seleção de personagem: pool compartilhado sem dono (sem login — ver roadmap_game.md §1.1).
            // Funciona sem join prévio; conexão de listagem é curta e independente (Modelo B).
            if (data.type === 'list_characters') {
                let rows;
                try {
                    [rows] = await pool.query('SELECT id, nome, classe, nivel FROM personagens');
                } catch (dbErr) {
                    console.error('[list_characters] Erro ao consultar personagens:', dbErr);
                    ws.send(JSON.stringify({ type: 'character_list', personagens: [] }));
                    return;
                }
                const personagens = rows.map(row => ({
                    id: row.id,
                    nome: row.nome,
                    classe: row.classe,
                    nivel: row.nivel,
                    em_uso: activeSessions.has(String(row.id))
                }));
                ws.send(JSON.stringify({ type: 'character_list', personagens }));
                return;
            }

            if (data.type === 'join') {
                const requestedId = String(data.personagem_id);

                if (activeSessions.has(requestedId)) {
                    console.log(`[join] Recusado — personagem_id ${requestedId} já está em sessão ativa.`);
                    ws.close(4000, 'Personagem já está em uma sessão ativa');
                    return;
                }

                let rows;
                try {
                    [rows] = await pool.query('SELECT * FROM personagens WHERE id = ?', [requestedId]);
                } catch (dbErr) {
                    console.error('[join] Erro ao consultar personagem:', dbErr);
                    ws.close(4000, 'Erro ao carregar personagem');
                    return;
                }

                if (rows.length === 0) {
                    console.log(`[join] Recusado — personagem_id ${requestedId} não encontrado.`);
                    ws.close(4000, 'Personagem não encontrado');
                    return;
                }

                const row = rows[0];
                if (!CLASSES[row.classe]) {
                    console.error(`[join] Classe desconhecida para personagem ${requestedId}: ${row.classe}`);
                    ws.close(4000, 'Classe de personagem inválida');
                    return;
                }

                let invRows;
                try {
                    [invRows] = await pool.query('SELECT * FROM inventario WHERE personagem_id = ?', [requestedId]);
                } catch (dbErr) {
                    console.error('[join] Erro ao consultar inventário:', dbErr);
                    ws.close(4000, 'Erro ao carregar inventário');
                    return;
                }

                personagemId = requestedId;
                activeSessions.add(personagemId);

                gameState.players[personagemId] = {
                    id: personagemId,
                    nome: row.nome,
                    classe: row.classe,
                    nivel: row.nivel,
                    experiencia: row.experiencia,
                    x: row.posicao_x,
                    y: row.posicao_y,
                    vx: 0, vy: 0,
                    hp_atual: row.hp_atual,
                    hp_max: 0, dano_base: 0, defesa_base: 0, // recalculado logo abaixo
                    inventario: invRows
                };
                const player = gameState.players[personagemId];
                recalcularAtributosEfetivos(player);

                // Faxina (Round 1): hp_atual <= 0 no banco significa que o personagem morreu em
                // algum momento e a cura em memória daquela sessão nunca chegou a ser persistida
                // (só grava via snapshot/liberarPersonagem). Cura sempre que precisar, recalculado
                // do banco a cada join — idempotente, sem custo, cobre inclusive dados antigos de
                // antes deste servidor ter subido.
                const precisaCurar = row.hp_atual <= 0;
                if (precisaCurar) {
                    player.hp_atual = player.hp_max;
                }

                // Invulnerabilidade de respawn (corrigido — bug do teste de campo): NÃO depende
                // mais do hp_atual do banco (isso reconcedia a janela em todo join, indefinidamente,
                // porque a cura acima nunca deixava de ser necessária). Depende só do evento real de
                // morte desta sessão do servidor — `respawnPendente` foi populado no instante exato
                // da morte (attack_enemy) e é consumido (removido) aqui, uma única vez.
                const concederInvulnerabilidade = respawnPendente.delete(requestedId);
                if (concederInvulnerabilidade) {
                    player.invulneravelAte = Date.now() + 3000;
                }

                console.log(`[+] Personagem ${personagemId} (${row.nome}, ${row.classe}, nível ${row.nivel}) entrou.${precisaCurar ? ' (hp_atual curado)' : ''}${concederInvulnerabilidade ? ' (invulnerabilidade de respawn concedida)' : ''}`);

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: personagemId,
                    reviveu: concederInvulnerabilidade,
                    state: gameState
                }));

                broadcast({ type: 'player_joined', player }, ws);
                return;
            }

            if (personagemId === null) return; // Sem identidade estabelecida, ignora ação

            const player = gameState.players[personagemId];

            if (!player || player.hp_atual <= 0) return; // Mortos não agem

            if (data.type === 'player_move') {
                player.x = data.x; player.y = data.y; 
                player.vx = data.vx; player.vy = data.vy;
            }
            // AÇÃO: Equipar/desequipar item do inventário
            else if (data.type === 'equip_item' || data.type === 'unequip_item') {
                const querEquipar = data.type === 'equip_item';
                const item = player.inventario.find(i => i.id === data.inventario_id);

                if (!item) return; // Item não encontrado no inventário deste jogador — ignora
                if (querEquipar && ITENS[item.item_id]?.tipo !== 'Equipamento') return; // Só Equipamento pode ser equipado

                item.equipado = querEquipar;

                try {
                    await pool.query('UPDATE inventario SET equipado = ? WHERE id = ?', [querEquipar, item.id]);
                } catch (dbErr) {
                    console.error(`[${data.type}] Erro ao gravar equipado de ${item.id}:`, dbErr);
                }

                recalcularAtributosEfetivos(player);

                ws.send(JSON.stringify({ type: 'inventory_update', personagem_id: personagemId, itens: player.inventario }));
                ws.send(JSON.stringify({
                    type: 'stats_updated',
                    personagem_id: personagemId,
                    hp_max: player.hp_max,
                    dano_base: player.dano_base,
                    defesa_base: player.defesa_base,
                    hp_atual: player.hp_atual
                }));
            }
            // AÇÃO: Combate (Encostou no Inimigo)
            else if (data.type === 'attack_enemy') {
                const enemy = gameState.enemies[data.enemyId];
                if (enemy) {
                    // Invulnerabilidade de respawn (Round 1): autoritária aqui, não no client —
                    // concedida no join (ver comentário em `reviveu`) e checada por tempo, sem
                    // precisar de timer/cleanup — expira sozinha quando Date.now() ultrapassa.
                    const invulneravel = !!player.invulneravelAte && Date.now() < player.invulneravelAte;

                    // Servidor calcula o dano deterministicamente
                    const danoNoEnemy = Math.max(1, player.dano_base - enemy.defesa_base);

                    enemy.hp_atual -= danoNoEnemy;
                    if (!invulneravel) {
                        const danoNoPlayer = Math.max(1, enemy.dano_base - player.defesa_base);
                        player.hp_atual -= danoNoPlayer;
                    }

                    // Avisa todos do novo HP
                    broadcast({
                        type: 'combat_event',
                        enemyId: enemy.id,
                        playerId: player.id,
                        enemy_hp: enemy.hp_atual,
                        player_hp: player.hp_atual
                    });

                    // Verifica morte do Inimigo
                    if (enemy.hp_atual <= 0) {
                        delete gameState.enemies[enemy.id];
                        broadcast({ type: 'enemy_died', enemyId: enemy.id, killerId: player.id });
                        concederXP(player, XP_POR_INIMIGO).catch(err => console.error('[XP] Erro ao processar XP/nível:', err));
                    }
                    // Verifica morte do Jogador
                    if (player.hp_atual <= 0) {
                        broadcast({ type: 'player_died', playerId: player.id });
                        // Marca o sinal transitório de respawn AQUI, no instante exato da morte —
                        // é isso que o próximo join vai consumir pra conceder invulnerabilidade
                        // (ver comentário em `respawnPendente`). Não depende do hp_atual do banco.
                        respawnPendente.add(player.id);
                        // Libera a sessão AGORA, não no close do socket antigo — elimina a corrida
                        // com o join automático do reconecte. Ordem importa: liberarPersonagem(player)
                        // precisa rodar antes de zerar personagemId, senão perdemos a referência.
                        liberarPersonagem(player);
                        personagemId = null;
                    }
                }
            }
        } catch (e) {
            console.error('Erro:', e);
        }
    });

    ws.on('close', () => {
        // personagemId já vem null aqui se a sessão foi liberada na morte (ver attack_enemy) —
        // vira no-op automático, sem flag extra, sem persistir/remover/broadcast em duplicidade.
        if (personagemId !== null) {
            console.log(`[-] Personagem Desconectado: ${personagemId}`);

            const player = gameState.players[personagemId];
            if (player) liberarPersonagem(player);

            broadcast({ type: 'player_left', id: personagemId });
        } else {
            console.log('[-] Conexão encerrada antes de qualquer join (ou já liberada por morte).');
        }
    });
});

// Concede XP a um jogador, processa subida(s) de nível (em loop, cobrindo XP excedente)
// e persiste nível/experiência imediatamente quando há subida. Não bloqueia o tick loop.
async function concederXP(player, quantidade) {
    player.experiencia += quantidade;

    let subiuNivel = false;
    while (player.experiencia >= player.nivel * 100) {
        player.experiencia -= player.nivel * 100;
        player.nivel += 1;
        subiuNivel = true;
    }

    if (!subiuNivel) return;

    recalcularAtributosEfetivos(player); // classe+nível + itens equipados, nunca só classe+nível

    try {
        await pool.query(
            'UPDATE personagens SET nivel = ?, experiencia = ? WHERE id = ?',
            [player.nivel, player.experiencia, player.id]
        );
    } catch (dbErr) {
        console.error(`[level_up] Erro ao gravar nível de ${player.id}:`, dbErr);
    }

    broadcast({
        type: 'level_up',
        personagem_id: player.id,
        nivel: player.nivel,
        hp_max: player.hp_max,
        dano_base: player.dano_base,
        defesa_base: player.defesa_base,
        hp_atual: player.hp_atual
    });
}

// ────────────────────────────────────────────────────────
// TICK LOOP DO SERVIDOR (Movendo os Inimigos Autorativamente)
// ────────────────────────────────────────────────────────
const TICK_RATE = 50; // 20Hz
setInterval(() => {
    if (wss.clients.size === 0) return; 

    // O servidor move os inimigos
    const dt = TICK_RATE / 1000;
    for (const eid in gameState.enemies) {
        const e = gameState.enemies[eid];
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        
        // Quica nas paredes (Mundo de 0 a 2000px)
        if (e.x <= 15 || e.x >= 1985) e.vx *= -1;
        if (e.y <= 15 || e.y >= 1985) e.vy *= -1;
    }

    const payload = JSON.stringify({
        type: 'state_update',
        players: gameState.players,
        enemies: gameState.enemies
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
}, TICK_RATE);

// ────────────────────────────────────────────────────────
// SNAPSHOT PERIÓDICO (Pacote 2 — grava posição/HP a cada ~10s, sem bloquear o tick de 20Hz)
// ────────────────────────────────────────────────────────
const SNAPSHOT_INTERVAL = 10000;
setInterval(() => {
    for (const id in gameState.players) {
        const p = gameState.players[id];
        pool.query(
            'UPDATE personagens SET posicao_x = ?, posicao_y = ?, hp_atual = ? WHERE id = ?',
            [p.x, p.y, p.hp_atual, p.id]
        ).catch(err => console.error(`[snapshot] Erro ao gravar personagem ${p.id}:`, err));
    }
}, SNAPSHOT_INTERVAL);

// ────────────────────────────────────────────────────────
// RESPAWN CONTÍNUO DE INIMIGOS (Causa C, Round 2 — §8.12): timer próprio, mesmo padrão do
// snapshot acima (não acopla ao tick de 20Hz, que é outro concern). Enquanto houver menos de
// ENEMY_POPULATION_CAP vivos, adiciona 1 a cada intervalo, ciclando pelos pontos fixos de spawn.
// ────────────────────────────────────────────────────────
const ENEMY_RESPAWN_INTERVAL = 10000;
setInterval(() => {
    if (Object.keys(gameState.enemies).length >= ENEMY_POPULATION_CAP) return;

    const p = ENEMY_SPAWN_POINTS[nextEnemySpawnPoint % ENEMY_SPAWN_POINTS.length];
    nextEnemySpawnPoint++;

    const enemy = spawnEnemy(p.x, p.y, p.vx, p.vy, ENEMY_HP, ENEMY_DANO, ENEMY_DEFESA);

    // state_update só atualiza posição de inimigos que o client já conhece, então um inimigo
    // novo precisa de aviso próprio.
    broadcast({ type: 'enemy_spawned', enemy });
}, ENEMY_RESPAWN_INTERVAL);

function broadcast(data, excludeWs = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) client.send(payload);
    });
}
