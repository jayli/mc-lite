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
    assertEqual(scene.children.length, 1, '扩容应替换 mesh 而不是增加 draw target');
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
});
