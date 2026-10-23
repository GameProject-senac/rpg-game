import { ensurePlayerAnimations } from './playerAnimations.js';
import { ensureEnemyAnimations } from './enemyAnimations.js';
import { ensureWarriorAnimations } from './warriorAnimations.js';

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

        // Assets do Player Padrão (48x48)
        this.load.spritesheet('player', 'assets/sprites/player.png', {
            frameWidth: 48,
            frameHeight: 48
        });

        // Assets da Classe Guerreiro (Grid 8-Direcional 128x128, 15 frames por linha)
        this.load.spritesheet('warrior-idle', 'assets/sprites/warrior/idle.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-idle2', 'assets/sprites/warrior/idle2.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-walk', 'assets/sprites/warrior/walk.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-run', 'assets/sprites/warrior/run.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-melee', 'assets/sprites/warrior/melee.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-melee2', 'assets/sprites/warrior/melee2.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-spin', 'assets/sprites/warrior/melee_spin.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-block', 'assets/sprites/warrior/shield_block.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-roll', 'assets/sprites/warrior/rolling.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-hit', 'assets/sprites/warrior/take_damage.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-die', 'assets/sprites/warrior/die.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-special', 'assets/sprites/warrior/special1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('warrior-kick', 'assets/sprites/warrior/kick.png', { frameWidth: 128, frameHeight: 128 });

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
        this.load.image('functional-hud-source', 'assets/iconesFuncionais/nova_barra.png');
        this.load.image('level-icons', 'assets/iconesFuncionais/level.png');

        this.load.spritesheet('book_bg', 'assets/inventory/inventarioBasico.png', {
            frameWidth: 435,
            frameHeight: 302
        });
        this.load.spritesheet('slot-select', 'assets/inventory/Select_SpriteSheet.png', {
            frameWidth: 18,
            frameHeight: 18
        });
        this.load.image('inventory-exterior', 'assets/inventory/selecao.png');
        const inventoryAssets = [
            'Anel.png',
            'arco.png',
            'botasAtirador.png',
            'botasGuerreiro.png',
            'botasMago.png',
            'botasSuporte.png',
            'botasTank.png',
            'cajadoMago.png',
            'cajadoSuporte.png',
            'calçaAtirador.png',
            'calçaGuerreiro.png',
            'calçaMago.png',
            'calçaSuporte.png',
            'calçaTank.png',
            'capaceteGuerreiro.png',
            'capaceteTank.png',
            'capuz.png',
            'chapéuMago.png',
            'clava.png',
            'escudo.png',
            'espada.png',
            'flecha.png',
            'lança.png',
            'marreta.png',
            'peitoralAtirador.png',
            'peitoralGuerreiro.png',
            'peitoralMago.png',
            'peitoralSuporte.png',
            'peitoralTank.png'
        ];
        for (const filename of inventoryAssets) {
            const key = filename.slice(0, -4);
            this.load.image(key, `assets/inventory/Itens/${filename}`);
        }
    }

    create() {
        console.log('[Preload] Preload concluído.');
        this.createFunctionalHudTextures();
        ensurePlayerAnimations(this);
        ensureEnemyAnimations(this);
        ensureWarriorAnimations(this);

        if (!this.anims.exists('portal-loop') && this.textures.exists('portal')) {
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

    createFunctionalHudTextures() {
        const source = this.textures.get('functional-hud-source').getSourceImage();
        const texture = this.textures.createCanvas('functional-hud', source.width, source.height);
        const context = texture.getContext();
        context.drawImage(source, 0, 0);

        const imageData = context.getImageData(0, 0, source.width, source.height);
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] >= 250 && pixels[index + 1] >= 250 && pixels[index + 2] >= 250) {
                pixels[index + 3] = 0;
            }
        }
        context.putImageData(imageData, 0, 0);
        texture.refresh();
        texture.add('hp', 0, 32, 514, 680, 165);
        texture.add('mana', 0, 810, 514, 674, 165);

        this.textures.get('level-icons').add('level-badge', 0, 310, 140, 90, 55);
    }
}
