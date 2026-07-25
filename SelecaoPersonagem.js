/**
 * @file SelecaoPersonagem.js
 * @description Cena de seleção de personagem (não é login). Abre uma conexão curta e independente
 * (Modelo B — ver networkConfig.js e AGENTS.md §06) só para pedir a lista de personagens do banco,
 * grava a escolha no registry e encerra. Não compartilha socket com a ExploracaoCombate.
 *
 * Modelo de posse: pool compartilhado sem dono (sem login). A lista mostra todos os personagens;
 * personagens em_uso (já conectados por outra sessão) aparecem desabilitados. Quando o login for
 * implementado, este comportamento muda para filtrar por jogadores_id — ver roadmap_game.md §1.1.
 */

import { SERVER_URL, sendMessage } from './networkConfig.js';

const CONNECT_TIMEOUT_MS = 5000;

export class SelecaoPersonagem extends Phaser.Scene {

    constructor() {
        super('SelecaoPersonagem');
    }

    create() {
        this.resolved = false;
        this.socket = null;

        this.add.text(960, 150, 'SELECIONE SEU PERSONAGEM', {
            fontFamily: 'Arial', fontSize: '32px', color: '#00ffff', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.statusText = this.add.text(960, 250, 'Carregando personagens...', {
            fontFamily: 'Courier', fontSize: '18px', color: '#ffffff'
        }).setOrigin(0.5);

        this.rowsContainer = this.add.container(0, 0);

        this.connectTimer = this.time.delayedCall(CONNECT_TIMEOUT_MS, () => this.handleConnectionFailure());

        this.socket = new WebSocket(SERVER_URL);

        this.socket.onopen = () => {
            sendMessage(this.socket, { type: 'list_characters' });
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'character_list') {
                this.resolved = true;
                if (this.connectTimer) this.connectTimer.remove();
                this.renderList(data.personagens || []);
                this.closeConnection();
            }
        };

        this.socket.onerror = () => this.handleConnectionFailure();
        this.socket.onclose = () => {
            if (!this.resolved) this.handleConnectionFailure();
        };

        this.events.once('shutdown', () => {
            if (this.connectTimer) this.connectTimer.remove();
            this.closeConnection();
            this.rowsContainer.destroy();
        });
    }

    // Falha de conexão (servidor caído, timeout) — separado da falha "lista vazia".
    handleConnectionFailure() {
        if (this.resolved) return;
        this.resolved = true;
        if (this.connectTimer) this.connectTimer.remove();
        this.statusText.setText('Não foi possível conectar ao servidor.');
        this.closeConnection();
    }

    // Fechamento da CONEXÃO — separado do shutdown da CENA (C2). Chamado tanto no caminho feliz
    // quanto no shutdown, e é seguro chamar mais de uma vez.
    closeConnection() {
        if (!this.socket) return;
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
        this.socket = null;
    }

    renderList(personagens) {
        this.rowsContainer.removeAll(true);

        if (personagens.length === 0) {
            this.statusText.setText('Nenhum personagem encontrado.');
            return;
        }

        this.statusText.setText('Clique em um personagem para jogar:');

        const rowHeight = 50;
        const startY = 320;

        personagens.forEach((p, i) => {
            const y = startY + i * (rowHeight + 8);
            const emUso = !!p.em_uso;
            const cor = emUso ? 0x333333 : 0x114455;

            const bg = this.add.rectangle(960, y, 500, rowHeight, cor).setStrokeStyle(1, emUso ? 0x555555 : 0x00ffff);
            const texto = `${p.nome} — ${p.classe} (nível ${p.nivel})` + (emUso ? '  [EM USO]' : '');
            const label = this.add.text(960, y, texto, {
                fontFamily: 'Courier', fontSize: '16px', color: emUso ? '#777777' : '#ffffff'
            }).setOrigin(0.5);

            if (!emUso) {
                bg.setInteractive();
                bg.on('pointerdown', () => this.selecionar(p.id));
            }

            this.rowsContainer.add([bg, label]);
        });
    }

    selecionar(personagemId) {
        this.registry.set('personagem_id', personagemId);
        this.scene.start('Loading', { destino: 'HubCentral' });
    }
}
