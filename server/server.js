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
const XP_POR_DANO = 0.1; // XP = dano_efetivo × esta constante, pra TODO golpe (sem pico de abate — decisão do dono, comuns)

// Zonas do Jogo e Limites Autoritários (Sub-passo A, Peça 2)
const GAME_ZONES = {
    'mapa_normal': { minX: 0, maxX: 2000, minY: 0, maxY: 2000 },
    'arena_boss':  { minX: 4000, maxX: 6000, minY: 4000, maxY: 6000 }
};

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

// Soma os bônus dos itens equipados de um inventário (array de linhas de `inventario` já
// achatadas com o JOIN em `Itens` feito no `join` — ver server.js, handler 'join').
function calcularBonusEquipados(inventario) {
    const bonus = { bonus_hp: 0, bonus_dano: 0, bonus_defesa: 0 };
    for (const item of inventario) {
        if (!item.equipado) continue;
        bonus.bonus_hp += item.bonus_hp;
        bonus.bonus_dano += item.bonus_dano;
        bonus.bonus_defesa += item.bonus_defesa;
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

// Tabela de nível (banco `jogo_pi`, `table_nivel`): xp_necessaria é o XP TOTAL acumulado pra
// ESTAR naquele nível (não incremental) — ver roadmap_game.md pela análise completa. Carregada
// uma vez no boot (tabela pequena e estática, ~21 linhas) — evita query a cada concessão de XP.
const TABELA_NIVEL = new Map();
async function carregarTabelaNivel() {
    const [rows] = await pool.query('SELECT nivel, xp_necessaria FROM table_nivel');
    for (const r of rows) TABELA_NIVEL.set(r.nivel, Number(r.xp_necessaria));
}

// Tipos de mob (banco `jogo_pi`, `mobs`, Loot & Inimigos Passo 1b, peso_spawn desde o Passo 2a):
// mesmo padrão de carregamento único no boot que TABELA_NIVEL — tabela pequena e estática, evita
// query a cada spawn. experiencia_dropada é DECIMAL(4,2) e o mysql2 devolve DECIMAL como STRING,
// não number — Number(...) aqui é obrigatório, senão o multiplicador de XP do Passo 1c vira
// concatenação/NaN (mesmo bug já visto em personagens.experiencia). peso_spawn é INT — chega como
// number sem precisar de Number(...), confirmado no carregamento (Passo 2b).
const MOBS_TIPOS = [];
async function carregarMobsTipos() {
    const [rows] = await pool.query('SELECT id, nome_inimigo, vida, ataque, defesa, experiencia_dropada, is_boss, nivel, peso_spawn FROM mobs');
    for (const r of rows) {
        MOBS_TIPOS.push({
            mob_id: r.id,
            nome: r.nome_inimigo,
            vida: r.vida,
            ataque: r.ataque,
            defesa: r.defesa,
            xp_multiplicador: Number(r.experiencia_dropada),
            is_boss: Boolean(r.is_boss),
            nivel: r.nivel,
            peso_spawn: r.peso_spawn
        });
    }
}

// Drops por mob (banco `jogo_pi`, `mob_drops`, Loot & Inimigos Passo 4b): mesmo padrão de
// carregamento único no boot que TABELA_NIVEL/MOBS_TIPOS — tabela pequena e estática, evita
// query a cada morte de inimigo (frequente). Chave = mob_id (o TIPO, não a instância), valor =
// lista de linhas de drop daquele tipo. chance_drop é FLOAT e quantidade_min/max são INT — ambos
// chegam do mysql2 como number nativo, sem precisar de Number(...) (diferente do DECIMAL de
// experiencia_dropada acima), confirmado no carregamento do Passo 4a.
const MOB_DROPS = new Map();
async function carregarMobDrops() {
    const [rows] = await pool.query('SELECT mob_id, item_id, quantidade_min, quantidade_max, chance_drop FROM mob_drops');
    for (const r of rows) {
        if (!MOB_DROPS.has(r.mob_id)) MOB_DROPS.set(r.mob_id, []);
        MOB_DROPS.get(r.mob_id).push(r);
    }
}

// Catálogo de itens carregado no boot para o servidor consultar nomes sem ir ao banco a cada drop.
const CATALOGO_ITENS = {};
async function carregarCatalogoItens() {
    const [rows] = await pool.query('SELECT id, nome, tipo, bonus_dano, bonus_defesa, bonus_hp FROM Itens');
    for (const r of rows) {
        CATALOGO_ITENS[r.id] = r;
    }
}

// Decide o que um mob dropou na morte (Passo 4b): cada linha de drop do tipo rola sua própria
// chance, independente das outras (por isso Elite pode dropar espada E escudo). Quantidade
// sorteada dentro da faixa [quantidade_min, quantidade_max] — hoje sempre 1, mas a faixa é
// respeitada pra quando houver drops com quantidade variável. Só DECIDE o que dropou — não dá
// destino ao item (aparecer no mapa/coleta é o Passo 5, fora deste escopo).
function rolarDrops(mob_id) {
    const drops = MOB_DROPS.get(mob_id) ?? [];
    const resultado = [];
    for (const drop of drops) {
        if (Math.random() < drop.chance_drop) {
            const quantidade = drop.quantidade_min +
                Math.floor(Math.random() * (drop.quantidade_max - drop.quantidade_min + 1));
            resultado.push({ item_id: drop.item_id, quantidade });
        }
    }
    return resultado;
}

// Sorteio ponderado por peso_spawn (Passo 2b): soma os pesos de todos os tipos, sorteia um
// número de 0 até a soma, e percorre acumulando peso até cruzar o número sorteado — o tipo
// onde cruza é o escolhido. Tipos com peso maior saem mais (Comum), o Elite (peso baixo) é raro.
function sortearTipoMob() {
    const tiposComuns = MOBS_TIPOS.filter(tipo => !tipo.is_boss && tipo.peso_spawn > 0);
    const pesoTotal = tiposComuns.reduce((soma, tipo) => soma + tipo.peso_spawn, 0);
    let sorteio = Math.random() * pesoTotal;
    for (const tipo of tiposComuns) {
        sorteio -= tipo.peso_spawn;
        if (sorteio < 0) return tipo;
    }
    return tiposComuns[tiposComuns.length - 1];
}

// Todo o bootstrap do servidor espera a tabela de nível e os tipos de mob carregarem antes de
// abrir a porta — `concederXP` depende de `TABELA_NIVEL` e o spawn depende de `MOBS_TIPOS`, e a
// forma mais simples de garantir isso sem checagem espalhada é não aceitar nenhuma conexão até o
// carregamento terminar.
(async () => {
    await carregarTabelaNivel();
    await carregarMobsTipos();
    await carregarMobDrops();
    await carregarCatalogoItens();

    iniciarServidor();
})();

function iniciarServidor() {
// Porta dinâmica: o Railway (e a maioria dos PaaS) injeta process.env.PORT e espera que o
// processo escute nela. Fallback 8080 mantém o comportamento local de sempre.
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
console.log(`🚀 Servidor WebSocket AUTORITÁRIO iniciado na porta ${PORT} (Tick Rate: 20Hz)`);

// O estado supremo do jogo agora reside aqui
const gameState = {
    players: {},
    enemies: {},
    itensNoChao: {}
};

let dropIdCounter = 0;

// Trava de sessão em memória: personagem_id ativos no momento (efêmera, não persiste).
const activeSessions = new Set();
const playerSockets = new Map();

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
const ENEMY_POPULATION_CAP = 7;
let nextEnemySpawnPoint = 0;

// Portal do Boss (Sub-passo B): ponto fixo no mapa normal, com canalização autoritária.
const PORTAL_BOSS_ENTRY = { x: 300, y: 1000 };
const PORTAL_BOSS_DESTINATION = { x: 5000, y: 5000 };
const PORTAL_BOSS_RADIUS = 240;
const PORTAL_BOSS_CHANNEL_MS = 4000;
const PORTAL_BOSS_MIN_LEVEL = 3;
let portalChannelMs = 0;

// Desvio de spawn (Round 2 → confirmado em campo no A2, ver roadmap_game.md): com só 4 pontos
// fixos e teto 7, do 5º inimigo em diante o ciclo reusa coordenadas exatas de um já vivo — e o
// ponto fixo também pode cair em cima de um jogador. ENEMY_SPAWN_CLEARANCE é o raio (px) que
// nenhum outro ocupante (jogador OU inimigo vivo) pode estar dentro no momento do spawn.
const ENEMY_SPAWN_CLEARANCE = 220;
const MAP_MIN = 0, MAP_MAX = 2000; // mesmos limites do quique nas paredes (ver abaixo)

// Parte do ponto-âncora (um dos 4 cantos fixos) e desvia pra fora do raio de qualquer jogador
// ou inimigo vivo mais próximo que ENEMY_SPAWN_CLEARANCE. Um único passe pelos ocupantes —
// suficiente pro teto de 7 inimigos e poucos jogadores simultâneos, sem virar um solver físico.
function resolveSpawnPosition(anchor) {
    let x = anchor.x, y = anchor.y;

    const ocupantes = [
        ...Object.values(gameState.players),
        ...Object.values(gameState.enemies)
    ];

    for (const ocupante of ocupantes) {
        const dx = x - ocupante.x, dy = y - ocupante.y;
        const dist = Math.hypot(dx, dy);
        if (dist < ENEMY_SPAWN_CLEARANCE) {
            const angulo = dist === 0 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
            const folga = ENEMY_SPAWN_CLEARANCE + Math.random() * 40;
            x = ocupante.x + Math.cos(angulo) * folga;
            y = ocupante.y + Math.sin(angulo) * folga;
        }
    }

    return {
        x: Math.min(MAP_MAX, Math.max(MAP_MIN, x)),
        y: Math.min(MAP_MAX, Math.max(MAP_MIN, y))
    };
}

function isPlayerInsidePortal(player) {
    if (!player || player.zona !== 'mapa_normal' || player.hp_atual <= 0) return false;
    const dx = player.x - PORTAL_BOSS_ENTRY.x;
    const dy = player.y - PORTAL_BOSS_ENTRY.y;
    return Math.hypot(dx, dy) <= PORTAL_BOSS_RADIUS;
}

function getPlayersInsidePortal() {
    return Object.values(gameState.players).filter(isPlayerInsidePortal);
}

function getPortalSnapshot() {
    return {
        x: PORTAL_BOSS_ENTRY.x,
        y: PORTAL_BOSS_ENTRY.y,
        radius: PORTAL_BOSS_RADIUS,
        progress: portalChannelMs / PORTAL_BOSS_CHANNEL_MS,
        active: portalChannelMs > 0,
        required_level: PORTAL_BOSS_MIN_LEVEL,
        occupants: getPlayersInsidePortal().length
    };
}

function sendPortalFeedback(players, message) {
    for (const player of players) {
        const ws = playerSockets.get(player.id);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'portal_feedback',
                message,
                required_level: PORTAL_BOSS_MIN_LEVEL
            }));
        }
    }
}

function teleportGroupToArena(players) {
    for (const player of players) {
        player.zona = 'arena_boss';
        // Sub-passo C4: Se o jogador já tinha cofre congelado nesta tentativa, restaura; senão nasce 0
        if (cofresBossCongelados.has(player.id)) {
            player.xp_boss = cofresBossCongelados.get(player.id);
            cofresBossCongelados.delete(player.id);
            console.log(`[BOSS COFRE DESCONGELADO] player_${player.id} voltou à arena via portal; cofre restaurado com ${player.xp_boss.toFixed(1)} XP.`);
        } else {
            player.xp_boss = 0;
        }
        player.x = PORTAL_BOSS_DESTINATION.x;
        player.y = PORTAL_BOSS_DESTINATION.y;
        player.vx = 0;
        player.vy = 0;

        const ws = playerSockets.get(player.id);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'force_teleport',
                x: PORTAL_BOSS_DESTINATION.x,
                y: PORTAL_BOSS_DESTINATION.y,
                zona: 'arena_boss'
            }));
        }
    }
}

function broadcastWorldState() {
    broadcast({
        type: 'state_update',
        players: gameState.players,
        enemies: gameState.enemies,
        portal: getPortalSnapshot()
    });
}

function processPortalChannel() {
    const playersInside = getPlayersInsidePortal();

    if (playersInside.length === 0) {
        portalChannelMs = 0;
        return;
    }

    portalChannelMs = Math.min(PORTAL_BOSS_CHANNEL_MS, portalChannelMs + TICK_RATE);
    if (portalChannelMs < PORTAL_BOSS_CHANNEL_MS) return;

    const underLevel = playersInside.filter(player => player.nivel < PORTAL_BOSS_MIN_LEVEL);
    if (underLevel.length > 0) {
        sendPortalFeedback(playersInside, 'Nível insuficiente para entrar na arena.');
        portalChannelMs = 0;
        return;
    }

    teleportGroupToArena(playersInside);
    portalChannelMs = 0;
}

// 1. Gerador de Inimigos (Server-side) — recebe o tipo sorteado (MOBS_TIPOS via sortearTipoMob),
// não mais hp/dano/defesa soltos. nome e xp_multiplicador acompanham o inimigo pro Passo 1c (XP
// por tipo) e 1d (client exibir); xp_multiplicador ainda não é lido em lugar nenhum.
// mob_id (Loot & Inimigos, Passo 4a) é o id da linha em mobs (o TIPO) — não confundir com `id`
// acima, que é o id da INSTÂNCIA no gameState (ex.: "enemy_1"). mob_drops liga por mob_id.
function spawnEnemy(x, y, vx, vy, tipo) {
    const id = `enemy_${nextEnemyId++}`;
    gameState.enemies[id] = {
        id, x, y, vx, vy,
        hp_atual: tipo.vida, hp_max: tipo.vida,
        dano_base: tipo.ataque, defesa_base: tipo.defesa,
        nome: tipo.nome, xp_multiplicador: tipo.xp_multiplicador,
        is_boss: tipo.is_boss,
        mob_id: tipo.mob_id
    };
    return gameState.enemies[id];
}

// Sub-passo C4/D: Controle de Respawn do Boss e Reset da Arena
// Limites de respawn do Boss após derrota (em ms). Valores curtos para teste de campo (produção: 600000 e 900000)
const BOSS_RESPAWN_MIN_MS = 15000; // 15s (produção: 10 * 60 * 1000 = 600000)
const BOSS_RESPAWN_MAX_MS = 25000; // 25s (produção: 15 * 60 * 1000 = 900000)
let bossRespawnAt = null;
const cofresBossCongelados = new Map(); // chave: personagem_id, valor: xp_boss acumulado

function verificarResetArena(idIgnorado = null) {
    const vivosNaArena = Object.values(gameState.players).filter(
        p => p.zona === 'arena_boss' && p.hp_atual > 0 && p.id !== idIgnorado
    );

    if (vivosNaArena.length === 0) {
        // Arena esvaziou!
        const boss = gameState.enemies['boss_principal'];
        if (boss && boss.hp_atual > 0) {
            boss.hp_atual = boss.hp_max;
            boss.damageHistory = {};
            console.log(`[BOSS RESET] Arena esvaziou. Boss resetado com HP 100% (${boss.hp_max}) e damageHistory limpo.`);
            broadcast({
                type: 'combat_event',
                enemyId: boss.id,
                playerId: null,
                enemy_hp: boss.hp_atual,
                player_hp: null
            });
        }

        // Descarta todos os cofres (ativos e congelados) por tentativa fracassada
        if (cofresBossCongelados.size > 0) {
            console.log(`[BOSS RESET] Arena esvaziou: descartando ${cofresBossCongelados.size} cofre(s) congelado(s).`);
            cofresBossCongelados.clear();
        }
        for (const pid in gameState.players) {
            const p = gameState.players[pid];
            if (p.xp_boss > 0) {
                p.xp_boss = 0;
            }
        }
    }
}

// Spawn dedicado do Boss na Arena (P3, Sub-passo C1):
// Entidade persistente em gameState.enemies com is_boss: true, posicionada na arena (4000..6000)
// e descolada do ponto de chegada do portal (5000, 5000) para evitar colisão instantânea no teleporte.
function spawnBoss() {
    const tipoBoss = MOBS_TIPOS.find(t => t.is_boss || t.nome === 'Boss');
    if (!tipoBoss) {
        console.error('[spawnBoss] Tipo de mob Boss não encontrado em MOBS_TIPOS!');
        return null;
    }
    const id = 'boss_principal';
    gameState.enemies[id] = {
        id,
        x: 5000,
        y: 4750,
        vx: 70,
        vy: 70,
        hp_atual: tipoBoss.vida,
        hp_max: tipoBoss.vida,
        dano_base: tipoBoss.ataque,
        defesa_base: tipoBoss.defesa,
        nome: tipoBoss.nome,
        xp_multiplicador: tipoBoss.xp_multiplicador,
        is_boss: true,
        mob_id: tipoBoss.mob_id,
        damageHistory: {}
    };
    console.log(`[BOSS] ${tipoBoss.nome} spawnado na arena em (${gameState.enemies[id].x}, ${gameState.enemies[id].y}) com HP ${tipoBoss.vida}`);
    return gameState.enemies[id];
}

// População inicial: os mesmos 3 primeiros pontos fixos de sempre, com desvio de spawn.
for (let i = 0; i < 3; i++) {
    const p = ENEMY_SPAWN_POINTS[i % ENEMY_SPAWN_POINTS.length];
    const { x, y } = resolveSpawnPosition(p);
    spawnEnemy(x, y, p.vx, p.vy, sortearTipoMob());
}
nextEnemySpawnPoint = 3 % ENEMY_SPAWN_POINTS.length; // respawn contínuo cicla a partir daqui

// Boss persistente na Arena
spawnBoss();

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
                    [invRows] = await pool.query(
                        `SELECT inventario.id, inventario.item_id, inventario.quantidade, inventario.equipado,
                                Itens.nome, Itens.tipo, Itens.bonus_dano, Itens.bonus_defesa, Itens.bonus_hp
                         FROM inventario
                         JOIN Itens ON Itens.id = inventario.item_id
                         WHERE inventario.personagem_id = ?`,
                        [requestedId]
                    );
                } catch (dbErr) {
                    console.error('[join] Erro ao consultar inventário:', dbErr);
                    ws.close(4000, 'Erro ao carregar inventário');
                    return;
                }

                personagemId = requestedId;
                activeSessions.add(personagemId);

                // Retorna ao centro se a posição salva pertence à arena ou ao antigo mapa ampliado.
                const boundsNormal = GAME_ZONES.mapa_normal;
                const posInvalida = row.posicao_x < boundsNormal.minX || row.posicao_x > boundsNormal.maxX ||
                    row.posicao_y < boundsNormal.minY || row.posicao_y > boundsNormal.maxY;
                const spawnX = posInvalida ? 1000 : row.posicao_x;
                const spawnY = posInvalida ? 1000 : row.posicao_y;

                gameState.players[personagemId] = {
                    id: personagemId,
                    nome: row.nome,
                    classe: row.classe,
                    nivel: row.nivel,
                    experiencia: Number(row.experiencia), // mysql2 retorna DECIMAL como string por padrão
                    zona: 'mapa_normal', // Sempre inicia fora da arena
                    x: spawnX,
                    y: spawnY,
                    vx: 0, vy: 0,
                    hp_atual: row.hp_atual,
                    hp_max: 0, dano_base: 0, defesa_base: 0, // recalculado logo abaixo
                    inventario: invRows,
                    inventarioAberto: false,
                    xp_boss: 0
                };
                const player = gameState.players[personagemId];
                playerSockets.set(personagemId, ws);
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
                    state: gameState,
                    xp_proximo_nivel: TABELA_NIVEL.get(player.nivel + 1) ?? null
                }));

                broadcast({ type: 'player_joined', player }, ws);
                return;
            }

            if (personagemId === null) return; // Sem identidade estabelecida, ignora ação

            const player = gameState.players[personagemId];

            if (!player || player.hp_atual <= 0) return; // Mortos não agem

            // MOVIMENTO (com trava autoritária baseada na zona atual do jogador)
            if (data.type === 'player_move') {
                if (player.inventarioAberto) return; // Estático enquanto o inventário está aberto

                // Validação de fronteira autoritária
                const bounds = GAME_ZONES[player.zona] || GAME_ZONES['mapa_normal'];
                player.x = Math.max(bounds.minX, Math.min(data.x, bounds.maxX));
                player.y = Math.max(bounds.minY, Math.min(data.y, bounds.maxY));

                player.vx = data.vx; player.vy = data.vy;
            }
            // AÇÃO: Abrir/fechar o inventário — enquanto aberto, o jogador fica estático e imune
            // (ver guardas em player_move e attack_enemy). Sem timer: dura até o próprio
            // inventory_close, ou até a sessão ser liberada (ver liberarPersonagem/ws.on('close')).
            else if (data.type === 'inventory_open') {
                player.inventarioAberto = true;
            }
            else if (data.type === 'inventory_close') {
                player.inventarioAberto = false;
            }
            // AÇÃO: Equipar/desequipar item do inventário
            else if (data.type === 'equip_item' || data.type === 'unequip_item') {
                // Sub-passo C3: Congelamento de poder — bloqueia alteração de equipamento dentro da arena do Boss
                if (player.zona === 'arena_boss') {
                    console.log(`[EQUIP BLOQUEADO] Jogador ${personagemId} tentou alterar equipamento na arena do boss.`);
                    return;
                }

                const querEquipar = data.type === 'equip_item';
                const item = player.inventario.find(i => i.id === data.inventario_id);

                if (!item) return; // Item não encontrado no inventário deste jogador — ignora
                if (querEquipar && item.tipo !== 'Equipamento') return; // Só Equipamento pode ser equipado

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
                // Inventário aberto (Passo 1): fora de combate por completo — pula o toque inteiro,
                // nem o jogador nem o inimigo tomam dano. Sem isso, o inimigo ainda tomava dano
                // (e podia morrer sozinho batendo no jogador imune) mesmo com o menu aberto.
                if (enemy && !player.inventarioAberto) {
                    // Invulnerabilidade de respawn (Round 1): autoritária aqui, não no client —
                    // concedida no join (ver comentário em `reviveu`) e checada por tempo, sem
                    // precisar de timer/cleanup — expira sozinha quando Date.now() ultrapassa.
                    const invulneravel = !!player.invulneravelAte && Date.now() < player.invulneravelAte;

                    // Servidor calcula o dano deterministicamente
                    const danoNoEnemy = Math.max(1, player.dano_base - enemy.defesa_base);
                    // Dano efetivo: não estoura a vida restante do inimigo (XP não conta overkill).
                    // Calculado ANTES de aplicar o dano, contra o HP que o inimigo tinha até agora.
                    const danoEfetivo = Math.min(danoNoEnemy, enemy.hp_atual);

                    // Sub-passo C2: Memória de dano do Boss por jogador (usado futuramente no abate proporcional)
                    if (enemy.is_boss) {
                        if (!enemy.damageHistory) enemy.damageHistory = {};
                        enemy.damageHistory[player.id] = (enemy.damageHistory[player.id] || 0) + danoEfetivo;
                    }

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

                    // Caminho único de XP (sem pico de abate): todo golpe, inclusive o que mata, dá
                    // dano_efetivo × XP_POR_DANO × xp_multiplicador do TIPO do inimigo atingido
                    // (Loot & Inimigos, Passo 1c — decisão do dono do projeto). enemy.xp_multiplicador
                    // já chega como Number (convertido de DECIMAL no carregarMobsTipos do Passo 1b,
                    // única origem do campo — não há caminho onde ele seja string aqui).
                    const multXP = Number(enemy.xp_multiplicador) || 1;
                    const xp = danoEfetivo * XP_POR_DANO * multXP;
                    if (xp > 0) {
                        if (enemy.is_boss) {
                            // Sub-passo C3: Desvio do XP pro cofre (sem conceder XP real / subir de nível)
                            player.xp_boss = (player.xp_boss || 0) + xp;
                            console.log(`[BOSS XP COFRE] player_${player.id} +${xp.toFixed(1)} XP cofre (total: ${player.xp_boss.toFixed(1)})`);
                        } else {
                            concederXP(player, xp).catch(err => console.error('[XP] Erro ao processar XP/nível:', err));
                        }
                    }

                    if (enemy.hp_atual <= 0) {
                        if (enemy.is_boss) {
                            const damageLog = Object.entries(enemy.damageHistory || {})
                                .map(([pId, dmg]) => `player_${pId}: ${dmg}`)
                                .join(', ');
                            console.log(`[BOSS DAMAGE] ${damageLog || 'nenhum dano registrado'}`);

                            // Sub-passo D: PAGAMENTO DOS COFRES DA VITÓRIA
                            // Paga o cofre individual de cada jogador presente na arena
                            // (inclui quem morreu no mesmo frame no golpe final — regra da vitória simultânea)
                            for (const pId in gameState.players) {
                                const p = gameState.players[pId];
                                if (p.zona === 'arena_boss' && p.xp_boss > 0) {
                                    const xpGanha = Number(p.xp_boss);
                                    p.xp_boss = 0; // Zera imediatamente
                                    const nivelAntes = p.nivel;
                                    await concederXP(p, xpGanha);
                                    console.log(`[BOSS VITÓRIA] player_${p.id} recebeu ${xpGanha.toFixed(1)} XP (nível ${nivelAntes} -> ${p.nivel}).`);
                                }
                            }

                            // Descarta cofres congelados de quem morreu ANTES e não retornou a tempo
                            if (cofresBossCongelados.size > 0) {
                                console.log(`[BOSS VITÓRIA] ${cofresBossCongelados.size} cofre(s) congelado(s) descartado(s) (jogadores ausentes na morte do boss).`);
                                cofresBossCongelados.clear();
                            }

                            // Volta automática ao matar: teleporta todos os jogadores presentes vivos de volta pra base
                            for (const pId in gameState.players) {
                                const p = gameState.players[pId];
                                if (p.zona === 'arena_boss' && p.hp_atual > 0) {
                                    p.x = 1000;
                                    p.y = 1000;
                                    p.zona = 'mapa_normal';
                                    const ws = playerSockets.get(p.id);
                                    if (ws && ws.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({
                                            type: 'force_teleport',
                                            x: 1000,
                                            y: 1000,
                                            zona: 'mapa_normal'
                                        }));
                                    }
                                }
                            }
                            broadcastWorldState();
                            console.log('[BOSS VITÓRIA] Jogadores presentes na arena teleportados de volta para a base (1000, 1000).');

                            // Agendamento de respawn aleatório entre MIN e MAX
                            const respawnDelay = Math.floor(
                                BOSS_RESPAWN_MIN_MS + Math.random() * (BOSS_RESPAWN_MAX_MS - BOSS_RESPAWN_MIN_MS)
                            );
                            bossRespawnAt = Date.now() + respawnDelay;
                            console.log(`[BOSS MORTO] Boss derrotado! Respawn aleatório agendado para daqui a ${(respawnDelay / 1000).toFixed(1)}s.`);
                        }

                        delete gameState.enemies[enemy.id];
                        broadcast({ type: 'enemy_died', enemyId: enemy.id, killerId: player.id });

                        // Loot (Passo 4b): só DECIDE e loga — item não aparece no mapa/coletável
                        // ainda (Passo 5). enemy.mob_id é o id do TIPO (tabela mobs), não confundir
                        // com enemy.id (id da instância, ex. "enemy_1").
                        const dropsObtidos = rolarDrops(enemy.mob_id);
                        if (dropsObtidos.length > 0) {
                            for (const drop of dropsObtidos) {
                                dropIdCounter++;
                                const dropId = `drop_${dropIdCounter}`;
                                const novoItemNoChao = {
                                    id: dropId,
                                    item_id: drop.item_id,
                                    quantidade: drop.quantidade,
                                    nome: CATALOGO_ITENS[drop.item_id]?.nome || 'Item Desconhecido',
                                    // Offset para o item não nascer perfeitamente escondido debaixo do player
                                    x: enemy.x + (Math.random() * 40 - 20),
                                    y: enemy.y + (Math.random() * 40 - 20),
                                    createdAt: Date.now()
                                };
                                gameState.itensNoChao[dropId] = novoItemNoChao;
                                broadcast({ type: 'item_dropped', item: novoItemNoChao });
                                console.log(`[DROP] ${novoItemNoChao.nome} (${dropId}) criado em ${novoItemNoChao.x.toFixed(1)}, ${novoItemNoChao.y.toFixed(1)}`);
                            }
                            const resumo = dropsObtidos.map(d => `item_id=${d.item_id} x${d.quantidade}`).join(', ');
                            console.log(`[LOOT] enemy ${enemy.nome} (mob_id=${enemy.mob_id}) dropou: ${resumo}`);
                        } else {
                            console.log(`[LOOT] enemy ${enemy.nome} (mob_id=${enemy.mob_id}) não dropou nada`);
                        }
                    }
                    // Verifica morte do Jogador
                    if (player.hp_atual <= 0) {
                        const mortoId = player.id;
                        const estavaNaArena = player.zona === 'arena_boss';

                        if (estavaNaArena && player.xp_boss > 0) {
                            // Sub-passo C4: Checa se ainda há outros jogadores vivos na arena
                            const outrosVivos = Object.values(gameState.players).filter(
                                p => p.zona === 'arena_boss' && p.hp_atual > 0 && p.id !== mortoId
                            );

                            if (outrosVivos.length > 0) {
                                // A luta continua: cofre fica congelado aguardando reentrada
                                cofresBossCongelados.set(mortoId, player.xp_boss);
                                console.log(`[BOSS COFRE CONGELADO] player_${mortoId} morreu; ${player.xp_boss.toFixed(1)} XP guardado aguardando reentrada.`);
                            } else {
                                // Era o último na arena: descarta o cofre
                                console.log(`[BOSS XP DESCARTE] player_${mortoId} morreu (último na arena); ${player.xp_boss.toFixed(1)} XP do cofre descartado.`);
                            }
                            player.xp_boss = 0;
                        }

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

                        // Sub-passo C4: Se estava na arena, verifica se ela esvaziou para resetar boss/cofres
                        if (estavaNaArena) {
                            verificarResetArena(mortoId);
                        }
                    }
                }
            }
            // AÇÃO: Coletar Loot no Chão (Passo 5c)
            else if (data.type === 'pickup_item') {
                const dropId = data.dropId;
                const itemNoChao = gameState.itensNoChao[dropId];
                
                // Se o item não existe mais (já foi coletado por outro ou expirou), ignora silenciosamente
                if (!itemNoChao) return; 

                // Remove do chão imediatamente para evitar corrida de coleta multiplayer
                delete gameState.itensNoChao[dropId];
                broadcast({ type: 'item_removed', dropId: dropId, reason: 'collected' });
                
                console.log(`[PICKUP] Jogador ${personagemId} coletou ${itemNoChao.nome} x${itemNoChao.quantidade} (${dropId})`);

                try {
                    // Checa se o jogador já tem o item no inventário
                    const [rows] = await pool.query('SELECT id, quantidade FROM inventario WHERE personagem_id = ? AND item_id = ?', [personagemId, itemNoChao.item_id]);
                    
                    if (rows.length > 0) {
                        // INCREMENTA se já tem
                        const invId = rows[0].id;
                        const novaQuantidade = rows[0].quantidade + itemNoChao.quantidade;
                        await pool.query('UPDATE inventario SET quantidade = ? WHERE id = ?', [novaQuantidade, invId]);
                    } else {
                        // INSERE se não tem
                        await pool.query('INSERT INTO inventario (personagem_id, item_id, quantidade, equipado) VALUES (?, ?, ?, 0)', [personagemId, itemNoChao.item_id, itemNoChao.quantidade]);
                    }

                    // Recarrega o inventário em memória (usando o JOIN com Itens para popular nome/tipo/bônus corretamente)
                    const [invRows] = await pool.query(
                        `SELECT inventario.id, inventario.item_id, inventario.quantidade, inventario.equipado,
                                Itens.nome, Itens.tipo, Itens.bonus_dano, Itens.bonus_defesa, Itens.bonus_hp
                         FROM inventario
                         JOIN Itens ON Itens.id = inventario.item_id
                         WHERE inventario.personagem_id = ?`,
                        [personagemId]
                    );
                    player.inventario = invRows;
                    
                    // Avisa o cliente para atualizar a UI do inventário
                    ws.send(JSON.stringify({ type: 'inventory_update', personagem_id: personagemId, itens: player.inventario }));

                } catch (dbErr) {
                    console.error('[pickup_item] Erro ao persistir coleta de item no banco:', dbErr);
                }
            }
            // AÇÃO: Comando de debug para teleportar para o Boss (Passo 3a)
            else if (data.type === 'debug_tp_boss') {
                // Teleporta de/para a arena e transiciona a zona
                const inArena = player.zona === 'arena_boss';
                const alvoX = inArena ? 1000 : 5000;
                const alvoY = inArena ? 1000 : 5000;

                if (inArena) {
                    // Sub-passo C4: Saindo da arena via tecla T — descarta o cofre
                    if (player.xp_boss > 0) {
                        console.log(`[BOSS XP DESCARTE] player_${player.id} saiu da arena (debug TP); ${player.xp_boss.toFixed(1)} XP do cofre descartado.`);
                    }
                    player.xp_boss = 0;
                    player.x = alvoX;
                    player.y = alvoY;
                    player.zona = 'mapa_normal';
                    verificarResetArena(player.id);
                } else {
                    // Entrando na arena: restaura se tinha congelado, senão nasce 0
                    if (cofresBossCongelados.has(player.id)) {
                        player.xp_boss = cofresBossCongelados.get(player.id);
                        cofresBossCongelados.delete(player.id);
                        console.log(`[BOSS COFRE DESCONGELADO] player_${player.id} voltou à arena (debug TP); cofre restaurado com ${player.xp_boss.toFixed(1)} XP.`);
                    } else {
                        player.xp_boss = 0;
                    }
                    player.x = alvoX;
                    player.y = alvoY;
                    player.zona = 'arena_boss';
                }

                // Força o cliente a se reposicionar
                ws.send(JSON.stringify({ type: 'force_teleport', x: alvoX, y: alvoY, zona: player.zona }));

                // Avisa os outros do novo local imediatamente
                broadcastWorldState();
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
            const estavaNaArena = player && player.zona === 'arena_boss';
            const desconectadoId = personagemId;

            if (player) {
                if (estavaNaArena && player.xp_boss > 0) {
                    player.xp_boss = 0;
                }
                liberarPersonagem(player);
            }
            playerSockets.delete(personagemId);

            broadcast({ type: 'player_left', id: personagemId });

            if (estavaNaArena) {
                verificarResetArena(desconectadoId);
            }
        } else {
            console.log('[-] Conexão encerrada antes de qualquer join (ou já liberada por morte).');
        }
    });
});

// Concede XP a um jogador, processa subida(s) de nível (em loop, cobrindo XP excedente)
// e persiste nível/experiência imediatamente quando há subida. Não bloqueia o tick loop.
// `experiencia` é XP TOTAL acumulado da carreira do personagem (nunca subtraído — table_nivel
// guarda limiares cumulativos, não custo incremental por nível, ver roadmap_game.md).
async function concederXP(player, quantidade) {
    player.experiencia = Number(player.experiencia) + Number(quantidade);

    let subiuNivel = false;
    let proximoCusto = TABELA_NIVEL.get(player.nivel + 1);
    while (proximoCusto !== undefined && player.experiencia >= proximoCusto) {
        player.nivel += 1;
        subiuNivel = true;
        proximoCusto = TABELA_NIVEL.get(player.nivel + 1);
    }

    // Barra de XP (client): broadcast + filtro por personagem_id no client, mesmo padrão de
    // stats_updated/inventory_update — mais simples que carregar `ws` até aqui só pra isso.
    broadcast({
        type: 'xp_update',
        personagem_id: player.id,
        experiencia: player.experiencia,
        nivel: player.nivel,
        xp_proximo_nivel: TABELA_NIVEL.get(player.nivel + 1) ?? null
    });

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
        
        if (e.is_boss) {
            // Quica nas paredes da arena do boss (4000 a 6000px, com margem de 50px).
            if (e.x <= 4050 || e.x >= 5950) e.vx *= -1;
            if (e.y <= 4050 || e.y >= 5950) e.vy *= -1;
        } else {
            // Quica nas paredes do mapa normal (0 a 2000px).
            if (e.x <= 15 || e.x >= 1985) e.vx *= -1;
            if (e.y <= 15 || e.y >= 1985) e.vy *= -1;
        }
    }

    processPortalChannel();
    broadcastWorldState();
}, TICK_RATE);

// ────────────────────────────────────────────────────────
// SNAPSHOT PERIÓDICO (Pacote 2 — grava posição/HP/XP a cada ~10s, sem bloquear o tick de 20Hz)
// `experiencia` entrou aqui junto (novo modelo de XP): com XP de bater, `experiencia` muda a
// cada pancada que não mata, não só em subida de nível — sem isso, XP de bater ficaria exposto
// a perda numa queda não-graciosa do processo entre snapshots.
// ────────────────────────────────────────────────────────
const SNAPSHOT_INTERVAL = 10000;
setInterval(() => {
    for (const id in gameState.players) {
        const p = gameState.players[id];
        pool.query(
            'UPDATE personagens SET posicao_x = ?, posicao_y = ?, hp_atual = ?, experiencia = ? WHERE id = ?',
            [p.x, p.y, p.hp_atual, p.experiencia, p.id]
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
    // Guard auto-corrigente (sem start/stop dinâmico do interval): mapa vazio de jogadores
    // vira no-op no tick, sem estado próprio pra desincronizar dos vários caminhos de
    // entrada/saída (join, morte em attack_enemy, ws.close).
    if (Object.keys(gameState.players).length === 0) return;
    const comunsVivos = Object.values(gameState.enemies).filter(e => !e.is_boss).length;
    if (comunsVivos >= ENEMY_POPULATION_CAP) return;

    const p = ENEMY_SPAWN_POINTS[nextEnemySpawnPoint % ENEMY_SPAWN_POINTS.length];
    nextEnemySpawnPoint++;

    const { x, y } = resolveSpawnPosition(p);
    const enemy = spawnEnemy(x, y, p.vx, p.vy, sortearTipoMob());

    // state_update só atualiza posição de inimigos que o client já conhece, então um inimigo
    // novo precisa de aviso próprio.
    broadcast({ type: 'enemy_spawned', enemy });
}, ENEMY_RESPAWN_INTERVAL);

// ────────────────────────────────────────────────────────
// SWEEP DE ITENS NO CHÃO (Expiração após 45s) E RESPAWN DO BOSS (Sub-passo C4)
// ────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const dropId in gameState.itensNoChao) {
        const item = gameState.itensNoChao[dropId];
        if (now - item.createdAt > 45000) {
            console.log(`[SWEEP] Item ${item.nome} (${dropId}) expirou e foi removido do mapa.`);
            delete gameState.itensNoChao[dropId];
            broadcast({ type: 'item_removed', dropId, reason: 'expired' });
        }
    }

    // Sub-passo C4: Sweep de Respawn do Boss (não mexe nos cofres de XP)
    if (bossRespawnAt && now >= bossRespawnAt) {
        bossRespawnAt = null;
        const novoBoss = spawnBoss();
        if (novoBoss) {
            broadcast({ type: 'enemy_spawned', enemy: novoBoss });
            console.log(`[BOSS RESPAWN] Boss respawnou na arena com HP cheio (${novoBoss.hp_atual}).`);
        }
    }
}, 1000);

function broadcast(data, excludeWs = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) client.send(payload);
    });
}

} // fecha iniciarServidor()