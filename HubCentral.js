export class HubCentral extends Phaser.Scene {
    constructor() {
        super('HubCentral');
    }

    create() {
        this.add.text(960, 200, 'ACAMPAMENTO SUCATEIRO (HUB CENTRAL)', { 
            fontFamily: 'Arial', fontSize: '32px', color: '#00ff00', fontStyle: 'bold' 
        }).setOrigin(0.5);

        this.add.text(960, 300, 'Área segura. Nenhum mutante detectado.', { color: '#ffffff' }).setOrigin(0.5);
        this.add.text(960, 400, 'Pressione [ ENTER ] para Iniciar Expedição de Combate', { color: '#ffff00' }).setOrigin(0.5);

        // Transição: Do Hub -> Loading -> Combate
        this.input.keyboard.once('keydown-ENTER', () => {
            this.scene.start('Loading', { destino: 'ExploracaoCombate' });
        });

        // Prevenção de vazamento de memória
        this.events.once('shutdown', () => {
            this.input.keyboard.removeAllListeners('keydown-ENTER');
        });
    }
}