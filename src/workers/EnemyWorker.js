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
    lastUpdated: Date.now(),
    // S路线新增参数
    offsetAngle: 0,           // 当前偏移角度（弧度）
    targetOffsetAngle: 0      // 目标偏移角度（弧度）
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

  // 预构建所有敌人的简化数组（用于排斥力计算）
  const allEnemies = [];
  for (const id in enemies) {
    const enemy = enemies[id];
    allEnemies.push({
      id: enemy.id,
      position: enemy.position
    });
  }

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

    // AI决策：计算期望速度（包含排斥力）
    updateAI(enemy, playerPosition, allEnemies);

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

/**
 * 计算单个丧尸的排斥力（基于其他所有丧尸的位置）
 * @param {Object} enemy - 当前丧尸
 * @param {Array} allEnemies - 所有丧尸的数组（包含位置信息）
 * @returns {{x: number, z: number}} 排斥力向量
 */
function calculateSeparationForce(enemy, allEnemies) {
  let forceX = 0;
  let forceZ = 0;
  const minDistance = 1.2; // 最小安全距离，略大于丧尸宽度
  const repulsionStrength = 0.05; // 排斥力强度

  for (const other of allEnemies) {
    // 跳过自己
    if (other.id === enemy.id) continue;

    const dx = enemy.position.x - other.position.x;
    const dz = enemy.position.z - other.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // 如果距离太近，计算排斥力
    if (distance < minDistance && distance > 0.001) {
      // 距离越近，排斥力越大
      const force = (minDistance - distance) / minDistance * repulsionStrength;
      // 归一化方向向量并乘以力度
      forceX += (dx / distance) * force;
      forceZ += (dz / distance) * force;
    }
  }

  return { x: forceX, z: forceZ };
}

/**
 * AI更新逻辑 - 计算期望速度（包含AI决策和排斥力）
 * @param {Object} enemy - 当前丧尸
 * @param {Object} playerPosition - 玩家位置
 * @param {Array} allEnemies - 所有丧尸数组，用于计算排斥力
 */
function updateAI(enemy, playerPosition, allEnemies) {
  if (!playerPosition) return;

  const dx = playerPosition.x - enemy.position.x;
  const dy = playerPosition.y - enemy.position.y;
  const dz = playerPosition.z - enemy.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 基础AI速度
  let aiVelocityX = 0;
  let aiVelocityZ = 0;

  // 检查玩家是否在感知范围内
  if (distance <= enemy.perceptionRange) {
    // 进入追逐状态
    enemy.state = 'chasing';
    enemy.target = {...playerPosition};

    // 计算移动方向
    if (distance > 0.5) { // 避免除零
      aiVelocityX = (dx / distance) * enemy.speed;
      aiVelocityZ = (dz / distance) * enemy.speed;
    }
  } else if (distance > enemy.perceptionRange + 2) {
    // 距离太远，回到闲置状态
    enemy.state = 'idle';
    enemy.target = null;
  }

  // 计算排斥力（在Worker中批量计算）
  const separationForce = calculateSeparationForce(enemy, allEnemies);

  // 最终期望速度 = AI速度 + 排斥力
  enemy.velocity.x = aiVelocityX + separationForce.x;
  enemy.velocity.z = aiVelocityZ + separationForce.z;
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
