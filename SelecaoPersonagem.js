/**
 * @file SelecaoPersonagem.js
 * @description Seleção/criação de personagem DA CONTA autenticada. Entra-se aqui só com token
 * válido vindo da cena Login — o usuário é a identidade absoluta e nada nesta tela é global.
 *
 * UMA CONTA = UM PERSONAGEM (decisão do dono do projeto, imposta pelo banco via
 * `uq_personagem_por_conta`). A tela tem dois estados EXCLUDENTES:
 *
 *  1. SEM PERSONAGEM — os cards de classe. A escolha vale para toda a conta; o personagem
 *     nasce base (nível 1, XP 0, sem inventário) e herda o NOME DA CONTA. Não há campo de
 *     nome: o servidor resolve pelo token (create_character), e um `nome` vindo daqui seria
 *     ignorado.
 *  2. COM PERSONAGEM — o painel dele, com JOGAR e RESETAR. RESETAR apaga o personagem
 *     (reset_character) e devolve a tela ao estado 1, com a classe livre pra mudar.
 *
 * Não existe mais lista suspensa: ela só fazia sentido com teto de 5 personagens. Com um só,
 * uma barra que precisava ser clicada pra revelar um único item era atrito puro — e foi onde
 * o jogador ficou preso (ver também o crash de shutdown, commit 6ccfb46).
 *
 * Conexões curtas e independentes, uma por ação (Modelo B — ver networkConfig.js); o token
 * acompanha cada mensagem. Personagem numa partida aberta vem MARCADO (`em_sessao`) em vez de
 * omitido: com um personagem por conta, escondê-lo deixaria a tela sem nenhuma ação possível.
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
        this.dialogo = null;
        this.personagens = [];
        this.classes = [];

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
            // ⚠️ Daqui pra frente, SÓ destruir — nunca `setText`/`setFillStyle` em GameObject.
            // No shutdown o objeto ainda é truthy (o `?.` não salva), mas a textura interna já
            // foi destruída pelos sistemas do Phaser, que registram seus listeners de SHUTDOWN
            // ANTES deste. Um setText aqui estoura dentro do Phaser, a exceção sobe pelo
            // Systems.shutdown e ABORTA o SceneManager.stop — o scene.start() que provocou o
            // shutdown nunca completa, e a tela fica viva e inerte, sem erro visível. Foi
            // exatamente o bug da lista suspensa (commit 6ccfb46).
            this.fecharDialogo();
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

    // DUAS TELAS EXCLUDENTES, nunca as duas juntas: ou a conta TEM personagem (painel dele,
    // com JOGAR e RESETAR) ou NÃO TEM (os cards de classe). Não existe mais lista suspensa —
    // ela só fazia sentido quando a conta podia ter 5 personagens; com um só, uma barra que
    // precisa ser clicada pra revelar um unico item era puro atrito, e era onde o jogador
    // ficava preso sem perceber que havia algo a expandir.
    renderList() {
        this.limparLista();

        const personagem = this.personagens[0] ?? null;
        this.statusText.setText(personagem
            ? `${rotuloDaClasse(personagem.classe)}  ·  nível ${personagem.nivel}`
            : 'Escolha uma classe para começar');

        if (personagem) this.renderPersonagem(300, personagem);
        else this.renderCriacao(300);
    }

    // Painel do personagem único da conta. `em_sessao` vem do servidor (list_characters) e
    // significa que ESTE personagem está numa partida aberta agora — provavelmente outra aba
    // ou uma sessão que não fechou direito. Nesse caso JOGAR é barrado aqui porque o `join`
    // seria recusado pelo servidor de qualquer forma (código 4000); barrar com o motivo na
    // tela é melhor do que deixar tentar e cair numa falha de conexão sem explicação.
    renderPersonagem(y, personagem) {
        const emSessao = personagem.em_sessao === true;

        const painel = this.add.rectangle(960, y + 70, 700, 190, 0x071d26, 0.9)
            .setStrokeStyle(2, 0x00ffff);
        const nome = this.add.text(960, y + 18, personagem.nome, {
            fontFamily: 'Arial', fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5);
        const info = this.add.text(960, y + 58,
            `${rotuloDaClasse(personagem.classe)}  ·  nível ${personagem.nivel}`, {
            fontFamily: 'Courier', fontSize: '18px', color: '#88ddee'
        }).setOrigin(0.5);
        this.elementosLista.push(painel, nome, info);

        const jogar = this.criarBotao(
            860, y + 120, 200, 48,
            emSessao ? 'EM PARTIDA' : 'JOGAR',
            emSessao ? 0x2a2a2a : 0x0d3326,
            emSessao ? 0x666666 : 0x00ff88,
            emSessao ? '#888888' : '#aaffcc',
            () => {
                if (emSessao) {
                    this.mostrarFeedback('Este personagem já está numa partida aberta. Feche a outra aba e recarregue.');
                    return;
                }
                this.selecionar(personagem.id);
            }
        );
        const resetar = this.criarBotao(
            1080, y + 120, 200, 48, 'RESETAR', 0x3a1a1a, 0xcc5555, '#ffaaaa',
            () => this.abrirDialogoReset(personagem)
        );
        this.elementosLista.push(jogar.bg, jogar.label, resetar.bg, resetar.label);

        const explicacao = this.add.text(960, y + 170,
            'RESETAR apaga este personagem e devolve a escolha de classe — nível, XP e itens são perdidos.', {
            fontFamily: 'Courier', fontSize: '13px', color: '#997777'
        }).setOrigin(0.5);
        this.elementosLista.push(explicacao);
    }

    // Só aparece quando a conta NÃO tem personagem. O antigo ramo "limite atingido" sumiu:
    // com personagem, quem aparece é o painel dele — nunca os cards com um aviso de recusa.
    renderCriacao(y) {
        const titulo = this.add.text(960, y, 'ESCOLHA SUA CLASSE', {
            fontFamily: 'Arial', fontSize: '20px', color: '#00ff88', fontStyle: 'bold'
        }).setOrigin(0.5);
        const aviso = this.add.text(960, y + 34,
            'a escolha vale para toda a conta — para trocar depois, só resetando o personagem', {
            fontFamily: 'Courier', fontSize: '13px', color: '#779988'
        }).setOrigin(0.5);
        this.elementosLista.push(titulo, aviso);

        const larguraCard = 300;
        const espaco = 20;
        const total = this.classes.length;
        const larguraTotal = total * larguraCard + (total - 1) * espaco;
        const inicioX = 960 - larguraTotal / 2 + larguraCard / 2;

        this.classes.forEach((classe, indice) => {
            const x = inicioX + indice * (larguraCard + espaco);
            const cardY = y + 100;

            const bg = this.add.rectangle(x, cardY, larguraCard, 70, 0x0d3326)
                .setStrokeStyle(2, 0x00ff88)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(x, cardY, rotuloDaClasse(classe), {
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

    // Confirmação de criação. Existe em vez de criar no primeiro clique porque a CLASSE é
    // escolhida uma vez só: trocar depois exige resetar, o que apaga o personagem inteiro.
    // Um clique acidental num card custaria caro, então a confirmação paga o próprio atrito.
    abrirDialogoConfirmacao(classe) {
        this.fecharDialogo();

        const painel = this.add.rectangle(960, 460, 680, 230, 0x05161f, 0.98)
            .setStrokeStyle(2, 0x00ff88)
            .setDepth(200)
            .setInteractive(); // bloqueia cliques nos cards atrás
        const titulo = this.add.text(960, 390, `NOVO ${rotuloDaClasse(classe).toUpperCase()}`, {
            fontFamily: 'Arial', fontSize: '24px', color: '#00ff88', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(201);
        const dica = this.add.text(960, 440, 'esta classe vale para toda a conta — ENTER confirma, ESC cancela', {
            fontFamily: 'Courier', fontSize: '14px', color: '#88bbaa'
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
            objetos: [painel, titulo, dica, botao, botaoLabel],
            atalhos: { onEnter, onEsc }
        };
    }

    fecharDialogo() {
        if (!this.dialogo) return;
        // Cada diálogo registra só os atalhos que usa (o de reset não tem ENTER de
        // propósito), então remove-se condicionalmente — um `off` com handler undefined
        // removeria TODOS os listeners daquela tecla, inclusive de terceiros.
        const atalhos = this.dialogo.atalhos;
        if (atalhos?.onEnter) this.input.keyboard.off('keydown-ENTER', atalhos.onEnter);
        if (atalhos?.onEsc) this.input.keyboard.off('keydown-ESC', atalhos.onEsc);
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

    // ─────────────────────────────────────────────────────────────────
    // RESET
    // ─────────────────────────────────────────────────────────────────

    // Confirmação OBRIGATÓRIA e deliberadamente desconfortável: o reset é destrutivo e
    // irreversível — o servidor APAGA a linha do personagem, e o ON DELETE CASCADE leva o
    // inventário junto. Nada de "desfazer". Por isso o diálogo enuncia o que se perde, e o
    // botão de confirmar não é o caminho mais fácil (ESC/CANCELAR é o padrão seguro).
    abrirDialogoReset(personagem) {
        this.fecharDialogo();

        const painel = this.add.rectangle(960, 460, 760, 250, 0x1f0707, 0.98)
            .setStrokeStyle(2, 0xcc5555)
            .setDepth(200)
            .setInteractive();
        const titulo = this.add.text(960, 372, 'RESETAR PERSONAGEM?', {
            fontFamily: 'Arial', fontSize: '24px', color: '#ff8888', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(201);
        const alvoTexto = this.add.text(960, 412,
            `${personagem.nome}  —  ${rotuloDaClasse(personagem.classe)}  ·  nível ${personagem.nivel}`, {
            fontFamily: 'Courier', fontSize: '17px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(201);
        const perdas = this.add.text(960, 452,
            'Nível, XP e todos os itens serão apagados. Não há como desfazer.', {
            fontFamily: 'Courier', fontSize: '14px', color: '#ffaaaa'
        }).setOrigin(0.5).setDepth(201);
        const dica = this.add.text(960, 480, 'depois você escolhe a classe de novo, do zero — ESC cancela', {
            fontFamily: 'Courier', fontSize: '13px', color: '#aa8888'
        }).setOrigin(0.5).setDepth(201);

        const confirmar = this.criarBotao(860, 536, 220, 46, 'APAGAR E RECOMEÇAR',
            0x5a1a1a, 0xff6666, '#ffdddd', () => this.resetarPersonagem());
        confirmar.bg.setDepth(201); confirmar.label.setDepth(202);
        const cancelar = this.criarBotao(1100, 536, 160, 46, 'CANCELAR',
            0x1a2a2a, 0x66aaaa, '#cceeee', () => this.fecharDialogo());
        cancelar.bg.setDepth(201); cancelar.label.setDepth(202);

        // Só ESC tem atalho. ENTER de propósito NÃO confirma: num diálogo destrutivo, a tecla
        // que o jogador aperta no reflexo não pode ser a que apaga o personagem.
        const onEsc = () => this.fecharDialogo();
        this.input.keyboard.on('keydown-ESC', onEsc);

        this.dialogo = {
            objetos: [painel, titulo, alvoTexto, perdas, dica,
                      confirmar.bg, confirmar.label, cancelar.bg, cancelar.label],
            atalhos: { onEsc }
        };
    }

    resetarPersonagem() {
        this.fecharDialogo();
        this.statusText.setText('Resetando...');

        this.enviarAcao(
            { type: 'reset_character' },
            ['character_reset', 'character_reset_failed'],
            (resposta) => {
                if (this.tratarAuthExpirada(resposta)) return;
                if (!resposta) {
                    this.statusText.setText('Não foi possível conectar ao servidor.');
                    return;
                }
                if (resposta.type === 'character_reset_failed') {
                    // Caso real: o personagem está em sessão ativa (outra aba). O servidor
                    // recusa, e recarregar a lista traz o `em_sessao` que explica a tela.
                    this.carregarLista();
                    this.mostrarFeedback(resposta.message || 'Não foi possível resetar.');
                    return;
                }
                // Apagado: recarrega e a tela cai sozinha no estado "escolha sua classe".
                this.carregarLista();
                this.mostrarFeedback('Personagem apagado. Escolha uma classe para recomeçar.');
            }
        );
    }

    mostrarFeedback(mensagem) {
        this.feedbackText.setText(mensagem);
        if (this.feedbackTimer) this.feedbackTimer.remove();
        this.feedbackTimer = this.time.delayedCall(4000, () => this.feedbackText.setText(''));
    }

    // Entra DIRETO no jogo. Antes passava pelo HubCentral, que é um stub de 23 linhas: só
    // desenha texto e espera ENTER, sem nunca conectar ao servidor. Na prática o jogador
    // escolhia o personagem e caía numa tela que parecia travada — e era pra lá que a morte
    // também devolvia. O Hub segue existindo e alcançável pelo ESC do combate; o que saiu foi
    // ele estar no caminho de ENTRADA, onde não acrescentava nada e só criava um beco.
    selecionar(personagemId) {
        this.registry.set('personagem_id', personagemId);
        this.scene.start('Loading', { destino: 'ExploracaoCombate' });
    }
}
