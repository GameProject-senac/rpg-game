/**
 * Script de teste manual do Pacote 2 (fase2_spec.md §2.6).
 * NÃO faz parte do jogo — ferramenta de validação de persistência/XP/nível.
 * Uso: node server/test_pacote2.js <personagem_id> [segundos_antes_de_fechar=12]
 *
 * Fluxo: conecta, dá join, move para uma posição distinta da inicial,
 * ataca os inimigos disponíveis em sequência (gerando dano/XP/kills/level_up)
 * e por fim fecha a conexão para permitir testar o save no disconnect.
 * Para testar o save no disconnect SEM esperar o snapshot (~10s), interrompa
 * o processo (Ctrl+C) logo após o primeiro "enemy_died" no log.
 */
const WebSocket = require('ws');

const personagemId = parseInt(process.argv[2], 10);
const segundosAntesDeFechar = parseInt(process.argv[3], 10) || 12;

if (Number.isNaN(personagemId)) {
    console.error('Uso: node server/test_pacote2.js <personagem_id> [segundos_antes_de_fechar]');
    process.exit(1);
}

function log(...args) {
    console.log(`[p2:${personagemId}]`, ...args);
}

const ws = new WebSocket('ws://localhost:8080');
let enemiesToAttack = [];
let attackIndex = 0;
let attackTimer = null;

ws.on('open', () => {
    log('conectado. Enviando join...');
    ws.send(JSON.stringify({ type: 'join', personagem_id: personagemId }));
});

ws.on('message', (raw) => {
    const data = JSON.parse(raw);

    switch (data.type) {
        case 'welcome': {
            const me = data.state.players[personagemId];
            log('WELCOME. posição/HP/nível/XP iniciais:', me.x, me.y, me.hp_atual, '| nivel:', me.nivel, '| xp:', me.experiencia);

            enemiesToAttack = Object.keys(data.state.enemies);
            log('inimigos disponíveis:', enemiesToAttack);

            const novoX = me.x + 300;
            const novoY = me.y + 300;
            ws.send(JSON.stringify({ type: 'player_move', x: novoX, y: novoY, vx: 0, vy: 0, anim: 'idle', flipX: false }));
            log('player_move enviado para', novoX, novoY);

            attackTimer = setInterval(() => {
                if (attackIndex >= enemiesToAttack.length) {
                    clearInterval(attackTimer);
                    log(`fim da sequência de ataques. Fechando em ${segundosAntesDeFechar}s...`);
                    setTimeout(() => ws.close(), segundosAntesDeFechar * 1000);
                    return;
                }
                ws.send(JSON.stringify({ type: 'attack_enemy', enemyId: enemiesToAttack[attackIndex] }));
            }, 500);
            break;
        }
        case 'combat_event':
            log('combat_event', data);
            break;
        case 'enemy_died':
            log('enemy_died', data);
            attackIndex++;
            break;
        case 'player_died':
            log('player_died — encerrando ataques.');
            clearInterval(attackTimer);
            setTimeout(() => ws.close(), segundosAntesDeFechar * 1000);
            break;
        case 'level_up':
            log('LEVEL_UP', data);
            break;
        default:
            break; // ignora state_update/player_updated (ruído de alta frequência)
    }
});

ws.on('close', (code, reason) => {
    log(`conexão fechada. code=${code} reason=${reason.toString()}`);
    process.exit(0);
});

ws.on('error', (err) => {
    console.error(`[p2:${personagemId}] erro:`, err.message);
});
