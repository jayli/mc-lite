import { describe } from './runner.js';
import { assertTrue, assertFalse } from './assert.js';
import { Chunk } from '../world/Chunk.js';

/**
 * 创建用于测试的最小化 Chunk 实例
 * 绕过构造函数，直接在原型上设置必需属性
 */
function createMinimalChunk(cx, cz) {
  const chunk = Object.create(Chunk.prototype);
  chunk.cx = cx;
  chunk.cz = cz;
  chunk.blockData = new Map();
  chunk.visibleKeys = new Set();
  chunk.instanceIndexMap = new Map();
  chunk.lightSourceCoords = new Set();
  chunk.dirtyAOPositions = new Set();
  chunk.loadState = 'hydrated';
  chunk.disposed = false;
  chunk._assemblyProgress = null;
  chunk._assemblyEpoch = 0;
  chunk._aoSourceVersion = 0;
  chunk.world = {
    chunk,
    chunks: new Map(),
    bootstrapState: { phase: 'runtime-streaming' }
  };
  // 捕获 buildMeshes 的输出，而非真正创建 Three.js 网格
  chunk._capturedMeshData = null;
  chunk.buildMeshes = function(meshDataArray) {
    this._capturedMeshData = meshDataArray;
    this.renderState = 'staged';
  };
  return chunk;
}

describe('Chunk 流式构建 AO 正确性', (test) => {
  test('convert-group 阶段应计算 AO 而非默认全 1', () => {
    const chunk = createMinimalChunk(0, 0);

    // 放置 4 个相邻 stone 方块，形成角落遮挡，确保 AO 不为全亮
    const baseX = 8, baseY = 5, baseZ = 8;
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY, baseZ), 'stone');
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY + 1, baseZ), 'stone');
    chunk.blockData.set(Chunk.encodeCoord(baseX + 1, baseY, baseZ), 'stone');
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY, baseZ + 1), 'stone');

    // 驱动增量构建直到完成
    let result;
    for (let i = 0; i < 200; i++) {
      result = chunk._buildMeshFromExistingBlockDataIncremental(50);
      if (result === 'done') break;
    }
    assertTrue(result === 'done', '增量构建应完成');
    assertTrue(chunk._capturedMeshData !== null, '应生成 meshData');

    const stoneGroup = chunk._capturedMeshData.find(d => d.type === 'stone');
    assertTrue(stoneGroup !== undefined, '应有 stone 组');
    assertTrue(stoneGroup.count > 0, 'stone 组应有方块');

    // 检验 AO：如果内联计算了 AO，则相邻方块不可能全为 1（全亮）
    let allOnes = true;
    for (let i = 0; i < stoneGroup.count; i++) {
      if (stoneGroup.aoLow[i] !== 1 || stoneGroup.aoHigh[i] !== 1) {
        allOnes = false;
        break;
      }
    }
    assertFalse(allOnes, 'AO 值不应全为 1（未计算），应内联计算实际遮挡');
  });

  test('runDeferredFinalizePhase 不应触发 fullRefresh', () => {
    const chunk = createMinimalChunk(0, 0);
    chunk.isReady = true;
    chunk.isConsolidating = false;
    chunk.loadState = 'finalized';
    chunk.hasDeferredFinalizeWork = true;
    chunk._needsDeferredAOStabilization = true;
    chunk._needsDeferredRuntimeEntityRestore = false;
    chunk._needsDeferredLightRegistration = false;

    const calls = [];
    chunk.world.onChunkAOSourceStable = (c, opts) => {
      calls.push({ chunkKey: `${c.cx},${c.cz}`, ...opts });
    };

    chunk.runDeferredFinalizePhase();

    assertTrue(calls.length > 0, '应触发 AO 边界刷新');
    for (const call of calls) {
      assertFalse(call.fullRefresh === true,
        `不应 fullRefresh: true，实际: ${JSON.stringify(call)}`);
    }
  });

  test('runDeferredFinalizePhase 完成后不应二次触发 AO 刷新', () => {
    const chunk = createMinimalChunk(0, 0);
    chunk.isReady = true;
    chunk.isConsolidating = false;
    chunk.loadState = 'finalized';
    chunk.hasDeferredFinalizeWork = true;
    chunk._needsDeferredAOStabilization = true;
    chunk._needsDeferredRuntimeEntityRestore = false;
    chunk._needsDeferredLightRegistration = false;

    const calls = [];
    chunk.world.onChunkAOSourceStable = (c, opts) => {
      calls.push(opts);
    };

    chunk.runDeferredFinalizePhase();

    assertTrue(calls.length === 1,
      `应只触发 1 次 AO 刷新，实际: ${calls.length} 次`);
  });

  test('_applyAOResults 应批量提交而非逐块提交', () => {
    const chunk = createMinimalChunk(0, 0);
    chunk.isReady = true;
    chunk.loadState = 'finalized';

    let commitCount = 0;
    const mockManager = {
      updateAO(coord, aoLow, aoHigh, options = {}) {
        if (options.commit !== false) commitCount++;
        return true;
      },
      commitDirtyBuffers() { commitCount++; }
    };
    chunk.world.globalInstancedMeshManager = mockManager;

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push({ x: 8, y: i, z: 8, aoLow: 0x00aaaaaa, aoHigh: 0x00bbbbbb });
    }
    chunk._applyAOResults(results, new Set());

    assertTrue(commitCount === 1,
      `应只有 1 次批量 commit，实际 ${commitCount} 次`);
  });
});
