# commands.md — Comandos de Operação e Runbook de Máquina Nova

Fonte única dos comandos de operação do projeto. Procedimento de preparação de máquina
mora aqui; o `AGENTS.md` §00 aponta pra este arquivo em vez de duplicar o passo a passo.

---

## Rodar o projeto (máquina já preparada)

Dois processos, em terminais separados:

```bash
node server/server.js     # servidor autoritário (WebSocket :8080 + MySQL)
python -m http.server 8000   # client Phaser — abrir http://localhost:8000
```

Ao trocar qualquer arquivo de cena/client, **hard-refresh no navegador (Ctrl+Shift+R)** —
senão o browser serve a versão velha e parece que a mudança não pegou (AGENTS.md §00).

Para jogar de outra máquina na LAN, acesse `http://<ip-da-máquina-do-servidor>:8000`.
O `networkConfig.js` deriva o endereço do WebSocket do próprio hostname da página, então
não há endereço pra trocar no código.

---

## Runbook de máquina nova

Git traz código, **não traz** `node_modules`, `server/.env` nem banco. Os quatro passos:

### 1. Dependências

```bash
npm install
```

Obrigatório para os dois lados: o servidor usa `ws`/`mysql2`/`dotenv`, e o `index.html`
carrega o Phaser de `./node_modules/phaser/dist/phaser.js`. Sem isso o servidor morre com
`MODULE_NOT_FOUND` na linha 2 (`require('dotenv')`) e o client abre em tela preta.

### 2. Conferir o MySQL

```bash
command -v mysql mysqld        # cliente e servidor presentes?
systemctl is-active mysql      # deve responder "active"
ss -ltn | grep 3306            # deve haver LISTEN em 127.0.0.1:3306
```

**MySQL Workbench NÃO é requisito.** O projeto fala com o banco por TCP via `mysql2`
(servidor) e pelo CLI `mysql` (setup do schema). O Workbench é só uma GUI opcional — a
ausência dele não impede nada. O que precisa estar instalado é o pacote
`mysql-server-8.0` (engine) e o `mysql-client-8.0` (CLI).

### 3. Usuário do banco

O `GRANT` no fim do `db/setup_banco.sql` assume que o usuário `rpg_app` já existe, e falha
com erro de usuário desconhecido se não existir. Criar antes, em máquina nova:

```bash
mysql -u root -p -e "CREATE USER IF NOT EXISTS 'rpg_app'@'localhost' IDENTIFIED BY 'SENHA';
                     GRANT ALL PRIVILEGES ON jogo_pi.* TO 'rpg_app'@'localhost';
                     FLUSH PRIVILEGES;"
```

### 4. Schema

⚠️ **`db/setup_banco.sql` é DESTRUTIVO** — a primeira linha é
`DROP DATABASE IF EXISTS jogo_pi`. Sempre conferir o que existe ANTES:

```bash
mysql -u root -p -e "SHOW DATABASES LIKE 'jogo_pi';
                     SELECT COUNT(*) FROM jogo_pi.personagens;"
```

* Banco ausente, ou presente só com os 5 personagens de teste em nível 1 → pode rodar:

  ```bash
  mysql -u root -p < db/setup_banco.sql
  ```

* Banco com progresso real a preservar → **não rodar**. Fazer dump antes
  (`mysqldump -u root -p jogo_pi > backup.sql`) ou aplicar só o que falta via `ALTER`.

### 5. Credenciais

```bash
cp server/.env.example server/.env   # e preencher DB_PASSWORD com a senha do rpg_app
chmod 600 server/.env
```

`server/.env` é gitignored por design — cada máquina tem o seu. A senha aqui tem que ser a
mesma usada no `CREATE USER` do passo 3.

⚠️ **Aspeie a senha se ela tiver `#` ou outro caractere especial:** `DB_PASSWORD="Rpg_App#2026"`.
Sem aspas o `dotenv` trata o `#` como comentário e trunca a senha, e o sintoma (`Access denied`
só no servidor, funcionando no CLI) aponta pro lugar errado — ver AGENTS.md §00. Conferir com:

```bash
node -e "require('dotenv').config({path:'server/.env'}); console.log(process.env.DB_PASSWORD.length)"
```

### 6. Comandos de debug (opcional, só em máquina de desenvolvimento)

O handler `debug_tp_boss` (tecla **T** na cena de combate, teleporte para a arena do boss) fica
**desligado por padrão**. Para habilitar em teste de campo, adicione ao `server/.env`:

```bash
DEBUG_COMMANDS=true
```

Mesmo ligado, o teleporte respeita o nível mínimo da arena (`PORTAL_BOSS_MIN_LEVEL`) — ver
AGENTS.md §08, "Guardas autoritárias de ação de mundo". Sem a variável, pressionar T não faz nada
e o servidor loga `[debug_tp_boss] Ignorado`.

---

## Diagnóstico rápido

| Sintoma | Causa provável |
| --- | --- |
| `MODULE_NOT_FOUND` em `server.js:2` | falta `npm install` (passo 1) |
| Client em tela preta, 404 de `phaser.js` | falta `npm install` (passo 1) |
| `Access denied for user 'rpg_app'` **mas a mesma senha funciona no CLI `mysql`** | `#` (ou outro especial) sem aspas no `server/.env` — o `dotenv` corta no `#` e trunca a senha. Aspear: `DB_PASSWORD="..."`. Ver AGENTS.md §00 |
| `Access denied for user 'rpg_app'` (também pelo CLI) | `server/.env` ausente/senha errada, ou `GRANT` não aplicado (passos 3 e 5) |
| `ERROR 1819 ... password does not satisfy the current policy` | política `validate_password` (MEDIUM): mín. 8 chars com maiúscula, minúscula, número e símbolo |
| `ERROR 1410 ... not allowed to create a user with GRANT` na última linha do setup | o usuário `rpg_app` não existia — o MySQL 8 não cria usuário via `GRANT`. Rodar o passo 3 ANTES do passo 4 (as tabelas são criadas normalmente; só o `GRANT` final falha) |
| `ERROR 1044 Access denied for user 'rpg_app' to database 'jogo_pi'` na última linha do setup | o script foi rodado com o usuário da aplicação em vez de `root`: `rpg_app` tem `ALL PRIVILEGES ON jogo_pi.*` mas não tem `GRANT OPTION`, então só as duas últimas linhas falham. As 14 tabelas e os seeds entram normalmente e o `GRANT` era redundante — rodar como `root` (passo 4) ou ignorar |
| Cadastro aceita usuário repetido / login do 2º dá "Usuário ou senha incorretos" | falta o `UNIQUE uq_jogadores_nome` neste banco (schema antigo, anterior à constraint). O `login` resolve sempre a linha de menor id, então o 2º cadastro cria uma conta inacessível. Corrigir reaplicando o passo 4, ou deduplicar e aplicar o `ALTER TABLE` |
| Tecla **T** não teleporta para a arena do boss | `DEBUG_COMMANDS` ausente no `server/.env` (passo 6) — comportamento esperado, não bug |
| `Unknown database 'jogo_pi'` | schema não aplicado (passo 4) |
| `Unknown column 'X'` / tabela vazia | schema desatualizado — `db/setup_banco.sql` não foi reaplicado após mudança de schema |
| Mudança de cena não aparece no jogo | cache do navegador — Ctrl+Shift+R |

---

## Estado conhecido das máquinas

| Máquina | node/npm | MySQL engine | Workbench | `node_modules` | `server/.env` | Banco `jogo_pi` |
| --- | --- | --- | --- | --- | --- | --- |
| `dreian` (verificada 2026-10-18) | v22.23.3 / 10.9.9 | 8.0.46 ativo em :3306 | ausente (não é requisito) | ❌ ausente | ❌ ausente | não verificado (sem credenciais) |

Esta máquina precisa dos passos 1, 3, 4 e 5 antes de rodar. A ausência do Workbench **não**
é pendência.
