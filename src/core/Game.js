// src/core/Game.js
import { Engine } from './Engine.js';
import { World } from '../world/World.js';
import { UIManager } from '../ui/UIManager.js';
import { Player } from '../entities/player/Player.js';

export class Game {
    constructor() {
        this.engine = new Engine();
        this.world = new World(this.engine.scene);
        this.player = new Player(this.world, this.engine.camera);
        this.player.game = this; // Pass game reference to player
        this.ui = new UIManager(this); // Pass game instance
        this.isRunning = false;

        this.lastTime = 0;

        // Initialize inventory with default items
        this.player.inventory.add('dirt', 1000);
        this.player.inventory.add('wood', 1000);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop();
    }

    stop() {
        this.isRunning = false;
    }

    loop() {
        if (!this.isRunning) return;
        requestAnimationFrame(() => this.loop());

        const time = performance.now();
        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;

        this.update(dt);
        this.render();
    }

    update(dt) {
        if (this.player) this.player.update(dt);
        if (this.world && this.player) this.world.update(this.player.position, dt);
        if (this.ui) this.ui.update(dt);

        // Update light target to follow player (Legacy logic port)
        if (this.engine.light && this.player) {
            this.engine.light.position.set(this.player.position.x + 20, this.player.position.y + 40, this.player.position.z + 20);
            this.engine.light.target.position.copy(this.player.position);
            this.engine.light.target.updateMatrixWorld();
        }
    }

    render() {
        this.engine.render();
    }
}
