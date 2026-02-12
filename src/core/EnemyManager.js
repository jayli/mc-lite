// src/core/EnemyManager.js
// 敌人管理器，用于与EnemyWorker通信并在主线程管理丧尸实体

import { ZombieInstancedRenderer } from '../entities/enemy/ZombieInstancedRenderer.js';

export class EnemyManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    // 存储丧尸实例 Map<uuid, Zombie>
    this.zombies = new Map();
    this.maxActiveZombies = 20; // 最大活跃丧尸数（默认值）

    // 实例化渲染器
    this.renderer = new ZombieInstancedRenderer(scene, 200);

    // 启动敌人Worker
    this.worker = new Worker(new URL('../workers/EnemyWorker.js', import.meta.url));
    this.setupWorkerCommunication();
  }

  setupWorkerCommunication() {
    this.worker.onmessage = (e) => {
      const { action, payload } = e.data;

      switch(action) {
        case 'updates':
          this.processUpdates(payload);
          break;
        case 'sync':
          // 如果需要全量同步
          break;
      }
    };
  }

  /**
   * 添加丧尸实例到管理器
   * @param {Zombie} zombie - 丧尸实例
   * @returns {boolean} 添加是否成功
   */
  addZombie(zombie) {
    // 检查是否已达到最大活跃丧尸数
    if (this.zombies.size >= this.maxActiveZombies) {
      console.warn('已达到最大活跃丧尸数量限制');
      return false;
    }

    // 优先使用 id，如果没有则使用 mesh.uuid
    const id = zombie.id || (zombie.mesh ? zombie.mesh.uuid : THREE.MathUtils.generateUUID());
    zombie.id = id; // Ensure zombie has an ID

    this.zombies.set(id, zombie);

    // 将敌人数据发送到worker进行AI初始化
    this.worker.postMessage({
      action: 'init',
      payload: {
        id: id,
        data: {
          position: zombie.position,
          health: zombie.health,
          state: zombie.state,
          speed: zombie.speed,
          perceptionRange: zombie.perceptionRange
        }
      }
    });

    return true;
  }

  // 兼容旧接口（如果Game.js还没改完），但在我们的计划中会被addZombie替代
  // 保留此方法以防万一，但主要逻辑应迁移
  addEnemy(id, enemyData, mesh = null) {
    console.warn('EnemyManager.addEnemy is deprecated. Use addZombie instead.');
    // 如果这里被调用，说明我们只有数据和mesh，没有Zombie实例（丢失了物理逻辑）
    // 这就是问题的根源之一。必须确保我们有Zombie实例。
  }

  // 更新所有敌人
  updateAll(playerPosition, deltaTime) {
    // 1. 收集位置更新，准备发送给Worker
    const enemyUpdates = [];

    // 2. 在主线程执行物理更新（碰撞检测 + 重力 + 位置步进）
    // 注意：排斥力和AI速度已在Worker中计算，通过setDesiredVelocity应用
    const zombiesToRemove = [];
    for (const [id, zombie] of this.zombies) {
      // 检查是否已死亡
      if (!zombie.isAlive) {
        zombiesToRemove.push(id);
        continue;
      }

      // 执行物理模拟 (重力, 碰撞, 移动)
      zombie.update(this.world.getBlock.bind(this.world), deltaTime);

      // 收集新位置
      enemyUpdates.push({
        id: id,
        x: zombie.position.x,
        y: zombie.position.y,
        z: zombie.position.z
      });
    }

    // 移除死亡的丧尸
    for (const id of zombiesToRemove) {
      this.removeEnemy(id);
    }

    // 更新实例化渲染器
    this.renderer.update(this.zombies);

    // 3. 发送给Worker进行AI计算（包含排斥力计算）
    this.worker.postMessage({
      action: 'update',
      payload: {
        deltaTime: deltaTime,
        playerPosition: playerPosition,
        enemyUpdates: enemyUpdates
      }
    });
  }

  // 处理来自Worker的AI更新
  processUpdates(updates) {
    for (const update of updates) {
      const { id, action, desiredVelocity, state, health } = update;

      if (action === 'remove') {
        this.removeEnemy(id);
        continue;
      } else if (action === 'update') {
        const zombie = this.zombies.get(id);
        if (zombie) {
          // 应用AI意图（期望速度）
          if (desiredVelocity) {
            zombie.setDesiredVelocity(desiredVelocity.x, desiredVelocity.z);
          }

          // 同步状态
          if (state) zombie.state = state;
          if (health !== undefined) zombie.health = health;

          if (zombie.health <= 0) {
            this.removeEnemy(id);
          }
        }
      }
    }
  }

  // 移除敌人
  removeEnemy(id) {
    const zombie = this.zombies.get(id);

    if (zombie) {
      // 视觉移除已经由 renderer.update() 自动处理（下一帧不再渲染）
      // 如果使用了原始mesh且在场景中，需要移除
      if (zombie.mesh && zombie.mesh.parent) {
        zombie.mesh.parent.remove(zombie.mesh);
      }

      this.zombies.delete(id);

      // 通知worker移除（如果是由主线程发起的移除，防止循环）
      // 但通常remove是由Worker发起的，所以这里可能多余，但为了保险
      this.worker.postMessage({
        action: 'remove',
        payload: { id: id }
      });
    }
  }

  // 应用伤害到敌人
  applyDamageToEnemy(id, damage) {
    // 先在本地扣血，提供即时反馈（可选）
    const zombie = this.zombies.get(id);
    if (zombie) {
      zombie.takeDamage(damage);
    }

    // 通知Worker同步血量（Worker是权威数据源）
    this.worker.postMessage({
      action: 'updateEnemy',
      payload: {
        id: id,
        data: { damage: damage }
      }
    });
  }

  // 获取所有敌人
  getAllEnemies() {
    return Array.from(this.zombies.values());
  }

  // 获取渲染网格（用于射线检测）
  getRenderMeshes() {
    if (this.renderer && this.renderer.meshes) {
      return Object.values(this.renderer.meshes);
    }
    return [];
  }

  // 销毁管理器
  destroy() {
    if (this.worker) {
      this.worker.terminate();
    }

    for (const id of this.zombies.keys()) {
      this.removeEnemy(id);
    }
  }
}
