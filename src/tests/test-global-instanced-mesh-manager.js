import * as THREE from 'three';
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { GlobalInstancedMeshManager } from '../core/GlobalInstancedMeshManager.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

function createManager(initialCapacity = 2) {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const manager = new GlobalInstancedMeshManager(scene, {
    initialCapacity,
    materials: {
      getMaterial() {
        return material;
      }
    }
  });
  return { scene, manager };
}

function makeMatrix(x, y, z) {
  const object = new THREE.Object3D();
  object.position.set(x + 0.5, y + 0.5, z + 0.5);
  object.updateMatrix();
  return new Float32Array(object.matrix.elements);
}

function makeMeshData(blocks, type = 'stone') {
  const matrices = new Float32Array(blocks.length * 16);
  const aoLow = new Float32Array(blocks.length);
  const aoHigh = new Float32Array(blocks.length);
  const orientation = new Float32Array(blocks.length);
  const instanceIndexMap = {};

  blocks.forEach((block, index) => {
    matrices.set(makeMatrix(block.x, block.y, block.z), index * 16);
    aoLow[index] = block.aoLow ?? 1;
    aoHigh[index] = block.aoHigh ?? 1;
    orientation[index] = block.orientation ?? 0;
    instanceIndexMap[encodeCoord(block.x, block.y, block.z)] = index;
  });

  return [{
    type,
    count: blocks.length,
    matrices,
    aoLow,
    aoHigh,
    orientation,
    instanceIndexMap
  }];
}

describe('GlobalInstancedMeshManager', (test) => {
  test('新增同类型方块时共享一个全局 InstancedMesh', () => {
    const { scene, manager } = createManager();
    const a = encodeCoord(1, 2, 3);
    const b = encodeCoord(4, 5, 6);

    manager.addVisibleBlock(a, { type: 'stone', orientation: 0 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 11,
      aoHigh: 22,
      orientation: 0
    });
    manager.addVisibleBlock(b, { type: 'stone', orientation: 1 }, '0,0', {
      matrix: makeMatrix(4, 5, 6),
      aoLow: 33,
      aoHigh: 44,
      orientation: 1
    });

    const buffer = manager.buffers.get('stone');
    assertEqual(scene.children.length, 1, '同类型方块应只创建一个全局 mesh');
    assertEqual(buffer.count, 2, 'buffer count 应等于活跃实例数');
    assertEqual(buffer.mesh.count, 2, 'mesh.count 应等于 buffer count');
    assertEqual(buffer.coordToIndex.get(a), 0, '第一个坐标索引应为 0');
    assertEqual(buffer.coordToIndex.get(b), 1, '第二个坐标索引应为 1');
  });

  test('删除中间实例时使用 swap-remove 保持活跃区间连续', () => {
    const { manager } = createManager(4);
    const a = encodeCoord(1, 2, 3);
    const b = encodeCoord(4, 5, 6);
    const c = encodeCoord(7, 8, 9);

    for (const [coord, pos] of [[a, [1, 2, 3]], [b, [4, 5, 6]], [c, [7, 8, 9]]]) {
      manager.addVisibleBlock(coord, { type: 'stone', orientation: 0 }, '0,0', {
        matrix: makeMatrix(...pos),
        aoLow: 1,
        aoHigh: 1,
        orientation: 0
      });
    }

    assertTrue(manager.removeVisibleBlock(b), '删除已存在坐标应返回 true');
    const buffer = manager.buffers.get('stone');

    assertEqual(buffer.count, 2, '删除后 count 应减少');
    assertEqual(buffer.mesh.count, 2, 'mesh.count 应同步减少');
    assertEqual(manager.coordToRef.has(b), false, '被删坐标不应再有 ref');
    assertEqual(buffer.coordToIndex.get(c), 1, '最后实例应移动到被删位置');
    assertEqual(buffer.indexToCoord[1], c, '反向索引应指向被移动坐标');
    assertEqual(manager.coordToRef.get(c).index, 1, '全局 ref 应同步移动后的 index');
  });

  test('重复添加同一坐标只更新实例，不增加 count', () => {
    const { manager } = createManager();
    const coord = encodeCoord(1, 2, 3);

    manager.addVisibleBlock(coord, { type: 'stone', orientation: 0 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 1,
      aoHigh: 1,
      orientation: 0
    });
    manager.addVisibleBlock(coord, { type: 'stone', orientation: 2 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 8,
      aoHigh: 9,
      orientation: 2
    });

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 1, '重复坐标不应新增实例');
    assertEqual(buffer.mesh.geometry.getAttribute('aAoLow').array[0], 8, 'AO low 应被更新');
    assertEqual(buffer.mesh.geometry.getAttribute('aAoHigh').array[0], 9, 'AO high 应被更新');
    assertEqual(buffer.mesh.geometry.getAttribute('aOrientation').array[0], 2, 'orientation 应被更新');
  });

  test('容量不足时延迟扩容并保留旧索引', () => {
    const { scene, manager } = createManager(1);
    const a = encodeCoord(1, 2, 3);
    const b = encodeCoord(4, 5, 6);

    manager.addVisibleBlock(a, { type: 'stone', orientation: 0 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 1,
      aoHigh: 2,
      orientation: 0
    });
    manager.addVisibleBlock(b, { type: 'stone', orientation: 0 }, '0,0', {
      matrix: makeMatrix(4, 5, 6),
      aoLow: 3,
      aoHigh: 4,
      orientation: 0
    });

    const buffer = manager.buffers.get('stone');
    assertTrue(buffer.capacity >= 2, '容量应扩到可容纳两个实例');
    assertEqual(buffer.count, 2, '扩容后 count 应保留');
    assertEqual(scene.children.length, 2, '扩容后旧 mesh 延迟移除，暂时 scene 中有 2 个');
    assertEqual(scene.children.filter(c => c.visible === false).length, 1, '旧 mesh 应标记为不可见');
    manager.flushDisposal();
    manager.flushDisposal();
    manager.flushDisposal();
    assertEqual(scene.children.length, 1, 'flushDisposal 后旧 mesh 应被移除');
    assertEqual(buffer.coordToIndex.get(a), 0, '旧坐标索引应保留');
    assertEqual(buffer.coordToIndex.get(b), 1, '新坐标索引应正确');
  });

  test('chunk unload 只移除该 chunk 的实例', () => {
    const { manager } = createManager();
    const a = encodeCoord(1, 2, 3);
    const b = encodeCoord(20, 2, 3);

    manager.addVisibleBlock(a, { type: 'stone', orientation: 0 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 1,
      aoHigh: 1,
      orientation: 0
    });
    manager.addVisibleBlock(b, { type: 'stone', orientation: 0 }, '1,0', {
      matrix: makeMatrix(20, 2, 3),
      aoLow: 1,
      aoHigh: 1,
      orientation: 0
    });

    assertEqual(manager.removeChunk('0,0'), 1, '应只卸载目标 chunk 的一个实例');
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 1, '另一个 chunk 的实例应保留');
    assertEqual(manager.coordToRef.has(a), false, '卸载 chunk 坐标应删除');
    assertEqual(manager.coordToRef.has(b), true, '其他 chunk 坐标应保留');
  });

  test('replaceChunkVisibleBlocks 将新增实例入队，flushMutationQueue 分帧提交', () => {
    const { manager } = createManager(4);
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 }
    ];

    const queued = manager.replaceChunkVisibleBlocks('0,0', makeMeshData(blocks));
    assertEqual(queued, 3, 'replace 应把全部可见实例加入队列');
    assertEqual(manager.coordToRef.size, 0, '入队后不应同步写入，避免单帧尖峰');

    let result = manager.flushMutationQueue({ maxOps: 2, maxMs: 100 });
    assertEqual(result.processedBlocks, 2, '第一帧只处理预算内实例');
    assertEqual(result.remainingBlocks, 1, '队列应保留未处理实例');
    assertEqual(manager.coordToRef.size, 2, '已处理实例应可查');

    result = manager.flushMutationQueue({ maxOps: 2, maxMs: 100 });
    assertEqual(result.processedBlocks, 1, '第二帧处理剩余实例');
    assertEqual(result.remainingBlocks, 0, '队列应清空');
    assertEqual(manager.coordToRef.size, 3, '所有实例最终应写入');
  });

  test('flushMutationQueue 应优先处理离玩家更近的 chunk 队列', () => {
    const { manager } = createManager(4);
    const farCoord = encodeCoord(160, 2, 160);
    const nearCoord = encodeCoord(1, 2, 3);

    manager.replaceChunkVisibleBlocks('10,10', makeMeshData([
      { x: 160, y: 2, z: 160 }
    ]));
    manager.replaceChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 }
    ]));

    const result = manager.flushMutationQueue({
      maxOps: 1,
      maxMs: 100,
      playerCx: 0,
      playerCz: 0
    });

    assertEqual(result.processedBlocks, 1, '应只处理一个实例');
    assertEqual(manager.coordToRef.has(nearCoord), true, '近处 chunk 应优先 flush');
    assertEqual(manager.coordToRef.has(farCoord), false, '远处 chunk 应继续留在队列中');
  });

  test('removeChunk 会清理尚未 flush 的队列任务', () => {
    const { manager } = createManager(4);
    const queued = manager.replaceChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 }
    ]));

    assertEqual(queued, 2, '应成功入队');
    manager.removeChunk('0,0');
    const result = manager.flushMutationQueue({ maxOps: 10, maxMs: 100 });
    assertEqual(result.processedBlocks, 0, '卸载后的队列任务不应再写入');
    assertEqual(manager.coordToRef.size, 0, '卸载 chunk 不应残留实例');
  });

  test('AO 结果早于分帧实例写入时应缓存并在 flush 时应用', () => {
    const { manager } = createManager(4);
    const coord = encodeCoord(1, 2, 3);

    manager.replaceChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3, aoLow: 1, aoHigh: 1 }
    ]));
    assertEqual(manager.updateAO(coord, 88, 99), false, '实例尚未写入时 updateAO 返回 false');
    assertEqual(manager.getStats().pendingAO, 1, '已入队实例的 AO 应暂存');

    manager.flushMutationQueue({ maxOps: 1, maxMs: 100 });
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.mesh.geometry.getAttribute('aAoLow').array[0], 88, 'flush 后应应用暂存 aoLow');
    assertEqual(buffer.mesh.geometry.getAttribute('aAoHigh').array[0], 99, 'flush 后应应用暂存 aoHigh');
    assertEqual(manager.getStats().pendingAO, 0, '应用后 pending AO 应清空');
  });

  test('patchChunkVisibleBlocks 更新已有实例，不清空整个 chunk', () => {
    const { manager } = createManager(4);
    const keep = encodeCoord(1, 2, 3);
    const remove = encodeCoord(2, 2, 3);
    const add = encodeCoord(3, 2, 3);

    manager.replaceChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3, aoLow: 1, aoHigh: 1 },
      { x: 2, y: 2, z: 3, aoLow: 1, aoHigh: 1 }
    ]));
    manager.flushMutationQueue({ maxOps: 10, maxMs: 100 });

    const result = manager.patchChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3, aoLow: 7, aoHigh: 8 },
      { x: 3, y: 2, z: 3, aoLow: 9, aoHigh: 10 }
    ]));

    assertEqual(result.updated, 1, '已有实例应原地更新');
    assertEqual(result.queued, 1, '新增实例应入队分帧写入');
    assertEqual(result.removed, 1, '不再可见实例应删除');
    assertEqual(manager.coordToRef.has(keep), true, '保留坐标不应闪烁消失');
    assertEqual(manager.coordToRef.has(remove), false, '移除坐标应删除');
    assertEqual(manager.coordToRef.has(add), false, '新增坐标应等待队列 flush');

    manager.flushMutationQueue({ maxOps: 10, maxMs: 100 });
    assertEqual(manager.coordToRef.has(add), true, '新增坐标 flush 后应出现');
  });

  test('patch 批量更新同一 buffer 时只提交一次矩阵 update range', () => {
    const { manager } = createManager(4);
    manager.replaceChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 }
    ]));
    manager.flushMutationQueue({ maxOps: 10, maxMs: 100 });

    const buffer = manager.buffers.get('stone');
    let updateRangeCalls = 0;
    const originalAddUpdateRange = buffer.mesh.instanceMatrix.addUpdateRange.bind(buffer.mesh.instanceMatrix);
    buffer.mesh.instanceMatrix.addUpdateRange = (...args) => {
      updateRangeCalls++;
      return originalAddUpdateRange(...args);
    };

    manager.patchChunkVisibleBlocks('0,0', makeMeshData([
      { x: 1, y: 2, z: 3, aoLow: 5 },
      { x: 2, y: 2, z: 3, aoLow: 6 }
    ]));

    assertEqual(updateRangeCalls, 1, '同一 buffer 的 patch 更新应聚合为一次 update range');
  });

  test('chest 全局实例应维护 instanceId 对应的开启状态', () => {
    const { manager } = createManager(2);
    const a = encodeCoord(1, 2, 3);
    const b = encodeCoord(4, 5, 6);

    manager.addVisibleBlock(a, { type: 'chest', orientation: 0 }, '0,0', {
      matrix: makeMatrix(1, 2, 3),
      aoLow: 1,
      aoHigh: 1,
      orientation: 0
    });
    manager.addVisibleBlock(b, { type: 'chest', orientation: 0 }, '0,0', {
      matrix: makeMatrix(4, 5, 6),
      aoLow: 1,
      aoHigh: 1,
      orientation: 0
    });

    const buffer = manager.buffers.get('chest');
    assertEqual(buffer.mesh.userData.chests[0]?.open, false, '新增 chest 实例应初始化为未开启');
    assertEqual(buffer.mesh.userData.chests[1]?.open, false, '第二个 chest 实例也应初始化为未开启');

    buffer.mesh.userData.chests[1].open = true;
    manager.removeVisibleBlock(a);

    assertEqual(buffer.count, 1, '删除一个 chest 后应只剩一个实例');
    assertEqual(buffer.mesh.userData.chests[0]?.open, true, 'swap-remove 后应保留被移动 chest 的开启状态');
    assertEqual(buffer.mesh.userData.chests[1], undefined, '尾部旧 chest 状态应被清理');
  });
});
