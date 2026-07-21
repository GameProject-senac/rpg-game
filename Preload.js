export class Preload extends Phaser.Scene {
    constructor() {
        super('Preload');
    }

    preload() {
        // Aqui iriam os this.load.image()...
        this.add.text(960, 300, 'Carregando Sistema...', { 
            fontFamily: 'Courier', fontSize: '24px', color: '#00ffff' 
        }).setOrigin(0.5);
    }

    create() {
        // Quando tudo carregar, vai pro Menu
        this.scene.start('MainMenu');
    }
}
