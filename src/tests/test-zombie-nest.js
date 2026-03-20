// src/tests/test-zombie-nest.js
/**
 * 丧尸巢穴完整性、刷怪与数量限制测试
 */

import { describe } from './runner.js';
import { assertEqual, assertFalse, assertNotNull, assertTrue } from './assert.js';
import { ZombieNest, ZOMBIE_NEST_CONFIG } from '../actors/zombie-nest/ZombieNest.js';
import { ZombieNestManager } from '../actors/zombie-nest/ZombieNestManager.js';

function createMockWorld(blocks = {}) {
  return {
    getBlock: (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      return blocks[key] ?? null;
    }
  };
}

function createNest(world, overrides = {}) {
  return new ZombieNest({
    id: 'zombie_nest_test',
    position: { x: 0, y: 0, z: 0 },
    world,
    structureBlocks: [
      { x: 0, y: 1, z: 0, type: 'sand' },
      { x: 0, y: 5, z: 0, type: 'gold_block' }
    ],
    criticalBlock: { x: 0, y: 5, z: 0, type: 'gold_block' },
    onSpawn: overrides.onSpawn || null,
    onDestroy: overrides.onDestroy || null
  });
}

describe('ZombieNest 行为测试', (test) => {
  test('关键顶端方块被移除后巢穴失效', () => {
    const blocks = {
      '0,5,0': 'gold_block',
      '3,0,0': 'sand'
    };
    const world = createMockWorld(blocks);
    let destroyedId = null;
    const nest = createNest(world, {
      onDestroy: (id) => {
        destroyedId = id;
      }
    });

    nest._integrityCheckCounter = ZOMBIE_NEST_CONFIG.INTEGRITY_CHECK_INTERVAL - 1;
    nest.update();
    assertEqual(nest.state, 'ACTIVE', '关键方块仍在时应保持激活');

    delete blocks['0,5,0'];
    nest._integrityCheckCounter = ZOMBIE_NEST_CONFIG.INTEGRITY_CHECK_INTERVAL - 1;
    nest.update();

    assertEqual(nest.state, 'DESTROYED', '关键方块消失后应失效');
    assertEqual(destroyedId, nest.id, '失效时应通知管理器');
  });

  test('到达刷怪时间且出生点合法时会刷怪', () => {
    const world = createMockWorld({
      '0,5,0': 'gold_block',
      '0,0,3': 'sand'
    });
    let spawnCount = 0;
    let lastSpawnPosition = null;
    const nest = createNest(world, {
      onSpawn: ({ position }) => {
        spawnCount++;
        lastSpawnPosition = position;
        return true;
      }
    });

    nest.lastSpawnTime = Date.now() - ZOMBIE_NEST_CONFIG.SPAWN_INTERVAL - 10;
    nest.trySpawnZombie();

    assertEqual(spawnCount, 1, '应刷出 1 只丧尸');
    assertNotNull(lastSpawnPosition, '应返回合法出生点');
    assertEqual(lastSpawnPosition.x, 0.5, '默认优先使用正前方出生点');
    assertEqual(lastSpawnPosition.y, 1, '出生高度应位于支撑方块上方一格');
    assertEqual(lastSpawnPosition.z, 3.5, 'Z 坐标应落在巢穴前方');
  });

  test('没有合法出生点时不会刷怪', () => {
    const world = createMockWorld({
      '0,5,0': 'gold_block'
    });
    let spawnCount = 0;
    const nest = createNest(world, {
      onSpawn: () => {
        spawnCount++;
        return true;
      }
    });

    nest.lastSpawnTime = Date.now() - ZOMBIE_NEST_CONFIG.SPAWN_INTERVAL - 10;
    const didSpawn = nest.trySpawnZombie();

    assertFalse(didSpawn, '没有出生点时不应刷怪');
    assertEqual(spawnCount, 0, '回调不应被调用');
  });
});

describe('ZombieNestManager 数量限制测试', (test) => {
  test('最多只能存在 8 个巢穴，失效后可继续放置', () => {
    const world = createMockWorld({
      '0,5,0': 'gold_block'
    });
    const manager = new ZombieNestManager(
      { add: () => {}, remove: () => {} },
      world,
      { addZombie: () => true }
    );

    const created = [];
    for (let i = 0; i < manager.maxNests; i++) {
      assertTrue(manager.canCreateNest(), `创建第 ${i + 1} 个巢穴前应允许放置`);
      created.push(manager.createNest({
        position: { x: i * 10, y: 0, z: 0 },
        structureBlocks: [{ x: i * 10, y: 5, z: 0, type: 'gold_block' }],
        criticalBlock: { x: i * 10, y: 5, z: 0, type: 'gold_block' }
      }));
    }

    assertFalse(manager.canCreateNest(), '达到上限后不应允许继续创建');
    assertEqual(manager.getNestCount(), manager.maxNests, 'getNestCount 应与 Map 大小一致');
    assertEqual(manager.getMaxNests(), manager.maxNests, 'getMaxNests 应返回上限值');

    const extraNest = manager.createNest({
      position: { x: 999, y: 0, z: 0 },
      structureBlocks: [{ x: 999, y: 5, z: 0, type: 'gold_block' }],
      criticalBlock: { x: 999, y: 5, z: 0, type: 'gold_block' }
    });

    assertTrue(created.every(Boolean), '前 8 个巢穴应创建成功');
    assertEqual(manager.nests.size, manager.maxNests, '活动巢穴数量应达到上限');
    assertEqual(extraNest, null, '第 9 个巢穴应创建失败');

    created[0].destroy();
    assertEqual(manager.nests.size, manager.maxNests - 1, '失效后应释放一个名额');

    const recycledNest = manager.createNest({
      position: { x: 1000, y: 0, z: 0 },
      structureBlocks: [{ x: 1000, y: 5, z: 0, type: 'gold_block' }],
      criticalBlock: { x: 1000, y: 5, z: 0, type: 'gold_block' }
    });

    assertNotNull(recycledNest, '释放名额后应可再次放置');
    assertEqual(manager.nests.size, manager.maxNests, '重新放置后应回到上限');
  });
});
