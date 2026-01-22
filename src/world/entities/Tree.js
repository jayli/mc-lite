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

            // Collect all blocks of this azalea tree
            const blocks = [];
            // Add trunk blocks
            for (let i = 0; i < h; i++) {
                blocks.push({x: x, y: y + i, z: z, type: 'azalea_log'});
            }
            // Add leaf blocks
            for (const leaf of leaves) {
                blocks.push({x: leaf.x, y: leaf.y, z: leaf.z, type: 'azalea_leaves'});
            }

            // Generate hanging blocks below any block that has air underneath
            for (const block of blocks) {
                const belowKey = `${Math.round(block.x)},${Math.round(block.y - 1)},${Math.round(block.z)}`;
                // Check if there is any solid block below (including terrain or other tree blocks)
                const hasBlockBelow = chunk.solidBlocks.has(belowKey) ||
                                     blocks.some(b => b.x === block.x && b.y === block.y - 1 && b.z === block.z);
                if (!hasBlockBelow) {
                    // Add hanging block below this block
                    chunk.add(block.x, block.y - 1, block.z, 'azalea_hanging', dObj, false);
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
