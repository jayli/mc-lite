// src/workers/ExplosionWorker.js
/**
 * 爆炸逻辑 Worker
 * 负责计算连锁反应和破坏范围，减轻主线程负担
 */

self.onmessage = function(e) {
  const { action, payload } = e.data;

  if (action === 'calculateExplosion') {
    const { x, y, z, nearbyDeltas, seed } = payload;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);

    // 1. 计算破坏范围 (3x3x3)
    const blocksToDestroy = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          blocksToDestroy.push({ x: bx + dx, y: by + dy, z: bz + dz });
        }
      }
    }

    // 2. 搜索连锁 TNT (5x5x5)
    // 注意：Worker 需要根据 nearbyDeltas 来判断 TNT 位置
    const tntToIgnite = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          
          const tx = bx + dx;
          const ty = by + dy;
          const tz = bz + dz;
          const key = `${tx},${ty},${tz}`;
          
          if (nearbyDeltas[key] === 'tnt') {
            tntToIgnite.push({
              x: tx, y: ty, z: tz,
              delay: 500 + Math.random() * 600 // 连续爆炸的延迟，至少 500ms
            });
          }
        }
      }
    }

    self.postMessage({
      action: 'explosionResult',
      payload: {
        center: { x: bx, y: by, z: bz },
        blocksToDestroy,
        tntToIgnite
      }
    });
  }
};
