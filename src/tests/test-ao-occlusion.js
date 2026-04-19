// src/tests/test-ao-occlusion.js
/**
 * AO 遮挡判定一致性测试
 * 目标：主线程 createOcclusionChecker 与 Worker 逻辑保持一致，避免 AO 深浅跳变
 */

import { describe, test } from './runner.js';
import { assertEqual, assertFalse, assertTrue } from './assert.js';
import { calculateAOForBlock, createOcclusionChecker, unpackAOValue } from '../utils/AOUtils.js';
import { getBlockProperties } from '../constants/BlockData.js';
import { Chunk } from '../world/Chunk.js';

/**
 * 将方块数据从普通对象转换为 Map（符合 Chunk.blockData 的实际数据结构）
 */
function toBlockDataMap(obj) {
  const map = new Map();
  for (const [key, entry] of Object.entries(obj)) {
    const [x, y, z] = key.split(',').map(Number);
    map.set(Chunk.encodeCoord(x, y, z), entry);
  }
  return map;
}

describe('AO 遮挡判定一致性测试', (test) => {
  test('邻接 Chunk 未 finalized 时应视为空气（不遮挡）', () => {
    const currentChunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      blockData: toBlockDataMap({ '15,0,0': { type: 'stone', orientation: 0 } })
    };

    const pendingNeighborChunk = {
      cx: 1,
      cz: 0,
      isReady: false,
      loadState: 'worker-ready',
      blockData: toBlockDataMap({ '16,0,0': { type: 'stone', orientation: 0 } })
    };

    const isOccluding = createOcclusionChecker(
      { chunk: currentChunk, chunks: new Map([['1,0', pendingNeighborChunk]]) },
      16,
      getBlockProperties
    );

    assertFalse(isOccluding(16, 0, 0), '未 finalized 的邻接 Chunk 不应参与互动期 AO 遮挡');
  });

  test('邻居 Chunk 缺失时应视为空气（不遮挡）', () => {
    const currentChunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      blockData: toBlockDataMap({ '0,0,0': { type: 'stone', orientation: 0 } })
    };

    const isOccluding = createOcclusionChecker(
      { chunk: currentChunk, chunks: new Map() },
      16,
      getBlockProperties
    );

    // (32,0,0) 属于 chunk(2,0)，不存在时应当按空气处理
    assertFalse(isOccluding(32, 0, 0), '缺失 Chunk 不应被当作实体遮挡');
  });

  test('仅实心且非透明方块应遮挡', () => {
    const currentChunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      blockData: toBlockDataMap({
        '1,0,0': { type: 'stone', orientation: 0 },
        '2,0,0': { type: 'glass_block', orientation: 0 }
      })
    };

    const isOccluding = createOcclusionChecker(
      { chunk: currentChunk, chunks: new Map() },
      16,
      getBlockProperties
    );

    assertTrue(isOccluding(1, 0, 0), 'stone 应遮挡');
    assertFalse(isOccluding(2, 0, 0), 'glass_block 不应遮挡');
  });

  test('非完整立方体不应作为遮挡体', () => {
    const currentChunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      blockData: toBlockDataMap({
        '1,0,0': { type: 'bed_head', orientation: 0 }, // geometryType=half_block
        '2,0,0': { type: 'stone', orientation: 0 }
      })
    };

    const isOccluding = createOcclusionChecker(
      { chunk: currentChunk, chunks: new Map() },
      16,
      getBlockProperties
    );

    assertFalse(isOccluding(1, 0, 0), 'half_block 不应遮挡完整面判定');
    assertTrue(isOccluding(2, 0, 0), 'box 方块应继续遮挡');
  });

  test('删除方块后的 AO 影响范围应覆盖 26 邻域', () => {
    const impacted = Chunk.getAOImpactedNeighborKeys(0, 0, 0);
    const impactedSet = new Set(impacted.map(item => item.code));

    assertTrue(impactedSet.has(Chunk.encodeCoord(1, 0, 0)), '应包含正交邻居');
    assertTrue(impactedSet.has(Chunk.encodeCoord(1, 1, 0)), '应包含边邻');
    assertTrue(impactedSet.has(Chunk.encodeCoord(1, 1, 1)), '应包含角邻');
    assertFalse(impactedSet.has(Chunk.encodeCoord(0, 0, 0)), '不应包含被删除方块自身');
    assertTrue(impacted.length >= 26, '至少应覆盖 26 个邻居位置');
  });

  test('被遮挡面不应计算 AO，接触空气的面才计算 AO', () => {
    const occluders = new Set([
      '1,0,0',
      '-1,0,0',
      '0,-1,0',
      '0,0,1',
      '0,0,-1',
      '-1,1,0',
      '0,1,-1',
      '-1,1,-1'
    ]);
    let coveredNormalCalls = 0;
    let coveredCornerCalls = 0;
    const isOccluding = (x, y, z) => {
      if (x === 1 && y === 0 && z === 0) coveredNormalCalls++;
      if (x === 1 && y === -1 && z === 0) coveredCornerCalls++;
      return occluders.has(`${x},${y},${z}`);
    };

    const { aoLow, aoHigh } = calculateAOForBlock(0, 0, 0, isOccluding);

    assertEqual(coveredNormalCalls, 1, '被遮挡的 +X 面只允许做一次接触空气判定');
    assertEqual(coveredCornerCalls, 0, '被遮挡的 +X 面不应继续计算角落 AO');
    for (let vertexIdx = 0; vertexIdx < 4; vertexIdx++) {
      assertEqual(unpackAOValue(aoLow, aoHigh, vertexIdx), 3, '+X 隐藏面 AO 应为中性值');
    }
    assertEqual(unpackAOValue(aoLow, aoHigh, 8), 0, '+Y 可见面仍应计算墙角 AO');
  });
});
