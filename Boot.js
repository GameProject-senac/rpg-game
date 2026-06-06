export class Boot extends Phaser.Scene {
    constructor() {
        // O nome entre aspas é a "chave" (ID) dessa cena
        super('Boot');
    }

    create() {
        console.log('Boot carregado');
        // Pula direto para a próxima cena
        this.scene.start('Preload');
    }
}