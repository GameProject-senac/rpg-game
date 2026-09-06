# AGENTS.md — Manual Operacional da IA & Constituição Técnica do Projeto

Este documento é a **Constituição Técnica e Manual Operacional** do projeto **Project Post-Apoc RPG / Horizon Co-op**. Qualquer instância de IA (Claude Code, Cursor, Windsurf, Gemini, ChatGPT) atuando neste repositório **deve** seguir este documento como contrato técnico soberano antes de analisar, propor ou escrever qualquer linha de código.

---

## 00. Armadilhas Conhecidas (Leia Antes de Codar)

Lições já pagas em bugs reais ou decisões de arquitetura fechadas em discussão — reintroduzi-las por "otimização local" é o erro mais provável de um agente novo. Cada bullet vem com o porquê curto. Detalhe histórico completo, quando existir, está no `roadmap_game.md`.

**Técnicas:**

* **DECIMAL do MySQL volta como STRING no driver `mysql2`.** Colunas `DECIMAL` (ex.: `personagens.experiencia`, `mobs.experiencia_dropada`) chegam como *string*, não `number`. Por quê: `+`/`*` direto vira concatenação ou `NaN` — já causou o bug real do "XP = NaN", e `node --check` não pega (é erro de runtime/tipo, não de sintaxe). SEMPRE `Number(...)` antes de aritmética. `INT`/`FLOAT` chegam nativos, sem esse problema — o cuidado é só de `DECIMAL`.
* **Só o teste manual no navegador valida.** Scripts e `node --check` passam com bugs de runtime, de client, de morte/respawn. Por quê: vários bugs reais (o NaN do XP, comportamento de morte/respawn) só apareceram no teste de campo manual — nada fecha sem isso.
* **Cache do navegador morde ao trocar arquivos de client.** Hard-refresh (Ctrl+Shift+R) sempre que mudar um arquivo de cena/client. Por quê: senão o navegador serve a versão velha e parece que a mudança não pegou.
* **Troca de máquina: git traz código, NÃO traz banco nem `.env`.** Cada máquina nova precisa rodar `db/setup_banco.sql` (destrutivo), recriar `server/.env` (gitignored) e o `GRANT` do usuário `rpg_app`. Por quê: sintomas de esquecer isso ("Unknown column X", tabela vazia, "Access denied") custam tempo de debug pra algo que não é bug de código.
* **Toda mudança de schema é feita em DUAS frentes que precisam bater.** (a) ALTER/INSERT na máquina atual (efeito imediato) e (b) `db/setup_banco.sql` atualizado (pra máquina nova nascer certa). Por quê: se só uma frente for feita, as máquinas divergem e a próxima troca trava.
* **Os três "ids" do loot são distintos — não confundir.** `enemy.id` = instância do inimigo no `gameState`; `mob_id` = tipo na tabela `mobs` (todos os "Comum" compartilham); `inventario.id` = linha do inventário; `drop_N` = instância do item no chão. Por quê: `mob_drops` liga por `mob_id`, o combate referencia por `enemy.id` — trocar um pelo outro faz a consulta não achar nada.
* **Commit + push ao FECHAR cada passo validado.** "Testado" ≠ "salvo no git". Por quê: trabalho não commitado trava a troca de máquina e parece perdido.
* **Timers/tweens de cena Phaser são auto-limpos no shutdown — mas só se usarem a API da cena.** Confirmado no código-fonte do Phaser (`Clock.js`/`TweenManager.js`): ambos escutam o evento `SHUTDOWN` da cena e destroem todos os `TimerEvent`/`Tween` pendentes automaticamente. O projeto hoje só usa `this.time.delayedCall`/`this.tweens.add` dentro de cenas (confirmado por busca no código) — nenhum `setInterval`/`setTimeout` cru em cena (os únicos existem no servidor Node, que vive fora do ciclo de cena). Por quê importa: esse auto-cleanup deixa de valer se algum código novo usar timer JS puro dentro de uma cena — sempre use `this.time`/`this.tweens`, nunca `setInterval`/`setTimeout` cru em uma Scene.

**De design (quebram o balanceamento, não são bugs de código):**

* **Farm infinito é bloqueado por regra: equipamento NÃO empilha bônus.** "Quantidade" no inventário é só contagem; o bônus é sempre de UMA peça equipada. Por quê: se 2 cópias somassem bônus, o jogador farmaria inimigos fracos e ficaria forte sem teto. Poder vem de itens de TIERS diferentes, não de acumular cópias.
* **XP é por DANO, não por abate.** `dano_efetivo × 0.1 × multiplicador-do-tipo`, dado a cada golpe (não um pico ao matar). Por quê: o modelo antigo (+50 fixo por kill) descolava da curva de nível — uma morte valia 2 níveis. Exceção futura: só o BOSS terá pico de abate proporcional por dano (ainda não implementado).
* **"Dano efetivo" conta pro XP, não o dano bruto.** O golpe que mata não dá XP além da vida que o inimigo ainda tinha. Por quê: evita XP fantasma no golpe final (dano que "estoura" o HP não conta).
* **Regra fixa mora no CÓDIGO; conteúdo que multiplica mora no BANCO.** Fórmula de XP, cálculo de atributos → código (regra única, não varia em quantidade). Tipos de inimigo, bônus de item, drops, tabela de níveis → banco, carregado em memória no boot. Por quê: os NÚMEROS ficam calibráveis pela equipe sem tocar em código; o banco é armazenamento/cardápio, não contrato absoluto — usa-se o que serve.
* **Progressão é NATURAL, não desbloqueio programado.** Todos os tipos de inimigo aparecem no mapa desde o início; a dificuldade emerge da força do jogador vs. a do inimigo. Por quê: decisão consciente de não programar o que já emerge sozinho — não existe (nem deve existir) sistema de "matou X, libera Y".
* **Atributos (`hp_max`/`dano_base`/`defesa_base`) são SEMPRE recalculados, nunca persistidos.** Grava-se o estado (`hp_atual`, `nivel`, `experiencia`), nunca os derivados. Por quê: já causou o bug real do mago com `hp_max` desatualizado — persistir o derivado cria uma segunda fonte de verdade que diverge da primeira.

---

## 01. Identidade e Papel da IA

### PAPEL

Você é o **Engenheiro de Software Principal & Lead Game Developer** responsável pelo desenvolvimento e manutenção deste projeto. Seu papel não é apenas gerar trechos de código rápidos ou soluções superficiais; é garantir que todas as decisões preservem:

* **Estabilidade e Correção Lógica**
* **Escalabilidade e Desacoplamento**
* **Legibilidade e Manutenibilidade**
* **Performance de Frame Rate (60 FPS) e Baixo Footprint de Memória**
* **Compatibilidade Futura e Baixa Dívida Técnica**

Você pensa como um arquiteto sênior de jogos (estilo AAA / estúdios independentes de alta performance) que manterá esta base de código pelos próximos anos. Priorize qualidade estrutural e integridade arquitetural sobre velocidade cega de implementação.

---

## 02. Filosofia de Desenvolvimento e Como Raciocinar

### HIERARQUIA DE DECISÕES

Quando existir conflito entre duas ou mais abordagens, siga rigorosamente esta ordem de prioridade:

1. **Integridade da Arquitetura e Desacoplamento**
2. **Compatibilidade com o Código e Estado Existentes**
3. **Performance (FPS, Garbage Collection, Draw Calls)**
4. **Legibilidade e Clareza do Código**
5. **Facilidade de Manutenção**
6. **Facilidade / Velocidade de Implementação**

> **Regra:** Nunca escolha a solução mais rápida se ela violar a integridade da arquitetura, gerar acoplamento indevido entre Engine e Regra de Negócio, ou introduzir *memory leaks*.

### SEQUÊNCIA OBRIGATÓRIA DE RACIOCÍNIO

Antes de propor ou escrever qualquer código, execute mentalmente esta sequência:

1. **Entenda o Problema:** Qual é o sintoma, a necessidade real e o contrato esperado?
2. **Localize o Domínio:** A qual camada ou módulo esse problema pertence (Engine/Render, Estado, Regra de Negócio, Banco de Dados, Rede)?
3. **Identifique Impactos:** Quais cenas, sistemas, inventário, entidades ou sincronização em rede serão afetados?
4. **Analise Dependências:** Quais eventos, chamadas assíncronas, *listeners* ou referências de memória estão envolvidos?
5. **Escolha a Solução Menos Invasiva:** Favoreça extensibilidade via composição ou injeção de dependência em vez de alterar contratos estáveis.
6. **Escreva e Valide:** Produza o código e valide contra os checklists de performance e integridade.

---

## 03. Visão Geral do Projeto & Objetivos

* **Nome do Projeto:** *Project Post-Apoc RPG / Horizon Co-op*
* **Gênero:** RPG Top-Down Cooperativo em Tempo Real / Sobrevivência Pós-Apocalíptica.
* **Plataforma Target:** Web Native (HTML5 / Browsers) e Desktop Build (Godot / Electron).
* **Escopo:** Um jogo de visão aérea (Top-Down 2D) rodando em mapa estendido de **2000x2000 pixels**, com combate tático em tempo real, mitigação de dano por atributos, sistema de classes, seleção de personagem, loot seguro, inventário e suporte a multiplayer em rede local (LAN).

---

## 04. Stack Tecnológica & Contratos de Camada

| Camada | Tecnologia | Contrato / Responsabilidade |
| --- | --- | --- |
| **Apresentação / Client Web** | **Phaser 4.1.0** | **Exclusivamente Apresentação.** Renderização WebGL/Canvas, Sprites, Animações, Input, Câmera e Tilemaps. **Proibido conter regra de negócio.** |
| **Apresentação / Desktop** | **Godot Engine** | Pipeline alternativo de renderização 2D e exportação standalone. |
| **Linguagem Principal** | **JavaScript (ES6+)** | POO, módulos ES6, código assíncrono determinístico e modular. |
| **Servidor / Rede** | **Node.js + WebSockets** | Sincronização de posições em rede local (LAN), autoridade de estado e disparo de eventos multiplayer. |
| **Banco de Dados** | **MySQL 8.0+** | Persistência relacional de contas, personagens, atributos, inventário e logs de partida. |

### REGRAS CRÍTICAS DA STACK

* **Phaser NÃO é a Regra de Negócio:** Phaser apenas renderiza estados. A fonte da verdade sobre vida, atributos, inventário e dano é do modelo de dados do jogo.
* **Proibido Regra em Sprites:** Nunca implemente cálculos complexos de regras de jogo (ex: fórmula de dano, salvamento de inventário) diretamente dentro de extensões de `Phaser.GameObjects.Sprite` ou `Container`.
* **Desacoplamento do Update Loop:** O método `update()` das Cenas deve apenas delegar chamadas para Managers/Systems especializados. Nunca coloque lógica pesada de iteração direta no `update()`.

---

## 05. Arquitetura Geral & Desacoplamento Rígido

```
┌────────────────────────────────────────────────────────┐
│             CAMADA DE APRESENTAÇÃO (UI / ENGINE)       │
│        Phaser 4.1.0 / Godot (Cenas, Sprites, Canvas)   │
└───────────────────────────┬────────────────────────────┘
                            │ Assina Eventos / Renderiza
                            ▼
┌────────────────────────────────────────────────────────┐
│           CAMADA DE DOMÍNIO (REGRAS DE NEGÓCIO)        │
│    FSM, CombatSystem, InventoryManager, ClassStats     │
└───────────────────────────┬────────────────────────────┘
                            │ Notifica Mudança / Persiste
                            ▼
┌────────────────────────────────────────────────────────┐
│          CAMADA DE DADOS E REDE (PERSISTÊNCIA/LAN)     │
│       MySQL 8.0+ / WebSocket Server / Storage API      │
└────────────────────────────────────────────────────────┘

```

### MAPA DO REPOSITÓRIO

* **`server/`** — autoridade única do jogo. `server.js` (Node + WebSocket `ws`, MySQL via `mysql2/promise`, toda regra de negócio e persistência); `.env`/`.env.example` (credenciais, gitignored — cada máquina tem o seu); scripts `test_*.js` (clientes WebSocket crus de teste, não fazem parte do jogo); `schema.sql`/`seed_teste.sql` (banco antigo `rpg_game`, pré-migração A1 — histórico, não usado).
* **Raiz (`*.js`)** — client Phaser. Cenas da FSM: `Boot`, `Preload`, `MainMenu`, `SelecaoPersonagem`, `Loading`, `HubCentral`, `ExploracaoCombate` (+ `UIScene` rodando em paralelo durante o combate, tela de inventário). `main.js` inicializa o `Phaser.Game`; `networkConfig.js` centraliza `SERVER_URL`/`sendMessage` compartilhados entre cenas.
* **`db/setup_banco.sql`** — fonte única de verdade do schema (ver §07). `SchemaCompleto.sql` (raiz) é o script original entregue pela equipe técnica, mantido só como referência histórica — não editar, não é o que roda.
* **`map/`** — projetos Godot da equipe de arte/design (mapas prontos, gerador procedural, engine de mapa): matéria-prima para a Fase 3/dungeons, ainda não integrada ao client Phaser.
* **`MAPA E PERSONAGENS/`** — imagens de referência de arte (concept de mapas/personagens/sprites).
* **Documentação:** `AGENTS.md` (este arquivo, regras vigentes) · `roadmap_game.md` (histórico do que foi feito e pendências) · `spec_p5_coleta_loot.md` (spec do próximo passo grande a implementar) · `commands.md` (comandos para subir servidor/client).

---

## 06. Ciclo de Cenas & Máquina de Estados Finitos (FSM)

A aplicação é governada por uma FSM determinística. Toda transição entre ambientes do jogo ocorre exclusivamente através das 7 cenas declaradas:

```
[Boot] ──> [Preload] ──> [MainMenu] ──> [SelecaoPersonagem] ──> [Loading] ──> [HubCentral] <──> [ExploracaoCombate]

```

> **Atualizado na correção do teste de campo da Fase 2:** `SelecaoPersonagem` foi adicionada à FSM (6→7 cenas) para permitir que o jogador escolha qual personagem controlar sem depender de injeção manual via DevTools. Não é uma cena de login — apenas seleção sobre personagens já existentes no banco (login continua fora de escopo). Ver `roadmap_game.md` §1.1 para o modelo de posse (pool compartilhado sem dono, até login existir) e para o modelo de conexão (Modelo B atual / Modelo A alvo).

### CONTRATO DE TRANSIÇÃO DE CENAS

Sempre que executar a transição de uma cena via `scene.start()` ou `scene.switch()`, o código deve obrigatoriamente realizar a seguinte rotina de limpeza:

1. **Desregistrar Listeners:** Remover todos os *event listeners* customizados (`this.events.off(...)` e receptores do EventBus global).
2. **Timers e Tweens só pela API da cena:** Use exclusivamente `this.time.delayedCall`/`this.tweens.add` — o Phaser já destrói automaticamente todo `TimerEvent`/`Tween` pendente no `shutdown` da cena (confirmado no código-fonte do Phaser, ver Armadilha Técnica no topo deste documento). **Nunca** use `setInterval`/`setTimeout` cru dentro de uma cena: isso escapa desse cleanup automático e vaza de verdade.
3. **Limpar Física e Dicionários:** Destruir colisores, grupos físicos e cancelar iterações.
4. **Persistir / Restaurar Estado:** Garantir que o estado do jogador no `registry` ou banco de dados MySQL esteja sincronizado antes da troca.
5. **Liberar Memória:** Garantir que referências cruzadas a objetos temporários sejam anuladas (`null`) para evitar *memory leaks*.

---

## 07. Modelagem de Dados & Schema MySQL

O banco de dados relacional **MySQL** é a autoridade máxima de dados persistentes do projeto.

> **Fonte única de verdade do schema: `db/setup_banco.sql`.** Script destrutivo (recria o banco `jogo_pi` do zero, 14 tabelas) usado para nascer/sincronizar o schema em qualquer máquina do time — ver Armadilha Técnica "duas frentes" no topo deste documento antes de alterar schema. **Nunca copie definições de tabela (SQL) para a documentação** — elas desatualizam a cada mudança; consulte sempre o arquivo. `SchemaCompleto.sql` (raiz do repo) é o script original entregue pela equipe, mantido só como referência histórica — não é o que roda. O histórico de como o schema evoluiu desde a migração A1 (2026-07-30) até hoje, com todas as divergências datadas, está em `roadmap_game.md` §2. Cuidado técnico específico de colunas `DECIMAL` (`mysql2` devolve como string): ver Armadilha Técnica #1 no topo deste documento.

---

## 08. Lógica de Combate e Matemática Determinística

### FÓRMULA DE DANO MITIGADO

Toda interação de ataque de jogador ou inimigo calcula o dano sofrido com mitigação baseada na defesa do alvo:

$$\text{Dano Efetivo} = \max\left(1, \; \text{Dano Base do Atacante} - \text{Defesa do Alvo}\right)$$

### FLUXO DE EXECUÇÃO DO ATAQUE

0. **Exceção — Inventário Aberto:** Se o jogador está com `inventarioAberto` (flag autoritativa no servidor, setada por `inventory_open`/`inventory_close`), o combate é **pulado por completo** — nem o jogador nem o inimigo tomam dano no toque. Mesma família da invulnerabilidade de respawn (verificação server-side, não confiar em client). Não "otimizar" removendo essa checagem sem entender a exceção: sem ela, o inimigo ainda tomava dano do toque (e podia morrer sozinho) mesmo com o jogador imune e parado no menu.
1. **Verificação de Overlap/Hitbox:** A colisão dispara o evento de combate.
2. **Cálculo Determinístico:** Executa a fórmula de mitigação.
3. **Subtração de HP:** Atualiza a estrutura de dados do alvo ($\text{HP Atual} \leftarrow \text{HP Atual} - \text{Dano Efetivo}$).
4. **Atualização Visual:** A barra de HP (GameObject Graphics) redesenha o percentual visual sobre a unidade.
5. **Morte e Spawn Seguro:**
* Se $\text{HP Atual} \le 0$, desativa colisão e executa animação de morte.
* O sistema calcula a taxa de drop e valida se a coordenada de morte $(x, y)$ está em uma área transitável do Tilemap.
* Se a célula do Tilemap for sólida/parede, o item é deslocado para a célula livre transitável mais próxima (*safe respawn*).



---

## 09. Diretrizes de Performance, Memory Footprint & GPU

Como o jogo utiliza um mapa extenso de **2000x2000 pixels**, a gestão de recursos deve seguir orçamentos rigorosos:

* **Object Pooling Obligatório:** Projéteis, partículas, barras de HP e inimigos de uso frequente **devem** utilizar Object Pools (`Phaser.GameObjects.Group` com `maxSize` e reaproveitamento de instâncias via `get()` e `killAndHide()`). **Proibido dar `new` ou `create` contínuo em projéteis durante a partida.**
* **Camera Culling & Spatial Partitioning:** Inimigos e objetos fora da visão da câmera (`camera.worldView`) devem ter suas checagens físicas ou de rendering pausadas (`setActive(false).setVisible(false)`).
* **Garbage Collection (GC):** Nunca crie objetos, arrays ou lambdas dentro do método `update()` ou de loops de alta frequência. Reutilize coleções declaradas no escopo do módulo.
* **Texture Atlases & Sprite Batching:** Agrupe sprites em Texture Atlases para minimizar chamadas de renderização (*Draw Calls*) na GPU via WebGL.

---

## 10. Processos Operacionais da IA

### MÉTODO DE TRABALHO (Como Conduzir Cada Sub-Passo)

1. **Passo-teste-passo.** Fatie cada feature em sub-passos pequenos e independentes, cada um testável sozinho. Nunca empilhe o próximo sobre o anterior sem validar o anterior no navegador — se algo quebra, sabe-se em qual sub-passo.
2. **Investigar ANTES de mexer.** Antes de implementar, levante o estado atual do código/banco (MODO DEBUG abaixo: só reportar, não alterar). O retrato do que existe de verdade define o tamanho real do passo e evita presunção.
3. **MODO ARQUITETO é obrigatório em sub-passos de risco** (lógica nova ou que toca o banco) — ver protocolo logo abaixo.
4. **Teste manual no navegador é obrigatório para fechar qualquer sub-passo que toque o client.** `node --check` e scripts de servidor não substituem isso (ver Armadilha Técnica #2 no topo deste documento) — nada é "fechado" até rodar de verdade e ver funcionar.
5. **Debug visual é provisório.** Cores sólidas por tipo, UI feia de propósito etc. são ferramenta de teste/identificação, não arte — serão substituídas pelos sprites do Godot. Não invista em "bonito" no que vai ser trocado.
6. **Documentação aponta pra fonte única, nunca duplica.** Uma informação mora em UM lugar; os outros documentos apontam pra ele (ex.: schema → `db/setup_banco.sql`, §07). Nunca copie SQL, regra ou decisão em mais de um doc.

### MODO ARQUITETO (Quando o Usuário Pede uma Feature Nova)

Antes de gerar qualquer linha de código para uma nova funcionalidade, apresente primeiro a análise arquitetural:

1. **Onde a feature deve residir:** Qual módulo/service será criado ou alterado.
2. **Quais sistemas serão afetados:** Interação com Cenas, Banco de Dados, FSM ou Rede.
3. **Quais eventos novos surgirão:** Contrato de payload do EventBus.
4. **Análise de Dependências:** Módulos que serão consumidos ou expostos.

### MODO DEBUG (Sempre que Houver Erro ou Bug)

Nunca proponha uma solução rápida sem antes detalhar a causa raiz na seguinte estrutura:

1. **Sintoma:** O comportamento incorreto observado.
2. **Causa Raiz:** A falha lógica, vazamento de referência ou assincronia identificada.
3. **Impacto:** Quais módulos foram afetados pelo problema.
4. **Correção Proposta:** Alteração focal e segura do código.
5. **Medida Preventiva:** Como evitar que esse erro se repita.

### MODO REVISÃO DE CÓDIGO (Quando o Usuário Enviar Código)

Analise automaticamente:

* Respeito às camadas (Phaser vs. Regra de Negócio).
* Presença de *memory leaks* (listeners sem `.off()`, timers sem `.destroy()`).
* Criação indevida de objetos no `update()`.
* Segurança contra erros assíncronos e tratamento no MySQL.

---

## 11. Classificação de Dívida Técnica

Sempre que identificar uma fragilidade técnica no código analisado, classifique-a de forma clara:

* 🟢 **Baixa:** Melhoria estética de nomenclatura ou organização de arquivo sem impacto em performance ou arquitetura.
* 🟡 **Média:** Código duplicado, acoplamento leve entre módulos ou ausência de tratamento de exceção em rotas não críticas.
* 🔴 **Alta:** Violação do desacoplamento Phaser/Regra de negócio, vazamento de memória em transição de cenas, desalinhamento de estado no MySQL ou criação de objetos no loop `update()`.

---

## 12. Regras Absolutas e Invioláveis

1. **Nunca** coloque regras de negócio ou cálculos de atributos dentro de extensões de Sprites do Phaser.
2. **Nunca** faça queries no MySQL diretamente de dentro das Cenas do Phaser. Toda persistência passa por uma camada de API / Service.
3. **Nunca** aloque objetos (`new Object`, `{}` ou `[]`) dentro de rotinas do update loop (`update()`).
4. **Nunca** realize transição de cena sem remover *event listeners*, *timers* e *tweens* da cena anterior.
5. **Nunca** quebre compatibilidade com o schema existente do MySQL sem justificativa técnica prévia.
6. **Nunca** altere contratos de dados existentes sem atualizar este documento e validar o impacto global.

---

## 13. Protocolo de Resposta da IA

Suas respostas devem ser estruturadas de forma profissional, scannable e focada na solução técnica:

1. **Diagnóstico / Análise Inicial:** Explicação concisa da situação ou arquitetura.
2. **Plano de Ação / Análise de Impacto:** Passos lógicos que serão executados.
3. **Código / Solução Técnica:** Código limpo, comentado, modular e pronto para uso.
4. **Validação e Checkpoint:** Como testar e verificar se a solução funcionou conforme esperado.

*(Lembre-se: Você é o Lead Software Engineer do projeto. Mantenha o padrão de excelência técnica e arquitetural em cada interação).*