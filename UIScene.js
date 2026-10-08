/**
 * @file UIScene.js
 * @description Cena paralela de UI. Renderiza a interface customizada de livro/abas
 * integrada diretamente com as comunicações, estatísticas e banco de dados via servidor.
 */

const ITEM_TEXTURE_ALIASES = {
    escudo_improvisado: 'escudo'
};

function slotEspecialParaItem(item) {
    const nome = (item?.nome || '').toLocaleLowerCase('pt-BR');
    if (nome.startsWith('peitoral')) return 15;
    if (nome.startsWith('capacete') || nome.startsWith('chapéu') || nome === 'capuz') return 16;
    if (nome.startsWith('calça')) return 17;
    if (nome.startsWith('botas')) return 18;
    return null;
}

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        // --- 1. PROPRIEDADES E ELEMENTOS DO SEU LIVRO ---
        this.descTitle = null;
        this.descText = null;
        this.bgLivro = null;
        this.slotsCriados = [];
        this.fitasInterativas = [];
        this.selectionOverlays = [];
        this.mainSlotPositions = Object.create(null);
        this.exteriorSlotPositions = Object.create(null);
        this.exteriorSlotObjects = [];
        this.selectedSlotKey = null;
        this.hoveredSlotKey = null;

        // --- 2. VARIÁVEIS DE REDE INTEGRADAS ---
        this.itensDoBanco = [];
        this.itensPorSlot = new Map();
        this.isOpen = false;

        if (!this.anims.exists('slot-select-loop') && this.textures.exists('slot-select')) {
            this.anims.create({
                key: 'slot-select-loop',
                frames: this.anims.generateFrameNumbers('slot-select', { start: 0, end: 3 }),
                frameRate: 8,
                repeat: -1
            });
        }

        // --- 3. ELEMENTOS DE TEXTO E STATUS FIXOS ---
        this.levelBadge = this.add.image(4, 66.5, 'level-icons', 'level-badge')
            .setDisplaySize(74, 45)
            .setOrigin(0, 0.5)
            .setScrollFactor(0)
            .setDepth(10);
        this.levelText = this.add.text(41, 66.5, '', {
            color: '#ffffff',
            fontSize: '22px',
            fontStyle: 'bold',
            stroke: '#251914',
            strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(0).setDepth(11);

        this.hpBarImage = this.add.image(80, 0, 'functional-hud', 'hp')
            .setDisplaySize(270, 270 * 165 / 680)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(10);
        this.manaBarImage = this.add.image(80, 67, 'functional-hud', 'mana')
            .setDisplaySize(270, 270 * 165 / 674)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(10);
        this.hpBarFill = this.add.graphics().setScrollFactor(0).setDepth(11);
        this.manaBarFill = this.add.graphics().setScrollFactor(0).setDepth(11);

        this.statsText = this.add.text(10, 138, '', { color: '#00ff00', fontSize: '14px' }).setScrollFactor(0);
        this.xpBarBg = this.add.rectangle(10, 160, 200, 10, 0x333333).setOrigin(0, 0).setScrollFactor(0);
        this.xpBarFill = this.add.rectangle(10, 160, 0, 10, 0x00ff00).setOrigin(0, 0).setScrollFactor(0);
        this.portalFeedbackText = this.add.text(10, 180, '', {
            color: '#ffcc00',
            fontSize: '16px',
            backgroundColor: '#00000080',
            padding: { x: 4, y: 2 }
        }).setScrollFactor(0);
        this.damageCounter = this.add.text(1908, 460, '', {
            color: '#ffd166',
            fontSize: '34px',
            fontStyle: 'bold',
            stroke: '#2b1510',
            strokeThickness: 6
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(120).setVisible(false);
        this.damageResetTimer = null;
        this.totalRecentDamage = 0;

        this.exteriorBarLeft = 8;
        this.exteriorBarTop = 814;
        this.inventoryExterior = this.add.image(
            this.exteriorBarLeft + 321,
            this.exteriorBarTop + 49,
            'inventory-exterior'
        ).setScrollFactor(0).setDepth(110);
        this.renderizarInventarioExterior();

        this.inventoryToggleHitArea = this.add.rectangle(1864, 44, 52, 48, 0x2d2418, 0.95)
            .setStrokeStyle(2, 0xc9aa54)
            .setScrollFactor(0)
            .setDepth(50)
            .setInteractive({ useHandCursor: true });
        this.inventoryToggleIcon = this.add.graphics()
            .lineStyle(3, 0xf2d483, 1)
            .strokeRect(1849, 32, 13, 24)
            .strokeRect(1866, 32, 13, 24)
            .lineBetween(1864, 32, 1864, 56)
            .setScrollFactor(0)
            .setDepth(51);
        this.onInventoryToggleButton = () => this.game.events.emit('inventory_toggle');
        this.inventoryToggleHitArea.on('pointerdown', this.onInventoryToggleButton);

        // Define a página inicial padrão como 'inventario'
        this.registry.set('activePage', 'inventario');

        // --- 4. CONFIGURAÇÃO DE EVENTOS E OUvINTES ---

        // Abre/fecha o livro do inventário pelo Registro Global
        this.onInventoryOpenChanged = (parent, value) => {
            this.isOpen = Boolean(value);
            if (this.isOpen) {
                this.renderizarPaginaAtual();
            } else {
                this.fecharLivroInventario();
            }
        };
        this.registry.events.on('changedata-inventoryOpen', this.onInventoryOpenChanged);

        this.onInventoryToggleKey = () => this.game.events.emit('inventory_toggle');
        this.input.keyboard.on('keydown-I', this.onInventoryToggleKey);
        this.onInventoryScreenState = (data) => {
            const isOpen = Boolean(data?.open);
            if (this.registry.get('inventoryOpen') !== isOpen) {
                this.registry.set('inventoryOpen', isOpen);
            }
        };
        this.game.events.on('inventory_screen_state', this.onInventoryScreenState);

        this.onInventoryOutsideClick = (pointer) => {
            if (!this.isOpen || !this.bgLivro) return;
            const insideBook = pointer.x >= this.bookLeft && pointer.x <= this.bookLeft + 1280
                && pointer.y >= this.bookTop && pointer.y <= this.bookTop + 888;
            const buttonBounds = this.inventoryToggleHitArea.getBounds();
            const insideButton = pointer.x >= buttonBounds.left && pointer.x <= buttonBounds.right
                && pointer.y >= buttonBounds.top && pointer.y <= buttonBounds.bottom;
            const insideExteriorBar = pointer.x >= this.exteriorBarLeft
                && pointer.x <= this.exteriorBarLeft + 642
                && pointer.y >= this.exteriorBarTop
                && pointer.y <= this.exteriorBarTop + 98;
            if (!insideBook && !insideButton && !insideExteriorBar) this.game.events.emit('inventory_toggle');
        };
        this.input.on('pointerdown', this.onInventoryOutsideClick);

        // Escuta as atualizações de itens vindas do servidor Node
        this.onInventoryUpdate = (data) => {
            // Filtra os itens com base nas regras originais de Equipamento
            this.itensDoBanco = (data.itens || []).filter(item => item.tipo === 'Equipamento');
            this.itensPorSlot = new Map(this.itensDoBanco.map(item => [Number(item.slot_index), item]));
            this.renderizarInventarioExterior();
            if (this.isOpen && this.registry.get('activePage') === 'inventario') {
                this.renderizarPaginaAtual();
            }
        };

        // Escuta atualizações de nível, HP e experiência
        this.onStatsUpdated = (data) => this.renderStats(data);
        this.onPortalFeedbackUi = (data) => this.showPortalFeedback(data);
        this.onDamageDealt = (damage) => this.recordDamage(damage);

        // Registra as escutas no barramento de eventos do jogo
        this.game.events.on('inventory_update', this.onInventoryUpdate);
        this.game.events.on('stats_updated', this.onStatsUpdated);
        this.game.events.on('portal_feedback_ui', this.onPortalFeedbackUi);
        this.game.events.on('damage_dealt', this.onDamageDealt);

        // Garante a destruição dos ouvintes se a cena fechar
        this.events.once('shutdown', () => {
            this.game.events.off('inventory_update', this.onInventoryUpdate);
            this.game.events.off('stats_updated', this.onStatsUpdated);
            this.game.events.off('portal_feedback_ui', this.onPortalFeedbackUi);
            this.game.events.off('damage_dealt', this.onDamageDealt);
            this.game.events.off('inventory_screen_state', this.onInventoryScreenState);
            this.registry.events.off('changedata-inventoryOpen', this.onInventoryOpenChanged);
            this.input.keyboard.off('keydown-I', this.onInventoryToggleKey);
            this.input.off('pointerdown', this.onInventoryOutsideClick);
            this.fecharLivroInventario();
            this.exteriorSlotObjects.forEach(object => object.destroy());
            this.inventoryExterior.destroy();
            this.inventoryToggleHitArea.destroy();
            this.inventoryToggleIcon.destroy();
            this.statsText.destroy();
            this.xpBarBg.destroy();
            this.xpBarFill.destroy();
            this.portalFeedbackText.destroy();
            this.levelBadge.destroy();
            this.levelText.destroy();
            this.hpBarImage.destroy();
            this.manaBarImage.destroy();
            this.hpBarFill.destroy();
            this.manaBarFill.destroy();
            this.damageCounter.destroy();
            if (this.damageResetTimer) this.damageResetTimer.remove(false);
        });
    }

    renderizarInventarioExterior() {
        this.exteriorSlotObjects.forEach(object => object.destroy());
        this.exteriorSlotObjects = [];
        if (this.hoveredSlotKey?.startsWith('exterior:')) this.hoveredSlotKey = null;
        this.exteriorSlotPositions = Object.create(null);

        const centersX = [56, 121.5, 186.5, 251, 315.5, 380.5, 445, 509.5, 574.5];
        const centerY = 40;
        const slotSize = 60;

        centersX.forEach((centerX, index) => {
            const x = this.exteriorBarLeft + centerX;
            const y = this.exteriorBarTop + centerY;
            const slotKey = `exterior:${index}`;
            this.exteriorSlotPositions[index] = { x, y, size: slotSize };

            const slot = this.add.rectangle(x, y, slotSize, slotSize, 0xffffff, 0.001)
                .setScrollFactor(0)
                .setDepth(112)
                .setInteractive({ useHandCursor: true });
            this.exteriorSlotObjects.push(slot);

            slot.on('pointerover', () => {
                this.hoveredSlotKey = slotKey;
                this.atualizarDestaquesSlots();
            });
            slot.on('pointerout', () => {
                if (this.hoveredSlotKey === slotKey) {
                    this.hoveredSlotKey = null;
                    this.atualizarDestaquesSlots();
                }
            });
            slot.on('pointerdown', () => this.clicarSlotInventario(index, 'exterior'));

            const item = this.itensPorSlot.get(index);
            const textureKey = item?.icon || ITEM_TEXTURE_ALIASES[item?.nome] || item?.nome;
            if (textureKey && this.textures.exists(textureKey)) {
                const itemIcon = this.add.image(x, y, textureKey)
                    .setDisplaySize(38, 38)
                    .setScrollFactor(0)
                    .setDepth(113);
                this.exteriorSlotObjects.push(itemIcon);
            }
        });

        this.atualizarDestaquesSlots();
    }

    renderizarPaginaAtual() {
        this.limparElementosPagina();

        const paginaAtiva = this.registry.get('activePage') || 'inventario';
        const frame = paginaAtiva === 'quests' ? 1 : 0;
        this.bookScale = 1280 / 435;
        this.bookLeft = 320;
        this.bookTop = 16;
        this.bgLivro = this.add.image(960, 460, 'book_bg', frame)
            .setDisplaySize(1280, 888)
            .setScrollFactor(0)
            .setDepth(100);

        this.criarFitasInterativas(paginaAtiva);

        if (paginaAtiva === 'inventario') {
            this.desenharAbaInventario();
        } else if (paginaAtiva === 'quests') {
            this.desenharAbaQuests();
        }
        this.atualizarDestaquesSlots();
    }

    criarFitasInterativas(paginaAtiva) {
        const centers = paginaAtiva === 'quests'
            ? [{ page: 'inventario', x: 170, y: 207 }, { page: 'quests', x: 306, y: 207 }]
            : [{ page: 'inventario', x: 97, y: 231 }, { page: 'quests', x: 227, y: 231 }];

        centers.forEach(({ page, x, y }) => {
            const marker = this.add.rectangle(
                this.bookLeft + x * this.bookScale,
                this.bookTop + y * this.bookScale,
                34 * this.bookScale,
                40 * this.bookScale,
                0xffffff,
                0.001
            ).setScrollFactor(0).setDepth(102).setInteractive({ useHandCursor: true });

            marker.on('pointerdown', () => {
                if (this.registry.get('activePage') !== page) {
                    this.registry.set('activePage', page);
                    this.renderizarPaginaAtual();
                }
            });

            this.fitasInterativas.push(marker);
        });
    }

    desenharAbaInventario() {
        const scale = this.bookScale;
        const descriptionX = this.bookLeft + 270 * scale;
        this.descTitle = this.add.text(descriptionX, this.bookTop + 105 * scale, 'Selecione um item', {
            fontSize: '22px', color: '#5c4525'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(106);
        this.descText = this.add.text(descriptionX, this.bookTop + 132 * scale, '', {
            fontSize: '18px', color: '#473a2b', wordWrap: { width: 100 * scale }, align: 'center'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(106);
        this.slotsCriados.push(this.descTitle, this.descText);

        const slotSize = 14 * scale;
        const gridCentersX = [85.5, 109.5, 133.5, 156.5, 181.5];
        const gridCentersY = [103.5, 125.5, 147.5];
        let slotIndex = 0;

        for (let rowIndex = 0; rowIndex < gridCentersY.length; rowIndex++) {
            for (let columnIndex = 0; columnIndex < gridCentersX.length; columnIndex++) {
                const x = this.bookLeft + gridCentersX[columnIndex] * scale;
                const y = this.bookTop + gridCentersY[rowIndex] * scale;
                this.criarSlotInventario(slotIndex, x, y, slotSize, this.itensPorSlot.get(slotIndex));
                slotIndex++;
            }
        }

        const bottomSlotCenters = [[96.5, 184.5], [120.5, 184.5], [143.5, 184.5], [168.5, 184.5]];
        bottomSlotCenters.forEach(([centerX, centerY]) => {
            const x = this.bookLeft + centerX * scale;
            const y = this.bookTop + centerY * scale;
            this.criarSlotInventario(slotIndex, x, y, slotSize, this.itensPorSlot.get(slotIndex));
            slotIndex++;
        });
        this.atualizarDestaquesSlots();
    }

    criarSlotInventario(slotIndex, x, y, slotSize, item) {
        const slotKey = `main:${slotIndex}`;
        const slot = this.add.rectangle(x, y, slotSize, slotSize, 0xffffff, 0.001)
            .setScrollFactor(0)
            .setDepth(103)
            .setInteractive({ useHandCursor: true });
        this.slotsCriados.push(slot);
        this.mainSlotPositions[slotIndex] = { x, y, size: slotSize };

        slot.on('pointerover', () => {
            this.hoveredSlotKey = slotKey;
            this.atualizarDestaquesSlots();
        });
        slot.on('pointerout', () => {
            if (this.hoveredSlotKey === slotKey) {
                this.hoveredSlotKey = null;
                this.atualizarDestaquesSlots();
            }
        });
        slot.on('pointerdown', () => this.clicarSlotInventario(slotIndex, 'main'));

        if (!item) return;
        const textureKey = item.icon || ITEM_TEXTURE_ALIASES[item.nome] || item.nome;
        if (this.textures.exists(textureKey)) {
            const itemImg = this.add.image(x, y, textureKey)
                .setDisplaySize(slotSize * 0.72, slotSize * 0.72)
                .setScrollFactor(0)
                .setDepth(104);
            this.slotsCriados.push(itemImg);
        }

        if (item.equipado) {
            const equippedBorder = this.add.rectangle(x, y, slotSize, slotSize)
                .setStrokeStyle(2, 0x16754b)
                .setScrollFactor(0)
                .setDepth(105);
            this.slotsCriados.push(equippedBorder);
        }
    }

    clicarSlotInventario(slotIndex, group) {
        const slotKey = `${group}:${slotIndex}`;
        const item = this.itensPorSlot.get(slotIndex);

        if (!this.selectedSlotKey) {
            if (!item) return;
            this.selectedSlotKey = slotKey;
            this.mostrarDescricaoItem(item);
            this.atualizarDestaquesSlots();
            return;
        }

        const selectedIndex = Number(this.selectedSlotKey.split(':')[1]);
        const selectedItem = this.itensPorSlot.get(selectedIndex);
        if (!selectedItem) {
            this.selectedSlotKey = item ? slotKey : null;
            this.atualizarDestaquesSlots();
            return;
        }

        if (selectedIndex === slotIndex) {
            if (this.selectedSlotKey !== slotKey) {
                this.selectedSlotKey = slotKey;
            } else {
                const requiredSlot = slotEspecialParaItem(selectedItem);
                if (!selectedItem.equipado && requiredSlot !== null && selectedIndex !== requiredSlot) {
                    this.descTitle?.setText(selectedItem.nome);
                    this.descText?.setText('Mova para o slot especial correspondente para aplicar os atributos.');
                    return;
                }
                const type = selectedItem.equipado ? 'unequip_item' : 'equip_item';
                this.game.events.emit('inventory_action', { type, inventario_id: selectedItem.id });
            }
            this.mostrarDescricaoItem(selectedItem);
            this.atualizarDestaquesSlots();
            return;
        }

        if (!this.slotAceitaItem(selectedItem, slotIndex) ||
            (item && !this.slotAceitaItem(item, selectedIndex))) {
            this.descTitle?.setText('Slot incompatível');
            this.descText?.setText('Escolha um slot correspondente à categoria do item.');
            return;
        }

        this.selectedSlotKey = null;
        this.game.events.emit('inventory_action', {
            type: 'swap_inventory_slots',
            fromSlot: selectedIndex,
            toSlot: slotIndex
        });
        this.atualizarDestaquesSlots();
    }

    slotAceitaItem(item, slotIndex) {
        const slotEspecial = slotEspecialParaItem(item);
        return slotIndex < 15 || slotEspecial === slotIndex;
    }

    mostrarDescricaoItem(item) {
        const txtEquipado = item.equipado ? ' (EQUIPADO)' : '';
        this.descTitle?.setText(item.nome + txtEquipado);
        this.descText?.setText(item.descricao || 'Sem descrição.');
    }

    atualizarDestaquesSlots() {
        this.selectionOverlays.forEach(overlay => overlay.destroy());
        this.selectionOverlays = [];

        const visibleSlotKeys = [];
        if (this.selectedSlotKey) visibleSlotKeys.push(this.selectedSlotKey);
        if (this.hoveredSlotKey && this.hoveredSlotKey !== this.selectedSlotKey) {
            visibleSlotKeys.push(this.hoveredSlotKey);
        }

        visibleSlotKeys.forEach(slotKey => {
            const [group, index] = slotKey.split(':');
            const positions = group === 'main' ? this.mainSlotPositions : this.exteriorSlotPositions;
            const slot = positions[index];
            if (!slot) return;
            const overlay = this.add.sprite(slot.x, slot.y, 'slot-select')
                .setDisplaySize(slot.size, slot.size)
                .setScrollFactor(0)
                .setDepth(group === 'exterior' ? 115 : 107);
            overlay.play('slot-select-loop');
            this.selectionOverlays.push(overlay);
        });
    }

    desenharAbaQuests() {
        const scale = this.bookScale;
        const descriptionX = this.bookLeft + 270 * scale;
        this.descTitle = this.add.text(descriptionX, this.bookTop + 105 * scale, 'Selecione uma missão', {
            fontSize: '22px', color: '#5c4525'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(106);
        this.descText = this.add.text(descriptionX, this.bookTop + 132 * scale, '', {
            fontSize: '18px', color: '#473a2b', wordWrap: { width: 100 * scale }, align: 'center'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(106);
        this.slotsCriados.push(this.descTitle, this.descText);

        const listaQuests = this.registry.get('playerQuests') || [
            { id: 1, name: "Primeiro Passo", desc: "Fale com o ferreiro na vila central." },
            { id: 2, name: "Limpeza na Caverna", desc: "Derrote 5 morcegos na caverna ao norte." }
        ];

        listaQuests.forEach((quest, index) => {
            const questItemText = this.add.text(
                this.bookLeft + 110 * scale,
                this.bookTop + (103 + index * 21) * scale,
                quest.name,
                { fontSize: '18px', color: '#572c20', wordWrap: { width: 72 * scale } }
            )
                .setScrollFactor(0)
                .setDepth(104)
                .setInteractive({ useHandCursor: true });

            questItemText.on('pointerdown', () => {
                this.descTitle.setText(quest.name);
                this.descText.setText(quest.desc);
            });

            this.slotsCriados.push(questItemText);
        });
    }

    renderStats(stats) {
        this.levelText.setText(String(stats.nivel ?? 1));
        this.renderResourceBar(this.hpBarFill, 80, 0, stats.hp_atual, stats.hp_max, 161, 62, 472, 43, 0xd72d50, 680);
        this.renderResourceBar(this.manaBarFill, 80, 67, 1, 1, 160, 62, 467, 43, 0x6662c8, 674);
        this.statsText.setText(`DANO: ${stats.dano_base}  DEF: ${stats.defesa_base}  XP: ${Math.floor(stats.experiencia)}`);
        const fracao = stats.xp_proximo_nivel ? Phaser.Math.Clamp(stats.experiencia / stats.xp_proximo_nivel, 0, 1) : 1;
        this.xpBarFill.width = 200 * fracao;
    }

    renderResourceBar(graphics, x, y, current, maximum, trackX, trackY, trackWidth, trackHeight, fillColor, sourceWidth = 684) {
        const ratio = maximum > 0 ? Phaser.Math.Clamp(current / maximum, 0, 1) : 0;
        const scale = 270 / sourceWidth;
        const scaledTrackX = trackX * scale;
        const scaledTrackY = trackY * scale;
        const scaledTrackWidth = trackWidth * scale;
        const scaledTrackHeight = trackHeight * scale;

        graphics.clear();
        graphics.fillStyle(0x382a3b, 1);
        graphics.fillRect(x + scaledTrackX, y + scaledTrackY, scaledTrackWidth, scaledTrackHeight);
        graphics.fillStyle(fillColor, 1);
        graphics.fillRect(x + scaledTrackX, y + scaledTrackY, scaledTrackWidth * ratio, scaledTrackHeight);
    }

    recordDamage(damage) {
        const amount = Number(damage);
        if (!Number.isFinite(amount) || amount <= 0) return;

        this.totalRecentDamage += amount;
        this.renderDamageCounter();
        if (this.damageResetTimer) this.damageResetTimer.remove(false);
        this.damageResetTimer = this.time.delayedCall(5000, () => {
            this.damageResetTimer = null;
            this.totalRecentDamage = 0;
            this.renderDamageCounter();
        });
    }

    renderDamageCounter() {
        if (this.totalRecentDamage <= 0) {
            this.damageCounter.setText('').setVisible(false);
            return;
        }
        this.damageCounter.setText(`DANO: ${Math.floor(this.totalRecentDamage)}`).setVisible(true);
    }

    showPortalFeedback(data) {
        this.portalFeedbackText.setText(data?.message ?? '');
        if (this.portalFeedbackClearTimer) {
            this.portalFeedbackClearTimer.remove(false);
        }
        if (!data?.message) {
            return;
        }
        this.portalFeedbackClearTimer = this.time.delayedCall(2000, () => {
            this.portalFeedbackText.setText('');
        });
    }

    fecharLivroInventario() {
        this.isOpen = false;
        this.selectedSlotKey = null;
        this.limparElementosPagina();
        this.atualizarDestaquesSlots();
    }

    limparElementosPagina() {
        if (this.bgLivro) { this.bgLivro.destroy(); this.bgLivro = null; }
        if (this.descTitle) { this.descTitle.destroy(); this.descTitle = null; }
        if (this.descText) { this.descText.destroy(); this.descText = null; }
        this.selectionOverlays.forEach(overlay => overlay.destroy());
        this.selectionOverlays = [];
        this.mainSlotPositions = Object.create(null);
        if (this.hoveredSlotKey?.startsWith('main:')) this.hoveredSlotKey = null;
        if (this.slotsCriados.length > 0) {
            this.slotsCriados.forEach(el => { if (el) el.destroy(); });
            this.slotsCriados = [];
        }
        if (this.fitasInterativas.length > 0) {
            this.fitasInterativas.forEach(fita => { if (fita) fita.destroy(); });
            this.fitasInterativas = [];
        }
        }
}