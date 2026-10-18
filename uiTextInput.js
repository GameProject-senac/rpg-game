/**
 * @file uiTextInput.js
 * @description Campo de texto reutilizável para cenas Phaser (login, senha, nome de personagem).
 *
 * O Phaser não tem input de texto nativo. Este módulo combina as duas metades:
 *
 *  - CAPTURA: um `<input>` real, INVISÍVEL (1px, opacity 0), anexado ao `document.body`. É o que
 *    entrega acentuação/dead key do ABNT2, seleção, colar e teclado mobile — coisas que uma
 *    captura via `scene.input.keyboard` não dá (dead key chega como a string "Dead").
 *  - RENDER: objetos Phaser comuns (`Rectangle` + `Text`), no mesmo pipeline do resto da cena.
 *
 * Por que não `scene.add.dom()`: a factory existe no Phaser 4, mas o container DOM é um `div`
 * posicionado em absoluto sobre o canvas, e o `index.html` insere o canvas direto no `<body>`,
 * que é `display:flex`, `overflow:hidden` e sem `position:relative` — o campo nascia fora da
 * área visível. Com o input invisível a posição dele é irrelevante, e o problema desaparece.
 *
 * Limpeza: `destruir()` remove listeners, timer e o nó do DOM. O `<input>` é filho do
 * `document.body`, NÃO da cena, então o Phaser não o recolhe no shutdown — quem abre, fecha.
 */

const CSS_INPUT_OCULTO = [
    'position:fixed', 'top:0', 'left:0', 'width:1px', 'height:1px',
    'opacity:0', 'border:0', 'padding:0', 'margin:0', 'z-index:-1'
].join(';');

/**
 * @param {Phaser.Scene} scene
 * @param {object} config
 * @param {number} config.x            centro horizontal do campo
 * @param {number} config.y            centro vertical do campo
 * @param {number} [config.largura]    largura da moldura em px
 * @param {string} [config.placeholder] texto exibido com o campo vazio
 * @param {number} [config.maxLength]  limite de caracteres (barra no teclado)
 * @param {number} [config.minLength]  mínimo — usado só pela cor do contador
 * @param {boolean} [config.senha]     true mascara o valor com bolinhas
 * @param {boolean} [config.contador]  true exibe "n/max" à direita
 * @param {number} [config.depth]      depth base dos objetos
 * @param {Function} [config.onEnter]  callback do ENTER
 * @param {Function} [config.onEscape] callback do ESC
 */
export function criarCampoTexto(scene, config) {
    const {
        x, y, largura = 460, placeholder = '', maxLength = 64, minLength = 0,
        senha = false, contador = false, depth = 201, onEnter, onEscape
    } = config;

    const moldura = scene.add.rectangle(x, y, largura, 48, 0x0b2b22)
        .setStrokeStyle(2, 0x2f7f66)
        .setDepth(depth)
        .setInteractive({ useHandCursor: true });

    const texto = scene.add.text(x, y, '', {
        fontFamily: 'Courier', fontSize: '20px', color: '#ffffff'
    }).setOrigin(0.5).setDepth(depth + 1);

    const contadorTexto = contador
        ? scene.add.text(x + largura / 2 - 10, y, '', {
            fontFamily: 'Courier', fontSize: '13px', color: '#5f8f7f'
        }).setOrigin(1, 0.5).setDepth(depth + 1)
        : null;

    const campo = document.createElement('input');
    campo.type = senha ? 'password' : 'text';
    campo.maxLength = maxLength;
    campo.setAttribute('autocomplete', 'off');
    campo.setAttribute('autocorrect', 'off');
    campo.setAttribute('spellcheck', 'false');
    campo.style.cssText = CSS_INPUT_OCULTO;
    document.body.appendChild(campo);

    let caretVisivel = true;
    let focado = false;

    const redesenhar = () => {
        const valor = campo.value;
        const exibido = senha ? '•'.repeat(valor.length) : valor;
        const caret = (focado && caretVisivel) ? '|' : '';

        if (valor.length === 0 && !focado) {
            texto.setText(placeholder).setColor('#3f6f5f');
        } else if (valor.length === 0) {
            texto.setText(caret || ' ').setColor('#ffffff');
        } else {
            texto.setText(exibido + caret).setColor('#ffffff');
        }

        moldura.setStrokeStyle(2, focado ? 0x00ff88 : 0x2f7f66);

        if (contadorTexto) {
            const n = valor.trim().length;
            contadorTexto.setText(`${n}/${maxLength}`);
            contadorTexto.setColor(n > 0 && n < minLength ? '#ff7777' : '#5f8f7f');
        }
    };

    // Timer pela API da cena: o Phaser destrói TimerEvent pendente no shutdown
    // (AGENTS.md §06) — nunca setInterval cru dentro de uma cena.
    const caretTimer = scene.time.addEvent({
        delay: 500, loop: true,
        callback: () => { caretVisivel = !caretVisivel; redesenhar(); }
    });

    const onInput = () => redesenhar();
    const onFocus = () => { focado = true; redesenhar(); };
    const onBlur = () => { focado = false; redesenhar(); };
    const onKey = (evento) => {
        if (evento.key === 'Enter') { evento.preventDefault(); onEnter?.(); }
        else if (evento.key === 'Escape') { evento.preventDefault(); onEscape?.(); }
    };

    campo.addEventListener('input', onInput);
    campo.addEventListener('focus', onFocus);
    campo.addEventListener('blur', onBlur);
    campo.addEventListener('keydown', onKey);

    // Clicar no canvas rouba o foco do input invisível; clicar na moldura devolve, pra não
    // parecer que o campo "parou de funcionar".
    moldura.on('pointerdown', () => campo.focus());

    redesenhar();

    return {
        moldura,
        texto,
        objetos: contadorTexto ? [moldura, texto, contadorTexto] : [moldura, texto],
        valor: () => campo.value.trim(),
        definirValor: (v) => { campo.value = v ?? ''; redesenhar(); },
        focar: () => campo.focus(),
        destruir() {
            // Ordem importa: tira o timer e os listeners ANTES de remover o nó e destruir os
            // objetos, senão o callback do caret dispara sobre objeto já destruído.
            caretTimer.remove();
            campo.removeEventListener('input', onInput);
            campo.removeEventListener('focus', onFocus);
            campo.removeEventListener('blur', onBlur);
            campo.removeEventListener('keydown', onKey);
            campo.remove();
            this.objetos.forEach(objeto => objeto.destroy());
        }
    };
}
