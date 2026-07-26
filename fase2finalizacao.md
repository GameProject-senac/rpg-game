# fase2finalizacao.md — Achados do Teste de Campo e Plano de Fechamento da Fase 2

> **Status da Fase 2: NÃO FECHADA.**
>
> Os 5 pacotes da `fase2_spec.md` foram implementados e passaram em seus critérios automatizados. Porém, o **teste de campo manual** — executado pelo dono do projeto no navegador, em fluxo real de jogo — revelou falhas funcionais graves não capturadas pelos testes automatizados.
>
> **Regra de fechamento (decisão do projeto):** a Fase 2 só será considerada fechada quando passar no **teste manual conduzido pelo dono do projeto**. Aprovação por teste automatizado ou por inspeção de código não é suficiente.
>
> **Atualização (sessão seguinte, registrada na íntegra em §8):** diagnóstico completo feito, causa raiz confirmada (playerStats stale + corrida de sessão na morte), correções do Round 1 implementadas mas **ainda não validadas em teste de campo** — o teste ficou bloqueado por dois achados novos no meio do caminho: inconsistência de tipo do `personagem_id` (number vs. string) e a seleção de personagem exibindo nível desatualizado. Ver §8 para o estado exato e o ponto de retomada.
>
> **Atualização (sessão seguinte a essa, registrada em §8.8-§8.9):** os dois bloqueios foram resolvidos — normalização de tipo do `personagem_id` **implementada**, bug de nível na seleção **diagnosticado e adiado** (confirmado cosmético, não bloqueia). Round 1 está com todas as correções implementadas, **aguardando apenas o teste de campo manual** para fechar.
>
> **Atualização (sessão seguinte a essa, registrada na íntegra em §10):** Round 1 **fechado e validado em campo**. Round 2: 3 dos 4 itens validados em campo (respawn de inimigos revertido para 3/7, nível visível na UI, fantasma duplicado corrigido). Falta só um filtro de renderização (esconder `tipo='Recurso'` na barra de itens) para fechar o Round 2 — e com ele, a Fase 2 inteira. Ver §10 para o estado exato e o ponto de retomada.

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

### 8.11a S5 (tremida) — corrigida, Opção B aplicada

Causa raiz (§ diagnóstico anterior): `roundPixels: true` + lerp fracionário (0.08) na câmera, combinado com a faixa de perseguição vertical muito maior que a horizontal (mundo 2000×2000 vs viewport 1920×920) — jogador não tremia, a câmera tremia visualmente.

**Correção aplicada** (`ExploracaoCombate.js`): `this.cameras.main.startFollow(this.player, true);` — câmera segue direto (lerp default = 1, instantâneo), `roundPixels` mantido ligado. Decisão do dono do projeto: manter nitidez pronta para quando a arte real (Godot) chegar, sem desligar `roundPixels` (evita retrabalho).

**Pendência de polimento registrada (NÃO fazer agora):** reintroduzir suavização de câmera sincronizada com o passo de física, mantendo nitidez — só decidir quando a equipe de design entregar os sprites reais, porque resolução/estilo de arte/tamanho em pixels do personagem definem o ajuste correto. Configurar agora seria adivinhar.

### 8.12 Round 2 — Item em andamento: Respawn de inimigos (Causa C)

Autorizado pelo dono do projeto. Valores travados (não alterar sem nova autorização): população inicial 3, teto 7, +1 a cada 10s enquanto houver menos de 7 — comportamento intencional ("mapa sobe de 3 pra 7 nos primeiros ~40s, jogador joga esvaziando").

**Benefício extra registrado:** com o respawn funcionando, o próximo teste de campo do dono do projeto também valida a **invulnerabilidade de respawn** (§8.11), implementada mas ainda não testada por falta de inimigos vivos no momento da morte.

**Implementado** (`server/server.js` + `ExploracaoCombate.js`):
- Timer próprio (`ENEMY_RESPAWN_INTERVAL = 10000`, mesmo padrão do `SNAPSHOT_INTERVAL` já existente) — não acoplado ao tick de 20Hz.
- 4 pontos fixos de spawn (`ENEMY_SPAWN_POINTS`, os 3 originais + 1 novo no 4º quadrante), ciclados a cada novo spawn; população inicial continua sendo os 3 primeiros.
- `state_update` confirmado (por leitura de `handleStateUpdate`) como incapaz de introduzir inimigo novo ao client — só atualiza posição de ids já conhecidos. Novo tipo `enemy_spawned` (payload `{ enemy }`) criado espelhando exatamente o padrão já existente de `items_respawned`/`handleItemsRespawned`; client trata em `handleEnemySpawned` chamando `this.spawnEnemy(data.enemy)` (função de spawn já existente, não duplicada).
- Sem checagem de "não nascer em cima de jogador" — decisão aprovada do dono do projeto (risco desprezível, fora do padrão atual do projeto). Observação registrada: com 4 posições fixas e teto 7, inimigos podem nascer sobrepostos entre si; aceito, sem ação (nascem espaçados de 10s e saem do canto rápido).
- `node --check` validado em ambos os arquivos. Smoke test ao vivo não rodado nesta sessão — porta 8080 já ocupada pelo servidor que o dono do projeto já mantinha rodando; evitado derrubar processo alheio. Validação por leitura de código completa.

**Próximo passo:** dono do projeto reinicia o próprio servidor (pra carregar o código novo — Node não faz hot-reload) e roda o teste de campo. Esse teste agora também valida a invulnerabilidade de respawn (população de inimigos garantida).

### 8.13 Bug novo #4 — Invencibilidade permanente (introduzido pela invulnerabilidade de respawn, corrigido)

**Sintoma:** após a correção do respawn, surgiu invencibilidade permanente — o personagem tomava 1-2 golpes e travava invencível pra sempre; precisava de 3+ colisões pra sofrer o primeiro dano real. F5 restaurava vulnerabilidade por 1-2 golpes e travava de novo.

**Causa raiz confirmada:** `reviveu`/a concessão de invulnerabilidade era recalculada do `hp_atual` do banco a cada join (`row.hp_atual <= 0`). Como a cura só existe em memória (grava no banco só via snapshot de 10s ou `liberarPersonagem`), e os personagens de teste já estavam com `hp_atual <= 0` persistido de sessões anteriores (confirmado por `SELECT` nesta mesma conversa, §8.11), a condição nunca deixava de ser verdadeira — todo join (inclusive um F5) reconcedia uma nova janela de 3s. Não era a flag travada; era a condição sendo satisfeita de novo, indefinidamente. "3+ colisões pra sofrer o primeiro dano" batia com o tempo de reaproximação pós-knockback consumindo a janela de 3s sempre renovada.

**Correção implementada — separação de cura (estado permanente) e invulnerabilidade (evento transitório):**
- **Cura** (`server/server.js`, join): continua lendo `row.hp_atual <= 0` do banco, idempotente, cobre os personagens já corrompidos de testes anteriores. Sem mudança de comportamento aqui.
  ```js
  const precisaCurar = row.hp_atual <= 0;
  if (precisaCurar) { player.hp_atual = player.hp_max; }
  ```
- **Invulnerabilidade**: novo `Set` transitório `respawnPendente` (mesmo padrão de `activeSessions`, chave = `personagem_id`), populado no INSTANTE da morte (`attack_enemy`) e consumido (`Set.delete()`, remove e retorna se existia) no PRÓXIMO join daquele personagem — não depende mais do banco.
  ```js
  // na morte:
  respawnPendente.add(player.id);
  // no join:
  const concederInvulnerabilidade = respawnPendente.delete(requestedId);
  if (concederInvulnerabilidade) { player.invulneravelAte = Date.now() + 3000; }
  ```
- `welcome.reviveu` agora reflete `concederInvulnerabilidade`, não mais a cura.

**Efeito colateral correto (não é bug):** um F5 com o personagem ainda vivo não concede mais invulnerabilidade de graça — só uma morte real popula `respawnPendente`. Mais correto que o comportamento anterior; imunidade agora significa exatamente "morri e renasci".

**Ponta solta registrada (NÃO corrigir agora — refinamento futuro):** a cura continua só em memória até o snapshot/saída persistir no banco — existe uma janela onde o banco mostra HP negativo mesmo com o personagem já curado, e a tela de seleção pode exibir HP velho por alguns segundos. Cosmético agora que a invulnerabilidade não depende mais do banco. Refinamento futuro: persistir a cura no banco no momento do join fecharia essa fresta.

`node --check` validado. **Próximo teste de campo agora valida de verdade a invulnerabilidade de respawn:** morrer perto de um inimigo, renascer, confirmar ~3s de imunidade e que ela **acaba** depois — o teste que o bug anterior impedia.

### 8.6 Round 2 — continua intocado

Causa B (fantasma por handler não-idempotente), respawn de inimigos (3 inicial / teto 7 / +1 a cada 10s), S4 (nível/level-up visível na UI), S5 (tremida vertical — reavaliar só depois da Causa A validada), remoção da moeda do inventário (`tipo='Recurso'`).

### 8.7 Ponto de retomada explícito (histórico — superado por §8.8/§8.9)

1. ~~Implementar a normalização de tipo do `personagem_id` (§8.3) — `join` + `list_characters` na mesma entrega.~~ — feito, ver §8.8.
2. ~~Investigar e corrigir o bug de nível desatualizado na seleção (§8.4).~~ — investigado, causa raiz confirmada, correção **adiada por decisão do dono do projeto** (cosmético). Ver §8.9.
3. Com os dois resolvidos, dono do projeto roda o teste de campo forçando a morte (apanhar sem revidar) para validar Round 1 completo: Causa A + corrida de sessão + os dois bugs de tipo.
4. Round 1 só fecha quando esse teste passar. Round 2 só começa depois disso.

### 8.8 Item 1 implementado — Normalização de tipo do `personagem_id`

**Autorizado e implementado nesta sessão.** Correção aplicada em `server/server.js`, dois pontos, mesma entrega, exatamente como proposto em §8.3:

```js
// join — ponto de entrada único da normalização
const requestedId = String(data.personagem_id);
```

```js
// list_characters — em_uso comparado com o mesmo tipo
em_uso: activeSessions.has(String(row.id))
```

**Cadeia de propagação verificada ponto a ponto** (exigido antes de aceitar a entrega): `personagemId` (variável de sessão da conexão) e `player.id` (copiado de `personagemId` na criação do objeto em `gameState.players`) são a única fonte de onde todo id sai do servidor daqui pra frente — `welcome.id`, `combat_event.playerId`, `enemy_died.killerId`, `player_died.playerId`, `level_up.personagem_id`, `inventory_update`/`stats_updated.personagem_id`, `player_left.id`, e as duas pontas do `activeSessions` (`add` no `join`, `delete` em `liberarPersonagem`). Nenhum desses reintroduz `data.personagem_id` bruto — todos herdam a string normalizada. `state_update` (broadcast do `gameState.players` inteiro) também sai consistente como consequência, sem precisar de edição própria (chaves de objeto já são string por natureza do JS; o campo `id` de cada player já vem normalizado).

`node --check server/server.js` validado sem erro. Resolve os dois bugs de identidade confirmados no diagnóstico anterior: fantasma do próprio jogador em `handleWelcome` e jogadores remotos nunca atualizando em `handleStateUpdate`. Nenhuma mudança no client foi necessária.

### 8.9 Item 2 diagnosticado — Nível desatualizado na seleção (adiado, cosmético)

**Query solicitada** (`SELECT id, nome, classe, nivel, experiencia FROM personagens WHERE classe='tanque'`): resultado com **uma única linha** — id=5, "Tanque Teste", `nivel=2`, `experiencia=50`. Descarta a hipótese original de confusão entre duas linhas "Tanque" — não há linha concorrente.

**Causa raiz confirmada:** `SelecaoPersonagem.js` não tem nenhum mecanismo de atualização — a lista é buscada **uma única vez** no `create()` (`onopen` dispara `list_characters`, a resposta chama `renderList()` e imediatamente `closeConnection()`). Não há polling, nem re-fetch em foco/wake, nem cache indevido no servidor (a query SQL é live e correta, confirmado por inspeção). O único caminho de reentrada na cena é `MainMenu → scene.start('SelecaoPersonagem')` (via reload completo da página); não existe caminho de volta a partir de `ExploracaoCombate`. Logo, "nível 1" só é possível se a tela observada for uma aba/instância renderizada **antes** da subida de nível — consistente com o padrão de múltiplas abas já usado em testes de campo anteriores (id=3/id=4).

**Confirmado pelo dono do projeto:** a aba observada era antiga, aberta antes da subida de nível. **Não é bug de dado** (banco sempre esteve correto) — é staleness de tela (fetch-once sem re-sincronização).

**Decisão do dono do projeto:** NÃO corrigir agora. Classificado como pendência cosmética/polimento, não bloqueia o Round 1. Registrado aqui para tratar junto do resto do polimento (Round 2 ou fase de polimento dedicada) — correção "de verdade" seria a tela se atualizar ao voltar a ficar ativa (`wake`/`resume` do Phaser reenviando `list_characters`). Decisão sobre single-tab vs. múltiplas abas simultâneas também adiada para essa mesma ocasião.

**Mitigação para o teste de campo de agora:** recarregar a página (F5) antes de checar a tela de seleção, garantindo dado fresco durante a validação do Round 1.

### 8.10 Estado atual — pronto para teste de campo

Round 1 tem todas as correções **implementadas**:
- Causa A (playerStats/myId stale no restart) — Round 1 anterior.
- Corrida de sessão morte↔reconecte (`liberarPersonagem` síncrona) — Round 1 anterior.
- Normalização de tipo do `personagem_id` (§8.8) — **nova nesta sessão**.

Pendência cosmética da seleção (§8.9) diagnosticada e formalmente adiada, não bloqueia.

**Próximo passo:** dono do projeto roda o teste de campo forçando a morte (apanhar sem revidar, sem contra-atacar) para validar Round 1 completo de uma vez: Causa A + corrida de sessão + normalização de tipo. Round 1 só fecha quando esse teste passar. Round 2 (Causa B, respawn de inimigos, S4, S5, moeda no inventário) só começa depois — e a pendência da tela de seleção (§8.9) entra na fila do polimento, junto do Round 2 ou de uma fase dedicada.

### 8.11 Bug novo #3 — Modo zumbi persistia por HP negativo herdado da morte (diagnosticado e corrigido)

**Sintoma do teste de campo:** corrida de sessão confirmada corrigida (zero `[join] Recusado` no log — o reconecte pós-morte é sempre aceito). Porém o modo zumbi **persistia por uma causa nova**: após renascer, o personagem andava (predição local) mas não tinha barra de HP, não causava nem tomava dano.

**Causa raiz confirmada no código (não hipótese):** o servidor nunca clampa `hp_atual` em zero no combate (`player.hp_atual -= danoNoPlayer`, sem `Math.max`), e `liberarPersonagem` persiste esse valor negativo literalmente no banco. O `join` do reconecte automático carrega esse `hp_atual` negativo direto do banco (`row.hp_atual`, sem cura). O servidor aceita o `join` normalmente (join funciona, welcome é enviado), mas o guard de dispatch `if (!player || player.hp_atual <= 0) return` — que roda antes de QUALQUER ação, inclusive `player_move` — descarta silenciosamente tudo o que o client envia depois disso. O client não estava quebrado: refletia fielmente um servidor que já considerava aquele personagem morto. A hipótese inicial (falha no ciclo do socket / `handleWelcome` não executando) foi **refutada pelo próprio sintoma relatado** — se `playerStats` estivesse `null`, o `update()` teria retornado antes de aplicar qualquer movimento, e o personagem não andaria.

**Estado real do banco no momento do diagnóstico** (confirmado via `SELECT`): 4 dos 5 personagens de teste já estavam com `hp_atual <= 0` (id=1: 0, id=2: -8, id=3: 0, id=4: -4; só id=5 vivo, 37) — evidência prática, não só teórica, de que a cura precisava cobrir dados já corrompidos.

**Correção implementada (autorizada em duas partes):**

1. **Cura no `join`** (`server/server.js`), não na morte — decisão justificada e aprovada: curar só na morte não resolveria os 4 registros já corrompidos (a cura não seria retroativa); curar no `join` cobre mortes futuras E dados já corrompidos no mesmo ponto, seguindo o mesmo padrão do item 1 (join como ponto único de saneamento de estado ao materializar o personagem). Trecho:
   ```js
   const reviveu = row.hp_atual <= 0;
   if (reviveu) {
       player.hp_atual = player.hp_max;
       player.invulneravelAte = Date.now() + 3000;
   }
   ```
   (`player.hp_max` já vem calculado por `recalcularAtributosEfetivos(player)`, chamado logo antes — nenhuma reordenação foi de fato necessária, só inserir a checagem depois dessa chamada.)

2. **Invulnerabilidade autoritária de 3s**, amarrada à mesma condição de respawn (`reviveu`) — servidor decide, client só reflete:
   - Servidor grava `player.invulneravelAte` no `join` (acima) e **enforça** em `attack_enemy` (`server/server.js`): se `Date.now() < player.invulneravelAte`, o dano ao jogador é pulado (o inimigo ainda toma dano — o jogador pode revidar, só não pode ser ferido). Checagem por tempo, sem `setTimeout`/cleanup — expira sozinha.
   - `welcome` ganhou o campo `reviveu: true/false`.
   - Client (`ExploracaoCombate.js`, `handleWelcome`) reaproveita a MESMA flag/padrão já usado no knockback (`this.player.invulnerable` + `this.time.delayedCall`) — nenhum sistema novo, só estendido para cobrir o respawn.

`node --check` validado em ambos os arquivos.

**Caso de borda registrado (NÃO corrigido agora — decisão de design pendente para o polimento):** o gatilho da cura/invulnerabilidade é "entrou com `hp_atual <= 0`", o que cobre exatamente o caso de morte. Mas um jogador que fecha a aba/desconecta com pouca vida (ex.: 5/100, não zero) reconecta com essa vida baixa, sem cura nem invulnerabilidade — pode morrer rápido ao voltar. Não bloqueante, raro. **Decisão pendente para quando o polimento for tratado:** reconectar sempre cura pra vida cheia (mesmo sem ter chegado a zero), ou mantém o estado exato de HP de quando saiu? Fica junto do resto do polimento (§8.9, Round 2).

**Próximo passo:** dono do projeto roda o teste de morte novamente — agora valida Round 1 por completo: Causa A + corrida de sessão + normalização de tipo + cura/invulnerabilidade no respawn.

---

## 9. Estado consolidado — ponto único de retomada (superado tudo antes desta seção)

> Esta seção é o resumo vivo do estado real. Em caso de dúvida sobre "onde paramos", leia aqui primeiro; as seções anteriores (§1-§8) são o histórico/diagnóstico que chegou até aqui.

### 9.1 Round 1 — FECHADO E VALIDADO EM CAMPO

- Causa A (`playerStats`/`myId` stale no `scene.restart()`).
- Corrida de sessão morte↔reconecte (`liberarPersonagem` síncrona).
- Normalização de tipo do `personagem_id` (string em toda a cadeia).
- Cura no respawn (join cura `hp_atual <= 0` pra `hp_max`).

Todas validadas no teste de campo: modo zumbi morto, ressurreição funciona, persistência de HP/nível funciona.

### 9.2 Round 2 — EM ANDAMENTO

**Já implementado e validado em campo:**
- Respawn de inimigos (contínuo, início 3, teto 7, +1 a cada 10s) — mapa não esvazia mais.
- Câmera-B (`startFollow` sem lerp fracionário, `roundPixels` mantido) — tremida (S5) resolvida.

**Implementado, aguardando teste de campo (próximo teste do dono):**
- Correção (b) da invencibilidade permanente (§8.13): sinal transitório `respawnPendente` (`Set` server-side por `personagem_id`), populado na morte, consumido uma vez no join via `Set.delete()`. Invulnerabilidade agora depende do EVENTO de morte, não do `hp_atual` do banco. Cura permanece ligada a `row.hp_atual <= 0` (mantém a faxina dos personagens 1-4, já corrompidos de testes anteriores).
  - **O que este teste deve validar:** (1) morrer perto de um inimigo → renascer com ~3s de invulnerabilidade; (2) **crítico** — a invulnerabilidade EXPIRA depois de ~3s e o dano volta ao normal (o bug anterior impedia observar isso); (3) F5 com o personagem ainda vivo NÃO concede invulnerabilidade (comportamento correto, não é regressão).

**Ainda na fila do Round 2 (não iniciado):**
- S4 — nível/level-up visível na UI (hoje sobe no banco mas é invisível no jogo; arqueiro chegou a nível 8 sem feedback visual).
- Causa B — fantasma por handler não-idempotente (`handlePlayerJoined`/`spawnRemotePlayer` sem checar existência antes de instanciar).
- Remoção da moeda do inventário (`tipo='Recurso'`).

### 9.3 Pendências cosméticas / refinamento (registradas, não bloqueiam)

- Seleção mostra nível/HP com defasagem (fetch-once, sem re-sync — §8.9). Mitigado com F5 antes de checar.
- Cura do respawn é em memória; banco só atualiza no snapshot/saída — fresta onde o banco mostra HP negativo com o personagem já curado (§8.13). Refinamento futuro: persistir a cura no join.
- Barra de HP parece seguir a direção do personagem (cosmético menor, não investigado a fundo).
- Inimigos podem nascer sobrepostos (4 posições fixas, teto 7) — na prática não incomoda, dado o espaçamento de 10s entre spawns.
- Trava pontual de movimento ("preso subindo") observada uma vez — provável rede, investigar se recorrer.

### 9.4 Decisões de design adiadas (registradas, sem prazo)

- Login — destrava: seleção filtrada por dono, posse real de personagem, fecha a janela de "roubo" pós-morte (§1.2 do roadmap), e a decisão de reconectar-com-pouca-vida abaixo.
- Combate com ação intencional (ataque/defesa) — hoje é só colisão que fere os dois lados.
- Modelo A de conexão (`NetworkManager`, socket único entre cenas) — migração planejada pós-Fase-2 (roadmap §1.2).
- Reconectar com pouca vida (não zero, ex. 5/100): cura sempre pra cheio, ou mantém o estado exato de quando saiu? (§8.11 caso de borda).
- Loop de prestígio / new game+ — personagem fica forte demais e "colapsa" pra uma fase mais avançada.
- Afinamento fino da câmera — só decidir quando a equipe de design (Godot) entregar os sprites reais (§8.11a).

### 9.5 Ponto de retomada — HISTÓRICO (superado por §10)

O dono do projeto vai rodar o teste de campo da correção (b) da invulnerabilidade (§9.2). Conforme o resultado:
- **Se passar:** Round 1 e os dois itens já validados do Round 2 seguem fechados; avançar para os itens restantes do Round 2 (S4, Causa B, remoção da moeda) — nessa ordem ou na ordem que o dono preferir.
- **Se falhar:** diagnosticar (MODO DEBUG) antes de avançar — não seguir para o resto do Round 2 com essa correção ainda instável.

> Resultado: passou. Ver §10 para o que veio depois — os dois bugs novos revelados por esse mesmo teste (movimento congelado no respawn, número de HP desatualizado), os 4 itens do Round 2 e o estado atual.

---

## 10. Estado consolidado — sessão de fechamento parcial do Round 2 (superado tudo antes desta seção)

> Esta seção é o resumo vivo do estado real, mesma função do §9 anterior. Em caso de dúvida sobre "onde paramos", leia aqui primeiro; §1-§9 são histórico/diagnóstico que chegou até aqui.

### 10.1 Round 1 — FECHADO E VALIDADO EM CAMPO (sem mudança desde §9.1)

- Causa A (`playerStats`/`myId` stale no `scene.restart()`).
- Corrida de sessão morte↔reconecte (`liberarPersonagem` síncrona).
- Normalização de tipo do `personagem_id` (string em toda a cadeia).
- Cura no respawn (join cura `hp_atual <= 0` pra `hp_max`).

### 10.2 Correção (b) da invulnerabilidade — validada, mas revelou 2 bugs novos (ambos corrigidos)

O teste de campo da correção (b) (`respawnPendente`, §8.13/§9.2) passou no que se propunha validar: imune ~3s ao renascer, imunidade expira corretamente, F5 com personagem vivo não concede imunidade de graça. Mas o próprio teste — a primeira vez que alguém reengajou em combate logo após renascer — expôs dois bugs que não tinham como aparecer antes:

**Bug 1 — invulnerabilidade de respawn congelava o movimento (corrigido).** Causa raiz: `this.player.invulnerable` era uma única flag usada para dois propósitos (knockback: imune a dano + sem controle de movimento; respawn: reaproveitava a mesma flag). Certo para knockback, errado para respawn — o jogador ficava preso em cima do inimigo por 3s, o oposto do propósito da invulnerabilidade. Efeito colateral extra encontrado: a mesma flag também bloqueava o `collider` de ataque, então o jogador nem conseguia revidar durante o respawn, contrariando o próprio comportamento autoritário do servidor ("pode revidar, só não pode ser ferido"). **Correção:** flag nova e separada, `this.player.respawnShield` (`ExploracaoCombate.js`, `create()` + `handleWelcome`) — não gateia nem movimento nem o collider de ataque. Knockback (`this.player.invulnerable`) intocado. Gancho para feedback visual futuro (blink/tint) deixado preparado, sem efeito implementado (decisão explícita: fica pro polimento).

**Bug 2 — número de HP embaixo desatualizado (corrigido).** Causa raiz: a barra de HP (`update()`) lê `this.playerStats.hp_atual` direto, todo frame; o número embaixo (`UIScene.renderStats`) só atualiza ao receber o evento `stats_updated`. Três dos quatro pontos que escrevem `hp_atual` emitiam esse evento (`handleWelcome`, `handleLevelUp`, `handleStatsUpdated`) — `handleCombatEvent` (dano em combate normal) não emitia, então o número ficava preso no último valor de um desses três. **Correção:** helper `atualizarStatsUI()` centraliza o emit a partir do `playerStats` atual; todos os 4 pontos passaram a chamá-lo, incluindo `handleCombatEvent` quando o dano é no próprio jogador.

Independentes um do outro — nenhum foi introduzido pela correção (b), só ficaram visíveis porque foi o primeiro teste que conseguiu morrer e reengajar em combate imediatamente depois.

`node --check` validado em `server.js` e `ExploracaoCombate.js` em toda a sessão.

### 10.3 Round 2 — 3 de 4 itens FECHADOS e validados em campo; falta 1

| # | Item | Status |
|---|---|---|
| 1 | Reverter config de teste dos inimigos (10 → 3 inicial / 7 teto) | ✅ Validado em campo |
| 2 | S4 — nível visível na UI + indicador transitório "NÍVEL X!" | ✅ Validado em campo |
| 3 | Remover moeda/score (Opção A: tudo) | ⚠️ Quase — ver §10.4 |
| 4 | Causa B — fantasma duplicado (`handlePlayerJoined` idempotente) | ✅ Validado em campo (2 abas, "em uso" correto) |

Já validados em campo antes desta sessão (sem mudança): respawn de inimigos contínuo, câmera-B (tremida S5 resolvida), invulnerabilidade de respawn (§10.2).

**Item 1 — nota técnica:** a config de teste (10/10) tinha exigido um ajuste necessário (não cosmético) no loop de população inicial — indexação com módulo (`ENEMY_SPAWN_POINTS[i % ENEMY_SPAWN_POINTS.length]`) porque só existem 4 pontos fixos de spawn e o teste excedia esse número. Revertido para 3/7, mas o módulo ficou (inofensivo com 3 < 4, resultado idêntico a antes — não precisa reverter).

**Item 2 — abordagem:** texto simples "NÍVEL X!" (`this.levelUpText`, `ExploracaoCombate.js`) aparece por 3s e some sozinho (`delayedCall` com cancelamento se subir 2 níveis em sequência rápida). Nível também passou a aparecer permanentemente na linha de stats da `UIScene` (`NÍVEL: N  HP: ...`). Sem sistema visual elaborado, conforme escopo pedido.

**Item 3 — Opção A aprovada (remover tudo, não só o filtro):** implementado por completo — servidor (`spawnMoedas`, `pickup_item`, `player.score` em ambos os pontos — o `+10` da moeda e também o `+50` de matar inimigo, morto do mesmo jeito) e client (`itemsGroup`, `itemData`, `spawnItem`, `handleItemDespawned`, `handleItemsRespawned`, `this.score`/`scoreText` "DADOS COLETADOS"). `UIScene.renderInventory` não foi tocado — é a base genérica reaproveitável pro loot futuro, só que agora nunca recebe nada porque nada mais insere em `inventario` por esse caminho.

### 10.4 Item 3 — ponta solta que falta para fechar o Round 2

Dados **já persistidos** no banco de sessões de teste anteriores (linhas `tipo='Recurso'`, item_id='moeda') continuam na tabela `inventario` e ainda aparecem na barra de itens embaixo, junto com equipamento legítimo (ex.: espada/escudo do arqueiro) — porque a remoção do item 3 parou a criação de linhas novas, mas não apaga as antigas nem filtra o que já existe.

**Combinação acordada para fechar (duas partes, uma de cada lado):**
1. **Dono do projeto (hoje, fora desta sessão):** apaga manualmente via SQL as linhas `tipo='Recurso'` da tabela `inventario`. Limpa o dado persistido.
2. **Agente (amanhã):** filtrar a renderização da barra de itens (`UIScene.js`, `renderInventory`) para **não desenhar `tipo='Recurso'`**, mantendo `tipo='Equipamento'` visível — Opção 1 (filtro na renderização, não no backend). Isso garante blindagem mesmo que sobre algum `Recurso` residual no banco (ex.: outro personagem de teste não limpo). **Não implementado ainda — só combinado.**

Depois do filtro + a limpeza do banco, o dono roda o teste final do Round 2.

### 10.5 Moeda/score — registro de design (não é bug, é decisão)

Removidos por decisão do dono do projeto porque eram **ilusórios**: o `player.score` do servidor nunca era lido em lugar nenhum (campo morto desde sempre — nem `+10` nem `+50`), e o "DADOS COLETADOS" do client era um contador local volátil (zera no F5, nunca sincroniza com o servidor). Manter um placar que engana é pior que não ter.

**"Coletar moeda pra pontuar" está fora do design do jogo.** O que entra no futuro é coletar **ITENS IMPORTANTES** (loot com peso — armas, materiais), que nasce junto com o inventário clicável (Round 3 / fase de itens dedicada), não como um placar de pontos.

### 10.6 Inventário clicável — descoberta que mudou o escopo (adiado como trabalho futuro próprio)

Descoberta desta sessão: o inventário do client **nunca funcionou de verdade**. Ele coleta (formava a fila horizontal embaixo) mas não abre, não é clicável, não tem tela/ações — o Pacote 4 só validou o backend por script (`test_pacote4.js`), nunca o client de verdade. Isso não é um bug pontual a corrigir dentro do Round 2 — é uma feature que nunca existiu.

**Decisão do dono do projeto:** UI de inventário clicável fica como **trabalho futuro próprio** (Round 3 / fase de itens), fora do escopo do Round 2. O Round 2 só cuidou de remover a moeda-no-inventário (§10.3/§10.5), não de construir a UI que falta.

### 10.7 Decisões de design adiadas (registradas, sem prazo — lista consolidada)

- Login — destrava: seleção filtrada por dono, posse real de personagem, fecha a janela de "roubo" pós-morte, e a decisão de reconectar-com-pouca-vida abaixo.
- Combate com ação intencional (ataque/defesa) — hoje é só colisão que fere os dois lados.
- Modelo A de conexão (`NetworkManager`, socket único entre cenas) — migração planejada pós-Fase-2.
- `hp_max` não persistido no banco — recalculado sempre de classe+nível via `recalcularAtributosEfetivos`, nunca lido de uma coluna própria. Funciona por design atual (classe+nível são a fonte da verdade), mas registrado como decisão consciente, não descuido.
- Reconectar com pouca vida (não zero, ex. 5/100): cura sempre pra cheio, ou mantém o estado exato de quando saiu?
- Loop de prestígio / new game+ — personagem fica forte demais e "colapsa" pra uma fase mais avançada.
- Afinamento fino da câmera — só decidir quando a equipe de design (Godot) entregar os sprites reais.
- Inventário clicável (UI real de itens) — Round 3 / fase de itens dedicada (§10.6). Loot com peso (armas, materiais) nasce junto disso; "moeda pra pontuar" não volta.

### 10.8 Ponto de retomada

Amanhã, nessa ordem:
1. Confirmar que o dono já limpou as linhas `tipo='Recurso'` de `inventario` no banco (§10.4, parte 1).
2. Implementar o filtro de renderização em `UIScene.renderInventory` — não desenhar `tipo='Recurso'`, manter `tipo='Equipamento'` (§10.4, parte 2). Único item de código pendente no Round 2.
3. Dono do projeto roda o teste de campo final do Round 2: inimigos 3/7, nível na tela, sem fantasma duplicado, barra de itens só com equipamento.
4. Se passar: Round 2 fecha, **Fase 2 fica completa** (Round 1 + Round 2 fechados). Próximo passo aí é decidir o que entra na próxima fase (candidatos naturais: Round 3/inventário clicável+loot, ou qualquer item da lista de decisões adiadas em §10.7).
5. Se falhar: diagnosticar (MODO DEBUG) antes de prosseguir.
