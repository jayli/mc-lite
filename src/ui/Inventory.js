// src/ui/Inventory.js
const ITEMS = {
    'dirt': { col: '#5D4037' }, 'stone': { col: '#757575' }, 'wood': { col: '#5D4037' },
    'sand': { col: '#E6C288' }, 'planks': { col: '#C19A6B' }, 'cactus': { col: '#2E8B57' },
    'diamond': { col: '#00FFFF' }, 'gold': { col: '#FFD700' }, 'apple': { col: '#FF0000' },
    'flower': { col: '#FF4444' }, 'car': { col: '#333333' },
    'cloud': { col: '#FFFFFF' }, 'sky_stone': { col: '#DDDDDD' }, 'sky_wood': { col: '#DDA0DD' },
    'gold_apple': { col: '#FFD700' }, 'god_sword': { col: '#9400D3' },
    'moss': { col: '#4B6E31' }, 'azalea_log': { col: '#635338' }, 'azalea_leaves': { col: '#4A6B30' },
    'vine': { col: '#355E3B' }, 'lilypad': { col: '#228B22' }
};

export class InventoryUI {
    constructor(game) {
        this.game = game;
        this.modalEl = document.getElementById('inventory-modal');
        this.gridEl = document.getElementById('inventory-grid');
        this.isOpen = false;

        this.setupEvents();
    }

    setupEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyZ') this.toggle();
            // Hotbar selection keys
            if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
                if (this.game.player) {
                    this.game.player.inventory.selectedSlot = parseInt(e.code.replace('Digit', '')) - 1;
                    // Trigger UI update? Done in loop for HUD, manual for Inventory
                    if (this.isOpen) this.render();
                }
            }
        });
    }

    toggle() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            document.exitPointerLock();
            if (this.modalEl) this.modalEl.style.display = 'flex';
            this.render();
        } else {
            if (this.modalEl) this.modalEl.style.display = 'none';
            document.body.requestPointerLock();
        }
    }

    render() {
        if (!this.isOpen || !this.gridEl || !this.game.player) return;

        const inventory = this.game.player.inventory;
        this.gridEl.innerHTML = '';

        inventory.slots.forEach((slot, idx) => {
            // Only render non-empty slots or placeholders?
            // Original rendered all keys in `inventory` object.
            // Here we have fixed slots. Let's render all non-empty for the grid to look populated?
            // Or just the first N slots.
            // Let's render all slots that have items.
            if (slot.isEmpty()) return;

            const div = document.createElement('div');
            div.className = 'slot';
            if (idx === inventory.selectedSlot) div.style.borderColor = '#FFFF00';

            const c = document.createElement('canvas');
            c.width = 32;
            c.height = 32;
            const ctx = c.getContext('2d');
            const itemDef = ITEMS[slot.item] || { col: '#fff' };

            ctx.fillStyle = itemDef.col;
            ctx.fillRect(4, 4, 24, 24);
            ctx.strokeStyle = '#000';
            ctx.strokeRect(4, 4, 24, 24);

            const img = document.createElement('img');
            img.src = c.toDataURL();

            const countSpan = document.createElement('span');
            countSpan.className = 'count';
            countSpan.innerText = slot.count;

            div.onclick = () => {
                inventory.selectedSlot = idx;
                this.render();
            };

            div.append(img, countSpan);
            this.gridEl.appendChild(div);
        });
    }
}
