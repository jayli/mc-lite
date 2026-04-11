import * as THREE from 'three';

/**
 * 合批材质 — 支持多纹理采样
 * 用于材质合批优化，多个方块类型共享一个 InstancedMesh
 *
 * @example
 * const mat = new BatchedMaterial({
 *   textures: [texture1, texture2, texture3],
 *   baseColor: 0xffffff
 * });
 */
export class BatchedMaterial extends THREE.ShaderMaterial {
  constructor(params = {}) {
    const { textures = [], baseColor = 0xffffff } = params;

    // 构建纹理数组 uniform
    const textureArray = [];
    for (let i = 0; i < 16; i++) {
      textureArray.push(textures[i]?.map || null);
    }

    super({
      uniforms: {
        uTextures: { value: textureArray },
        uBaseColor: { value: new THREE.Color(baseColor) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vTextureIndex;
        varying float vAo;

        attribute float aTextureIndex;
        attribute float aAoLow;
        attribute float aAoHigh;
        attribute float aVertexId;

        void main() {
          vUv = uv;
          vTextureIndex = aTextureIndex;

          // AO 计算：从 aAoLow/aAoHigh 提取
          // 每个顶点占 2 位，总共 24 个顶点（0-23）
          // aAoLow: 顶点 0-15, aAoHigh: 顶点 16-23
          float aoPacked;
          int vertexId = int(aVertexId);

          if (vertexId < 16) {
            aoPacked = aAoLow;
          } else {
            aoPacked = aAoHigh;
            vertexId -= 16;
          }

          // 从打包值中提取 AO（每个顶点 2 位）
          int shift = vertexId * 2;
          int aoInt = int(mod(aoPacked / pow(2.0, float(shift)), 4.0));
          vAo = float(aoInt) / 3.0;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTextures[16];
        uniform vec3 uBaseColor;

        varying vec2 vUv;
        varying float vTextureIndex;
        varying float vAo;

        void main() {
          vec4 color;

          // 根据 textureIndex 采样对应纹理
          int idx = int(vTextureIndex + 0.5);

          if (idx == 0) color = texture2D(uTextures[0], vUv);
          else if (idx == 1) color = texture2D(uTextures[1], vUv);
          else if (idx == 2) color = texture2D(uTextures[2], vUv);
          else if (idx == 3) color = texture2D(uTextures[3], vUv);
          else if (idx == 4) color = texture2D(uTextures[4], vUv);
          else if (idx == 5) color = texture2D(uTextures[5], vUv);
          else if (idx == 6) color = texture2D(uTextures[6], vUv);
          else if (idx == 7) color = texture2D(uTextures[7], vUv);
          else if (idx == 8) color = texture2D(uTextures[8], vUv);
          else if (idx == 9) color = texture2D(uTextures[9], vUv);
          else if (idx == 10) color = texture2D(uTextures[10], vUv);
          else if (idx == 11) color = texture2D(uTextures[11], vUv);
          else if (idx == 12) color = texture2D(uTextures[12], vUv);
          else if (idx == 13) color = texture2D(uTextures[13], vUv);
          else if (idx == 14) color = texture2D(uTextures[14], vUv);
          else if (idx == 15) color = texture2D(uTextures[15], vUv);
          else color = vec4(uBaseColor, 1.0);

          // 应用 AO
          color.rgb *= vAo;

          gl_FragColor = color;
        }
      `,
      side: params.side || THREE.FrontSide,
      transparent: params.transparent || false,
      vertexColors: false
    });

    // 存储纹理数量
    this.uniforms.uTextureCount = { value: textures.length };
  }
}
