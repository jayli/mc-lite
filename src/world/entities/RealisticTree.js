// src/world/entities/RealisticTree.js
// 真实树木生成模块
// 使用预定义的模板创建树干和树叶
import { realisticTreeManager } from './RealisticTreeManager.js';

/**
 * 真实树木生成器类
 * 使用模板管理器创建具有真实感的树木
 */
export class RealisticTree {
    /**
     * 在指定位置生成真实树木
     * @param {number} x - X坐标
     * @param {number} y - Y坐标（底部）
     * @param {number} z - Z坐标
     * @param {Chunk} chunk - 目标区块对象
     * @param {string} [customLogType=null] - 可选的自定义树干类型
     */
  static generate(x, y, z, chunk, customLogType = null) {
    // 从管理器获取随机树木模板
    const template = realisticTreeManager.getRandomTemplate();
    if (!template) return;

    // --- 克隆树干 ---
    const trunkMesh = template.trunk.clone();
    if (customLogType) {
        // 如果是自定义树干（如 birch_log），则替换材质
        const mat = materials.getMaterial(customLogType);
        if (Array.isArray(mat)) {
            // 如果是多面材质数组（通常为6个面），针对圆柱体（CylinderGeometry）进行适配
            // CylinderGeometry 材质索引：0: 侧面, 1: 顶面, 2: 底面
            // Box 材质索引：0:px, 1:nx, 2:py, 3:ny, 4:pz, 5:nz
            // 映射：侧面用 px(0), 顶面用 py(2), 底面用 ny(3)
            trunkMesh.material = [mat[0], mat[2], mat[3]];
        } else {
            trunkMesh.material = mat;
        }
    }
    trunkMesh.position.set(x, y + template.trunkHeight / 2 - 0.5, z);
    chunk.group.add(trunkMesh);

    // 添加碰撞方块
    for (let i = 0; i < Math.ceil(template.trunkHeight); i++) {
      const key = `${Math.round(x)},${Math.round(y + i)},${Math.round(z)}`;
      chunk.solidBlocks.add(key);
    }

    // --- 克隆树叶 ---
    const leavesMesh = template.leaves.clone();
    leavesMesh.position.set(x, y, z); // 几何体已经相对于基部进行了偏移
    chunk.group.add(leavesMesh);
  }
}
