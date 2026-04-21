import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { BlockScatterManager } from '../world/BlockScatterManager.js';

describe('BlockScatterManager 数据契约', (test) => {
  test('优先使用 blockDataBlocks 写入逻辑数据，scatteredBlocks 只承载可见渲染数据', () => {
    let accepted = null;
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
      visibleKeys: ['1,1,1'],
      structureCenters: [{ type: 'static_tree', x: 1, y: 2, z: 1 }]
    });

    assertTrue(accepted !== null, 'ready chunk 应收到分发数据');
    assertEqual(accepted.blocks.length, 2, '隐藏逻辑方块也应进入 chunk blockData');
    assertTrue(accepted.visibleKeys.has('1,1,1'), '可见 key 应保留');
    assertEqual(accepted.visibleKeys.has('2,1,1'), false, '隐藏方块不应被标记为可见');
  });

  test('纯流式跨 chunk 追加不应立即调度 consolidation', () => {
    let scheduled = 0;
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
      visibleKeys: ['17,1,1'],
      structureCenters: []
    });

    assertEqual(scheduled, 0, '跨 chunk 流式追加不应同步调度 consolidation');
    assertTrue(chunk.deferred, '应通过 deferConsolidation 选项延迟后续合并');
  });
});
