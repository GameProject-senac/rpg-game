# roadmap_game.md — Roadmap Técnico e Próximos Passos de Desenvolvimento

**Status Atualizado:** 
A **Fase 1 (Multiplayer LAN & WebSockets)** foi formalmente concluída! O projeto possui agora um Servidor Node.js Autoritatório rodando a 20Hz, gerenciando estado de inimigos, loot e mitigação de dano determinística, perfeitamente sincronizado com clientes Phaser 4 que realizam interpolação suave de movimento. 
Dentro da **Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão)**, o **Pacote 1 — Identidade de Personagem e Trilho de Leitura do Banco** foi implementado, testado e validado (ver `fase2_spec.md` e §3 "PACOTE 1" abaixo para o registro completo). O servidor MySQL local (`rpg_game`) já está de pé, com schema mínimo e personagens de teste populados.
**Foco Atual (Estado de parada):** Pacote 1 concluído e aguardando autorização explícita para iniciar o **Pacote 2 (Persistência de Volta e Sistema de Progressão XP/Nível)**, definido em `fase2_spec.md`. Nenhuma linha do Pacote 2 foi escrita ainda — execução é sequencial e gated por autorização, conforme regra de avanço da spec.

**Origem:** Documento mestre de especificação técnica e roadmap operacional para desenvolvimento solo do *Project Post-Apoc RPG / Horizon Co-op*. Este arquivo serve como contexto técnico e guia de execução contínua para qualquer agente de IA ou sessão de desenvolvimento.

---

## 1. Decisões Estruturais e de Arquitetura

1. **Desacoplamento Absoluto (Phaser vs. Regra de Negócio):**
O Phaser 4.1.0 atua puramente na camada de apresentação (Canvas/WebGL, rendering de sprites, animações, inputs e câmeras). Nenhuma regra de inventário, atributos de classe, cálculo de dano ou persistência reside dentro de Sprites ou Containers.
2. **Autoridade do Servidor e Sincronização LAN:**
A autoridade sobre a posição de inimigos, HP dos alvos, tabela de loot e estado da partida pertence ao servidor Node.js. O cliente envia intenções de comando (`player_move`, `use_skill`, `item_pickup`) e realiza interpolação visual (*lerp*) para suavizar a renderização dos outros jogadores.
3. **Persistência Relacional com MySQL:**
O MySQL é a fonte da verdade para dados persistentes (contas, personagens, atributos base, inventário e histórico). Transições entre cenas persistem no `registry` em memória temporária do Phaser e salvam assincronamente no MySQL.
4. **Arquitetura Baseada em Eventos (EventBus):**
Comunicação interna entre a UI do jogo e os módulos de domínio ocorre via EventBus global desacoplado. Toda troca de cena exige a desmontagem explícita de *listeners*, cancelamento de *tweens* e *timers* para zerar riscos de *memory leaks*.

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

#### 1.2 Protocolo de Comunicação em Rede (Payload Spec)

* **Conexão e Entrada na Sala:**
* Client $\rightarrow$ Server (`player_join`): `{ token, personagem_id }`
* Server $\rightarrow$ Clients (`player_spawned`): `{ id, nome, classe, x, y, hp_atual, hp_max }`


* **Transmissão de Movimento (Tick Rate: 20 Hz / 50ms):**
* Client $\rightarrow$ Server (`player_move`): `{ x, y, vx, vy, anim, flipX }`
* Server $\rightarrow$ Clients (`player_updated`): `{ id, x, y, vx, vy, anim, flipX, timestamp }`


* **Sincronização de Combate:**
* Client $\rightarrow$ Server (`player_attack`): `{ alvo_id, habilidade_id, direcao }`
* Server $\rightarrow$ Clients (`combat_event`): `{ atacante_id, alvo_id, dano, hp_resultante, critico }`


* **Coleta de Loot:**
* Client $\rightarrow$ Server (`pickup_item_request`): `{ instanciado_id }`
* Server $\rightarrow$ Clients (`item_despawned`): `{ instanciado_id, coletado_por_id }`



---

### FASE 2: Sistema de Inventário, Equipamentos & Persistência Relacional (Status: 🔄 Em Andamento — Pacote 1/5 concluído)

> Esta fase é executada em 5 pacotes sequenciais, especificados em detalhe em `fase2_spec.md`. O registro de execução de cada pacote concluído é mantido na seção 2.3 abaixo.

#### 2.1 Objetivos Técnicos

* Implementar a camada de domínio `InventoryManager.js` totalmente desacoplada da interface.
* Criar a interface de inventário em grid de slots no Phaser via UI Scene paralela (`UIScene`).
* Integrar alteração dinâmica de atributos do personagem ao equipar/desequipar itens.

#### 2.2 Fluxo de Atualização de Atributos ao Equipar Item

```
[Jogador clica "Equipar" na UI]
         │
         ▼
[InventoryManager.equiparItem(itemId)]
         │
         ├─► Valida se atende aos requisitos da Classe/Nível
         ├─► Atualiza estado interno: item.equipado = true
         ├─► Recalcula: dano_total = dano_base + sum(itens.dano)
         │               defesa_total = defesa_base + sum(itens.defesa)
         │
         ├─► Notifica MySQL via API / Servidor:
         │   `UPDATE inventario SET equipado = TRUE WHERE id = ...`
         │   `UPDATE personagens SET dano_base = ..., defesa_base = ...`
         │
         └─► Dispara EventBus: 'stats_updated' ──> [UIScene redesenha os atributos]

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
* Divergências de nomenclatura de protocolo entre este roadmap e o código (`player_join`/`join`, `pickup_item_request`/`pickup_item`, `player_attack`/`attack_enemy`) permanecem registradas e sem ação — reconciliação é escopo do **Pacote 5**.

**Próximo passo:** Pacote 2 (Persistência de Volta e Sistema de Progressão XP/Nível), aguardando autorização explícita para início.

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

**Ponto de Parada Atual:** Fase 2 / **Pacote 1 concluído e validado** (ver §2.3 acima e `fase2_spec.md`). O servidor já lê identidade real de personagem do MySQL (`rpg_game`), aplica molde de classe + buff de nível, e mantém trava de sessão em memória. **O servidor ainda não grava nada no banco** — isso é o Pacote 2.

1. **Banco já de pé:** schema aplicado e 5 personagens de teste populados (`server/schema.sql`, `server/seed_teste.sql`). Usuário dedicado `rpg_app` configurado; credenciais em `server/.env` (git-ignorado, não commitar).
2. **Próxima ação:** iniciar o **Pacote 2 — Persistência de Volta e Sistema de Progressão (XP/Nível)** de `fase2_spec.md`, mediante autorização explícita: snapshot periódico (~10s) de posição/HP, save no `disconnect`, ganho de XP ao matar inimigo, subida de nível com recálculo em memória e broadcast `level_up`.
3. **Ainda pendente (fora dos pacotes já feitos):** client Phaser (`ExploracaoCombate.js`) não envia `join` — jogo real via browser não entra em campo até isso ser endereçado numa fase futura (seleção de personagem). Tabela `inventario` e `UIScene` seguem para o Pacote 4.

---

## 7. Lista de Pendências e Riscos Mapeados

* **Risco I (Inconsistência de Estado em Queda de Conexão LAN):** Se o cliente perder a conexão socket no meio do combate, a posição final e o HP devem ser persistidos no MySQL antes do encerramento do processo (`disconnect` handler).
* **Risco II (Excesso de Bandwidth em LAN):** Enviar pacotes de movimento a 60 Hz pode saturar a rede local. Travar o envio dos pacotes do cliente em **20 Hz (50ms)** com interpolação no lado receptor.
* **Pendência de UI:** Criar o componente visual de log de combate (*Damage Numbers* flutuantes subindo na tela ao infligir dano).