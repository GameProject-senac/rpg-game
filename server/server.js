const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log('🚀 Servidor WebSocket AUTORITÁRIO iniciado (Tick Rate: 20Hz)');

// O estado supremo do jogo agora reside aqui
const gameState = {
    players: {},
    enemies: {},
    items: {}
};

let nextPlayerId = 1;
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
    const playerId = `player_${nextPlayerId++}`;
    console.log(`[+] Conexão Estabelecida: ${playerId}`);

    // Cria jogador com score zerado
    gameState.players[playerId] = {
        id: playerId, x: 1000, y: 1000, vx: 0, vy: 0,
        hp_atual: 100, hp_max: 100, defesa_base: 5, dano_base: 25, score: 0
    };

    // Manda TODO o estado atual para o novo jogador (Players, Inimigos e Itens)
    ws.send(JSON.stringify({ 
        type: 'welcome', 
        id: playerId, 
        state: gameState 
    }));

    broadcast({ type: 'player_joined', player: gameState.players[playerId] }, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players[playerId];

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
                    broadcast({ type: 'item_despawned', itemId: data.itemId, playerId: playerId });
                    
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
        console.log(`[-] Conexão Encerrada: ${playerId}`);
        delete gameState.players[playerId];
        broadcast({ type: 'player_left', id: playerId });
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
