import { ensurePlayerAnimations } from './playerAnimations.js';
import { ensureEnemyAnimations } from './enemyAnimations.js';

export class Preload extends Phaser.Scene {
    constructor() {
        super('Preload');
    }

    preload() {
        console.log('[Preload] Carregando assets do jogo...');
        this.add.text(960, 300, 'Carregando Sistema...', { 
            fontFamily: 'Courier', fontSize: '24px', color: '#00ffff' 
        }).setOrigin(0.5);

        this.load.on('loaderror', (fileObj) => {
            console.error('[Preload] ERRO AO CARREGAR ARQUIVO:', fileObj.key, fileObj.src);
        });

        // Assets do Player (48x48)
        this.load.spritesheet('player', 'assets/sprites/player.png', {
            frameWidth: 48,
            frameHeight: 48
        });

        // Assets dos Inimigos
        // Slime: 32x32 (Comum e Fraco)
        this.load.spritesheet('slime', 'assets/sprites/slime.png', {
            frameWidth: 32,
            frameHeight: 32
        });

        // Skeleton: 48x48 (Medio, Forte e Elite)
        this.load.spritesheet('skeleton', 'assets/sprites/skeleton.png', {
            frameWidth: 48,
            frameHeight: 48
        });

        // Portal do Boss: 192x112 (17 frames)
        this.load.spritesheet('portal', 'assets/sprites/portal.png', {
            frameWidth: 192,
            frameHeight: 112
        });

        // Mapa padrão (exportado do Godot via Tiled): 5 camadas (chao, props, props2,
        // "arvores 2", arvores) sobre 3 atlas reais. Reconstruído a partir de mapa.tscn
        // porque a 1ª exportação (commit "mapa tmj") só trouxe a camada chao e com o atlas
        // errado (Plants.png) e tile size errado (32 em vez de 16) — causava os buracos.
        this.load.tilemapTiledJSON('mapa-normal', 'assets/maps/mapa.tmj');
        this.load.image('tileset-grass', 'assets/tilesets/Grass.png');
        this.load.image('tileset-props', 'assets/tilesets/Props.png');
        this.load.image('tileset-plants', 'assets/tilesets/Plants.png');
    }

    create() {
        console.log('[Preload] Preload concluído.');
        ensurePlayerAnimations(this);
        ensureEnemyAnimations(this);

        if (!this.anims.exists('portal-loop')) {
            this.anims.create({
                key: 'portal-loop',
                frames: this.anims.generateFrameNumbers('portal', { start: 0, end: 16 }),
                frameRate: 10,
                repeat: -1
            });
        }

        // Quando tudo carregar, vai pro Menu
        this.scene.start('MainMenu');
    }
}
