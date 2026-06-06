export class MainMenu extends Phaser.Scene {
    constructor() {
        super('MainMenu');
    }

    create() {
        this.add.text(400, 250, 'PROJETO NEON', { 
            fontFamily: 'Arial', fontSize: '48px', color: '#00ffff', fontStyle: 'bold' 
        }).setOrigin(0.5);

        const startText = this.add.text(400, 350, 'Pressione ESPAÇO para Iniciar', { 
            fontFamily: 'Arial', fontSize: '24px', color: '#ffffff' 
        }).setOrigin(0.5);

        // Faz o texto piscar (efeito legal)
        this.tweens.add({
            targets: startText,
            alpha: 0,
            duration: 800,
            yoyo: true,
            repeat: -1
        });

        // Configura a tecla Espaço
        this.input.keyboard.once('keydown-SPACE', () => {
            // Chama o Loading e avisa que o destino final é o HubCentral
            this.scene.start('Loading', { destino: 'HubCentral' });
        });
    }
}


//textooo