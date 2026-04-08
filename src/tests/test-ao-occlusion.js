// src/tests/test-ao-occlusion.js
/**
 * AO 遮挡判定一致性测试
 * 目标：主线程 createOcclusionChecker 与 Worker 逻辑保持一致，避免 AO 深浅跳变
 */

import { describe, test } from './runner.js';
import { assertFalse, assertTrue } from './assert.js';
import { createOcclusionChecker } from '../utils/AOUtils.js';
import { getBlockProperties } from '../constants/BlockData.js';
import { Chunk } from '../world/Chunk.js';

describe('AO 遮挡判定一致性测试', (test) => {
  test('邻接 Chunk 未 finalized 时应视为空气（不遮挡）', () => {
    const currentChunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      blockData: { '15,0,0': { type: 'stone', orientation: 0 } }
    };

    const pendingNeighborChunk = {
      cx: 1,
      cz: 0,
      isReady: false,
      loadState: 'worker-ready',
      blockData: { '16,0,0': { type: 'stone', orientation: 0 } }
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
      blockData: { '0,0,0': { type: 'stone', orientation: 0 } }
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
      blockData: {
        '1,0,0': { type: 'stone', orientation: 0 },
        '2,0,0': { type: 'glass_block', orientation: 0 }
      }
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
      blockData: {
        '1,0,0': { type: 'bed_head', orientation: 0 }, // geometryType=half_block
        '2,0,0': { type: 'stone', orientation: 0 }
      }
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
    const impactedSet = new Set(impacted.map(item => item.key));

    assertTrue(impactedSet.has('1,0,0'), '应包含正交邻居');
    assertTrue(impactedSet.has('1,1,0'), '应包含边邻');
    assertTrue(impactedSet.has('1,1,1'), '应包含角邻');
    assertFalse(impactedSet.has('0,0,0'), '不应包含被删除方块自身');
    assertTrue(impacted.length >= 26, '至少应覆盖 26 个邻居位置');
  });
});
