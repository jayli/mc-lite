import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { BlockScatterManager } from '../world/BlockScatterManager.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

describe('BlockScatterManager 数据契约', (test) => {
  test('优先使用 blockDataBlocks 写入逻辑数据，scatteredBlocks 只承载可见渲染数据', () => {
    let accepted = null;
    const visibleCode = encodeCoord(1, 1, 1);
    const hiddenCode = encodeCoord(2, 1, 1);
    const world = {
      chunks: new Map([
        ['0,0', {
          isReady: false,
          acceptScatteredBlocks(blocks, visibleKeys, structureCenters) {
            accepted = { blocks, visibleKeys, structureCenters };
            this.isReady = true;
          }
        }]
      ])
    };
    const scatter = new BlockScatterManager(world);

    scatter.scatter({
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: 1, y: 1, z: 1, type: 'stone' },
        { x: 2, y: 1, z: 1, type: 'dirt' }
      ],
      scatteredBlocks: [
        { x: 1, y: 1, z: 1, type: 'stone' }
      ],
      visibleKeys: [visibleCode],
      structureCenters: [{ type: 'static_tree', x: 1, y: 2, z: 1 }]
    });

    assertTrue(accepted !== null, 'ready chunk 应收到分发数据');
    assertEqual(accepted.blocks.length, 2, '隐藏逻辑方块也应进入 chunk blockData');
    assertTrue(accepted.visibleKeys.has(visibleCode), '可见 key 应保留');
    assertEqual(accepted.visibleKeys.has(hiddenCode), false, '隐藏方块不应被标记为可见');
  });

  test('应使用数字编码 visibleKeys 分发可见方块', () => {
    let accepted = null;
    const visibleCode = encodeCoord(1, 1, 1);
    const hiddenCode = encodeCoord(2, 1, 1);
    const world = {
      chunks: new Map([
        ['0,0', {
          isReady: false,
          acceptScatteredBlocks(blocks, visibleKeys, structureCenters) {
            accepted = { blocks, visibleKeys, structureCenters };
            this.isReady = true;
          }
        }]
      ])
    };
    const scatter = new BlockScatterManager(world);

    scatter.scatter({
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: 1, y: 1, z: 1, type: 'stone' },
        { x: 2, y: 1, z: 1, type: 'dirt' }
      ],
      visibleKeys: [visibleCode],
      structureCenters: []
    });

    assertTrue(accepted !== null, 'ready chunk 应收到分发数据');
    assertTrue(accepted.visibleKeys.has(visibleCode), '可见 key 应保留为数字编码');
    assertEqual(accepted.visibleKeys.has(hiddenCode), false, '隐藏方块不应被标记为可见');
  });

  test('纯流式跨 chunk 追加不应立即调度 consolidation', () => {
    let scheduled = 0;
    let appended = 0;
    const chunk = {
      isReady: true,
      appendScatteredBlocks(blocks, visibleKeys, structureCenters, options = {}) {
        if (options.deferConsolidation) {
          this.deferred = true;
        } else {
          scheduled++;
        }
        this.blocks = blocks;
        this.visibleKeys = visibleKeys;
        this.structureCenters = structureCenters;
        appended += blocks.length;
      }
    };
    const world = {
      chunks: new Map([['1,0', chunk]])
    };
    const scatter = new BlockScatterManager(world);

    scatter.scatter({
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: 17, y: 1, z: 1, type: 'stone' }
      ],
      scatteredBlocks: [
        { x: 17, y: 1, z: 1, type: 'stone' }
      ],
      visibleKeys: [encodeCoord(17, 1, 1)],
      structureCenters: []
    });

    assertEqual(scheduled, 0, '跨 chunk 流式追加不应同步调度 consolidation');
    assertEqual(appended, 0, '跨 chunk 方块不应在 scatter 阶段立即追加到 ready chunk');
    assertEqual(scatter.getPendingCrossChunkPatchStats().blocks, 1, '跨 chunk 方块应进入延迟补刷 buffer');
  });

  test('空闲补刷按玩家距离处理最近 ready chunk', () => {
    const appendedKeys = [];
    const makeChunk = (key) => ({
      isReady: true,
      isConsolidating: false,
      appendDeferredCrossChunkPatch(blocks, visibleKeys) {
        appendedKeys.push(key);
        this.blocks = blocks;
        this.visibleKeys = visibleKeys;
        return blocks.length;
      }
    });
    const world = {
      chunks: new Map([
        ['2,0', makeChunk('2,0')],
        ['1,0', makeChunk('1,0')]
      ])
    };
    const scatter = new BlockScatterManager(world);

    scatter.scatter({
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: 33, y: 1, z: 1, type: 'stone' },
        { x: 17, y: 1, z: 1, type: 'dirt' }
      ],
      visibleKeys: [encodeCoord(33, 1, 1), encodeCoord(17, 1, 1)],
      structureCenters: []
    });

    const result = scatter.flushDeferredCrossChunkPatchesAround(0, 0, {
      maxChunks: 1,
      maxBlocks: 10
    });

    assertEqual(result.processedChunks, 1, '每次只应处理预算允许的 chunk 数');
    assertEqual(appendedKeys[0], '1,0', '应优先补刷离玩家最近的 chunk');
    assertEqual(scatter.getPendingCrossChunkPatchStats().chunks, 1, '远处 chunk 应保留在 pending buffer');
  });

  test('空闲补刷会丢弃目标和源都超出活跃范围的 pending patch', () => {
    const world = {
      chunks: new Map()
    };
    const scatter = new BlockScatterManager(world);

    scatter.scatter({
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: 80, y: 1, z: 1, type: 'stone' }
      ],
      visibleKeys: [encodeCoord(80, 1, 1)],
      structureCenters: []
    });
    scatter.scatter({
      cx: 6,
      cz: 0,
      blockDataBlocks: [
        { x: 160, y: 1, z: 1, type: 'dirt' }
      ],
      visibleKeys: [encodeCoord(160, 1, 1)],
      structureCenters: []
    });

    const result = scatter.flushDeferredCrossChunkPatchesAround(0, 0, {
      maxChunks: 4,
      maxBlocks: 10,
      activeRange: 3
    });

    assertEqual(result.prunedChunks, 1, '超出活跃范围的未加载 patch 应被丢弃');
    assertEqual(scatter.getPendingCrossChunkPatchStats().chunks, 1, '活跃范围内的未加载 patch 应保留');
    assertTrue(scatter.pendingCrossChunkPatchBuffers.has('5,0'), '源仍在活跃范围内的 pending patch 应继续等待目标 chunk 加载');
    assertEqual(scatter.pendingCrossChunkPatchBuffers.has('10,0'), false, '远处 pending patch 应被清理');
  });
});
