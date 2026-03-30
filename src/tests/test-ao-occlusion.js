// src/tests/test-ao-occlusion.js
/**
 * AO 遮挡判定一致性测试
 * 目标：主线程 createOcclusionChecker 与 Worker 逻辑保持一致，避免 AO 深浅跳变
 */

import { describe, test } from './runner.js';
import { assertFalse, assertTrue } from './assert.js';
import { createOcclusionChecker } from '../utils/AOUtils.js';
import { getBlockProperties } from '../constants/BlockData.js';

describe('AO 遮挡判定一致性测试', (test) => {
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
});
