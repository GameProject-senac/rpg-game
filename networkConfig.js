/**
 * @file networkConfig.js
 * @description Ponto único de endereço do servidor e formato de envio de mensagens WebSocket.
 * Modelo de conexão atual do projeto é B (socket por cena, ver AGENTS.md §06) — este módulo
 * existe para que a migração futura para o Modelo A (socket único via NetworkManager) não exija
 * caçar endereço/formato espalhados pelas cenas.
 */

export const SERVER_URL = 'ws://localhost:8080';

export function sendMessage(socket, data) {
    socket.send(JSON.stringify(data));
}
