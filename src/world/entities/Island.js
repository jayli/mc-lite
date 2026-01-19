// src/world/entities/Island.js
import { Tree } from './Tree.js';

export class Island {
    static generate(cx, cy, cz, chunk, dObj = null) {
        const radius = 5 + Math.floor(Math.random() * 5);
        const height = 5 + Math.floor(Math.random() * 3);

        for (let y = 0; y <= height; y++) {
            const r = Math.floor(radius * Math.pow(y / height, 0.7));
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (dx * dx + dz * dz <= r * r) {
                        const type = (y === height) ? 'sky_grass' : 'sky_stone';
                        chunk.add(cx + dx, cy + y, cz + dz, type, dObj);

                        if (y === height && Math.random() < 0.1) {
                            Tree.generate(cx + dx, cy + y + 1, cz + dz, chunk, 'skyTree', dObj);
                        }
                    }
                }
            }
        }
        chunk.add(cx, cy + height + 1, cz, 'chest', dObj);
    }
}
