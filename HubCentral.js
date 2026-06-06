export class HubCentral extends Phaser.Scene {
    constructor() {
        super('HubCentral');
    }

    create() {
        this.add.text(400, 200, 'ACAMPAMENTO SUCATEIRO (HUB CENTRAL)', { 
            fontFamily: 'Arial', fontSize: '32px', color: '#00ff00', fontStyle: 'bold' 
        }).setOrigin(0.5);

        this.add.text(400, 300, 'Área segura. Nenhum mutante detectado.', { color: '#ffffff' }).setOrigin(0.5);
        this.add.text(400, 400, 'Pressione [ ENTER ] para Iniciar Expedição de Combate', { color: '#ffff00' }).setOrigin(0.5);

        // Transição: Do Hub -> Loading -> Combate
        this.input.keyboard.once('keydown-ENTER', () => {
            this.scene.start('Loading', { destino: 'ExploracaoCombate' });
        });
    }
}