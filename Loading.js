import { ensurePlayerAnimations } from './playerAnimations.js';
import { ensureEnemyAnimations } from './enemyAnimations.js';

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
        this.load.on('progress', function (valor) {
            textoPorcentagem.setText(parseInt(valor * 100) + '%');
            preenchimentoBarra.clear();
            preenchimentoBarra.fillStyle(0x00ffff, 1);
            preenchimentoBarra.fillRect(largura / 2 - 146, altura / 2 + 34, 292 * valor, 12);
        });

        this.load.on('loaderror', (fileObj) => {
            console.error('[Loading] ERRO AO CARREGAR ARQUIVO:', fileObj.key, fileObj.src);
        });

        // Garante que o sprite do player seja carregado se ainda não estiver em memória
        if (!this.textures.exists('player')) {
            console.log('[Loading] Carregando spritesheet player...');
            this.load.spritesheet('player', 'assets/sprites/player.png', {
                frameWidth: 48,
                frameHeight: 48
            });
        }

        if (!this.textures.exists('slime')) {
            console.log('[Loading] Carregando spritesheet slime...');
            this.load.spritesheet('slime', 'assets/sprites/slime.png', {
                frameWidth: 32,
                frameHeight: 32
            });
        }

        if (!this.textures.exists('skeleton')) {
            console.log('[Loading] Carregando spritesheet skeleton...');
            this.load.spritesheet('skeleton', 'assets/sprites/skeleton.png', {
                frameWidth: 48,
                frameHeight: 48
            });
        }

        if (!this.textures.exists('portal')) {
            console.log('[Loading] Carregando spritesheet portal...');
            this.load.spritesheet('portal', 'assets/sprites/portal.png', {
                frameWidth: 192,
                frameHeight: 112
            });
        }

        // Carregamento falso para dar tempo da barra animar
        for (let i = 0; i < 20; i++) {
            this.load.image('falso_pixel_' + i, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
        }
    }

    create() {
        ensurePlayerAnimations(this);
        ensureEnemyAnimations(this);

        if (!this.anims.exists('portal-loop') && this.textures.exists('portal')) {
            this.anims.create({
                key: 'portal-loop',
                frames: this.anims.generateFrameNumbers('portal', { start: 0, end: 16 }),
                frameRate: 10,
                repeat: -1
            });
        }

        // Quando o preload termina (100%), o Phaser roda o create automaticamente.
        this.time.delayedCall(500, () => {
            this.scene.start(this.proximoEstado);
        });
    }
}