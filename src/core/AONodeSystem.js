// src/core/AONodeSystem.js
// AO（环境光遮蔽）节点系统 — 使用 TSL (Three.js Shading Language) 实现
// 替代原来的 GLSL onBeforeCompile 方案，适配 WebGPURenderer

import { Fn, float, attribute, varying, vertexStage,
  uniform, mix, mod, floor, pow, If, materialColor, texture } from 'three/tsl';

// 每顶点属性 (BufferAttribute on geometry)
const aVertexId = attribute('aVertexId', 'float');

// 每实例属性 (InstancedBufferAttribute on geometry)
const aAoLow = attribute('aAoLow', 'float');
const aAoHigh = attribute('aAoHigh', 'float');
const aOrientation = attribute('aOrientation', 'float');

// 共享 AO 开关 uniform — 所有材质引用同一实例
export const uAoEnabled = uniform(1.0);

// --- TSL 翻译 GLSL 重映射函数 ---

const remapTopCorner = Fn(({ corner, orientationIdx }) => {
  const result = corner.toVar();
  If(orientationIdx.greaterThanEqual(0.5), () => {
    If(orientationIdx.lessThan(1.5), () => {
      // orientation=1: [2,0,3,1]
      If(corner.lessThan(0.5), () => { result.assign(2.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(0.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(1.0); });
    });
    If(orientationIdx.greaterThanEqual(1.5).and(orientationIdx.lessThan(2.5)), () => {
      // orientation=2: [3,2,1,0]
      If(corner.lessThan(0.5), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(2.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(1.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(0.0); });
    });
    If(orientationIdx.greaterThanEqual(2.5), () => {
      // orientation=3: [1,3,0,2]
      If(corner.lessThan(0.5), () => { result.assign(1.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(0.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(2.0); });
    });
  });
  return result;
});

const remapBottomCorner = Fn(({ corner, orientationIdx }) => {
  const result = corner.toVar();
  If(orientationIdx.greaterThanEqual(0.5), () => {
    If(orientationIdx.lessThan(1.5), () => {
      // orientation=1: [1,3,0,2]
      If(corner.lessThan(0.5), () => { result.assign(1.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(0.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(2.0); });
    });
    If(orientationIdx.greaterThanEqual(1.5).and(orientationIdx.lessThan(2.5)), () => {
      // orientation=2: [3,2,1,0]
      If(corner.lessThan(0.5), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(2.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(1.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(0.0); });
    });
    If(orientationIdx.greaterThanEqual(2.5), () => {
      // orientation=3: [2,0,3,1]
      If(corner.lessThan(0.5), () => { result.assign(2.0); });
      If(corner.greaterThanEqual(0.5).and(corner.lessThan(1.5)), () => { result.assign(0.0); });
      If(corner.greaterThanEqual(1.5).and(corner.lessThan(2.5)), () => { result.assign(3.0); });
      If(corner.greaterThanEqual(2.5), () => { result.assign(1.0); });
    });
  });
  return result;
});

const remapSideFace = Fn(({ face, orientationIdx }) => {
  const sideIdx = float(0.0).toVar();
  If(face.lessThan(0.5), () => { sideIdx.assign(0.0); });
  If(face.greaterThanEqual(0.5).and(face.lessThan(1.5)), () => { sideIdx.assign(2.0); });
  If(face.greaterThanEqual(1.5).and(face.lessThan(4.5)), () => { sideIdx.assign(1.0); });
  If(face.greaterThanEqual(4.5), () => { sideIdx.assign(3.0); });

  const worldSideIdx = mod(sideIdx.sub(orientationIdx).add(4.0), float(4.0));

  const result = float(5.0).toVar();
  If(worldSideIdx.lessThan(0.5), () => { result.assign(0.0); });
  If(worldSideIdx.greaterThanEqual(0.5).and(worldSideIdx.lessThan(1.5)), () => { result.assign(4.0); });
  If(worldSideIdx.greaterThanEqual(1.5).and(worldSideIdx.lessThan(2.5)), () => { result.assign(1.0); });
  If(worldSideIdx.greaterThanEqual(2.5), () => { result.assign(5.0); });
  return result;
});

const remapAoVertexId = Fn(({ vertexId, orientation }) => {
  const orientationIdx = mod(floor(orientation.add(0.5)), float(4.0));
  const face = floor(vertexId.div(4.0));
  const corner = mod(vertexId, float(4.0));

  const result = float(0.0).toVar();

  // +Y 面 (face index 2)
  If(face.greaterThan(1.5).and(face.lessThan(2.5)), () => {
    result.assign(float(8.0).add(remapTopCorner({ corner, orientationIdx })));
  });
  // -Y 面 (face index 3)
  If(face.greaterThan(2.5).and(face.lessThan(3.5)), () => {
    result.assign(float(12.0).add(remapBottomCorner({ corner, orientationIdx })));
  });
  // 侧面 (0, 1, 4, 5)
  If(face.lessThanEqual(1.5).or(face.greaterThanEqual(3.5)), () => {
    result.assign(remapSideFace({ face, orientationIdx }).mul(4.0).add(corner));
  });

  return result;
});

const getAo = Fn(({ vertexId, aoLow, aoHigh, orientation }) => {
  const remappedId = remapAoVertexId({ vertexId, orientation });
  const aoRaw = float(0.0).toVar();

  If(remappedId.lessThan(12.0), () => {
    aoRaw.assign(mod(floor(aoLow.div(pow(float(4.0), remappedId))), float(4.0)));
  });
  If(remappedId.greaterThanEqual(12.0), () => {
    aoRaw.assign(mod(floor(aoHigh.div(pow(float(4.0), remappedId.sub(12.0)))), float(4.0)));
  });

  // 将 0-3 映射到亮度: 1.0 - (3.0 - aoRaw) / 3.0 * 0.9
  return float(1.0).sub(float(3.0).sub(aoRaw).div(3.0).mul(0.9));
});

// 在顶点阶段计算 AO，通过 varying 传递到片元阶段
const aoComputed = getAo({
  vertexId: aVertexId,
  aoLow: aAoLow,
  aoHigh: aAoHigh,
  orientation: aOrientation
});

export const vAo = varying(vertexStage(aoComputed), 'vAo');

/**
 * 将 AO 效果应用到材质的 colorNode。
 * 显式采样 material.map 纹理（设置 colorNode 后管线不再自动应用 map），
 * 然后乘以 AO 值。
 * @param {THREE.MeshStandardNodeMaterial} material - 目标材质
 */
export function applyAOToMaterial(material) {
  material.colorNode = Fn(() => {
    let base = materialColor;
    if (material.map) {
      base = base.mul(texture(material.map).rgb);
    }
    return mix(base, base.mul(vAo), uAoEnabled);
  })();
}
