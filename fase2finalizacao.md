# fase2finalizacao.md — Achados do Teste de Campo e Plano de Fechamento da Fase 2

> **Status da Fase 2: NÃO FECHADA.**
>
> Os 5 pacotes da `fase2_spec.md` foram implementados e passaram em seus critérios automatizados. Porém, o **teste de campo manual** — executado pelo dono do projeto no navegador, em fluxo real de jogo — revelou falhas funcionais graves não capturadas pelos testes automatizados.
>
> **Regra de fechamento (decisão do projeto):** a Fase 2 só será considerada fechada quando passar no **teste manual conduzido pelo dono do projeto**. Aprovação por teste automatizado ou por inspeção de código não é suficiente.
>
> **Atualização (sessão seguinte, registrada na íntegra em §8):** diagnóstico completo feito, causa raiz confirmada (playerStats stale + corrida de sessão na morte), correções do Round 1 implementadas mas **ainda não validadas em teste de campo** — o teste ficou bloqueado por dois achados novos no meio do caminho: inconsistência de tipo do `personagem_id` (number vs. string) e a seleção de personagem exibindo nível desatualizado. Ver §8 para o estado exato e o ponto de retomada.

---

## 0. Por que os testes automatizados não pegaram isso

Registro importante para o método de trabalho daqui em diante.

Os scripts de teste (`test_pacote2.js`, `test_pacote4.js`) rodam pelo **lado do servidor**, simulando um client via WebSocket. Eles validam corretamente o comportamento do servidor: identidade, persistência, cálculo de atributos, XP, inventário.

O que eles **não** exercitam:
- O `messageHandlers` refatorado no Pacote 5 (que vive no client).
- A renderização (barras de HP, grid de inventário, linha de stats).
- O ciclo de vida real de cena do Phaser (`scene.restart()`, shutdown, recriação).
- Interação de input humano (cliques em slots, movimento sustentado).

O Pacote 5 foi aprovado com o critério "paridade funcional pós-refatoração" validado **apenas por inspeção de código** — uma meia-validação que foi explicitamente reconhecida na época. O teste de campo era justamente o que fecharia essa lacuna, e ele falhou.

**Conclusão de método:** refatoração de client não pode ser validada por script de servidor. Toda alteração no client exige teste manual no navegador antes de fechar pacote.

---

## 1. Relato bruto do teste de campo

Ambiente: servidor Node rodando, client servido via `http.server` na porta 8000, Chrome com DevTools (F12) aberto durante toda a sessão.

### 1.1 Sintomas observados

| # | Sintoma |
|---|---|
| S1 | Personagens aparecem **sem barra de vida** sobre a cabeça |
| S2 | Personagem **não causa dano e não toma dano** — "nada é calculado, só anda" |
| S3 | **Nenhum slot do inventário é clicável** — itens 4 e 5 do checklist não puderam ser executados |
| S4 | **Level up invisível** — o servidor logou subida para nível 2, mas não houve nenhuma indicação na tela |
| S5 | **Tremida no movimento vertical** (cima/baixo); esquerda/direita fluem melhor |
| S6 | **"Jogador" estático extra** apareceu na tela, sem comando |
| S7 | Em teste com 2 abas (id=3 e id=4): o outro jogador aparecia sempre **estático**; barra de vida apareceu apenas na cabeça do id=4 |
| S8 | Personagem id=2: **sem barra de vida**, atributos exibidos apenas na primeira linha, sem os slots de inventário |
| S9 | **CRÍTICO** — todos os inimigos **somem do mapa após alguns minutos** de servidor ligado; reiniciar o servidor traz de volta; somem novamente minutos depois |
| S10 | Após morrer, a cena reinicia e o personagem volta jogável **sem precisar reinjetar o `join`** no console |
| S11 | **Nenhum erro vermelho no console** durante toda a sessão |

### 1.2 Observação-chave do dono do projeto (a mais valiosa)

> *"O servidor depois de 'sujo' começa a bugar. Entrei com id=4 depois e foi normal. Depois de morrer, o bug retornou: sem barra de vida, sem morrer nem matar. Parece que o cálculo não está sendo atribuído quando o personagem morre. E depois disso, mesmo resetando o servidor, o bug persiste."*

Esta observação estabelece um **padrão temporal** que nenhum teste automatizado capturaria:

1. Primeira conexão em servidor limpo → **funciona** (inclusive subiu de nível com sucesso).
2. Personagem morre → `scene.restart()` dispara.
3. Após o restart → **estado quebrado** (sem HP, sem combate).
4. O estado quebrado **persiste mesmo reiniciando o servidor**.

O item 4 é o mais revelador: se reiniciar o servidor não cura, a corrupção não está (apenas) no estado do servidor.

### 1.3 Log do servidor durante a sessão

```
Servidor WebSocket AUTORITÁRIO iniciado (Tick Rate: 20Hz)
[+] Conexão WebSocket estabelecida (aguardando join)
[+] Personagem 3 (Arqueiro Teste, arqueiro, nível 2) entrou.
[join] Recusado — personagem_id 3 já está em sessão ativa.
[-] Personagem Desconectado: 3
[+] Conexão WebSocket estabelecida (aguardando join)
[+] Personagem 3 (Arqueiro Teste, arqueiro, nível 2) entrou.
[-] Personagem Desconectado: 3
[+] Conexão WebSocket estabelecida (aguardando join)
[-] Conexão encerrada antes de qualquer join.
[+] Conexão WebSocket estabelecida (aguardando join)
[+] Personagem 3 (Arqueiro Teste, arqueiro, nível 2) entrou.
```

**Leituras deste log:**
- O `join` **funciona** do lado do servidor: identidade carregada do MySQL corretamente (nome, classe, nível 2 — persistido de sessão anterior).
- A **trava de sessão funciona** (recusa de duplicata registrada).
- A subida de nível **persistiu no banco** (o personagem reconecta já como nível 2).
- Portanto: **a falha está no client ou no caminho de volta**, não na identidade nem na persistência.

---

## 2. Hipóteses de causa raiz (a investigar — NÃO confirmadas)

> Estas são hipóteses formuladas a partir dos sintomas. O agente implementador deve **investigar e confirmar ou refutar** cada uma, apresentando o diagnóstico no formato MODO DEBUG do `AGENTS.md`. Não assumir que estão corretas.

### H1 — `playerStats` não é preenchido (causa raiz candidata para S1, S2, S3, S4, S7, S8)

O `update()` de `ExploracaoCombate` tem um early return: `if (!this.playerStats) return;`. Se `playerStats` for `undefined`, **todo o corpo do update deixa de rodar** — o que explicaria, de uma vez só:

- Barra de HP não desenhada (S1) — o `drawHpBar` do próprio jogador está dentro do update.
- Movimento não enviado ao servidor → servidor não vê o jogador se mover → sem colisão → sem combate (S2).
- Interpolação de remotos não roda → jogadores remotos estáticos (S7).
- Barras de HP de inimigos e remotos não desenhadas (S1, S7).

O `playerStats` é preenchido no handler de `welcome`. Se o `welcome` não chega, não é roteado, ou o handler não está registrado no `messageHandlers`, `playerStats` fica `undefined`.

**Compatível com S11 (nenhum erro no console):** um tipo de mensagem sem handler correspondente no mapa de dispatch falha **silenciosamente** — nenhuma exceção é lançada. Este é o pior modo de falha possível e reforça a necessidade de um fallback.

### H2 — Corrupção de estado no ciclo de morte / `scene.restart()` (causa raiz candidata para o padrão temporal e S10)

O relato do dono do projeto indica que o problema **aparece depois da primeira morte**. O fluxo de morte atual:

1. Servidor emite `player_died`.
2. Client chama `this.scene.restart()`.
3. O `shutdown` da cena roda: fecha o socket, destrói graphics, remove listeners.
4. O `create()` roda de novo: abre socket novo, reinicializa estruturas.

Pontos de suspeita a investigar:
- O socket novo abre, mas o client **nunca reenvia o `join`** — a menos que algo o faça automaticamente. S10 diz que após morrer o personagem "volta jogável sem reinjetar o join", o que é **contraditório** e precisa ser explicado: ou existe reenvio automático em algum lugar, ou o personagem só *parece* jogável (anda, mas nada mais funciona — que é exatamente S2).
  - **Hipótese refinada:** o personagem após a morte NÃO está realmente conectado como personagem 3. O socket abre, mas sem `join` o servidor não o associa a nenhum personagem, logo nunca envia `welcome`, logo `playerStats` fica `undefined` — e o movimento local (que é predição client-side pura) continua funcionando visualmente, dando a **falsa impressão** de que está jogável. Isso unifica H1 e H2 numa só explicação.
- Referências cruzadas sobreviventes ao restart (graphics órfãos, listeners duplicados) — potencial explicação para S6 (jogador estático extra).

### H3 — "Persiste mesmo reiniciando o servidor"

O dono do projeto observou que o bug persiste após reiniciar o servidor. Investigar se:
- A aba do navegador não foi recarregada (estado do client sobrevive ao restart do servidor).
- Existe estado residual no client entre restarts de cena.
- A trava de sessão no servidor não é o problema (ela é em memória e morre com o processo).

**Nota:** se a aba não foi recarregada, o comportamento é esperado e não indica corrupção adicional — o client permanece no seu estado quebrado independentemente do servidor. Confirmar com o dono do projeto no próximo teste.

### H4 — Inimigos nunca respawnam (causa raiz independente, para S9)

Analisando o `server.js` atual: quando um inimigo morre, ele é removido via `delete gameState.enemies[enemy.id]` e **não há nenhuma rotina de respawn**. As moedas possuem respawn (`spawnMoedas()` é chamado quando o pool esvazia), inimigos não.

Consequência: os 3 inimigos iniciais se esgotam conforme são mortos, e o mapa fica permanentemente vazio até o servidor reiniciar (quando os `spawnEnemy()` de inicialização rodam de novo).

**Classificação:** isto NÃO é regressão dos pacotes da Fase 2 — é uma funcionalidade que nunca existiu no projeto. Porém, o dono do projeto classificou como **crítico**, pois inviabiliza jogar e apresentar.

### H5 — Tremida no movimento vertical (S5)

Possíveis causas a investigar:
- Interação entre o throttle de 20Hz (Pacote 3) e a interpolação.
- Assimetria no tratamento dos eixos X e Y no `update()` (o código atual usa `if/else if` para X e `if/else if` para Y separadamente — verificar se há diferença de comportamento).
- **Atenção:** se H1 estiver correta e o `update()` não estiver rodando o caminho de envio, esta tremida pode ser sintoma de outra coisa. **Reavaliar S5 somente após corrigir H1/H2** — pode desaparecer junto.

---

## 3. Escopo obrigatório antes de fechar a Fase 2

Decisões do dono do projeto tomadas após o teste de campo. Estes itens **entram no escopo da Fase 2** e bloqueiam seu fechamento.

### 3.1 Correção dos bugs acima

Todos os sintomas S1–S9 devem ser diagnosticados, corrigidos e revalidados em teste de campo manual.

### 3.2 `join` automático pelo client (NOVO — entra na Fase 2)

**Decisão:** *"a gente precisa programar o `join` pra se conectar direto"*.

Hoje o client não envia `join` sozinho — é necessário abrir o DevTools e injetar o comando manualmente. Isso foi aceitável durante o desenvolvimento, mas é **inviável para uso real e para a apresentação**.

O client deve enviar o `join` automaticamente ao estabelecer conexão, sem intervenção manual.

### 3.3 Seleção de personagem (NOVO — entra na Fase 2)

**Decisão:** *"seleção de personagens também entra antes de finalizar a Fase 2. Não tem cabimento ficar abrindo o DevTools na apresentação."*

Necessário um mecanismo pelo qual o jogador escolhe qual personagem controlar, alimentando o `join` automático com o `personagem_id` correspondente.

**Nota de escopo:** isto é **seleção**, não **login**. Login/autenticação permanece adiado conforme decisão original da Fase 2. A seleção deve funcionar sobre os personagens já existentes no banco.

### 3.4 Fallback para mensagem desconhecida (NOVO)

O `messageHandlers` deve possuir um fallback que **loga explicitamente** qualquer `data.type` recebido sem handler correspondente. Falha silenciosa é o pior modo de falha possível e foi provavelmente o que permitiu que este conjunto de bugs passasse despercebido pelos testes.

### 3.5 Respawn de inimigos

Implementar rotina de respawn de inimigos no servidor, análoga à das moedas. Valores (intervalo, quantidade) a definir — não inventar sem confirmação.

---

## 4. Pendências registradas (NÃO bloqueiam, mas ficam documentadas)

| Pendência | Decisão |
|---|---|
| Moeda entrando no inventário como `tipo='Recurso'` | **A ser REMOVIDA** na próxima iteração. Existiu apenas para testar persistência de coleta no Pacote 4 e já cumpriu o papel. Decisão do dono do projeto: *"não faz sentido, próxima atualização a gente retira"*. Não remover sem instrução. |
| Feedback ao recusar `equip_item` de item não-equipável (falha silenciosa) | Registrado no Pacote 4. Requer contrato de rede novo. Aguardando decisão. Mesma família de problema que o fallback de mensagem desconhecida (§3.4). |
| Fluxograma §2.2 do `roadmap_game.md` | Já reconciliado no Pacote 5. |

---

## 5. Status revisado dos pacotes

| Pacote | Status | Observação |
|---|---|---|
| 1 — Identidade e leitura do banco | ✅ Validado | Confirmado ao vivo no log do teste de campo: identidade carregada corretamente do MySQL |
| 2 — Persistência e progressão | ✅ Validado no servidor | Nível 2 persistiu entre sessões. Porém, o **feedback visual** de level up falhou (S4) |
| 3 — Throttle e alocação | ⚠️ A reavaliar | Possível relação com S5. Reavaliar após corrigir H1/H2 |
| 4 — Inventário | ⚠️ Reaberto | Backend validado por script, mas a **UI está inerte** (S3) — não foi possível equipar nada manualmente |
| 5 — Refatoração e documentação | ❌ **REABERTO** | O critério nº 1 (paridade funcional) **falhou no teste de campo**. A refatoração do `onmessage` é a principal suspeita de regressão |

---

## 6. Ponto de retomada — HISTÓRICO (superado por §8)

> Esta seção documentava o ponto de retomada logo após o teste de campo original. Os itens 1-3 abaixo foram cumpridos (diagnóstico apresentado, Pacote 5 confirmado sem regressão, correções autorizadas por round). O estado real de retomada está em **§8** — leia lá, não aqui.

1. ~~Agente investiga e apresenta diagnóstico~~ — feito.
2. ~~Agente confirma ou refuta se o Pacote 5 introduziu regressão~~ — feito: sem regressão (dispatch completo e correto; a causa raiz é de ciclo de vida de cena, não do refactor).
3. ~~Dono do projeto autoriza as correções~~ — feito, por rounds.
4. Correções implementadas — **parcial**, ver §8.
5. Novo teste de campo manual — **bloqueado**, ver §8.
6. Fase 2 fechada somente se o teste manual passar — continua valendo.

---

## 7. Registro de método (aprendizado da sessão do teste de campo original)

- **Teste de campo manual é obrigatório antes de fechar qualquer pacote que toque no client.** Scripts de servidor não validam client.
- **Falha silenciosa é o pior modo de falha.** A ausência total de erros no console (S11) mascarou um conjunto grande de bugs funcionais. Todo dispatch precisa de fallback com log.
- **Um sintoma isolado pode ser vários bugs, e vários sintomas podem ser um só bug.** A hipótese unificadora (H1+H2) explica 6 dos 11 sintomas observados.
- **A observação do usuário sobre o padrão temporal** ("funciona antes de morrer, quebra depois") foi a informação mais valiosa do teste — nenhum teste automatizado a produziria.

---

## 8. Atualização — Sessão de Implementação do Round 1 (registro de execução e novo ponto de retomada)

### 8.1 Diagnóstico confirmado (sessão anterior)

- **Causa A:** `this.playerStats`/`this.myId` nunca eram resetados entre `create()`/`shutdown()` de `ExploracaoCombate`. `scene.restart()` não destrói a instância da Scene (confirmado lendo `node_modules/phaser/src/scene/Systems.js`), então o objeto stale sobrevivia à morte com `hp_atual <= 0`, e o guard `if (!this.playerStats) return` parava de proteger porque o objeto continuava truthy — não `undefined` como a hipótese original (H1/H2) supunha. Explicava S1, S2, S3, S7 (principal), S8, S10.
- **Pacote 5: sem regressão confirmada.** Os 12 tipos de mensagem do servidor batem exatamente com os 12 handlers de `messageHandlers`. A Causa A vive em `create()`/`shutdown()`, código que a refatoração do Pacote 5 nunca tocou. Classificação: dívida técnica transversal entre identidade de personagem (Pacote 1) e ciclo de morte/restart (combate pré-existente à Fase 2) — não é falha de nenhum pacote específico, só nunca foi exercitada por teste algum antes do teste de campo manual.
- **Causa C (S9, inimigos não respawnam):** confirmada — `delete gameState.enemies[enemy.id]` na morte, sem nenhuma rotina de respawn (moedas têm, inimigos não). Valores acordados: 3 iniciais, teto 7, +1 a cada 10s. Round 2, não implementado ainda.
- **Causa B (S6, jogador estático extra):** `handlePlayerJoined`/`spawnRemotePlayer` sem checagem de existência antes de instanciar sprite — risco de sprite órfão em rejoin rápido. Round 2, não implementada ainda.

### 8.2 Implementado nesta sessão

**Item 2 — Seleção de personagem (completo, aprovado):**
- Cena nova `SelecaoPersonagem.js`, encaixada na FSM entre `MainMenu` e `Loading` (FSM 6→7 cenas, `AGENTS.md` §06 atualizado).
- Contrato de rede novo: `list_characters` (client→servidor, sem payload) / `character_list` (servidor→client, `{ personagens: [{id, nome, classe, nivel, em_uso}] }`). Servidor responde sem exigir `join` prévio (`server/server.js`).
- Modelo de posse: **pool compartilhado sem dono** (sem login, lista mostra todos os personagens; `em_uso` vem da trava de sessão já existente). Documentado em `roadmap_game.md` §1.2, junto com a lista do que o login destrava no futuro (seleção filtrada por dono, posse real, e a janela de ~300ms pós-morte do item de corrida abaixo).
- Modelo de conexão: **Modelo B** (socket por cena) agora, **Modelo A** (socket único via futuro `NetworkManager`) como alvo documentado — ordem de migração acordada: B agora → Causa A corrigida → passar no teste de campo → só então migrar. `networkConfig.js` criado (`SERVER_URL` + `sendMessage()`) como ponto único de endereço/formato, adotado também pela `ExploracaoCombate.js` já existente (grep confirmado: zero `JSON.stringify`/`ws://` fora de `networkConfig.js` nos arquivos do client).
- Três estados de tela (carregando / lista / erro de conexão) com timeout de 5s, e `closeConnection()` como método separado do `shutdown` da cena (C1/C2 respeitadas).

**Itens 3 e 4 — Join automático + reset da Causa A (implementados juntos, como as duas metades da mesma correção):**
- `create()` de `ExploracaoCombate`: `this.playerStats = null; this.myId = null;` no topo, toda vez que a cena é criada (inclusive em restart).
- `initMultiplayer()`: no `onopen` do socket, lê `personagem_id` do `registry` (gravado pela `SelecaoPersonagem`) e envia `join` automaticamente — cobre primeira conexão e reabertura pós-`scene.restart()`.

**Corrida de sessão morte↔`activeSessions` (bug novo, encontrado pelo dono do projeto antes do teste, corrigido):**
- Causa raiz: liberação de `activeSessions`/`gameState.players` dependia só do `ws.on('close')`, assíncrono e mais lento que o `join` automático do reconecte pós-morte — o servidor via o personagem "ainda em sessão" e recusava (`close(4000)`), reabrindo o modo zumbi por causa nova.
- Correção: função `liberarPersonagem(player)` (`server/server.js`) — síncrona até o ponto que importa (`delete gameState.players`/`activeSessions.delete` antes de qualquer `await`; gravação no banco em background). Chamada tanto na morte (`attack_enemy`, **antes** de zerar `personagemId` — ordem verificada) quanto no `close`, reaproveitando o guard `personagemId !== null` já existente em vez de criar flag nova.

**Item 1 — Fallback de log no dispatch:** implementado antes dos demais, `console.warn` com tipo + payload completo para qualquer `data.type` sem handler no `messageHandlers` do client.

### 8.3 Bug novo #1 — Inconsistência de tipo do `personagem_id` (diagnosticado, NÃO implementado)

Rastreamento completo feito (10 handlers do client + pontos do servidor). Conclusão: **apenas 2 dos 10 handlers cruzam tipo**, não todos — porque só esses dois derivam o id iterando chave de objeto (`for...in`) em vez de ler campo de valor:

1. `handleWelcome`: `pid !== this.myId` — `pid` é string (de `for...in data.state.players`), `this.myId` é number (campo `data.id`). **Sempre** spawna um fantasma do próprio jogador, mesmo sozinho — bug confirmado, mas não tinha sido percebido antes.
2. `handleStateUpdate`: `otherPlayers.has(pid)` — `Map` com chaves number, lookup com string. **Nunca bate.** Jogadores remotos nunca recebem atualização de posição via `state_update`, em nenhuma sessão com 2+ jogadores — explicação mais fundamental para "outro jogador sempre estático" do que a Causa A.

Os outros 8 handlers usam campos de valor (number dos dois lados) — sem cruzamento, confirmados corretos.

Enemies/itens não sofrem disso (ids nascem string desde a origem, `enemy_N`/`item_N`).

**Correção proposta e aprovada em conceito, aguardando implementação:** normalizar para string no único ponto de entrada real — `String(data.personagem_id)` no handler de `join` do servidor — e, **na mesma entrega**, `String(row.id)` no `em_uso` do `list_characters` (query independente, senão o `em_uso` quebra por acoplamento não percebido). Zero mudança necessária no client — `this.myId` vira string automaticamente e os dois bugs somem.

**Por que os testes automatizados nunca pegaram isso:** `test_join.js`/`test_pacote2.js`/`test_pacote4.js` só fazem `data.state.players[personagemId]` (acesso por colchete, sempre coage tipo) e nunca iteram `for...in` comparando contra o próprio id, nem simulam um segundo observador vendo o primeiro como jogador remoto — são scripts de perspectiva única, estruturalmente incapazes de exercitar essa classe de bug.

### 8.4 Bug novo #2 — Seleção de personagem mostra nível desatualizado (CONFIRMADO, a investigar)

Dono do projeto confirmou: matou inimigos com o Tanque Teste (id=5), banco reflete corretamente `nivel=2` (verificado via `SELECT`), mas a tela de `SelecaoPersonagem` mostrou "nível 1" depois disso. **Não é timing nem personagem trocado** — é leitura/renderização da seleção não refletindo o banco. `list_characters` faz `SELECT id, nome, classe, nivel FROM personagens` direto, sem cache conhecido no código atual — causa raiz ainda não investigada.

**A investigar amanhã:** quantos personagens classe `tanque` existem (`SELECT id, nome, classe, nivel FROM personagens WHERE classe='tanque'` — se houver mais de um "Tanque", pode ser confusão de qual linha está sendo exibida) e se há algum problema na query/render de `SelecaoPersonagem.renderList`.

### 8.5 Ainda não validado — bloqueado desde o início do teste

O teste de campo **nunca chegou a validar a Causa A nem a corrida de sessão**, porque o dono do projeto não conseguiu morrer — os inimigos se esgotam (Causa C, sem respawn, Round 2) antes de gerar uma morte. Método combinado para amanhã: ficar parado apanhando de propósito (sem contra-atacar) para forçar a morte sem depender de mais inimigos.

### 8.6 Round 2 — continua intocado

Causa B (fantasma por handler não-idempotente), respawn de inimigos (3 inicial / teto 7 / +1 a cada 10s), S4 (nível/level-up visível na UI), S5 (tremida vertical — reavaliar só depois da Causa A validada), remoção da moeda do inventário (`tipo='Recurso'`).

### 8.7 Ponto de retomada explícito (amanhã)

1. Implementar a normalização de tipo do `personagem_id` (§8.3) — `join` + `list_characters` na mesma entrega.
2. Investigar e corrigir o bug de nível desatualizado na seleção (§8.4).
3. Com os dois resolvidos, dono do projeto roda o teste de campo forçando a morte (apanhar sem revidar) para validar Round 1 completo: Causa A + corrida de sessão + os dois bugs de tipo.
4. Round 1 só fecha quando esse teste passar. Round 2 só começa depois disso.
