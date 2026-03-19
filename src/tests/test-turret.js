// src/tests/test-turret.js
/**
 * 炮塔目标选择与遮挡逻辑测试
 */

import { describe } from './runner.js';
import { assertEqual, assertFalse, assertNotNull, assertNull, assertTrue } from './assert.js';
import * as THREE from 'three';
import { Turret } from '../actors/turret/Turret.js';

function createMockScene() {
  return {
    add: () => {},
    remove: () => {}
  };
}

function createMockWorld(blocks = {}) {
  return {
    getBlock: (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      return blocks[key] ?? null;
    }
  };
}

function createEnemy(x, y, z) {
  return {
    id: `z_${x}_${y}_${z}`,
    position: new THREE.Vector3(x, y, z),
    isActive: true,
    isDead: false
  };
}

function createTurretWithWorld(world) {
  return new Turret({
    id: 'turret_test',
    position: new THREE.Vector3(0, 0, 0),
    world,
    scene: createMockScene(),
    onFire: null,
    initialRotation: 0
  });
}

describe('Turret 遮挡与目标选择测试', (test) => {
  test('无遮挡时可锁定目标', () => {
    const world = createMockWorld();
    const turret = createTurretWithWorld(world);
    const enemy = createEnemy(10, 2.1, 0.5);

    const visible = turret.hasLineOfSightToEnemy(enemy);
    turret.findTarget([enemy]);

    assertTrue(visible, '无遮挡时应有视线');
    assertNotNull(turret.targetEnemy, '应锁定目标');
    assertEqual(turret.targetEnemy.id, enemy.id, '应锁定该丧尸');
  });

  test('中间有实心不透明方块时不锁定目标', () => {
    const world = createMockWorld({
      '5,3,0': 'stone'
    });
    const turret = createTurretWithWorld(world);
    const enemy = createEnemy(10, 2.1, 0.5);

    const visible = turret.hasLineOfSightToEnemy(enemy);
    turret.findTarget([enemy]);

    assertFalse(visible, 'stone 应阻挡视线');
    assertNull(turret.targetEnemy, '被阻挡时不应锁定');
  });

  test('中间有透明方块时仍可锁定目标', () => {
    const world = createMockWorld({
      '5,3,0': 'glass_block'
    });
    const turret = createTurretWithWorld(world);
    const enemy = createEnemy(10, 2.1, 0.5);

    const visible = turret.hasLineOfSightToEnemy(enemy);
    turret.findTarget([enemy]);

    assertTrue(visible, '玻璃不应阻挡视线');
    assertNotNull(turret.targetEnemy, '应可锁定透明方块后的目标');
    assertEqual(turret.targetEnemy.id, enemy.id, '应锁定该丧尸');
  });

  test('多个目标时选择最近的可见目标', () => {
    const world = createMockWorld({
      '3,3,0': 'stone'
    });
    const turret = createTurretWithWorld(world);
    const blockedNearEnemy = createEnemy(6, 2.1, 0.5);
    const visibleFarEnemy = createEnemy(12, 2.1, 2.5);

    turret.findTarget([blockedNearEnemy, visibleFarEnemy]);

    assertNotNull(turret.targetEnemy, '应至少锁定一个可见目标');
    assertEqual(turret.targetEnemy.id, visibleFarEnemy.id, '应跳过被阻挡目标并选择可见目标');
  });

  test('所有目标被阻挡时清空目标并回到默认朝向', () => {
    const world = createMockWorld({
      '3,3,0': 'stone',
      '5,3,1': 'stone'
    });
    const turret = createTurretWithWorld(world);
    const enemyA = createEnemy(6, 2.1, 0.5);
    const enemyB = createEnemy(10, 2.1, 1.5);

    turret.findTarget([enemyA, enemyB]);

    assertNull(turret.targetEnemy, '全被阻挡时不应有目标');
    assertEqual(turret.targetRotation, turret.defaultRotation, '应回到默认偏航角');
    assertEqual(turret.targetPitch, 0, '应回到默认俯仰角');
  });
});
