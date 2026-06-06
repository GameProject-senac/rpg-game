export class Loading extends Phaser.Scene {
    constructor() {
        super('Loading');
    }

    // A função init recebe os dados passados pela cena anterior
    init(data) {
        // Se ninguém avisar para onde ir, o padrão é ir para o Hub_Central
        this.proximoEstado = data.destino || 'HubCentral';
    }

    preload() {
        const largura = this.cameras.main.width;
        const altura = this.cameras.main.height;

        // Textos na vibe Tecno-Mística / Apocalíptica
        this.add.text(largura / 2, altura / 2 - 50, 'DESCRIPTOGRAFANDO RELÍQUIAS DO MUNDO ANTIGO...', { 
            fontFamily: 'Courier', fontSize: '18px', color: '#00ffff' 
        }).setOrigin(0.5);

        const textoPorcentagem = this.add.text(largura / 2, altura / 2, '0%', { 
            fontFamily: 'Courier', fontSize: '24px', color: '#ffffff' 
        }).setOrigin(0.5);

        // Barra de progresso visual
        const caixaBarra = this.add.graphics();
        const preenchimentoBarra = this.add.graphics();
        caixaBarra.lineStyle(2, 0x00ffff, 1);
        caixaBarra.strokeRect(largura / 2 - 150, altura / 2 + 30, 300, 20);

        // EVENTOS REAIS DE CARREGAMENTO DO PHASER
        // O Phaser dispara esse evento 'progress' automaticamente conforme baixa imagens/sons
        this.load.on('progress', function (valor) {
            textoPorcentagem.setText(parseInt(valor * 100) + '%');
            preenchimentoBarra.clear();
            preenchimentoBarra.fillStyle(0x00ffff, 1);
            preenchimentoBarra.fillRect(largura / 2 - 146, altura / 2 + 34, 292 * valor, 12);
        });

        // Como não temos arquivos pesados ainda, vamos forçar um carregamento falso (assets vazios)
        // Só para você ver a barra enchendo na tela!
        for (let i = 0; i < 50; i++) {
            this.load.image('falso_pixel_' + i, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
        }
    }

    create() {
        // Quando o preload termina (100%), o Phaser roda o create automaticamente.
        // Aqui limpamos a memória visual e chamamos a próxima fase!
        this.time.delayedCall(500, () => {
            this.scene.start(this.proximoEstado);
        });
    }
}