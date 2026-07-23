const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
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

const wss = new WebSocket.Server({ port: 8080 });
console.log('🚀 Servidor WebSocket AUTORITÁRIO iniciado (Tick Rate: 20Hz)');

// O estado supremo do jogo agora reside aqui
const gameState = {
    players: {},
    enemies: {},
    items: {}
};

// Trava de sessão em memória: personagem_id ativos no momento (efêmera, não persiste).
const activeSessions = new Set();

let nextEnemyId = 1;
let nextItemId = 1;

// 1. Gerador de Inimigos (Server-side)
function spawnEnemy(x, y, vx, vy, hp, dano, defesa) {
    const id = `enemy_${nextEnemyId++}`;
    gameState.enemies[id] = { id, x, y, vx, vy, hp_atual: hp, hp_max: hp, dano_base: dano, defesa_base: defesa };
}
spawnEnemy(200, 200, 150, 200, 50, 15, 2);
spawnEnemy(1800, 1800, -200, -150, 50, 15, 2);
spawnEnemy(200, 1800, 200, -150, 50, 15, 2);

// 2. Gerador de Moedas (Server-side)
function spawnMoedas() {
    const safePositions = [
        { x: 150, y: 150 }, { x: 1000, y: 150 }, { x: 1850, y: 150 },
        { x: 150, y: 1000 }, { x: 1850, y: 1000 },
        { x: 150, y: 1850 }, { x: 1000, y: 1850 }, { x: 1850, y: 1850 }
    ];
    safePositions.forEach(pos => {
        const id = `item_${nextItemId++}`;
        gameState.items[id] = { id, x: pos.x, y: pos.y, tipo: 'moeda' };
    });
}
spawnMoedas();

wss.on('connection', (ws) => {
    console.log('[+] Conexão WebSocket estabelecida (aguardando join)');

    // Identidade da conexão: só existe após um 'join' bem-sucedido.
    let personagemId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                const requestedId = data.personagem_id;

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
                const molde = CLASSES[row.classe];
                if (!molde) {
                    console.error(`[join] Classe desconhecida para personagem ${requestedId}: ${row.classe}`);
                    ws.close(4000, 'Classe de personagem inválida');
                    return;
                }

                const niveisAcima = row.nivel - 1;
                const hp_max = molde.hp_max + niveisAcima * BUFF_HP;
                const dano_base = molde.dano_base + niveisAcima * BUFF_DANO;
                const defesa_base = molde.defesa_base + niveisAcima * BUFF_DEFESA;

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
                    hp_max, dano_base, defesa_base,
                    score: 0
                };

                console.log(`[+] Personagem ${personagemId} (${row.nome}, ${row.classe}, nível ${row.nivel}) entrou.`);

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: personagemId,
                    state: gameState
                }));

                broadcast({ type: 'player_joined', player: gameState.players[personagemId] }, ws);
                return;
            }

            if (personagemId === null) return; // Sem identidade estabelecida, ignora ação

            const player = gameState.players[personagemId];

            if (!player || player.hp_atual <= 0) return; // Mortos não agem

            if (data.type === 'player_move') {
                player.x = data.x; player.y = data.y; 
                player.vx = data.vx; player.vy = data.vy;
            }
            // AÇÃO: Pegou item
            else if (data.type === 'pickup_item') {
                if (gameState.items[data.itemId]) {
                    delete gameState.items[data.itemId]; // Remove do server
                    player.score += 10;
                    
                    // Avisa todo mundo que sumiu e quem pegou
                    broadcast({ type: 'item_despawned', itemId: data.itemId, playerId: personagemId });
                    
                    // Se as moedas acabaram, invoca mais!
                    if (Object.keys(gameState.items).length === 0) {
                        spawnMoedas();
                        broadcast({ type: 'items_respawned', items: gameState.items });
                    }
                }
            }
            // AÇÃO: Combate (Encostou no Inimigo)
            else if (data.type === 'attack_enemy') {
                const enemy = gameState.enemies[data.enemyId];
                if (enemy) {
                    // Servidor calcula o dano deterministicamente
                    const danoNoEnemy = Math.max(1, player.dano_base - enemy.defesa_base);
                    const danoNoPlayer = Math.max(1, enemy.dano_base - player.defesa_base);
                    
                    enemy.hp_atual -= danoNoEnemy;
                    player.hp_atual -= danoNoPlayer;

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
                        player.score += 50;
                        broadcast({ type: 'enemy_died', enemyId: enemy.id, killerId: player.id });
                    }
                    // Verifica morte do Jogador
                    if (player.hp_atual <= 0) {
                        broadcast({ type: 'player_died', playerId: player.id });
                    }
                }
            }
        } catch (e) {
            console.error('Erro:', e);
        }
    });

    ws.on('close', () => {
        if (personagemId !== null) {
            console.log(`[-] Personagem Desconectado: ${personagemId}`);
            delete gameState.players[personagemId];
            activeSessions.delete(personagemId);
            broadcast({ type: 'player_left', id: personagemId });
        } else {
            console.log('[-] Conexão encerrada antes de qualquer join.');
        }
    });
});

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

function broadcast(data, excludeWs = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) client.send(payload);
    });
}
