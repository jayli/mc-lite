// src/world/entities/Tree.js
export class Tree {
    static generate(x, y, z, chunk, type = 'default', dObj = null) {
        if (type === 'default' || type === 'skyTree') {
            const wT = type === 'skyTree' ? 'sky_wood' : 'wood';
            const lT = type === 'skyTree' ? 'sky_leaves' : 'leaves';

            for (let i = 0; i < 4; i++) chunk.add(x, y + i, z, wT, dObj);
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + 2; ly <= y + 4; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        if ((lx !== x || lz !== z || ly > y + 3) && Math.random() > 0.3) {
                            chunk.add(lx, ly, lz, lT, dObj);
                        }
                    }
                }
            }
        } else if (type === 'big') {
            const h = 6 + Math.floor(Math.random() * 8);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'wood', dObj);
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + h - 3; ly <= y + h; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        chunk.add(lx, ly, lz, 'leaves', dObj);
                    }
                }
            }
        } else if (type === 'azalea') {
            const h = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'azalea_log', dObj);

            const leaves = [];
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + h - 2; ly <= y + h; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        if (Math.abs(lx - x) + Math.abs(ly - (y + h)) + Math.abs(lz - z) <= 2.5) {
                            chunk.add(lx, ly, lz, 'azalea_leaves', dObj);
                            leaves.push({x: lx, y: ly, z: lz});
                        }
                    }
                }
            }

            // Generate hanging leaves
            for (const leaf of leaves) {
                // Check if there is a block directly below (leaf or log)
                // Log is at x,z from y to y+h-1
                const isLogBelow = (leaf.x === x && leaf.z === z && leaf.y - 1 >= y && leaf.y - 1 < y + h);
                const isLeafBelow = leaves.some(l => l.x === leaf.x && l.y === leaf.y - 1 && l.z === leaf.z);

                if (!isLogBelow && !isLeafBelow) {
                    // This is an exposed bottom leaf
                    // Check for exposed sides to match user's "edge" requirement loosely
                    // If it has fewer than 4 neighbors on the same level, it's an edge
                    let neighbors = 0;
                    if (leaves.some(l => l.x === leaf.x+1 && l.y === leaf.y && l.z === leaf.z)) neighbors++;
                    if (leaves.some(l => l.x === leaf.x-1 && l.y === leaf.y && l.z === leaf.z)) neighbors++;
                    if (leaves.some(l => l.x === leaf.x && l.y === leaf.y && l.z === leaf.z+1)) neighbors++;
                    if (leaves.some(l => l.x === leaf.x && l.y === leaf.y && l.z === leaf.z-1)) neighbors++;

                    // If it's an edge leaf (neighbors < 4) or just random chance
                    if (neighbors < 4 && Math.random() < 0.4) {
                         chunk.add(leaf.x, leaf.y - 1, leaf.z, 'azalea_hanging', dObj, false);
                    }
                }
            }
        } else if (type === 'swamp') {
            const h = 5 + Math.floor(Math.random() * 4);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'wood', dObj);
            for (let lx = x - 3; lx <= x + 3; lx++) {
                for (let lz = z - 3; lz <= z + 3; lz++) {
                    if (Math.abs(lx - x) + Math.abs(lz - z) <= 3.5) {
                        chunk.add(lx, y + h - 1, lz, 'leaves', dObj);
                        chunk.add(lx, y + h, lz, 'leaves', dObj);
                        if (Math.random() < 0.3 && Math.abs(lx - x) > 1) {
                            for (let v = 1; v <= 3; v++) chunk.add(lx, y + h - 1 - v, lz, 'vine', dObj, false);
                        }
                    }
                }
            }
        }
    }
}
