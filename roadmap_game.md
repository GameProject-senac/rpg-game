# roadmap_game.md — Documentação Única do Projeto (Roadmap, Especificação e Histórico de Execução)

> **Documento único.** Este arquivo incorpora integralmente o que antes vivia em `fase2_spec.md` (especificação de execução da Fase 2, agora §9, histórico) e `fase2finalizacao.md` (achados de teste de campo e fechamento da Fase 2, agora §3 · FASE 2 §2.8-§2.11). Os dois arquivos separados foram descontinuados em 2026-07-26 para garantir uma fonte única de verdade documental — nenhuma informação foi descartada na fusão, só reorganizada. Referências a "fase2_spec.md §X" em comentários de código (`UIScene.js`, `ExploracaoCombate.js`, `server/server.js`) continuam válidas: a numeração interna da especificação original foi preservada no §9.

**Status Atualizado (2026-09-06):**
A **Fase 1 (Multiplayer LAN & WebSockets)** e a **Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão)** estão **formalmente concluídas e validadas em teste de campo manual** (2026-07-26). A Fase 2 foi executada em 5 pacotes sequenciais especificados em §9 (histórico), todos implementados, testados e documentados (ver §2.3-§2.7), e em seguida passou por dois rounds de correção pós-teste-de-campo (§2.8-§2.10) até fechar por completo (§2.11). Após o fechamento da Fase 2, o **Round 3 (Inventário Clicável, pós-Fase 2)** também foi concluído e validado em teste de campo (2026-07-26) — ver §2.12. Numa sessão de migração de banco conduzida pelo dono do projeto fora deste documento, a **Fase A** trocou o banco local pelo schema oficial da equipe — **`jogo_pi`** (`db/setup_banco.sql`, A1, substitui o antigo `rpg_game`/`server/schema.sql`) — em três passos: A1 (schema novo), A2 (levantamento de quebras: spawn de inimigos sobrepostos e inventário quebrado contra o schema novo) e A3 (adaptação do inventário, §2.14). **A Fase A está fechada e validada em campo (2026-07-31)** — spawn corrigido (§2.13), inventário funcionando (§2.14), e o objeto `ITENS` hardcoded (órfão desde a A3) foi removido de `server/server.js`. Em 2026-07-31 foi implementado um primeiro novo modelo de XP/nível (§2.15, histórico — superado abaixo): XP por dano causado sem matar, XP de morte mantido em 50 fixo, subida de nível lendo `table_nivel`. Em **2026-08-02**, por decisão do dono, o **modelo de XP dos inimigos comuns foi ajustado** (§2.16): o pico de abate de 50 XP saiu — todo golpe, inclusive o que mata, concede `dano_efetivo × 0.1` (caminho único); `personagens.experiencia` migrou de `INT` para `DECIMAL(12,2)`; barra de progresso de XP entrou na UI; e um bug de `NaN` causado pela migração (mysql2 devolve `DECIMAL` como string) foi encontrado e corrigido. **Implementado e validado em campo (2026-08-02).** Em **2026-08-03**, o **Bloco Loot & Inimigos** foi iniciado: o **Passo 1 (inimigos vêm da tabela `mobs`, não mais hardcoded)** foi concluído em 4 sub-passos (1a-1d, ver §2.17) — tabela `mobs` populada com 4 tipos de teste, spawn sorteando tipo aleatório, XP ponderado por multiplicador do tipo, e cor/nome por tipo no client. **Implementado e validado em campo (2026-08-03).** Em **2026-08-13**, o **Passo 2 (Elite raro/forte)** foi concluído em 3 sub-passos (2a-2c, ver §2.18) — `mobs` ganhou a coluna `peso_spawn` e o 5º tipo `Elite`, o sorteio de spawn deixou de ser uniforme e passou a ser ponderado por esse peso, e o client ganhou a cor roxa do Elite. **Implementado, dono testou com peso do Elite inflado temporariamente e confirmou.** Em **2026-08-25**, o **Passo 4 (loot/drop de item ao morrer — decisão + log, sem coleta visual)** foi concluído em 2 sub-passos (4a-4b, ver §2.19) — o inimigo passou a carregar `mob_id` (id do tipo na tabela `mobs`, distinto do id de instância), a tabela `mob_drops` foi populada com 6 linhas de teste, e o servidor passou a decidir (rolar chance + quantidade) e logar o que cada inimigo dropa na morte, sem ainda dar destino visual ao item. **Implementado e validado por checagem de código/banco (2026-08-25).** O **Passo 5 (coleta de loot no mapa: item no chão, pickup, INSERT/incremento no inventário, timer de expiração 45s)** foi **IMPLEMENTADO e VALIDADO em campo (2026-09-06)** — item cai, jogador coleta e vai para o inventário (confirmado por SELECT no banco). Com isso, o Bloco Loot & Inimigos está completo do P1 ao P5.
**Foco Atual (Estado de parada):** O Bloco Loot & Inimigos (Passos 1 ao 5) está **100% completo e validado**. O Passo 5 fechou o loop visual e de persistência da coleta. *Pendência cosmética conhecida:* a UI do inventário ainda não exibe a quantidade (x2/x3) das cópias coletadas — o banco grava corretamente o incremento, mas a renderização na UI foi adiada de propósito para quando o inventário for refeito com os ícones do Godot. Próxima sessão: **P3 (boss principal + dungeons)**.

**Origem:** Documento mestre de especificação técnica e roadmap operacional para desenvolvimento solo do *Project Post-Apoc RPG / Horizon Co-op*. Este arquivo serve como contexto técnico e guia de execução contínua para qualquer agente de IA ou sessão de desenvolvimento.

> **Papel deste documento (reorganização de 2026-09-06):** este arquivo é o **registro histórico** — o que foi feito, quando, por quê, e o que falta (roadmap/pendências). As **regras vigentes** que um agente novo precisa seguir HOJE (armadilhas conhecidas, método de trabalho, mapa do repositório, regras de arquitetura) moram no `AGENTS.md` — comece por lá, não por aqui. As seções abaixo (principalmente §1 e §9) registram decisões tomadas em datas específicas com o contexto da época; onde uma decisão virou regra permanente, ela também foi destilada no `AGENTS.md` (ex.: recálculo de atributos, XP por dano, DECIMAL do mysql2) — este documento não foi reescrito para removê-las porque são o registro de *quando e por que* cada uma nasceu, não uma cópia solta.

---

## 1. Decisões Estruturais e de Arquitetura

1. **Desacoplamento Absoluto (Phaser vs. Regra de Negócio):**
O Phaser 4.1.0 atua puramente na camada de apresentação (Canvas/WebGL, rendering de sprites, animações, inputs e câmeras). Nenhuma regra de inventário, atributos de classe, cálculo de dano ou persistência reside dentro de Sprites ou Containers.
2. **Autoridade do Servidor e Sincronização LAN:**
A autoridade sobre a posição de inimigos, HP dos alvos e estado da partida pertence ao servidor Node.js. O cliente envia intenções de comando (`player_move`, `attack_enemy`, `equip_item`/`unequip_item`) e realiza interpolação visual (*lerp*) para suavizar a renderização dos outros jogadores.
3. **Persistência Relacional com MySQL:**
O MySQL é a fonte da verdade para dados persistentes (contas, personagens, atributos base, inventário e histórico). Transições entre cenas persistem no `registry` em memória temporária do Phaser e salvam assincronamente no MySQL.
4. **Arquitetura Baseada em Eventos (EventBus):**
Comunicação interna entre a UI do jogo e os módulos de domínio ocorre via EventBus global desacoplado (`this.game.events`, nativo do Phaser — implementado no Pacote 4 entre `ExploracaoCombate`/`UIScene`). Toda troca de cena exige a desmontagem explícita de *listeners*, cancelamento de *tweens* e *timers* para zerar riscos de *memory leaks*.

### 1.1 Decisões Travadas da Fase 2 (registro formal — §9, Pacote 5 §5.1, ex-fase2_spec.md)

Decisões deliberadas e fechadas durante a Fase 2 (Pacotes 1-4), registradas aqui formalmente por exigência do Pacote 5 e da Regra 6 do `AGENTS.md` (nunca alterar contrato sem atualizar a documentação):

* **Canal único WebSocket.** Toda comunicação client↔servidor passa pelo WebSocket existente (`ws`, porta 8080). Sem API REST, sem Redis — ambos avaliados como evolução futura de escala, fora do escopo atual.
* **Servidor autoritário sobre toda regra de jogo.** Atributos, dano, XP, nível, inventário e posição validada vivem e são calculados no servidor Node.js. O client envia intenções e renderiza respostas.
* **Modelo de recálculo de atributos.** `hp_max`/`dano_base`/`defesa_base` nunca são persistidos na tabela `personagens`. São sempre derivados em memória no `join`, na subida de nível e ao equipar/desequipar item, pela fórmula `base_da_classe(nivel) + soma_dos_itens_equipados` (`calcularAtributosEfetivos` + `recalcularAtributosEfetivos` em `server/server.js`). Garante fonte única de verdade e rebalanceamento retroativo.
* **Molde de classe hardcoded.** Atributos-base por classe (`CLASSES`) continuam como constante no código do servidor — uma tabela `classes` no banco segue como evolução futura, fora do escopo. *(Atualizado pela A3, ver §2.14: o catálogo de itens deixou de ser hardcoded — migrou para a tabela `Itens` no banco `jogo_pi`, decisão A1/A3. O objeto `ITENS` hardcoded original ficou órfão e foi **removido** de `server.js` em 2026-07-30 — ver §2.14. Resíduo corrigido 2026-08-03: este parágrafo antes descrevia o objeto como "aguardando limpeza futura", desatualizado desde a remoção. Para o padrão equivalente atual — constante hardcoded que virou dado de banco, órfã ainda não removida — ver `ENEMY_HP/ENEMY_DANO/ENEMY_DEFESA` em §2.17 e §7.2.)*
* **Persistência assíncrona e escalonada.** Eventos críticos (subida de nível, coleta de item, equipar/desequipar) gravam imediatamente. Posição, HP e experiência gravam por snapshot periódico (~10s, `server/server.js`) e obrigatoriamente no `disconnect`. *(`experiencia` entrou no snapshot periódico em 2026-07-31, junto do novo modelo de XP — ver §2.15; antes só gravava na subida de nível.)*
* **Itens formalmente adiados (não implementar sem nova autorização):** login/autenticação, tabela `classes`, tabela `itens_instanciados_mapa` (loot de equipamento no mapa nunca foi implementado — coleta de moeda foi removida por completo no Round 2, ver §1.3), Redis/cache, anti-cheat de validação de posição.

### 1.2 Decisões da Correção do Teste de Campo (pós-Fase 2, Round 1)

* **Modelo de posse dos personagens: pool compartilhado sem dono.** Sem login, não existe "personagem pertence ao jogador X". A cena `SelecaoPersonagem` lista **todos** os personagens do banco (`list_characters`/`character_list`), sem filtro por `jogadores_id`; qualquer jogador pode escolher qualquer um que não esteja `em_uso` (marcado via a trava de sessão já existente do Pacote 1). A trava de sessão em memória continua sendo a única garantia de "um personagem, um controlador por vez" — dois jogadores em LAN simplesmente escolhem personagens diferentes da lista. **Quando o login for implementado**, este modelo muda: a listagem passa a filtrar por `jogadores_id` (coluna já existente em `personagens`) e cada jogador só vê os próprios personagens. Essa migração pertence ao trabalho de login, não a este momento.
* **O que o login destrava de graça (lista viva, não fechada):** (1) seleção filtrada por dono em vez de pool aberto; (2) posse real de personagem em vez de "quem chegar primeiro"; (3) a janela de ~300ms entre `player_died` e o reconecte automático em que o personagem fica tecnicamente livre no pool (`liberarPersonagem`, ver correção da corrida de sessão abaixo) deixa de ser uma questão — num mundo com login, ninguém mais está olhando a lista de seleção do teu personagem pra "roubá-lo" nessa janela.
* **Correção de corrida — liberação de sessão acoplada à morte, não ao close do socket.** O teste de campo revelou que `activeSessions`/`gameState.players` só eram liberados no `ws.on('close')`, que é assíncrono e mais lento que o `join` automático do reconecte pós-morte — o servidor via o `personagem_id` ainda "em sessão ativa" e recusava o reconecte (`close(4000)`), reabrindo o modo zumbi por uma causa nova. Corrigido com `liberarPersonagem(player)` (`server/server.js`): função síncrona (remove de `gameState.players`/`activeSessions` antes de qualquer `await`; a gravação no banco roda em background) chamada tanto na morte (`attack_enemy`, antes de zerar a variável de sessão da conexão) quanto no `close` do socket — reaproveita o guard `personagemId !== null` já existente em vez de criar uma flag nova, então a conexão que já morreu vira no-op automático no seu próprio `close` eventual.
* **Modelo de conexão: B agora, A é o alvo.** Modelo B = socket por cena (cada cena que precisa de rede abre e fecha o próprio `WebSocket`; `SelecaoPersonagem` e `ExploracaoCombate` têm sockets independentes, sem estado compartilhado entre si). Modelo A = socket único, dono do jogo, vivendo entre cenas — necessário para features futuras de acampamento social (chat, comércio, party) que exigem conexão viva fora do combate. `networkConfig.js` (`SERVER_URL` + `sendMessage`) foi extraído agora para que a migração para A não exija caçar endereço/formato de mensagem espalhados pelas cenas — isso não é o `NetworkManager` da migração, só a preparação mínima. **Ordem acordada:** Modelo B agora → corrigir a dívida técnica de `playerStats`/`scene.restart()` → passar no teste de campo → só então migrar para A, como pacote próprio, sobre terreno estável.

### 1.3 Decisões do Round 2 e do Fechamento da Fase 2 (registro formal — ex-fase2finalizacao.md §10.5/§10.6/§11)

* **Invulnerabilidade de respawn é evento, não estado do banco.** A concessão de imunidade pós-morte passou a depender de um sinal transitório em memória (`respawnPendente`, `Set` server-side por `personagem_id`), populado no instante da morte e consumido uma única vez no próximo `join`. Curar HP continua ligado a `hp_atual <= 0` no banco (cobre corrupção residual de sessões antigas), mas conceder invulnerabilidade não depende mais desse valor — evita invencibilidade permanente para personagens com HP negativo persistido de testes anteriores.
* **Knockback e respawn usam flags de imunidade separadas.** `this.player.invulnerable` (knockback) trava movimento e o collider de ataque de propósito; reaproveitá-la para o respawn travava o jogador em cima do inimigo por 3s. `this.player.respawnShield` é a flag dedicada do respawn — imune a dano, mas livre para se mover e revidar, espelhando o comportamento autoritário do servidor ("pode revidar, só não pode ser ferido").
* **Moeda/pontuação removidas do jogo — eram ilusórias, não uma feature madura sendo descartada.** `player.score` no servidor nunca era lido em lugar nenhum (campo morto desde sempre); o contador "DADOS COLETADOS" do client era puramente local e zerava no F5, nunca sincronizava com o servidor. Manter um placar que engana é pior que não ter placar. `pickup_item`, `spawnMoedas`, `itemsGroup`/`itemData` e o `INSERT INTO inventario ... tipo='Recurso'` associado foram removidos por inteiro (servidor e client) — não só o placar, o mecanismo inteiro. **"Coletar moeda pra pontuar" está fora do design do jogo.** O que entra no futuro é coletar **itens importantes** (loot com peso — armas, materiais), que nasce junto do inventário clicável, não como um placar de pontos.
* **Renderização de itens filtra por inclusão (`tipo='Equipamento'`), não só por exclusão de `'Recurso'` (atualizado no Round 3, ver §2.12).** A defesa em profundidade original (Round 2) pulava explicitamente `tipo='Recurso'`; o Round 3 reforçou isso trocando para inclusão explícita — `UIScene.renderInventory` só desenha o que é `tipo='Equipamento'`, então `'Recurso'` e qualquer tipo futuro não-equipável ficam de fora por construção, não por uma exclusão pontual.
* **Inventário clicável nunca existiu de verdade até o Round 2 — lacuna original, fechada no Round 3.** O Pacote 4 validou o backend por script (`test_pacote4.js`); o client, até o Round 2, tinha só a fila de slots (§2.2), sem abrir/clicar/agir de verdade. Essa lacuna foi registrada como trabalho futuro ao final do Round 2 e fechada no Round 3 (pós-Fase 2, ver §2.12) — não era, e nunca foi, uma regressão do Round 2.
* **Coleta de equipamento no mapa nunca existiu — continua fora de escopo.** Os dois equipamentos de teste (`espada_enferrujada`, `escudo_improvisado`) foram inseridos manualmente via SQL (`test_pacote4.js`, mesmo padrão do Pacote 1), nunca coletados em jogo. Não faz parte do que foi removido junto da moeda. O Round 3 (§2.12) construiu o inventário clicável sobre esses mesmos itens de teste, mas não endereçou a coleta em si — loot de equipamento no mapa continua feature nova a construir do zero, agora desacoplada do inventário clicável (que já está pronto).

---

## 2. Schema do Banco de Dados Relacional (MySQL 8.0+)

> **Histórico — este bloco descrevia o rascunho de design original (pré-Pacote 1); o SQL desse rascunho foi removido desta seção em 2026-09-06 (reorganização de documentação) por estar duplicado com a versão antiga do `AGENTS.md` §07 e desatualizado há várias migrações.** O schema efetivamente aplicado é o da equipe técnica, banco `jogo_pi`, com 14 tabelas (`jogadores`, `Itens`, `mobs`, `skills`, `table_nivel`, `personagens`, `map`, `skill_levels`, `class_skills`, `skill_tree`, `personagem_skills`, `inventario`, `map_items`, `mob_drops`) — **fonte única de verdade em `db/setup_banco.sql`** (migração A1, 2026-07-30; ver também `AGENTS.md` §07). Principais divergências do rascunho antigo, mantidas aqui só como registro histórico do que mudou: `inventario.item_id` é `INT` (FK pra `Itens.id`), não `VARCHAR`; a coluna `tipo` saiu de `inventario` e mora em `Itens.tipo` (com `bonus_dano/bonus_defesa/bonus_hp` junto); `itens_instanciados_mapa` do rascunho virou `map_items` no schema real (ainda não usada em código — loot de mapa continua adiado, §7.3); `jogadores` real tem colunas bem diferentes (`Nome/email/Senha/roles/is_active/created_at/current_map_id`, não `username/senha_hash`); `personagens.experiencia` real é `DECIMAL(12,2)` desde 2026-08-02 (era `INT`, ver §2.16); `mobs.experiencia_dropada` real é `DECIMAL(4,2)` desde 2026-08-03 (era `INT`, ver §2.17), e a tabela `mobs` — vazia até então — está populada com tipos de teste e é lida pelo servidor no boot (inimigos não são mais hardcoded). Para o schema atual, sempre consultar `db/setup_banco.sql` diretamente — não um snapshot aqui, que desatualiza a cada mudança.

---

## 3. Roadmap Detalhado por Fases de Desenvolvimento

```
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 0: Fundação & FSM Local (CONCLUÍDA)                                │
│ Cenas Phaser, Mundo 2000x2000, Combate Locais, Safe Spawn               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 1: Sincronização Multiplayer LAN & WebSockets (CONCLUÍDA)          │
│ Node.js Server, Handshake, Broadcast de Movimento, Combat Sync         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 2: Persistência MySQL, Identidade & Progressão (CONCLUÍDA)         │
│ Seleção de Personagem, XP/Nível, Inventário server-side c/ Atributos   │
│ Dinâmicos ao Equipar (UI clicável concluída pós-Fase 2 no Round 3)     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 3: Level Design Avançado, Tilemaps & Spatial Partitioning         │
│ Camadas Z-Index no Tiled, Spatial Culling, Colisões de Cenário          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 4: Standalone Build, Polimento de UI/UX, Audio & Dist (Godot)     │
│ Standalone Godot/Electron export, SFX/BGM, Performance Benchmark       │
└────────────────────────────────────────────────────────────────────────┘

```

---

### FASE 0: Fundação de Cenas, FSM e Combate Local (Status: ✅ Concluída)

* [x] **FSM de Cenas Completa:** Transições entre `Boot`, `Preload`, `MainMenu`, `Loading`, `HubCentral` e `ExploracaoCombate`.
* [x] **Gestão do Mundo:** Configuração do mapa $2000 \times 2000$ px com limites físicos (`setBounds`) e câmera com `startFollow` direto (sem lerp fracionário — corrigido no Round 2 por causar tremida vertical, ver §2.9), `roundPixels` mantido.
* [x] **Combate Local Determinístico:** Mitigação de dano ($\text{Dano Efetivo} = \max(1, \text{Dano} - \text{Defesa})$), barras de HP dinâmicas sobre os inimigos e cálculo de morte.
* [x] **Spawn Seguro de Loot:** Validação de células transitáveis no Tilemap para queda de itens em áreas válidas.

---

### FASE 1: Sincronização Multiplayer LAN & Servidor WebSockets (Status: ✅ Concluída)

#### 1.1 Objetivos Técnicos

* ✅ **Node.js Server:** Aplicação backend (`server.js`) criada utilizando o pacote `ws`.
* ✅ **Protocolo de Rede:** Estabelecido protocolo JSON operando num *Tick Rate* de 20Hz (50ms).
* ✅ **Servidor Autoritário:** Sincronização perfeita de posições (com *Lerp* no client), cálculo determinístico de combate e coleta/respawn de loot centralizados no servidor.

#### 1.2 Protocolo de Comunicação em Rede (Payload Real — nomes canônicos, reconciliados no Pacote 5)

> Esta seção foi reescrita no Pacote 5 (`fase2_spec.md` §5.1.2) pra refletir exatamente o que o código faz, não uma especificação aspiracional anterior à implementação. Os nomes/campos aqui SÃO os nomes/campos do código — não o inverso. Alguns conceitos da versão anterior desta tabela (token de autenticação, `habilidade_id`/sistema de skills, `critico`, `timestamp` por mensagem) nunca foram implementados e foram removidos da documentação por não corresponderem a nada real; login/autenticação continua formalmente adiado (`fase2_spec.md` §1).

* **Conexão e Entrada na Sala:**
* Client → Server (`join`): `{ personagem_id }`
* Server → Client que entrou (`welcome`): `{ id, state }` — `state` é o `gameState` completo (jogadores, inimigos, itens)
* Server → Demais Clients (`player_joined`): `{ player }` — objeto completo do jogador que entrou (inclui `inventario`)
* Server → Clients (`player_left`): `{ id }`

* **Transmissão de Movimento (Client throttled a ~20Hz desde o Pacote 3 / Tick Rate do servidor: 20Hz / 50ms):**
* Client → Server (`player_move`): `{ x, y, vx, vy }`
* Server → Clients, broadcast a cada tick (`state_update`): `{ players, enemies }` — não existe mensagem individual por jogador

* **Sincronização de Combate:**
* Client → Server (`attack_enemy`): `{ enemyId }` — combate é por toque/overlap, não há sistema de habilidades/direção
* Server → Clients (`combat_event`): `{ enemyId, playerId, enemy_hp, player_hp }`
* Server → Clients (`enemy_died`): `{ enemyId, killerId }`
* Server → Clients (`player_died`): `{ playerId }`

* **Coleta de Loot:** removida por inteiro no Round 2 (ver §1.3) — `pickup_item`, `item_despawned` e `items_respawned` não existem mais no código (nem servidor, nem client). Não há mensagem de protocolo para coleta de loot no estado atual; "coletar itens" volta a existir só quando o loot de equipamento no mapa for construído (trabalho futuro, §1.3/§7).

* **Progressão (Pacote 2):**
* Server → Client (`level_up`): `{ personagem_id, nivel, hp_max, dano_base, defesa_base, hp_atual }`

* **Inventário (Pacote 4):**
* Client → Server (`equip_item` / `unequip_item`): `{ inventario_id }`
* Server → Client (`inventory_update`): `{ personagem_id, itens }`
* Server → Client (`stats_updated`): `{ personagem_id, hp_max, dano_base, defesa_base, hp_atual }`

* **Tela de Inventário (Round 3, pós-Fase 2 — ver §2.12):**
* Client → Server (`inventory_open` / `inventory_close`): sem payload — marca/desmarca `player.inventarioAberto` (booleano em memória, sem expiração por tempo). Enquanto `true`, o servidor ignora `player_move` desse jogador e pula o bloco inteiro de dano em `attack_enemy` (nem o jogador nem o inimigo tomam dano no toque). Sem mensagem de confirmação do servidor — é fire-and-forget; a tela do client abre/fecha otimisticamente, mas a autoridade real (estático/fora de combate) não depende disso.



---

### FASE 2: Sistema de Inventário, Equipamentos & Persistência Relacional (Status: ✅ Concluída e fechada em teste de campo — Pacotes 1-5/5 + Rounds 1-2)

> Esta fase foi executada em 5 pacotes sequenciais, especificados em detalhe em §9 (histórico, ex-`fase2_spec.md`). O registro de execução de cada pacote concluído é mantido em §2.3-§2.7 abaixo. Os pacotes passaram nos critérios automatizados, mas o teste de campo manual (obrigatório para fechar qualquer fase que toque o client — ver §2.8) revelou falhas funcionais não capturadas por script; essas correções, em dois rounds, estão registradas em §2.8-§2.10. O estado final consolidado está em §2.11.

#### 2.1 Objetivos Técnicos

* Implementar a camada de domínio `InventoryManager.js` totalmente desacoplada da interface.
* Criar a interface de inventário em grid de slots no Phaser via UI Scene paralela (`UIScene`).
* Integrar alteração dinâmica de atributos do personagem ao equipar/desequipar itens.

#### 2.2 Fluxo de Atualização de Atributos ao Equipar Item

> Reescrito no Pacote 5. A versão anterior deste fluxograma foi escrita antes do fechamento da Fase 2 e descrevia gravar `dano_base`/`defesa_base` direto na tabela `personagens` ao equipar — isso contradiz o modelo de recálculo travado em `fase2_spec.md` §1/§4.5 (atributos efetivos são sempre derivados em memória, nunca persistidos) e nunca foi implementado dessa forma. O fluxo abaixo é o que o Pacote 4 realmente construiu.

```
[Jogador clica no slot na UIScene]
         │
         ▼
[UIScene emite 'inventory_action' no EventBus — não valida nada, só decide equip_item/unequip_item pelo estado já exibido]
         │
         ▼
[ExploracaoCombate repassa a mensagem pro socket]
         │
         ▼
[Servidor recebe equip_item/unequip_item]
         │
         ├─► Encontra o item em player.inventario (dono implícito — array já é escopado ao jogador da conexão)
         ├─► Se não encontrado → ignora silenciosamente
         ├─► Se for equip_item e item.tipo !== 'Equipamento' → recusa silenciosamente (tipo vem do JOIN com `Itens`, ver §2.14)
         │   (pendência registrada: sem feedback ao client — ver observações do Pacote 4)
         ├─► Atualiza estado interno: item.equipado = true/false
         ├─► Persiste na hora: UPDATE inventario SET equipado = ? WHERE id = ?
         ├─► recalcularAtributosEfetivos(player):
         │     base = calcularAtributosEfetivos(classe, nivel)
         │     bonus = soma dos bonus_hp/bonus_dano/bonus_defesa dos itens com equipado=true
         │     hp_max/dano_base/defesa_base = base + bonus (SÓ em memória — nunca grava em `personagens`)
         │
         └─► Envia ao client: 'inventory_update' + 'stats_updated' ──> [UIScene redesenha via EventBus]
```

#### 2.3 Registro de Execução — Pacote 1: Identidade de Personagem e Trilho de Leitura do Banco (Status: ✅ Concluído)

**O que foi feito:**

* Schema mínimo (`jogadores`, `personagens`) aplicado no MySQL 8.0 local, no schema dedicado `rpg_game` — arquivo `server/schema.sql`.
* 5 personagens de teste populados (um por classe), com os valores arbitrários exatos definidos em `fase2_spec.md` §1.5 — arquivo `server/seed_teste.sql`.
* Usuário de banco dedicado (`rpg_app`) criado com privilégios mínimos (`SELECT/INSERT/UPDATE/DELETE` apenas em `rpg_game`) — nenhuma credencial de root usada em runtime.
* Credenciais de conexão isoladas em `server/.env` (git-ignorado), com `server/.env.example` versionado como referência, usando `dotenv` (dependência já existente, antes não utilizada).
* Pool `mysql2/promise` plugado em `server/server.js`.
* Objeto `CLASSES` (molde hardcoded de nascimento por classe) e constantes `BUFF_HP`/`BUFF_DANO`/`BUFF_DEFESA` implementados exatamente conforme `fase2_spec.md` §1.6/1.7.
* Handshake `join` (`{ type: 'join', personagem_id }`) substituindo a criação automática de jogador por conexão (`player_N`, posição `1000,1000`, HP fixo). O servidor agora só materializa um jogador em `gameState.players` após validar o `personagem_id` contra o MySQL.
* `gameState.players` re-chaveado por `personagem_id` (antes era chaveado pelo id efêmero da conexão).
* Trava de sessão em memória (`Set` de `personagem_id`s ativos), populada no `join` e liberada no `close`. Duplicata é recusada com fechamento controlado do socket (`ws.close(4000, motivo)`).
* Personagem inexistente no banco também é recusado da mesma forma, sem criar nenhuma linha nova.
* Ações de jogo (`player_move`, `pickup_item`, `attack_enemy`) chegando antes de um `join` bem-sucedido são ignoradas silenciosamente (comportamento conservador para caso não especificado na spec).
* Script de teste dedicado `server/test_join.js` (cliente WebSocket cru, **não faz parte do jogo**) para validar o handshake sem depender do client Phaser.

**Resultado dos testes (critério obrigatório de `fase2_spec.md` §1.11 — todos os 6 itens passaram):**

| # | Critério | Resultado |
|---|---|---|
| 1 | Carregamento real (mago id=2) | ✅ Entrou com `x=100,y=100`, `hp=60/60` do banco — não mais `1000,1000`/HP 100 hardcoded |
| 2 | Nível 1 = semente pura | ✅ `hp_max=60, dano_base=40, defesa_base=3` — idêntico ao molde da classe (buff zero) |
| 3 | Buff aplicado (nível 3, testado manualmente) | ✅ `hp_max=80 (60+2×10), dano_base=50 (40+2×5), defesa_base=7 (3+2×2)` |
| 4 | Trava de sessão | ✅ Segunda conexão com o mesmo `personagem_id` é recusada (`code 4000`) |
| 5 | Personagem inexistente (id=999) | ✅ Recusado (`code 4000`), nenhuma linha criada no banco |
| 6 | Sem escrita | ✅ Confirmado via `SELECT` — as 5 linhas de teste permanecem exatamente como inseridas |

**Observações registradas (não implementadas — fora do escopo do Pacote 1):**

* O client Phaser (`ExploracaoCombate.js`) ainda **não envia** `join` — decisão do responsável pelo projeto foi manter a validação restrita a um cliente de teste dedicado neste pacote, deixando o jogo real inoperante até a fase de seleção de personagem existir. Nenhuma alteração foi feita no client.
* ~~Divergências de nomenclatura de protocolo entre este roadmap e o código (`player_join`/`join`, `pickup_item_request`/`pickup_item`, `player_attack`/`attack_enemy`) permanecem registradas e sem ação — reconciliação é escopo do **Pacote 5**.~~ **Reconciliado no Pacote 5** — ver §1.2 acima, reescrita com os nomes/campos reais do código como fonte canônica.

**Próximo passo (histórico):** Pacote 2, então em aberto — ver registro de execução abaixo, agora concluído.

#### 2.4 Registro de Execução — Pacote 2: Persistência de Volta e Sistema de Progressão (XP/Nível) (Status: ✅ Concluído)

**O que foi feito:**

* Ambiente MySQL provisionado do zero nesta máquina (instalação nova do MySQL 8.0.46): banco `rpg_game` criado, `server/schema.sql` aplicado, `server/seed_teste.sql` populado, usuário `rpg_app` recriado com privilégios mínimos (`SELECT/INSERT/UPDATE/DELETE` apenas em `rpg_game`), `server/.env` recriado localmente (git-ignorado).
* Função `calcularAtributosEfetivos(classe, nivel)` extraída como helper compartilhado (elimina duplicação da fórmula de buff entre o `join` do Pacote 1 e a subida de nível do Pacote 2 — mesma fórmula, um único lugar).
* Constante `XP_POR_INIMIGO = 50` (confirmado com o responsável pelo projeto antes da implementação, conforme pendência registrada no Apêndice A da spec).
* Função `concederXP(player, quantidade)`: incrementa `experiencia`, sobe nível em loop (`while experiencia >= nivel*100`) cobrindo XP excedente de múltiplos limiares num único ganho, recalcula atributos efetivos em memória, grava `nivel`/`experiencia` no banco imediatamente e emite broadcast `level_up` com o payload exato da spec (`personagem_id, nivel, hp_max, dano_base, defesa_base, hp_atual`). Chamada de forma não bloqueante (fire-and-forget com `.catch`) a partir do evento `enemy_died`, para não travar o tick de 20Hz.
* Snapshot periódico: `setInterval` dedicado a cada 10s, percorre `gameState.players` e grava `posicao_x, posicao_y, hp_atual` via `UPDATE`, com queries disparadas sem `await` bloqueante (erros apenas logados).
* Save no disconnect: handler `ws.on('close', ...)` tornado assíncrono; antes de remover o jogador do `gameState`/trava de sessão, grava `posicao_x, posicao_y, hp_atual, nivel, experiencia` via `UPDATE`.
* Script de teste dedicado `server/test_pacote2.js` (cliente WebSocket cru, **não faz parte do jogo**): conecta, dá `join`, move o personagem, ataca os inimigos disponíveis em sequência (gerando dano/XP/mortes/level-up) e fecha a conexão após um intervalo configurável — usado para validar todos os critérios sem depender do client Phaser (que ainda não envia `join`).

**Resultado dos testes (critério obrigatório de `fase2_spec.md` §2.6 — todos os 6 itens passaram):**

| # | Critério | Resultado |
|---|---|---|
| 1 | Persistência de posição (snapshot ~10s) | ✅ Validado isoladamente: personagem movido, conexão mantida aberta e confirmada viva via `kill -0` no instante t=11s; `SELECT` no banco já retornava `posicao_x=400, posicao_y=400` **antes** de qualquer disconnect |
| 2 | Persistência de HP | ✅ Mago sofreu dano em combate; `hp_atual` refletido corretamente no banco após o disconnect (mesma query do snapshot cobre `hp_atual`) |
| 3 | Ganho de XP | ✅ Cada `enemy_died` incrementou `experiencia` do `killerId` em 50, confirmado via `SELECT` |
| 4 | Subida de nível | ✅ Mago (id=2) nível 1→2 ao atingir 100 XP (2 kills): `hp_max` 60→70, `dano_base` 40→45, `defesa_base` 3→5 (`base + 2×buff`), broadcast `level_up` emitido, atributos em memória aplicados imediatamente (3º ataque já usou `dano_base=45`), `nivel`/`experiencia` gravados no banco na hora |
| 5 | Save no disconnect | ✅ Mago desconectado 5s após o 3º kill (bem antes do snapshot de 10s); banco refletiu exatamente `nivel=2, experiencia=50, hp_atual=-8, posicao_x=400, posicao_y=400` — só poderia ter vindo do save no `close` |
| 6 | Não-bloqueio | ✅ Sequência de combate (mensagens a cada 500ms) e tick de 20Hz seguiram sem travamentos perceptíveis durante toda a bateria de testes |

**Observações registradas (não implementadas — fora do escopo do Pacote 2):**

* Sem mecânica de respawn/cura pós-morte do jogador — `player_died` já existia desde a Fase 0/1 e não foi endereçado aqui (fora de escopo; a spec não descreve esse comportamento para a Fase 2).
* `hp_atual` negativo é persistido literalmente (sem clamp em zero) — comportamento pré-existente do cálculo de combate, não uma regressão introduzida neste pacote.
* Dados de teste do banco (`personagens` id 1 e 2) ficaram com posição/HP/nível alterados pelos testes reais executados (não são mais os valores originais do seed) — states refletem o funcionamento real da persistência, não foram resetados.
* Client Phaser (`ExploracaoCombate.js`) continua sem enviar `join` — mesma pendência registrada no Pacote 1, permanece fora de escopo até a fase de seleção de personagem.

**Próximo passo (histórico):** Pacote 3, então em aberto — ver registro de execução abaixo, agora concluído.

#### 2.5 Registro de Execução — Pacote 3: Correção de Bugs de Constituição (Higiene de Rede e Loop) (Status: ✅ Concluído)

**O que foi feito (`ExploracaoCombate.js`):**

* `this.moveSendAccumulator` (acumulador de tempo) e `this.movePayload` (objeto de payload reutilizável, criado uma única vez em `create()`) adicionados ao estado da cena.
* `update()` mudado para `update(time, delta)`, usando o `delta` real do Phaser em vez de rodar sem noção de tempo decorrido.
* Envio de `player_move` throttled: acumula `delta` e só envia quando o acumulador atinge `MOVE_SEND_INTERVAL_MS = 50` (subtraindo o intervalo do acumulador, não zerando, para não perder precisão ao longo do tempo) — de ~60 mensagens/s para no máximo ~20/s, alinhado ao tick do servidor.
* Eliminada a alocação de objeto literal por frame: o payload é mutado (`movePayload.x/y/vx/vy`) em vez de recriado; `JSON.stringify` só roda no momento do envio já throttled (permitido pela spec).
* Nenhuma mudança na lógica de interpolação, combate, renderização de HP ou no `onmessage` (fora de escopo, confirmado).

**Resultado dos testes (critério obrigatório de `fase2_spec.md` §3.4 — todos os 3 itens passaram):**

| # | Critério | Resultado |
|---|---|---|
| 1 | Frequência de envio (≤~20 msgs/s) | ✅ Medido ao vivo no navegador real do responsável pelo projeto: client conectou com `join` real (tanque de teste, id=5), personagem carregado via `welcome` real, movimento real por 10s cronometrados via `setTimeout` — resultado exato: **20.0 msgs/s, 200 mensagens em 10s** |
| 2 | Suavidade preservada | ✅ Confirmado por análise de código (não testado visualmente com dois clients simultâneos): tick do servidor (`state_update`) já era fixo a 20Hz antes do Pacote 3, e a interpolação do receptor (lerp 0.15) não foi alterada — a granularidade real das posições vistas por outros jogadores já era limitada pelo servidor, não pelo client |
| 3 | Zero alocação no loop | ✅ Confirmado por inspeção: `movePayload` criado uma única vez em `create()`, apenas mutado no caminho de envio; nenhum `{}`/`[]`/lambda novo dentro de `update()` nesse caminho |

**Observações registradas:**

* A medição do critério 1 exigiu que o client real enviasse `join` manualmente via DevTools (o client Phaser ainda não envia `join` sozinho — mesma pendência dos Pacotes 1/2, permanece fora de escopo). Nenhuma mudança de código foi feita para isso: usou-se o socket já existente da cena em runtime, através do próprio console do navegador, não injeção de estado (`playerStats`) nem alteração de arquivo.
* Para viabilizar o teste, `window.__game = game` foi adicionado temporariamente a `main.js` e removido logo depois de validado — o arquivo final não contém esse hook.
* Personagem tanque de teste (id=5) deixou de estar intocado: a sessão real de teste (com Pacote 2 já ativo) persistiu posição/HP reais dele via snapshot/disconnect.

**Próximo passo (histórico):** Pacote 4, então em aberto — ver registro de execução abaixo, agora concluído.

#### 2.6 Registro de Execução — Pacote 4: Sistema de Inventário (Status: ✅ Concluído)

**Decisões confirmadas antes da implementação (fora do que a spec já travava):**

* Nomes de mensagem `equip_item`/`unequip_item` confirmados exatamente como no §4.4.
* Catálogo de itens (não especificado na spec — decisão nova): `espada_enferrujada { bonus_dano: 10 }` e `escudo_improvisado { bonus_defesa: 5, bonus_hp: 20 }`, ambos `tipo: 'Equipamento'`. Valores arbitrários de teste, não balanceamento.
* Modelo de recálculo confirmado: atributo efetivo = `base_da_classe + buff(nivel) + soma_dos_itens_equipados`, sempre em memória, nunca gravado em `personagens.dano_base/defesa_base/hp_max`.
* Itens de tipo diferente de `'Equipamento'` (ex.: `'Recurso'`) são recusados silenciosamente se o client tentar `equip_item` neles.
* Equipamento de teste inserido direto no banco via SQL (padrão do Pacote 1), sem criar fluxo de obtenção de equipamento pelo mapa.

**O que foi feito:**

* Tabela `inventario` aplicada (`server/schema.sql`), idêntica ao §4.3.
* `server/server.js`: catálogo `ITENS`, `calcularBonusEquipados()`, e `recalcularAtributosEfetivos()` — função única que combina `calcularAtributosEfetivos` (classe+nível) com a soma dos itens equipados; usada no `join`, na subida de nível (`concederXP`, que antes só considerava classe+nível — corrigido para não perder bônus de equipamento ao subir de nível) e no equipar/desequipar.
* `join` agora também carrega `inventario` do personagem do banco.
* `pickup_item` grava uma linha em `inventario` (`tipo='Recurso'`) a cada coleta de moeda, além de manter o `score` existente inalterado.
* Handlers `equip_item`/`unequip_item`: validam posse (item precisa estar no inventário do próprio jogador) e tipo (`'Equipamento'` obrigatório para equipar), persistem `equipado` na hora (evento crítico), recalculam atributos em memória e respondem com `inventory_update` + `stats_updated`.
* `UIScene.js` (nova cena Phaser paralela): grid de slots clique-equipar, ouve `inventory_update`/`stats_updated` via `this.game.events` (EventBus global do Phaser) e emite `inventory_action` no clique — nunca calcula atributos nem decide validade de equipar.
* `ExploracaoCombate.js`: lança/para `UIScene`, repassa `inventory_update`/`stats_updated` recebidos do servidor pro EventBus, e encaminha `inventory_action` da UI pro socket.
* `server/test_pacote4.js` (novo script de teste, não faz parte do jogo).

**Resultado dos testes (critério de `fase2_spec.md` §4.6 + item extra aprovado pelo responsável do projeto — todos os 6 itens passaram):**

| # | Critério | Resultado |
|---|---|---|
| 1 | Coleta persiste | ✅ Coletou moeda via `pickup_item` real, `SELECT` no banco confirmou a linha nova (`id=5, item_id='moeda', tipo='Recurso'`) |
| 2 | Equipar altera atributos | ✅ Arqueiro (id=3) base `dano_base=35` → `45` ao equipar `espada_enferrujada` (+10), calculado pelo servidor |
| 3 | Autoridade do servidor | ✅ Por inspeção de código: `UIScene`/`ExploracaoCombate` nunca calculam atributos localmente, só espelham `stats_updated` |
| 4 | Desacoplamento | ✅ Por inspeção de código: `UIScene` só desenha e emite intenção de clique; toda regra de inventário vive no servidor |
| 5 | Persistência de equipado | ✅ Desconectado com 2 itens equipados, reconectado: `welcome` já veio com `equipado=true` nos dois e atributos corretos, confirmado também via `SELECT` |
| 6 | **(Novo)** Soma simultânea de dois itens | ✅ Personagem: **Arqueiro Teste (id=3)**, base nível 1 `hp_max=70, dano_base=35, defesa_base=3`. Equipando espada + escudo juntos: `hp_max=90 (70+20), dano_base=45 (35+10), defesa_base=8 (3+5)` — soma corretamente sobre a base de classe+nível |

**Pendência de reconciliação registrada para o Pacote 5 (conforme instrução do responsável do projeto):**

* O fluxograma "Fluxo de Atualização de Atributos ao Equipar Item" no §2.2 deste roadmap está desatualizado: ele descreve gravar `dano_base`/`defesa_base` diretamente na tabela `personagens` ao equipar, o que contradiz o modelo de recálculo travado em `fase2_spec.md` §1/§4.5 (atributos sempre derivados em memória, nunca persistidos). Esse fluxograma é resquício de uma versão anterior ao fechamento da Fase 2 e precisa ser reescrito no Pacote 5 para refletir o que foi realmente implementado (`recalcularAtributosEfetivos`).
* ~~O servidor emite `level_up` mas `ExploracaoCombate.js` não tinha handler.~~ **Resolvido fora do Pacote 5** (ver nota abaixo — o responsável do projeto reclassificou isso como funcionalidade incompleta do Pacote 2, não higiene de código, e pediu correção imediata).
* **Nova pendência — `equip_item`/`unequip_item` recusados são silenciosos.** Quando o servidor recusa um pedido de equipar (item não encontrado, ou `tipo !== 'Equipamento'`), ele simplesmente ignora a mensagem — nenhum aviso volta pro client. Mesma família de problema do `level_up` órfão: o servidor sabe de algo (o pedido foi negado) que o client nunca fica sabendo, então o jogador clica no slot e nada visivelmente acontece. Diferente do `level_up`, este NÃO tem contrato de rede definido em `fase2_spec.md` — resolver requer inventar um novo tipo de mensagem (ex.: `action_denied` ou `equip_rejected`), o que está fora do escopo travado do Pacote 5 (§5.1, que é só refatoração + reconciliação de documentação, não features novas). Registrado aqui para decisão explícita do responsável do projeto sobre quando/como endereçar — meu encaminhamento sugerido é: reusar o mesmo padrão de notificação já usado por `stats_updated`/`level_up` (uma mensagem servidor→client dedicada, consumida via o mesmo canal de EventBus), mas o contrato exato (nome, payload) precisa de aprovação antes de eu implementar.
* Mesma pendência de sempre: client Phaser não envia `join` sozinho.

**Correção aplicada fora do Pacote 5 (a pedido do responsável do projeto, antes de iniciar o Pacote 5):** `ExploracaoCombate.js` ganhou um handler mínimo para `level_up` — atualiza `playerStats` (nivel/hp_max/dano_base/defesa_base/hp_atual) e emite `stats_updated` no `game.events`, reusando exatamente o canal que a `UIScene` já ouvia desde o Pacote 4. Sem efeito visual elaborado (nenhum toast/popup), conforme escopo mínimo pedido. Não testado ao vivo no navegador nesta sessão — validado por inspeção de código, já que reusa literalmente o mesmo padrão do handler `stats_updated` (já testado no Pacote 4).

**Próximo passo (histórico):** Pacote 5, então em aberto — ver registro de execução abaixo, agora concluído. **Fase 2 completa.**

#### 2.7 Registro de Execução — Pacote 5: Higiene de Código e Reconciliação da Documentação (Status: ✅ Concluído)

**O que foi feito:**

* **Correção pré-Pacote 5 (a pedido explícito do responsável do projeto, reclassificada como funcionalidade incompleta do Pacote 2, não higiene):** handler `level_up` implementado em `ExploracaoCombate.js`.
* **Refatoração do `onmessage`** (§5.1.1): a cadeia `if/else` por `data.type` em `ExploracaoCombate.js` foi substituída por um mapa `this.messageHandlers` (tipo → método) montado uma vez em `initMultiplayer()`, com `onmessage` reduzido a um lookup + chamada. Cada branch virou um método de instância (`handleWelcome`, `handlePlayerJoined`, `handlePlayerLeft`, `handleItemDespawned`, `handleItemsRespawned`, `handleCombatEvent`, `handleEnemyDied`, `handlePlayerDied`, `handleLevelUp`, `handleInventoryUpdate`, `handleStatsUpdated`, `handleStateUpdate`), com o corpo de cada um mantido 1:1 idêntico ao código anterior — refatoração puramente estrutural, sem mudança de comportamento (§5.2, "não reescrever sistemas que já passaram nos testes só por estética" respeitado: nada foi reescrito, só reorganizado).
* **Reconciliação de nomenclatura** (§5.1.2): `roadmap_game.md` §1.2 (protocolo de rede da Fase 1) estava desatualizado desde antes da Fase 2 — descrevia mensagens que nunca foram implementadas (`player_join`, `player_spawned`, `player_updated`, `player_attack` com `habilidade_id`/`direcao`, `pickup_item_request`, sistema de crítico, token de auth). Reescrito para refletir exatamente os nomes/campos reais do código (`join`, `welcome`, `player_joined`, `state_update`, `attack_enemy`, `pickup_item`, etc.) — **o código tratado como fonte canônica**, não o documento antigo, conforme decisão de não reescrever sistemas já testados só por estética. Uma outra menção obsoleta (`use_skill`, `item_pickup`) em §1 também foi corrigida para os nomes reais.
* **Decisões da Fase 2 registradas formalmente** (§5.1.2, segunda parte): nova seção §1.1 "Decisões Travadas da Fase 2" no roadmap — WebSocket-only, modelo de recálculo de atributos, molde de classe/catálogo de itens hardcoded, persistência escalonada, e lista de itens formalmente adiados (login, tabela `classes`, `itens_instanciados_mapa`, Redis, anti-cheat de posição).
* **Fluxograma §2.2 reescrito** para refletir o fluxo real implementado no Pacote 4 (`UIScene` → EventBus → socket → servidor → `recalcularAtributosEfetivos` → `inventory_update`/`stats_updated`), substituindo a versão antiga que descrevia gravar atributos direto em `personagens`.
* Esta spec (`fase2_spec.md`) incorporada ao roadmap oficial como registro da Fase 2 (§5.1.3) — os registros de execução §2.3-§2.7 desta seção cumprem esse papel.

**Resultado dos testes (critério obrigatório de `fase2_spec.md` §5.3 — os 2 itens passaram):**

| # | Critério | Resultado |
|---|---|---|
| 1 | Paridade funcional pós-refatoração | ✅ Reexecutados ao vivo: Pacote 1 (`test_join.js`, guerreiro id=1 — carregamento real confirmado), Pacote 2 (`test_pacote2.js`, guerreiro id=1 — 2 kills → 100 XP → nível 2, `hp_max=110, dano_base=30, defesa_base=7`, exatamente igual ao comportamento pré-refatoração), Pacote 4 (`test_pacote4.js`, arqueiro id=3, inventário resetado pra estado limpo — recusa de item Recurso, soma simultânea `hp_max=90/dano_base=45/defesa_base=8`, persistência no reconnect, todos idênticos ao resultado original). A refatoração do Pacote 5 é só client-side (`ExploracaoCombate.js`); o servidor não foi alterado, então esses testes também confirmam que nada no servidor regrediu |
| 2 | Documentação consistente | ✅ `roadmap_game.md` §1.2 reescrita com nomes reais; pendência de nomenclatura marcada como resolvida; decisões da Fase 2 registradas em §1.1; fluxograma §2.2 reescrito |

**Observações registradas (não implementadas — fora do escopo do Pacote 5):**

* O handler client-side refatorado (`onmessage`/`messageHandlers`) não foi validado ao vivo no navegador nesta sessão — a extração de cada branch pra método foi mecânica (corpo idêntico, só movido), verificada por inspeção de código e checagem de sintaxe. Testar no navegador continua disponível a pedido.
* **Pendência ainda aberta, não resolvida neste pacote:** feedback de `equip_item`/`unequip_item` recusado — ver observação registrada no Pacote 4 (§2.6). Precisa de um contrato de rede novo, fora do escopo travado do Pacote 5, aguardando decisão do responsável do projeto.
* Mesma pendência de sempre: client Phaser não envia `join` sozinho.

**Próximo passo (histórico):** Pacotes 1-5 formalmente concluídos e documentados — mas a validação por script/inspeção de código não é o critério de fechamento do projeto (ver §2.8). O teste de campo manual do dono do projeto veio a seguir e revelou falhas funcionais graves; ver §2.8-§2.11 para o que aconteceu depois e o estado final real.

#### 2.8 Por que os testes automatizados não pegaram os bugs do teste de campo (registro de método, ex-fase2finalizacao.md §0)

Os scripts de teste (`test_pacote2.js`, `test_pacote4.js`) rodam pelo **lado do servidor**, simulando um client via WebSocket. Eles validam corretamente o comportamento do servidor: identidade, persistência, cálculo de atributos, XP, inventário. O que eles **não** exercitam: o `messageHandlers` do client (Pacote 5), a renderização (barras de HP, grid de inventário, linha de stats), o ciclo de vida real de cena do Phaser (`scene.restart()`, shutdown, recriação), e interação de input humano. O Pacote 5 tinha sido aprovado com o critério "paridade funcional pós-refatoração" validado **apenas por inspeção de código** — uma meia-validação explicitamente reconhecida na época, e foi exatamente essa lacuna que o teste de campo expôs.

**Conclusão de método, válida daqui pra frente:** refatoração ou feature de client não pode ser validada só por script de servidor. Toda alteração no client exige teste manual no navegador antes de fechar pacote/round.

#### 2.9 Round 1 — Correção do Teste de Campo Original (Status: ✅ Concluído e validado em campo)

**Sintomas observados no teste de campo original** (11 ao todo, ex-fase2finalizacao.md §1.1): sem barra de HP, sem dano em combate, inventário não clicável, level-up invisível, tremida no movimento vertical, jogador estático fantasma, jogadores remotos travados, inimigos somem do mapa após alguns minutos sem respawn, estado quebrado sobrevivendo a `scene.restart()` e persistindo mesmo após reiniciar o servidor. Nenhum erro aparecia no console — falha silenciosa, o pior modo de falha possível.

**Causas raiz confirmadas e corrigidas:**

* **`playerStats`/`myId` stale entre `create()`/`shutdown()`.** `scene.restart()` não destrói a instância da cena Phaser (confirmado lendo `node_modules/phaser/src/scene/Systems.js`) — o objeto antigo sobrevivia à morte com `hp_atual <= 0`, e o guard `if (!this.playerStats) return` parava de proteger porque o objeto continuava truthy. Corrigido resetando `playerStats`/`myId` no topo do `create()`.
* **Corrida de sessão morte↔reconecte.** A liberação de `activeSessions`/`gameState.players` dependia só do `ws.on('close')`, assíncrono e mais lento que o `join` automático do reconecte pós-morte — o servidor via o personagem "ainda em sessão" e recusava, reabrindo o modo zumbi. Corrigido com `liberarPersonagem(player)` síncrona (`server/server.js`), chamada tanto na morte quanto no `close`.
* **Inconsistência de tipo do `personagem_id` (string vs. number).** Só 2 dos 10 handlers do client cruzavam tipo — os que derivam o id iterando chave de objeto (`for...in`) em vez de ler campo de valor: `handleWelcome` (sempre spawnava um fantasma do próprio jogador) e `handleStateUpdate` (jogadores remotos nunca recebiam atualização de posição). Corrigido normalizando para `String()` no único ponto de entrada real — `join` no servidor e `list_characters`/`em_uso` na mesma entrega. Zero mudança necessária no client.
* **HP negativo persistido sem clamp causava modo zumbi novo.** O servidor nunca clampava `hp_atual` em zero no combate; `liberarPersonagem` persistia esse valor negativo; o `join` do reconecte carregava esse HP negativo direto do banco; o guard `if (!player || player.hp_atual <= 0) return`, que roda antes de qualquer ação (inclusive `player_move`), descartava tudo silenciosamente. O client não estava quebrado — refletia fielmente um servidor que já considerava o personagem morto. Corrigido curando no `join` (`row.hp_atual <= 0` → `hp_max`, cobre também os 4 registros de teste já corrompidos) e concedendo invulnerabilidade autoritária de 3s no mesmo evento (`player.invulneravelAte`, enforçada em `attack_enemy` — o inimigo ainda toma dano, só o jogador não é ferido).
* **Inimigos nunca respawnavam** (não era regressão da Fase 2, funcionalidade que nunca existiu) — endereçado como item do Round 2 (§2.10).
* **Tremida vertical (S5)** — câmera com `lerp` fracionário (0.08) somado à faixa de perseguição vertical maior que a horizontal; resolvida trocando para `startFollow` sem lerp fracionário (lerp instantâneo), `roundPixels` mantido ligado por decisão do dono do projeto (nitidez pronta para quando a arte real do Godot chegar).

**Também implementado no Round 1:** seleção de personagem (`SelecaoPersonagem.js`, nova cena na FSM — pool compartilhado sem dono, ver §1.2), `join` automático no `onopen` do socket (sem mais precisar de DevTools), e fallback de `console.warn` para qualquer `data.type` sem handler no dispatch do client.

**Pendência cosmética diagnosticada e formalmente adiada (não bloqueou o Round 1):** a tela de seleção de personagem busca a lista uma única vez no `create()` (fetch-once, sem polling/re-sync); uma aba aberta antes de uma subida de nível mostra o nível antigo até recarregar. Não é bug de dado — o banco sempre esteve correto. Mitigação: F5 antes de checar a seleção. Correção "de verdade" (reenviar `list_characters` no `wake`/`resume` da cena) fica para uma fase de polimento.

**Resultado:** Round 1 fechado e validado em campo — modo zumbi eliminado, ressurreição funciona, persistência de HP/nível confirmada.

#### 2.10 Round 2 — Fechamento da Fase 2 (Status: ✅ Concluído e validado em campo)

Quatro itens autorizados pelo dono do projeto:

| # | Item | Resultado |
|---|---|---|
| 1 | Reverter config de teste dos inimigos (população inicial/teto tinham sido temporariamente elevados para 10/10 para facilitar teste de campo) | ✅ Revertido para os valores oficiais: 3 inicial, teto 7, +1 a cada 10s |
| 2 | Nível/level-up visível na UI (subia no banco mas era invisível no jogo) | ✅ Indicador transitório "NÍVEL X!" (3s, `ExploracaoCombate.js`) + indicador fixo na linha de stats (`UIScene.js`) |
| 3 | Remover moeda/pontuação do jogo (Opção A — remoção completa, não só o placar) | ✅ Removido por inteiro, servidor e client (ver decisão registrada em §1.3) |
| 4 | Fantasma duplicado em rejoin rápido (`handlePlayerJoined`/`spawnRemotePlayer` sem checar existência antes de instanciar sprite) | ✅ Corrigido via handler idempotente; validado em campo com 2 abas |

Também fechados nesta janela: **respawn contínuo de inimigos** (timer próprio de 10s, 4 pontos fixos de spawn ciclados, novo tipo `enemy_spawned` espelhando o padrão de `items_respawned`) e a **invulnerabilidade de respawn** (correção (b), ver §1.3 — sinal transitório `respawnPendente` substituindo a checagem por `hp_atual` do banco, que causava invencibilidade permanente em personagens com HP negativo herdado de testes antigos).

**O próprio teste dessa correção (b) revelou 2 bugs novos, ambos corrigidos na mesma sessão:**

* **Invulnerabilidade de respawn travava o movimento e o ataque.** Reaproveitava a mesma flag do knockback (`this.player.invulnerable`, que trava movimento e collider de propósito para o knockback). Corrigido com flag dedicada `this.player.respawnShield` (ver §1.3) — imune a dano, livre para mover e revidar.
* **Número de HP na UI ficava desatualizado após dano em combate normal.** De quatro pontos que escrevem `hp_atual`, só três emitiam `stats_updated` (`handleWelcome`, `handleLevelUp`, `handleStatsUpdated`); `handleCombatEvent` não emitia. Corrigido centralizando o emit num helper (`atualizarStatsUI()`), chamado pelos quatro pontos.

**Item 3, ponta solta final:** dados já persistidos de sessões de teste anteriores (linhas `inventario.tipo='Recurso'`) continuavam aparecendo na barra de itens mesmo após a remoção do mecanismo de coleta. Fechado em duas partes: (a) dono do projeto limpou manualmente via SQL as linhas `tipo='Recurso'` já persistidas; (b) `UIScene.renderInventory` passou a filtrar `tipo='Recurso'` na renderização (defesa em profundidade — ver §1.3), garantindo que a barra nunca desenhe `Recurso` mesmo que uma linha residual reapareça no futuro.

**Descoberta que mudou o escopo:** o inventário do client nunca funcionou de verdade — coleta e enfileira slots, mas nunca foi clicável, nunca abriu tela/ações; o Pacote 4 só validou o backend por script. Não é um bug do Round 2, é uma lacuna que sempre existiu. Adiado como trabalho futuro próprio (Round 3 / fase de itens dedicada — ver §7). *(Fechado desde então — ver §2.12.)*

#### 2.11 Estado Final Consolidado — FASE 2 COMPLETA (2026-07-26)

**Teste de campo final** do dono do projeto confirmou o fluxo de ponta a ponta sem DevTools: seleção de personagem → combate → morte → respawn com imunidade → progressão persistente no banco. Resultado:
* Barra de itens mostra só equipamento (espada/escudo do arqueiro); moeda não aparece mais.
* Nível na tela: letreiro transitório ao subir + "NÍVEL X" fixo, confirmado batendo com o banco.
* Inimigos: população 3/7, teto respeitado.
* Combate funciona (dano nos dois sentidos).
* Respawn com imunidade de 3s confirmado: sem dano na janela, dano volta a valer depois.

**O que foi entregue na Fase 2 (visão consolidada, Pacotes 1-5 + Rounds 1-2):**
* Identidade e seleção de personagem — tela `SelecaoPersonagem` (pool compartilhado, sem login), `join` automático, sem necessidade de DevTools.
* Persistência — nome, classe, nível, XP e inventário carregados do MySQL e sobrevivem a reconexão/restart.
* Progressão com feedback visual — XP/nível-up sobem no banco e aparecem na tela.
* Combate — dano bidirecional por colisão, HP sincronizado em tempo real entre barra de vida, número de stats e banco.
* Morte/respawn com imunidade — cura para `hp_max`, ~3s de invulnerabilidade autoritária server-side, sem travar movimento nem ataque na janela.
* Câmera estável — sem tremida vertical.
* Respawn de inimigos — população contínua, mapa nunca fica vazio.
* Multiplayer coerente — sem jogadores fantasma/duplicados, tipos de id normalizados.

**Pendências cosméticas menores (registradas, não bloqueiam nada):**
* Barra de HP parece seguir a direção do personagem (cosmético, não investigado a fundo).
* Seleção de personagem pode mostrar nível/HP com defasagem (fetch-once sem re-sync, §2.9); mitigado com F5 antes de checar.
* Cura do respawn é em memória; banco só atualiza no snapshot periódico ou ao sair — fresta onde o banco mostra HP negativo com o personagem já curado na prática. Refinamento futuro: persistir a cura no momento do `join`.
* ~~Inimigos nascem sobrepostos (grudados no mesmo ponto), 4 posições fixas com teto 7.~~ **Correção implementada, aguardando validação de campo — ver §2.13.**
* Trava pontual de movimento ("preso subindo") observada uma vez — provável rede, investigar só se recorrer.

**Ponto de retomada (histórico — válido até a decisão de escopo abaixo ser tomada):** ver §6 — a escolha feita foi o Round 3, registrado em §2.12.

#### 2.12 Round 3 — Inventário Clicável (pós-Fase 2, Status: ✅ Concluído e validado em campo, 2026-07-26)

> **Round 3 não é parte da Fase 2** (já fechada em §2.11) — foi a opção escolhida na retomada de escopo (§6) entre os candidatos então abertos (inventário clicável, Fase 3 formal, itens de §7). Fecha a lacuna registrada em §1.3/§2.10: o backend de inventário sempre esteve pronto e validado (Pacote 4), mas o client nunca tornou isso clicável de verdade.

**Objetivo:** substituir a barra de itens fixa (grid de slots sempre visível, Pacote 4) por uma tela de inventário que abre/fecha, com abas e itens realmente clicáveis — reaproveitando o pipeline server-autoritário já validado (`inventory_action` → `equip_item`/`unequip_item` → `inventory_update`/`stats_updated`), sem reconstruí-lo.

**Passo 1 — Abrir/fechar a tela + congelar e imunizar o jogador:**
* Tela abre com `Tab` ou clique no ícone/barra (`UIScene`); a mesma ação fecha.
* Autoridade 100% no servidor: mensagens `inventory_open`/`inventory_close` (sem payload, ver §1.2) setam `player.inventarioAberto` — booleano em memória, sem timer (dura enquanto aberto; diferente de `invulneravelAte`/`respawnShield`, que expiram por tempo).
* Enquanto aberto, o jogador congela (`player_move` ignorado no servidor: `if (player.inventarioAberto) return;`) e fica **totalmente fora de combate** — não toma nem causa dano no toque. Ajuste feito após o teste de campo revelar que a guarda inicial só pulava o dano ao jogador e deixava o inimigo tomar dano sozinho; corrigida envolvendo o bloco inteiro de `attack_enemy` na condição (`if (enemy && !player.inventarioAberto) { ...todo o combate... }`), não só a subtração de HP do jogador. Só o próprio jogador congela — o mundo (outros jogadores, inimigos) continua rodando.
* Limpeza da flag garantida em todo caminho de saída: `inventory_close` explícito, morte (não ocorre em combinação com o inventário aberto, já que nenhum dano é aplicado nesse estado) e desconexão — graciosa ou fechamento abrupto de aba, ambas passam por `ws.on('close')` → `liberarPersonagem`, que apaga o objeto `player` inteiro (com a flag) de `gameState.players`. Validado em campo 4x, com reinício de página e de servidor.

**Passo 2 — Abas verticais na tela de inventário:** `UIScene.tabs` é um array data-driven (`{ id, label }`) — "Equipamentos" (real) e "Em breve" (placeholder). Clique num botão de aba chama `selectTab(id)`, que estiliza o botão ativo (verde/borda amarela vs. azul-escuro/borda ciano) e alterna a visibilidade do conteúdo. Aba padrão ao abrir: "Equipamentos". Estrutura pensada para uma 3ª aba ser só uma nova entrada no array, sem tocar em `renderTabButtons`/`selectTab`.

**Bug encontrado e corrigido entre os Passos 2 e 3:** itens apareciam "soltos" (sem moldura/abas visíveis) já na entrada do jogo, e só ficavam corretos depois do primeiro abrir/fechar da tela. Causa raiz: `selectTab`, chamado uma vez em `create()` pra fixar a aba padrão, decidia a visibilidade do conteúdo só pela aba ativa, sem checar se a tela estava de fato aberta — então `slotsContainer` já nascia visível antes de qualquer abertura. Corrigido gateando a visibilidade por `this.isOpen` dentro de `selectTab`, com `setOpen()` passando a delegar nele como única fonte de verdade (eliminando a lógica duplicada que existia antes).

**Passo 3 — Itens clicáveis na aba Equipamentos:**
* `renderInventory` passou a filtrar por inclusão (`item.tipo === 'Equipamento'`), não só por exclusão de `'Recurso'` — mais forte contra qualquer tipo futuro não-equipável (ver §1.3).
* Cada item é uma linha clicável que reusa o pipeline existente (`onSlotClick` → `inventory_action` → `equip_item`/`unequip_item`) sem alterações.
* Destaque de equipado: verde (`0x00ff00`, fundo `0x1a3a1a`) vs. cinza (`0x888888`, fundo `0x2a2a2a`), com texto de status ("EQUIPADO" / "Clique para equipar").
* Atributos (`statsText`, topo-esquerdo, sempre visível mesmo com a tela fechada) já reagiam a `stats_updated` desde o Pacote 4 — nenhuma mudança nova foi necessária para o HP/dano/defesa exibido mudar ao equipar/desequipar; o número continua vindo 100% do servidor.
* Cada linha tem um `iconPlaceholder` isolado — pronta pra troca por sprite (Godot) sem mover nome/status de posição.

**Adiado de propósito (registrado como futuro, não como pendência/bug):** visual "bonito"/tela maior com grade de ícones — fica para quando os ícones reais do Godot chegarem, evitando retrabalho de layout duas vezes.

**Limpeza de passagem:** confirmado que `dotenv.config()` já chamava com `quiet: true` (`server/server.js:2`) — suprime os "tips" promocionais do `dotenv` v17 (incluindo uma linha citando `vestauth.com`) que apareceram apenas num teste ad-hoc de verificação nesta sessão, nunca no servidor real.

**Resultado:** validado em teste de campo pelo dono do projeto — tela abre/fecha (Tab e clique), jogador fora de combate nos dois sentidos com o inventário aberto, abas navegam, itens equipam/desequipam com destaque visual de equipado e atributos atualizando em tela.

---

#### 2.13 Correção do Spawn de Inimigos Sobrepostos (pós-Round 3, Status: ✅ Concluído e validado em campo, 2026-07-30)

> Fecha o **KNOWN ISSUE** registrado em §2.11 (pendências cosméticas) e confirmado em campo no teste A2: inimigos nascendo grudados (sobrepostos exatamente na mesma coordenada). Causa raiz e evidência de código já estavam documentadas ali; esta seção registra a correção aplicada, ainda não validada em campo.

**Causa raiz (recapitulando §2.11):** `ENEMY_SPAWN_POINTS` só tem 4 cantos fixos, mas `ENEMY_POPULATION_CAP` é 7 — do 5º inimigo em diante o índice cíclico repetia coordenadas exatas de um inimigo já vivo. Agravante: o timer de respawn contínuo rodava desde o boot do processo, não desde o primeiro `join`, então o mapa podia já estar no teto (com sobreposição) antes de qualquer jogador entrar.

**Correção 1 — desvio de spawn (`resolveSpawnPosition`, `server.js`):** nova função, chamada em todo spawn (população inicial de 3 e cada tick do timer de +1/10s), que parte do ponto-âncora (um dos 4 cantos, inalterado) e desvia se houver **qualquer ocupante — jogador OU inimigo vivo** — mais perto que `ENEMY_SPAWN_CLEARANCE` (220px). Checar inimigos além de jogadores foi uma extensão deliberada sobre o desenho original: cobre também o caso "grudado em outro inimigo" quando não há jogador por perto naquele canto no momento do respawn. Desvio: empurra o ponto ao longo do vetor ocupante→âncora até a borda do raio (+0-40px de folga aleatória); ângulo aleatório se a distância for zero. Resultado sempre limitado (clamp) a `[0, 2000]` em x e y — nunca nasce fora do mapa. Um único passe pelos ocupantes (não é solver iterativo) — suficiente pro teto de 7 inimigos e poucos jogadores simultâneos.

**Correção 2 — timer de respawn condicionado à presença de jogador:** guard no topo do callback do `setInterval` (`if (Object.keys(gameState.players).length === 0) return;`). O interval continua vivo e ticando a cada 10s — não há `clearInterval`/restart dinâmico —, só o corpo do tick vira no-op com o mapa vazio. Escolhido em vez de start/stop real do timer porque `liberarPersonagem` é chamado de dois caminhos diferentes (morte em `attack_enemy` e `ws.on('close')`) além do `join`; um guard sem estado próprio não tem como desincronizar desses três pontos. População inicial de 3 continua incondicional no boot — só o `+1/10s` contínuo passou a exigir jogador presente.

**Não alterado:** `ENEMY_SPAWN_POINTS` (os 4 cantos), `ENEMY_POPULATION_CAP` (7), o ciclo `nextEnemySpawnPoint % 4`, e a cadência de 10s do respawn.

**Resultado:** validado em campo pelo dono do projeto — sem sobreposição de inimigos, timer não spawna com o mapa vazio.

---

#### 2.14 A3 — Migração do Inventário ao Schema Novo (banco `jogo_pi`, Status: ✅ Concluído e validado em campo — Fase A fechada, 2026-07-31)

> Contexto: fora deste documento, o dono do projeto conduziu uma migração de banco em passos numerados (A1, A2, A3...). **A1** trocou o schema local pelo schema oficial da equipe — novo banco `jogo_pi` (`db/setup_banco.sql`, substitui o `rpg_game` das seções históricas §2.3/§2.4), com um catálogo `Itens` novo (`id, nome, descricao, localizacao, chance, tipo, bonus_dano, bonus_defesa, bonus_hp`) e `inventario.item_id` virando `INT` (FK pra `Itens.id`, antes era a string usada como chave do objeto `ITENS` hardcoded). **A2** foi o levantamento manual em campo que confirmou o descompasso entre `server/server.js` (ainda esperando o mundo antigo) e o schema novo — mesma sessão que também achou e fechou o spawn sobreposto (§2.13). **A3**, registrado aqui, é a adaptação do código do inventário ao schema novo.

**O que quebrava (achado no A2):** `item_id` era lido pelo servidor como string, chave direta do objeto `ITENS` hardcoded (`server.js:45-48` — catálogo com só os 2 itens de teste); a coluna `tipo` que antes existia em `inventario` sumiu (mora só em `Itens.tipo` agora); os bônus de atributo (`bonus_dano/defesa/hp`) viviam nesse mesmo objeto hardcoded, agora vivem em `Itens`.

**Correção — `server/server.js`:**
* **Carregamento (`join`):** a query virou um `JOIN` explícito — `SELECT inventario.id, inventario.item_id, inventario.quantidade, inventario.equipado, Itens.nome, Itens.tipo, Itens.bonus_dano, Itens.bonus_defesa, Itens.bonus_hp FROM inventario JOIN Itens ON Itens.id = inventario.item_id WHERE inventario.personagem_id = ?` — no lugar do antigo `SELECT * FROM inventario WHERE personagem_id = ?`. Colunas explícitas (não `SELECT *`) porque `inventario.id` e `Itens.id` colidiriam no objeto de resultado; só `inventario.id` é selecionado (é o que `equip_item`/`unequip_item` usa pra achar o item, inalterado). Cada linha de `player.inventario` chega já achatada com `nome/tipo/bonus_*` do catálogo.
* **Recálculo de atributos:** `calcularBonusEquipados` (`server.js`) parou de fazer `ITENS[item.item_id]` e passou a somar `item.bonus_hp/dano/defesa` direto da linha (já vêm do JOIN). A lógica (iterar o inventário, somar só os `equipado`) não mudou — só a fonte dos números, confirmando o princípio já travado em §1.1 (lógica no código, dados no banco).
* **Checagem de tipo ao equipar:** `equip_item`/`unequip_item` trocou `ITENS[item.item_id]?.tipo !== 'Equipamento'` por `item.tipo !== 'Equipamento'`, lendo direto da linha do JOIN.
* **`ITENS` hardcoded:** ficou órfão assim que os dois pontos acima pararam de ler dele (confirmado por busca no repositório inteiro antes de remover — só `roadmap_game.md` e `db/setup_banco.sql` ainda o citavam, em comentário/histórico). **Removido de `server.js` em 2026-07-30**, numa limpeza separada após a A3 rodar (não no mesmo commit que fez o schema novo funcionar) — o catálogo de itens agora vive só na tabela `Itens`.

**Correção — `UIScene.js`:** achado durante o A3 (efeito colateral do `item_id` virar `INT`): a linha do nome do item (`UIScene.js:144`) renderizava `item.item_id` — funcionava só porque `item_id` era a própria string antes. Trocado para `item.nome` (agora disponível via o JOIN), senão o inventário mostraria o número da FK em vez do nome do item.

**Não alterado:** o pipeline de rede (`inventory_action` → `equip_item`/`unequip_item` → `inventory_update`/`stats_updated`), o `UPDATE inventario SET equipado = ?`, e o filtro client-side `item.tipo === 'Equipamento'` (`UIScene.js:124`) — já lia `tipo` da linha recebida, só passou a receber o valor certo.

**Resultado:** validado em campo pelo dono do projeto — bônus batem, equipar/desequipar funciona, atributos refletem certo. Um sintoma à parte apareceu no teste (nome do item mostrando "1"/"2" em vez de "espada"/"escudo") — **não era bug de código**: `UIScene.js:144` já estava correto (`item.nome`) e o JOIN já trazia `Itens.nome`; era módulo ES (`UIScene.js`) cacheado pelo navegador (`index.html` carrega sem cache-busting). Resolvido com hard refresh, sem alteração de código. Com isso, a **Fase A (migração pro schema `jogo_pi`) está fechada**: A1 (schema novo) → A2 (levantamento de quebras) → A3 (adaptação do inventário, esta seção) — todas concluídas e validadas.

---

#### 2.15 Novo Modelo de XP/Nível (pós-Fase A, Status: 🗄️ Histórico — modelo de 2026-07-31, superado em 2026-08-02 pela §2.16)

> **Superado.** O ponto 1 abaixo (XP de morte fixo em 50, mutuamente exclusivo do XP de dano) foi revisto em 2026-08-02 — ver §2.16 para o modelo atual (caminho único, sem pico de abate). Os pontos 2 e 3 (tabela `table_nivel`, loop de subida sem subtração) **continuam válidos**, não foram alterados. Mantido abaixo como registro do que foi implementado e por quê.

> Bloco seguinte depois do fechamento da Fase A. Investigação prévia (MODO DEBUG) confirmou o estado antigo com evidência de código: matar inimigo concedia XP fixo, bater sem matar concedia **zero**, a subida de nível usava fórmula hardcoded `nivel * 100` (`server.js`), e a tabela `table_nivel` do banco `jogo_pi` — já criada e populada (21 linhas, níveis 1-21) — nunca era lida pelo código. `mobs.experiencia_dropada` também nunca foi lida (inimigos são 100% hardcoded no servidor, não vêm de `mobs`) — decisão consciente do dono: **não usar essa coluna agora**, XP de morte continua a constante fixa; ligar XP a `mobs` fica pra quando os inimigos vierem do banco (feature futura).

**Modelo novo — três mudanças, todas em `server/server.js`:**

1. **XP de bater sem matar (novo).** `attack_enemy` virou um `if/else` no lugar do `if` de morte: o ramo de morte concede só os **50 XP fixos** (`XP_POR_INIMIGO`, mantido); o ramo "não morreu" concede `Math.floor(danoNoEnemy × XP_POR_DANO)` (`XP_POR_DANO = 0.1`, constante nova). Os dois ramos são **mutuamente exclusivos por decisão do dono** — a pancada que mata nunca soma os 50 com o XP de dano daquela mesma pancada. Sem trava/limite de XP de bater (decisão consciente — os números já desincentivam farm, já que bater até matar é mais eficiente que só bater).
2. **Subida de nível lendo `table_nivel` (substitui `nivel * 100`).** `TABELA_NIVEL` (`Map<nivel, xp_necessaria>`) carregada uma vez no boot (`carregarTabelaNivel()`, tabela pequena e estática — evita query a cada pancada). **Semântica confirmada por análise dos valores:** `xp_necessaria` é o **XP TOTAL acumulado** que o personagem precisa ter pra estar naquele nível (não o custo incremental de cada nível) — evidência decisiva é a linha `(nivel=1, xp_necessaria=0)`, que só faz sentido como "ponto de partida, zero XP" (na leitura incremental significaria "custa 0 XP sair do nível 1", o que quebraria o sistema). Isso também é a única leitura que explica o salto de dificuldade real na tabela: níveis 2-15 custam uniformemente +25 XP cada (quase de graça), e então o custo salta pra +1025 entre os níveis 15 e 16 — uma parede de dificuldade clara, que só aparece como tal na leitura acumulada. **Efeito colateral consciente:** `personagens.experiencia` muda de semântica — antes era "progresso dentro do nível atual" (subtraído a cada subida); agora é XP total da carreira, nunca subtraído. Personagens de teste que já subiram de nível no modelo antigo carregam um `experiencia` "baixo" (resetado por subidas passadas) — não é um bug, só não vai re-somar retroativamente o que já foi gasto; segue certo daqui pra frente.
3. **Loop de subida sem subtração.** `concederXP` agora compara `player.experiencia` direto contra `TABELA_NIVEL.get(player.nivel + 1)`, subindo em loop (cobre XP excedente/múltiplos níveis de uma vez, igual antes) até o próximo custo não existir na tabela (nível 21 = teto sentinela, `99999999999`) ou não ser alcançado ainda.

**Mudança estrutural necessária:** pra `TABELA_NIVEL` estar garantidamente carregada antes de qualquer `concederXP` rodar, o boot do servidor (criação do `wss`, todos os handlers e `setInterval`s — antes tudo síncrono a partir da linha do `new WebSocket.Server`) foi movido pra dentro de uma função `iniciarServidor()`, chamada só depois de `await carregarTabelaNivel()` numa IIFE assíncrona no topo do arquivo. A porta 8080 não abre, e nenhuma conexão é aceita, antes da tabela terminar de carregar.

**Persistência — lacuna fechada.** O snapshot periódico (~10s) gravava só `posicao_x/posicao_y/hp_atual`, não `experiencia` — não incomodava antes porque XP só mudava em morte (evento raro, e `liberarPersonagem` já grava `experiencia` completo em toda morte/disconnect). Com XP de bater, `experiencia` muda a cada pancada que não mata — bem mais frequente. `experiencia` entrou na mesma query do snapshot (mesmo intervalo de 10s, sem timer novo, sem gravar a cada pancada) — fecha a janela de exposição a uma queda não-graciosa do processo sem I/O extra.

**Não alterado:** `XP_POR_INIMIGO = 50`, `recalcularAtributosEfetivos` (chamada só quando há subida, igual antes), o broadcast `level_up`, `mobs`/`mobs.experiencia_dropada` (continuam não lidos).

**Pendente:** ~~validação em teste de campo pelo dono do projeto~~ — superado por §2.16 antes da validação de campo acontecer; o modelo de XP de morte fixo descrito aqui nunca chegou a ser validado em produção, foi revisto primeiro.

---

#### 2.16 Ajuste do XP dos Comuns — Caminho Único sem Pico de Abate, `experiencia` DECIMAL, Barra de XP (Status: ✅ Implementado e validado em campo 2026-08-02)

**Decisão do dono do projeto:** para inimigos **comuns**, remover o pico de abate (+50 fixo ao matar). Pico/abate proporcional continua existindo como conceito, mas só para **boss**, e só na **fase de loot** (futuro, não iniciado — ver §7.3). Esta seção documenta só o ajuste dos comuns.

**1. Cálculo — caminho único (`attack_enemy`, `server/server.js`).** O `if/else` de XP da §2.15 (morte = 50 fixo / não-morte = `dano×0.1`) virou uma linha só: **todo golpe, inclusive o que mata, concede `dano_efetivo × 0.1`** (`XP_POR_DANO = 0.1`, `XP_POR_INIMIGO` removida). `Math.floor` também saiu — XP de golpe não é mais truncado.

**2. Dano efetivo — sem contar overkill.** `danoEfetivo = Math.min(danoNoEnemy, enemy.hp_atual)`, calculado **antes** de aplicar a subtração de HP (contra o HP que o inimigo tinha até aquele golpe). Um comum de 50 HP nunca rende mais que 5 XP no total (50 × 0.1), não importa quantos golpes levou nem se o último estourou a vida restante.

**3. Schema — `personagens.experiencia` migrada de `INT` para `DECIMAL(12,2)`.** Duas frentes, confirmadas idênticas:
   - **Máquina atual:** `ALTER TABLE personagens MODIFY COLUMN experiencia DECIMAL(12,2) NOT NULL DEFAULT 0;` — rodado via `mysqlsh`, confirmado que preservou os valores dos 5 personagens de teste sem perda (`803` → `803.00`, etc., mesmo valor numérico).
   - **`db/setup_banco.sql` (linha da coluna):** atualizado pra `experiencia DECIMAL(12,2) NOT NULL DEFAULT 0` — máquina nova já nasce com a coluna certa, sem depender de rodar o `ALTER` manualmente.
   - `DECIMAL(12,2)` e não `FLOAT`: XP é total cumulativo de carreira (nunca decresce), e `FLOAT`/`DOUBLE` acumulam erro de arredondamento binário ao longo de milhares de golpes fracionários (`dano×0.1`). `DECIMAL` é exato. 12 dígitos inteiros dá folga enorme sobre qualquer XP de carreira plausível.
   - `table_nivel.xp_necessaria` **não mudou** — continua `BIGINT`, não é XP acumulado por personagem, é limiar fixo da tabela.

**4. BUG encontrado e corrigido — `NaN` por coerção de tipo.** Depois da migração, XP virou `NaN` em produção. Causa: `mysql2` devolve coluna `DECIMAL` como **string**, não `number` (comportamento padrão do driver, sem `decimalNumbers: true` no pool). O código que monta `gameState.players[id]` no `join` fazia `experiencia: row.experiencia` sem converter — antes inofensivo (`INT` já vem como `number` do driver), passou a quebrar com `DECIMAL`. Em `concederXP`, `player.experiencia += quantidade` virava **concatenação de string** (`"0.00" + 4.8 = "0.004.8"`, um literal numérico inválido) em vez de soma, e o valor corrompido propagava pra UI (`NaN` na tela) e falhava ao gravar no banco (por isso o banco continuava em `0.00` — os `UPDATE`s com o valor corrompido falhavam silenciosamente, capturados pelo `.catch` de log). **Corrigido** com `experiencia: Number(row.experiencia)` no `join`. Nenhum personagem ficou com `experiencia = NaN` persistido no banco — confirmado via `SELECT` após a correção (todos os 5 personagens com valores decimais limpos).

> **Nota técnica importante (vale para qualquer trabalho futuro com colunas `DECIMAL`):** `mysql2` sempre devolve `DECIMAL`/`NEWDECIMAL` como string por padrão. Qualquer leitura de uma coluna `DECIMAL` que alimente aritmética **precisa** de `Number(...)` explícito ao sair do banco — `table_nivel.xp_necessaria` (`BIGINT`) já fazia isso certo desde a §2.15 (`Number(r.xp_necessaria)`), só `personagens.experiencia` ficou pra trás na migração. **Isso vai reaparecer na fase de loot**, quando o boss dividir XP proporcional entre jogadores — qualquer leitura nova de coluna decimal (drop rate, XP de boss, etc.) precisa lembrar dessa conversão. Ver também `AGENTS.md` §07.

**5. Barra de XP na UI (client, visual funcional — sem polimento, fica pra depois).** Servidor manda `xp_update` (broadcast + filtro por `personagem_id` no client, mesmo padrão de `stats_updated`/`inventory_update`) a cada golpe com XP, contendo `experiencia`, `nivel`, `xp_proximo_nivel` (`TABELA_NIVEL.get(nivel+1)`, `null` no nível máximo). `welcome` também manda `xp_proximo_nivel` pro estado inicial no join. `ExploracaoCombate.js` tem `handleXpUpdate`, que atualiza `playerStats` e reemite em `stats_updated`. `UIScene.renderStats` mostra `XP: <inteiro>` de texto e um retângulo de progresso (200px, verde sobre cinza) proporcional a `experiencia / xp_proximo_nivel`.

**6. Curva — checada, não alterada.** Comum de 50 HP rende 5 XP total (fixo, dano efetivo nunca passa do HP do inimigo). Contra `table_nivel` real: nível 2 custa 100 XP (20 comuns); níveis 3-15 custam +25 cada (5 comuns por nível); nível 16 salta pra +1025 (205 comuns) — degrau de tabela, não mexido. **Não é gatilho de rebalanceamento** — o dono esclareceu que a curva real se fecha combinando comuns (XP devagar) com boss periódico (pico), e o boss só chega na fase de loot. Número registrado aqui só como referência.

**Não alterado:** `recalcularAtributosEfetivos`, o broadcast `level_up`, `TABELA_NIVEL`/subida em loop (§2.15 pontos 2-3), snapshot periódico (já gravava `experiencia`, ver §1.1). *(Atualização 2026-08-03: `mobs`/`mobs.experiencia_dropada`, citados aqui como "continuam não lidos", passaram a ser lidos no Passo 1 do Bloco Loot & Inimigos — ver §2.17. Este parágrafo descreve o estado de 2026-08-02, anterior a essa mudança.)*

**Fora de escopo, deliberadamente adiado (fase de loot, não implementado):** pico de abate proporcional para **boss**, XP com memória de dano por jogador (múltiplos jogadores batendo no mesmo boss), qualquer diferenciação comum/boss além do que já existe. *(Nota 2026-08-03: "inimigos são só o comum hardcoded" — verdadeiro quando este parágrafo foi escrito, superado pelo Passo 1 do Bloco Loot & Inimigos, §2.17: inimigos hoje vêm de 4 tipos na tabela `mobs`. Boss continua não existindo como conceito de código.)*

---

#### 2.17 Bloco Loot & Inimigos — Passo 1: Inimigos vêm da tabela `mobs` (Status: ✅ Implementado e validado em campo, 2026-08-03)

> **Estrutura do bloco Loot & Inimigos** (registrado aqui pela primeira vez): **P1** inimigos vêm de dado de banco em vez de hardcoded (esta seção, ✅ concluído) → **P2** tipo Elite raro/forte via sorteio ponderado, substituindo o sorteio uniforme original (✅ concluído, ver §2.18) → **P3** boss + abate proporcional (⏳ não iniciado, decisão já registrada em §7.3) → **P4** loot/drop de item ao morrer, usando `mob_drops` (✅ concluído — decisão + log, sem coleta visual, ver §2.19) → **P5** coleta do item largado no mapa, usando `map_items` (🔍 investigado, não implementado — ver §2.20, é o item de §7.3 "Coleta de loot de equipamento no mapa"). Cada P é sub-passo próprio, não pacote monolítico — mesmo padrão dos Pacotes da Fase 2.

**Decisão do dono do projeto:** `mobs.experiencia_dropada` **não é** XP fixo por abate — é o **multiplicador** de XP do tipo. O modelo XP-por-dano da §2.16 continua intacto (sem pico de abate); cada tipo de inimigo só vale mais ou menos XP por golpe, proporcionalmente ao multiplicador. Preserva a decisão da §2.16 em vez de reabri-la.

**1a — Popular `mobs` + schema (banco/SQL só, sem código de jogo).** Tabela `mobs` (vazia desde a A1) recebeu 4 tipos de teste:

| nome_inimigo | vida | ataque | defesa | experiencia_dropada (mult.) | nivel |
|---|---|---|---|---|---|
| Comum | 50 | 15 | 2 | 1.00 | 1 |
| Fraco | 70 | 18 | 3 | 1.30 | 1 |
| Medio | 100 | 22 | 4 | 1.60 | 1 |
| Forte | 140 | 28 | 6 | 2.00 | 1 |

`experiencia_dropada` migrada de `INT` para `DECIMAL(4,2)` (precisa de casas decimais pro multiplicador) — `ALTER TABLE` na máquina atual e `db/setup_banco.sql` (coluna + os 4 `INSERT`) atualizados juntos, confirmados idênticos. Nome "Médio" gravado sem acento (`Medio`) — decisão do dono, evitar problema de acentuação em identificador usado por código (mapa de cor do client, §1d, faz lookup exato por essa string).

**2 — sem coluna de tipo/boss (superado no Passo 2a, §2.18).** Na época deste Passo 1, a tabela `mobs` não tinha flag de raridade — os 4 tipos de teste eram todos "comuns" no sentido da §2.16 (XP por dano, sem pico). O Passo 2a adicionou a coluna `peso_spawn` e o 5º tipo `Elite` (raro, mais durão, mais XP). Continua sem pico de abate — Elite usa o mesmo caminho único de XP por dano, só com multiplicador maior. Boss com abate proporcional como conceito de código continua fora, é o P3.

**1b — Ligar o spawn à `mobs` (`server/server.js`).** Mesmo padrão de carregamento único no boot que `TABELA_NIVEL` (§2.15): `MOBS_TIPOS` (array em memória) carregado por `carregarMobsTipos()` antes do servidor aceitar conexão (`SELECT ... FROM mobs`), com `Number(r.experiencia_dropada)` na leitura — obrigatório, mesma nota técnica de `DECIMAL`/`mysql2` da §2.16 (ver também `AGENTS.md` §07). `spawnEnemy(x, y, vx, vy, tipo)` deixou de receber `hp/dano/defesa` soltos e passou a receber o objeto `tipo` inteiro (sorteado por `sortearTipoMob()`, `Math.random()` uniforme sobre os 4 tipos carregados — **sorteio temporário**, superado no Passo 2b pelo sorteio ponderado por `peso_spawn`, ver §2.18). O objeto `enemy` em `gameState.enemies` ganhou dois campos, mantendo os existentes: **`nome`** (string do tipo) e **`xp_multiplicador`** (number). População inicial (3, no boot) e respawn contínuo (+1/10s até o teto 7, §2.13) chamam o mesmo `spawnEnemy(..., sortearTipoMob())` — mesmo mecanismo de sorteio nos dois caminhos, não há um "canto fixo = tipo fixo" (essa simetria é o que deixou o Passo 2b trivial: um único ponto de troca, os dois caminhos herdaram).

**Órfãs (não removidas ainda):** `ENEMY_HP`, `ENEMY_DANO`, `ENEMY_DEFESA` (constantes hardcoded originais) ficaram sem nenhuma chamada depois da troca. Deixadas no código, comentadas como órfãs — ver pendência de limpeza em §7.2.

**1c — XP pondera pelo tipo (`attack_enemy`, `server/server.js`).** Uma multiplicação a mais na fórmula da §2.16: `xp = dano_efetivo × XP_POR_DANO × enemy.xp_multiplicador`. `enemy.xp_multiplicador` é o do inimigo **atingido** (`gameState.enemies[data.enemyId]`), não uma constante global — cada golpe em cada inimigo pondera pelo tipo daquele inimigo especificamente. Nada mais mudou: continua caminho único, todo golpe (inclusive o que mata) gera XP, sem pico de abate.

**1d — Cor e nome por tipo no client (`ExploracaoCombate.js`).** Debug visual, não arte final (será substituído pelos sprites do Godot) — cor sólida por `nome`: Comum cinza (`0x888888`), Fraco verde (`0x00cc44`), Medio amarelo/laranja (`0xffaa00`), Forte vermelho (`0xff0000`), com fallback branco (`0xffffff`) pra qualquer nome fora do mapa. Esse fallback é o que cobriu o Elite entre o Passo 2a/2b (existia no banco e spawnava, mas sem cor própria ainda) até o Passo 2c mapear `Elite: 0x9900ff` (roxo), ver §2.18. Texto pequeno com o nome do tipo acima do sprite, interpolado junto da posição, destruído junto do `hpGraphics` na morte do inimigo e no shutdown da cena (evita vazamento de `Text` órfão). O objeto `enemy` já chegava no client com `nome`/`xp_multiplicador` desde o 1b — efeito colateral do broadcast de `gameState.enemies` inteiro (`state_update`/`enemy_spawned`); o 1d só passou a **usar** o campo que já estava trafegando.

**Investigação de campo (dois falsos alarmes, nenhum bug encontrado — sessão de debug 2026-08-03):**
- *"Forte não aparece":* instrumentado com log temporário de spawn + cliente WS sintético rodando ~85s sem player atacar. `MOBS_TIPOS` carregou os 4 tipos certos no boot; ao longo de 8 sorteios observados, Forte apareceu (`enemy_8`). Distribuição puxada (Medio×4, Comum×2, Fraco×1, Forte×1) é variância normal de amostra pequena, não bug — teto de população (7) + respawn só gatilhado por morte (§2.13) limita quantos sorteios acontecem numa sessão curta.
- *"XP do Fraco parece igual ao do Comum":* instrumentado com log temporário no cálculo de XP. `enemy.xp_multiplicador` confirmado `Number` (nunca string) em 13/13 golpes logados; fórmula bateu exata em cada linha (ex. Comum morto em 4 golpes = XP total 5.0 = 50×0.1×1.0). A confusão era comparar XP **por golpe** (naturalmente parecido, dano por golpe é pequeno) em vez de XP **total por abate** (onde a diferença de multiplicador aparece). Logs `[DEBUG-TEMP]` removidos de `server.js` depois de fechar a investigação.

**Resultado:** validado em campo pelo dono do projeto — inimigos variados nascem da `mobs`, jogabilidade boa, cor/nome distinguem tipo, XP pondera certo.

#### 2.18 Bloco Loot & Inimigos — Passo 2: Elite raro/forte, sorteio ponderado (Status: ✅ Implementado e validado em campo, 2026-08-13)

> Continuação do §2.17. Onde o P1 tirou os inimigos do hardcode, o P2 adiciona um 5º tipo — **Elite** — bem mais forte, com muito mais XP, e **raro**: aparece pouco porque o sorteio de spawn deixou de ser uniforme. Concluído em 3 sub-passos (2a-2c).

**2a — Coluna `peso_spawn` + popular o Elite (banco/SQL só, sem código de jogo).** `mobs` ganhou `peso_spawn INT NOT NULL DEFAULT 10` (peso relativo de sorteio — quanto maior, mais frequente) e os pesos dos 5 tipos foram calibrados (valores de teste do dono, provisórios):

| nome_inimigo | vida | ataque | defesa | experiencia_dropada (mult.) | peso_spawn |
|---|---|---|---|---|---|
| Comum | 50 | 15 | 2 | 1.00 | 30 |
| Fraco | 70 | 18 | 3 | 1.30 | 25 |
| Medio | 100 | 22 | 4 | 1.60 | 20 |
| Forte | 140 | 28 | 6 | 2.00 | 15 |
| Elite | 250 | 40 | 10 | 3.50 | 5 |

Peso total 95 — Elite ≈ 5% de chance de sorteio. `ALTER TABLE` (coluna + `UPDATE` dos 4 pesos existentes + `INSERT` do Elite) na máquina atual e `db/setup_banco.sql` (coluna nasce na `CREATE TABLE` + os 5 tipos já vêm com peso no `INSERT`) atualizados juntos — estrutura confirmada idêntica via `DESCRIBE mobs` comparado à definição do script (não foi possível recriar um banco isolado pra rodar o script ponta-a-ponta: o usuário `rpg_app` só tem privilégio `ALL` em `jogo_pi`/`rpg_game`, sem `CREATE DATABASE`).

**2b — Sorteio ponderado (`server/server.js`).** `carregarMobsTipos()` passou a trazer `peso_spawn` no `SELECT` e no objeto de cada tipo em `MOBS_TIPOS` — é `INT`, chega como `number` puro (confirmado por teste isolado com `mysql2`, sem o bug de `DECIMAL`-como-string das §2.16/§2.17). `sortearTipoMob()` deixou de ser uniforme (`Math.random() * length`) e passou a ser weighted random padrão: soma todos os `peso_spawn` (95), sorteia um número de 0 até a soma, percorre os tipos subtraindo peso até o número sorteado ficar negativo — o tipo onde isso acontece é o escolhido. Assim Comum (30/95) sai ~6x mais que Elite (5/95). Os dois pontos de spawn (população inicial e respawn contínuo, §2.17 1b) não precisaram mudar — ambos já chamavam `sortearTipoMob()`, herdaram o comportamento ponderado automaticamente.

**2c — Cor roxa do Elite (`ExploracaoCombate.js`).** Mesmo debug visual do §2.17 1d — `ENEMY_COLOR_BY_NOME['Elite'] = 0x9900ff` (roxo), no mesmo mapa dos outros 4. Antes deste sub-passo o Elite já podia spawnar (2a/2b concluídos) mas caía no fallback branco; a partir daqui é identificável na hora pela cor, sem precisar descobrir pela dureza.

**Teste de campo:** pra validar que o Elite aparece, é durão e dá muito XP sem esperar ~5% de sorte, o dono pediu `peso_spawn` do Elite inflado temporariamente pra 100 (só `UPDATE` na máquina atual, `db/setup_banco.sql` intocado — é teste local, não muda o balanceamento base). Testado, confirmado, e revertido de volta pra 5 depois — inclusive uma segunda vez, após um reset de banco do dono ter restaurado o valor de `setup_banco.sql`.

**Resultado:** validado em campo pelo dono do projeto — Elite é raro, mais durão, dá bem mais XP, e aparece roxo. `db/setup_banco.sql` e a máquina atual confirmados com a mesma estrutura e os mesmos pesos-base (Elite = 5).

#### 2.19 Bloco Loot & Inimigos — Passo 4: loot/drop de item ao morrer — decisão + log (Status: ✅ Implementado, verificado por código/banco, 2026-08-25 — teste de campo do dono pendente)

> Continuação do §2.17/§2.18. Onde o P1/P2 decidiram *quem* nasce, o P4 decide *o que sobra* quando morre — mas só a **decisão**: o item ainda não aparece no mapa nem é coletável (isso é o P5, §2.20). Concluído em 2 sub-passos (4a-4b), cada um com investigação de debug prévia antes de mexer em código (ver histórico de investigação abaixo).

**Lacuna encontrada antes do 4a (investigação de debug, sem código):** o objeto `enemy` sabia seu `nome` (string do tipo) mas não o `mob_id` (id numérico da linha em `mobs`) — e `mob_drops.mob_id` é FK numérica. Sem esse id, o inimigo não conseguia consultar seus próprios drops. A mesma investigação confirmou: `mob_drops` existia no schema (`db/setup_banco.sql`) mas com **0 linhas** (nunca populada); o catálogo `Itens` tem só 2 itens (`espada_enferrujada` id=1, `escudo_improvisado` id=2, ambos `tipo='Equipamento'`) — qualquer drop de teste só pode apontar pra esses dois sem criar item novo.

**4a — Consertar o `mob_id` + popular `mob_drops` (banco + `server/server.js`, sem lógica de drop ainda).**
- **Parte 1 (código):** `carregarMobsTipos()` passou a incluir `id` no `SELECT` (`SELECT id, nome_inimigo, ...`); `MOBS_TIPOS` guarda esse valor como `mob_id`; `spawnEnemy()` grava `mob_id: tipo.mob_id` no objeto `enemy`, junto de `nome`/`xp_multiplicador`. Comentário no código deixa explícito: `mob_id` é o id do **TIPO** (linha em `mobs`), diferente de `enemy.id` (id da **INSTÂNCIA** no `gameState`, ex. `"enemy_1"`) — os dois nunca devem ser confundidos.
- **Parte 2 (dados de teste do dono, provisórios):** 6 linhas inseridas em `mob_drops` — inimigo mais forte dropa com mais chance; Elite tem 2 linhas (dropa espada E escudo, chances independentes):

| mob (nome) | mob_id | item | chance_drop | qtd |
|---|---|---|---|---|
| Comum | 1 | espada (1) | 0.20 | 1 |
| Fraco | 2 | espada (1) | 0.30 | 1 |
| Medio | 3 | escudo (2) | 0.40 | 1 |
| Forte | 4 | escudo (2) | 0.60 | 1 |
| Elite | 5 | espada (1) | 0.80 | 1 |
| Elite | 5 | escudo (2) | 0.80 | 1 |

`mob_id` resolvido por subquery pelo **nome** (`SELECT id FROM mobs WHERE nome_inimigo = '...'`), não hardcoded — mesmo cuidado de não chutar id que já apareceu antes no projeto. As duas frentes (máquina atual via `INSERT` direto, e `db/setup_banco.sql` com o mesmo bloco de `INSERT` logo após o `INSERT INTO mobs`) usam exatamente a mesma query e foram confirmadas idênticas. `SELECT * FROM mob_drops` na máquina atual devolveu as 6 linhas com os `mob_id`/`item_id` corretos (Comum=1, Fraco=2, Medio=3, Forte=4, Elite=5 — mesma ordem de `INSERT` do §2.18).

**4b — Lógica de decisão do drop na morte (`server/server.js`, sem coleta/visual).**
- **Decisão de arquitetura (aprovada pelo dono):** `mob_drops` carregada inteira em memória no boot (`MOB_DROPS`, `Map<mob_id, drops[]>`, via `carregarMobDrops()`), mesmo padrão de `MOBS_TIPOS`/`TABELA_NIVEL` — tabela pequena e estática, evita query a cada morte de inimigo (evento frequente).
- **`rolarDrops(mob_id)`:** busca `MOB_DROPS.get(mob_id) ?? []`; pra cada linha rola `Math.random() < chance_drop` **independentemente** (por isso Elite pode dropar os dois itens); se passou, sorteia quantidade em `[quantidade_min, quantidade_max]` (hoje sempre 1, mas a faixa é respeitada pra drops futuros com quantidade variável); retorna array `{item_id, quantidade}` (pode vir vazio).
- **Nota técnica de tipo (verificada, não presumida):** diferente de `experiencia_dropada` (`DECIMAL`, chega como `string` no `mysql2` — nota recorrente desde §2.16), `chance_drop` (`FLOAT`) e `quantidade_min`/`quantidade_max` (`INT`) chegam como `number` nativo, confirmado com query isolada (`typeof chance_drop === 'number'`). Documentado em comentário no código — não precisou de `Number(...)`.
- **Encaixe:** dentro do `if (enemy.hp_atual <= 0)` em `attack_enemy`, logo depois do `delete gameState.enemies[...]` e do broadcast `enemy_died` (a variável local `enemy` ainda está em escopo, com `x`/`y`/`nome`/`mob_id` da última posição antes de morrer). Chama `rolarDrops(enemy.mob_id)` e **só loga**: `[LOOT] enemy <nome> (mob_id=<id>) dropou: item_id=X x<qtd>, ...` (ou "não dropou nada"). Nenhum broadcast novo, nenhuma entidade nova em `gameState`, nenhum item visual — fronteira P4/P5 deliberada.
- **Sem regressão:** XP (`concederXP`), `enemy_died`, morte/respawn do jogador não foram tocados — só um trecho novo de leitura+log inserido no meio do bloco de morte existente. `node --check` confirmou sintaxe válida após as duas edições (4a e 4b).

**Achado lateral de segurança (não é bug do projeto, registrado por precaução — ver também §7.1):** durante um teste manual isolado de tipo de coluna, o pacote `dotenv@17.4.2` (mesmo mantenedor do dotenvx) imprimiu no stdout uma "dica" promocional apontando pra `vestauth.com` ("auth for agents", produto irmão do mesmo criador) — investigado e confirmado que **não é pacote malicioso/comprometido** (código-fonte do próprio `node_modules/dotenv/lib/main.js` confirma a lista de dicas), só uma prática de propaganda em stdout que pode ser mal-interpretada por um agente de IA. `server/server.js:2` já chama `dotenv.config({ ..., quiet: true })`, então essa dica nunca aparece no boot real do servidor — nenhuma mudança de código foi necessária.

**Resultado:** `mob_id` chega no objeto `enemy` desde o spawn (Parte 1 do 4a, confirmado no código); `mob_drops` populada com as 6 linhas em ambas as frentes (Parte 2 do 4a, confirmado por `SELECT`); a decisão de drop roda na morte e loga corretamente, sem tocar XP/`enemy_died`/respawn (4b, confirmado por leitura de código + `node --check`). **Teste de campo do dono (matar inimigos e observar o `[LOOT]` no terminal) ainda não foi feito** — pendência de validação, não de implementação.

#### 2.20 Bloco Loot & Inimigos — Passo 5: item dropado vira coletável no mapa (Status: 🔍 Investigado em modo debug, 2026-08-25 — implementação NÃO iniciada, decisão do dono)

> Continuação do §2.19. Fecha o loop visual de loot: mata → dropa (§2.19) → cai no chão → jogador anda por cima → vai pro inventário. Contexto histórico que motivou a investigação: já existiu coleta de **moeda** no mapa (`pickup_item`, `spawnMoedas`), removida por inteiro no Round 2 (§7.3) porque a moeda era ilusória — o P5 reconstrói o mecanismo, agora pra equipamento real. Investigação em MODO DEBUG concluída nesta sessão; **nenhuma linha de código foi alterada** para este passo — fica para a próxima sessão.

**Achados da investigação (evidência, não implementação):**
1. **Resíduo da moeda: nada em código.** `pickup_item`/`spawnMoedas`/"item no chão" têm zero ocorrências em `server.js`/`ExploracaoCombate.js` — removidos por completo no Round 2, como já registrado em §7.3. Achado extra: existe uma tabela `map_items` no schema (`db/setup_banco.sql`, ex-`itens_instanciados_mapa`, ver nota em §2) mas **não é lida/escrita por nenhum código**, e sua estrutura (PK composta `map_id+item_id+posicao_x+posicao_y`, `tempo_respawn_segundos`) é desenhada pra item fixo estático com respawn por posição — não serve como está pra drop dinâmico numa posição arbitrária (onde o inimigo morreu). P5 parte do zero, sem resíduo aproveitável.
2. **Padrão de entidade em `gameState`:** `players`/`enemies` seguem o mesmo desenho — snapshot completo no `welcome` (join), evento próprio de entrada/saída (`enemy_spawned`/`enemy_died`, `player_joined`/`player_left`), posição contínua só via `state_update` (20Hz, só pra quem se move). Item no chão não se move — não precisaria do `state_update`, só de um par spawn/despawn.
3. **Caminho de INSERT em `inventario` não existe.** Confirmado por grep: só há `SELECT` (no `join`) e `UPDATE equipado` (`equip_item`/`unequip_item`). Nenhum caminho cria linha nova — é exatamente o que sumiu junto da moeda (§7.3) e precisa ser construído do zero no P5. Detalhe de schema relevante: `inventario` não tem `UNIQUE(personagem_id, item_id)` — decisão pendente pro modo arquiteto do P5: incrementar `quantidade` de uma linha existente ou sempre inserir linha nova.
4. **Encaixe com o P4:** `rolarDrops()` já roda na morte (§2.19) e tem tudo que falta pro "item no chão" — posição (`enemy.x`/`enemy.y` no instante da morte), o quê (`item_id`/`quantidade`) — só falta um id de instância próprio (não existe ainda, precisaria de contador novo tipo `nextEnemyId`).
5. **Achado importante sobre detecção de proximidade:** a detecção de "toque" no combate (`attack_enemy`) **não roda no tick do servidor** — é um `Phaser.physics.add.collider` no **client** (`ExploracaoCombate.js`), que detecta sobreposição visual e manda o evento pro servidor; o servidor não verifica proximidade, só confia no `enemyId` recebido e resolve o dano deterministicamente. Se a coleta seguir o mesmo padrão já validado em produção, seria outro collider Phaser (client) em vez de checagem de distância no `setInterval` de 20Hz do servidor — mas isso é decisão de arquitetura em aberto, não uma conclusão desta investigação.

**Decisões de arquitetura em aberto pra próxima sessão (modo arquiteto, não decidido ainda):** (a) collider client-side (mesmo padrão do combate) vs. checagem de distância autoritária no tick do servidor; (b) incrementar `quantidade` vs. nova linha em `inventario` ao coletar item repetido; (c) estrutura exata da entidade "item no chão" em `gameState` e id de instância.

---

### FASE 3: Level Design Avançado, Tilemaps & Spatial Partitioning (Status: ⏳ Planejada)

#### 3.1 Objetivos Técnicos

* Importar conjuntos de tilesets pós-apocalípticos estruturados via Tiled Map Editor (camadas: `Ground`, `Structures`, `AbovePlayer`, `Collisions`).
* Configurar profundidade dinâmica (*Z-Indexing* / *Depth Sorting*) com base na coordenada Y dos sprites em relação às estruturas do cenário.
* Implementar **Spatial Partitioning (Grid de Células)** no mapa de $2000 \times 2000$ px para limitar checagens de colisão e rendering apenas às células visíveis pela câmera local.

---

### FASE 4: Standalone Build, Polimento de UI/UX, Audio & Pipeline Godot (Status: ⏳ Planejada)

#### 4.1 Objetivos Técnicos

* Integrar a camada de áudio com gerenciamento de trilha ambiente e efeitos sonoros posicionais (SFX de passos, tiros, acertos).
* Configurar exportação standalone via Godot Engine (pipeline alternativo desktop) ou wrapper Electron.
* Realizar testes de estresse de FPS, verificação de *memory leaks* e validação final contra a constituição do `AGENTS.md`.

---

## 4. Algoritmos e Fluxos "Por Baixo dos Panos"

### 4.1 Algoritmo de Interpolação de Movimento (Client-Side Prediction & Lerp)

Para evitar que os jogadores remotos sofram com travamentos visuais (*jittering*) na rede local, o cliente calcula o deslocamento suave:

```javascript
// Executado no ciclo de atualização da entidade remota
updateRemotePlayer(delta) {
    const factor = 0.15; // Fator de suavização (lerp)
    this.x = Phaser.Math.Linear(this.x, this.targetX, factor);
    this.y = Phaser.Math.Linear(this.y, this.targetY, factor);
    
    // Atualiza animações com base nos vetores de velocidade recebidos
    if (Math.abs(this.targetX - this.x) > 0.5 || Math.abs(this.targetY - this.y) > 0.5) {
        this.anims.play(this.walkAnimKey, true);
    } else {
        this.anims.play(this.idleAnimKey, true);
    }
}

```

---

### 4.2 Algoritmo de Spawn Seguro de Loot (Safe Drop)

Impede que um item dropado por um inimigo caia dentro de paredes ou áreas incompletas do Tilemap:

```javascript
findSafeDropPosition(originX, originY, tilemapLayer) {
    const tileSize = 32;
    let tileX = tilemapLayer.worldToTileX(originX);
    let tileY = tilemapLayer.worldToTileY(originY);
    
    // Checa se a posição original é válida e sem colisão
    let tile = tilemapLayer.getTileAt(tileX, tileY);
    if (!tile || !tile.collides) {
        return { x: originX, y: originY };
    }
    
    // Busca em espiral pela célula livre mais próxima
    const maxRadius = 3;
    for (let r = 1; r <= maxRadius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                let checkTile = tilemapLayer.getTileAt(tileX + dx, tileY + dy);
                if (checkTile && !checkTile.collides) {
                    return {
                        x: tilemapLayer.tileToWorldX(tileX + dx) + tileSize / 2,
                        y: tilemapLayer.tileToWorldY(tileY + dy) + tileSize / 2
                    };
                }
            }
        }
    }
    return { x: originX, y: originY }; // Fallback
}

```

---

## 5. Roteiro de Teste e Validação do Roadmap

1. **Validação do Servidor WebSockets (Fase 1):**
* Subir `server.js` e conectar duas janelas do navegador simultaneamente.
* Mover o Personagem A e confirmar que o Personagem B renderiza a movimentação suavemente via interpolação.


2. **Validação de Dano Sincronizado (Fase 1):**
* O Personagem A ataca um inimigo. O servidor processa o dano e notifica todos os clientes.
* Confirmar se a barra de HP do inimigo atualiza identicamente nas duas telas.


3. **Validação do Schema MySQL (Fase 2):**
* Desconectar um cliente após coletar um item e reconectar.
* Confirmar no MySQL (`SELECT * FROM inventario WHERE personagem_id = X`) se o item persiste corretamente.


4. **Benchmark de Performance (Fase 3/4):**
* Monitorar FPS com 50+ entidades ativas em tela. Manter a taxa constante em 60 FPS com Object Pooling ativo e zero alocação de memória no `update()`.



---

## 6. Estado Exato para Retomada (Próxima Sessão) — atualizado 2026-08-25

**Ponto de Parada Atual:** **Fase 2 COMPLETA** (Pacotes 1-5, §2.3-§2.7, mais Round 1 e Round 2 de correção pós-teste-de-campo, §2.8-§2.11) e **Round 3 (Inventário Clicável) COMPLETO** (§2.12) — fechados e validados em teste de campo. Por cima disso, o dono do projeto conduziu a **Fase A** — migração pro schema oficial da equipe (banco `jogo_pi`, `db/setup_banco.sql`, substitui `rpg_game`/`server/schema.sql` das seções históricas §2.3/§2.4) — em três passos, **todos concluídos e validados em campo em 2026-07-31**: A1 (schema novo), A2 (levantamento: achou spawn de inimigos sobrepostos e inventário quebrado contra o schema novo), A3 (adaptou o inventário — §2.14). A correção do **spawn sobreposto** (§2.13) também está fechada e validada. O objeto `ITENS` hardcoded, órfão desde a A3, foi removido de `server/server.js`. Em 2026-07-31 foi implementado um primeiro modelo de XP/nível (§2.15, histórico), com XP de morte fixo em 50. **Em 2026-08-02, o dono ajustou o modelo de XP dos inimigos comuns** (§2.16) — pico de abate removido, caminho único `dano_efetivo × 0.1` por golpe, `personagens.experiencia` migrada pra `DECIMAL(12,2)`, barra de XP na UI, e um bug de `NaN` (causado pela migração — `mysql2` devolve `DECIMAL` como string) foi encontrado e corrigido no mesmo dia. **Em 2026-08-03, o Bloco Loot & Inimigos entrou em execução — Passo 1 completo** (§2.17): tabela `mobs` populada (4 tipos), spawn sorteia tipo em vez de usar constantes fixas, XP pondera pelo multiplicador do tipo, client colore/nomeia por tipo. Duas investigações de campo (Forte "sumindo", XP "igual" entre tipos) fecharam sem bug — variância de amostra e leitura errada de por-golpe vs. por-abate. **Implementado e validado em campo (2026-08-03).** **Em 2026-08-13, o Passo 2 foi concluído** (§2.18): `mobs` ganhou `peso_spawn` e o 5º tipo `Elite` (raro, mais durão, mais XP), o sorteio de spawn passou de uniforme para ponderado por esse peso, e o client ganhou a cor roxa do Elite. Testado em campo com o peso do Elite inflado temporariamente e revertido depois. **Implementado e validado em campo (2026-08-13).** **Em 2026-08-25, o Passo 4 foi concluído em 2 sub-passos** (§2.19): 4a consertou a lacuna do `mob_id` no objeto `enemy` (id do tipo, distinto do id de instância) e populou `mob_drops` com 6 linhas de teste (nas duas frentes — máquina atual e `db/setup_banco.sql`, confirmadas idênticas); 4b carregou `mob_drops` em memória no boot (`MOB_DROPS`, mesmo padrão de `MOBS_TIPOS`/`TABELA_NIVEL`) e ligou a decisão de drop (`rolarDrops`) na morte do inimigo, só logando o resultado (`[LOOT] ...`) — sem item visual/coletável ainda (isso é o P5). **Verificado por código/banco; teste de campo do dono ainda pendente.** Na mesma data, o **Passo 5 passou por investigação em modo debug** (§2.20) — sem nenhuma linha de código alterada — que mapeou o resíduo (nulo) do antigo sistema de moeda, a ausência de caminho de `INSERT` em `inventario`, e confirmou que a detecção de "toque" no combate hoje é um collider Phaser no **client**, não uma checagem no tick do servidor. Implementação do P5 **fica para a próxima sessão, por decisão do dono**. Parada de hoje é aqui.

O servidor lê identidade real do MySQL (personagem + inventário via `JOIN` com `Itens`, §2.14), aplica molde de classe + buff de nível + bônus de itens equipados (recálculo em memória, nunca persistido em `personagens`), grava snapshot periódico (posição/HP/**experiência**, §1.1)/disconnect/inventário, cura e concede invulnerabilidade autoritária no respawn, mantém população contínua de inimigos sem sobreposição (§2.13) **sorteando de forma ponderada entre 5 tipos vindos da tabela `mobs`** (§2.17/§2.18, em vez de valores únicos fixos ou sorteio uniforme), **decide e loga o loot de cada inimigo na morte** (§2.19, `mob_drops` em memória + `rolarDrops`) e elimina jogadores fantasma/duplicados. O client seleciona personagem, conecta e envia `join` sozinho — nenhuma etapa depende de DevTools. O Phaser roda duas cenas em paralelo durante o combate: `ExploracaoCombate` (jogo) e `UIScene` — tela de inventário que abre/fecha (`Tab` ou clique, `inventory_open`/`inventory_close`), jogador estático e totalmente fora de combate enquanto aberta, abas verticais e itens de `tipo='Equipamento'` clicáveis com destaque visual verde/cinza de equipado, barra de progresso de XP (§2.16), e 5 tipos de inimigo coloridos/nomeados, incluindo o Elite roxo raro (§2.17/§2.18).

1. **Banco já de pé:** schema oficial aplicado via `db/setup_banco.sql` (banco `jogo_pi` — 14 tabelas, ver nota em §2), incluindo `table_nivel` (agora lida pelo código, §2.15), `personagens.experiencia` como `DECIMAL(12,2)` (§2.16), `mobs`/`mobs.experiencia_dropada` como `DECIMAL(4,2)`, populada com 5 tipos e `peso_spawn` (§2.17/§2.18), e `mob_drops` populada com 6 linhas de teste (§2.19) — nas duas frentes, máquina atual e script de setup, confirmadas com a mesma estrutura em ambos os casos. Usuário dedicado `rpg_app` configurado; credenciais em `server/.env` (git-ignorado, não commitar). `server/schema.sql`/`server/seed_teste.sql` (banco `rpg_game`) são o setup antigo, pré-migração A1 — não é mais o que está de pé. `map_items` continua vazia/não lida por código (§7.3, P5 do bloco Loot & Inimigos) — `mob_drops` **não está mais vazia** desde o 4a.
2. **Próxima ação — implementar o Passo 5** (item dropado vira coletável no mapa). Investigação já feita (§2.20); decisões de arquitetura em aberto antes de codar: (a) collider Phaser no client (mesmo padrão do `attack_enemy`) vs. checagem de distância autoritária no tick do servidor; (b) incrementar `quantidade` vs. nova linha em `inventario` ao coletar item repetido (não há `UNIQUE(personagem_id, item_id)` hoje); (c) estrutura da entidade "item no chão" em `gameState` + id de instância. Fora do bloco: **P3** boss + pico de abate proporcional (§7.3, decisão já registrada em §2.16) segue adiado sem prioridade definida; a **Fase 3 formal** (Level Design Avançado, Tilemaps & Spatial Partitioning, §3) ou qualquer item da lista de decisões adiadas (§7).
3. **Pendências que sobrevivem a tudo isso, sem bloquear nada** (detalhe completo em §7): feedback de `equip_item`/`unequip_item` recusado ainda é silencioso; seleção de personagem pode mostrar dado defasado (mitigado com F5); cura de respawn só persiste no banco por snapshot/saída, não no instante do `join`; constantes `ENEMY_HP/ENEMY_DANO/ENEMY_DEFESA` órfãs em `server.js`, aguardando remoção (§7.2); teste de campo do Passo 4 (§2.19) ainda não feito pelo dono.

---

## 7. Lista de Pendências, Riscos e Decisões de Design Adiadas

### 7.1 Riscos técnicos mapeados

* **Risco I (Inconsistência de Estado em Queda de Conexão LAN):** Se o cliente perder a conexão socket no meio do combate, a posição final e o HP devem ser persistidos no MySQL antes do encerramento do processo (`disconnect` handler). Mitigado desde o Pacote 2 (save no `close`).
* **Risco II (Excesso de Bandwidth em LAN):** Enviar pacotes de movimento a 60 Hz pode saturar a rede local. Travado em **20 Hz (50ms)** com interpolação no lado receptor desde o Pacote 3.
* **Pendência de UI:** Criar o componente visual de log de combate (*Damage Numbers* flutuantes subindo na tela ao infligir dano).
* **Propaganda em stdout de dependência (`dotenv@17.4.2`), achado em 2026-08-25 durante o Passo 4 (§2.19).** O pacote imprime "dicas" promocionais aleatórias ao carregar `.env`, uma delas aponta pra `vestauth.com` ("auth for agents", produto irmão do mesmo criador do dotenv/dotenvx) — texto que pode ser mal-interpretado por um agente de IA como instrução. Investigado e confirmado **não malicioso** (fonte do próprio pacote instalado, não código injetado/comprometido). `server/server.js:2` já usa `quiet: true`, então a mensagem nunca aparece no boot real — risco mitigado, nenhuma ação de código necessária. Registrado só como lembrete: não seguir/acessar URLs que apareçam em stdout de dependências, mesmo de pacotes legítimos.

### 7.2 Pendências funcionais em aberto (não bloqueiam, aguardam decisão)

* **Feedback de `equip_item`/`unequip_item` recusado é silencioso.** Quando o servidor recusa (item não encontrado, ou `tipo !== 'Equipamento'`), nenhum aviso volta pro client — mesma família de problema que o `level_up` órfão já corrigido. Requer contrato de rede novo (ex.: `action_denied`/`equip_rejected`), fora de qualquer escopo já travado. Aguardando decisão do responsável do projeto sobre nome/payload antes de implementar.
* **Reconectar com pouca vida (não zero, ex. 5/100):** cura sempre pra cheio, ou mantém o estado exato de HP de quando saiu? Caso de borda do modelo de cura no `join` (§2.9) — raro, não bloqueante, decisão pendente.
* **Código órfão aguardando remoção (limpeza, não bloqueia nada):** `ENEMY_HP`/`ENEMY_DANO`/`ENEMY_DEFESA` em `server/server.js` — constantes hardcoded originais, sem nenhuma chamada desde que o spawn passou a ler da tabela `mobs` (Passo 1b, §2.17). Mantidas comentadas em vez de removidas até o Passo 1 ser validado por mais tempo em campo (já foi — 2026-08-03). Candidatas a remoção na próxima limpeza de código, mesmo padrão do `ITENS` hardcoded (§2.14): replace→verify→delete. *(O objeto `ITENS` hardcoded, citado em versões antigas deste documento como pendência equivalente, já foi removido em 2026-07-30 — não é mais pendência, ver §2.14.)*

### 7.3 Escopo futuro registrado (não implementado — decisões conscientemente adiadas)

* **Visual "bonito"/grade de ícones na tela de inventário.** Adiado de propósito no Round 3 (§2.12) — fica para quando os ícones reais do Godot chegarem, pra não retrabalhar o layout duas vezes. (Inventário clicável em si — abrir/fechar, abas, equipar/desequipar com destaque visual — já foi concluído no Round 3.)
* **Coleta de loot de equipamento no mapa (Passo 5 do Bloco Loot & Inimigos, §2.20).** Não existe nenhum caminho de código pra isso hoje; equipamento de teste sempre foi inserido manualmente via SQL. Investigação de debug concluída em 2026-08-25 (§2.20: resíduo nulo do sistema de moeda removido no Round 2, `map_items` existe no schema mas não serve pro caso dinâmico, não há `INSERT` em `inventario`, detecção de toque hoje é collider client-side). **Implementação NÃO iniciada por decisão do dono** — feature a construir do zero na próxima sessão, agora desacoplada do inventário clicável, que já está pronto (§2.12), e alimentada pela decisão do Passo 4 (`rolarDrops`, §2.19).
* **Pico de abate proporcional para boss (P3 do Bloco Loot & Inimigos, §2.17/§2.18).** Decisão consciente do dono (§2.16): comuns (incluindo o Elite do P2) não têm pico de abate, mas boss deve ter — XP proporcional/pico ao abater, possivelmente com memória de dano causado por jogador (relevante quando múltiplos jogadores batem no mesmo boss). Boss com abate proporcional ainda não existe como conceito de código — inimigos hoje vêm de 5 tipos na tabela `mobs` (Comum/Fraco/Medio/Forte/Elite, todos no mesmo caminho único de XP-por-dano da §2.16, ponderados só pelo multiplicador `experiencia_dropada`; o Elite já tem raridade via `peso_spawn`, §2.18, mas isso não é abate proporcional). Adiado pra fase de loot — implementar junto do sistema de boss, não antes. Lembrar da nota técnica de `DECIMAL`/`mysql2` (§2.16, já reapareceu uma vez em §2.17 sem virar bug) se essa feature ler alguma coluna decimal nova.
* **Login/contas.** Destrava: seleção de personagem filtrada por dono (em vez de pool compartilhado, §1.2), posse real de personagem, e fecha a janela de "roubo" de personagem pós-morte.
* **Combate com ação intencional (ataque/defesa).** Hoje é só colisão física ferindo os dois lados; não há gatilho deliberado de ataque/bloqueio.
* **Migração para Modelo A de conexão** (`NetworkManager`, socket único entre cenas) — preparação mínima já feita (`networkConfig.js`, §1.2); migração em si é pacote próprio futuro.
* **`hp_max` não persistido no banco** — sempre recalculado de classe+nível via `recalcularAtributosEfetivos`. Decisão consciente de design (fonte única de verdade), não descuido; revisar só se o modelo de progressão mudar.
* **Integração dos sprites do Godot** — arte placeholder atual será substituída pela arte da equipe de design.
* **Afinamento de câmera com sprites reais** — reintroduzir suavização de câmera sincronizada com o passo de física; adiado porque resolução/estilo/tamanho em pixels do personagem real ainda não estão definidos (decidir só quando a arte chegar).
* **Loop de prestígio / new game+** — personagem fica forte demais e "colapsa" para uma fase mais avançada.
* **Tabela `classes`, tabela `map_items` (loot de mapa; renomeada de `itens_instanciados_mapa` no schema real da A1 — ver nota em §2), Redis/cache, anti-cheat de validação de posição** — adiados desde a spec original da Fase 2 (§9.1), continuam fora de escopo. As tabelas já existem no schema `jogo_pi`, mas nenhum código lê/escreve nelas ainda. *(Atualização 2026-08-03: a tabela `mobs` — distinta de `mob_drops` — saiu dessa lista; passou a ser populada e lida pelo servidor no Passo 1 do Bloco Loot & Inimigos, ver §2.17. Atualização 2026-08-25: `mob_drops` também saiu dessa lista — populada e lida pelo servidor no Passo 4, §2.19. `map_items` continua parada, sem código algum lendo/escrevendo — é o Passo 5 do mesmo bloco, §2.20, investigado mas não implementado.)*

---

## 8. Ordem de Execução e Regra de Avanço (histórico — já cumprida)

Executar os pacotes na ordem 1 → 2 → 3 → 4 → 5. **Um pacote só é dado como concluído após passar em todos os itens do seu critério de teste obrigatório.** O agente não deve avançar para o próximo pacote enquanto o atual não estiver validado. Ao concluir cada pacote, registrar brevemente o que foi feito e o resultado dos testes — o registro de execução de cada pacote está em §2.3-§2.7.

---

## 9. Apêndice — Especificação de Execução Original da Fase 2 (histórico, ex-`fase2_spec.md`)

> **Natureza deste apêndice:** texto originalmente publicado como arquivo separado `fase2_spec.md`, incorporado aqui na íntegra em 2026-07-26 (decisão de unificar toda a documentação do projeto num único arquivo, ver nota no topo deste documento). A numeração interna (`§1`, `§1.1`...`PACOTE 1`...`APÊNDICE A`) foi preservada tal como no original para que comentários de código existentes (`UIScene.js`, `ExploracaoCombate.js`, `server/server.js`, scripts `server/test_*.js`) que citam "`fase2_spec.md §X`" continuem apontando para o lugar certo. Esta é uma **especificação já executada por completo** (Pacotes 1-5, ver §2.3-§2.7 e §2.8-§2.11 acima) — mantida aqui como registro histórico do contrato original, não como trabalho pendente.

> **Natureza deste documento (texto original):** Esta é uma **especificação de execução fechada**, destinada a ser consumida por um agente de IA implementador (Claude Code, Cursor, etc.). Ela é subordinada ao `AGENTS.md` (constituição técnica) e complementa este roadmap. Ao ser concluída e validada, seu conteúdo foi incorporado ao roadmap oficial (este apêndice).
>
> **Este documento descreve a Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão).** Ele é dividido em 5 pacotes sequenciais. Cada pacote possui escopo travado, contrato de dados e critério de teste obrigatório.

### 9.0 REGRAS DE CONTENÇÃO DO AGENTE (LEIA ANTES DE QUALQUER LINHA DE CÓDIGO)

Estas regras existem para impedir que o agente implementador extrapole o escopo, invente funcionalidades ou "melhore" o que não foi pedido. Violá-las é uma falha de execução, independentemente da qualidade do código gerado.

1. **Implemente APENAS o que está descrito no pacote em execução.** Não adicione features, campos, endpoints, tabelas, tipos de mensagem ou abstrações que não estejam explicitamente especificados. Se algo parecer "faltando" ou "que ficaria melhor", NÃO adicione — registre como observação ao final e siga.
2. **Não antecipe pacotes futuros.** Não implemente inventário no Pacote 1. Não implemente login em nenhum pacote (está formalmente adiado). Cada pacote é uma entrega isolada.
3. **Não invente valores.** Onde a spec disser "valor arbitrário de teste", use o valor exato fornecido. Não substitua por números "mais realistas" nem gere novos.
4. **Não invente contratos de rede.** Os tipos de mensagem WebSocket permitidos em cada pacote estão listados explicitamente. Não crie novos tipos, não renomeie os existentes, não altere os payloads sem instrução.
5. **Não crie código para casos não especificados.** Se a spec não descreve o comportamento de um caso de borda, o comportamento correto é o mais conservador (rejeitar/ignorar), NÃO inventar uma regra de jogo nova.
6. **Exceção de auto-correção durante teste:** Se, ao rodar o critério de teste de um pacote, o agente detectar uma falha real (erro de runtime, comportamento divergente do contrato, quebra de uma regra do `AGENTS.md`), ele DEVE corrigir a falha detectada. Esta é a única situação em que o agente age além da letra da spec — e mesmo assim, apenas para fazer o comportamento convergir ao contrato documentado, nunca para adicionar escopo.
7. **Respeite a constituição.** Todo código deve obedecer ao `AGENTS.md`: desacoplamento Phaser/regra de negócio, zero alocação de objeto no `update()`, limpeza de listeners em transição de cena, nenhuma query MySQL dentro de cenas Phaser (persistência é exclusiva do servidor Node).
8. **Nenhum pacote é considerado concluído sem passar no seu critério de teste.** O agente não deve marcar um pacote como pronto nem avançar para o próximo enquanto o teste do atual não passar.

### 9.1 CONTEXTO ARQUITETURAL CONSOLIDADO (decisões já tomadas — não rediscutir)

O agente deve tratar as decisões abaixo como fixas. Elas foram deliberadas e travadas.

- **Canal único WebSocket.** Toda comunicação client↔servidor passa pelo WebSocket existente (`ws`, porta 8080). Não há API REST. Não há Redis. (Ambos documentados como evolução futura de escala, fora do escopo atual.)
- **Servidor autoritário.** O servidor Node.js é a fonte da verdade sobre todo dado que afeta regra de jogo: atributos, dano, XP, nível, posição validada. O client envia *intenções* e *renderiza* respostas; nunca calcula nada que importe.
- **Três conceitos de identidade, separados:**
  - **Conexão** — o socket WebSocket. Efêmero. Morre e renasce livremente. NÃO é identidade.
  - **Personagem** — uma linha na tabela `personagens` do MySQL, identificada pela PK `id`. É o que persiste entre sessões. É o "crachá" do jogador.
  - **Classe** — um atributo do personagem (`guerreiro`, `mago`, `arqueiro`, `suporte`, `tanque`). Escolhida apenas no nascimento do personagem. Não é identidade.
- **Molde de classe = semente hardcoded no servidor.** Os atributos iniciais de cada classe vivem num objeto constante no código do servidor. Eles definem apenas com o que um personagem daquela classe *nasce*. (Tabela `classes` no banco = evolução futura, fora do escopo.)
- **Progressão por recálculo.** O banco persiste o `nivel` (e `experiencia`). Os atributos efetivos (`hp_max`, `dano_base`, `defesa_base`) são **derivados no carregamento** pela fórmula `base_da_classe + buff(nivel)`. NÃO se persiste o resultado do buff; ele é recalculado toda vez que o personagem entra. Isso garante fonte única de verdade e rebalanceamento retroativo.
- **Persistência assíncrona e escalonada.** Eventos críticos (subir de nível, futuramente equipar/coletar) gravam na hora. Posição e HP gravam por snapshot periódico (~10s) e obrigatoriamente no disconnect.
- **Adiados e documentados (NÃO implementar):** login/autenticação, tabela `classes`, tabela `itens_instanciados_mapa` (moedas do mapa permanecem efêmeras em memória com respawn), Redis/cache, anti-cheat de validação de posição.

### PACOTE 1 — Identidade de Personagem e Trilho de Leitura do Banco

**Objetivo do pacote:** Fazer o servidor parar de identificar jogadores por conexão (`player_1`, `player_2`...) e passar a identificá-los por **personagem carregado do MySQL**. Ao fim deste pacote, um jogador entra informando qual personagem controla, e o servidor carrega os dados reais desse personagem do banco. **Este pacote apenas LÊ do banco; não grava nada de volta** (a escrita é o Pacote 2).

#### 9.1.1 Por que este pacote vem primeiro

No código atual, a identidade do jogador está colada à conexão: cada socket novo vira um `player_N` incremental, criado hardcoded na posição `1000,1000` com HP fixo. Isso funcionava enquanto tudo era efêmero. No momento em que introduzimos persistência, isso quebra: se a identidade morre junto com o socket (ao morrer, cair a conexão, ou fechar o jogo), o servidor não sabe *qual linha do banco* representa aquele jogador — e passaria a salvar/buscar dados na linha errada ou a criar linhas duplicadas. Portanto, **separar conexão de identidade é pré-requisito de qualquer persistência.** Nada pode ser salvo antes de o servidor saber, de forma estável, quem é o jogador.

#### 9.1.2 Escopo travado (o que ESTE pacote faz)

1. Subir o schema mínimo no MySQL (apenas `jogadores` e `personagens` — sem `inventario`, sem tabelas adiadas).
2. Popular o banco manualmente com personagens de teste (um por classe, ou o subconjunto necessário para testar).
3. Plugar o pool de conexão `mysql2` no servidor Node.
4. Definir o objeto de molde das classes (semente hardcoded) no servidor.
5. Definir a fórmula de buff por nível (necessária já aqui, porque o carregamento depende dela — consequência da decisão "recalcular").
6. Substituir o handshake atual pelo fluxo `join`: o client conecta anônimo e envia uma mensagem `join` com o `personagem_id`; o servidor busca a linha, aplica o molde + buff, e insere o jogador no `gameState` com atributos reais.
7. Implementar a trava de sessão em memória (mesmo `personagem_id` não pode estar ativo em duas conexões simultâneas).

#### 9.1.3 Fora de escopo (o que ESTE pacote NÃO faz)

- Não grava nada no banco (sem UPDATE, sem INSERT em runtime).
- Não implementa inventário.
- Não implementa criação de personagem via UI nem seleção de classe pelo jogador (os personagens de teste são inseridos manualmente no banco).
- Não implementa login/senha.
- Não altera a lógica de inimigos nem de itens do mapa.

#### 9.1.4 Schema MySQL a aplicar

Aplicar exatamente as duas tabelas abaixo. NÃO criar outras tabelas neste pacote.

```sql
CREATE TABLE IF NOT EXISTS jogadores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    senha_hash VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS personagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jogadores_id INT NOT NULL,
    nome VARCHAR(50) NOT NULL,
    classe VARCHAR(30) NOT NULL,
    nivel INT DEFAULT 1,
    experiencia INT DEFAULT 0,
    hp_atual INT NOT NULL,
    hp_max INT NOT NULL,
    dano_base INT NOT NULL,
    defesa_base INT NOT NULL,
    posicao_x FLOAT DEFAULT 100.0,
    posicao_y FLOAT DEFAULT 100.0,
    cena_atual VARCHAR(50) DEFAULT 'HubCentral',
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_personagem_jogador FOREIGN KEY (jogadores_id) REFERENCES jogadores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **Nota sobre `hp_max`/`dano_base`/`defesa_base` no schema:** por termos escolhido o modelo de recálculo, estes campos existem no schema mas são tratados como **derivados** em runtime — o servidor os recalcula a partir de `classe + nivel` ao carregar. Os valores gravados nas linhas de teste servem apenas como registro inicial; a verdade em runtime vem do recálculo. (A normalização completa desses campos é evolução futura e não deve ser feita agora.)

#### 9.1.5 Dados de teste a inserir manualmente

Inserir ao menos um registro em `jogadores` e um personagem por classe a ser testada. Como login está adiado, `senha_hash` pode receber um placeholder fixo (ex.: `'placeholder'`). As 5 classes oficiais do projeto são: **guerreiro, mago, arqueiro, suporte, tanque**.

Exemplo de inserção (o agente pode ajustar nomes, mas deve cobrir as classes a testar):

```sql
INSERT INTO jogadores (username, senha_hash) VALUES ('teste', 'placeholder');
-- assumindo jogadores.id = 1
INSERT INTO personagens (jogadores_id, nome, classe, nivel, hp_atual, hp_max, dano_base, defesa_base)
VALUES
  (1, 'Guerreiro Teste', 'guerreiro', 1, 100, 100, 25, 5),
  (1, 'Mago Teste',      'mago',      1, 60,  60,  40, 3),
  (1, 'Arqueiro Teste',  'arqueiro',  1, 70,  70,  35, 3),
  (1, 'Suporte Teste',   'suporte',   1, 80,  80,  20, 4),
  (1, 'Tanque Teste',    'tanque',    1, 150, 150, 15, 8);
```

> **IMPORTANTE (contenção):** os números acima são **valores arbitrários de teste**, definidos por decisão do projeto para destravar a Fase 2. Não são finais e o balanceamento será feito depois. O agente NÃO deve "corrigir", "equilibrar" ou substituir esses números por outros que julgue melhores.

#### 9.1.6 Molde de classe (semente hardcoded no servidor)

Definir no servidor um objeto constante com os atributos-base de nascimento por classe. Estes são os mesmos valores de teste acima, representando o nível 1 puro de cada classe, ANTES de qualquer buff.

```javascript
// Semente de nascimento por classe. Valores arbitrários de teste (não finais).
// Representa o estado base no nível 1, antes de qualquer buff de nível.
const CLASSES = {
    guerreiro: { hp_max: 100, dano_base: 25, defesa_base: 5 },
    mago:      { hp_max: 60,  dano_base: 40, defesa_base: 3 },
    arqueiro:  { hp_max: 70,  dano_base: 35, defesa_base: 3 },
    suporte:   { hp_max: 80,  dano_base: 20, defesa_base: 4 },
    tanque:    { hp_max: 150, dano_base: 15, defesa_base: 8 }
};
```

#### 9.1.7 Fórmula de buff por nível

Necessária já neste pacote porque o carregamento do personagem depende dela (modelo de recálculo). A fórmula de progressão de XP e a de buff de atributo são simples nesta fase, por decisão do projeto:

- **XP necessário para alcançar o próximo nível:** `nivel * 100` (ex.: sair do nível 1 para o 2 exige 100 de XP acumulado além do limiar anterior). *A lógica de ganho e checagem de XP é implementada no Pacote 2; aqui só se define a fórmula de buff de atributo, usada na leitura.*
- **Buff de atributo por nível:** o atributo efetivo é a base da classe mais um incremento proporcional aos níveis acima de 1. Fórmula:

```
niveis_acima = nivel - 1
hp_max_efetivo    = CLASSES[classe].hp_max    + (niveis_acima * BUFF_HP)
dano_base_efetivo = CLASSES[classe].dano_base + (niveis_acima * BUFF_DANO)
defesa_efetiva    = CLASSES[classe].defesa_base + (niveis_acima * BUFF_DEFESA)
```

Constantes de buff (valores arbitrários de teste, não finais):

```javascript
const BUFF_HP = 10;
const BUFF_DANO = 5;
const BUFF_DEFESA = 2;
```

> No nível 1, `niveis_acima = 0`, portanto os atributos efetivos igualam exatamente a semente da classe. Isso deve ser verdade e é verificável no teste.

#### 9.1.8 Contrato de rede deste pacote

Tipos de mensagem permitidos (client→servidor) NOVOS neste pacote:

- **`join`** — `{ type: 'join', personagem_id: <int> }` — enviado pelo client logo após a conexão abrir, para reivindicar o controle de um personagem existente.

Comportamento do servidor ao receber `join`:

1. Se o `personagem_id` já estiver na trava de sessão ativa → recusar (enviar mensagem de erro ou fechar a conexão de forma controlada). NÃO carregar.
2. Buscar a linha do personagem no MySQL. Se não existir → recusar. NÃO criar personagem novo (criação é fora de escopo).
3. Se existir e estiver livre → carregar: aplicar molde da classe + buff do nível para montar os atributos efetivos; inserir o jogador no `gameState.players` chaveado pelo `personagem_id`; registrar na trava de sessão; enviar o `welcome` (estado do mundo) e fazer broadcast de entrada, como o fluxo atual já faz — porém agora com dados reais e identidade estável.

Os tipos de mensagem existentes (`player_move`, `pickup_item`, `attack_enemy`, e os broadcasts do servidor) permanecem funcionando. **Não renomear, não alterar payloads existentes neste pacote.** (A reconciliação das divergências de nomenclatura entre código e roadmap é tarefa de documentação do Pacote 5.)

#### 9.1.9 Trava de sessão

Manter em memória no servidor (não no banco) um registro dos `personagem_id` atualmente ativos. Ao conectar via `join`, recusar duplicata. Ao desconectar (`close`), remover da trava. Esta trava é efêmera por natureza e não deve ser persistida.

#### 9.1.10 Ajuste na chave de identidade do gameState

Hoje `gameState.players` é chaveado por `player_N` (conexão). Passar a chavear por `personagem_id`. Toda referência que hoje usa o id de conexão deve passar a usar a identidade de personagem. O socket continua existindo como transporte, mas deixa de ser a chave de identidade.

#### 9.1.11 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 1)

O pacote só é considerado concluído se TODOS os itens abaixo passarem:

1. **Carregamento real:** conectar um client informando `join` com um `personagem_id` válido (ex.: o mago de teste). Confirmar que o jogador entra no mundo com os atributos daquele personagem carregados do banco (HP e classe corretos), e NÃO com os valores hardcoded antigos (`1000,1000`, HP 100 fixo).
2. **Nível 1 = semente pura:** confirmar que um personagem nível 1 carrega com atributos idênticos ao molde da classe (buff zero). Ex.: mago nível 1 → `hp_max = 60`, `dano_base = 40`, `defesa_base = 3`.
3. **Buff aplicado:** alterar manualmente no banco o `nivel` de um personagem de teste para 3, reconectar, e confirmar que os atributos efetivos refletem `base + 2 * buff` (ex.: mago nível 3 → `hp_max = 60 + 20 = 80`, `dano_base = 40 + 10 = 50`, `defesa_base = 3 + 4 = 7`).
4. **Trava de sessão:** tentar conectar dois clients com o mesmo `personagem_id`. Confirmar que o segundo é recusado.
5. **Personagem inexistente:** tentar `join` com um `personagem_id` que não existe no banco. Confirmar que a conexão é recusada e nenhum personagem é criado.
6. **Sem escrita:** confirmar que, durante todo o teste, nada foi gravado no banco (os dados das linhas de teste permanecem como inseridos). A escrita é do Pacote 2.

### PACOTE 2 — Persistência de Volta e Sistema de Progressão (XP/Nível)

**Objetivo do pacote:** Fechar o loop. O servidor passa a **gravar** no banco, e o sistema de XP/nível entra em operação. Ao fim deste pacote, um jogador entra, joga, ganha XP, sobe de nível, sai e volta — encontrando seu personagem exatamente no estado em que parou. Este é o pacote que prova o valor da Fase 2.

#### 9.2.1 Por que agora

O Pacote 1 estabeleceu identidade estável e leitura do banco. Sem identidade estável, gravar era impossível (não se sabia em qual linha). Com ela pronta, a escrita se torna segura. E como escolhemos o modelo de recálculo, a progressão (XP/nível) precisa entrar já aqui — o carregamento do Pacote 1 já depende da fórmula de buff, então operacionalizar o ganho de nível é a consequência natural e imediata.

#### 9.2.2 Escopo travado

1. **Snapshot periódico:** a cada ~10 segundos, gravar posição (`posicao_x`, `posicao_y`) e `hp_atual` de cada jogador ativo no banco.
2. **Save no disconnect:** ao receber `close` de um socket, gravar o estado final (posição, `hp_atual`, `nivel`, `experiencia`) do personagem correspondente ANTES de removê-lo do `gameState` e da trava de sessão. (Resolve o Risco I do roadmap: inconsistência em queda de conexão.)
3. **Ganho de XP:** ao matar um inimigo, o jogador que desferiu o golpe fatal ganha XP (valor arbitrário de teste a definir, ex.: 50 XP por inimigo). O servidor incrementa `experiencia`.
4. **Checagem e subida de nível:** após ganhar XP, o servidor verifica se `experiencia` atingiu o limiar do próximo nível (`nivel * 100`). Se sim, incrementa `nivel`, subtrai/ajusta o XP conforme o modelo escolhido, e **grava o novo `nivel` e `experiencia` no banco imediatamente** (evento crítico). Como usamos recálculo, NÃO se grava novo `hp_max`/`dano_base`; eles se derivam sozinhos no próximo carregamento. Porém, os atributos efetivos EM MEMÓRIA (`gameState`) devem ser recalculados na hora da subida de nível, para que o buff valha na sessão corrente sem exigir reconexão.
5. **Notificação de subida de nível:** emitir um broadcast (novo tipo de mensagem) informando que o personagem subiu de nível e seus novos atributos efetivos, para o client atualizar a renderização.

#### 9.2.3 Fora de escopo

- Não implementa inventário.
- Não persiste itens do mapa.
- Não implementa fórmulas de XP/buff complexas (curvas, diminishing returns) — mantém `nivel * 100` e buff linear.
- Não implementa reconciliação entre XP excedente e múltiplas subidas de nível num único ganho, a menos que o valor de XP por kill possa ultrapassar dois limiares de uma vez; se puder, tratar de forma simples (loop de subida enquanto o limiar for atingido), sem inventar mecânica adicional.

#### 9.2.4 Contrato de rede deste pacote

Tipos NOVOS (servidor→client):

- **`level_up`** — `{ type: 'level_up', personagem_id: <int>, nivel: <int>, hp_max: <int>, dano_base: <int>, defesa_base: <int>, hp_atual: <int> }` — emitido quando um personagem sobe de nível, com os atributos efetivos recalculados.

Os tipos existentes de combate/morte permanecem. O `enemy_died` já existente continua sendo o gatilho a partir do qual o XP é concedido ao `killerId`.

#### 9.2.5 Regras de gravação (contenção)

- Snapshot e save no disconnect gravam via UPDATE na linha do personagem. Nunca via INSERT (o personagem já existe).
- Toda query MySQL vive no servidor Node. Nenhuma query em cena Phaser (regra do `AGENTS.md`).
- Gravações são assíncronas e não devem bloquear o tick loop de 20Hz. Erros de gravação devem ser logados, não devem derrubar o servidor.

#### 9.2.6 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 2)

1. **Persistência de posição:** entrar, mover o personagem para uma posição distinta da inicial, aguardar o snapshot (~10s), desconectar. Reconectar e confirmar que o personagem reaparece na posição salva, não na inicial.
2. **Persistência de HP:** sofrer dano, aguardar snapshot ou desconectar, reconectar e confirmar que o `hp_atual` reflete o dano sofrido.
3. **Ganho de XP:** matar um inimigo e confirmar (via `SELECT` no banco ou log) que `experiencia` do matador aumentou.
4. **Subida de nível:** acumular XP suficiente para cruzar o limiar (`nivel * 100`). Confirmar que: (a) `nivel` incrementa no banco; (b) o broadcast `level_up` é emitido; (c) os atributos efetivos em memória aumentam conforme o buff na mesma sessão; (d) ao reconectar, o personagem carrega já no nível novo com os atributos derivados corretos.
5. **Save no disconnect:** matar inimigo (ganhar XP), desconectar imediatamente (sem esperar snapshot), reconectar e confirmar que o XP ganho foi preservado.
6. **Não-bloqueio:** confirmar que as gravações não introduzem travamento perceptível no tick de 20Hz nem no movimento dos jogadores.

### PACOTE 3 — Correção de Bugs de Constituição (Higiene de Rede e Loop)

**Objetivo do pacote:** Corrigir duas violações do `AGENTS.md` já presentes no código atual, independentes de persistência, aproveitando que os arquivos de rede já estarão abertos. São correções pequenas e cirúrgicas.

#### 9.3.1 Por que agora

Estas são violações preexistentes da constituição, não introduzidas pela Fase 2. São corrigidas aqui por conveniência (os arquivos envolvidos já estão sendo tocados) e por baixo risco. Não dependem dos pacotes anteriores, mas são melhor validadas depois que o fluxo de rede está estável.

#### 9.3.2 Escopo travado

1. **Throttle de envio de movimento 60Hz → 20Hz.** Hoje o `update()` de `ExploracaoCombate` envia `player_move` a cada frame (~60Hz). O roadmap e o Risco II definem o limite em 20Hz (50ms). Alterar para que o envio de movimento ocorra no máximo a cada 50ms. Implementar via acumulador de tempo (delta) ou timer dedicado, NÃO criando objetos novos por frame.
2. **Eliminar alocação de objeto no `update()`.** Hoje o envio faz `JSON.stringify({...})` a cada frame, criando um objeto literal e uma string novos — violação da Regra Absoluta nº 3 do `AGENTS.md`. Reestruturar para reutilizar um objeto de payload declarado no escopo da cena (mutar seus campos em vez de recriá-lo), serializando apenas no momento do envio já throttled.

#### 9.3.3 Fora de escopo

- Não refatorar o `onmessage` (isso é Pacote 5).
- Não alterar a lógica de interpolação, combate ou renderização de HP.
- Não alterar o tick rate do servidor (já está correto em 20Hz).

#### 9.3.4 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 3)

1. **Frequência de envio:** instrumentar (log ou contador temporário) a taxa de emissão de `player_move` e confirmar que não excede ~20 mensagens por segundo por client, mesmo com o jogo rodando a 60 FPS.
2. **Suavidade preservada:** confirmar que, com o throttle ativo e a interpolação (lerp) no receptor, o movimento dos jogadores remotos permanece visualmente suave (sem travões perceptíveis).
3. **Zero alocação no loop:** revisar o `update()` e confirmar que nenhum objeto literal (`{}`), array (`[]`) ou lambda é criado dentro dele no caminho de envio. O objeto de payload deve ser reutilizado.

### PACOTE 4 — Sistema de Inventário

**Objetivo do pacote:** Implementar inventário com autoridade no servidor e renderização desacoplada no client. Só agora, com identidade e persistência sólidas.

#### 9.4.1 Por que por último (antes da documentação)

Inventário depende de identidade estável (Pacote 1) e de persistência funcionando (Pacote 2). Construí-lo antes seria erguer uma feature complexa sobre fundação instável. Com os pacotes anteriores validados, o inventário se apoia em trilhos confiáveis.

#### 9.4.2 Escopo travado

1. Criar a tabela `inventario` no MySQL.
2. Implementar `InventoryManager` como camada de domínio **no servidor** (não no client): valida requisitos, adiciona/remove itens, equipa/desequipa, recalcula atributos efetivos ao equipar, persiste no MySQL.
3. Criar `UIScene` paralela no Phaser: uma cena de interface que renderiza o inventário em grid de slots. Esta cena **apenas desenha** o que o servidor informa; não calcula atributos nem decide validade de equipar.
4. Coletar um item de mapa deixa de conceder apenas `score` e passa a inserir um item real no inventário do personagem (via servidor).
5. Equipar/desequipar item recalcula os atributos efetivos NO SERVIDOR e emite um evento de atualização de stats para o client redesenhar.

> **Nota histórica (2026-07-26):** o item 4 acima (coleta de moeda concedendo item de inventário) foi implementado como especificado, mas removido por completo no Round 2 pós-Fase 2 por decisão de design — ver §1.3 e §2.10. O texto original do pacote é mantido aqui intacto para registro do que foi pedido e executado na época.

#### 9.4.3 Schema a adicionar

```sql
CREATE TABLE IF NOT EXISTS inventario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personagem_id INT NOT NULL,
    item_id VARCHAR(50) NOT NULL,
    quantidade INT DEFAULT 1,
    tipo VARCHAR(30) NOT NULL,
    equipado BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_inventario_personagem FOREIGN KEY (personagem_id) REFERENCES personagens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 9.4.4 Contrato de rede deste pacote

Tipos NOVOS (client→servidor): `equip_item` `{ inventario_id }`, `unequip_item` `{ inventario_id }`. (Nomes exatos a confirmar no início do pacote; não inventar variações fora destes.)

Tipos NOVOS (servidor→client): `inventory_update` (estado do inventário do jogador), `stats_updated` (atributos efetivos após equipar/desequipar).

#### 9.4.5 Fora de escopo

- Drag & drop sofisticado de UI pode ser simplificado para clique-equipar na primeira versão; não inventar sistema de arrastar complexo sem instrução.
- Não implementar crafting, troca entre jogadores, ou tipos de item além dos necessários para testar (consumível e equipamento).
- Interação com atributos deve reusar a fórmula de recálculo já existente; não criar um segundo sistema de atributos.

#### 9.4.6 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 4)

1. **Coleta persiste:** coletar um item, desconectar, reconectar e confirmar (via `SELECT * FROM inventario WHERE personagem_id = X`) que o item permanece no inventário.
2. **Equipar altera atributos:** equipar um item de equipamento e confirmar que os atributos efetivos do personagem aumentam conforme o item, com o cálculo feito pelo servidor.
3. **Autoridade do servidor:** confirmar que o client não calcula atributos localmente — o número exibido vem exclusivamente do `stats_updated` do servidor.
4. **Desacoplamento:** confirmar que a `UIScene` apenas renderiza e que nenhuma regra de inventário reside em Sprites/Containers Phaser (regra do `AGENTS.md`).
5. **Persistência de equipado:** equipar item, desconectar, reconectar e confirmar que o item continua marcado como equipado e o atributo reflete isso.

### PACOTE 5 — Higiene de Código e Reconciliação da Documentação

**Objetivo do pacote:** Pagar a dívida técnica de estrutura acumulada e alinhar a documentação oficial com o que foi efetivamente construído.

#### 9.5.1 Escopo travado

1. **Refatorar o `onmessage` monolítico** de `ExploracaoCombate` (cadeia extensa de `if/else` por `data.type`) para um despacho por mapa de handlers ou um módulo `NetworkManager` dedicado, respeitando o desacoplamento do `AGENTS.md`. A esta altura o número de tipos de mensagem terá crescido bastante e a cadeia condicional é insustentável.
2. **Reconciliar a documentação (Regra 6 do `AGENTS.md`):**
   - Alinhar as divergências de nomenclatura de protocolo entre `roadmap_game.md` e o código real (ex.: `player_attack`/`attack_enemy`, `pickup_item_request`/`pickup_item`, `player_join`/`join`). Definir os nomes canônicos e atualizar ambos os documentos.
   - Registrar formalmente no `AGENTS.md`/roadmap todas as decisões travadas nesta spec: WebSocket-only, recálculo de atributos, molde de classe hardcoded, persistência escalonada, e a lista de itens adiados (login, tabela `classes`, `itens_instanciados_mapa`, Redis, anti-cheat de posição).
3. **Incorporar esta spec ao roadmap oficial** como registro da Fase 2 concluída.

#### 9.5.2 Fora de escopo

- Não reescrever sistemas que já passaram em seus testes só por estética.
- Não introduzir novas dependências ou frameworks.

#### 9.5.3 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 5)

1. **Paridade funcional pós-refatoração:** após refatorar o `onmessage`, rodar novamente os testes dos Pacotes 1, 2 e 4 e confirmar que todos continuam passando. A refatoração não pode alterar comportamento.
2. **Documentação consistente:** confirmar que roadmap e `AGENTS.md` não contêm mais contradições de nomenclatura de protocolo com o código, e que as decisões e adiamentos estão registrados.

### 9.A — Resumo dos Valores Arbitrários de Teste

Todos os valores abaixo foram definidos por decisão do projeto **apenas para destravar o desenvolvimento**. São provisórios, não balanceados, e não devem ser alterados pelo agente por conta própria.

| Item | Valor de teste | Onde |
|---|---|---|
| Classes oficiais | guerreiro, mago, arqueiro, suporte, tanque | Molde + banco |
| Buff HP por nível | +10 | `BUFF_HP` |
| Buff dano por nível | +5 | `BUFF_DANO` |
| Buff defesa por nível | +2 | `BUFF_DEFESA` |
| XP para próximo nível | ~~`nivel * 100`~~ **superseded 2026-07-31 — lê `table_nivel` do banco, ver §2.15** | Fórmula de progressão |
| XP por inimigo comum morto | ~~50 fixo~~ **superseded 2026-08-02 — sem pico de abate, ver §2.16** | Ganho de XP |
| XP por golpe (comum) | `dano_efetivo × 0.1`, todo golpe inclusive o que mata, sem `Math.floor` (modelo atual, 2026-08-02) | `XP_POR_DANO`, ver §2.16 |
| `personagens.experiencia` (tipo) | ~~`INT`~~ **`DECIMAL(12,2)` desde 2026-08-02**, ver §2.16 | Coluna do schema |
| Tipos de inimigo (`mobs`, vida/ataque/defesa/mult. XP/peso_spawn) | Comum 50/15/2/1.0/30, Fraco 70/18/3/1.3/25, Medio 100/22/4/1.6/20, Forte 140/28/6/2.0/15, Elite 250/40/10/3.5/5 — sorteio **ponderado** por `peso_spawn` desde 2026-08-13 (~~sorteio uniforme, 2026-08-03~~) | Tabela `mobs`, ver §2.17/§2.18 |
| `mobs.experiencia_dropada` (tipo) | ~~`INT`~~ **`DECIMAL(4,2)` desde 2026-08-03** — é multiplicador de XP, não XP fixo | Coluna do schema, ver §2.17 |
| `mobs.peso_spawn` (tipo) | `INT NOT NULL DEFAULT 10` desde 2026-08-13 — peso relativo do sorteio ponderado, maior = mais frequente (Elite baixo = raro) | Coluna do schema, ver §2.18 |
| Intervalo de snapshot | ~10 segundos | Persistência periódica |