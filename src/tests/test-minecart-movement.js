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

function createDynamicMinecartManager(minecarts) {
  return {
    updateMinecartPositionIndex() {},
    getMinecartAt(x, y, z) {
      for (const cart of minecarts.values()) {
        if (
          Math.floor(cart.position.x) === x &&
          Math.floor(cart.position.y) === y &&
          Math.floor(cart.position.z) === z
        ) {
          return cart;
        }
      }
      return null;
    }
  };
}

function updateMinecartsInOrder(system, carts, manager, order, dt = 0.2) {
  const reservations = new Map();
  for (const id of order) {
    const cart = carts.get(id);
    if (cart) {
      system.update(cart, dt, carts, manager, reservations);
    }
  }
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

  test('运动矿车碰撞静止矿车时应激活静止矿车沿同方向运动', () => {
    // 轨道：3 -> 2(B) -> 1 -> 0
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const movingA = createMinecart(3, 'MOVING_FORWARD'); // 向 WEST
    movingA.id = 'A';
    movingA.velocity = { x: -1, z: 0 };

    const staticB = createMinecart(2, 'MOVING_FORWARD');
    staticB.id = 'B';
    staticB.movementState = 'IDLE';
    staticB.velocity = { x: 0, z: 0 };

    const minecarts = new Map([
      ['A', movingA],
      ['B', staticB]
    ]);
    const manager = {
      updateMinecartPositionIndex() {},
      getMinecartAt(x, y, z) {
        if (x === 2 && y === 1 && z === 0) return staticB;
        return null;
      }
    };

    // A 首次跨越中心时会撞到 B，并触发激活
    system.update(movingA, 0.2, minecarts, manager);

    assertEqual(movingA.movementState, 'MOVING_FORWARD', '激活成功时 A 不应被停止');
    assertEqual(staticB.movementState, 'MOVING_FORWARD', 'B 应被激活开始运动');
    assertEqual(staticB.orientation, movingA.orientation, 'B 朝向应继承 A');
  });

  test('运动矿车碰撞静止矿车且激活条件不满足时 A 应停止', () => {
    // 轨道：3 -> 2(B) -> 1，且 B 前方 x=1 被 stone 阻挡
    const tracks = new Map([
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['1,1,0', 'stone']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const movingA = createMinecart(3, 'MOVING_FORWARD'); // 向 WEST
    movingA.id = 'A';
    movingA.velocity = { x: -1, z: 0 };

    const staticB = createMinecart(2, 'MOVING_FORWARD');
    staticB.id = 'B';
    staticB.movementState = 'IDLE';
    staticB.velocity = { x: 0, z: 0 };

    const minecarts = new Map([
      ['A', movingA],
      ['B', staticB]
    ]);
    const manager = {
      updateMinecartPositionIndex() {},
      getMinecartAt(x, y, z) {
        if (x === 2 && y === 1 && z === 0) return staticB;
        return null;
      }
    };

    system.update(movingA, 0.2, minecarts, manager);

    assertEqual(movingA.movementState, 'IDLE', 'B 不可激活时 A 应停止');
    assertEqual(staticB.movementState, 'IDLE', 'B 仍应保持静止');
  });

  test('A/B 同向运行撞上静止 C 且 C 可激活时，A/B/C 应同向连续运行且不重叠', () => {
    // 初始：A(6) -> B(5) -> C(4,IDLE)，方向都朝 WEST
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track'],
      ['5,0,0', 'sand_train_track'],
      ['6,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const cartA = createMinecart(6, 'MOVING_FORWARD');
    cartA.id = 'A';
    cartA.velocity = { x: -1, z: 0 };

    const cartB = createMinecart(5, 'MOVING_FORWARD');
    cartB.id = 'B';
    cartB.velocity = { x: -1, z: 0 };

    const cartC = createMinecart(4, 'MOVING_FORWARD');
    cartC.id = 'C';
    cartC.movementState = 'IDLE';
    cartC.velocity = { x: 0, z: 0 };

    const carts = new Map([
      ['A', cartA],
      ['B', cartB],
      ['C', cartC]
    ]);
    const manager = createDynamicMinecartManager(carts);

    // 固定更新顺序，模拟同一帧内 A/B/C 的时序
    for (let i = 0; i < 8; i++) {
      updateMinecartsInOrder(system, carts, manager, ['A', 'B', 'C'], 0.2);
    }

    assertEqual(cartA.movementState, 'MOVING_FORWARD', 'A 不应被错误停止');
    assertEqual(cartB.movementState, 'MOVING_FORWARD', 'B 不应被错误停止');
    assertEqual(cartC.movementState, 'MOVING_FORWARD', 'C 应被激活后持续运动');

    // 不能重叠：三辆车的格坐标必须互不相同，且顺序保持 A 在后、C 在前
    const ax = Math.floor(cartA.position.x);
    const bx = Math.floor(cartB.position.x);
    const cx = Math.floor(cartC.position.x);

    assertTrue(ax > bx && bx > cx, 'A/B/C 应保持前后顺序且不重叠');
  });

  test('已链接 A/B 同向运行撞上静止 C 时，B 不应错误停止且三车不重叠', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['3,0,0', 'sand_train_track'],
      ['4,0,0', 'sand_train_track'],
      ['5,0,0', 'sand_train_track'],
      ['6,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const cartA = createMinecart(6, 'MOVING_FORWARD');
    cartA.id = 'A';
    cartA.velocity = { x: -1, z: 0 };

    const cartB = createMinecart(5, 'MOVING_FORWARD');
    cartB.id = 'B';
    cartB.velocity = { x: -1, z: 0 };

    // 模拟“连载一起”状态
    cartA.linkedMinecarts.add('B');
    cartB.linkedMinecarts.add('A');

    const cartC = createMinecart(4, 'MOVING_FORWARD');
    cartC.id = 'C';
    cartC.movementState = 'IDLE';
    cartC.velocity = { x: 0, z: 0 };

    const carts = new Map([
      ['A', cartA],
      ['B', cartB],
      ['C', cartC]
    ]);
    const manager = createDynamicMinecartManager(carts);

    for (let i = 0; i < 8; i++) {
      updateMinecartsInOrder(system, carts, manager, ['A', 'B', 'C'], 0.2);
    }

    assertEqual(cartA.movementState, 'MOVING_FORWARD', 'A 应保持运行');
    assertEqual(cartB.movementState, 'MOVING_FORWARD', 'B 不应错误停止');
    assertEqual(cartC.movementState, 'MOVING_FORWARD', 'C 应被激活后运行');

    const ax = Math.floor(cartA.position.x);
    const bx = Math.floor(cartB.position.x);
    const cx = Math.floor(cartC.position.x);
    assertTrue(ax > bx && bx > cx, '链接状态下 A/B/C 仍应保持不重叠顺序');
  });

  test('前车 B 转向时后车 A 不应被置停，应在后续帧继续前进', () => {
    // 轨道：x 直线到 0 后向 +z 转向
    const tracks = new Map([
      ['3,0,0', 'sand_train_track'],
      ['2,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['0,0,0', 'sand_train_track'],
      ['0,0,1', 'sand_train_track'],
      ['0,0,2', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const cartA = createMinecart(2, 'MOVING_FORWARD');
    cartA.id = 'A';
    cartA.velocity = { x: -1, z: 0 };

    const cartB = createMinecart(1, 'MOVING_FORWARD');
    cartB.id = 'B';
    cartB.velocity = { x: -1, z: 0 };

    const carts = new Map([
      ['A', cartA],
      ['B', cartB]
    ]);
    const manager = createDynamicMinecartManager(carts);

    // 先让 B 到拐点并转向，再观察 A 是否会被错误置停
    for (let i = 0; i < 14; i++) {
      updateMinecartsInOrder(system, carts, manager, ['B', 'A'], 0.2);
    }

    assertEqual(cartA.movementState, 'MOVING_FORWARD', 'B 转向时 A 不应被置为 IDLE');
    assertTrue(cartA.position.x < 1, 'A 应继续前进（不应卡在 x=1）');
  });

  test('转角多通路时应优先左转（左可走时不应右转）', () => {
    // 当前在 (0,0) 朝 WEST，前方 WEST 无轨道，左右都有轨道（N/S）
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['0,0,-1', 'sand_train_track'], // 左侧（NORTH）
      ['0,0,1', 'sand_train_track']   // 右侧（SOUTH）
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));
    const minecart = createMinecart(0, 'MOVING_FORWARD');
    minecart.orientation = 2; // WEST

    // 触发一次“前方无轨道 -> 检查转向”
    system.update(minecart, 0.2, new Map(), createMockManager(), new Map());

    assertEqual(minecart.orientation, 3, '应优先左转到 NORTH(3)');
    assertEqual(minecart.movementState, 'MOVING_FORWARD', '左转后应保持运动状态');
  });

  test('两矿车同时驶向同一转角格时不应进入同一格（防穿模）', () => {
    // 共同目标转角格：(0,0,0)
    // A: 从上方向下（NORTH -> SOUTH）
    // B: 从右向左（EAST -> WEST）
    const tracks = new Map([
      ['0,0,-1', 'sand_train_track'],
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track'],
      ['0,0,1', 'sand_train_track'],
      ['-1,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const cartA = createMinecart(0, 'MOVING_FORWARD');
    cartA.id = 'A';
    cartA.position.z = -1;
    cartA.orientation = 1; // SOUTH (+z)
    cartA.velocity = { x: 0, z: 1 };
    cartA.lastTrackPosition = { x: 0, y: 1, z: -1 };

    const cartB = createMinecart(1, 'MOVING_FORWARD');
    cartB.id = 'B';
    cartB.position.z = 0;
    cartB.orientation = 2; // WEST (-x)
    cartB.velocity = { x: -1, z: 0 };
    cartB.lastTrackPosition = { x: 1, y: 1, z: 0 };

    const carts = new Map([
      ['A', cartA],
      ['B', cartB]
    ]);
    const manager = createDynamicMinecartManager(carts);

    let overlapped = false;
    for (let i = 0; i < 8; i++) {
      updateMinecartsInOrder(system, carts, manager, ['A', 'B'], 0.2);
      const sameCell =
        Math.floor(cartA.position.x) === Math.floor(cartB.position.x) &&
        Math.floor(cartA.position.y) === Math.floor(cartB.position.y) &&
        Math.floor(cartA.position.z) === Math.floor(cartB.position.z);
      if (sameCell) {
        overlapped = true;
        break;
      }
    }

    assertEqual(overlapped, false, '并发驶入转角时不应进入同一格');
  });

  test('目标格被其他运动矿车跨帧声明时，本车应等待避免穿模', () => {
    const tracks = new Map([
      ['0,0,0', 'sand_train_track'],
      ['1,0,0', 'sand_train_track']
    ]);
    const system = new MinecartMovementSystem(createTrackWorld(tracks));

    const cartA = createMinecart(1, 'MOVING_FORWARD');
    cartA.id = 'A';
    cartA.orientation = 2; // WEST
    cartA.velocity = { x: -1, z: 0 };
    cartA.pendingTargetCell = { x: 0, y: 1, z: 0 }; // 模拟其他车已在上一帧声明

    const cartB = createMinecart(1, 'MOVING_FORWARD');
    cartB.id = 'B';
    cartB.orientation = 2; // WEST
    cartB.velocity = { x: -1, z: 0 };

    const carts = new Map([
      ['A', cartA],
      ['B', cartB]
    ]);
    const manager = {
      updateMinecartPositionIndex() {},
      // 目标格当前为空，仅靠声明冲突阻止 B 进入
      getMinecartAt() { return null; }
    };

    const xBefore = cartB.position.x;
    system.update(cartB, 0.2, carts, manager, new Map());

    assertEqual(cartB.position.x, xBefore, '应等待，不应推进到已被声明的目标格');
    assertEqual(cartB.movementState, 'MOVING_FORWARD', '等待时不应被置停');
  });
});
