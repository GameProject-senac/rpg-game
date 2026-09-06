# Insumo para a reorganização da documentação

**O que é isto:** material de contexto para alimentar a reorganização dos docs do
projeto. Contém as DECISÕES DE DESIGN (com o porquê), as ARMADILHAS/lições
recorrentes, e o MÉTODO DE TRABALHO — coisas que foram decididas em conversa de
arquitetura e podem NÃO estar registradas nos docs do repo nem na memória do agente
(porque nasceram de discussão, não de ações de código). Use isto para preencher as
lacunas identificadas na auditoria, sem duplicar o que os docs já cobrem.

**Não copie isto verbatim para um doc.** Destile: as armadilhas técnicas você
provavelmente já conhece do código — complete com as de DESIGN e os PORQUÊS abaixo.

---

## A. ARMADILHAS CONHECIDAS (técnicas)

1. **DECIMAL do MySQL volta como STRING.** Colunas `DECIMAL` (ex.:
   `personagens.experiencia` DECIMAL(12,2), `mobs.experiencia_dropada`) chegam do
   driver mysql2 como **string**, não número. Fazer conta direto (`+`, `*`)
   concatena/dá NaN em vez de somar/multiplicar. SEMPRE `Number(...)` antes de
   qualquer aritmética com valor DECIMAL vindo do banco. Isso já causou o bug do
   "XP = NaN" — e `node --check` NÃO pega (é erro de runtime/tipo, não de sintaxe).
   IMPORTANTE: `INT` e `FLOAT` chegam como number nativo (sem esse problema) — o
   cuidado é específico de DECIMAL.

2. **Só o teste manual no navegador valida.** `node --check` e scripts de servidor
   passam mesmo com bugs de runtime, de tipo, de client, de morte/respawn/restart.
   NADA é considerado "fechado" até rodar no navegador de verdade e ver funcionar.
   Vários bugs (o NaN do XP, comportamento de morte/respawn) só apareceram no teste
   de campo manual.

3. **Cache do navegador morde ao trocar arquivos de client.** Ao mudar
   ExploracaoCombate.js (ou qualquer client), fazer HARD-refresh (Ctrl+Shift+R),
   senão o navegador serve a versão velha do cache e parece que a mudança não pegou.

4. **Troca de máquina (casa ↔ curso): git traz CÓDIGO, não traz BANCO nem .env.**
   Ao trocar de máquina, `git pull` traz o código novo, mas: (a) a estrutura/dados
   do banco NÃO vêm — cada máquina precisa rodar o `db/setup_banco.sql` atualizado
   (destrutivo, recria o schema+dados); (b) o `.env` é gitignored — cada máquina tem
   o seu; (c) cada máquina precisa do GRANT (`GRANT ALL PRIVILEGES ON jogo_pi.* TO
   'rpg_app'@'localhost'; FLUSH PRIVILEGES;`). Sintomas de esquecer: "Unknown column
   X" (código novo + banco velho), "tabela vazia" (setup não rodado / rodado velho),
   "Access denied" (falta GRANT). No Workbench, sempre `USE jogo_pi;` explícito pra
   não rodar query no banco errado.

5. **DUAS FRENTES ao mudar schema.** Toda mudança de schema (nova coluna, nova
   linha de dado de teste) é feita em DOIS lugares que precisam BATER: (a) o ALTER/
   INSERT na máquina atual (efeito imediato) E (b) o `db/setup_banco.sql` atualizado
   (pra máquina nova nascer certa). Se só um for feito, as máquinas divergem e a
   próxima troca trava. Confirmar que os dois resultam na mesma estrutura.

6. **Os três "ids" do loot são distintos — não confundir.** `enemy.id` = id da
   INSTÂNCIA do inimigo no gameState ("enemy_1"). `mob_id` = id do TIPO na tabela
   mobs (todos os "Comum" têm o mesmo). `inventario.id` = id da linha no inventário.
   `drop_N` = id da instância do item no chão. A mob_drops liga por `mob_id`; o
   combate referencia por `enemy.id`. Trocar um pelo outro faz o drop consultar o id
   errado e não achar nada.

7. **Commitar + push ao FECHAR cada passo validado.** "Fechado" (testado) ≠
   "commitado" (salvo no git). Deixar trabalho não commitado assusta (parece
   perdido) e trava a troca de máquina. Ao validar um passo, commit + push na hora.

8. **(Se aplicável / verificar no código) Memory leak de timers na troca de cena.**
   Timers/setInterval criados numa cena Phaser precisam ser limpos ao sair da cena,
   senão vazam. [Confirmar no código se isto está documentado/tratado — apareceu como
   armadilha na auditoria mas não tenho o detalhe exato registrado; verificar.]

---

## B. ARMADILHAS DE DESIGN (as que quebram o balanceamento — não são bugs de código)

Estas NÃO estão no roadmap como armadilhas — foram decisões de design tomadas em
discussão. São o tipo de coisa que um agente, otimizando localmente, reintroduziria
sem perceber que quebra o jogo.

1. **FARM INFINITO DE PODER — equipamento NÃO empilha bônus.** Se coletar cópias do
   mesmo equipamento somasse o bônus (2 espadas = +20 dano, 5 = +50), o jogador
   farmaria inimigos fracos e ficaria forte sem teto, destruindo a progressão. REGRA:
   o bônus é sempre de UMA peça equipada; "quantidade" no inventário é só contagem
   (útil pra consumível futuro), nunca soma de bônus. O poder vem de itens de TIERS
   diferentes (espada comum +10 → afiada +15 → épica +30 — trocar a fraca pela
   forte), não de acumular cópias. Inimigo forte dropa item de tier MAIOR, não mais
   cópias.

2. **XP INFINITO / pico de abate — XP é por DANO, não por matar.** O modelo antigo
   dava +50 por kill, mas subir de nível custava ~25 → 1 morte = 2 níveis, disparava
   a progressão. REGRA: XP = dano efetivo × 0.1 × multiplicador-do-tipo, dado NA HORA
   de cada golpe. Isso é proporcional por construção (cada jogador ganha pelo próprio
   dano — resolve kill-stealing e desconexão de graça, sem "memória de dano" pros
   comuns). O "pico de abate na morte" era o que criava a distorção — foi removido
   dos comuns. Só o BOSS terá pico de abate (dividido proporcionalmente por dano, com
   memória de dano por jogador) — e o boss ainda não existe.

3. **"Dano efetivo" conta, não o dano bruto.** O golpe que mata não dá XP além da
   vida que o inimigo ainda tinha (não estoura). Evita XP fantasma no golpe final.

4. **Princípio geral: regra fixa no CÓDIGO, conteúdo que multiplica no BANCO.** Onde
   um dado mora se decide por: é uma regra única que não cresce em variedade (ex.: a
   fórmula de XP, o cálculo de atributos) → CÓDIGO. É conteúdo que multiplica e varia
   por instância (ex.: tipos de inimigo, bônus de item, drops, tabela de níveis) →
   BANCO, carregado em memória no boot. A lógica (como somar, como sortear) fica no
   código; os NÚMEROS ficam no banco, pra a equipe calibrar sem tocar em código.
   Corolário: o banco é armazenamento, NÃO regra absoluta — as tabelas são cardápio,
   não contrato; usa-se o que serve, do jeito que serve (ex.: `table_nivel` existe,
   mas o cálculo fica no código, só grava resultado).

5. **Progressão NATURAL, não desbloqueio programado.** A dificuldade crescente
   emerge da força do jogador vs a do inimigo (todos os tipos aparecem no mapa desde
   o início; quem ataca um forte sem nível, morre — e essa é a lição). NÃO há sistema
   de "matou X, libera o tipo Y". Foi uma decisão consciente de não programar o que já
   emerge sozinho.

6. **Atributos são SEMPRE recalculados, nunca persistidos.** hp_max, dano, defesa =
   base da classe + buff por nível + bônus dos itens equipados, recalculado a cada
   vez. NUNCA gravar hp_max no banco (causava o bug do mago com hp_max desatualizado).
   Grava-se o resultado do estado (hp_atual, nível, XP), não os atributos derivados.

---

## C. MÉTODO DE TRABALHO (como o desenvolvimento é conduzido)

1. **Passo-teste-passo.** Fatiar cada feature em sub-passos pequenos e INDEPENDENTES,
   cada um testável sozinho. Nunca empilhar o próximo sobre o anterior sem validar o
   anterior no navegador. Se algo quebra, sabe-se em qual sub-passo.

2. **Investigar ANTES de mexer.** Antes de implementar, levantar o estado atual do
   código/banco (MODO DEBUG: só reportar, não alterar). O retrato do que existe
   define o tamanho real do passo e evita presunção.

3. **MODO ARQUITETO para passos com risco.** Em sub-passos que tocam lógica nova ou o
   banco, apresentar o PLANO antes de escrever código, esperar aprovação, depois
   implementar. Cobrir: o que muda, onde encaixa, os cuidados (tipos, ids, as duas
   frentes).

4. **Separar mecanismo (código) de valores (design/dado).** Ex.: o boss é construído
   como inimigo CONFIGURÁVEL — o mecanismo (como funciona) é código; os valores
   (onde/quando aparece, força) são dado que a equipe que joga calibra. Andrei
   (líder técnico) constrói o mecanismo; a equipe define a sensação.

5. **Debug visual é provisório.** Cores sólidas por tipo (inimigos, itens no chão)
   são ferramenta de teste/identificação, NÃO arte — serão substituídas pelos sprites
   do Godot. Não investir em "bonito" no que vai ser trocado (evita retrabalho). O
   mesmo vale pra UI do inventário (feia de propósito, aguardando os ícones).

6. **Documentar aponta pra fonte única.** A fonte da verdade do schema é
   `db/setup_banco.sql` — os docs apontam pra ele, não copiam SQL (que desatualiza).

---

## D. CONTEXTO DE EQUIPE E PAPÉIS (pra um agente entender o "quem faz o quê")

- Grupo de 6. Andrei é o LÍDER TÉCNICO — conduz pela arquitetura (separa lógica de
  dado, questiona premissa, decide onde as coisas moram), NÃO escreve o código do
  zero (dirige o agente) e valida tudo no teste manual.
- Sprites, cenários e mapas (Godot) = trabalho da EQUIPE de design/arte. Eles
  produzem E preparam pra integração; Andrei define o contrato (formato/nomes),
  não faz a integração. (A equipe já entregou os primeiros mapas/assets.)
- Encher o catálogo de ITENS (tiers de equipamento, consumíveis) = conteúdo a
  delegar pra equipe; Andrei liga os drops na mob_drops.
- Telas de menu (inventário/seleção) ficam em Phaser por ora (ninguém no grupo manja
  de HTML/CSS). Decisão futura: Phaser vs HTML/CSS pras telas.

---

## E. O QUE ESTÁ FEITO / ONDE ESTAMOS (resumo de status — o roadmap tem o detalhe)

- Fases 0, 1, 2, A (migração pro banco oficial `jogo_pi`) — FECHADAS e validadas.
- Modelo de XP por dano (DECIMAL) — FECHADO.
- Bloco Loot & Inimigos: P1 (inimigos vêm da tabela mobs, 5 tipos incl. Elite),
  P2 (Elite raro via peso_spawn ponderado), P4 (drop na morte via mob_drops),
  P5 (coleta no mapa + INSERT/incremento no inventário) — todos FECHADOS e validados.
- FALTA no bloco: P3 = boss principal + DUNGEONS (o maior — depende de um sistema de
  múltiplos mapas/dungeons por nível; a equipe entregou mapas que podem ser
  matéria-prima). É o próximo alvo grande.
- Pendências menores: bug COSMÉTICO da UI do inventário (não mostra quantidade x2/x3
  — o banco grava certo, é só a UI, deixar pra quando o inventário for refeito com os
  ícones); constantes órfãs já limpas; feedback de coleta (polish, opcional).

---

## F. FEATURES FUTURAS REGISTRADAS (não implementar sem decisão)

- Sistema de TIERS de itens + catálogo variado (conteúdo pra equipe).
- Skills (5 tabelas prontas — "outras formas de evoluir" até o nível 15, onde há a
  parede de XP proposital 15→16: 425→1450).
- Login/contas (tabela jogadores pronta — destrava posse de personagem, seleção
  filtrada; junto vem o hp_max não-persistido).
- Múltiplos mapas / dungeons (pré-requisito do boss principal / P3).
- Combate intencional (botão de atacar vs esbarrão atual que fere ambos).
- Loop de prestígio / "colapso" (new game+ quando o personagem fica muito forte).
- Narrativa por classe (ideia da equipe).
