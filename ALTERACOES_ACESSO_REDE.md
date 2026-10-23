# Alterações para acesso pela rede local

Este documento resume as mudanças feitas para permitir que outros computadores
na mesma rede acessem o jogo. Para selecionar o endereço IPv4 e testar a
conexão, consulte também o [guia de acesso à rede](./GUIA_ACESSO_REDE.md).

## O que foi alterado

### Endereço WebSocket do cliente

Em [`networkConfig.js`](./networkConfig.js), o endereço do WebSocket deixou de
ser fixo em `ws://localhost:8080`. Agora o cliente usa o host da página:

```js
const serverHost = window.location.hostname || 'localhost';
export const SERVER_URL = `ws://${serverHost}:8080`;
```

Quando a página é aberta no próprio servidor, o cliente usa o host local. Quando
é aberta por outro computador usando o IPv4 do servidor, o WebSocket conecta
nesse mesmo IPv4, na porta `8080`.

### Bind do servidor WebSocket

Em [`server/server.js`](./server/server.js), o servidor foi configurado para
escutar em `0.0.0.0`, em vez de depender do endereço de bind padrão:

```js
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });
```

Isso permite receber conexões pelas interfaces de rede da máquina, mantendo a
porta configurada por `process.env.PORT` ou, localmente, a porta `8080`.

### Servidor HTTP do cliente

Em [`commands.md`](./commands.md), o comando para servir os arquivos da página
agora inclui `--bind 0.0.0.0`. Isso permite que outros computadores carreguem o
cliente pela porta `8000`. O documento também separa a inicialização do Node e
do servidor HTTP em dois terminais e mostra o formato do endereço da página:

```text
http://<IPV4-DO-COMPUTADOR-SERVIDOR>:8000
```

## O que não foi alterado

- A configuração do MySQL e seu endereço local (`DB_HOST=localhost`) não foram
  modificados. O banco continua sendo acessado pelo servidor Node na própria
  máquina.
- Nenhuma regra do Firewall do Windows foi adicionada ou removida. Se a página
  ou o WebSocket continuarem inacessíveis, pode ser necessário permitir as
  portas TCP `8000` e `8080` na rede privada.
- Não foi feita alteração para expor a porta MySQL `3306` aos computadores
  jogadores.

## Validação realizada

A sintaxe de [`server.js`](./server/server.js) e do módulo
[`networkConfig.js`](./networkConfig.js) foi verificada, assim como a formatação
do diff. O acesso efetivo a partir de outro computador ainda precisa ser
confirmado na rede local.
