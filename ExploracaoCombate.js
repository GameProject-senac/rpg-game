export class ExploracaoCombate extends Phaser.Scene {
    constructor() {
        super('ExploracaoCombate');
    }

    create() {
        // 1. Variáveis Base
        this.score = 0;
        this.add.text(10, 10, 'SISTEMA ONLINE - ESC para voltar', { color: '#00ff00' });
        this.scoreText = this.add.text(10, 30, 'DADOS COLETADOS: 0', { color: '#ffff00', fontSize: '20px' });

        // 2. Nosso jogador (Quadrado Ciano)
        this.player = this.add.rectangle(400, 300, 40, 40, 0x00ffff);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);

        // 3. Os Obstáculos Estáticos (Paredes Magenta)
        this.obstacles = this.physics.add.staticGroup();
        this.obstacles.create(200, 300, 40, 200, 0xff00ff); 
        this.obstacles.create(600, 300, 40, 200, 0xff00ff); 
        this.obstacles.create(400, 150, 300, 40, 0xff00ff); 
        this.obstacles.create(400, 450, 300, 40, 0xff00ff); 

        // 4. Inimigos (Quadrados Vermelhos)
        this.enemies = this.physics.add.group();
        
        // Criando o primeiro inimigo no canto superior
        const enemy1 = this.add.rectangle(100, 100, 30, 30, 0xff0000);
        this.physics.add.existing(enemy1);
        // setBounce(1) faz ele quicar sem perder velocidade
        enemy1.body.setVelocity(150, 200).setBounce(1).setCollideWorldBounds(true);
        this.enemies.add(enemy1);

        // Criando o segundo inimigo no canto inferior
        const enemy2 = this.add.rectangle(700, 500, 30, 30, 0xff0000);
        this.physics.add.existing(enemy2);
        enemy2.body.setVelocity(-200, -150).setBounce(1).setCollideWorldBounds(true);
        this.enemies.add(enemy2);

        // 5. Itens Coletáveis (Moedas Circulares Amarelas)
        this.items = this.physics.add.group();
        this.spawnItems(); // Chama a função que cria as moedas aleatoriamente

        // 6. Todas as Colisões do jogo
        this.physics.add.collider(this.player, this.obstacles); // Player bate na parede
        this.physics.add.collider(this.enemies, this.obstacles); // Inimigos batem na parede

        // Eventos de encostar (overlap e colisão mortal)
        this.physics.add.overlap(this.player, this.items, this.collectItem, null, this);
        this.physics.add.collider(this.player, this.enemies, this.hitEnemy, null, this);

        // 7. Controles
        this.cursors = this.input.keyboard.createCursorKeys();

        this.input.keyboard.once('keydown-ESC', () => {
                this.scene.start('Loading', { destino: 'HubCentral' });
            });
        }

    update() {
        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown) {
            this.player.body.setVelocityX(-300);
        } else if (this.cursors.right.isDown) {
            this.player.body.setVelocityX(300);
        }

        if (this.cursors.up.isDown) {
            this.player.body.setVelocityY(-300);
        } else if (this.cursors.down.isDown) {
            this.player.body.setVelocityY(300);
        }
    }

    // Função responsável por espalhar as moedas amarelas com segurança
    spawnItems() {
        // Uma lista de pontos seguros no mapa
        const safePositions = [
            { x: 100, y: 100 }, { x: 400, y: 50 }, { x: 700, y: 100 },
            { x: 100, y: 300 }, { x: 700, y: 300 },
            { x: 100, y: 500 }, { x: 400, y: 550 }, { x: 700, y: 500 }
        ];

        // Embaralha as posições
        Phaser.Utils.Array.Shuffle(safePositions);

        let moedasCriadas = 0;
        let index = 0;

        // O loop continua até criarmos 4 moedas OU ficarmos sem posições na lista
        while (moedasCriadas < 4 && index < safePositions.length) {
            let pos = safePositions[index];
            let muitoPerto = false;

            // Pega todos os inimigos da tela e verifica a distância um por um
            this.enemies.getChildren().forEach(enemy => {
                // Calcula a distância em pixels entre a possível moeda e o inimigo
                let distancia = Phaser.Math.Distance.Between(pos.x, pos.y, enemy.x, enemy.y);
                
                // Se a distância for menor que 80 pixels, não é seguro nascer aqui
                if (distancia < 80) {
                    muitoPerto = true;
                }
            });

            // Se a posição for segura, desenha a moeda
            if (!muitoPerto) {
                const coin = this.add.circle(pos.x, pos.y, 10, 0xffff00);
                this.physics.add.existing(coin);
                coin.body.setCircle(10); 
                this.items.add(coin);
                
                moedasCriadas++; // Conta que conseguimos criar uma
            }
            
            index++; // Passa para a próxima coordenada da lista para testar
        }
    }

    // Função chamada quando pega uma moeda
    collectItem(player, item) {
        item.destroy(); 
        this.score += 10; 
        this.scoreText.setText('DADOS COLETADOS: ' + this.score); 

        // getChildren().length conta quantos itens ainda estão ativos na tela
        if (this.items.getChildren().length === 0) {
            this.spawnItems(); // Respawna tudo se chegar a zero!
        }
    }

    // Função chamada quando encosta no inimigo vermelho
    hitEnemy(player, enemy) {
        // Fica a tela preta por meio segundo e reinicia a cena do zero
        this.scene.restart();
    }
}