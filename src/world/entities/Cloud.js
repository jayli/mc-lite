// src/world/entities/Cloud.js
// 云生成模块
// 提供云方块的生成功能

/**
 * 云生成器类
 * 提供静态方法用于生成云方块
 */
export class Cloud {
    /**
     * 在指定位置生成云方块
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} z - Z坐标
     * @param {Chunk} chunk - 目标区块对象
     * @param {Object} [dObj=null] - 可选的数据对象
     */
    static generate(x, y, z, chunk, dObj = null) {
        chunk.add(x, y, z, 'cloud', dObj);
    }
}
