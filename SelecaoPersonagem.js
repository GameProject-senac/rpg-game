/**
 * @file SelecaoPersonagem.js
 * @description Seleção/criação de personagem DA CONTA autenticada. Entra-se aqui só com token
 * válido vindo da cena Login — o usuário é a identidade absoluta e nada nesta tela é global.
 *
 * Dois caminhos:
 *  1. LISTA SUSPENSA — os personagens desta conta, com progresso preservado. Fechada por padrão.
 *  2. CRIAR NOVO — um card por classe. O personagem nasce base (nível 1, XP 0, sem inventário),
 *     com nome digitado (3-22). Limitado a MAX_PERSONAGENS_POR_CONTA, que o servidor deriva da
 *     quantidade de classes (5 hoje).
 *
 * Conexões curtas e independentes, uma por ação (Modelo B — ver networkConfig.js); o token
 * acompanha cada mensagem. Personagem em sessão ativa é omitido pelo servidor em vez de
 * marcado "em uso": quem está ocupado não está disponível, e criar um novo é sempre possível
 * (dentro do teto), então o jogador nunca cai num estado bloqueado.
 */

import { SERVER_URL, sendMessage } from './networkConfig.js';
import { criarCampoTexto } from './uiTextInput.js';

const CONNECT_TIMEOUT_MS = 5000;

// Espelham NOME_MIN_CHARS/NOME_MAX_CHARS do server.js, que é a autoridade.
const NOME_MIN_CHARS = 3;
const NOME_MAX_CHARS = 22;

// Só apresentação — a lista de classes válidas vem do servidor (CLASSES em server.js é a
// fonte única); isto apenas embeleza o nome na tela.
const ROTULO_CLASSE = {
    guerreiro: 'Guerreiro',
    mago: 'Mago',
    arqueiro: 'Arqueiro',
    suporte: 'Suporte',
    tanque: 'Tanque'
};

function rotuloDaClasse(classe) {
    return ROTULO_CLASSE[classe] ?? (classe.charAt(0).toUpperCase() + classe.slice(1));
}

export class SelecaoPersonagem extends Phaser.Scene {

    constructor() {
        super('SelecaoPersonagem');
    }

    create() {
        this.sockets = new Set();
        this.elementosLista = [];
        this.elementosDropdown = [];
        this.dialogo = null;
        this.personagens = [];
        this.classes = [];
        this.dropdownAberto = false;

        this.token = this.registry.get('auth_token');
        this.usuario = this.registry.get('auth_usuario');
        this.maxPersonagens = this.registry.get('auth_max_personagens') ?? 5;

        // Entrar aqui sem token é estado inválido (recarregou a página direto nesta cena, ou
        // o servidor reiniciou e perdeu as sessões em memória). Volta pro login em vez de
        // montar uma tela que não consegue carregar nada.
        if (!this.token) {
            this.registry.set('auth_error', 'Faça login para continuar.');
            this.scene.start('Login');
            return;
        }

        this.add.text(960, 80, 'SEUS PERSONAGENS', {
            fontFamily: 'Arial', fontSize: '32px', color: '#00ffff', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.contaText = this.add.text(960, 126, `conta: ${this.usuario}`, {
            fontFamily: 'Courier', fontSize: '16px', color: '#88bbaa'
        }).setOrigin(0.5);

        this.statusText = this.add.text(960, 160, 'Carregando...', {
            fontFamily: 'Courier', fontSize: '16px', color: '#ffffff'
        }).setOrigin(0.5);

        this.criarBotao(1760, 80, 180, 36, 'SAIR DA CONTA', 0x3a1a1a, 0xcc5555, '#ffaaaa', () => this.sair());

        this.feedbackText = this.add.text(960, 880, '', {
            fontFamily: 'Arial', fontSize: '17px', color: '#ffcc00',
            backgroundColor: '#00000080', padding: { x: 8, y: 4 }
        }).setOrigin(0.5);

        this.carregarLista();

        this.events.once('shutdown', () => {
            this.fecharDialogo();
            this.fecharDropdown();
            this.limparLista();
            this.sockets.forEach(socket => this.encerrarSocket(socket));
            this.sockets.clear();
        });
    }

    criarBotao(x, y, largura, altura, rotulo, corFundo, corBorda, corTexto, acao) {
        const bg = this.add.rectangle(x, y, largura, altura, corFundo)
            .setStrokeStyle(2, corBorda)
            .setInteractive({ useHandCursor: true });
        const label = this.add.text(x, y, rotulo, {
            fontFamily: 'Arial', fontSize: '14px', color: corTexto, fontStyle: 'bold'
        }).setOrigin(0.5);
        bg.on('pointerdown', acao);
        bg.on('pointerover', () => bg.setAlpha(0.75));
        bg.on('pointerout', () => bg.setAlpha(1));
        return { bg, label };
    }

    sair() {
        this.registry.set('auth_token', null);
        this.registry.set('auth_usuario', null);
        this.scene.start('Login');
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

        socket.onopen = () => sendMessage(socket, { ...payload, token: this.token });
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // `auth_required` pode responder a qualquer ação (sessão expirada por restart do
            // servidor), então é sempre aceito além dos tipos pedidos.
            if (tiposEsperados.includes(data.type) || data.type === 'auth_required') finalizar(data);
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

    // Sessão expirada em qualquer ação: volta pro login com o motivo.
    tratarAuthExpirada(resposta) {
        if (resposta?.type !== 'auth_required') return false;
        this.registry.set('auth_error', resposta.message || 'Sessão expirada. Faça login novamente.');
        this.registry.set('auth_token', null);
        this.scene.start('Login');
        return true;
    }

    carregarLista() {
        this.enviarAcao({ type: 'list_characters' }, ['character_list'], (resposta) => {
            if (this.tratarAuthExpirada(resposta)) return;
            if (!resposta) {
                this.statusText.setText('Não foi possível conectar ao servidor.');
                return;
            }
            this.personagens = resposta.personagens || [];
            this.classes = resposta.classes || [];
            if (resposta.max_personagens) this.maxPersonagens = resposta.max_personagens;
            if (resposta.usuario) {
                this.usuario = resposta.usuario;
                this.contaText.setText(`conta: ${this.usuario}`);
            }
            this.renderList();
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────

    limparLista() {
        this.elementosLista.forEach(elemento => elemento.destroy());
        this.elementosLista = [];
    }

    renderList() {
        this.limparLista();
        this.fecharDropdown();

        const usados = this.personagens.length;
        const noLimite = usados >= this.maxPersonagens;

        this.statusText.setText(`personagens: ${usados}/${this.maxPersonagens}`);
        this.renderDropdown(250);
        this.renderCriacao(430, noLimite);
    }

    // Lista SUSPENSA: barra fechada por padrão, expande sob demanda (decisão do dono do
    // projeto). Mantém a tela curta independente de quantos personagens a conta tenha.
    renderDropdown(y) {
        const titulo = this.add.text(960, y, 'RETOMAR PERSONAGEM', {
            fontFamily: 'Arial', fontSize: '20px', color: '#00ffff', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.elementosLista.push(titulo);

        if (this.personagens.length === 0) {
            const vazio = this.add.text(960, y + 50,
                'Nenhum personagem nesta conta. Crie um abaixo para começar.', {
                fontFamily: 'Courier', fontSize: '15px', color: '#888888'
            }).setOrigin(0.5);
            this.elementosLista.push(vazio);
            return;
        }

        this.dropdownY = y + 56;
        const barra = this.add.rectangle(960, this.dropdownY, 620, 48, 0x114455)
            .setStrokeStyle(2, 0x00ffff)
            .setDepth(50)
            .setInteractive({ useHandCursor: true });
        this.dropdownLabel = this.add.text(960, this.dropdownY,
            `Selecione um personagem  (${this.personagens.length})   ▾`, {
            fontFamily: 'Courier', fontSize: '16px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(51);

        barra.on('pointerdown', () => this.alternarDropdown());
        barra.on('pointerover', () => barra.setFillStyle(0x1a6680));
        barra.on('pointerout', () => barra.setFillStyle(0x114455));

        this.elementosLista.push(barra, this.dropdownLabel);
    }

    alternarDropdown() {
        if (this.dropdownAberto) this.fecharDropdown();
        else this.abrirDropdown();
    }

    abrirDropdown() {
        this.fecharDropdown();
        this.dropdownAberto = true;
        this.dropdownLabel?.setText(`Selecione um personagem  (${this.personagens.length})   ▴`);

        const alturaItem = 42;
        this.personagens.forEach((personagem, indice) => {
            const itemY = this.dropdownY + 32 + indice * alturaItem;

            // Depth alto: a lista aberta passa POR CIMA dos cards de criação que ficam abaixo.
            const bg = this.add.rectangle(960, itemY, 620, alturaItem - 4, 0x0d3340)
                .setStrokeStyle(1, 0x2f9fbf)
                .setDepth(60)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(960, itemY,
                `${personagem.nome}  —  ${rotuloDaClasse(personagem.classe)}  ·  nível ${personagem.nivel}`, {
                fontFamily: 'Courier', fontSize: '15px', color: '#dff6ff'
            }).setOrigin(0.5).setDepth(61);

            bg.on('pointerover', () => bg.setFillStyle(0x1a6680));
            bg.on('pointerout', () => bg.setFillStyle(0x0d3340));
            bg.on('pointerdown', () => this.selecionar(personagem.id));

            this.elementosDropdown.push(bg, label);
        });
    }

    fecharDropdown() {
        this.elementosDropdown.forEach(elemento => elemento.destroy());
        this.elementosDropdown = [];
        if (this.dropdownAberto) {
            this.dropdownLabel?.setText(`Selecione um personagem  (${this.personagens.length})   ▾`);
        }
        this.dropdownAberto = false;
    }

    renderCriacao(y, noLimite) {
        const titulo = this.add.text(960, y, 'CRIAR NOVO PERSONAGEM', {
            fontFamily: 'Arial', fontSize: '20px', color: noLimite ? '#666666' : '#00ff88', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.elementosLista.push(titulo);

        if (noLimite) {
            const aviso = this.add.text(960, y + 46,
                `Limite de ${this.maxPersonagens} personagens por conta atingido.`, {
                fontFamily: 'Courier', fontSize: '15px', color: '#ffaa66'
            }).setOrigin(0.5);
            this.elementosLista.push(aviso);
            return;
        }

        const larguraCard = 300;
        const espaco = 20;
        const total = this.classes.length;
        const larguraTotal = total * larguraCard + (total - 1) * espaco;
        const inicioX = 960 - larguraTotal / 2 + larguraCard / 2;

        this.classes.forEach((classe, indice) => {
            const x = inicioX + indice * (larguraCard + espaco);
            const cardY = y + 70;

            const bg = this.add.rectangle(x, cardY, larguraCard, 70, 0x0d3326)
                .setStrokeStyle(2, 0x00ff88)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(x, cardY, `+ ${rotuloDaClasse(classe)}`, {
                fontFamily: 'Arial', fontSize: '22px', color: '#aaffcc', fontStyle: 'bold'
            }).setOrigin(0.5);

            bg.on('pointerover', () => bg.setFillStyle(0x12523c));
            bg.on('pointerout', () => bg.setFillStyle(0x0d3326));
            bg.on('pointerdown', () => this.abrirDialogoNome(classe));

            this.elementosLista.push(bg, label);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // CRIAÇÃO
    // ─────────────────────────────────────────────────────────────────

    abrirDialogoNome(classe) {
        this.fecharDialogo();
        this.fecharDropdown();

        const painel = this.add.rectangle(960, 460, 680, 250, 0x05161f, 0.98)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(200)
            .setInteractive(); // bloqueia cliques nos cards atrás
        const titulo = this.add.text(960, 378, `NOVO ${rotuloDaClasse(classe).toUpperCase()}`, {
            fontFamily: 'Arial', fontSize: '24px', color: '#00ff88', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(201);
        const dica = this.add.text(960, 412, 'Digite o nome do personagem — ENTER confirma, ESC cancela', {
            fontFamily: 'Courier', fontSize: '14px', color: '#88bbaa'
        }).setOrigin(0.5).setDepth(201);
        const erro = this.add.text(960, 498, '', {
            fontFamily: 'Courier', fontSize: '14px', color: '#ff7777'
        }).setOrigin(0.5).setDepth(202);

        // Campo vazio, sem sugestão pré-preenchida: o nome é o que identifica quem é quem
        // (decisão do dono do projeto), então o jogador tem que digitar — um campo já
        // preenchido deixaria passar um nome automático que ninguém escolheu.
        const campo = criarCampoTexto(this, {
            x: 960, y: 452, largura: 500,
            placeholder: `nome do seu ${rotuloDaClasse(classe).toLowerCase()}...`,
            minLength: NOME_MIN_CHARS, maxLength: NOME_MAX_CHARS,
            contador: true, depth: 201,
            onEnter: () => confirmar(),
            onEscape: () => this.fecharDialogo()
        });

        const botao = this.add.rectangle(960, 542, 220, 44, 0x0d3326)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(201)
            .setInteractive({ useHandCursor: true });
        const botaoLabel = this.add.text(960, 542, 'CRIAR E JOGAR', {
            fontFamily: 'Arial', fontSize: '16px', color: '#aaffcc', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(202);

        const confirmar = () => {
            const nome = campo.valor();
            if (nome.length < NOME_MIN_CHARS) {
                erro.setText(`O nome precisa ter pelo menos ${NOME_MIN_CHARS} caracteres.`);
                campo.focar();
                return;
            }
            this.criarPersonagem(classe, nome);
        };

        botao.on('pointerdown', confirmar);
        botao.on('pointerover', () => botao.setFillStyle(0x12523c));
        botao.on('pointerout', () => botao.setFillStyle(0x0d3326));
        painel.on('pointerdown', () => campo.focar());

        this.dialogo = { objetos: [painel, titulo, dica, erro, botao, botaoLabel], campo };
        campo.focar();
    }

    fecharDialogo() {
        if (!this.dialogo) return;
        // O campo tem <input> no document.body, que o Phaser não recolhe no shutdown da cena.
        this.dialogo.campo.destruir();
        this.dialogo.objetos.forEach(objeto => objeto.destroy());
        this.dialogo = null;
    }

    criarPersonagem(classe, nomeDigitado) {
        const nome = String(nomeDigitado ?? '').trim();
        if (nome.length < NOME_MIN_CHARS) {
            this.mostrarFeedback(`O nome precisa ter pelo menos ${NOME_MIN_CHARS} caracteres.`);
            return;
        }

        this.fecharDialogo();
        this.statusText.setText('Criando personagem...');

        this.enviarAcao(
            { type: 'create_character', classe, nome },
            ['character_created', 'character_create_failed'],
            (resposta) => {
                if (this.tratarAuthExpirada(resposta)) return;
                if (!resposta) {
                    this.statusText.setText('Não foi possível conectar ao servidor.');
                    return;
                }
                if (resposta.type === 'character_create_failed') {
                    this.renderList();
                    this.mostrarFeedback(resposta.message || 'Não foi possível criar o personagem.');
                    return;
                }
                // Criado: entra direto com ele, sem passar pela lista de novo.
                this.selecionar(resposta.id);
            }
        );
    }

    mostrarFeedback(mensagem) {
        this.feedbackText.setText(mensagem);
        if (this.feedbackTimer) this.feedbackTimer.remove();
        this.feedbackTimer = this.time.delayedCall(4000, () => this.feedbackText.setText(''));
    }

    selecionar(personagemId) {
        this.registry.set('personagem_id', personagemId);
        this.scene.start('Loading', { destino: 'HubCentral' });
    }
}
