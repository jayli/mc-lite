// src/world/entities/Tree.js
// 多种树木类型生成模块
// 提供多种树木类型生成器（默认、天空树、大型、杜鹃花、沼泽树）

/**
 * 树木生成器类
 * 提供多种树木类型的生成功能
 */
export class Tree {
    /**
     * 在指定位置生成树木
     * @param {number} x - X坐标
     * @param {number} y - Y坐标（底部）
     * @param {number} z - Z坐标
     * @param {Chunk} chunk - 目标区块对象
     * @param {string} [type='default'] - 树木类型：'default'、'skyTree'、'big'、'azalea'、'swamp'
     * @param {Object} [dObj=null] - 可选的数据对象
     */
    static generate(x, y, z, chunk, type = 'default', dObj = null) {
        // 默认树木或天空树
        if (type === 'default' || type === 'skyTree') {
            const wT = type === 'skyTree' ? 'sky_wood' : 'wood';
            const lT = type === 'skyTree' ? 'sky_leaves' : 'leaves';

            // 生成4格高的树干
            for (let i = 0; i < 4; i++) chunk.add(x, y + i, z, wT, dObj);

            // 在树干顶部周围生成树叶立方体（2x3x2）
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + 2; ly <= y + 4; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        // 避免在树干中心位置生成树叶（除非在顶部以上），并随机稀疏化
                        if ((lx !== x || lz !== z || ly > y + 3) && Math.random() > 0.3) {
                            chunk.add(lx, ly, lz, lT, dObj);
                        }
                    }
                }
            }
        } else if (type === 'big') {
            // 大型树木：随机高度6-13格
            const h = 6 + Math.floor(Math.random() * 8);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'wood', dObj);

            // 在树干顶部生成密集的树叶立方体
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + h - 3; ly <= y + h; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        chunk.add(lx, ly, lz, 'leaves', dObj);
                    }
                }
            }
        } else if (type === 'azalea') {
            // 杜鹃花树：高度4-6格
            const h = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'azalea_log', dObj);

            const leaves = [];
            // 在树干顶部生成球形树叶
            for (let lx = x - 2; lx <= x + 2; lx++) {
                for (let ly = y + h - 2; ly <= y + h; ly++) {
                    for (let lz = z - 2; lz <= z + 2; lz++) {
                        // 使用曼哈顿距离创建球形树叶分布
                        if (Math.abs(lx - x) + Math.abs(ly - (y + h)) + Math.abs(lz - z) <= 2.5) {
                            chunk.add(lx, ly, lz, 'azalea_leaves', dObj);
                            leaves.push({x: lx, y: ly, z: lz});
                        }
                    }
                }
            }

            // 收集杜鹃花树的所有方块（用于后续悬挂方块生成）
            const blocks = [];
            // 添加树干方块
            for (let i = 0; i < h; i++) {
                blocks.push({x: x, y: y + i, z: z, type: 'azalea_log'});
            }
            // 添加树叶方块
            for (const leaf of leaves) {
                blocks.push({x: leaf.x, y: leaf.y, z: leaf.z, type: 'azalea_leaves'});
            }

            // 为下方有空隙的方块生成悬挂方块
            for (const block of blocks) {
                const belowKey = `${Math.round(block.x)},${Math.round(block.y - 1)},${Math.round(block.z)}`;
                // 检查下方是否有固体方块（包括地形或其他树木方块）
                const hasBlockBelow = chunk.solidBlocks.has(belowKey) ||
                                     blocks.some(b => b.x === block.x && b.y === block.y - 1 && b.z === block.z);
                if (!hasBlockBelow) {
                    // 在此方块下方添加悬挂方块
                    chunk.add(block.x, block.y - 1, block.z, 'azalea_hanging', dObj, false);
                }
            }
        } else if (type === 'swamp') {
            // 沼泽树：高度5-8格
            const h = 5 + Math.floor(Math.random() * 4);
            for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'wood', dObj);

            // 在树干顶部生成宽阔的树叶层
            for (let lx = x - 3; lx <= x + 3; lx++) {
                for (let lz = z - 3; lz <= z + 3; lz++) {
                    if (Math.abs(lx - x) + Math.abs(lz - z) <= 3.5) {
                        // 生成两层树叶
                        chunk.add(lx, y + h - 1, lz, 'leaves', dObj);
                        chunk.add(lx, y + h, lz, 'leaves', dObj);

                        // 在外围随机生成藤蔓
                        if (Math.random() < 0.3 && Math.abs(lx - x) > 1) {
                            for (let v = 1; v <= 3; v++) chunk.add(lx, y + h - 1 - v, lz, 'vine', dObj, false);
                        }
                    }
                }
            }
        }
    }
}
