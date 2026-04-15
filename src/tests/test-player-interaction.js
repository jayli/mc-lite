import * as THREE from 'three';
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { PlayerInteraction } from '../actors/player/PlayerInteraction.js';
import { GlobalBlockMeshManager } from '../world/GlobalBlockMeshManager.js';

function createWorldWithGlobalManager() {
  const scene = new THREE.Scene();
  const world = {
    scene,
    chunks: new Map([
      ['0,0', { group: new THREE.Group() }]
    ]),
    removed: [],
    blockEntries: new Map([
      ['1,2,3', { type: 'stone', orientation: 2 }]
    ]),
    globalBlockMeshManager: null,
    getBlock(x, y, z) {
      return this.blockEntries.get(`${x},${y},${z}`)?.type || null;
    },
    getBlockEntry(x, y, z) {
      return this.blockEntries.get(`${x},${y},${z}`) || null;
    },
    removeBlock(x, y, z) {
      this.removed.push(`${x},${y},${z}`);
      this.blockEntries.delete(`${x},${y},${z}`);
    },
    spawnBlockCrashParticles() {},
    spawnParticles() {}
  };

  world.globalBlockMeshManager = new GlobalBlockMeshManager({
    scene,
    initialCapacity: 2,
    geometryResolver: () => new THREE.BoxGeometry(1, 1, 1),
    materialResolver: () => new THREE.MeshBasicMaterial(),
    attributePolicy: () => ({
      usesAO: true,
      usesOrientation: true,
      castsShadow: true,
      receivesShadow: true
    })
  });

  world.globalBlockMeshManager.upsertBlock({
    worldKey: '1,2,3',
    chunkKey: '0,0',
    blockType: 'stone',
    matrix: new THREE.Matrix4().makeTranslation(1, 2, 3),
    aoLow: 1,
    aoHigh: 2,
    orientation: 2
  });

  return world;
}

function createPlayer(world) {
  return {
    world,
    game: {},
    raycaster: {
      ray: {
        direction: new THREE.Vector3(1, 0, 0)
      }
    },
    _dummyMatrix: new THREE.Matrix4(),
    _dummyQuaternion: new THREE.Quaternion(),
    _dummyScale: new THREE.Vector3(),
    _tempVector: new THREE.Vector3(),
    _zeroVector: new THREE.Vector3(0, 0, 0),
    inventory: {
      added: [],
      add(type, count) {
        this.added.push({ type, count });
      }
    },
    recordRemovedBlock: null,
    lastRemovedBlock: null,
    spawnParticles() {}
  };
}

describe('PlayerInteraction 全局合批交互测试', (test) => {
  test('getInteractionTargets 应包含全局 InstancedMesh', () => {
    const world = createWorldWithGlobalManager();
    const player = createPlayer(world);
    const interaction = new PlayerInteraction(player);

    const targets = interaction.getInteractionTargets();

    assertEqual(targets.length, 2, '应包含 chunk.group 和全局 mesh');
    assertTrue(targets.some((target) => target.userData?.isGlobalBlockMesh), '应包含全局 InstancedMesh');

    world.globalBlockMeshManager.dispose();
  });

  test('_resolveBlockHitFromRaycast 应从全局 mesh 恢复 worldKey 坐标', () => {
    const world = createWorldWithGlobalManager();
    const player = createPlayer(world);
    const interaction = new PlayerInteraction(player);
    const mesh = world.globalBlockMeshManager.getMeshes()[0];

    const resolved = interaction._resolveBlockHitFromRaycast({
      object: mesh,
      instanceId: 0,
      point: new THREE.Vector3(1.5, 2.5, 3.5)
    });

    assertEqual(resolved.bx, 1, '应恢复正确的 x 坐标');
    assertEqual(resolved.by, 2, '应恢复正确的 y 坐标');
    assertEqual(resolved.bz, 3, '应恢复正确的 z 坐标');
    assertEqual(resolved.type, 'stone', '应恢复正确的方块类型');

    world.globalBlockMeshManager.dispose();
  });

  test('removeBlock 应对全局 mesh 调用全局管理器和 world.removeBlock', () => {
    const world = createWorldWithGlobalManager();
    const player = createPlayer(world);
    const interaction = new PlayerInteraction(player);
    const mesh = world.globalBlockMeshManager.getMeshes()[0];

    interaction.removeBlock({
      object: mesh,
      instanceId: 0,
      point: new THREE.Vector3(1.5, 2.5, 3.5),
      face: { normal: new THREE.Vector3(-1, 0, 0) }
    }, true);

    assertEqual(world.removed.length, 1, '应调用 world.removeBlock');
    assertEqual(world.removed[0], '1,2,3', '应删除命中的 worldKey');
    assertEqual(world.globalBlockMeshManager.getStats().totalBlocks, 0, '全局管理器应立即移除对应实例');

    world.globalBlockMeshManager.dispose();
  });
});

console.log('test-player-interaction: ok');
