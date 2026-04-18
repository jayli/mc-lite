// src/world/entities/RealisticTree.js
// 真实树木生成模块
// 使用预定义的模板创建树干和树叶
import { realisticTreeManager } from '../entity-system/RealisticTreeManager.js';
import { materials } from '../../core/MaterialManager.js';

/**
 * 真实树木生成器类
 * 使用模板管理器创建具有真实感的树木
 * 支持两种模式：
 * 1. 传统模式：克隆模板 Mesh（适用于单棵树或少量树木）
 * 2. 实例化模式：记录树木数据，后续批量创建 InstancedMesh（适用于大量树木）
 */
export class RealisticTree {
    /**
     * 在指定位置生成真实树木
     * @param {number} x - X 坐标
     * @param {number} y - Y 坐标（底部）
     * @param {number} z - Z 坐标
     * @param {Chunk} chunk - 目标区块对象
     * @param {string} [customLogType=null] - 可选的自定义树干类型
     * @param {boolean} [useInstancing=true] - 是否使用实例化渲染优化
     */
  static generate(x, y, z, chunk, customLogType = null, useInstancing = true) {
    if (useInstancing) {
      // 实例化模式：记录树木数据，等待后续批量创建
      const cx = chunk.cx;
      const cz = chunk.cz;
      const templateIndex = realisticTreeManager.getRandomTemplateIndex();
      realisticTreeManager.addTreeToChunk(cx, cz, x, y, z, templateIndex);

      // 立即添加碰撞体和数据（不等待实例化渲染）
      const template = realisticTreeManager.templates[templateIndex];
      if (template) {
        for (let i = 0; i < Math.ceil(template.trunkHeight); i++) {
          const key = `${Math.floor(x)},${Math.floor(y + i)},${Math.floor(z)}`;
          // 树干碰撞体通过 blockData 记录，由 isSolid 路径处理
          chunk.blockData[key] = 'realistic_trunk_collider';
        }
      }
    } else {
      // 传统模式：直接克隆模板 Mesh
      this._generateLegacy(x, y, z, chunk, customLogType);
    }
  }

  /**
   * 传统模式生成树木（不推荐使用，仅用于兼容）
   * @private
   */
  static _generateLegacy(x, y, z, chunk, customLogType = null) {
    // 从管理器获取随机树木模板
    const template = realisticTreeManager.getRandomTemplate();
    if (!template) return;

    // --- 克隆树干 ---
    const trunkMesh = template.trunk.clone();
    if (customLogType) {
        // 如果是自定义树干（如 birch_log），则替换材质
        const mat = materials.getMaterial(customLogType);
        if (Array.isArray(mat)) {
            // 如果是多面材质数组（通常为 6 个面），针对圆柱体（CylinderGeometry）进行适配
            // CylinderGeometry 材质索引：0: 侧面，1: 顶面，2: 底面
            // Box 材质索引：0:px, 1:nx, 2:py, 3:ny, 4:pz, 5:nz
            // 映射：侧面用 px(0), 顶面用 py(2), 底面用 ny(3)
            trunkMesh.material = [mat[0], mat[2], mat[3]];
        } else {
            trunkMesh.material = mat;
        }
    }
    trunkMesh.position.set(Math.floor(x) + 0.5, y + template.trunkHeight / 2 - 0.5, Math.floor(z) + 0.5);
    chunk.group.add(trunkMesh);

    // 添加碰撞方块
    for (let i = 0; i < Math.ceil(template.trunkHeight); i++) {
      const key = `${Math.floor(x)},${Math.floor(y + i)},${Math.floor(z)}`;
      chunk.solidBlocks.add(key);
    }

    // --- 克隆树叶 ---
    const leavesMesh = template.leaves.clone();
    leavesMesh.position.set(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5); // 几何体已经相对于基部进行了偏移
    chunk.group.add(leavesMesh);
  }

  /**
   * 为区块创建实例化树木（由 Chunk 在生成完成后调用）
   * 注意：此方法只创建渲染网格，碰撞体已在 generate() 中添加
   * @param {Chunk} chunk - 区块对象
   */
  static createInstancedForChunk(chunk) {
    return realisticTreeManager.createInstancedTreesForChunk(
      chunk.cx,
      chunk.cz,
      chunk.group,
      null, // 碰撞体已在 generate() 中添加，这里不需要重复添加
      chunk.instanceIndexMap // 传递实例索引映射，用于移除方块时查找
    );
  }
}
