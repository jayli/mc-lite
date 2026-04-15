import * as THREE from 'three';
import { describe } from './runner.js';
import { assertDeepEqual, assertEqual, assertFalse, assertNotNull, assertTrue } from './assert.js';
import { GlobalBlockMeshManager } from '../world/GlobalBlockMeshManager.js';

function createManager(options = {}) {
  const scene = new THREE.Scene();

  return {
    scene,
    manager: new GlobalBlockMeshManager({
      scene,
      initialCapacity: options.initialCapacity || 4,
      geometryResolver: (blockType) => {
        if (blockType === 'glass_block') {
          return new THREE.BoxGeometry(0.9, 0.9, 0.9);
        }
        return new THREE.BoxGeometry(1, 1, 1);
      },
      materialResolver: (blockType) => {
        const transparent = blockType === 'glass_block';
        return new THREE.MeshBasicMaterial({ transparent, opacity: transparent ? 0.5 : 1 });
      },
      attributePolicy: (blockType) => ({
        usesAO: blockType !== 'glass_block',
        usesOrientation: true,
        castsShadow: blockType !== 'glass_block',
        receivesShadow: blockType !== 'glass_block'
      })
    })
  };
}

function createRecord(worldKey, blockType, chunkKey, translation, extra = {}) {
  return {
    worldKey,
    blockType,
    chunkKey,
    matrix: new THREE.Matrix4().makeTranslation(...translation),
    aoLow: extra.aoLow ?? 0,
    aoHigh: extra.aoHigh ?? 0,
    orientation: extra.orientation ?? 0
  };
}

function readTranslation(manager, blockType, instanceId) {
  const pool = manager.typePools.get(blockType);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  pool.mesh.getMatrixAt(instanceId, matrix);
  matrix.decompose(position, quaternion, scale);
  return [position.x, position.y, position.z];
}

describe('GlobalBlockMeshManager', (test) => {
  test('新增实例后可以通过 instanceId 反查 worldKey', () => {
    const { manager } = createManager();

    manager.upsertBlock(createRecord('1,2,3', 'stone', '0,0', [1, 2, 3], {
      aoLow: 11,
      aoHigh: 22,
      orientation: 3
    }));

    const stats = manager.getStats();

    assertEqual(stats.totalBlocks, 1, '总实例数应为 1');
    assertEqual(manager.getWorldKeyFromInstance('stone', 0), '1,2,3', '应能从 instanceId 反查 worldKey');
    assertTrue(manager.validateInvariants().ok, '新增后不变量应成立');

    manager.dispose();
  });

  test('删除中间实例时应执行 swap-and-pop 并回写索引', () => {
    const { manager } = createManager();

    manager.upsertBlock(createRecord('0,0,0', 'stone', '0,0', [0, 0, 0]));
    manager.upsertBlock(createRecord('1,0,0', 'stone', '0,0', [1, 0, 0]));
    manager.upsertBlock(createRecord('2,0,0', 'stone', '0,0', [2, 0, 0]));

    manager.removeBlock('1,0,0');

    const pool = manager.typePools.get('stone');
    const stats = manager.getStats();

    assertEqual(pool.count, 2, '删除后活跃实例数应减 1');
    assertEqual(pool.worldKeyToSlot.get('2,0,0'), 1, '最后一个实例应交换到被删除槽位');
    assertEqual(manager.getWorldKeyFromInstance('stone', 1), '2,0,0', '交换后的 instanceId 应能反查正确 key');
    assertDeepEqual(readTranslation(manager, 'stone', 1), [2, 0, 0], '交换后的矩阵应保留');
    assertEqual(stats.totalBlocks, 2, '总实例数应同步更新');
    assertTrue(manager.validateInvariants().ok, '删除后不变量应成立');

    manager.dispose();
  });

  test('超过容量时应自动扩容且保留矩阵与属性数据', () => {
    const { manager } = createManager({ initialCapacity: 2 });

    manager.upsertBlock(createRecord('0,0,0', 'stone', '0,0', [0, 0, 0], { aoLow: 1, aoHigh: 2, orientation: 3 }));
    manager.upsertBlock(createRecord('1,0,0', 'stone', '0,0', [1, 0, 0], { aoLow: 4, aoHigh: 5, orientation: 6 }));
    manager.upsertBlock(createRecord('2,0,0', 'stone', '0,0', [2, 0, 0], { aoLow: 7, aoHigh: 8, orientation: 9 }));

    const pool = manager.typePools.get('stone');
    const aoLowAttr = pool.mesh.geometry.getAttribute('aAoLow');
    const aoHighAttr = pool.mesh.geometry.getAttribute('aAoHigh');
    const orientationAttr = pool.mesh.geometry.getAttribute('aOrientation');

    assertTrue(pool.capacity >= 4, '扩容后容量应至少翻倍');
    assertDeepEqual(readTranslation(manager, 'stone', 0), [0, 0, 0], '扩容后首个矩阵应保留');
    assertDeepEqual(readTranslation(manager, 'stone', 2), [2, 0, 0], '扩容后新增矩阵应可读');
    assertEqual(aoLowAttr.array[0], 1, '扩容后 aoLow 应保留');
    assertEqual(aoHighAttr.array[1], 5, '扩容后 aoHigh 应保留');
    assertEqual(orientationAttr.array[2], 9, '扩容后 orientation 应保留');
    assertTrue(manager.validateInvariants().ok, '扩容后不变量应成立');

    manager.dispose();
  });

  test('同一 worldKey 重复 upsert 不应生成重复实例，跨类型迁移应清理旧池', () => {
    const { manager } = createManager();

    manager.upsertBlock(createRecord('5,5,5', 'stone', '0,0', [5, 5, 5], { aoLow: 1, aoHigh: 2, orientation: 3 }));
    manager.upsertBlock(createRecord('5,5,5', 'stone', '0,0', [6, 6, 6], { aoLow: 7, aoHigh: 8, orientation: 9 }));

    let pool = manager.typePools.get('stone');
    let aoLowAttr = pool.mesh.geometry.getAttribute('aAoLow');

    assertEqual(pool.count, 1, '重复 upsert 同类型不应新增实例');
    assertDeepEqual(readTranslation(manager, 'stone', 0), [6, 6, 6], '重复 upsert 应原地更新矩阵');
    assertEqual(aoLowAttr.array[0], 7, '重复 upsert 应原地更新属性');

    manager.upsertBlock(createRecord('5,5,5', 'glass_block', '0,0', [7, 7, 7], { orientation: 2 }));

    const stonePool = manager.typePools.get('stone');
    const glassPool = manager.typePools.get('glass_block');

    assertEqual(stonePool.count, 0, '跨类型迁移后旧池应清空该实例');
    assertEqual(glassPool.count, 1, '跨类型迁移后新池应持有该实例');
    assertEqual(manager.getWorldKeyFromInstance('glass_block', 0), '5,5,5', '迁移后命中反查应正确');
    assertFalse(Boolean(glassPool.mesh.geometry.getAttribute('aAoLow')), '不使用 AO 的类型不应创建 AO attribute');
    assertTrue(manager.validateInvariants().ok, '迁移后不变量应成立');

    manager.dispose();
  });

  test('replaceChunkBlocks 和 unregisterChunk 应维护 chunk 索引一致性', () => {
    const { manager } = createManager();

    manager.replaceChunkBlocks('0,0', [
      createRecord('0,0,0', 'stone', '0,0', [0, 0, 0]),
      createRecord('1,0,0', 'stone', '0,0', [1, 0, 0])
    ]);
    manager.replaceChunkBlocks('1,0', [
      createRecord('16,0,0', 'stone', '1,0', [16, 0, 0])
    ]);
    manager.replaceChunkBlocks('0,0', [
      createRecord('2,0,0', 'stone', '0,0', [2, 0, 0])
    ]);

    let stats = manager.getStats();

    assertEqual(stats.totalBlocks, 2, '替换 chunk 后总实例数应正确');
    assertEqual(manager.chunkIndex.get('0,0').size, 1, 'chunk 索引应只保留替换后的集合');
    assertNotNull(manager.worldIndex.get('2,0,0'), '替换后新 worldKey 应存在');
    assertEqual(manager.worldIndex.get('0,0,0'), undefined, '替换后旧 worldKey 应被移除');

    manager.unregisterChunk('1,0');
    stats = manager.getStats();

    assertEqual(stats.totalBlocks, 1, '注销 chunk 后应删除对应实例');
    assertFalse(manager.chunkIndex.has('1,0'), '注销 chunk 后 chunk 索引应删除');
    assertTrue(manager.validateInvariants().ok, '批量操作后不变量应成立');

    manager.dispose();
  });
});

console.log('test-global-block-mesh-manager: ok');
