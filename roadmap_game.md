# roadmap_game.md — Roadmap Técnico e Próximos Passos de Desenvolvimento

**Status Atualizado:**
A **Fase 1 (Multiplayer LAN & WebSockets)** e a **Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão)** estão formalmente concluídas. A Fase 2 foi executada em 5 pacotes sequenciais (`fase2_spec.md`), todos implementados, testados e documentados (ver §2.3-§2.7 abaixo): identidade de personagem lida do MySQL (Pacote 1), persistência de volta + XP/nível (Pacote 2), throttle de rede do client (Pacote 3), sistema de inventário/equipamento (Pacote 4), e higiene de código + reconciliação de documentação (Pacote 5). O servidor MySQL local (`rpg_game`) está de pé, com schema completo (`jogadores`, `personagens`, `inventario`), personagens de teste populados e usuário dedicado `rpg_app` operante. O servidor grava no banco em tempo real: snapshot periódico (~10s), save no disconnect, XP/nível e inventário/equipamento (eventos críticos, gravação imediata).
**Foco Atual (Estado de parada):** Fase 2 completa. Uma pendência conhecida ficou registrada e não resolvida (feedback de `equip_item`/`unequip_item` recusado — precisa de um contrato de rede novo, fora do escopo do Pacote 5, aguardando decisão do responsável do projeto). Próxima decisão: iniciar a Fase 3 (Level Design Avançado) ou resolver essa pendência primeiro.

**Origem:** Documento mestre de especificação técnica e roadmap operacional para desenvolvimento solo do *Project Post-Apoc RPG / Horizon Co-op*. Este arquivo serve como contexto técnico e guia de execução contínua para qualquer agente de IA ou sessão de desenvolvimento.

---

## 1. Decisões Estruturais e de Arquitetura

1. **Desacoplamento Absoluto (Phaser vs. Regra de Negócio):**
O Phaser 4.1.0 atua puramente na camada de apresentação (Canvas/WebGL, rendering de sprites, animações, inputs e câmeras). Nenhuma regra de inventário, atributos de classe, cálculo de dano ou persistência reside dentro de Sprites ou Containers.
2. **Autoridade do Servidor e Sincronização LAN:**
A autoridade sobre a posição de inimigos, HP dos alvos, tabela de loot e estado da partida pertence ao servidor Node.js. O cliente envia intenções de comando (`player_move`, `attack_enemy`, `pickup_item`) e realiza interpolação visual (*lerp*) para suavizar a renderização dos outros jogadores.
3. **Persistência Relacional com MySQL:**
O MySQL é a fonte da verdade para dados persistentes (contas, personagens, atributos base, inventário e histórico). Transições entre cenas persistem no `registry` em memória temporária do Phaser e salvam assincronamente no MySQL.
4. **Arquitetura Baseada em Eventos (EventBus):**
Comunicação interna entre a UI do jogo e os módulos de domínio ocorre via EventBus global desacoplado (`this.game.events`, nativo do Phaser — implementado no Pacote 4 entre `ExploracaoCombate`/`UIScene`). Toda troca de cena exige a desmontagem explícita de *listeners*, cancelamento de *tweens* e *timers* para zerar riscos de *memory leaks*.

### 1.1 Decisões Travadas da Fase 2 (registro formal — fase2_spec.md §5.1.2)

Decisões deliberadas e fechadas durante a Fase 2 (Pacotes 1-4), registradas aqui formalmente por exigência do Pacote 5 e da Regra 6 do `AGENTS.md` (nunca alterar contrato sem atualizar a documentação):

* **Canal único WebSocket.** Toda comunicação client↔servidor passa pelo WebSocket existente (`ws`, porta 8080). Sem API REST, sem Redis — ambos avaliados como evolução futura de escala, fora do escopo atual.
* **Servidor autoritário sobre toda regra de jogo.** Atributos, dano, XP, nível, inventário e posição validada vivem e são calculados no servidor Node.js. O client envia intenções e renderiza respostas.
* **Modelo de recálculo de atributos.** `hp_max`/`dano_base`/`defesa_base` nunca são persistidos na tabela `personagens`. São sempre derivados em memória no `join`, na subida de nível e ao equipar/desequipar item, pela fórmula `base_da_classe(nivel) + soma_dos_itens_equipados` (`calcularAtributosEfetivos` + `recalcularAtributosEfetivos` em `server/server.js`). Garante fonte única de verdade e rebalanceamento retroativo.
* **Molde de classe hardcoded.** Atributos-base por classe (`CLASSES`) e catálogo de itens (`ITENS`) vivem como constantes no código do servidor, não em tabelas. Uma tabela `classes`/`itens` no banco é evolução futura, fora do escopo.
* **Persistência assíncrona e escalonada.** Eventos críticos (subida de nível, coleta de item, equipar/desequipar) gravam imediatamente. Posição e HP gravam por snapshot periódico (~10s, `server/server.js`) e obrigatoriamente no `disconnect`.
* **Itens formalmente adiados (não implementar sem nova autorização):** login/autenticação, tabela `classes`, tabela `itens_instanciados_mapa` (moedas do mapa continuam efêmeras em memória com respawn), Redis/cache, anti-cheat de validação de posição.

### 1.2 Decisões da Correção do Teste de Campo (pós-Fase 2, Round 1)

* **Modelo de posse dos personagens: pool compartilhado sem dono.** Sem login, não existe "personagem pertence ao jogador X". A cena `SelecaoPersonagem` lista **todos** os personagens do banco (`list_characters`/`character_list`), sem filtro por `jogadores_id`; qualquer jogador pode escolher qualquer um que não esteja `em_uso` (marcado via a trava de sessão já existente do Pacote 1). A trava de sessão em memória continua sendo a única garantia de "um personagem, um controlador por vez" — dois jogadores em LAN simplesmente escolhem personagens diferentes da lista. **Quando o login for implementado**, este modelo muda: a listagem passa a filtrar por `jogadores_id` (coluna já existente em `personagens`) e cada jogador só vê os próprios personagens. Essa migração pertence ao trabalho de login, não a este momento.
* **O que o login destrava de graça (lista viva, não fechada):** (1) seleção filtrada por dono em vez de pool aberto; (2) posse real de personagem em vez de "quem chegar primeiro"; (3) a janela de ~300ms entre `player_died` e o reconecte automático em que o personagem fica tecnicamente livre no pool (`liberarPersonagem`, ver correção da corrida de sessão abaixo) deixa de ser uma questão — num mundo com login, ninguém mais está olhando a lista de seleção do teu personagem pra "roubá-lo" nessa janela.
* **Correção de corrida — liberação de sessão acoplada à morte, não ao close do socket.** O teste de campo revelou que `activeSessions`/`gameState.players` só eram liberados no `ws.on('close')`, que é assíncrono e mais lento que o `join` automático do reconecte pós-morte — o servidor via o `personagem_id` ainda "em sessão ativa" e recusava o reconecte (`close(4000)`), reabrindo o modo zumbi por uma causa nova. Corrigido com `liberarPersonagem(player)` (`server/server.js`): função síncrona (remove de `gameState.players`/`activeSessions` antes de qualquer `await`; a gravação no banco roda em background) chamada tanto na morte (`attack_enemy`, antes de zerar a variável de sessão da conexão) quanto no `close` do socket — reaproveita o guard `personagemId !== null` já existente em vez de criar uma flag nova, então a conexão que já morreu vira no-op automático no seu próprio `close` eventual.
* **Modelo de conexão: B agora, A é o alvo.** Modelo B = socket por cena (cada cena que precisa de rede abre e fecha o próprio `WebSocket`; `SelecaoPersonagem` e `ExploracaoCombate` têm sockets independentes, sem estado compartilhado entre si). Modelo A = socket único, dono do jogo, vivendo entre cenas — necessário para features futuras de acampamento social (chat, comércio, party) que exigem conexão viva fora do combate. `networkConfig.js` (`SERVER_URL` + `sendMessage`) foi extraído agora para que a migração para A não exija caçar endereço/formato de mensagem espalhados pelas cenas — isso não é o `NetworkManager` da migração, só a preparação mínima. **Ordem acordada:** Modelo B agora → corrigir a dívida técnica de `playerStats`/`scene.restart()` → passar no teste de campo → só então migrar para A, como pacote próprio, sobre terreno estável.

---

## 2. Schema do Banco de Dados Relacional (MySQL 8.0+)

```sql
-- Schema Completo do Banco de Dados do Game (schema_game.sql)

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
    classe VARCHAR(30) NOT NULL, -- Ex: 'Tanque', 'Atirador', 'Suporte'
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

CREATE TABLE IF NOT EXISTS inventario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personagem_id INT NOT NULL,
    item_id VARCHAR(50) NOT NULL,
    quantidade INT DEFAULT 1,
    tipo VARCHAR(30) NOT NULL, -- Ex: 'Consumivel', 'Equipamento', 'Recurso'
    equipado BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_inventario_personagem FOREIGN KEY (personagem_id) REFERENCES personagens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS itens_instanciados_mapa (
    id VARCHAR(100) PRIMARY KEY,
    item_id VARCHAR(50) NOT NULL,
    posicao_x FLOAT NOT NULL,
    posicao_y FLOAT NOT NULL,
    coletado BOOLEAN DEFAULT FALSE,
    instancia_partida_id VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

```

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
│ FASE 1: Sincronização Multiplayer LAN & WebSockets (EM ANDAMENTO)       │
│ Node.js Server, Handshake, Broadcast de Movimento, Combat Sync         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 2: Sistema de Inventário, Equipamentos & Persistência MySQL       │
│ Drag & Drop UI, Atributos Dinâmicos, CRUD de Itens, Consumíveis        │
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
* [x] **Gestão do Mundo:** Configuração do mapa $2000 \times 2000$ px com limites físicos (`setBounds`) e câmera com rastreamento suave (*lerp* 0.08).
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

* **Coleta de Loot:**
* Client → Server (`pickup_item`): `{ itemId }`
* Server → Clients (`item_despawned`): `{ itemId, playerId }`
* Server → Clients (`items_respawned`): `{ items }`

* **Progressão (Pacote 2):**
* Server → Client (`level_up`): `{ personagem_id, nivel, hp_max, dano_base, defesa_base, hp_atual }`

* **Inventário (Pacote 4):**
* Client → Server (`equip_item` / `unequip_item`): `{ inventario_id }`
* Server → Client (`inventory_update`): `{ personagem_id, itens }`
* Server → Client (`stats_updated`): `{ personagem_id, hp_max, dano_base, defesa_base, hp_atual }`



---

### FASE 2: Sistema de Inventário, Equipamentos & Persistência Relacional (Status: ✅ Concluída — Pacotes 1-5/5)

> Esta fase é executada em 5 pacotes sequenciais, especificados em detalhe em `fase2_spec.md`. O registro de execução de cada pacote concluído é mantido na seção 2.3 abaixo.

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
         ├─► Se for equip_item e ITENS[item_id].tipo !== 'Equipamento' → recusa silenciosamente
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

**Próximo passo:** Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão) está **formalmente concluída** — Pacotes 1 a 5 implementados, testados e documentados. Próxima decisão do responsável do projeto: iniciar a Fase 3 (Level Design Avançado, Tilemaps & Spatial Partitioning) ou resolver a pendência do feedback de equip recusado antes.

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

## 6. Estado Exato para Retomada (Próxima Sessão de Código)

**Ponto de Parada Atual:** **Fase 2 completa — Pacotes 1 a 5 concluídos e validados** (ver §2.3-§2.7 acima e `fase2_spec.md`). O servidor lê identidade real do MySQL (personagem + inventário), aplica molde de classe + buff de nível + bônus de itens equipados (tudo em um único recálculo em memória, nunca persistido em `personagens`), grava snapshot periódico/disconnect/XP-nível/inventário, o client envia `player_move` throttled a ~20Hz e reage a `level_up`/`stats_updated`/`inventory_update` via um dispatch de handlers (não mais cadeia if/else). O Phaser roda duas cenas em paralelo durante o combate: `ExploracaoCombate` (jogo) e `UIScene` (inventário, apenas renderização). Documentação (`roadmap_game.md`) reconciliada com o código real — sem mais divergências de nomenclatura de protocolo conhecidas.

1. **Banco já de pé:** schema completo aplicado (`jogadores`, `personagens`, `inventario` — `server/schema.sql`) e personagens de teste populados (`server/seed_teste.sql`). Usuário dedicado `rpg_app` configurado; credenciais em `server/.env` (git-ignorado, não commitar). Dados de teste dos personagens 1, 2, 3 e 5 já não são mais os valores originais do seed (refletem os testes reais executados ao longo dos Pacotes 2-5).
2. **Próxima ação:** decisão do responsável do projeto entre (a) iniciar a **Fase 3 — Level Design Avançado, Tilemaps & Spatial Partitioning**, ou (b) resolver primeiro a pendência aberta do feedback de `equip_item`/`unequip_item` recusado (precisa de um contrato de rede novo — nome e payload — que ainda não foi aprovado).
3. **Ainda pendente:** client Phaser não envia `join` sozinho — mesma pendência desde o Pacote 1, segue sem endereçamento (depende de uma fase futura de seleção de personagem). Feedback de equip recusado (ver item 2b acima).

---

## 7. Lista de Pendências e Riscos Mapeados

* **Risco I (Inconsistência de Estado em Queda de Conexão LAN):** Se o cliente perder a conexão socket no meio do combate, a posição final e o HP devem ser persistidos no MySQL antes do encerramento do processo (`disconnect` handler).
* **Risco II (Excesso de Bandwidth em LAN):** Enviar pacotes de movimento a 60 Hz pode saturar a rede local. Travar o envio dos pacotes do cliente em **20 Hz (50ms)** com interpolação no lado receptor.
* **Pendência de UI:** Criar o componente visual de log de combate (*Damage Numbers* flutuantes subindo na tela ao infligir dano).