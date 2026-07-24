/**
 * Script de teste manual do Pacote 4 (fase2_spec.md §4.6 + item extra aprovado).
 * NÃO faz parte do jogo — ferramenta de validação de inventário/equipamento.
 * Uso: node server/test_pacote4.js <personagem_id>
 *
 * Pressupõe que o personagem já tem 3 linhas em `inventario` inseridas via SQL de teste:
 * espada_enferrujada (Equipamento), escudo_improvisado (Equipamento), moeda (Recurso) — todas equipado=FALSE.
 * Fluxo: join -> tenta equipar o item Recurso (deve ser recusado) -> equipa espada -> equipa escudo
 * (soma simultânea) -> desconecta -> reconecta e confirma que tudo persistiu.
 */
const WebSocket = require('ws');

const personagemId = parseInt(process.argv[2], 10);
if (Number.isNaN(personagemId)) {
    console.error('Uso: node server/test_pacote4.js <personagem_id>');
    process.exit(1);
}

function log(...args) {
    console.log(`[p4:${personagemId}]`, ...args);
}

function conectarERodar(fase, onWelcome) {
    return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:8080');
        let itens = {};

        ws.on('open', () => {
            log(`[${fase}] conectado. join...`);
            ws.send(JSON.stringify({ type: 'join', personagem_id: personagemId }));
        });

        ws.on('message', (raw) => {
            const data = JSON.parse(raw);
            if (data.type === 'welcome') {
                const me = data.state.players[personagemId];
                itens = {};
                (me.inventario || []).forEach(i => { itens[i.item_id] = i; });
                log(`[${fase}] WELCOME. stats:`, { hp_max: me.hp_max, dano_base: me.dano_base, defesa_base: me.defesa_base, hp_atual: me.hp_atual });
                log(`[${fase}] inventario:`, me.inventario.map(i => `${i.item_id}(id=${i.id},tipo=${i.tipo},equipado=${!!i.equipado})`));
                onWelcome(ws, itens, () => resolve());
            } else if (data.type === 'stats_updated') {
                log(`[${fase}] stats_updated:`, data);
            } else if (data.type === 'inventory_update') {
                log(`[${fase}] inventory_update:`, data.itens.map(i => `${i.item_id}(equipado=${!!i.equipado})`));
            }
        });

        ws.on('close', (code) => log(`[${fase}] conexão fechada. code=${code}`));
        ws.on('error', (err) => console.error(`[${fase}] erro:`, err.message));
    });
}

(async () => {
    // FASE A: tenta equipar o item Recurso (deve ser recusado), depois equipa espada e escudo (soma simultânea)
    await conectarERodar('fase-A', (ws, itens, done) => {
        setTimeout(() => {
            log('fase-A: tentando equipar item Recurso (moeda) — deve ser recusado');
            ws.send(JSON.stringify({ type: 'equip_item', inventario_id: itens['moeda'].id }));
        }, 300);

        setTimeout(() => {
            log('fase-A: equipando espada_enferrujada');
            ws.send(JSON.stringify({ type: 'equip_item', inventario_id: itens['espada_enferrujada'].id }));
        }, 800);

        setTimeout(() => {
            log('fase-A: equipando escudo_improvisado (simultâneo com a espada)');
            ws.send(JSON.stringify({ type: 'equip_item', inventario_id: itens['escudo_improvisado'].id }));
        }, 1300);

        setTimeout(() => {
            log('fase-A: desconectando para testar persistência');
            ws.close();
            done();
        }, 1800);
    });

    // FASE B: reconecta e confirma que o estado persistiu
    await conectarERodar('fase-B (reconexão)', (ws, itens, done) => {
        setTimeout(() => {
            log('fase-B: reconexão confirmada, encerrando.');
            ws.close();
            done();
        }, 500);
    });

    process.exit(0);
})();
