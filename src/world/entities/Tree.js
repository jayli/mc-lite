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
   * @param {string} [customLogType=null] - 可选的自定义树干类型
   * @param {string} [customLeafType=null] - 可选的自定义树叶类型
   */
  static generate(x, y, z, chunk, type = 'default', dObj = null, customLogType = null, customLeafType = null) {
    // 默认树木或天空树
    if (type === 'default' || type === 'skyTree') {
      const wT = customLogType || (type === 'skyTree' ? 'sky_wood' : 'wood');
      const lT = customLeafType || (type === 'skyTree' ? 'sky_leaves' : 'leaves');

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
      const logMat = customLogType || 'wood';
      const leafMat = customLeafType || 'leaves';
      for (let i = 0; i < h; i++) chunk.add(x, y + i, z, logMat, dObj);

      // 在树干顶部生成密集的树叶立方体
      for (let lx = x - 2; lx <= x + 2; lx++) {
        for (let ly = y + h - 3; ly <= y + h; ly++) {
          for (let lz = z - 2; lz <= z + 2; lz++) {
            chunk.add(lx, ly, lz, leafMat, dObj);
          }
        }
      }
    } else if (type === 'azalea') {
      // 杜鹃花树：高度4-6格
      const h = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < h; i++) chunk.add(x, y + i, z, 'azalea_log', dObj);

      // 在树干顶部生成类似森林树木的簇状树叶
      for (let lx = x - 2; lx <= x + 2; lx++) {
        for (let ly = y + h - 2; ly <= y + h; ly++) {
          for (let lz = z - 2; lz <= z + 2; lz++) {
            // 避免在树干内部位置重复生成（除非在顶部以上），并增加随机性
            if (lx !== x || lz !== z || ly >= y + h) {
              // 边缘随机稀疏化，使其看起来更自然
              const dist = Math.abs(lx - x) + Math.abs(lz - z);
              if (dist <= 2 && Math.random() > 0.2) {
                const leafType = Math.random() < 0.3 ? 'azalea_flowers' : 'azalea_leaves';
                chunk.add(lx, ly, lz, leafType, dObj);
              }
            }
          }
        }
      }
    } else if (type === 'swamp') {
      // 沼泽树：高度5-8格
      const h = 5 + Math.floor(Math.random() * 4);
      const logMat = customLogType || 'wood';
      for (let i = 0; i < h; i++) chunk.add(x, y + i, z, logMat, dObj);

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
