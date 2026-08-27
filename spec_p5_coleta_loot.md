# P5 — Coleta de Loot no Mapa (spec completa)

**Objetivo:** fechar o loop de loot visualmente. Mata inimigo → item cai no chão →
jogador anda por cima → item vai pro inventário. Reconstrói o caminho de coleta que
foi removido junto com a moeda, agora com propósito (equipamento de verdade).

**Regra de execução:** um sub-passo por vez, testando entre eles. Esta spec é o mapa;
não jogue os três no agente de uma vez. Cada sub-passo tem MODO ARQUITETO (plano antes
do código) onde indicado.

---

## Decisões de design já fechadas (contexto pro agente)

1. **Item repetido no inventário → INCREMENTA quantidade** (uma linha por tipo de item
   por personagem, não linhas duplicadas). A tabela `inventario` tem coluna `quantidade`
   e NÃO tem UNIQUE(personagem_id, item_id) — a lógica de "já tem? incrementa : insere"
   fica no código.
2. **Detecção da coleta → COLLIDER no client** (mesmo padrão do combate por toque, que
   também é client-side). O servidor é autoritário sobre o RESULTADO: confirma que o item
   ainda existe e resolve. Risco de trapaça irrelevante em LAN cooperativo.
3. **Item no chão SOME por timer (~45s)** — não acumula lixo no mapa. Timer roda no
   servidor (autoritário).
4. **Equipamento NÃO empilha bônus.** "Espada x2" é só contagem no inventário (bônus é
   sempre de UMA peça equipada). Poder vem de itens de TIERS diferentes (feature futura,
   conteúdo pra equipe), não de acumular cópias. O P5 usa os 2 itens que já existem
   (espada_enferrujada id=1, escudo_improvisado id=2) só pra fazer a mecânica funcionar.

---

## Estado atual relevante (do levantamento)

- `rolarDrops(mob_id)` já roda na morte do inimigo (P4), decide o que dropou, hoje só
  loga `[LOOT]`. A variável `enemy` ainda está viva no escopo da morte, com `enemy.x/y`
  (posição da morte) disponíveis.
- `gameState` hoje só tem `players` e `enemies`. Não existe entidade "item no chão".
- Padrão de entidade: estado em memória no servidor, aparece no `welcome` (join),
  eventos próprios de entrada/saída (ex.: `enemy_spawned`/`enemy_died`), client desenha
  no evento e remove no evento de saída. Item no chão NÃO se move → não precisa entrar no
  `state_update` (o tick de 20Hz); só precisa spawn/despawn + welcome.
- NÃO existe caminho de INSERT em `inventario` — só SELECT (join no login, ~linha 331-338)
  e UPDATE (equip/unequip, ~linha 430). O INSERT de coleta foi removido com a moeda;
  precisa ser reconstruído do zero.
- Coleta/toque hoje = collider Phaser no client (ExploracaoCombate.js:71-83), não checagem
  no tick do servidor.

---

## SUB-PASSO 5a — o drop vira "item no chão" no gameState + trafega

**Escopo:** o resultado do `rolarDrops` (na morte) vira uma entidade persistente no
`gameState`, trafega pro client, e expira por timer. NADA visual ainda (client é 5b),
NADA de coleta ainda (é 5c).

**MODO ARQUITETO primeiro, depois implementa.**

O que muda (só servidor):

1. Nova coleção `gameState.itensNoChao` (objeto chave→objeto), no mesmo molde de
   `players`/`enemies`.

2. Um contador de instância próprio (tipo o dos inimigos), gerando ids `drop_1`, `drop_2`…
   — o id da INSTÂNCIA do item no chão, distinto do `item_id` (o tipo do item no catálogo
   Itens) e do `id` da linha em `inventario`.

3. Na morte do inimigo, onde hoje o `rolarDrops` só loga: para cada `{item_id, quantidade}`
   dropado, criar uma entidade item-no-chão com:
   - `id` de instância (drop_N)
   - `item_id`, `quantidade`
   - `x`, `y` = `enemy.x`, `enemy.y` (posição da morte, já disponível no escopo)
   - `nome` do item (pro client exibir/colorir sem consultar banco) — buscar no catálogo
     de itens já carregado em memória, se existir; se não, avaliar carregar os Itens no
     boot (como MOBS_TIPOS) OU mandar só o item_id e o client resolve. RECOMENDE no
     arquiteto.
   - timestamp de criação (pro timer de expiração)

4. Broadcast de um evento novo `item_dropped` com o estado da entidade (pra todos os
   clients já conectados verem o item aparecer).

5. `welcome` (join) passa a incluir o snapshot de `itensNoChao` (pra quem entra depois de
   um item já ter caído ver ele no chão).

6. **Timer de expiração (~45s):** o item some sozinho depois de ~45s se ninguém pegar.
   RECOMENDE o mecanismo no arquiteto — provável: um sweep no tick existente (ou um
   setInterval) que remove itens cujo tempo de vida passou de 45s, com broadcast de um
   evento `item_expired` (ou reusar um `item_removed` genérico que sirva pra expiração E
   coleta). Evitar criar um setTimeout por item (vaza se o server reinicia / fica difícil
   de cancelar na coleta) — preferir sweep por timestamp.

NÃO fazer: desenhar no client (5b), coleta (5c), INSERT no inventário (5c). Só: a entidade
existe no servidor, trafega, e expira.

**Cuidados:**
- O `[LOOT]` log do 4b pode continuar ou virar redundante — manter por ora (ajuda o teste),
  remover quando o P5 fechar.
- Distinguir bem os três "ids": drop_N (instância no chão) / item_id (tipo no catálogo) /
  inventario.id (linha no inventário). Documentar no código.

**Teste do 5a (sem visual ainda):** matar inimigos e confirmar — via log OU inspeção do
WebSocket (Network > WS > Messages) — que: (a) `item_dropped` é emitido quando dropa,
(b) a entidade tem x/y/item_id/quantidade/id certos, (c) depois de ~45s o item some sozinho
(evento de expiração emitido). O item ainda não aparece na tela — normal.

---

## SUB-PASSO 5b — o client desenha o item no chão

**Escopo:** o jogador VÊ o item caído no mapa. Só client. Ainda sem coleta (5c).

O que muda (só client — ExploracaoCombate.js e afins):

1. Handler pra `item_dropped` → cria um sprite/retângulo do item no chão na posição x/y,
   guardado num Map local (tipo `itensNoChaoGroup`/mapa de sprites, como
   enemies/remotePlayers).

2. Handler pra `item_expired`/`item_removed` → destrói o sprite e remove do Map local
   (mesmo padrão do `enemy_died`).

3. `welcome`: ao entrar, iterar o snapshot de `itensNoChao` e desenhar cada um (mesmo
   padrão de spawnEnemy no welcome).

4. Aparência = DEBUG VISUAL, não arte final. Cor sólida por tipo de item (ex.: espada uma
   cor, escudo outra), com fallback. Um quadradinho menor que o player/inimigo, pra ler
   como "item no chão". Será substituído pelo sprite do Godot depois — não investir em
   bonito.

NÃO fazer: coleta, collider, INSERT. Só desenhar/remover o item no chão conforme os
eventos do servidor.

**Teste do 5b (visual):** matar inimigos e VER o item aparecer no chão onde o inimigo
morreu; esperar ~45s e ver ele sumir sozinho. Entrar com um segundo cliente e confirmar
que quem entra depois também vê o item que já estava no chão (welcome). Ainda não dá pra
pegar — andar por cima não faz nada. Normal.

---

## SUB-PASSO 5c — coleta: collider + INSERT no inventário

**Escopo:** o jogador anda por cima → pega o item → vai pro inventário. Aqui está o INSERT
que toca o banco. É o sub-passo mais delicado.

**MODO ARQUITETO primeiro, depois implementa.**

O que muda (client + servidor):

1. **Client:** collider Phaser (player × grupo de itens no chão), mesmo padrão do combate.
   Ao sobrepor, dispara `pickup_item` pro servidor com o `id` da instância (drop_N). Trava
   local opcional pra não spammar o mesmo pickup várias vezes enquanto sobreposto.

2. **Servidor — recebe `pickup_item`:**
   a. Confirma que o item `drop_N` AINDA EXISTE em `gameState.itensNoChao`. Se não existe
      (já foi pego ou expirou), ignora silenciosamente — **isto resolve a corrida de coleta
      multiplayer** (dois jogadores encostam quase juntos; só o primeiro pega; o segundo cai
      aqui e não recebe nada). O servidor é autoritário sobre quem pegou.
   b. Se existe: remove de `gameState.itensNoChao` IMEDIATAMENTE (antes do await do banco,
      pra fechar a janela de corrida) e guarda os dados (item_id, quantidade).
   c. **INSERT/incremento no inventário** (o caminho que sumiu com a moeda): checa se o
      personagem já tem aquele item_id no inventário —
      - SE JÁ TEM → UPDATE incrementando `quantidade` da linha existente.
      - SE NÃO TEM → INSERT nova linha (personagem_id, item_id, quantidade, equipado=0).
      Fazer isso de forma robusta (idealmente `INSERT ... ON DUPLICATE KEY UPDATE` só se
      houvesse UNIQUE — como NÃO há UNIQUE(personagem_id,item_id), fazer SELECT-then-
      INSERT/UPDATE no código, ciente de que sem UNIQUE duas coletas concorrentes DO MESMO
      personagem poderiam criar 2 linhas; como um personagem = uma conexão = serial, o
      risco é baixo, mas RECOMENDE no arquiteto se vale um UNIQUE na tabela pra garantir).
   d. Atualiza o inventário em MEMÓRIA do player (`player.inventario`) pra bater com o banco,
      senão a UI do inventário não reflete o item novo até um reload.
   e. Broadcast `item_removed`/`item_collected` (o item sai do chão pra todos os clients).
      Opcional: um evento só pro coletor confirmando o que pegou (pra feedback/UI).

3. **Consistência tripla:** o item precisa sair do chão (gameState), entrar no inventário
   (banco), e aparecer no inventário em memória (UI). Os três sincronizados.

**Cuidados:**
- **Corrida de coleta multiplayer:** resolvida por 2a+2b (confirmar existência + remover
  antes do await). Testar com 2 clientes.
- **Tipos vindos do banco:** se algum número novo vier de coluna DECIMAL, lembrar do bug
  DECIMAL-como-string (converter pra Number). quantidade é INT (ok), mas conferir.
- **UI do inventário:** confirmar que ao abrir o inventário depois de coletar, o item novo
  aparece (a memória do player foi atualizada em 2d).
- Remover o log `[LOOT]` temporário do 4b agora que o loot tem destino real.

**Teste do 5c (o loop completo):**
1. Matar inimigo, ver o item cair (5b), andar por cima → o item some do chão E aparece no
   inventário (abrir o inventário e conferir).
2. Pegar um item que você JÁ tem → a quantidade incrementa (não cria linha duplicada).
3. Equipar o item coletado → funciona (o pipeline de equipar já existe).
4. Multiplayer: dois jogadores correm pro mesmo item → só um pega, o outro não ganha nada
   (sem duplicação).
5. Item expira: deixar um item no chão ~45s sem pegar → some sozinho, e não dá pra pegar
   depois.

Quando os 5 testes passarem, o P5 fecha — e o bloco de loot fica completo até o boss (P3).

---

## Depois do P5 (fora de escopo, registrado)

- **Commit + push** ao fechar o P5 (fechou passo validado = salva no git).
- **Sistema de TIERS de itens + catálogo variado** — conteúdo pra delegar à equipe (criam
  os itens/tiers; Andrei liga na mob_drops). É o que dá sentido a "inimigo forte dropa
  melhor".
- **P3 — boss principal + dungeons** (o grande, por último no bloco).
