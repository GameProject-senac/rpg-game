# Última auditoria do projeto

**Data:** 06/09/2026  
**Projeto:** Project Post-Apoc RPG / Horizon Co-op  
**Natureza:** auditoria estática e propostas de correção; nenhuma proposta foi implementada.  
**Escopo autorizado nesta etapa:** criar somente este relatório e aguardar o próximo comando.

## 1. Objetivo, limites e evidências

Este documento registra os achados da auditoria do código, configuração, schema versionado, documentação e projetos Godot. Para cada problema, distingue o estado encontrado, o comportamento esperado e a solução proposta.

O projeto tem uma base de protótipo aproveitável. As prioridades são a integridade de sessões e inventário, a ordenação da persistência e a sincronização do cliente. Acrescentar o boss antes de estabilizar esses caminhos amplia os riscos de inconsistência.

### O que foi examinado

- Cenas Phaser, inicialização e configuração de rede na raiz.
- `server/server.js` e scripts `server/test_*.js`.
- `db/setup_banco.sql`, scripts SQL históricos e configuração de exemplo.
- `AGENTS.md`, `roadmap_game.md`, specs P5/P3, `commands.md` e insumo de reorganização documental.
- Scripts, configurações e estrutura de cenas dos projetos em `map/`.
- Manifesto de dependências, lockfile e estado local do Git.
- Trecho do Phaser instalado relativo à limpeza do Loader no shutdown.

### Limites da auditoria

- Não houve consulta ao banco ativo: a correspondência entre banco local e setup **não foi confirmada**.
- Não foram iniciados servidor, partidas ou scripts que alteram personagens e inventário.
- Não houve teste manual no navegador, benchmark, captura de memória ou teste de carga.
- Os projetos Godot não foram abertos no editor. Assets e arquivos compactados não foram integralmente inspecionados visualmente.
- Não foi realizada auditoria externa de vulnerabilidades de dependências.
- A presença de `server/.env` foi confirmada sem leitura de seu conteúdo.
- Os 14 arquivos JavaScript passaram em verificação de sintaxe. Isso não valida comportamento de execução.

**Leitura das conclusões:** uma falha estrutural observável no código pode demonstrar a possibilidade de um erro sem provar que ele já aconteceu nesta máquina. Cenários dependentes de concorrência, latência, falha de banco ou ciclo de cena precisam ser reproduzidos em ambiente de teste.

### Estado local preservado

Já existiam alterações em `ExploracaoCombate.js`, `server/server.js` e `db/setup_banco.sql`. Elas incluem preparação parcial da arena do boss. A auditoria não as alterou nem criou commits. A única escrita autorizada nesta etapa é este relatório.

Este documento é um retrato datado, não substitui o `AGENTS.md`, o schema ou as especificações aprovadas. As soluções abaixo são propostas para avaliação; não autorizam implementação automática.

## 2. Estado funcional encontrado

| Área | Estado atual |
| --- | --- |
| Cenas | Sete cenas principais e `UIScene` paralela no combate. |
| Rede | WebSocket por cena, movimento local e interpolação de entidades remotas. |
| Combate | Dano e XP calculados no servidor; contato e cooldown dependem do cliente. |
| Progressão | Atributos recalculados por classe, nível e equipamentos; limiares carregados do banco. |
| Inventário | Equipar, desequipar, coletar e incrementar quantidade implementados, com riscos de concorrência. |
| Inimigos | Cinco tipos no setup, sorteio ponderado, teto de população e respawn. |
| Loot | Drops efêmeros em memória, eventos, coleta e expiração. |
| Boss | Preparação parcial local: `is_boss`, zonas, teleporte de debug e limites dinâmicos. |
| Mapas | Projetos Godot separados, sem integração ao Phaser e ao servidor. |
| Testes | Histórico manual e scripts auxiliares; não há suíte automatizada funcional suficiente. |

O P3 não está concluído. O estado local também já não corresponde a “não iniciado”.

## 3. Sessões, concorrência e persistência — prioridade imediata

### A01 — Exclusividade de sessão vulnerável a concorrência

**Dívida:** 🔴 Alta.  
**Fontes:** `server/server.js`, handler `join`, `activeSessions` e handler `close`.

**Como está hoje:** a consulta a `activeSessions` ocorre antes de duas consultas assíncronas; a reserva acontece somente depois. Não há bloqueio de segundo `join` na mesma conexão. O fechamento do socket durante as consultas não impede a conclusão do carregamento. A chave de sessão usa o ID recebido, sem normalização pelo ID da linha retornada.

**Problema e impacto:** duas conexões podem passar pela verificação inicial e controlar o mesmo personagem. IDs como representações diferentes do mesmo número podem contornar uma trava baseada em string. Um segundo `join` pode abandonar a identidade anterior. Uma conexão fechada pode deixar personagem registrado, e o fechamento de uma sessão antiga pode afetar outra.

**Como deveria estar:** cada personagem tem exatamente uma sessão proprietária; cada conexão tem no máximo um ingresso em andamento ou concluído. Somente a sessão proprietária pode liberar o personagem.

**Solução proposta:** validar e normalizar o identificador; reservar antes do primeiro `await`; manter estado de ingresso da conexão; usar um identificador de sessão ou vínculo equivalente; conferir validade da conexão após esperas; liberar a reserva em todos os caminhos de erro. A liberação deve verificar a propriedade da sessão.

**Validação futura:** dois joins simultâneos, segundo join na mesma conexão, IDs equivalentes e fechamento durante carregamento. Confirmar que não sobram reservas nem personagens fantasmas.

### A02 — Coletas diferentes podem perder incrementos ou duplicar linhas

**Dívida:** 🔴 Alta.  
**Fontes:** `server/server.js`, handler `pickup_item`; `db/setup_banco.sql`, tabela `inventario`; `spec_p5_coleta_loot.md`, passo 5c.

**Como está hoje:** a coleta executa SELECT e depois UPDATE com quantidade calculada, ou INSERT. Não existe unicidade por personagem e item. O `sku` único não assegura essa combinação. A spec assume que uma conexão torna o processamento serial, mas os handlers com `await` podem se sobrepor.

**Problema e impacto:** duas coletas leem quantidade 1 e ambas gravam 2, quando deveriam produzir 3. Se não há linha, ambas podem inserir. Duplicatas equipadas também podem somar bônus da mesma peça por linhas diferentes.

**Como deveria estar:** cada par personagem/item tem uma linha de contagem no modelo atual; cada coleta confirmada contribui exatamente uma vez para a quantidade. Cópias não multiplicam bônus.

**Solução proposta:** verificar e reconciliar duplicatas existentes antes de impor unicidade; usar incremento atômico no banco e uma operação de inserção/incremento compatível com essa unicidade. Coordenar também as operações em memória por personagem. Uma transação isoladamente, sem restrição e sem estratégia de concorrência, não garante o resultado.

**Cuidados:** qualquer migração futura precisa de plano de preservação de dados, aplicação controlada na máquina e atualização correspondente do setup. Não executar o setup destrutivo para corrigir dados que precisam ser mantidos.

**Validação futura:** duas coletas simultâneas do mesmo tipo, com e sem linha preexistente; verificar quantidade, número de linhas e bônus após reconexão.

### A03 — Falha de banco pode consumir o drop sem conceder o item

**Dívida:** 🔴 Alta.  
**Fonte:** `server/server.js`, handler `pickup_item`.

**Como está hoje:** o drop é retirado do mundo e sua remoção é transmitida antes da gravação. Se a operação falha, o tratamento apenas registra o erro.

**Problema e impacto:** todos veem a coleta, mas o item pode não entrar no inventário. A retirada síncrona protege contra disputa pelo mesmo drop, porém não garante persistência.

**Como deveria estar:** o drop só deve ser considerado concedido quando a persistência estiver confirmada. Falhas precisam ter resultado recuperável e sem duplicação.

**Solução proposta:** distinguir reserva, confirmação e falha; impedir uma segunda coleta enquanto reservado; confirmar a concessão após sucesso; liberar/restaurar a reserva quando comprovadamente não houve gravação. Separar falha da gravação de falha da consulta de atualização ou do envio ao cliente. Restaurar indiscriminadamente após qualquer erro pode duplicar um item já gravado. Identidade da operação e reconciliação tornam a recuperação segura.

**Validação futura:** falha antes de gravar, falha após gravar mas antes de atualizar a UI, disputa multiplayer e desconexão durante a coleta.

### A04 — Equipamento pode divergir entre memória e banco

**Dívida:** 🔴 Alta.  
**Fonte:** `server/server.js`, handlers `equip_item` e `unequip_item`.

**Como está hoje:** `item.equipado` é alterado antes da persistência. Mesmo após erro, o servidor recalcula atributos e envia confirmação visual. Uma coleta concorrente pode substituir o inventário enquanto outro handler usa uma referência anterior.

**Problema e impacto:** bônus podem existir somente em memória e desaparecer ao reconectar. Respostas concorrentes podem representar versões diferentes do inventário.

**Como deveria estar:** confirmação ao jogador, inventário em memória, atributos e estado persistido devem corresponder à mesma operação concluída.

**Solução proposta:** ordenar alterações por personagem; confirmar o banco antes de publicar a nova versão ou implementar reversão controlada; evitar referências antigas após `await`; emitir resposta de falha coerente e impedir que respostas obsoletas substituam estado mais recente.

**Validação futura:** falha de UPDATE, cliques rápidos, coleta durante equipamento e reconexão imediatamente após a ação.

### A05 — Reentrada e gravações concorrentes podem recuperar estado antigo

**Dívida:** 🔴 Alta.  
**Fontes:** `liberarPersonagem`, `concederXP`, snapshot periódico e `join` em `server/server.js`.

**Como está hoje:** a sessão é liberada antes de terminar o salvamento. Um novo ingresso pode ler dados anteriores. Gravações de saída, nível e snapshot são independentes, sem controle explícito de versão por personagem.

**Problema e impacto:** risco de HP/XP antigos no retorno e de escrita atrasada sobrescrever estado recente. A correção histórica da liberação síncrona resolve a ocupação na morte, mas não fecha a persistência.

**Como deveria estar:** reentrada deve usar o último estado autoritativo; gravações antigas não podem reverter progresso novo.

**Solução proposta:** coordenar salvamentos por personagem e definir barreira de reentrada ou transferência segura do estado em memória. Usar ordenação ou versionamento para rejeitar escritas antigas. Diferenciar personagem liberado para controle de estado ainda em gravação.

**Validação futura:** morte e reconexão rápida, saída e retorno imediato, consultas atrasadas e falha no salvamento final.

## 4. Configuração e exposição de arquivos

### A06 — Servidor HTTP na raiz inclui arquivos internos

**Dívida:** 🔴 Alta.  
**Fontes:** `commands.md`, estrutura da raiz e presença de `server/.env`.

**Como está hoje:** o comando `python -m http.server 8000`, executado na raiz, serve a árvore do repositório, incluindo arquivos internos. `server/.env` existe nessa árvore. O `.gitignore` não controla acesso HTTP.

**Problema e impacto:** quem alcançar esse serviço pode solicitar configurações internas e outros arquivos que não deveriam ser públicos. A auditoria não fez requisição ao arquivo nem verificou se o serviço está exposto atualmente.

**Como deveria estar:** o servidor estático deve disponibilizar somente os recursos necessários ao navegador.

**Solução proposta:** definir diretório público com client e assets, ou um servidor que permita explicitamente apenas os recursos públicos. Manter configuração do backend e metadados Git fora da árvore servida. Ajustar os comandos de desenvolvimento ao arranjo escolhido.

**Validação futura:** client e assets acessíveis; requisições a configuração do servidor e metadados internos recusadas.

### A07 — Endereço fixo de loopback impede uso LAN direto

**Dívida:** 🟡 Média.  
**Fonte:** `networkConfig.js`.

**Como está hoje:** `SERVER_URL` é `ws://localhost:8080`. Em outro computador, esse endereço aponta para o próprio computador do jogador.

**Como deveria estar:** cada cliente deve resolver o endereço da máquina que hospeda o backend.

**Solução proposta:** configurar o endpoint por ambiente ou derivar o hostname da página quando frontend e backend compartilham o host; manter opção explícita para hospedagens separadas. Documentar porta e endereço LAN. A escolha de `ws`/`wss` deve acompanhar o ambiente de hospedagem.

**Validação futura:** conexão real a partir de um segundo computador, não apenas duas abas na máquina do servidor.

### A08 — Exemplo de banco aponta para schema antigo

**Dívida:** 🟡 Média.  
**Fonte:** `server/.env.example`.

**Como está hoje:** o exemplo usa `DB_NAME=rpg_game`; a fonte atual de schema é `jogo_pi`.

**Como deveria estar:** uma instalação nova deve receber orientação compatível com o código atual.

**Solução proposta:** alinhar o exemplo e as instruções de instalação ao schema vigente, preservando os scripts antigos como histórico claramente identificado. Não copiar credenciais reais para documentação.

**Validação futura:** instalação em ambiente separado seguindo apenas o procedimento documentado.

## 5. Client, rede e sincronização

### A09 — Posição persistida recebida no welcome não é aplicada

**Dívida:** 🔴 Alta.  
**Fonte:** `ExploracaoCombate.js`, `create` e `handleWelcome`.

**Como está hoje:** o retângulo local nasce em `(1000,1000)`. O welcome informa a posição do servidor, mas ela não reposiciona o jogador. O próximo envio de movimento pode sobrescrever a posição recuperada do banco.

**Como deveria estar:** antes de habilitar movimento e envio, posição visual e corpo físico devem refletir o estado inicial autorizado.

**Solução proposta:** aplicar posição inicial, velocidade e limites pertinentes no handshake, usando o mecanismo adequado para sincronizar o corpo físico. Só habilitar interação após concluir a inicialização.

**Validação futura:** salvar em outra posição, reconectar e verificar posição visual, servidor e próximo snapshot.

### A10 — Cena de combate não trata falha ou recusa de conexão

**Dívida:** 🟡 Média.  
**Fonte:** `ExploracaoCombate.js`, `initMultiplayer`.

**Como está hoje:** não há tratamento próprio de `onclose`, `onerror` ou timeout do handshake. A indicação de sistema online é criada antes da confirmação. A seleção trata falhas melhor que o combate.

**Como deveria estar:** a UI deve distinguir conexão em andamento, sessão ativa, recusa e desconexão. Ações dependentes da rede não devem aparentar sucesso sem sessão.

**Solução proposta:** modelar os estados da conexão, interromper ações quando desconectado, mostrar motivo compreensível e definir retorno/reconexão compatível com a FSM. Não é necessário antecipar a migração completa para socket global para corrigir o tratamento atual.

**Validação futura:** servidor indisponível, personagem ocupado após seleção, queda durante combate e ausência de welcome.

### A11 — Callbacks de socket sobrevivem ao shutdown da cena

**Dívida:** 🟡 Média, risco de ciclo de vida; vazamento permanente não comprovado.  
**Fonte:** `ExploracaoCombate.js`, shutdown e callbacks WebSocket.

**Como está hoje:** o shutdown fecha o socket, mas mantém callbacks que capturam a cena. Uma resposta atrasada pode encontrar objetos destruídos ou estado de uma nova execução da mesma cena.

**Como deveria estar:** uma conexão antiga não pode modificar uma cena encerrada ou reiniciada.

**Solução proposta:** retirar callbacks antes de fechar, invalidar a geração da conexão e liberar referências pertinentes. Reusar o padrão de fechamento explícito já presente na seleção, adaptando-o ao combate.

**Validação futura:** sair enquanto conecta, reiniciar por morte e repetir transições com mensagens atrasadas.

### A12 — Atributos remotos não acompanham todas as atualizações

**Dívida:** 🟡 Média.  
**Fonte:** `ExploracaoCombate.js`, `handleStateUpdate`, `handleLevelUp` e `handleStatsUpdated`.

**Como está hoje:** o snapshot atualiza posições; handlers de atributos filtram pelo jogador local. O HP máximo de outro personagem pode permanecer no valor recebido no spawn, mesmo após nível ou equipamento.

**Como deveria estar:** a barra remota deve usar HP atual e máximo vigentes daquele personagem.

**Solução proposta:** atualizar os dados públicos de atributos das entidades remotas por evento ou snapshot adequado. Como equipamento hoje responde apenas ao coletor, alinhar também o canal de publicação desses atributos públicos.

**Validação futura:** dois clientes; um sobe de nível ou equipa/desequipa HP e o outro observa a barra correta.

### A13 — Eventos do mundo chegam a conexões sem ingresso concluído

**Dívida:** 🟡 Média.  
**Fonte:** `server/server.js`, `broadcast` e tick; inicialização do client.

**Como está hoje:** o servidor publica para sockets abertos, inclusive conexões de listagem e conexões ainda sem `join`. O client pode receber eventos antes do snapshot inicial.

**Como deveria estar:** assinatura do mundo deve iniciar em um ponto definido do handshake, com ordem consistente entre snapshot e eventos.

**Solução proposta:** separar socket aberto de participante ativo; enviar broadcasts do jogo somente aos participantes aptos. No client, proteger a inicialização e tornar criação de entidades idempotente onde necessário.

**Validação futura:** atrasar o join enquanto inimigos e drops surgem; verificar ausência de entidades duplicadas e eventos aplicados cedo demais.

### A14 — Movimento não valida estrutura e valores numéricos

**Dívida:** 🟡 Média.  
**Fonte:** `server/server.js`, handler `player_move`.

**Como está hoje:** os limites de zona restringem coordenadas, mas campos ausentes ou inválidos podem produzir `NaN`; velocidades também não são validadas.

**Como deveria estar:** mensagens inválidas não devem contaminar o estado nem chegar à persistência.

**Solução proposta:** validar formato, tipos e finitude antes de aceitar dados; rejeitar mensagens inválidas mantendo o último estado válido. Separar validação estrutural básica de um sistema completo de anti-cheat, que foi adiado.

**Validação futura:** campos ausentes, strings, valores fora do intervalo e payloads inesperados.

### A15 — Velocidade diagonal maior e interpolação dependente do frame

**Dívida:** 🟡 Média.  
**Fonte:** `ExploracaoCombate.js`, `update`.

**Como está hoje:** cada eixo recebe velocidade 300, chegando a aproximadamente 424 pixels/s na diagonal. A interpolação usa fator fixo por frame.

**Como deveria estar:** se a intenção é velocidade uniforme, o vetor diagonal deve manter o mesmo módulo. A suavização deve ter comportamento comparável em taxas de frame diferentes.

**Solução proposta:** normalizar a direção antes de aplicar velocidade, sem alocação recorrente. Para interpolação, avaliar fator baseado em tempo ou snapshots temporizados, preservando o resultado visual desejado.

**Validação futura:** comparar distâncias percorridas por tempo e movimento remoto em diferentes FPS. Confirmar a intenção de design antes de alterar sensação de movimento.

### A16 — Autoridade do servidor é parcial por decisão do protótipo

**Classificação:** limite arquitetural aceito; não tratar anti-cheat adiado como feature esquecida.  
**Fontes:** handlers `attack_enemy` e `pickup_item`; specs e roadmap.

**Como está hoje:** o servidor calcula resultados, mas não verifica distância de ataque/coleta nem mantém cooldown autoritativo de ataque. O contato vem do Phaser e o intervalo de 500 ms está no cliente.

**Como deveria estar:** a descrição documental deve refletir precisamente essa divisão. Se o projeto exigir autoridade sobre validade das ações, distância, zona e frequência precisam ser verificadas no servidor.

**Solução proposta:** registrar o limite aceito. Antes de ampliar o boss, definir quais verificações são necessárias para assegurar as regras da arena. Não introduzir um sistema completo de anti-cheat sem decisão de escopo.

**Validação futura:** testar ações entre zonas e ataques fora da frequência prevista quando esse contrato for implementado.

## 6. Banco, atributos e progressão

### A17 — HP atual pode ultrapassar HP máximo

**Dívida:** 🟡 Média.  
**Fontes:** recálculo e join em `server/server.js`; `drawHpBar` em `ExploracaoCombate.js`.

**Como está hoje:** desequipar bônus de HP reduz o máximo sem ajustar o atual. O join cura valores não positivos, mas não limita HP positivo ao máximo recalculado. A barra não limita o preenchimento superior a 100%.

**Como deveria estar:** a regra para redução de HP máximo deve ser explícita e preservar um estado válido; a barra deve representar esse estado sem extrapolar a moldura.

**Solução proposta:** decidir a política de HP ao reduzir máximo, por exemplo limitar o atual ao novo máximo sem conceder cura. Aplicá-la no servidor após recálculo e carregamento. Limitar o percentual visual como proteção adicional, sem esconder erro do modelo.

**Validação futura:** desequipar com HP cheio, rebalancear bônus em ambiente de teste e reconectar com HP acima do novo máximo.

### A18 — Limiar do nível 21 incompatível com capacidade de experiência

**Dívida:** 🟡 Média.  
**Fonte:** `db/setup_banco.sql`, `personagens.experiencia` e conteúdo de `table_nivel`.

**Como está hoje:** o limiar do nível 21 é 99.999.999.999; `DECIMAL(12,2)` comporta no máximo 9.999.999.999,99.

**Como deveria estar:** todo limiar alcançável deve caber no campo persistido. Se for uma sentinela para impedir progressão, o nível máximo deve ser entendido como regra explícita.

**Solução proposta:** confirmar a intenção do nível 21. Se alcançável, compatibilizar armazenamento e valores; se sentinela, formalizar o teto e a apresentação na UI, sem rebalancear silenciosamente a curva.

**Validação futura:** limites de progressão e persistência próximos ao máximo, em banco de teste.

### A19 — Catálogos carregados sem validação de invariantes

**Dívida:** 🟡 Média.  
**Fonte:** carregamento de catálogos e `sortearTipoMob` em `server/server.js`.

**Como está hoje:** o boot espera os dados, mas não oferece validação dedicada para catálogo vazio, pesos inconsistentes, vida inválida, intervalos de quantidade ou limiares incoerentes.

**Como deveria estar:** configuração inválida deve produzir diagnóstico claro antes de abrir o jogo, evitando falhas posteriores no spawn ou na progressão.

**Solução proposta:** validar invariantes no carregamento, com mensagens que identifiquem o catálogo e a linha problemática. Tratar falha do bootstrap explicitamente. Definir também o comportamento quando não existem tipos elegíveis para spawn.

**Validação futura:** catálogos vazios e dados inválidos em ambiente isolado.

### A20 — Colunas derivadas legadas e correspondência do banco não verificada

**Dívida:** 🟡 Média de modelagem e operação.  
**Fontes:** `db/setup_banco.sql`, `server/server.js`.

**Como está hoje:** `hp_max`, `dano_base` e `defesa_base` continuam obrigatórios no schema, embora o runtime recalcule os atributos. Isso não demonstra que o servidor voltou a persistir derivados. Também não foi verificada a aplicação local de `is_boss`.

**Como deveria estar:** a criação de personagens não deve depender de uma segunda fonte de atributos, e código/setup/banco ativo devem estar compatíveis.

**Solução proposta:** planejar o tratamento das colunas legadas junto da futura criação de personagens, sem removê-las de modo improvisado. Antes da próxima implementação que dependa do banco, fazer inspeção somente de leitura da estrutura e comparar com a fonte versionada. Aplicar migrações controladas quando necessário.

**Validação futura:** comparação de schema, carregamento e criação de personagens após a decisão de modelagem.

## 7. Arquitetura, desempenho e limpeza

### A21 — Responsabilidades concentradas em arquivos grandes

**Dívida:** 🟡 Média.  
**Fontes:** `server/server.js`, `ExploracaoCombate.js` e arquitetura descrita no `AGENTS.md`.

**Como está hoje:** o servidor reúne domínio, persistência, sessões, rede e timers. A cena reúne rede, input, entidades e renderização. Os sistemas especializados ilustrados na constituição não existem como módulos separados.

**Como deveria estar:** regras do jogo devem ser independentes de transporte e persistência; cenas devem coordenar sistemas de apresentação com contratos claros.

**Solução proposta:** extrair responsabilidades incrementalmente nos passos em que houver benefício concreto: sessões, repositório/persistência de personagens, inventário, combate e apresentação de entidades. Preservar eventos e regras estáveis. Não fazer uma reescrita global antes de resolver a integridade.

**Validação futura:** comportamento equivalente por etapa, com testes de domínio e teste manual dos fluxos afetados.

### A22 — Update contraria as regras de alocação e delegação

**Dívida:** 🔴 Alta conforme a classificação do `AGENTS.md`; impacto de FPS não medido.  
**Fonte:** `ExploracaoCombate.js`, `update`.

**Como está hoje:** o update contém iterações diretas e cria callbacks de `forEach` a cada frame. Barras são redesenhadas continuamente.

**Como deveria estar:** o update deve delegar, evitar alocações recorrentes e limitar trabalho ao necessário.

**Solução proposta:** mover atualização de entidades para sistemas de apresentação; usar iteração ou callbacks preparados fora do loop; reaproveitar estruturas. Avaliar redesenho das barras somente quando HP/máximo mudarem, separando desenho de posicionamento.

**Validação futura:** observar alocações e frame time em cenário controlado, além de confirmar barras e interpolação.

### A23 — Pooling e particionamento ainda não implementados

**Dívida:** 🟡 Média no protótipo atual, com descumprimento dos requisitos explícitos de performance.  
**Fonte:** grupos e métodos de spawn/destruição em `ExploracaoCombate.js`.

**Como está hoje:** inimigos e barras são criados e destruídos; os grupos não implementam reutilização limitada por pool. Não há culling ou particionamento explícito para limitar processamento de entidades distantes.

**Como deveria estar:** entidades frequentes devem reutilizar recursos e a apresentação deve processar apenas o necessário. Ocultar algo localmente não pode interromper a autoridade do servidor sobre o mundo compartilhado.

**Solução proposta:** introduzir pools com reset completo de estado e capacidade adequada; implementar visibilidade e atividade locais com reativação segura; avaliar grade espacial quando população e mapas justificarem. Evitar aplicar cegamente `setActive(false)` sem preservar os mecanismos de atualização e retorno à visão.

**Validação futura:** ciclos de spawn/morte, retorno de entidades à câmera e benchmark com população representativa.

### A24 — Snapshot de rede inclui dados completos desnecessários

**Dívida:** 🟡 Média.  
**Fonte:** tick de 20 Hz em `server/server.js`.

**Como está hoje:** objetos completos de jogadores, inclusive inventários, são serializados e enviados a cada 50 ms.

**Como deveria estar:** o tick deve carregar principalmente estado dinâmico público; inventário e dados raramente alterados devem usar eventos específicos ou snapshot inicial.

**Solução proposta:** definir payload público enxuto e separar estado privado do personagem. Medir tamanho e frequência antes de adotar protocolos mais complexos. Atualizar documentação e todos os consumidores se o contrato mudar.

**Validação futura:** comparar tráfego por segundo e verificar que entradas, equipamentos, HP e reconexões continuam sincronizados.

### A25 — Spawn seguro não garante afastamento nem transitabilidade

**Dívida:** 🟡 Média; relevante antes de integrar obstáculos.  
**Fontes:** `resolveSpawnPosition`, criação de drops e algoritmo ilustrativo do roadmap.

**Como está hoje:** o spawn faz um passe pelos ocupantes e limita coordenadas no final. Uma correção pode aproximar novamente de um ocupante anterior. Drops usam offset aleatório sem consultar células transitáveis. O safe drop ilustrado na documentação não está integrado.

**Como deveria estar:** o ponto final deve respeitar limites, transitabilidade e afastamento definido, com fallback conhecido.

**Solução proposta:** validar a posição final contra os critérios relevantes; fazer busca limitada de candidatos com fallback seguro. Quando mapas forem integrados, disponibilizar dados de colisão/transitabilidade ao servidor, sem depender de objeto Phaser para regras do mundo.

**Validação futura:** cantos, pontos ocupados, paredes, áreas sem candidato próximo e drops junto ao limite do mapa.

### A26 — Limpeza de timers: não há falha comprovada no padrão atual

**Classificação:** comportamento correto a preservar.

**Como está hoje:** cenas usam timers e tweens da API Phaser. O Loader instalado remove seus listeners no shutdown. Não há base para atribuir vazamento ao listener de progresso de `Loading` apenas porque ele não tem `off` explícito no código da cena.

**Como deveria continuar:** timers de cena pela API da cena; listeners globais e callbacks externos removidos por quem os registra.

**Ação proposta:** preservar esse padrão e concentrar revisão nos callbacks WebSocket e nas referências externas. Não criar limpeza duplicada sem necessidade nem afirmar vazamento sem evidência.

## 8. Interface e experiência

### A27 — Inventário não escala visualmente com conteúdo

**Dívida:** 🟡 Média para expansão; quantidade ausente é pendência cosmética conhecida.  
**Fonte:** `UIScene.js`.

**Como está hoje:** quantidade não aparece, lista não tem rolagem/recorte e linhas adicionais ultrapassam a moldura. Recusas e erros de equipamento não são explicados.

**Como deveria estar:** itens acessíveis dentro de uma área controlada, quantidade visível quando pertinente e feedback fiel do resultado da ação.

**Solução proposta:** incluir rolagem ou paginação e máscara de conteúdo quando o catálogo crescer; mostrar quantidade sem associá-la a bônus; usar respostas de sucesso/falha do servidor. Manter arte provisória até a integração dos assets, conforme decisão existente.

**Validação futura:** inventários vazios, pequenos e grandes; item repetido; recusa e falha de gravação.

### A28 — Layout fixo dificulta telas menores

**Dívida:** 🟡 Média.  
**Fontes:** `main.js`, `UIScene.js` e cenas de menu.

**Como está hoje:** canvas de 1920 × 920 e posições absolutas, inclusive inventário próximo à borda inferior.

**Como deveria estar:** controles essenciais devem permanecer acessíveis nas resoluções alvo.

**Solução proposta:** definir política de escala e área útil; adaptar os pontos de ancoragem da UI à câmera/viewport sem redesenhar desnecessariamente toda a identidade visual.

**Validação futura:** resoluções utilizadas pela equipe, janela reduzida e diferentes proporções de tela.

### A29 — Barra de XP usa proporção de carreira, não do nível

**Classificação:** decisão de apresentação a esclarecer.  
**Fonte:** `UIScene.js`, `renderStats`.

**Como está hoje:** preenchimento é XP total dividido pelo próximo limiar. A barra não volta ao início após subir de nível.

**Como deveria estar:** a representação deve corresponder ao significado comunicado ao jogador.

**Solução proposta:** se a intenção for progresso dentro do nível, fornecer pelo servidor os limites ou a fração apropriada e renderizar o intervalo atual. Se a intenção for proporção do XP total até o próximo limiar, conservar o cálculo e tornar essa leitura clara. Não alterar a curva de XP para corrigir uma questão visual.

**Validação futura:** barra imediatamente antes/depois de subir de nível e comportamento no teto de progressão.

## 9. Boss — preparação e decisões necessárias

### A30 — Flag de boss ainda não cria comportamento de boss

**Dívida:** 🟡 Média como trabalho parcial; bloqueante para cadastrar um boss como conteúdo jogável.  
**Fontes:** `server/server.js`, `db/setup_banco.sql`, `ExploracaoCombate.js`.

**Como está hoje:** `is_boss` é carregado e transportado, mas não separa sorteio, movimento, combate ou recompensa. Um boss com peso positivo pode entrar no spawn normal. O teleporte de debug não tem restrição de ambiente. Ainda não existem portal real, canalização, memória de dano, cofre de XP ou resolução da tentativa.

**Como deveria estar:** boss deve ter ciclo próprio coerente com a spec, sem contaminar o spawn normal; ferramenta de debug deve ser limitada ao contexto de teste.

**Solução proposta:** separar elegibilidade do spawn comum; implementar a tentativa do boss como estado explícito no servidor; condicionar comandos de debug ao ambiente configurado. Manter o reaproveitamento das regras comuns apenas onde o contrato permitir.

**Validação futura:** cadastrar boss em banco de teste e comprovar que só surge no fluxo previsto; verificar que o comando de debug não integra o fluxo normal de jogo.

### A31 — Contrato de tentativa e recompensa ainda tem lacunas

**Dívida:** 🟡 Média documental, com potencial de inconsistência alta se implementada sem decisão.  
**Fonte:** `spec_p3_boss.md`.

| Tema | Como está hoje | Como deveria ficar definido / proposta |
| --- | --- | --- |
| Cofre de XP | Texto alterna ideia coletiva e individual. | Definir uma representação única: total distribuível e contribuição individual, ou créditos individuais com regra exata de liquidação. Evitar aplicar proporcionalidade duas vezes. |
| Pico de abate | Previsto, sem valor/fórmula fechado. | Distinguir XP acumulado por dano e bônus de vitória; definir origem do valor e fórmula de distribuição. |
| Reset | HP volta a 100% quando alguém sai ou morre. | Definir também destino de todo histórico de dano e XP dos participantes restantes. Vincular os dados a uma tentativa para impedir mistura de tentativas. |
| Desconexão | Não explicitada. | Decidir se equivale a desistência, se há tolerância e como afeta o grupo. |
| Congelamento | XP, nível e atributos devem congelar. | Definir se equipamento fica bloqueado ou se atributos são congelados por snapshot; impedir alterações indiretas de poder. |
| Morte simultânea | Sem precedência definida. | Decidir vitória/derrota se jogador e boss morrem no mesmo golpe. |
| Participação tardia | Entrada na luta existente é permitida. | Definir elegibilidade de quem entra tarde, morre, sai ou reconecta. |
| Canalização | Tempo de 3–5 s e trava por nível. | Fixar duração configurável e regras quando participantes entram/saem da área, morrem ou desconectam. |
| Recompensa persistida | Liquidação ainda não existe. | Garantir concessão única por tentativa, inclusive diante de falha e repetição de operação. |

**Solução proposta:** fechar essas decisões antes do código de recompensa. Modelar estados de tentativa e participantes no servidor, com identificador de tentativa, transições e resultado inequívocos. A proposta de estrutura não escolhe por conta própria as regras de derrota ou distribuição.

**Validação futura:** vitória cooperativa, entrada tardia, abandono, desconexão, morte simultânea, reset e tentativa de receber a mesma recompensa novamente.

## 10. Godot, mapas e assets

### A32 — Projetos têm maturidades diferentes

**Dívida:** 🟡 Média de integração.  
**Fontes:** diretórios em `map/`.

| Projeto | Como está hoje | Estado esperado e solução proposta |
| --- | --- | --- |
| `mapa-do-jogo` | Cena com tiles e polígonos de colisão; controlador local. | Validar no editor e usar como fonte de mapa, com contrato de exportação. Não assumir que já é client multiplayer. |
| `gerador-precedual-de-mapa-` | Gerador implementado, mas scripts com inconsistências. | Corrigir e validar scripts antes de usar como ferramenta de produção de mapas. |
| `engine-gerador-de-mapa-` | Cinco scripts com `pass`; cena com nó raiz. | Registrar como estrutura inicial. Implementar apenas os sistemas escolhidos para uso real, sem tratá-la como engine pronta. |

### A33 — Inconsistências no gerador procedural

**Dívida:** 🟡 Média; possíveis bloqueios de carregamento a confirmar no Godot.  
**Fontes:** `map/gerador-precedual-de-mapa-/tile_map_layer.gd` e `world_generator.gd`.

**Como está hoje:** dois scripts declaram `class_name WorldGenerator`. Um usa `seed` onde a propriedade exportada é `world_seed`; a checagem de referência compara `ground_layer` com `TileMapLayer`, em vez de verificar a atribuição da instância.

**Como deveria estar:** nomes globais de classe não conflitantes, semente consistente e validação de referência antes de usar a camada.

**Solução proposta:** definir qual implementação é a ativa; remover a ambiguidade de nomes; usar a variável de semente correta; validar instância atribuída; conferir scripts ligados à cena. Esses problemas não foram reproduzidos no editor nesta auditoria.

**Validação futura:** importação do projeto, execução da cena e geração repetida com a mesma semente.

### A34 — Geração cria um gerador aleatório por célula

**Dívida:** 🟡 Média de eficiência no carregamento; não é alocação por frame de combate.  
**Fonte:** `world_generator.gd`, `random_tile`.

**Como está hoje:** para o padrão 200 × 200, são criadas 40 mil instâncias de aleatoriedade durante a geração.

**Como deveria estar:** geração determinística com custo compatível com o tempo de carregamento alvo.

**Solução proposta:** avaliar hash determinístico por coordenada ou reutilização do gerador, preservando a propriedade desejada de repetibilidade e independência da ordem. Medir antes/depois, pois a auditoria não mediu esse custo.

**Validação futura:** tempo de geração, memória e igualdade do mapa para uma mesma semente.

### A35 — Falta contrato de integração entre Godot, Phaser e servidor

**Dívida:** 🟡 Média, bloqueante para integração coerente de mapas.  
**Fontes:** projetos Godot, `Preload.js`, código de mundo e roadmap.

**Como está hoje:** projetos declaram Godot 4.6 e 4.7. Não há pipeline implementado que transforme cenas em mapa consumível pelo Phaser e em dados de transitabilidade para o servidor. Ter um `.tscn` pronto não garante carregamento web.

**Como deveria estar:** versão de ferramenta acordada e contrato de entrega com formato, tamanho de tile, coordenadas, camadas, colisões, pontos de spawn, atlas e nomes de recursos.

**Solução proposta:** definir o formato intermediário/exportação e quem produz cada entrega. Cliente e servidor devem consumir dados compatíveis do mesmo mapa. Validar primeiro um mapa pequeno de ponta a ponta antes de integrar todo o conteúdo.

**Validação futura:** correspondência visual e física, caminhos transitáveis, spawn/drop seguro e repetibilidade entre máquinas.

## 11. Documentação e operação

### A36 — Vários pontos de retomada se contradizem

**Dívida:** 🟡 Média.  
**Fontes:** `AGENTS.md`, `roadmap_game.md`, specs e comentários.

| Local | Como está hoje | Como deveria estar / solução proposta |
| --- | --- | --- |
| Abertura do roadmap | P1 a P5 “100% completo”, com P3 ainda próximo. | Enumerar precisamente P1, P2, P4 e P5 concluídos; identificar P3 parcial, sem sugerir bloco inteiro concluído. |
| Roadmap §6 | “Estado exato para retomada” manda implementar P5. | Manter um único ponto de retomada vigente; marcar o antigo como histórico e apontar para o atual. |
| Pendências do roadmap | Constantes removidas e coleta já existente aparecem como pendências. | Reconciliar com o código e datar o fechamento, preservando o histórico. |
| AGENTS.md | Spec P5 ainda aparece como próximo passo; normas de performance não são cumpridas integralmente. | Atualizar somente referências de estado e registrar dívida de conformidade, sem afrouxar regras para encobrir problemas. |
| Spec P5 | Retrato pré-implementação e premissa de serialização incorreta. | Identificar o retrato como histórico; corrigir o entendimento da concorrência e apontar a solução aprovada quando existir. |
| Spec P3 | Direção geral definida, casos de tentativa/recompensa em aberto. | Fechar as decisões de A31 antes de chamar o contrato de completo para implementação. |
| Comentários do servidor | Alguns ainda dizem que loot só é logado ou que campos não são consumidos. | Atualizar comentários para explicar responsabilidade vigente, removendo afirmações superadas. |
| `commands.md` | Poucos comandos, sem instalação e LAN suficientes. | Criar procedimento reproduzível com configuração, dependências, banco, inicialização e servidor estático público seguro. |

**Princípio da solução:** preservar o histórico, mas separar claramente “era assim”, “está assim” e “será feito”. Não duplicar schema SQL ou regras em múltiplos documentos. O schema continua em `db/setup_banco.sql`.

**Validação futura:** uma pessoa deve conseguir identificar o estado atual e iniciar um ambiente de teste sem recorrer a instruções contraditórias.

## 12. Testes e confiança na validação

### A37 — Scripts atuais não constituem cobertura de regressão suficiente

**Dívida:** 🟡 Média.  
**Fontes:** `package.json`, `server/test_join.js`, `server/test_pacote2.js`, `server/test_pacote4.js`.

**Como está hoje:** `npm test` é placeholder que termina com erro. Os scripts imprimem resultados e alteram estado real quando executados. `test_pacote4.js` procura IDs textuais antigos apesar de `item_id` ser numérico e pressupõe moeda inexistente no setup atual. Não há cobertura dos casos de concorrência e falha identificados.

**Como deveria estar:** testes devem verificar contratos atuais com asserções e dados isolados. O teste manual no navegador continua obrigatório para fechar alterações de client, conforme AGENTS.md.

**Solução proposta:** atualizar scripts úteis, separar testes de domínio e integração, preparar banco descartável ou fixtures controladas e adicionar testes relevantes de sessão, coleta, falha e reconexão. Não rodar testes mutantes contra os personagens da equipe sem ambiente apropriado.

**Validação futura:** testes falham quando o contrato é violado e passam com resultados verificáveis, sem depender apenas da leitura de logs.

### Matriz mínima de validação futura

| Área | Cenários essenciais |
| --- | --- |
| Sessões | Join simultâneo, segundo join, ID equivalente e fechamento durante consulta. |
| Inventário | Coletas concorrentes, item repetido, equipamento concorrente, falha e reconexão. |
| Persistência | Saída/retorno rápido, morte, latência do banco e escrita atrasada. |
| Client | Posição inicial, falha de conexão, troca de cena e dados remotos. |
| LAN | Dois computadores usando o host real do servidor. |
| UI | Quantidade, catálogo grande, feedback e resoluções alvo. |
| Boss | Vitória, derrota, reset, participação tardia, desconexão e concessão única. |
| Mapas | Colisão compartilhada, transitabilidade, limites e spawn seguro. |
| Performance | Frame time, alocações, tráfego e crescimento de entidades. |

Os testes manuais históricos demonstram que os cenários exercitados funcionaram nas respectivas ocasiões. Não provam ausência de corridas assíncronas ou falhas de persistência fora desses cenários.

## 13. Acertos que devem ser preservados

- Conversão explícita de XP vindo de `DECIMAL` nos caminhos auditados.
- XP pelo dano efetivo limitado ao HP restante, evitando overkill remunerado.
- Ausência de pico de abate para inimigos comuns e Elite.
- Quantidade não multiplica diretamente bônus de uma linha equipada.
- Recálculo centralizado de atributos, sem voltar a persistir derivados no runtime.
- Queries parametrizadas nos caminhos auditados que recebem dados do cliente.
- Catálogos carregados antes de abrir o servidor.
- Phaser sem consulta direta ao banco e sem fórmula de atributos em sprites.
- Comunicação da UI por eventos e remoção dos listeners globais identificados.
- Timers de cena pela API Phaser.
- Distinção entre ID de mob, instância de inimigo, linha de inventário e drop.
- Reserva síncrona implícita do mesmo drop antes de `await`, que resolve parte da disputa multiplayer e deve evoluir sem perder essa proteção.
- Arte provisória tratada como ferramenta de validação, evitando polimento prematuro.
- Histórico de decisões e exigência de teste manual preservados.

## 14. Ordem recomendada para trabalho posterior

1. **Integridade:** A01–A05, resolvendo sessões, coleta, equipamento e ordenação da persistência.
2. **Configuração e sincronização básica:** exposição estática, LAN, exemplo de banco, posição inicial e tratamento de conexão.
3. **Estado documental:** um ponto vigente de retomada, com histórico preservado e status parcial do boss explícito.
4. **Contrato do boss:** fechar tentativa, participação, reset, congelamento e recompensa.
5. **Implementação do P3:** sub-passos pequenos, com validação no navegador e testes relevantes de persistência.
6. **Mapas e crescimento:** contrato de assets/colisão, integração incremental e adequação de UI e performance ao volume real.

Essa ordem não autoriza mudanças. Cada passo deve respeitar o escopo que o responsável definir, apresentar a análise arquitetural quando aplicável e incluir critérios concretos de validação.

## 15. Checkpoint desta entrega

- Relatório criado na raiz: `ultima auditoria.md`.
- Nenhuma solução deste documento implementada.
- Nenhum código, schema, configuração ou outro documento alterado nesta etapa.
- Nenhum banco modificado e nenhum teste mutante executado.
- Nenhum commit ou push realizado.
- Aguardando o próximo comando do responsável pelo projeto.
