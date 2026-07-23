# fase2_spec.md — Especificação de Execução da Fase 2 (Persistência, Identidade e Progressão)

> **Natureza deste documento:** Esta é uma **especificação de execução fechada**, destinada a ser consumida por um agente de IA implementador (Claude Code, Cursor, etc.). Ela é subordinada ao `AGENTS.md` (constituição técnica) e complementa o `roadmap_game.md`. Ao ser concluída e validada, seu conteúdo deve ser incorporado ao roadmap oficial do projeto.
>
> **Este documento descreve a Fase 2 (Persistência MySQL, Identidade de Personagem e Progressão).** Ele é dividido em 5 pacotes sequenciais. Cada pacote possui escopo travado, contrato de dados e critério de teste obrigatório.

---

## 0. REGRAS DE CONTENÇÃO DO AGENTE (LEIA ANTES DE QUALQUER LINHA DE CÓDIGO)

Estas regras existem para impedir que o agente implementador extrapole o escopo, invente funcionalidades ou "melhore" o que não foi pedido. Violá-las é uma falha de execução, independentemente da qualidade do código gerado.

1. **Implemente APENAS o que está descrito no pacote em execução.** Não adicione features, campos, endpoints, tabelas, tipos de mensagem ou abstrações que não estejam explicitamente especificados. Se algo parecer "faltando" ou "que ficaria melhor", NÃO adicione — registre como observação ao final e siga.
2. **Não antecipe pacotes futuros.** Não implemente inventário no Pacote 1. Não implemente login em nenhum pacote (está formalmente adiado). Cada pacote é uma entrega isolada.
3. **Não invente valores.** Onde a spec disser "valor arbitrário de teste", use o valor exato fornecido. Não substitua por números "mais realistas" nem gere novos.
4. **Não invente contratos de rede.** Os tipos de mensagem WebSocket permitidos em cada pacote estão listados explicitamente. Não crie novos tipos, não renomeie os existentes, não altere os payloads sem instrução.
5. **Não crie código para casos não especificados.** Se a spec não descreve o comportamento de um caso de borda, o comportamento correto é o mais conservador (rejeitar/ignorar), NÃO inventar uma regra de jogo nova.
6. **Exceção de auto-correção durante teste:** Se, ao rodar o critério de teste de um pacote, o agente detectar uma falha real (erro de runtime, comportamento divergente do contrato, quebra de uma regra do `AGENTS.md`), ele DEVE corrigir a falha detectada. Esta é a única situação em que o agente age além da letra da spec — e mesmo assim, apenas para fazer o comportamento convergir ao contrato documentado, nunca para adicionar escopo.
7. **Respeite a constituição.** Todo código deve obedecer ao `AGENTS.md`: desacoplamento Phaser/regra de negócio, zero alocação de objeto no `update()`, limpeza de listeners em transição de cena, nenhuma query MySQL dentro de cenas Phaser (persistência é exclusiva do servidor Node).
8. **Nenhum pacote é considerado concluído sem passar no seu critério de teste.** O agente não deve marcar um pacote como pronto nem avançar para o próximo enquanto o teste do atual não passar.

---

## 1. CONTEXTO ARQUITETURAL CONSOLIDADO (decisões já tomadas — não rediscutir)

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

---

## PACOTE 1 — Identidade de Personagem e Trilho de Leitura do Banco

**Objetivo do pacote:** Fazer o servidor parar de identificar jogadores por conexão (`player_1`, `player_2`...) e passar a identificá-los por **personagem carregado do MySQL**. Ao fim deste pacote, um jogador entra informando qual personagem controla, e o servidor carrega os dados reais desse personagem do banco. **Este pacote apenas LÊ do banco; não grava nada de volta** (a escrita é o Pacote 2).

### 1.1 Por que este pacote vem primeiro

No código atual, a identidade do jogador está colada à conexão: cada socket novo vira um `player_N` incremental, criado hardcoded na posição `1000,1000` com HP fixo. Isso funcionava enquanto tudo era efêmero. No momento em que introduzimos persistência, isso quebra: se a identidade morre junto com o socket (ao morrer, cair a conexão, ou fechar o jogo), o servidor não sabe *qual linha do banco* representa aquele jogador — e passaria a salvar/buscar dados na linha errada ou a criar linhas duplicadas. Portanto, **separar conexão de identidade é pré-requisito de qualquer persistência.** Nada pode ser salvo antes de o servidor saber, de forma estável, quem é o jogador.

### 1.2 Escopo travado (o que ESTE pacote faz)

1. Subir o schema mínimo no MySQL (apenas `jogadores` e `personagens` — sem `inventario`, sem tabelas adiadas).
2. Popular o banco manualmente com personagens de teste (um por classe, ou o subconjunto necessário para testar).
3. Plugar o pool de conexão `mysql2` no servidor Node.
4. Definir o objeto de molde das classes (semente hardcoded) no servidor.
5. Definir a fórmula de buff por nível (necessária já aqui, porque o carregamento depende dela — consequência da decisão "recalcular").
6. Substituir o handshake atual pelo fluxo `join`: o client conecta anônimo e envia uma mensagem `join` com o `personagem_id`; o servidor busca a linha, aplica o molde + buff, e insere o jogador no `gameState` com atributos reais.
7. Implementar a trava de sessão em memória (mesmo `personagem_id` não pode estar ativo em duas conexões simultâneas).

### 1.3 Fora de escopo (o que ESTE pacote NÃO faz)

- Não grava nada no banco (sem UPDATE, sem INSERT em runtime).
- Não implementa inventário.
- Não implementa criação de personagem via UI nem seleção de classe pelo jogador (os personagens de teste são inseridos manualmente no banco).
- Não implementa login/senha.
- Não altera a lógica de inimigos nem de itens do mapa.

### 1.4 Schema MySQL a aplicar

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

### 1.5 Dados de teste a inserir manualmente

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

### 1.6 Molde de classe (semente hardcoded no servidor)

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

### 1.7 Fórmula de buff por nível

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

### 1.8 Contrato de rede deste pacote

Tipos de mensagem permitidos (client→servidor) NOVOS neste pacote:

- **`join`** — `{ type: 'join', personagem_id: <int> }` — enviado pelo client logo após a conexão abrir, para reivindicar o controle de um personagem existente.

Comportamento do servidor ao receber `join`:

1. Se o `personagem_id` já estiver na trava de sessão ativa → recusar (enviar mensagem de erro ou fechar a conexão de forma controlada). NÃO carregar.
2. Buscar a linha do personagem no MySQL. Se não existir → recusar. NÃO criar personagem novo (criação é fora de escopo).
3. Se existir e estiver livre → carregar: aplicar molde da classe + buff do nível para montar os atributos efetivos; inserir o jogador no `gameState.players` chaveado pelo `personagem_id`; registrar na trava de sessão; enviar o `welcome` (estado do mundo) e fazer broadcast de entrada, como o fluxo atual já faz — porém agora com dados reais e identidade estável.

Os tipos de mensagem existentes (`player_move`, `pickup_item`, `attack_enemy`, e os broadcasts do servidor) permanecem funcionando. **Não renomear, não alterar payloads existentes neste pacote.** (A reconciliação das divergências de nomenclatura entre código e roadmap é tarefa de documentação do Pacote 5.)

### 1.9 Trava de sessão

Manter em memória no servidor (não no banco) um registro dos `personagem_id` atualmente ativos. Ao conectar via `join`, recusar duplicata. Ao desconectar (`close`), remover da trava. Esta trava é efêmera por natureza e não deve ser persistida.

### 1.10 Ajuste na chave de identidade do gameState

Hoje `gameState.players` é chaveado por `player_N` (conexão). Passar a chavear por `personagem_id`. Toda referência que hoje usa o id de conexão deve passar a usar a identidade de personagem. O socket continua existindo como transporte, mas deixa de ser a chave de identidade.

### 1.11 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 1)

O pacote só é considerado concluído se TODOS os itens abaixo passarem:

1. **Carregamento real:** conectar um client informando `join` com um `personagem_id` válido (ex.: o mago de teste). Confirmar que o jogador entra no mundo com os atributos daquele personagem carregados do banco (HP e classe corretos), e NÃO com os valores hardcoded antigos (`1000,1000`, HP 100 fixo).
2. **Nível 1 = semente pura:** confirmar que um personagem nível 1 carrega com atributos idênticos ao molde da classe (buff zero). Ex.: mago nível 1 → `hp_max = 60`, `dano_base = 40`, `defesa_base = 3`.
3. **Buff aplicado:** alterar manualmente no banco o `nivel` de um personagem de teste para 3, reconectar, e confirmar que os atributos efetivos refletem `base + 2 * buff` (ex.: mago nível 3 → `hp_max = 60 + 20 = 80`, `dano_base = 40 + 10 = 50`, `defesa_base = 3 + 4 = 7`).
4. **Trava de sessão:** tentar conectar dois clients com o mesmo `personagem_id`. Confirmar que o segundo é recusado.
5. **Personagem inexistente:** tentar `join` com um `personagem_id` que não existe no banco. Confirmar que a conexão é recusada e nenhum personagem é criado.
6. **Sem escrita:** confirmar que, durante todo o teste, nada foi gravado no banco (os dados das linhas de teste permanecem como inseridos). A escrita é do Pacote 2.

---

## PACOTE 2 — Persistência de Volta e Sistema de Progressão (XP/Nível)

**Objetivo do pacote:** Fechar o loop. O servidor passa a **gravar** no banco, e o sistema de XP/nível entra em operação. Ao fim deste pacote, um jogador entra, joga, ganha XP, sobe de nível, sai e volta — encontrando seu personagem exatamente no estado em que parou. Este é o pacote que prova o valor da Fase 2.

### 2.1 Por que agora

O Pacote 1 estabeleceu identidade estável e leitura do banco. Sem identidade estável, gravar era impossível (não se sabia em qual linha). Com ela pronta, a escrita se torna segura. E como escolhemos o modelo de recálculo, a progressão (XP/nível) precisa entrar já aqui — o carregamento do Pacote 1 já depende da fórmula de buff, então operacionalizar o ganho de nível é a consequência natural e imediata.

### 2.2 Escopo travado

1. **Snapshot periódico:** a cada ~10 segundos, gravar posição (`posicao_x`, `posicao_y`) e `hp_atual` de cada jogador ativo no banco.
2. **Save no disconnect:** ao receber `close` de um socket, gravar o estado final (posição, `hp_atual`, `nivel`, `experiencia`) do personagem correspondente ANTES de removê-lo do `gameState` e da trava de sessão. (Resolve o Risco I do roadmap: inconsistência em queda de conexão.)
3. **Ganho de XP:** ao matar um inimigo, o jogador que desferiu o golpe fatal ganha XP (valor arbitrário de teste a definir, ex.: 50 XP por inimigo). O servidor incrementa `experiencia`.
4. **Checagem e subida de nível:** após ganhar XP, o servidor verifica se `experiencia` atingiu o limiar do próximo nível (`nivel * 100`). Se sim, incrementa `nivel`, subtrai/ajusta o XP conforme o modelo escolhido, e **grava o novo `nivel` e `experiencia` no banco imediatamente** (evento crítico). Como usamos recálculo, NÃO se grava novo `hp_max`/`dano_base`; eles se derivam sozinhos no próximo carregamento. Porém, os atributos efetivos EM MEMÓRIA (`gameState`) devem ser recalculados na hora da subida de nível, para que o buff valha na sessão corrente sem exigir reconexão.
5. **Notificação de subida de nível:** emitir um broadcast (novo tipo de mensagem) informando que o personagem subiu de nível e seus novos atributos efetivos, para o client atualizar a renderização.

### 2.3 Fora de escopo

- Não implementa inventário.
- Não persiste itens do mapa.
- Não implementa fórmulas de XP/buff complexas (curvas, diminishing returns) — mantém `nivel * 100` e buff linear.
- Não implementa reconciliação entre XP excedente e múltiplas subidas de nível num único ganho, a menos que o valor de XP por kill possa ultrapassar dois limiares de uma vez; se puder, tratar de forma simples (loop de subida enquanto o limiar for atingido), sem inventar mecânica adicional.

### 2.4 Contrato de rede deste pacote

Tipos NOVOS (servidor→client):

- **`level_up`** — `{ type: 'level_up', personagem_id: <int>, nivel: <int>, hp_max: <int>, dano_base: <int>, defesa_base: <int>, hp_atual: <int> }` — emitido quando um personagem sobe de nível, com os atributos efetivos recalculados.

Os tipos existentes de combate/morte permanecem. O `enemy_died` já existente continua sendo o gatilho a partir do qual o XP é concedido ao `killerId`.

### 2.5 Regras de gravação (contenção)

- Snapshot e save no disconnect gravam via UPDATE na linha do personagem. Nunca via INSERT (o personagem já existe).
- Toda query MySQL vive no servidor Node. Nenhuma query em cena Phaser (regra do `AGENTS.md`).
- Gravações são assíncronas e não devem bloquear o tick loop de 20Hz. Erros de gravação devem ser logados, não devem derrubar o servidor.

### 2.6 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 2)

1. **Persistência de posição:** entrar, mover o personagem para uma posição distinta da inicial, aguardar o snapshot (~10s), desconectar. Reconectar e confirmar que o personagem reaparece na posição salva, não na inicial.
2. **Persistência de HP:** sofrer dano, aguardar snapshot ou desconectar, reconectar e confirmar que o `hp_atual` reflete o dano sofrido.
3. **Ganho de XP:** matar um inimigo e confirmar (via `SELECT` no banco ou log) que `experiencia` do matador aumentou.
4. **Subida de nível:** acumular XP suficiente para cruzar o limiar (`nivel * 100`). Confirmar que: (a) `nivel` incrementa no banco; (b) o broadcast `level_up` é emitido; (c) os atributos efetivos em memória aumentam conforme o buff na mesma sessão; (d) ao reconectar, o personagem carrega já no nível novo com os atributos derivados corretos.
5. **Save no disconnect:** matar inimigo (ganhar XP), desconectar imediatamente (sem esperar snapshot), reconectar e confirmar que o XP ganho foi preservado.
6. **Não-bloqueio:** confirmar que as gravações não introduzem travamento perceptível no tick de 20Hz nem no movimento dos jogadores.

---

## PACOTE 3 — Correção de Bugs de Constituição (Higiene de Rede e Loop)

**Objetivo do pacote:** Corrigir duas violações do `AGENTS.md` já presentes no código atual, independentes de persistência, aproveitando que os arquivos de rede já estarão abertos. São correções pequenas e cirúrgicas.

### 3.1 Por que agora

Estas são violações preexistentes da constituição, não introduzidas pela Fase 2. São corrigidas aqui por conveniência (os arquivos envolvidos já estão sendo tocados) e por baixo risco. Não dependem dos pacotes anteriores, mas são melhor validadas depois que o fluxo de rede está estável.

### 3.2 Escopo travado

1. **Throttle de envio de movimento 60Hz → 20Hz.** Hoje o `update()` de `ExploracaoCombate` envia `player_move` a cada frame (~60Hz). O roadmap e o Risco II definem o limite em 20Hz (50ms). Alterar para que o envio de movimento ocorra no máximo a cada 50ms. Implementar via acumulador de tempo (delta) ou timer dedicado, NÃO criando objetos novos por frame.
2. **Eliminar alocação de objeto no `update()`.** Hoje o envio faz `JSON.stringify({...})` a cada frame, criando um objeto literal e uma string novos — violação da Regra Absoluta nº 3 do `AGENTS.md`. Reestruturar para reutilizar um objeto de payload declarado no escopo da cena (mutar seus campos em vez de recriá-lo), serializando apenas no momento do envio já throttled.

### 3.3 Fora de escopo

- Não refatorar o `onmessage` (isso é Pacote 5).
- Não alterar a lógica de interpolação, combate ou renderização de HP.
- Não alterar o tick rate do servidor (já está correto em 20Hz).

### 3.4 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 3)

1. **Frequência de envio:** instrumentar (log ou contador temporário) a taxa de emissão de `player_move` e confirmar que não excede ~20 mensagens por segundo por client, mesmo com o jogo rodando a 60 FPS.
2. **Suavidade preservada:** confirmar que, com o throttle ativo e a interpolação (lerp) no receptor, o movimento dos jogadores remotos permanece visualmente suave (sem travões perceptíveis).
3. **Zero alocação no loop:** revisar o `update()` e confirmar que nenhum objeto literal (`{}`), array (`[]`) ou lambda é criado dentro dele no caminho de envio. O objeto de payload deve ser reutilizado.

---

## PACOTE 4 — Sistema de Inventário

**Objetivo do pacote:** Implementar inventário com autoridade no servidor e renderização desacoplada no client. Só agora, com identidade e persistência sólidas.

### 4.1 Por que por último (antes da documentação)

Inventário depende de identidade estável (Pacote 1) e de persistência funcionando (Pacote 2). Construí-lo antes seria erguer uma feature complexa sobre fundação instável. Com os pacotes anteriores validados, o inventário se apoia em trilhos confiáveis.

### 4.2 Escopo travado

1. Criar a tabela `inventario` no MySQL.
2. Implementar `InventoryManager` como camada de domínio **no servidor** (não no client): valida requisitos, adiciona/remove itens, equipa/desequipa, recalcula atributos efetivos ao equipar, persiste no MySQL.
3. Criar `UIScene` paralela no Phaser: uma cena de interface que renderiza o inventário em grid de slots. Esta cena **apenas desenha** o que o servidor informa; não calcula atributos nem decide validade de equipar.
4. Coletar um item de mapa deixa de conceder apenas `score` e passa a inserir um item real no inventário do personagem (via servidor).
5. Equipar/desequipar item recalcula os atributos efetivos NO SERVIDOR e emite um evento de atualização de stats para o client redesenhar.

### 4.3 Schema a adicionar

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

### 4.4 Contrato de rede deste pacote

Tipos NOVOS (client→servidor): `equip_item` `{ inventario_id }`, `unequip_item` `{ inventario_id }`. (Nomes exatos a confirmar no início do pacote; não inventar variações fora destes.)

Tipos NOVOS (servidor→client): `inventory_update` (estado do inventário do jogador), `stats_updated` (atributos efetivos após equipar/desequipar).

### 4.5 Fora de escopo

- Drag & drop sofisticado de UI pode ser simplificado para clique-equipar na primeira versão; não inventar sistema de arrastar complexo sem instrução.
- Não implementar crafting, troca entre jogadores, ou tipos de item além dos necessários para testar (consumível e equipamento).
- Interação com atributos deve reusar a fórmula de recálculo já existente; não criar um segundo sistema de atributos.

### 4.6 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 4)

1. **Coleta persiste:** coletar um item, desconectar, reconectar e confirmar (via `SELECT * FROM inventario WHERE personagem_id = X`) que o item permanece no inventário.
2. **Equipar altera atributos:** equipar um item de equipamento e confirmar que os atributos efetivos do personagem aumentam conforme o item, com o cálculo feito pelo servidor.
3. **Autoridade do servidor:** confirmar que o client não calcula atributos localmente — o número exibido vem exclusivamente do `stats_updated` do servidor.
4. **Desacoplamento:** confirmar que a `UIScene` apenas renderiza e que nenhuma regra de inventário reside em Sprites/Containers Phaser (regra do `AGENTS.md`).
5. **Persistência de equipado:** equipar item, desconectar, reconectar e confirmar que o item continua marcado como equipado e o atributo reflete isso.

---

## PACOTE 5 — Higiene de Código e Reconciliação da Documentação

**Objetivo do pacote:** Pagar a dívida técnica de estrutura acumulada e alinhar a documentação oficial com o que foi efetivamente construído.

### 5.1 Escopo travado

1. **Refatorar o `onmessage` monolítico** de `ExploracaoCombate` (cadeia extensa de `if/else` por `data.type`) para um despacho por mapa de handlers ou um módulo `NetworkManager` dedicado, respeitando o desacoplamento do `AGENTS.md`. A esta altura o número de tipos de mensagem terá crescido bastante e a cadeia condicional é insustentável.
2. **Reconciliar a documentação (Regra 6 do `AGENTS.md`):**
   - Alinhar as divergências de nomenclatura de protocolo entre `roadmap_game.md` e o código real (ex.: `player_attack`/`attack_enemy`, `pickup_item_request`/`pickup_item`, `player_join`/`join`). Definir os nomes canônicos e atualizar ambos os documentos.
   - Registrar formalmente no `AGENTS.md`/roadmap todas as decisões travadas nesta spec: WebSocket-only, recálculo de atributos, molde de classe hardcoded, persistência escalonada, e a lista de itens adiados (login, tabela `classes`, `itens_instanciados_mapa`, Redis, anti-cheat de posição).
3. **Incorporar esta spec ao roadmap oficial** como registro da Fase 2 concluída.

### 5.2 Fora de escopo

- Não reescrever sistemas que já passaram em seus testes só por estética.
- Não introduzir novas dependências ou frameworks.

### 5.3 CRITÉRIO DE TESTE OBRIGATÓRIO (Pacote 5)

1. **Paridade funcional pós-refatoração:** após refatorar o `onmessage`, rodar novamente os testes dos Pacotes 1, 2 e 4 e confirmar que todos continuam passando. A refatoração não pode alterar comportamento.
2. **Documentação consistente:** confirmar que roadmap e `AGENTS.md` não contêm mais contradições de nomenclatura de protocolo com o código, e que as decisões e adiamentos estão registrados.

---

## APÊNDICE A — Resumo dos Valores Arbitrários de Teste

Todos os valores abaixo foram definidos por decisão do projeto **apenas para destravar o desenvolvimento**. São provisórios, não balanceados, e não devem ser alterados pelo agente por conta própria.

| Item | Valor de teste | Onde |
|---|---|---|
| Classes oficiais | guerreiro, mago, arqueiro, suporte, tanque | Molde + banco |
| Buff HP por nível | +10 | `BUFF_HP` |
| Buff dano por nível | +5 | `BUFF_DANO` |
| Buff defesa por nível | +2 | `BUFF_DEFESA` |
| XP para próximo nível | `nivel * 100` | Fórmula de progressão |
| XP por inimigo morto | 50 (a confirmar no Pacote 2) | Ganho de XP |
| Intervalo de snapshot | ~10 segundos | Persistência periódica |

## APÊNDICE B — Ordem de Execução e Regra de Avanço

Executar os pacotes na ordem 1 → 2 → 3 → 4 → 5. **Um pacote só é dado como concluído após passar em todos os itens do seu critério de teste obrigatório.** O agente não deve avançar para o próximo pacote enquanto o atual não estiver validado. Ao concluir cada pacote, registrar brevemente o que foi feito e o resultado dos testes, para incorporação futura ao documento oficial do projeto.
