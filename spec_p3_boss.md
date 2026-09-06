# P3 — Boss Principal via "Porta no Mesmo Mapa" (Spec Completa)

**Objetivo:** Construir o primeiro Boss do jogo, acessível via portal de nível mínimo. O design prioriza entrega de valor visual para o TCC (novembro), evitando refatorações invisíveis e custosas (como dividir o estado do servidor em salas).

**Regra de execução:** Implementar em sub-passos lógicos. Antes de tocar no código de cada sub-passo, use o MODO ARQUITETO.

---

## 1. Arquitetura Geral
* **Porta no mesmo mapa:** O boss **NÃO** usa dungeon instanciada. A "Arena" fica em uma região muito distante do mapa normal (ex: coordenadas 4000x4000). A área física do jogo será expandida (ex: 5000x5000) para caber a arena.
* **Isolamento por distância:** Não haverá paredes físicas prendendo o boss, apenas o abismo da distância. A câmera é travada no jogador, então quem está no mapa normal nunca verá a arena. Não há invisibilidade por servidor.
* **Arena Compartilhada (Opção 1):** Existe UMA arena e UM boss. Jogadores que entrarem no portal (juntos ou depois) caem na MESMA luta e colaboram contra o MESMO boss, no HP em que ele estiver. Não há arenas separadas por grupo.

## 2. O Portal
* **Canalização:** O jogador precisa ficar **SOBRE** o portal por 3-5 segundos ininterruptos para ativar a entrada em grupo.
* **Checagem de Nível em Grupo:** O portal verifica todos os jogadores na área de canalização. Se **QUALQUER** jogador ali tiver nível abaixo do exigido, **NINGUÉM** é teleportado. O grupo entra junto, ou não entra.
* **Teleporte Autorizado (`force_teleport`):** O client hoje é autoritário sobre sua própria posição e a reescreveria. O servidor deverá emitir um evento `force_teleport` para forçar o client a reposicionar o jogador instantaneamente (salto limpo, sem *lerp*).
* **Portal de Saída:** Haverá um portal idêntico na arena para permitir desistência/fuga de volta à base.

## 3. O Boss e A Luta
* **Nova Coluna `is_boss`:** Adicionar flag `is_boss` na tabela `mobs` para distinguir quem é chefe (migração de banco).
* **Pico de XP (Exceção à regra):** Apenas o boss concede um pico de abate na morte. (Inimigos comuns continuam com a regra intacta de XP-por-dano sem pico). Encaixa no bloco `if(hp<=0)` condicionado a `is_boss`.
* **Memória de Dano:** O boss precisa ter um registro (`damageHistory` por `player_id`) guardando exatamente quanto dano cada jogador causou a ele para basear o abate proporcional.
* **Congelamento de Poder na Arena:** Durante a luta contra o boss, o XP, nível e atributos imediatos **CONGELAM** (luta-se com a força que entrou). O XP causado ao boss NÃO o fortalece durante a luta. Razão: o boss é o exame, não a aula; ele não pode ser a própria escada de nível do jogador.
* **Cofre Temporário (`xp_boss`):** O XP gerado pelo dano no boss não vai para o XP real do jogador. Ele vai para um campo separado temporário que só existe durante a luta na arena.

## 4. Resolução e Retorno
* **Matou o Boss (Vitória):**
  * O `xp_boss` temporário é dividido **PROPORCIONALMENTE** pelo `damageHistory` de cada jogador (cada um leva a fatia relativa ao dano que causou).
  * Esse XP é injetado de uma vez no XP real do jogador (podendo causar subida de nível).
  * Todos os jogadores na arena são teleportados de volta à base.
* **Morreu ou Desistiu (Derrota):**
  * O `xp_boss` acumulado pelo jogador é **DESCARTADO**. Não se premia quem não matou.
  * O jogador é teleportado de volta à base.
* **Reset de Boss:** O HP do boss **SEMPRE** volta a 100% se alguém sair, morrer ou desistir (nunca fica pela metade). Força a luta a ser de uma vez, impedindo que o boss seja farmado "em pedaços".

---

## 5. Visão Futura (Escopo de Design, não implementar agora)
Este design foi construído para ser escalável. No futuro, poderão existir vários portais espalhados pelo mapa, cada um com uma trava de nível diferente (nv10, nv15, nv20), levando para arenas com bosses progressivamente mais fortes. O **P3** foca em construir e polir o **primeiro** portal e boss completo. A replicação será conteúdo adicionado posteriormente.
