const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

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

// ─────────────────────────────────────────────────────────────────────────────
// CONTAS E AUTENTICAÇÃO (roadmap §7.3 — "Login/contas", antes fora de escopo)
//
// O usuário é a identidade absoluta: todo personagem pertence a uma conta
// (`personagens.jogadores_id`), a listagem só devolve os personagens do dono autenticado, e o
// `join` recusa personagem de outra conta. É isto que fecha a "janela de roubo de personagem"
// registrada no roadmap.
// ─────────────────────────────────────────────────────────────────────────────

const USUARIO_MIN_CHARS = 3;
const USUARIO_MAX_CHARS = 22;
// Mínimo de 4 por decisão do dono do projeto: valor baixo DE PROPÓSITO, para não travar os
// testes de campo. Não é um mínimo de segurança — subir isso é item de endurecimento futuro.
const SENHA_MIN_CHARS = 4;
const SENHA_MAX_CHARS = 72;

// UMA CONTA = UM PERSONAGEM (decisão do dono do projeto). Deixou de ser derivado de CLASSES
// (que dava um teto de 5 e permitia dois guerreiros na mesma conta — medido no banco: a conta
// `dreian` com dois `dreian`/`guerreiro` nível 1, indistinguíveis na tela).
//
// Esta constante é só para a MENSAGEM e para o client montar a tela. Quem IMPÕE a regra é o
// banco, via `uq_personagem_por_conta UNIQUE (jogadores_id)` — por isso o create_character
// não conta nada antes de inserir: a contagem teria janela de corrida (dois pedidos em voo
// passariam os dois), enquanto a constraint recusa o segundo INSERT sempre.
//
// A classe, por consequência, é escolhida UMA vez. Trocar exige `reset_character`, que APAGA
// o personagem; o jogador então escolhe de novo, inclusive a mesma classe — e nesse caso
// nasce um personagem novo de verdade, não o antigo revivido.
const MAX_PERSONAGENS_POR_CONTA = 1;

// Senha NUNCA em texto puro, nem em projeto de teste. `scrypt` é do core do Node (zero
// dependência nova), com salt por usuário e comparação em tempo constante. Formato guardado
// na coluna `jogadores.Senha VARCHAR(255)`: "scrypt$<salt_hex>$<hash_hex>".
const SCRYPT_KEYLEN = 64;
function hashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(senha, salt, SCRYPT_KEYLEN).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verificarSenha(senha, armazenado) {
    // Conta antiga/semeada com senha em texto puro não autentica: formato desconhecido é
    // recusado em vez de cair num caminho de comparação direta.
    const partes = String(armazenado ?? '').split('$');
    if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
    const [, salt, hashEsperado] = partes;
    let candidato;
    try {
        candidato = crypto.scryptSync(senha, salt, SCRYPT_KEYLEN);
    } catch {
        return false;
    }
    const esperado = Buffer.from(hashEsperado, 'hex');
    if (esperado.length !== candidato.length) return false;
    return crypto.timingSafeEqual(candidato, esperado);
}

// Sessões autenticadas em memória. O projeto usa Modelo B (conexão curta e independente por
// ação, ver networkConfig.js), então não existe socket persistente onde pendurar "quem está
// logado" — e aceitar `jogadores_id` vindo do client deixaria qualquer um pedir os personagens
// de outro. O login devolve um token opaco; as ações mandam o token e o servidor resolve o dono.
// Limitação conhecida: o mapa é em memória, então um restart do servidor exige login de novo.
// Fecha de vez quando o Modelo A (socket único / NetworkManager, roadmap §1.2) for implementado.
const sessoesAuth = new Map(); // token -> { jogador_id, usuario }

function criarSessaoAuth(jogador_id, usuario) {
    const token = crypto.randomBytes(24).toString('hex');
    sessoesAuth.set(token, { jogador_id, usuario });
    return token;
}

function resolverSessaoAuth(token) {
    if (typeof token !== 'string') return null;
    return sessoesAuth.get(token) ?? null;
}
// Nível de nascimento. É 1, não 0: a fórmula de atributos usa `nivel - 1` como quantidade de
// buffs, então nível 0 geraria -1 buff e um personagem MAIS FRACO que o molde da classe
// (guerreiro nasceria 90/20/3 em vez de 100/25/5). Além disso `table_nivel` tem nível 1 = 0 XP,
// então `concederXP` promoveria pra 1 no primeiro golpe. "Base/zerado" neste sistema é o 1.
const NIVEL_INICIAL = 1;
// Ponto de nascimento: centro do mapa normal. O default do schema (100,100) fica encostado
// no canto e em cima de um ponto fixo de spawn de inimigo (ENEMY_SPAWN_POINTS).
const SPAWN_INICIAL = { x: 1000, y: 1000 };
// Não existe regra de nome de PERSONAGEM: ele não é digitado. O nome do personagem é o nome
// da CONTA (ver create_character), então quem governa o formato é USUARIO_MIN/MAX_CHARS, no
// cadastro. As antigas NOME_MIN_CHARS/NOME_MAX_CHARS foram removidas junto com o campo de
// texto — se voltarem, é sinal de que alguém reabriu a digitação de nome sem querer.
// (O teto de personagens é por CONTA — ver MAX_PERSONAGENS_POR_CONTA acima.)
const XP_POR_DANO = 0.1; // XP = dano_efetivo × esta constante, pra TODO golpe (sem pico de abate — decisão do dono, comuns)

// Zonas do Jogo e Limites Autoritários (Sub-passo A, Peça 2)
const GAME_ZONES = {
    'mapa_normal': { minX: 0, maxX: 2000, minY: 0, maxY: 2000 },
    'arena_boss':  { minX: 4000, maxX: 6000, minY: 4000, maxY: 6000 }
};

// Guardas autoritárias do golpe (ver golpeAutorizado). Valores de calibração, não contrato:
// ATTACK_MAX_RANGE tem folga sobre o alcance real do client (collider ~40px, ataque manual
// 70px em ExploracaoCombate.js) pra absorver latência e o lerp de posição do inimigo;
// ATTACK_COOLDOWN_MS fica ABAIXO dos 500ms do cooldown local do client, senão o servidor
// recusaria golpe legítimo por jitter de rede. Toda recusa é logada pra permitir calibrar
// em campo sem adivinhar.
const ATTACK_MAX_RANGE = 140;
const ATTACK_COOLDOWN_MS = 400;

// Alcance autoritário da COLETA (ver handler 'pickup_item'). Mesma lógica de folga do
// ATTACK_MAX_RANGE: o overlap real no client acontece a ~40px (corpo do jogador 40x40 contra a
// hitbox 40x40 do item, ver spawnItem em ExploracaoCombate.js), e o teto aqui fica acima disso
// para absorver latência e o lerp de posição — sem permitir coleta do outro lado do mapa.
const PICKUP_MAX_RANGE = 120;

// Comandos de debug (hoje só 'debug_tp_boss') ficam atrás desta trava. O servidor é a autoridade
// do jogo e não deve aceitar atalho de teste vindo de um client qualquer: sem isto, um
// 'debug_tp_boss' cru levava QUALQUER personagem à arena do boss, furando o nível mínimo do
// portal. Desligado por padrão; para teste de campo, DEBUG_COMMANDS=true no server/.env.
const DEBUG_COMMANDS = String(process.env.DEBUG_COMMANDS ?? '').toLowerCase() === 'true';

// Teto do vx/vy que um jogador pode REPORTAR (o client anda a 300px/s por eixo). Não é
// trava de movimento — é só pra um valor absurdo não poluir a lógica de animação dos
// outros clients, que leem esses campos do state_update. Ver player_move.
const MAX_REPORTED_SPEED = 600;

// Decide se o golpe que o client pediu pode acontecer. Até aqui o client era a ÚNICA
// autoridade sobre QUANDO um golpe ocorre (o servidor só calculava QUANTO), e isso abria
// três furos reais:
//  (a) zona — um `attack_enemy` cru com enemyId: 'boss_principal' matava o boss de dentro
//      do mapa normal, furando o nível mínimo do portal (PORTAL_BOSS_MIN_LEVEL) e o
//      congelamento de equipamento da arena (Sub-passo C3);
//  (b) alcance — nada amarrava o golpe à proximidade; dava pra bater em qualquer inimigo
//      do mapa de qualquer lugar;
//  (c) cadência — o cooldown de 500ms vive no client (ExploracaoCombate.js), então um
//      client em loop matava qualquer inimigo instantaneamente.
// Função pura sobre player/enemy (não toca gameState) — mora aqui com as outras regras,
// fora do handler, e muta só o carimbo de cadência do próprio jogador.
function golpeAutorizado(player, enemy) {
    if (enemy.zona !== player.zona) {
        console.log(`[attack_enemy] Recusado (zona) — ${player.id} em ${player.zona} tentou atingir ${enemy.id} em ${enemy.zona}.`);
        return false;
    }

    const distancia = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    if (distancia > ATTACK_MAX_RANGE) {
        console.log(`[attack_enemy] Recusado (alcance) — ${player.id} a ${distancia.toFixed(0)}px de ${enemy.id} (máx ${ATTACK_MAX_RANGE}px).`);
        return false;
    }

    const agora = Date.now();
    if (player.ultimoAtaqueEm && agora - player.ultimoAtaqueEm < ATTACK_COOLDOWN_MS) return false;
    player.ultimoAtaqueEm = agora;

    return true;
}

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
        const requiredSlot = slotEspecialDoItem(item);
        if (requiredSlot !== null && Number(item.slot_index) !== requiredSlot) continue;
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

// Categoria de equipamento do item, vinda da coluna `Itens.slot_categoria` (ver
// db/setup_banco.sql). Item sem categoria cai em 'indefinido' DE PROPÓSITO: 'indefinido' é
// exclusivo consigo mesmo, então esquecer de categorizar um item novo o deixa restritivo demais
// (visível no teste e avisado no boot) em vez de reabrir o empilhamento de bônus em silêncio.
const CATEGORIA_INDEFINIDA = 'indefinido';
function categoriaDoItem(item) {
    const categoria = String(item?.slot_categoria ?? '').trim().toLocaleLowerCase('pt-BR');
    return categoria || CATEGORIA_INDEFINIDA;
}

// Slot dedicado de cada categoria de ARMADURA. Deriva da COLUNA, não do prefixo do nome: antes
// esta função lia 'peitoral'/'capacete'/'calça'/'capuz' do próprio `nome`, então renomear um item
// no banco quebrava o equipamento em silêncio. As categorias de armadura são finas justamente
// para carregarem esta informação (peitoral/capacete/calca/botas, não um 'armadura' genérico).
const SLOT_POR_CATEGORIA = { peitoral: 15, capacete: 16, calca: 17, botas: 18 };

function slotEspecialDoItem(item) {
    return SLOT_POR_CATEGORIA[categoriaDoItem(item)] ?? null;
}

// Peças que precisam SAIR para `itemNovo` entrar: as da MESMA categoria que já estão equipadas.
// É isto que implementa "equipamento NÃO empilha bônus; o bônus é sempre de UMA peça equipada"
// (AGENTS.md §00) para arma, escudo, acessório e munição — categorias que não tinham limite
// nenhum, porque só a armadura possuía slot dedicado. Medido antes da correção: dano 15 -> 25 ->
// 35 com duas armas equipadas ao mesmo tempo, e duas linhas `equipado=1` no banco.
// Armadura não passa por aqui: o slot dedicado (15..18) já garante uma peça por parte do corpo.
function itensConflitantes(player, itemNovo) {
    if (slotEspecialDoItem(itemNovo) !== null) return [];
    const categoria = categoriaDoItem(itemNovo);
    return player.inventario.filter(outro =>
        outro.id !== itemNovo.id && outro.equipado && categoriaDoItem(outro) === categoria
    );
}

function itemCompativelComSlot(item, slotIndex) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 18) return false;
    const slotEspecialItem = slotEspecialDoItem(item);
    if (slotIndex >= 15) return slotEspecialItem === slotIndex;
    return true;
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
    const [rows] = await pool.query('SELECT id, nome, tipo, slot_categoria, bonus_dano, bonus_defesa, bonus_hp FROM Itens');
    for (const r of rows) {
        CATALOGO_ITENS[r.id] = r;
    }
    // Item sem `slot_categoria` cai em 'indefinido' (ver categoriaDoItem) e fica exclusivo com
    // qualquer outro item sem categoria. Melhor gritar no boot do que descobrir em campo que uma
    // peça nova deixou de equipar junto com outra sem motivo aparente.
    const semCategoria = rows.filter(r => !r.slot_categoria).map(r => r.nome);
    if (semCategoria.length > 0) {
        console.warn(`[catalogo] ${semCategoria.length} item(ns) sem slot_categoria (cairão em '${CATEGORIA_INDEFINIDA}'): ${semCategoria.join(', ')}`);
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
    // O socket sai do mapa AQUI, junto com o resto da autoridade, porque este é o único ponto
    // por onde um personagem é liberado — tanto na morte quanto no close. Antes a limpeza morava
    // só no ws.on('close'), e no caminho da MORTE ela nunca era alcançada: `personagemId` já
    // tinha virado null, então o close caía no ramo `else` e a entrada ficava órfã, apontando
    // para um socket fechado (medido: players=0 e activeSessions=0, mas playerSockets=1).
    playerSockets.delete(player.id);
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
        mob_id: tipo.mob_id,
        // Zona do inimigo: antes não existia e a zona do boss era inferida por is_boss/
        // coordenada. Agora é explícita, porque `golpeAutorizado` compara zona de jogador
        // com zona de inimigo (os comuns vivem só no mapa normal — o quique do tick loop
        // os mantém dentro de 0..2000).
        zona: 'mapa_normal'
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
        zona: 'arena_boss', // ver comentário de `zona` em spawnEnemy
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

            // CADASTRO DE CONTA. Usuário é a identidade absoluta do jogador; `jogadores.Nome`
            // tem UNIQUE, então a colisão é barrada pelo banco (ER_DUP_ENTRY) e não por um
            // SELECT prévio — sem janela de corrida entre checar e inserir.
            if (data.type === 'register') {
                const usuario = String(data.usuario ?? '')
                    // eslint-disable-next-line no-control-regex
                    .replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
                const senha = String(data.senha ?? '');

                if (usuario.length < USUARIO_MIN_CHARS || usuario.length > USUARIO_MAX_CHARS) {
                    ws.send(JSON.stringify({ type: 'register_failed', message: `O usuário precisa ter de ${USUARIO_MIN_CHARS} a ${USUARIO_MAX_CHARS} caracteres.` }));
                    return;
                }
                if (senha.length < SENHA_MIN_CHARS || senha.length > SENHA_MAX_CHARS) {
                    ws.send(JSON.stringify({ type: 'register_failed', message: `A senha precisa ter de ${SENHA_MIN_CHARS} a ${SENHA_MAX_CHARS} caracteres.` }));
                    return;
                }

                try {
                    // `email` é NOT NULL no schema e não é usado pra autenticar — sintetiza a
                    // partir do usuário em vez de alterar a coluna (menos invasivo que mexer
                    // no schema da equipe por um campo que o jogo não pede).
                    const [resultado] = await pool.query(
                        'INSERT INTO jogadores (Nome, email, Senha, roles, is_active) VALUES (?, ?, ?, ?, TRUE)',
                        [usuario, `${usuario.toLocaleLowerCase('pt-BR').replace(/\s+/g, '_')}@local`, hashSenha(senha), 'user']
                    );
                    console.log(`[register] Conta criada: ${usuario} (jogadores.id=${resultado.insertId}).`);
                    ws.send(JSON.stringify({ type: 'register_ok', usuario }));
                } catch (dbErr) {
                    if (dbErr.code === 'ER_DUP_ENTRY') {
                        ws.send(JSON.stringify({ type: 'register_failed', message: 'Esse usuário já existe.' }));
                        return;
                    }
                    console.error('[register] Erro ao criar conta:', dbErr);
                    ws.send(JSON.stringify({ type: 'register_failed', message: 'Erro ao criar a conta.' }));
                }
                return;
            }

            // LOGIN. Devolve um token opaco (ver sessoesAuth) que as ações seguintes usam para
            // provar identidade. A mensagem de falha é a MESMA para usuário inexistente e senha
            // errada, de propósito: não confirma quais contas existem.
            if (data.type === 'login') {
                const usuario = String(data.usuario ?? '').trim();
                const senha = String(data.senha ?? '');
                const recusa = { type: 'login_failed', message: 'Usuário ou senha incorretos.' };

                try {
                    const [rows] = await pool.query(
                        'SELECT id, Nome, Senha, is_active FROM jogadores WHERE Nome = ?', [usuario]
                    );
                    if (rows.length === 0 || !verificarSenha(senha, rows[0].Senha)) {
                        console.log(`[login] Recusado para "${usuario}".`);
                        ws.send(JSON.stringify(recusa));
                        return;
                    }
                    if (!rows[0].is_active) {
                        ws.send(JSON.stringify({ type: 'login_failed', message: 'Conta desativada.' }));
                        return;
                    }

                    const token = criarSessaoAuth(rows[0].id, rows[0].Nome);
                    console.log(`[login] ${rows[0].Nome} (jogadores.id=${rows[0].id}) autenticado.`);
                    ws.send(JSON.stringify({
                        type: 'login_ok',
                        token,
                        usuario: rows[0].Nome,
                        max_personagens: MAX_PERSONAGENS_POR_CONTA
                    }));
                } catch (dbErr) {
                    console.error('[login] Erro ao autenticar:', dbErr);
                    ws.send(JSON.stringify({ type: 'login_failed', message: 'Erro ao autenticar.' }));
                }
                return;
            }

            // Listagem de personagens: só os DA CONTA autenticada. O token resolve o dono no
            // servidor — se viesse `jogadores_id` do client, qualquer um pediria a lista de outro.
            if (data.type === 'list_characters') {
                const sessao = resolverSessaoAuth(data.token);
                if (!sessao) {
                    ws.send(JSON.stringify({ type: 'auth_required', message: 'Sessão expirada. Faça login novamente.' }));
                    return;
                }

                let rows;
                try {
                    [rows] = await pool.query(
                        'SELECT id, nome, classe, nivel FROM personagens WHERE jogadores_id = ? ORDER BY id',
                        [sessao.jogador_id]
                    );
                } catch (dbErr) {
                    console.error('[list_characters] Erro ao consultar personagens:', dbErr);
                    ws.send(JSON.stringify({ type: 'character_list', personagens: [] }));
                    return;
                }
                // Personagem em sessão ativa vem MARCADO (`em_sessao`), não omitido.
                //
                // Omitir funcionava quando a conta podia ter 5 personagens: escondia o ocupado
                // e sobrava o caminho de criar outro. Com UM personagem por conta isso virou um
                // beco sem saída — o único personagem ficava invisível, a tela oferecia "criar",
                // e a criação era recusada pela `uq_personagem_por_conta`. O jogador ficava sem
                // nenhuma ação possível e sem explicação.
                //
                // Marcado, o client mostra o personagem e desabilita o JOGAR com o motivo. Quem
                // decide o que fazer com a flag é a tela; o servidor só relata o fato.
                const personagens = rows.map(row => ({
                    id: row.id,
                    nome: row.nome,
                    classe: row.classe,
                    nivel: row.nivel,
                    em_sessao: activeSessions.has(String(row.id))
                }));
                // `classes` acompanha a lista para o client montar os botões de criação sem
                // manter uma segunda cópia dos nomes de classe (CLASSES aqui é a fonte única).
                ws.send(JSON.stringify({
                    type: 'character_list',
                    personagens,
                    classes: Object.keys(CLASSES),
                    usuario: sessao.usuario,
                    max_personagens: MAX_PERSONAGENS_POR_CONTA
                }));
                return;
            }

            // Criação de personagem: nasce BASE (nível 1, XP 0, sem inventário) na classe
            // escolhida. Funciona sem join prévio, igual ao list_characters (Modelo B —
            // conexão curta e independente). É o que destrava co-op real: dois jogadores que
            // querem a mesma classe criam cada um o seu personagem, em vez de disputar a
            // única linha daquela classe.
            if (data.type === 'create_character') {
                const sessao = resolverSessaoAuth(data.token);
                if (!sessao) {
                    ws.send(JSON.stringify({ type: 'auth_required', message: 'Sessão expirada. Faça login novamente.' }));
                    return;
                }

                const classe = String(data.classe ?? '').toLocaleLowerCase('pt-BR');
                const molde = CLASSES[classe];
                if (!molde) {
                    ws.send(JSON.stringify({ type: 'character_create_failed', message: 'Classe inválida.' }));
                    return;
                }

                // Nome do personagem = NOME DA CONTA, sempre (decisão do dono do projeto).
                // Não vem mais do client: `data.nome` é ignorado de propósito. A identidade do
                // jogador é a conta, então os personagens dela todos carregam esse nome e se
                // distinguem por CLASSE e NÍVEL (que a tela de seleção já mostra).
                //
                // Vem de `sessao.usuario`, não de `data`, porque é a única fonte que o client
                // não controla: `sessao` foi resolvida do token contra `jogadores.Nome`. Aceitar
                // um nome do client abriria dois furos — personagem com nome de outra conta
                // (falsa identidade na tela dos outros jogadores) e nome fora do par
                // único/validado que o cadastro garante.
                //
                // Sem validação de tamanho aqui: USUARIO_MIN/MAX_CHARS (3-22) são iguais a
                // NOME_MIN/MAX_CHARS, e o `register` já normalizou e validou o usuário antes de
                // gravar — o valor vem do banco, não da rede. A unicidade é do banco
                // (uq_jogadores_nome), então não existe nome de personagem órfão de conta.
                const nome = sessao.usuario;

                try {
                    // Sem `SELECT COUNT` antes do INSERT: a regra "uma conta = um personagem" é
                    // imposta pela constraint `uq_personagem_por_conta` e lida no catch abaixo.
                    // Contar primeiro seria uma SEGUNDA fonte da mesma regra (§10.6) e ainda por
                    // cima furada — entre a contagem e o INSERT dois pedidos da mesma conta em
                    // voo passariam os dois (a corrida do A01/B01). Deixar o banco recusar é
                    // atômico por construção.
                    //
                    // hp_max/dano_base/defesa_base são as colunas legadas do schema (NOT NULL
                    // sem default, achado A20): preenchidas aqui só pra satisfazer o schema.
                    // O servidor NUNCA as lê — atributo efetivo é sempre recalculado por
                    // recalcularAtributosEfetivos a partir de classe+nível+itens equipados.
                    const [resultado] = await pool.query(
                        `INSERT INTO personagens
                           (jogadores_id, nome, classe, nivel, experiencia, hp_atual, hp_max, dano_base, defesa_base, posicao_x, posicao_y)
                         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
                        [
                            sessao.jogador_id, nome, classe, NIVEL_INICIAL,
                            molde.hp_max, molde.hp_max, molde.dano_base, molde.defesa_base,
                            SPAWN_INICIAL.x, SPAWN_INICIAL.y
                        ]
                    );

                    console.log(`[create_character] Criado personagem ${resultado.insertId} (${nome}, ${classe}, nível ${NIVEL_INICIAL}).`);
                    ws.send(JSON.stringify({
                        type: 'character_created',
                        id: resultado.insertId,
                        nome,
                        classe,
                        nivel: NIVEL_INICIAL
                    }));
                } catch (dbErr) {
                    // ER_DUP_ENTRY aqui só pode ser a `uq_personagem_por_conta`: é a única
                    // constraint única da tabela. Não é erro de infraestrutura, é a REGRA
                    // batendo — então vira mensagem de jogo, não log de erro. Sem esta
                    // tradução o jogador via "Erro ao criar personagem no banco.", que soa
                    // como banco quebrado quando o banco fez exatamente o que devia.
                    if (dbErr.code === 'ER_DUP_ENTRY') {
                        console.log(`[create_character] Recusado — conta ${sessao.jogador_id} já tem personagem.`);
                        ws.send(JSON.stringify({
                            type: 'character_create_failed',
                            message: 'Esta conta já tem um personagem. Use RESETAR para começar de novo com outra classe.'
                        }));
                        return;
                    }
                    console.error('[create_character] Erro ao criar personagem:', dbErr);
                    ws.send(JSON.stringify({ type: 'character_create_failed', message: 'Erro ao criar personagem no banco.' }));
                }
                return;
            }

            // RESET: apaga o personagem da conta e devolve o jogador à escolha de classe.
            //
            // É DELETE, não um UPDATE de zeramento (decisão do dono: "volta na base como se
            // fosse conta recém-criada, nada persiste"). Duas razões técnicas reforçam:
            //   - O `ON DELETE CASCADE` de `inventario` leva os itens junto, então "nada
            //     persiste" é garantia do SCHEMA. Um UPDATE dependeria de alguém lembrar de
            //     zerar cada coluna nova que a tabela ganhar no futuro — e a que esquecessem
            //     vazaria progresso em silêncio.
            //   - A classe volta a ser escolhida, e escolher a MESMA tem que produzir um
            //     personagem novo, não o antigo revivido. Linha nova resolve isso de graça.
            if (data.type === 'reset_character') {
                const sessao = resolverSessaoAuth(data.token);
                if (!sessao) {
                    ws.send(JSON.stringify({ type: 'auth_required', message: 'Sessão expirada. Faça login novamente.' }));
                    return;
                }

                try {
                    const [rows] = await pool.query(
                        'SELECT id, classe, nivel FROM personagens WHERE jogadores_id = ?',
                        [sessao.jogador_id]
                    );
                    if (rows.length === 0) {
                        // Não é erro: a conta já está no estado que o reset produz.
                        ws.send(JSON.stringify({ type: 'character_reset', id: null, apagados: 0 }));
                        return;
                    }

                    const alvo = rows[0];

                    // RECUSA SE ESTÁ EM JOGO. Apagar a linha com o personagem vivo em
                    // `gameState.players` deixaria o `liberarPersonagem` (morte ou close)
                    // rodando um UPDATE contra um id que não existe mais — e, pior, o jogador
                    // seguiria jogando um personagem fantasma até desconectar. A sessão tem que
                    // acabar primeiro; o `activeSessions` é a mesma fonte que o `join` consulta.
                    if (activeSessions.has(String(alvo.id))) {
                        console.log(`[reset_character] Recusado — personagem ${alvo.id} está em sessão ativa.`);
                        ws.send(JSON.stringify({
                            type: 'character_reset_failed',
                            message: 'Este personagem está em jogo. Saia da partida antes de resetar.'
                        }));
                        return;
                    }

                    // `jogadores_id` no WHERE, não só o `id`: o id vem de uma linha que já
                    // pertence à conta autenticada, mas repetir o dono na cláusula é o que
                    // garante que nenhum caminho futuro consiga apagar personagem de terceiro.
                    const [resultado] = await pool.query(
                        'DELETE FROM personagens WHERE id = ? AND jogadores_id = ?',
                        [alvo.id, sessao.jogador_id]
                    );

                    console.log(`[reset_character] Personagem ${alvo.id} (${alvo.classe}, nível ${alvo.nivel}) apagado a pedido da conta ${sessao.jogador_id}.`);
                    ws.send(JSON.stringify({
                        type: 'character_reset',
                        id: alvo.id,
                        apagados: resultado.affectedRows
                    }));
                } catch (dbErr) {
                    console.error('[reset_character] Erro ao resetar:', dbErr);
                    ws.send(JSON.stringify({ type: 'character_reset_failed', message: 'Erro ao resetar o personagem.' }));
                }
                return;
            }

            if (data.type === 'join') {
                // UMA CONEXÃO = UM PERSONAGEM. Sem esta guarda, um segundo 'join' no mesmo socket
                // sobrescrevia 'personagemId' e o primeiro personagem ficava preso para sempre: o
                // ws.on('close') só libera o ÚLTIMO id, então o anterior continuava em
                // 'activeSessions' (omitido da seleção e recusando todo join novo com o código
                // 4000) e em 'gameState.players' (fantasma imóvel no broadcast de 20Hz) até o
                // servidor reiniciar. O client legítimo manda 'join' uma única vez, no onopen — um
                // segundo join é bug ou mensagem crua, então é ignorado SEM derrubar a sessão que
                // já vale.
                if (personagemId !== null) {
                    console.log(`[join] Recusado — esta conexão já está em sessão com o personagem ${personagemId}.`);
                    return;
                }

                const requestedId = String(data.personagem_id);

                // Autenticação ANTES da reserva de sessão: pedido sem token válido não deve nem
                // consumir a trava de `activeSessions`.
                const sessaoAuth = resolverSessaoAuth(data.token);
                if (!sessaoAuth) {
                    console.log(`[join] Recusado — sem sessão autenticada para personagem ${requestedId}.`);
                    ws.close(4001, 'Sessão expirada. Faça login novamente.');
                    return;
                }

                if (activeSessions.has(requestedId)) {
                    console.log(`[join] Recusado — personagem_id ${requestedId} já está em sessão ativa.`);
                    ws.close(4000, 'Personagem já está em uma sessão ativa');
                    return;
                }

                // Reserva SÍNCRONA da sessão: o `has` acima e este `add` precisam acontecer
                // no MESMO turno do event loop. Antes o `add` só vinha depois das queries de
                // personagem e inventário — dois joins simultâneos do mesmo personagem
                // passavam os dois pelo `has` enquanto as queries estavam em voo, criando
                // duas sessões para o mesmo id (auditoria, achado A01).
                activeSessions.add(requestedId);

                // Risco inverso da reserva antecipada: se uma query falhar DEPOIS do `add`,
                // o personagem fica preso como "em uso" até o servidor reiniciar — pior que
                // a corrida original. Todo caminho de recusa devolve a reserva aqui, em um
                // único lugar, em vez de repetir o `delete` em cada `return`.
                const recusarJoin = (motivoSocket) => {
                    activeSessions.delete(requestedId);
                    ws.close(4000, motivoSocket);
                };

                let rows;
                try {
                    [rows] = await pool.query('SELECT * FROM personagens WHERE id = ?', [requestedId]);
                } catch (dbErr) {
                    console.error('[join] Erro ao consultar personagem:', dbErr);
                    recusarJoin('Erro ao carregar personagem');
                    return;
                }

                if (rows.length === 0) {
                    console.log(`[join] Recusado — personagem_id ${requestedId} não encontrado.`);
                    recusarJoin('Personagem não encontrado');
                    return;
                }

                const row = rows[0];

                // POSSE: o personagem tem que ser da conta autenticada. Sem isto, bastava
                // conhecer/adivinhar um `personagem_id` pra entrar com o personagem de outro
                // jogador — é a "janela de roubo de personagem" que o roadmap §7.3 registrava
                // como aberta enquanto não houvesse login.
                if (row.jogadores_id !== sessaoAuth.jogador_id) {
                    console.log(`[join] Recusado — personagem ${requestedId} não pertence a ${sessaoAuth.usuario}.`);
                    recusarJoin('Este personagem não pertence à sua conta');
                    return;
                }

                if (!CLASSES[row.classe]) {
                    console.error(`[join] Classe desconhecida para personagem ${requestedId}: ${row.classe}`);
                    recusarJoin('Classe de personagem inválida');
                    return;
                }

                let invRows;
                try {
                    [invRows] = await pool.query(
                        `SELECT inventario.id, inventario.item_id, inventario.slot_index, inventario.quantidade, inventario.equipado,
                                Itens.nome, Itens.descricao, Itens.tipo, Itens.slot_categoria,
                                Itens.bonus_dano, Itens.bonus_defesa, Itens.bonus_hp
                         FROM inventario
                         JOIN Itens ON Itens.id = inventario.item_id
                         WHERE inventario.personagem_id = ?
                         ORDER BY inventario.id`,
                        [requestedId]
                    );
                } catch (dbErr) {
                    console.error('[join] Erro ao consultar inventário:', dbErr);
                    recusarJoin('Erro ao carregar inventário');
                    return;
                }

                // A reserva em activeSessions já foi feita de forma síncrona lá acima; daqui
                // pra frente a sessão é do socket, e quem a libera é liberarPersonagem()
                // (morte) ou o ws.on('close').
                personagemId = requestedId;

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

                // Validação de TIPO antes da de fronteira (auditoria, achado A14): o clamp
                // sozinho não protege de lixo. `Math.min(undefined, 2000)` é NaN e
                // `Math.max(0, NaN)` segue NaN — a posição NaN entrava no gameState, ia pro
                // broadcast de 20Hz e chegava no snapshot periódico, que gravava NaN em
                // posicao_x/posicao_y. Mensagem malformada agora é descartada inteira.
                const x = Number(data.x);
                const y = Number(data.y);
                const vx = Number(data.vx);
                const vy = Number(data.vy);
                if (!Number.isFinite(x) || !Number.isFinite(y) ||
                    !Number.isFinite(vx) || !Number.isFinite(vy)) return;

                // Validação de fronteira autoritária
                const bounds = GAME_ZONES[player.zona] || GAME_ZONES['mapa_normal'];
                player.x = Math.max(bounds.minX, Math.min(x, bounds.maxX));
                player.y = Math.max(bounds.minY, Math.min(y, bounds.maxY));

                // vx/vy são puramente informativos (o servidor não integra velocidade de
                // jogador — o client é autoritativo sobre a própria posição dentro do clamp
                // acima; validação de teletransporte segue fora de escopo, roadmap §7.3).
                // O clamp existe só pra um valor absurdo não poluir a lógica de animação
                // dos OUTROS clients, que lê esses campos do state_update.
                player.vx = Math.max(-MAX_REPORTED_SPEED, Math.min(vx, MAX_REPORTED_SPEED));
                player.vy = Math.max(-MAX_REPORTED_SPEED, Math.min(vy, MAX_REPORTED_SPEED));
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
                if (querEquipar && slotEspecialDoItem(item) !== null &&
                    Number(item.slot_index) !== slotEspecialDoItem(item)) return;

                // Peças da mesma categoria que vão sair para esta entrar (ver itensConflitantes).
                const conflitos = querEquipar ? itensConflitantes(player, item) : [];

                // Persiste ANTES de mudar o estado em memória (AGENTS.md/auditoria, achado A04):
                // se o UPDATE falhar, a memória e o banco ficavam divergentes — o client via
                // sucesso (bônus aplicado) mas o reconnect carregava o valor antigo do banco.
                try {
                    if (conflitos.length > 0) {
                        // UMA instrução resolve as duas pontas: liga o item pedido e desliga os
                        // concorrentes. Sendo um único UPDATE, é atômico por si — não precisa de
                        // transação, e não existe instante em que as duas peças fiquem equipadas.
                        const idsAfetados = [item.id, ...conflitos.map(c => c.id)];
                        await pool.query(
                            `UPDATE inventario SET equipado = (id = ?)
                              WHERE personagem_id = ? AND id IN (${idsAfetados.map(() => '?').join(',')})`,
                            [item.id, personagemId, ...idsAfetados]
                        );
                        console.log(`[equip_item] ${personagemId}: ${item.nome} entra em '${categoriaDoItem(item)}' e desequipa ${conflitos.map(c => c.nome).join(', ')}.`);
                    } else {
                        await pool.query('UPDATE inventario SET equipado = ? WHERE id = ?', [querEquipar, item.id]);
                    }
                } catch (dbErr) {
                    console.error(`[${data.type}] Erro ao gravar equipado de ${item.id}:`, dbErr);
                    // Não aplica em memória nem recalcula — reenvia o estado real (inalterado)
                    // pro client, pra UI não ficar mostrando um equip que não foi confirmado.
                    ws.send(JSON.stringify({ type: 'inventory_update', personagem_id: personagemId, itens: player.inventario }));
                    return;
                }

                // Rebusca por id em vez de mutar a referência pré-await: se um pickup_item
                // concorrente trocou player.inventario inteiro (nova leitura do banco) enquanto
                // este UPDATE estava em voo, `item` aponta pra um objeto órfão fora do array
                // atual — mutá-lo diretamente perderia a mudança (AGENTS.md/auditoria, achado A04).
                const itemAtual = player.inventario.find(i => i.id === data.inventario_id);
                if (itemAtual) itemAtual.equipado = querEquipar;
                // Mesma rebusca por id para os concorrentes, pelo mesmo motivo acima.
                for (const conflito of conflitos) {
                    const concorrenteAtual = player.inventario.find(i => i.id === conflito.id);
                    if (concorrenteAtual) concorrenteAtual.equipado = false;
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
            else if (data.type === 'swap_inventory_slots') {
                const fromSlot = Number(data.fromSlot);
                const toSlot = Number(data.toSlot);
                if (player.zona === 'arena_boss' || fromSlot === toSlot) return;
                if (!Number.isInteger(fromSlot) || !Number.isInteger(toSlot)) return;

                const sourceItem = player.inventario.find(item => Number(item.slot_index) === fromSlot);
                const targetItem = player.inventario.find(item => Number(item.slot_index) === toSlot);
                if (!sourceItem || !itemCompativelComSlot(sourceItem, toSlot)) return;
                if (targetItem && !itemCompativelComSlot(targetItem, fromSlot)) return;

                const sourceRequiredSlot = slotEspecialDoItem(sourceItem);
                const sourceEquipped = sourceRequiredSlot === null
                    ? Boolean(sourceItem.equipado)
                    : toSlot === sourceRequiredSlot;
                const targetEquipped = targetItem && slotEspecialDoItem(targetItem) !== null
                    ? fromSlot === slotEspecialDoItem(targetItem)
                    : Boolean(targetItem?.equipado);
                let connection;

                try {
                    connection = await pool.getConnection();
                    await connection.beginTransaction();

                    if (targetItem) {
                        const [[row]] = await connection.query(
                            'SELECT COALESCE(MAX(slot_index), 18) + 1 AS temporary_slot FROM inventario WHERE personagem_id = ?',
                            [personagemId]
                        );
                        await connection.execute(
                            'UPDATE inventario SET slot_index = ? WHERE id = ? AND personagem_id = ?',
                            [row.temporary_slot, sourceItem.id, personagemId]
                        );
                        await connection.execute(
                            'UPDATE inventario SET slot_index = ?, equipado = ? WHERE id = ? AND personagem_id = ?',
                            [fromSlot, targetEquipped, targetItem.id, personagemId]
                        );
                    }

                    await connection.execute(
                        'UPDATE inventario SET slot_index = ?, equipado = ? WHERE id = ? AND personagem_id = ?',
                        [toSlot, sourceEquipped, sourceItem.id, personagemId]
                    );
                    await connection.commit();

                    sourceItem.slot_index = toSlot;
                    sourceItem.equipado = sourceEquipped;
                    if (targetItem) {
                        targetItem.slot_index = fromSlot;
                        targetItem.equipado = targetEquipped;
                    }
                    player.inventario.sort((first, second) => first.slot_index - second.slot_index);
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
                } catch (dbErr) {
                    if (connection) await connection.rollback();
                    console.error('[swap_inventory_slots] Erro ao trocar posições:', dbErr);
                } finally {
                    if (connection) connection.release();
                }
            }
            // AÇÃO: Combate (Encostou no Inimigo)
            else if (data.type === 'attack_enemy') {
                const enemy = gameState.enemies[data.enemyId];
                // Guardas autoritárias de zona/alcance/cadência (ver golpeAutorizado). Fica
                // atrás da checagem de inventário aberto de propósito: com o menu aberto o
                // golpe nem acontece, então não deve consumir o cooldown do jogador.
                if (enemy && !player.inventarioAberto && !golpeAutorizado(player, enemy)) return;
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
                        player_hp: player.hp_atual,
                        damage_dealt: danoEfetivo
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
                                    // A zona acompanha o drop porque a coleta compara zona (ver
                                    // 'pickup_item'): drop de boss nasce na arena, comum no mapa normal.
                                    zona: enemy.zona,
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

                // GUARDA AUTORITÁRIA DE ZONA/ALCANCE. O 'pickup_item' era a única ação de mundo sem
                // checagem de posição: um 'dropId' cru coletava qualquer item de qualquer ponto do
                // mapa (confirmado em teste — coleta aceita a 1518px, enquanto o golpe era recusado
                // a 1843px). É o mesmo furo que 'golpeAutorizado' fechou para o ataque, e aqui
                // segue a mesma forma: a zona tem que bater e a distância tem que caber em
                // PICKUP_MAX_RANGE. Toda recusa é logada, para permitir calibrar em campo.
                if (itemNoChao.zona !== player.zona) {
                    console.log(`[pickup_item] Recusado (zona) — ${player.id} em ${player.zona} tentou coletar ${dropId} em ${itemNoChao.zona}.`);
                    return;
                }
                const distanciaDoItem = Math.hypot(player.x - itemNoChao.x, player.y - itemNoChao.y);
                if (distanciaDoItem > PICKUP_MAX_RANGE) {
                    console.log(`[pickup_item] Recusado (alcance) — ${player.id} a ${distanciaDoItem.toFixed(0)}px de ${dropId} (máx ${PICKUP_MAX_RANGE}px).`);
                    return;
                }

                // Remove do chão imediatamente para evitar corrida de coleta multiplayer.
                // O broadcast de remoção só acontece DEPOIS da persistência confirmar (ver try/catch
                // abaixo) — senão o item some pra todo mundo mesmo se o INSERT/UPDATE falhar.
                delete gameState.itensNoChao[dropId];

                console.log(`[PICKUP] Jogador ${personagemId} coletou ${itemNoChao.nome} x${itemNoChao.quantidade} (${dropId})`);

                try {
                    // Incremento atômico: UPDATE ... SET quantidade = quantidade + ? é resolvido
                    // pelo próprio MySQL sem round-trip de leitura, então duas coletas concorrentes
                    // do mesmo item (duas mensagens pickup_item da mesma conexão antes da primeira
                    // terminar) não perdem incremento um do outro — era exatamente o bug do SELECT
                    // + cálculo em JS + UPDATE anterior (AGENTS.md/auditoria, achado A02).
                    const [updateResult] = await pool.query(
                        'UPDATE inventario SET quantidade = quantidade + ? WHERE personagem_id = ? AND item_id = ?',
                        [itemNoChao.quantidade, personagemId, itemNoChao.item_id]
                    );

                    if (updateResult.affectedRows === 0) {
                        // Não tinha o item ainda: precisa de slot livre pra criar a linha nova.
                        const occupiedSlots = new Set(player.inventario.map(item => Number(item.slot_index)));
                        let slotIndex = 0;
                        while (slotIndex < 15 && occupiedSlots.has(slotIndex)) slotIndex++;
                        if (slotIndex >= 15) throw new Error('Mochila sem slots livres para novo item.');
                        await pool.query(
                            'INSERT INTO inventario (personagem_id, item_id, slot_index, quantidade, equipado) VALUES (?, ?, ?, ?, 0)',
                            [personagemId, itemNoChao.item_id, slotIndex, itemNoChao.quantidade]
                        );
                    }

                    // Recarrega o inventário em memória (usando o JOIN com Itens para popular nome/tipo/bônus corretamente)
                    const [invRows] = await pool.query(
                        `SELECT inventario.id, inventario.item_id, inventario.slot_index, inventario.quantidade, inventario.equipado,
                                Itens.nome, Itens.descricao, Itens.tipo, Itens.slot_categoria,
                                Itens.bonus_dano, Itens.bonus_defesa, Itens.bonus_hp
                         FROM inventario
                         JOIN Itens ON Itens.id = inventario.item_id
                         WHERE inventario.personagem_id = ?
                         ORDER BY inventario.id`,
                        [personagemId]
                    );
                    player.inventario = invRows;

                    // Só agora, com a coleta confirmada no banco, o item some pra todo mundo
                    broadcast({ type: 'item_removed', dropId: dropId, reason: 'collected' });

                    // Avisa o cliente para atualizar a UI do inventário
                    ws.send(JSON.stringify({ type: 'inventory_update', personagem_id: personagemId, itens: player.inventario }));

                } catch (dbErr) {
                    console.error('[pickup_item] Erro ao persistir coleta de item no banco:', dbErr);
                    // Persistência falhou: devolve o item ao chão (ninguém viu ele sumir, pois o
                    // broadcast de remoção só acontece depois do banco confirmar) para não perder
                    // o drop de vez. O sweep de expiração (createdAt) continua valendo normalmente.
                    gameState.itensNoChao[dropId] = itemNoChao;
                }
            }
            // AÇÃO: Comando de debug para teleportar para o Boss (Passo 3a)
            else if (data.type === 'debug_tp_boss') {
                // Ferramenta de teste de campo, não funcionalidade de jogo: sem trava, era um
                // atalho livre para a arena. Confirmado em teste: um personagem NÍVEL 1 entrou por
                // aqui e tirou HP do boss, enquanto o portal recusava o MESMO personagem com
                // "Nível insuficiente". Desligado por padrão (ver DEBUG_COMMANDS).
                if (!DEBUG_COMMANDS) {
                    console.log('[debug_tp_boss] Ignorado — comandos de debug desligados (DEBUG_COMMANDS).');
                    return;
                }

                // Teleporta de/para a arena e transiciona a zona
                const inArena = player.zona === 'arena_boss';

                // Mesmo piso de nível do portal, INCLUSIVE com o debug ligado: o atalho pode pular
                // a canalização de 4s (conveniência de teste), nunca a regra de acesso à arena.
                // Sair da arena nunca é barrado — só a entrada.
                if (!inArena && player.nivel < PORTAL_BOSS_MIN_LEVEL) {
                    console.log(`[debug_tp_boss] Recusado — ${player.id} é nível ${player.nivel}, a arena exige ${PORTAL_BOSS_MIN_LEVEL}.`);
                    sendPortalFeedback([player], 'Nível insuficiente para entrar na arena.');
                    return;
                }

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