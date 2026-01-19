// src/ui/UIManager.js
import { HUD } from './HUD.js';
import { InventoryUI } from './Inventory.js';

export class UIManager {
    constructor(game) {
        this.game = game;
        this.hud = new HUD(game);
        this.inventoryUI = new InventoryUI(game);
    }

    update(dt) {
        this.hud.update();
    }
}
