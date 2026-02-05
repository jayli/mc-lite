// src/utils/MathUtils.js
export const WORLD_CONFIG = {
  SEED: Math.random() * 9999
};

export function setSeed(s) {
  console.log(`[Seed] Setting global seed to: ${s}`);
  WORLD_CONFIG.SEED = s;
}

export function noise(x, z, scale = 0.05) {
  const nx = x + WORLD_CONFIG.SEED, nz = z + WORLD_CONFIG.SEED;
  return Math.sin(nx * scale) * 2 + Math.cos(nz * scale) * 2;
}

// [增强] 群系逻辑
export function getBiome(x, z) {
  const temp = noise(x, z, 0.01); // 温度
  const humidity = noise(x + 1000, z + 1000, 0.015); // 湿度

  if (temp > 1.2) return 'FOREST';
  if (temp > 0.6 && temp <= 1.2 && humidity > 0) return 'AZALEA'; // 杜鹃林
  if (temp < -1.5) return 'DESERT';
  if (temp > -1.5 && temp < -0.8 && humidity > 0.5) return 'SWAMP'; // 沼泽
  return 'PLAINS';
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
