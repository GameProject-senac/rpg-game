/**
 * @file Login.js
 * @description Cena de autenticação. O usuário é a identidade absoluta do jogador: tudo o que
 * vem depois (lista de personagens, criação, `join`) é escopado pela conta autenticada.
 *
 * Duas ações, na mesma tela: ENTRAR (conta existente) e CRIAR CONTA. Em sucesso, grava o token
 * opaco devolvido pelo servidor no `registry` e segue para a SelecaoPersonagem.
 *
 * Conexões curtas e independentes, uma por ação (Modelo B — ver networkConfig.js). O token é
 * o que carrega a identidade entre essas conexões, já que não existe socket persistente onde
 * guardar a sessão; ver `sessoesAuth` em server/server.js.
 */

import { SERVER_URL, sendMessage } from './networkConfig.js';
import { criarCampoTexto } from './uiTextInput.js';

const CONNECT_TIMEOUT_MS = 5000;

// Espelham USUARIO_*/SENHA_* do server.js, que é a autoridade. Aqui servem só para barrar no
// teclado e dar feedback imediato — a validação que vale é a do servidor.
const USUARIO_MIN_CHARS = 3;
const USUARIO_MAX_CHARS = 22;
const SENHA_MIN_CHARS = 4;
const SENHA_MAX_CHARS = 72;

export class Login extends Phaser.Scene {

    constructor() {
        super('Login');
    }

    create() {
        this.sockets = new Set();
        this.ocupado = false;

        this.add.text(960, 150, 'ACESSO AO MUNDO', {
            fontFamily: 'Arial', fontSize: '34px', color: '#00ffff', fontStyle: 'bold'
        }).setOrigin(0.5);

        // Motivo da volta pra cá (sessão expirada após restart do servidor, por exemplo).
        // Consome e limpa: é informação de uma transição só.
        const motivo = this.registry.get('auth_error');
        if (motivo) {
            this.registry.set('auth_error', null);
            this.add.text(960, 198, motivo, {
                fontFamily: 'Arial', fontSize: '17px', color: '#ff6666',
                backgroundColor: '#00000080', padding: { x: 8, y: 4 }
            }).setOrigin(0.5);
        }

        const painel = this.add.rectangle(960, 460, 700, 330, 0x05161f, 0.98)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(200)
            .setInteractive();
        painel.on('pointerdown', () => this.campoUsuario.focar());

        this.add.text(960, 340, 'USUÁRIO', {
            fontFamily: 'Courier', fontSize: '14px', color: '#88bbaa'
        }).setOrigin(0.5).setDepth(201);
        this.campoUsuario = criarCampoTexto(this, {
            x: 960, y: 374, largura: 480,
            placeholder: 'seu usuário...',
            minLength: USUARIO_MIN_CHARS, maxLength: USUARIO_MAX_CHARS,
            contador: true,
            onEnter: () => this.campoSenha.focar()
        });

        this.add.text(960, 426, 'SENHA', {
            fontFamily: 'Courier', fontSize: '14px', color: '#88bbaa'
        }).setOrigin(0.5).setDepth(201);
        this.campoSenha = criarCampoTexto(this, {
            x: 960, y: 460, largura: 480,
            placeholder: 'sua senha...',
            minLength: SENHA_MIN_CHARS, maxLength: SENHA_MAX_CHARS,
            senha: true,
            onEnter: () => this.entrar()
        });

        this.erroText = this.add.text(960, 502, '', {
            fontFamily: 'Courier', fontSize: '14px', color: '#ff7777'
        }).setOrigin(0.5).setDepth(202);

        this.criarBotao(835, 560, 220, 'ENTRAR', 0x0d3326, 0x00ff88, '#aaffcc', () => this.entrar());
        this.criarBotao(1085, 560, 220, 'CRIAR CONTA', 0x1a2a3a, 0x4499cc, '#aaddff', () => this.criarConta());

        this.add.text(960, 630, `usuário ${USUARIO_MIN_CHARS}-${USUARIO_MAX_CHARS} caracteres  ·  senha mínimo ${SENHA_MIN_CHARS}`, {
            fontFamily: 'Courier', fontSize: '13px', color: '#55776d'
        }).setOrigin(0.5).setDepth(201);

        this.campoUsuario.focar();

        this.events.once('shutdown', () => {
            // Os campos têm <input> no document.body, que o Phaser NÃO recolhe no shutdown da
            // cena — quem abre, fecha (ver uiTextInput.js).
            this.campoUsuario.destruir();
            this.campoSenha.destruir();
            this.sockets.forEach(socket => this.encerrarSocket(socket));
            this.sockets.clear();
        });
    }

    criarBotao(x, y, largura, rotulo, corFundo, corBorda, corTexto, acao) {
        const bg = this.add.rectangle(x, y, largura, 46, corFundo)
            .setStrokeStyle(2, corBorda)
            .setDepth(201)
            .setInteractive({ useHandCursor: true });
        this.add.text(x, y, rotulo, {
            fontFamily: 'Arial', fontSize: '16px', color: corTexto, fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(202);

        bg.on('pointerdown', acao);
        bg.on('pointerover', () => bg.setAlpha(0.75));
        bg.on('pointerout', () => bg.setAlpha(1));
        return bg;
    }

    // ─────────────────────────────────────────────────────────────────
    // REDE — uma conexão curta por ação (Modelo B)
    // ─────────────────────────────────────────────────────────────────

    enviarAcao(payload, tiposEsperados, onResposta) {
        const socket = new WebSocket(SERVER_URL);
        this.sockets.add(socket);

        let resolvido = false;
        const timer = this.time.delayedCall(CONNECT_TIMEOUT_MS, () => finalizar(null));

        const finalizar = (resposta) => {
            if (resolvido) return;
            resolvido = true;
            timer.remove();
            this.encerrarSocket(socket);
            this.sockets.delete(socket);
            onResposta(resposta);
        };

        socket.onopen = () => sendMessage(socket, payload);
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // A conexão pode receber broadcast de mundo antes da resposta (achado A13):
            // ignora o que não for do tipo esperado em vez de tratar como falha.
            if (tiposEsperados.includes(data.type)) finalizar(data);
        };
        socket.onerror = () => finalizar(null);
        socket.onclose = () => finalizar(null);
    }

    encerrarSocket(socket) {
        if (!socket) return;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // AÇÕES
    // ─────────────────────────────────────────────────────────────────

    // Validação local só para feedback imediato; a que vale é a do servidor.
    validarLocal() {
        const usuario = this.campoUsuario.valor();
        const senha = this.campoSenha.valor();
        if (usuario.length < USUARIO_MIN_CHARS) {
            this.erroText.setText(`O usuário precisa ter pelo menos ${USUARIO_MIN_CHARS} caracteres.`);
            this.campoUsuario.focar();
            return null;
        }
        if (senha.length < SENHA_MIN_CHARS) {
            this.erroText.setText(`A senha precisa ter pelo menos ${SENHA_MIN_CHARS} caracteres.`);
            this.campoSenha.focar();
            return null;
        }
        this.erroText.setText('');
        return { usuario, senha };
    }

    entrar() {
        if (this.ocupado) return;
        const credenciais = this.validarLocal();
        if (!credenciais) return;

        this.ocupado = true;
        this.erroText.setColor('#88bbaa').setText('Entrando...');

        this.enviarAcao(
            { type: 'login', ...credenciais },
            ['login_ok', 'login_failed'],
            (resposta) => {
                this.ocupado = false;
                this.erroText.setColor('#ff7777');

                if (!resposta) {
                    this.erroText.setText('Não foi possível conectar ao servidor.');
                    return;
                }
                if (resposta.type === 'login_failed') {
                    this.erroText.setText(resposta.message || 'Usuário ou senha incorretos.');
                    return;
                }

                // Identidade da sessão: o token prova quem somos nas ações seguintes; o nome e
                // o teto de personagens são só para a UI da próxima tela.
                this.registry.set('auth_token', resposta.token);
                this.registry.set('auth_usuario', resposta.usuario);
                this.registry.set('auth_max_personagens', resposta.max_personagens);
                this.scene.start('SelecaoPersonagem');
            }
        );
    }

    criarConta() {
        if (this.ocupado) return;
        const credenciais = this.validarLocal();
        if (!credenciais) return;

        this.ocupado = true;
        this.erroText.setColor('#88bbaa').setText('Criando conta...');

        this.enviarAcao(
            { type: 'register', ...credenciais },
            ['register_ok', 'register_failed'],
            (resposta) => {
                this.ocupado = false;

                if (!resposta) {
                    this.erroText.setColor('#ff7777').setText('Não foi possível conectar ao servidor.');
                    return;
                }
                if (resposta.type === 'register_failed') {
                    this.erroText.setColor('#ff7777').setText(resposta.message || 'Não foi possível criar a conta.');
                    return;
                }

                // Cadastrou: já entra com as mesmas credenciais, pra não obrigar a digitar de
                // novo o que acabou de ser digitado.
                this.erroText.setColor('#88ffbb').setText('Conta criada! Entrando...');
                this.entrar();
            }
        );
    }
}
