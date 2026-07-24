/**
 * @file UIScene.js
 * @description Cena paralela de UI (Inventário). Apenas renderiza o que o servidor informa —
 * não calcula atributos nem decide validade de equipar (fase2_spec.md Pacote 4, §4.2/§4.6).
 */

export class UIScene extends Phaser.Scene {

    constructor() {
        super('UIScene');
    }

    create() {
        this.itens = [];
        this.slotsContainer = this.add.container(0, 0);
        this.statsText = this.add.text(10, 800, '', { color: '#00ff00', fontSize: '14px' }).setScrollFactor(0);

        this.onInventoryUpdate = (data) => this.renderInventory(data.itens);
        this.onStatsUpdated = (data) => this.renderStats(data);
        this.onInputAction = (msg) => this.game.events.emit('inventory_action', msg);

        this.game.events.on('inventory_update', this.onInventoryUpdate);
        this.game.events.on('stats_updated', this.onStatsUpdated);

        this.events.once('shutdown', () => {
            this.game.events.off('inventory_update', this.onInventoryUpdate);
            this.game.events.off('stats_updated', this.onStatsUpdated);
            this.slotsContainer.destroy();
        });
    }

    // Desenha o grid de slots a partir da lista de itens vinda do servidor.
    renderInventory(itens) {
        this.itens = itens || [];
        this.slotsContainer.removeAll(true);

        const slotSize = 48;
        const startX = 10;
        const startY = 850;

        this.itens.forEach((item, i) => {
            const x = startX + i * (slotSize + 6);
            const cor = item.equipado ? 0x226622 : 0x333333;

            const bg = this.add.rectangle(x, startY, slotSize, slotSize, cor).setOrigin(0, 0).setStrokeStyle(1, 0xffffff);
            bg.setInteractive();
            bg.on('pointerdown', () => this.onSlotClick(item));

            const label = this.add.text(x + 3, startY + 3, item.item_id.slice(0, 8), { fontSize: '9px', color: '#ffffff' });

            this.slotsContainer.add([bg, label]);
        });
    }

    // Clique-equipar simples (drag & drop sofisticado fora de escopo, §4.5).
    // Só decide QUAL mensagem mandar com base no estado já informado pelo servidor — não valida nada.
    onSlotClick(item) {
        const tipoMsg = item.equipado ? 'unequip_item' : 'equip_item';
        this.game.events.emit('inventory_action', { type: tipoMsg, inventario_id: item.id });
    }

    renderStats(stats) {
        this.statsText.setText(`HP: ${stats.hp_atual}/${stats.hp_max}  DANO: ${stats.dano_base}  DEF: ${stats.defesa_base}`);
    }
}
