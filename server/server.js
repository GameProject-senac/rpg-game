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
    const [rows] = await pool.query('SELECT id, nome_inimigo, vida, ataque, defesa, experiencia_dropada, nivel, peso_spawn FROM mobs');
    for (const r of rows) {
        MOBS_TIPOS.push({
            mob_id: r.id,
            nome: r.nome_inimigo,
            vida: r.vida,
            ataque: r.ataque,
            defesa: r.defesa,
            xp_multiplicador: Number(r.experiencia_dropada),
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
    const pesoTotal = MOBS_TIPOS.reduce((soma, tipo) => soma + tipo.peso_spawn, 0);
    let sorteio = Math.random() * pesoTotal;
    for (const tipo of MOBS_TIPOS) {
        sorteio -= tipo.peso_spawn;
        if (sorteio < 0) return tipo;
    }
    return MOBS_TIPOS[MOBS_TIPOS.length - 1];
}

// Todo o bootstrap do servidor espera a tabela de nível e os tipos de mob carregarem antes de
// abrir a porta — `concederXP` depende de `TABELA_NIVEL` e o spawn depende de `MOBS_TIPOS`, e a
// forma mais simples de garantir isso sem checagem espalhada é não aceitar nenhuma conexão até o
// carregamento terminar.
(async () => {
    await carregarTabelaNivel();
    await carregarMobsTipos();
    await carregarMobDrops();

    iniciarServidor();
})();

function iniciarServidor() {
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
const ENEMY_POPULATION_CAP = 7;
let nextEnemySpawnPoint = 0;

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
        mob_id: tipo.mob_id
    };
    return gameState.enemies[id];
}

// População inicial: os mesmos 3 primeiros pontos fixos de sempre, com desvio de spawn.
for (let i = 0; i < 3; i++) {
    const p = ENEMY_SPAWN_POINTS[i % ENEMY_SPAWN_POINTS.length];
    const { x, y } = resolveSpawnPosition(p);
    spawnEnemy(x, y, p.vx, p.vy, sortearTipoMob());
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

                gameState.players[personagemId] = {
                    id: personagemId,
                    nome: row.nome,
                    classe: row.classe,
                    nivel: row.nivel,
                    experiencia: Number(row.experiencia), // mysql2 retorna DECIMAL como string por padrão — sem isso, += vira concatenação (era INT antes da migração, nunca deu problema)
                    x: row.posicao_x,
                    y: row.posicao_y,
                    vx: 0, vy: 0,
                    hp_atual: row.hp_atual,
                    hp_max: 0, dano_base: 0, defesa_base: 0, // recalculado logo abaixo
                    inventario: invRows,
                    inventarioAberto: false
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
                    state: gameState,
                    xp_proximo_nivel: TABELA_NIVEL.get(player.nivel + 1) ?? null
                }));

                broadcast({ type: 'player_joined', player }, ws);
                return;
            }

            if (personagemId === null) return; // Sem identidade estabelecida, ignora ação

            const player = gameState.players[personagemId];

            if (!player || player.hp_atual <= 0) return; // Mortos não agem

            if (data.type === 'player_move') {
                if (player.inventarioAberto) return; // Estático enquanto o inventário está aberto
                player.x = data.x; player.y = data.y;
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
                    if (enemy.hp_atual <= 0) {
                        delete gameState.enemies[enemy.id];
                        broadcast({ type: 'enemy_died', enemyId: enemy.id, killerId: player.id });

                        // Loot (Passo 4b): só DECIDE e loga — item não aparece no mapa/coletável
                        // ainda (Passo 5). enemy.mob_id é o id do TIPO (tabela mobs), não confundir
                        // com enemy.id (id da instância, ex. "enemy_1").
                        const dropsObtidos = rolarDrops(enemy.mob_id);
                        if (dropsObtidos.length > 0) {
                            const resumo = dropsObtidos.map(d => `item_id=${d.item_id} x${d.quantidade}`).join(', ');
                            console.log(`[LOOT] enemy ${enemy.nome} (mob_id=${enemy.mob_id}) dropou: ${resumo}`);
                        } else {
                            console.log(`[LOOT] enemy ${enemy.nome} (mob_id=${enemy.mob_id}) não dropou nada`);
                        }
                    }
                    const xp = danoEfetivo * XP_POR_DANO * enemy.xp_multiplicador;
                    if (xp > 0) {
                        concederXP(player, xp).catch(err => console.error('[XP] Erro ao processar XP/nível:', err));
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
// `experiencia` é XP TOTAL acumulado da carreira do personagem (nunca subtraído — table_nivel
// guarda limiares cumulativos, não custo incremental por nível, ver roadmap_game.md).
async function concederXP(player, quantidade) {
    player.experiencia += quantidade;

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
    if (Object.keys(gameState.enemies).length >= ENEMY_POPULATION_CAP) return;

    const p = ENEMY_SPAWN_POINTS[nextEnemySpawnPoint % ENEMY_SPAWN_POINTS.length];
    nextEnemySpawnPoint++;

    const { x, y } = resolveSpawnPosition(p);
    const enemy = spawnEnemy(x, y, p.vx, p.vy, sortearTipoMob());

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

} // fecha iniciarServidor()
