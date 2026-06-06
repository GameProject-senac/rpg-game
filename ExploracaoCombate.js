/**
 * @file ExploracaoCombate.js
 * @description Cena de exploração e combate do jogo.
 *
 * Mecânicas principais:
 *  - Jogador (quadrado ciano) se move com as setas do teclado
 *  - Obstáculos estáticos (magenta) bloqueiam a passagem de todos os corpos
 *  - Inimigos (quadrados vermelhos) quicam pelas paredes e pelos obstáculos
 *  - Moedas (quadrados amarelos) aparecem em posições seguras e respawnam
 *    quando todas são coletadas
 *  - Encostar em um inimigo reinicia a cena
 *  - ESC volta para o HubCentral via cena de Loading
 *
 * Correções aplicadas vs. versão anterior:
 *  1. obstacles: substituído staticGroup().create() por add.rectangle() +
 *     physics.add.existing(rect, true), que é o modo correto de criar
 *     obstáculos retangulares com física estática no Phaser 3.
 *  2. Phaser 4: removido refreshBody() (API exclusiva do Phaser 3, inexistente
 *     no Phaser 4). No Phaser 4, corpos estáticos já sincronizam a posição
 *     do GameObject automaticamente.
 *  3. moedas: substituído add.circle() por add.rectangle() porque corpos
 *     arcade não funcionam corretamente em primitivas de círculo do Phaser.
 *  4. colisões dos obstáculos: como obstacles agora é um array simples,
 *     as colisões são registradas via forEach.
 *  5. coordenadas: todas recalculadas para canvas 1920×920.
 */

export class ExploracaoCombate extends Phaser.Scene {

    constructor() {
        super('ExploracaoCombate');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CREATE
    // ─────────────────────────────────────────────────────────────────────────

    create() {

        // ── 1. VARIÁVEIS BASE ─────────────────────────────────────────────────

        /** @type {number} Pontuação acumulada pelo jogador nesta sessão. */
        this.score = 0;

        // HUD: linha de status e pontuação
        this.add.text(10, 10, 'SISTEMA ONLINE - ESC para voltar', { color: '#00ff00' });

        /**
         * @type {Phaser.GameObjects.Text}
         * Texto que exibe a pontuação em tempo real.
         */
        this.scoreText = this.add.text(10, 30, 'DADOS COLETADOS: 0', {
            color: '#ffff00',
            fontSize: '20px'
        });


        // ── 2. JOGADOR ────────────────────────────────────────────────────────

        /**
         * @type {Phaser.GameObjects.Rectangle}
         * Quadrado ciano 40×40 px que representa o jogador.
         * Recebe um corpo de física dinâmico via physics.add.existing().
         */
        this.player = this.add.rectangle(960, 460, 40, 40, 0x00ffff);
        this.physics.add.existing(this.player);          // corpo dinâmico
        this.player.body.setCollideWorldBounds(true);    // não sai da tela


        // ── 3. OBSTÁCULOS ESTÁTICOS ───────────────────────────────────────────
        //
        // CORREÇÃO: staticGroup().create(x, y, texture) NÃO aceita parâmetros
        // de largura/altura. A forma correta para obstáculos retangulares é:
        //   add.rectangle(x, y, w, h, cor)  → cria o visual
        //   physics.add.existing(rect, true) → adiciona corpo estático (true)
        //
        // Layout dos obstáculos (coordenadas em pixels, canvas 1920×920):
        //
        //   O conjunto forma um quadrado oco centralizado no canvas.
        //   Centro do canvas: x=960, y=460
        //
        //          ┌──────────────────────────────────┐
        //          │         [viga superior]          │
        //          │  [pilar esq]    [pilar dir]      │
        //          │         [viga inferior]          │
        //          └──────────────────────────────────┘
        //
        //  x=660,  y=460  →  pilar esquerdo  (40 × 400)
        //  x=1260, y=460  →  pilar direito   (40 × 400)
        //  x=960,  y=260  →  viga superior   (640 × 40)
        //  x=960,  y=660  →  viga inferior   (640 × 40)

        /** @type {Phaser.GameObjects.Rectangle[]} Lista de obstáculos estáticos. */
        this.obstacles = [];

        const obstacleData = [
            { x: 440,  y: 360, w: 10,  h: 400 },   // pilar esquerdo
            { x: 360, y: 460, w: 40,  h: 100 },   // pilar direito
            { x: 960,  y: 260, w: 640, h: 40  },   // viga superior
            { x: 960,  y: 660, w: 640, h: 40  },   // viga inferior
        ];

        obstacleData.forEach(({ x, y, w, h }) => {
            const rect = this.add.rectangle(x, y, w, h, 0xff00ff);
            this.physics.add.existing(rect, true); // true = corpo estático
            // Phaser 4: o corpo estático já sincroniza a posição automaticamente.
            // refreshBody() era API do Phaser 3 e não existe no Phaser 4.
            this.obstacles.push(rect);
        });


        // ── 4. INIMIGOS ───────────────────────────────────────────────────────

        /**
         * @type {Phaser.Physics.Arcade.Group}
         * Grupo que contém todos os inimigos ativos.
         * Cada inimigo é um quadrado vermelho 30×30 px com bounce = 1
         * (quica sem perder velocidade) e colide com as bordas do mundo.
         */
        this.enemies = this.physics.add.group();

        // Inimigo 1 — canto superior esquerdo, velocidade diagonal positiva
        const enemy1 = this.add.rectangle(150, 150, 30, 30, 0xff0000);
        this.physics.add.existing(enemy1);
        enemy1.body
            .setVelocity(150, 200)
            .setBounce(1)
            .setCollideWorldBounds(true);
        this.enemies.add(enemy1);

        // Inimigo 2 — canto inferior direito, velocidade diagonal negativa
        const enemy2 = this.add.rectangle(1770, 770, 30, 30, 0xff0000);
        this.physics.add.existing(enemy2);
        enemy2.body
            .setVelocity(-200, -150)
            .setBounce(1)
            .setCollideWorldBounds(true);
        this.enemies.add(enemy2);


        // ── 5. ITENS COLETÁVEIS ───────────────────────────────────────────────

        /**
         * @type {Phaser.Physics.Arcade.Group}
         * Grupo que contém as moedas coletáveis (quadrados amarelos 20×20 px).
         * Respawna automaticamente quando todas são coletadas.
         */
        this.items = this.physics.add.group();
        this.spawnItems();


        // ── 6. COLISÕES ───────────────────────────────────────────────────────
        //
        // Como obstacles é um array simples (não um grupo Phaser),
        // precisamos registrar cada colisão individualmente via forEach.

        this.obstacles.forEach(obs => {
            this.physics.add.collider(this.player, obs);   // jogador bate na parede
            this.physics.add.collider(this.enemies, obs);  // inimigos batem na parede
        });

        // Overlap: jogador coleta moeda ao encostar
        this.physics.add.overlap(
            this.player,
            this.items,
            this.collectItem,
            null,
            this
        );

        // Colisão letal: jogador encosta em inimigo → reinicia cena
        this.physics.add.collider(
            this.player,
            this.enemies,
            this.hitEnemy,
            null,
            this
        );


        // ── 7. CONTROLES ──────────────────────────────────────────────────────

        /**
         * @type {Phaser.Types.Input.Keyboard.CursorKeys}
         * Teclas de seta para mover o jogador.
         */
        this.cursors = this.input.keyboard.createCursorKeys();

        // ESC: retorna ao HubCentral via cena de transição Loading
        this.input.keyboard.once('keydown-ESC', () => {
            this.scene.start('Loading', { destino: 'HubCentral' });
        });
    }


    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE  (loop principal — chamado ~60×/segundo)
    // ─────────────────────────────────────────────────────────────────────────

    update() {
        // Zera a velocidade a cada frame para evitar deslizamento
        this.player.body.setVelocity(0);

        // Movimento horizontal
        if (this.cursors.left.isDown) {
            this.player.body.setVelocityX(-300);
        } else if (this.cursors.right.isDown) {
            this.player.body.setVelocityX(300);
        }

        // Movimento vertical
        if (this.cursors.up.isDown) {
            this.player.body.setVelocityY(-300);
        } else if (this.cursors.down.isDown) {
            this.player.body.setVelocityY(300);
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODOS AUXILIARES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Espalha até 4 moedas em posições pré-definidas e seguras.
     *
     * Algoritmo:
     *  1. Embaralha a lista de posições candidatas.
     *  2. Para cada candidata, calcula a distância até cada inimigo ativo.
     *  3. Se nenhum inimigo estiver a menos de 80 px, cria a moeda ali.
     *  4. Para quando 4 moedas forem criadas ou a lista se esgotar.
     *
     * CORREÇÃO: moedas agora são add.rectangle() (20×20 px) em vez de
     * add.circle(), pois corpos arcade não funcionam corretamente em
     * primitivas de círculo do Phaser 3.
     */
    spawnItems() {
        // Posições candidatas distribuídas pelas bordas do mapa (canvas 1920×920)
        const safePositions = [
            { x: 150,  y: 150  }, { x: 960,  y: 80   }, { x: 1770, y: 150  },
            { x: 150,  y: 460  }, { x: 1770, y: 460  },
            { x: 150,  y: 770  }, { x: 960,  y: 840  }, { x: 1770, y: 770  },
        ];

        Phaser.Utils.Array.Shuffle(safePositions);

        let moedasCriadas = 0;

        for (let i = 0; i < safePositions.length && moedasCriadas < 4; i++) {
            const pos = safePositions[i];
            let muitoPerto = false;

            // Verifica distância mínima de 80 px em relação a cada inimigo
            this.enemies.getChildren().forEach(enemy => {
                const distancia = Phaser.Math.Distance.Between(
                    pos.x, pos.y,
                    enemy.x, enemy.y
                );
                if (distancia < 80) {
                    muitoPerto = true;
                }
            });

            if (!muitoPerto) {
                // Cria moeda como retângulo 20×20 (corpo arcade funciona corretamente)
                const coin = this.add.rectangle(pos.x, pos.y, 20, 20, 0xffff00);
                this.physics.add.existing(coin, false); // false = corpo dinâmico (necessário para overlap)
                this.items.add(coin);
                moedasCriadas++;
            }
        }
    }

    /**
     * Callback de overlap: chamado quando o jogador encosta em uma moeda.
     *
     * @param {Phaser.GameObjects.Rectangle} player - O jogador.
     * @param {Phaser.GameObjects.Rectangle} item   - A moeda coletada.
     */
    collectItem(player, item) {
        item.destroy();             // Remove a moeda do mundo
        this.score += 10;
        this.scoreText.setText('DADOS COLETADOS: ' + this.score);

        // Se não restar nenhuma moeda, respawna um novo conjunto
        if (this.items.getChildren().length === 0) {
            this.spawnItems();
        }
    }

    /**
     * Callback de colisão letal: chamado quando o jogador encosta em um inimigo.
     * Reinicia a cena do zero (pontuação e posições são resetadas).
     *
     * @param {Phaser.GameObjects.Rectangle} player - O jogador.
     * @param {Phaser.GameObjects.Rectangle} enemy  - O inimigo que causou a morte.
     */
    hitEnemy(player, enemy) {
        this.scene.restart();
    }
}