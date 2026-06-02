import * as THREE from 'three';
import { Fn, int, attribute, texture, uv, vec4, If, mix } from 'three/tsl';
import { vAo, uAoEnabled } from './AONodeSystem.js';

/**
 * 合批材质 — 使用 TSL 实现多纹理选择 + AO
 * MeshBasicNodeMaterial（unlit，保持与迁移前视觉一致）
 *
 * 通过 per-instance 属性 aTextureIndex 在 fragment 阶段选择纹理，
 * 然后乘以 AONodeSystem 提供的 vAo varying 完成 AO 着色。
 *
 * @example
 * const mat = new BatchedMaterial({
 *   textures: [texture1, texture2, texture3],
 *   baseColor: 0xffffff
 * });
 */
export class BatchedMaterial extends THREE.MeshBasicNodeMaterial {
  constructor(params = {}) {
    const { textures = [], baseColor = 0xffffff } = params;

    super({
      side: params.side || THREE.FrontSide,
      transparent: params.transparent || false
    });

    // per-instance 纹理索引属性
    const aTextureIndex = attribute('aTextureIndex', 'float');

    // 预计算 baseColor 的 RGB 分量
    const color = new THREE.Color(baseColor);
    const baseR = color.r;
    const baseG = color.g;
    const baseB = color.b;

    // 构建 colorNode：If-branch 纹理选择 + AO 应用
    this.colorNode = Fn(() => {
      const result = vec4(baseR, baseG, baseB, 1.0).toVar();
      const idx = int(aTextureIndex);

      // 按索引选择纹理（最多 16 张）
      for (let i = 0; i < textures.length && i < 16; i++) {
        const tex = textures[i];
        if (tex) {
          If(idx.equal(i), () => {
            result.assign(texture(tex, uv()));
          });
        }
      }

      // 应用 AO：复用 AONodeSystem 导出的 vAo varying 和 uAoEnabled uniform
      // mix(color, color * ao, enabled) — enabled=0 时保持原色，enabled=1 时应用 AO
      const aoColor = vec4(
        result.x.mul(vAo),
        result.y.mul(vAo),
        result.z.mul(vAo),
        result.w
      );
      return mix(result, aoColor, uAoEnabled);
    })();
  }
}
