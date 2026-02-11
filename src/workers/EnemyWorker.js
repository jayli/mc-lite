// src/workers/EnemyWorker.js
// 敌人运动计算Worker，主要处理AI决策（寻路、状态机）
// 物理位置更新交由主线程处理，因为主线程拥有完整的World数据

// 存储敌人的状态
const enemies = {};

// 处理来自主线程的消息
self.onmessage = function(e) {
  const { action, payload } = e.data;

  switch(action) {
    case 'init':
      initEnemy(payload.id, payload.data);
      break;
    case 'remove':
      removeEnemy(payload.id);
      break;
    case 'update':
      // 接收主线程传来的最新位置数据（如果包含在payload中）
      if (payload.enemyUpdates) {
        syncPositions(payload.enemyUpdates);
      }
      updateEnemies(payload.deltaTime, payload.playerPosition);
      break;
    case 'updateEnemy':
      updateEnemyState(payload.id, payload.data);
      break;
  }
};

// 初始化一个敌人
function initEnemy(id, data) {
  enemies[id] = {
    id: id,
    position: {...data.position},
    velocity: {x: 0, y: 0, z: 0},
    target: data.target || null,
    state: data.state || 'idle', // idle, chasing, attacking
    health: data.health || 100,
    maxHealth: data.health || 100,
    speed: data.speed || 0.02,
    perceptionRange: data.perceptionRange || 10,
    lastUpdated: Date.now()
  };
}

// 删除一个敌人
function removeEnemy(id) {
  delete enemies[id];
}

// 同步位置（来自主线程的权威数据）
function syncPositions(updates) {
  for (const update of updates) {
    const enemy = enemies[update.id];
    if (enemy) {
      enemy.position.x = update.x;
      enemy.position.y = update.y;
      enemy.position.z = update.z;
    }
  }
}

// 更新所有敌人AI状态
function updateEnemies(deltaTime, playerPosition) {
  const results = [];

  for (const id in enemies) {
    const enemy = enemies[id];

    // 距离检查：仅更新附近的敌人AI
    if (playerPosition) {
      const dx = enemy.position.x - playerPosition.x;
      const dy = enemy.position.y - playerPosition.y;
      const dz = enemy.position.z - playerPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // 如果敌人离玩家太远，降低更新频率或跳过
      if (distance > 60) continue;
    }

    // AI决策：计算期望速度
    updateAI(enemy, playerPosition);

    // 检查敌人状态
    if (enemy.health <= 0) {
      results.push({
        id: enemy.id,
        action: 'remove'
      });
      delete enemies[id];
    } else {
      results.push({
        id: enemy.id,
        action: 'update',
        // 我们不再返回position，而是返回期望速度(desiredVelocity)和状态
        desiredVelocity: {...enemy.velocity},
        state: enemy.state,
        health: enemy.health
      });
    }
  }

  // 发送更新结果到主线程
  self.postMessage({
    action: 'updates',
    payload: results
  });
}

// AI更新逻辑
function updateAI(enemy, playerPosition) {
  if (!playerPosition) return;

  const dx = playerPosition.x - enemy.position.x;
  const dy = playerPosition.y - enemy.position.y;
  const dz = playerPosition.z - enemy.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 检查玩家是否在感知范围内
  if (distance <= enemy.perceptionRange) {
    // 进入追逐状态
    enemy.state = 'chasing';
    enemy.target = {...playerPosition};

    // 计算移动方向
    if (distance > 0.5) { // 避免除零
      const moveX = (dx / distance) * enemy.speed;
      const moveZ = (dz / distance) * enemy.speed;
      enemy.velocity.x = moveX;
      enemy.velocity.z = moveZ;
    } else {
      // 接近玩家时减速
      enemy.velocity.x *= 0.5;
      enemy.velocity.z *= 0.5;
    }
  } else if (distance > enemy.perceptionRange + 2) {
    // 距离太远，回到闲置状态
    enemy.state = 'idle';
    enemy.target = null;
    enemy.velocity.x = 0;
    enemy.velocity.z = 0;
  }
}

// 更新特定敌人状态（例如受到伤害）
function updateEnemyState(id, data) {
  if (enemies[id]) {
    // 应用伤害
    if (data.damage) {
      enemies[id].health = Math.max(0, enemies[id].health - data.damage);
    }

    // 更新状态
    if (data.state) {
      enemies[id].state = data.state;
    }
  }
}
