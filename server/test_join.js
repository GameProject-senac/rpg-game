/**
 * Script de teste manual do Pacote 1 (fase2_spec.md §1.11).
 * NÃO faz parte do jogo — ferramenta de validação do handshake `join`.
 * Uso: node server/test_join.js <personagem_id> [label]
 */
const WebSocket = require('ws');

const personagemId = parseInt(process.argv[2], 10);
const label = process.argv[3] || `client(${personagemId})`;

if (Number.isNaN(personagemId)) {
    console.error('Uso: node server/test_join.js <personagem_id> [label]');
    process.exit(1);
}

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    console.log(`[${label}] conectado. Enviando join para personagem_id=${personagemId}`);
    ws.send(JSON.stringify({ type: 'join', personagem_id: personagemId }));
});

ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.type === 'welcome') {
        const me = data.state.players[personagemId];
        console.log(`[${label}] WELCOME recebido. Atributos carregados:`, {
            id: data.id,
            nome: me.nome,
            classe: me.classe,
            nivel: me.nivel,
            hp_atual: me.hp_atual,
            hp_max: me.hp_max,
            dano_base: me.dano_base,
            defesa_base: me.defesa_base,
            x: me.x,
            y: me.y
        });
    } else {
        console.log(`[${label}] msg:`, data.type);
    }
});

ws.on('close', (code, reason) => {
    console.log(`[${label}] conexão fechada. code=${code} reason=${reason.toString()}`);
});

ws.on('error', (err) => {
    console.error(`[${label}] erro:`, err.message);
});
