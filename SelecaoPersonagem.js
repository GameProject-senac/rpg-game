/**
 * @file SelecaoPersonagem.js
 * @description Seleção/criação de personagem DA CONTA autenticada. Entra-se aqui só com token
 * válido vindo da cena Login — o usuário é a identidade absoluta e nada nesta tela é global.
 *
 * Dois caminhos:
 *  1. LISTA SUSPENSA — os personagens desta conta, com progresso preservado. Fechada por padrão.
 *  2. CRIAR NOVO — um card por classe, com um diálogo de confirmação. O personagem nasce base
 *     (nível 1, XP 0, sem inventário) e herda o NOME DA CONTA — não há campo de nome, o servidor
 *     resolve pelo token (create_character). Limitado a MAX_PERSONAGENS_POR_CONTA, que o servidor
 *     deriva da quantidade de classes (5 hoje); como todos compartilham o nome, o que distingue um
 *     do outro na lista é a classe e o nível.
 *
 * Conexões curtas e independentes, uma por ação (Modelo B — ver networkConfig.js); o token
 * acompanha cada mensagem. Personagem em sessão ativa é omitido pelo servidor em vez de
 * marcado "em uso": quem está ocupado não está disponível, e criar um novo é sempre possível
 * (dentro do teto), então o jogador nunca cai num estado bloqueado.
 */

import { SERVER_URL, sendMessage } from './networkConfig.js';

const CONNECT_TIMEOUT_MS = 5000;

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
        // Reset obrigatório: o Phaser REUSA a instância da cena entre entradas, então a flag
        // ligada no shutdown anterior sobreviveria e a barra da lista nunca mais voltaria ao
        // rótulo fechado ao reentrar nesta tela.
        this.cenaEncerrando = false;

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
            // Marca ANTES de fechar: `fecharDropdown` não pode mexer em texto de GameObject
            // daqui pra frente (ver o porquê no próprio método).
            this.cenaEncerrando = true;
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
        // `cenaEncerrando` barra o setText durante o shutdown. O `?.` abaixo NÃO basta e dava
        // falsa segurança: no shutdown o objeto Text ainda é truthy — quem já morreu é a
        // textura interna dele, destruída pelos sistemas do Phaser, que registram seus
        // listeners de SHUTDOWN ANTES do handler desta cena. O setText então entrava e
        // estourava lá dentro ("Cannot read properties of null (reading 'drawImage')").
        //
        // O estrago não era cosmético: a exceção subia pelo Systems.shutdown e ABORTAVA o
        // SceneManager.stop, então o scene.start() que provocou o shutdown nunca completava.
        // Sintoma: com a lista aberta, clicar num personagem não fazia absolutamente nada —
        // a tela ficava viva e inerte, sem erro visível pro jogador.
        if (this.dropdownAberto && !this.cenaEncerrando) {
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
            bg.on('pointerdown', () => this.abrirDialogoConfirmacao(classe));

            this.elementosLista.push(bg, label);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // CRIAÇÃO
    // ─────────────────────────────────────────────────────────────────

    // Confirmação de criação. Não há mais campo de nome: o personagem herda o nome da CONTA
    // (regra do servidor, ver create_character). O diálogo continua existindo em vez de criar
    // no primeiro clique por dois motivos: evita personagem criado por clique acidental — e o
    // teto é de MAX_PERSONAGENS_POR_CONTA, não dá pra desfazer — e é onde o jogador descobre a
    // regra do nome, que de outro modo só apareceria como fato consumado na lista.
    abrirDialogoConfirmacao(classe) {
        this.fecharDialogo();
        this.fecharDropdown();

        const painel = this.add.rectangle(960, 460, 680, 230, 0x05161f, 0.98)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(200)
            .setInteractive(); // bloqueia cliques nos cards atrás
        const titulo = this.add.text(960, 390, `NOVO ${rotuloDaClasse(classe).toUpperCase()}`, {
            fontFamily: 'Arial', fontSize: '24px', color: '#00ff88', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(201);
        const nomeInfo = this.add.text(960, 436, `vai se chamar  ${this.usuario}`, {
            fontFamily: 'Arial', fontSize: '20px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(201);
        const dica = this.add.text(960, 468, 'todo personagem da conta usa o nome da conta — ENTER confirma, ESC cancela', {
            fontFamily: 'Courier', fontSize: '13px', color: '#88bbaa'
        }).setOrigin(0.5).setDepth(201);

        const botao = this.add.rectangle(960, 528, 220, 44, 0x0d3326)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(201)
            .setInteractive({ useHandCursor: true });
        const botaoLabel = this.add.text(960, 528, 'CRIAR E JOGAR', {
            fontFamily: 'Arial', fontSize: '16px', color: '#aaffcc', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(202);

        const confirmar = () => this.criarPersonagem(classe);
        botao.on('pointerdown', confirmar);
        botao.on('pointerover', () => botao.setFillStyle(0x12523c));
        botao.on('pointerout', () => botao.setFillStyle(0x0d3326));

        // ENTER/ESC saíam de graça no onEnter/onEscape do campo de texto que existia aqui.
        // Sem o campo, o atalho passa a ser da CENA — e por isso precisa de `off` no
        // fecharDialogo: o listener sobreviveria ao diálogo e dispararia num diálogo futuro
        // (ou já destruído) a cada ENTER, criando personagem sem ninguém pedir (§06, item 1).
        const onEnter = () => confirmar();
        const onEsc = () => this.fecharDialogo();
        this.input.keyboard.on('keydown-ENTER', onEnter);
        this.input.keyboard.on('keydown-ESC', onEsc);

        this.dialogo = {
            objetos: [painel, titulo, nomeInfo, dica, botao, botaoLabel],
            atalhos: { onEnter, onEsc }
        };
    }

    fecharDialogo() {
        if (!this.dialogo) return;
        if (this.dialogo.atalhos) {
            this.input.keyboard.off('keydown-ENTER', this.dialogo.atalhos.onEnter);
            this.input.keyboard.off('keydown-ESC', this.dialogo.atalhos.onEsc);
        }
        this.dialogo.objetos.forEach(objeto => objeto.destroy());
        this.dialogo = null;
    }

    // O nome NÃO vai no payload: quem decide é o servidor, a partir do token (create_character).
    // Mandar um `nome` daqui seria ignorado — e passaria a impressão falsa de que o client
    // escolhe.
    criarPersonagem(classe) {
        this.fecharDialogo();
        this.statusText.setText('Criando personagem...');

        this.enviarAcao(
            { type: 'create_character', classe },
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
