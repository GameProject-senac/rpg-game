# Acesso ao jogo por outros computadores da rede

## Diagnóstico

O cliente WebSocket está fixado em `ws://localhost:8080` em
[`networkConfig.js`](./networkConfig.js). Em cada computador que abre o jogo,
`localhost` aponta para aquele próprio computador. Assim, os computadores
remotos tentam encontrar o WebSocket em si mesmos, em vez de no computador que
executa o servidor do jogo.

O servidor WebSocket usa a porta `8080` em
[`server/server.js`](./server/server.js). O bind agora é explicitamente
`0.0.0.0`, para aceitar conexões pelas interfaces de rede da máquina servidora.
O Firewall do Windows ainda pode bloquear conexões de entrada e deve ser
verificado se o acesso continuar falhando.

## Como selecionar o endereço do servidor

1. No computador que executa o servidor, abra o Prompt de Comando e rode:

   ```text
   ipconfig
   ```

2. Localize o adaptador realmente conectado à mesma rede dos outros
   computadores (normalmente `Wi-Fi` ou `Ethernet`) e anote o `Endereço IPv4`.
   Use o IPv4 privado da rede local, geralmente começando por `192.168.`,
   `10.` ou `172.16` a `172.31`.
3. Não selecione `127.0.0.1`, `localhost`, o gateway, um adaptador desconectado
   ou um adaptador virtual de VPN. Se houver mais de um adaptador conectado e
   não estiver claro qual pertence à rede usada, confirme com o administrador
   da rede antes de escolher.

## Configuração aplicada

[`networkConfig.js`](./networkConfig.js) agora deriva o host do WebSocket do
host usado para abrir a página. Assim, o jogo usa `localhost` quando aberto
localmente e o IPv4 do servidor quando aberto por outro computador:

```js
const SERVER_URL = `ws://${window.location.hostname}:8080`;
```

O comando do servidor HTTP em [`commands.md`](./commands.md) também informa
explicitamente `--bind 0.0.0.0`, permitindo que os demais computadores acessem
a página pela rede local.

## Inicialização e verificação da rede

No computador servidor, mantenha em execução os dois terminais indicados em
[`commands.md`](./commands.md). Nos outros computadores:

1. Abra `http://<IPv4-do-computador-servidor>:8000`.
2. Se a página não carregar, verifique acesso de entrada à porta TCP `8000` no
   Firewall do Windows.
3. Se a página carregar mas o jogo não conectar, verifique no computador remoto
   a porta WebSocket TCP `8080`, por exemplo no PowerShell:

   ```powershell
   Test-NetConnection <IPv4-do-computador-servidor> -Port 8080
   ```

4. Se o teste falhar, permita no Firewall do Windows conexões de entrada TCP
   para as portas necessárias (`8080` para o jogo; `8000` para servir a página),
   restritas ao perfil/rede privada. Não desative o firewall nem exponha a porta
   MySQL `3306` aos clientes.

O `DB_HOST=localhost` no `.env` do servidor não é, por si só, o problema: o
servidor Node acessa o MySQL localmente, enquanto os computadores dos jogadores
se conectam ao Node pela porta `8080`.
