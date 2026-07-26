/**
 * @file UIScene.js
 * @description Cena paralela de UI (Inventário). Apenas renderiza o que o servidor informa —
 * não calcula atributos nem decide validade de equipar (fase2_spec.md Pacote 4, §4.2/§4.6).
 */

// Moldura da tela (Passo 1) — mantidas como constantes pra layout das abas (Passo 2) derivar dela.
const FRAME_X = 10, FRAME_Y = 690, FRAME_W = 400, FRAME_H = 150;
const TAB_W = 90, TAB_H = 34, TAB_GAP = 6;
const CONTENT_X = FRAME_X + TAB_W + 20;
// Linhas de equipamento (Passo 3): uma por item, largura = resto da moldura após a coluna de abas.
const ROW_W = FRAME_X + FRAME_W - CONTENT_X - 10;
const ROW_H = 40, ROW_GAP = 8, ICON_SIZE = 28;

export class UIScene extends Phaser.Scene {

    constructor() {
        super('UIScene');
    }

    create() {
        this.itens = [];
        this.isOpen = false;
        this.activeTabId = 'equipamentos';

        // Abas (Passo 2, Round 3): navegação puramente data-driven — uma 3ª aba é só mais um
        // objeto aqui (id/label), sem tocar em renderTabButtons/selectTab. Nenhuma regra de
        // negócio mora na aba: cada `content` é só o container que a aba mostra/esconde.
        this.tabs = [
            { id: 'equipamentos', label: 'Equipamentos' },
            { id: 'em_breve', label: 'Em breve' }
        ];

        // Tela de inventário (moldura do Passo 1 + abas do Passo 2).
        this.frameBg = this.add.rectangle(FRAME_X, FRAME_Y, FRAME_W, FRAME_H, 0x000000, 0.85)
            .setOrigin(0, 0).setStrokeStyle(2, 0x00ffff).setVisible(false);
        this.tabButtonsContainer = this.add.container(0, 0).setVisible(false);
        this.slotsContainer = this.add.container(0, 0).setVisible(false); // conteúdo da aba "Equipamentos"
        this.emBreveText = this.add.text(CONTENT_X, FRAME_Y + 20, 'Em breve', { fontSize: '16px', color: '#ffff00' }).setVisible(false);

        this.statsText = this.add.text(10, 50, '', { color: '#00ff00', fontSize: '14px' }).setScrollFactor(0);

        // Ícone/barra sempre visível — clique alterna a tela (mesma ação abre e fecha).
        this.toggleIcon = this.add.rectangle(10, 850, 140, 30, 0x2244aa)
            .setOrigin(0, 0).setStrokeStyle(1, 0x00ffff).setInteractive();
        this.toggleLabel = this.add.text(18, 857, 'INVENTÁRIO (TAB)', { fontSize: '12px', color: '#ffffff' });
        this.toggleIcon.on('pointerdown', () => this.game.events.emit('inventory_toggle'));

        this.renderTabButtons();
        this.selectTab(this.activeTabId); // aba padrão ao criar a cena (também reforçado no open, ver setOpen)

        this.onInventoryUpdate = (data) => this.renderInventory(data.itens);
        this.onStatsUpdated = (data) => this.renderStats(data);
        this.onInventoryScreenState = ({ open }) => this.setOpen(open);

        this.game.events.on('inventory_update', this.onInventoryUpdate);
        this.game.events.on('stats_updated', this.onStatsUpdated);
        this.game.events.on('inventory_screen_state', this.onInventoryScreenState);

        this.events.once('shutdown', () => {
            this.game.events.off('inventory_update', this.onInventoryUpdate);
            this.game.events.off('stats_updated', this.onStatsUpdated);
            this.game.events.off('inventory_screen_state', this.onInventoryScreenState);
            this.slotsContainer.destroy();
            this.tabButtonsContainer.destroy();
            this.frameBg.destroy();
            this.emBreveText.destroy();
            this.toggleIcon.destroy();
            this.toggleLabel.destroy();
        });
    }

    setOpen(open) {
        this.isOpen = open;
        this.frameBg.setVisible(open);
        this.tabButtonsContainer.setVisible(open);
        if (open) this.activeTabId = 'equipamentos'; // sempre reabre na aba padrão
        this.selectTab(this.activeTabId); // única fonte de verdade pra visibilidade do conteúdo
    }

    // Desenha os botões verticais na lateral esquerda da moldura, um por entrada de `this.tabs`.
    renderTabButtons() {
        this.tabButtonsContainer.removeAll(true);
        this.tabButtonRects = {};

        this.tabs.forEach((tab, i) => {
            const x = FRAME_X + 8;
            const y = FRAME_Y + 8 + i * (TAB_H + TAB_GAP);

            const bg = this.add.rectangle(x, y, TAB_W, TAB_H, 0x223344).setOrigin(0, 0).setStrokeStyle(1, 0x00ffff);
            bg.setInteractive();
            bg.on('pointerdown', () => this.selectTab(tab.id));

            const label = this.add.text(x + 6, y + 9, tab.label, { fontSize: '11px', color: '#ffffff' });

            this.tabButtonRects[tab.id] = bg;
            this.tabButtonsContainer.add([bg, label]);
        });
    }

    // Troca a aba ativa: realça o botão selecionado e mostra só o conteúdo dela.
    // Adicionar uma 3ª aba: entrada em `this.tabs` + um novo `if (tabId === '...')` aqui.
    selectTab(tabId) {
        this.activeTabId = tabId;

        this.tabs.forEach(tab => {
            const ativa = tab.id === tabId;
            this.tabButtonRects[tab.id]
                .setFillStyle(ativa ? 0x225533 : 0x223344)
                .setStrokeStyle(ativa ? 2 : 1, ativa ? 0xffff00 : 0x00ffff);
        });

        // Gateado por `isOpen`: a aba ativa só fica visível se a tela estiver de fato aberta —
        // sem isso, o `selectTab` inicial do create() (aba padrão) já deixava o conteúdo visível
        // antes da primeira abertura (bug reportado: itens "soltos" na entrada até o 1º toggle).
        this.slotsContainer.setVisible(this.isOpen && tabId === 'equipamentos');
        this.emBreveText.setVisible(this.isOpen && tabId === 'em_breve');
    }

    // Desenha a lista de equipamentos da aba "Equipamentos" a partir do inventário vindo do
    // servidor. Só tipo='Equipamento' entra aqui — Recurso (ex.: moedas legadas) e qualquer
    // tipo futuro não-equipável ficam de fora por construção (inclusão explícita, não exclusão).
    renderInventory(itens) {
        this.itens = (itens || []).filter(item => item.tipo === 'Equipamento');
        this.slotsContainer.removeAll(true);

        this.itens.forEach((item, i) => {
            const x = CONTENT_X;
            const y = FRAME_Y + 10 + i * (ROW_H + ROW_GAP);
            const cor = item.equipado ? 0x00ff00 : 0x888888; // verde = equipado, cinza = não-equipado

            // Linha inteira é o alvo de clique — reusa o mesmo pipeline (inventory_action ->
            // equip_item/unequip_item) que já existia antes da tela nova.
            const rowBg = this.add.rectangle(x, y, ROW_W, ROW_H, item.equipado ? 0x1a3a1a : 0x2a2a2a)
                .setOrigin(0, 0).setStrokeStyle(2, cor);
            rowBg.setInteractive();
            rowBg.on('pointerdown', () => this.onSlotClick(item));

            // Placeholder de ícone: quando o Godot entregar sprites, troca só este rectangle
            // por uma imagem — nome/status ao lado não mudam de posição.
            const iconPlaceholder = this.add.rectangle(x + 6, y + 6, ICON_SIZE, ICON_SIZE, cor, 0.3)
                .setOrigin(0, 0).setStrokeStyle(1, cor);

            const nomeText = this.add.text(x + ICON_SIZE + 16, y + 5, item.item_id, { fontSize: '12px', color: '#ffffff' });
            const statusText = this.add.text(x + ICON_SIZE + 16, y + 21,
                item.equipado ? 'EQUIPADO' : 'Clique para equipar',
                { fontSize: '10px', color: item.equipado ? '#00ff00' : '#aaaaaa' });

            this.slotsContainer.add([rowBg, iconPlaceholder, nomeText, statusText]);
        });
    }

    // Clique-equipar simples (drag & drop sofisticado fora de escopo, §4.5).
    // Só decide QUAL mensagem mandar com base no estado já informado pelo servidor — não valida nada.
    onSlotClick(item) {
        const tipoMsg = item.equipado ? 'unequip_item' : 'equip_item';
        this.game.events.emit('inventory_action', { type: tipoMsg, inventario_id: item.id });
    }

    renderStats(stats) {
        this.statsText.setText(`NÍVEL: ${stats.nivel}  HP: ${stats.hp_atual}/${stats.hp_max}  DANO: ${stats.dano_base}  DEF: ${stats.defesa_base}`);
    }
}
