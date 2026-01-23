// src/world/entities/Island.js
// 天空岛生成模块
// 负责生成浮空岛，包括地形、树木和宝箱
import { Tree } from './Tree.js';

/**
 * 天空岛生成器类
 * 提供静态方法用于生成浮空岛
 */
export class Island {
  /**
   * 生成天空岛
   * @param {number} cx - 岛屿中心X坐标
   * @param {number} cy - 岛屿中心Y坐标（底部）
   * @param {number} cz - 岛屿中心Z坐标
   * @param {Chunk} chunk - 目标区块对象
   * @param {Object} [dObj=null] - 可选的数据对象
   */
  static generate(cx, cy, cz, chunk, dObj = null) {
    // 随机生成岛屿半径和高度
    const radius = 5 + Math.floor(Math.random() * 5);
    const height = 5 + Math.floor(Math.random() * 3);

    // 从底部到顶部逐层生成岛屿
    for (let y = 0; y <= height; y++) {
      // 计算当前层的半径（随着高度增加而减小）
      const r = Math.floor(radius * Math.pow(y / height, 0.7));

      // 在当前层内生成圆形区域
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz <= r * r) {
            // 顶部为天空草，其他层为天空石
            const type = (y === height) ? 'sky_grass' : 'sky_stone';
            chunk.add(cx + dx, cy + y, cz + dz, type, dObj);

            // 在顶部随机生成天空树
            if (y === height && Math.random() < 0.1) {
              Tree.generate(cx + dx, cy + y + 1, cz + dz, chunk, 'skyTree', dObj);
            }
          }
        }
      }
    }
    // 在岛屿顶部中心生成宝箱
    chunk.add(cx, cy + height + 1, cz, 'chest', dObj);
  }
}
