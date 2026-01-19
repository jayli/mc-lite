// src/ui/HUD.js
import { materials } from '../core/materials/MaterialManager.js';

// Items config for UI rendering (Color lookup)
// In a real app, this might come from a unified ItemManager
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

export class HUD {
    constructor(game) {
        this.game = game;
        this.hotbarEl = document.getElementById('hotbar');
        this.msgEl = document.getElementById('msg');
    }

    update() {
        if (!this.game.player) return;
        this.renderHotbar();
    }

    renderHotbar() {
        if (!this.hotbarEl) return;
        const inventory = this.game.player.inventory;
        const selectedSlot = inventory.selectedSlot;

        this.hotbarEl.innerHTML = '';
        // Show first 5 slots for hotbar
        for (let i = 0; i < 5; i++) {
            const slot = inventory.slots[i];
            const div = document.createElement('div');
            div.className = 'slot' + (i === selectedSlot ? ' selected' : '');

            if (!slot.isEmpty()) {
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

                div.append(img, countSpan);
            }
            this.hotbarEl.appendChild(div);
        }
    }

    showMessage(text) {
        if (!this.msgEl) return;
        this.msgEl.innerText = text;
        this.msgEl.style.opacity = 1;
        setTimeout(() => {
            this.msgEl.style.opacity = 0;
        }, 2000);
    }
}
