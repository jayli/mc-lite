// src/tests/test-minecart-movement.js
/**
 * 矿车移动停止点回归测试
 */

import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { MinecartMovementSystem } from '../actors/minecart/MinecartMovementSystem.js';
import { MINECART_SPEED } from '../constants/GameConfig.js';

function createTrackWorld(trackTypesByPos) {
  return {
    getBlockEntry(x, y, z) {
      const key = `${x},${y},${z}`;
      const type = trackTypesByPos.get(key);
      return type ? { type, orientation: 0 } : null;
    }
  };
}

function createMinecart(startX, movementState) {
  return {
    id: 'minecart_test',
    position: { x: startX, y: 1, z: 0 },
    orientation: 2, // WEST
    movementState,
    velocity: { x: 0, z: 0 },
    linkedMinecarts: new Set(),
    lastTrackPosition: { x: Math.floor(startX), y: 1, z: 0 }
  };
}

function createMockManager() {
  return {
    updateMinecartPositionIndex() {},
    getMinecartAt() { return null; }
  };
}

function runUntilIdle(system, minecart, deltaTime = 0.6, maxSteps = 32) {
  for (let i = 0; i < maxSteps; i++) {
    if (minecart.movementState === 'IDLE') break;
    system.update(minecart, deltaTime, new Map(), createMockManager());
  }
}

function runWithTraceUntilIdle(system, minecart, deltaTime = 0.2, maxSteps = 64) {
  const trace = [];

  for (let i = 0; i < maxSteps; i++) {
    trace.push(minecart.position.x);
    if (minecart.movementState === 'IDLE') break;
    system.update(minecart, deltaTime, new Map(), createMockManager());
  }

  return trace;
}

function getLastMovingX(trace, finalX) {
  // trace 最后一个点是 IDLE 后位置（终点），取它前一个作为“停止前一帧”位置
  if (trace.length < 2) return finalX;
  return trace[trace.length - 2];
}

function runStepsWithStateTrace(system, minecart, steps = 20, deltaTime = 0.2) {
  const trace = [];
  for (let i = 0; i < steps; i++) {
    trace.push({
      x: minecart.position.x,
      z: minecart.position.z,
      orientation: minecart.orientation,
      movementState: minecart.movementState
    });
    if (minecart.movementState === 'IDLE') break;
    system.update(minecart, deltaTime, new Map(), createMockManager());
  }
  return trace;
}

describe('MinecartMovementSystem 停止点测试', (test) => {
  test('向左前进到轨道末端时应停在最后一格直轨中心', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(4, 'MOVING_FORWARD');

    runUntilIdle(system, minecart);

    assertEqual(minecart.movementState, 'IDLE', '矿车应停止');
    assertEqual(minecart.position.x, 0, '应停在最后一格轨道 x=0');
  });

  test('向右后退到轨道末端时应停在最后一格弯轨中心', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track_corner']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(0, 'MOVING_BACKWARD');

    runUntilIdle(system, minecart);

    assertEqual(minecart.movementState, 'IDLE', '矿车应停止');
    assertEqual(minecart.position.x, 4, '应停在最后一格轨道 x=4');
  });

  test('前进停止前不应出现 0.5 格错位闪动', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(4, 'MOVING_FORWARD');

    const deltaTime = 0.2;
    const trace = runWithTraceUntilIdle(system, minecart, deltaTime, 64);
    const lastMovingX = getLastMovingX(trace, minecart.position.x);
    const maxExpectedDistance = MINECART_SPEED * deltaTime + 1e-6;

    assertTrue(Math.abs(lastMovingX - 0) <= maxExpectedDistance, '停止前不应距终点超过一步位移');
    assertTrue(Math.abs(lastMovingX - 0.5) > 0.15, '不应在距终点约 0.5 格处触发停止');
    assertEqual(minecart.position.x, 0, '最终应停在 x=0');
  });

  test('后退停止前不应出现 0.5 格错位闪动', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(0, 'MOVING_BACKWARD');

    const deltaTime = 0.2;
    const trace = runWithTraceUntilIdle(system, minecart, deltaTime, 64);
    const lastMovingX = getLastMovingX(trace, minecart.position.x);
    const maxExpectedDistance = MINECART_SPEED * deltaTime + 1e-6;

    assertTrue(Math.abs(lastMovingX - 4) <= maxExpectedDistance, '停止前不应距终点超过一步位移');
    assertTrue(Math.abs(lastMovingX - 4.5) > 0.15, '不应在超过终点约 0.5 格处触发停止');
    assertEqual(minecart.position.x, 4, '最终应停在 x=4');
  });

  test('前进时前方轨道上有实心方块应在上一格停止', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track'],
      ['2,1,0', 'stone']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(4, 'MOVING_FORWARD');

    runUntilIdle(system, minecart, 0.2, 64);

    assertEqual(minecart.movementState, 'IDLE', '前方轨道有实心方块时应停止');
    assertEqual(minecart.position.x, 3, '应停在 x=3，不应穿入 x=2');
  });

  test('后退时前方轨道上有实心方块应在上一格停止', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track'],
      ['2,1,0', 'stone']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(0, 'MOVING_BACKWARD');

    runUntilIdle(system, minecart, 0.2, 64);

    assertEqual(minecart.movementState, 'IDLE', '前方轨道有实心方块时应停止');
    assertEqual(minecart.position.x, 1, '应停在 x=1，不应穿入 x=2');
  });

  test('前进遇到拐点时应完成左转并离开拐点（不应死循环变向）', () => {
    // 路径：x=2 -> x=1 -> x=0，然后左转到 z=1 -> z=2
    const tracks = new Map([
      ['2,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['0,0,0', 'sand_train_track'],
      ['0,0,1', 'sand_train_track'],
      ['0,0,2', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(2, 'MOVING_FORWARD');

    const trace = runStepsWithStateTrace(system, minecart, 24, 0.2);
    const cornerFrames = trace.filter((s) => Math.abs(s.x - 0) < 1e-6 && Math.abs(s.z - 0) < 1e-6).length;

    assertTrue(minecart.position.z > 0.5, '左转后应沿 z 正方向继续前进，离开拐点');
    assertTrue(cornerFrames <= 2, '拐点处不应出现多帧原地变向死循环');
  });
});
