// src/world/TerrainGen.js
import { noise, getBiome } from '../utils/MathUtils.js';

export class TerrainGen {
    constructor() {
    }

    getBiome(x, z) {
        return getBiome(x, z);
    }

    generateHeight(x, z, biome) {
        let h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);

        // Terrain tweaking based on biome
        if (biome === 'DESERT') h = Math.floor(h * 0.5 + 2);
        if (biome === 'SWAMP') h = Math.floor(h * 0.3 - 2);

        return h;
    }

    shouldGenerateCloud(x, z) {
        return noise(x, z, 0.03) > 1.2;
    }
}

export const terrainGen = new TerrainGen();
