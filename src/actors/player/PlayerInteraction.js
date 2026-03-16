// src/actors/player/PlayerInteraction.js
/**
 * 玩家交互系统 - 处理交互、方块操作、爆炸等
 * 物理切分自 Player.js，逻辑 100% 一致
 */
import * as THREE from 'three';
import { audioManager } from '../../core/AudioManager.js';
import { chestManager } from '../../world/entities/Chest.js';
import { getBlockProperties } from '../../constants/BlockData.js';
import { nextOrientation } from '../../utils/OrientationUtils.js';
import { Gun, WEAPON_TYPES } from '../weapon/Gun.js';
import { gunModel, mag7Model, minigunModel } from '../../core/Engine.js';

/**
 * 从对象向上查找特殊实体
 * @param {THREE.Object3D} obj - 起始对象
 * @returns {THREE.Object3D|null} - 特殊实体或 null
 */
function findSpecialEntityFromHit(obj) {
  let current = obj;
  while (current && current.type !== 'Scene') {
    if (current.userData?.isEntity && Array.isArray(current.userData?.collisionBlocks)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export class PlayerInteraction {
  /**
   * @param {Player} player - 玩家实例
   */
  constructor(player) {
    this.player = player;
  }

  /**
   * 获取交互目标对象
   * @returns {Array} 交互目标对象数组
   */
  getInteractionTargets() {
    const targets = [];
    for (const chunk of this.player.world.chunks.values()) targets.push(chunk.group);

    // 添加丧尸作为交互目标（如果游戏有敌人管理器）
    if (this.player.game && this.player.game.enemyManager) {
      // 从EnemyManager获取渲染网格（InstancedMesh）
      if (typeof this.player.game.enemyManager.getRenderMeshes === 'function') {
        const renderMeshes = this.player.game.enemyManager.getRenderMeshes();
        targets.push(...renderMeshes);
      }

      // 从EnemyManager获取所有敌人实例
      const enemies = this.player.game.enemyManager.getAllEnemies();
      for (const enemy of enemies) {
        if (enemy.mesh) {
          targets.push(enemy.mesh);
        }
      }
    }

    chestManager.chestAnimations.forEach(anim => {
      if (anim.mesh) targets.push(anim.mesh);
    });
    return targets;
  }

  /**
   * 从命中对象向上查找绑定碰撞块的特殊实体
   * @param {THREE.Object3D} obj - 命中对象
   * @returns {THREE.Object3D|null} 特殊实体对象
   */
  findSpecialEntityFromHit(obj) {
    return findSpecialEntityFromHit(obj);
  }

  /**
   * 处理交互事件
   * @param {Event} e - 鼠标事件
   */
  interact(e) {
    if (document.pointerLockElement !== document.body) return;
    const button = e.button;
    this.player.raycaster.setFromCamera(this.player.center, this.player.camera);
    const targets = this.getInteractionTargets();
    const hits = this.player.raycaster.intersectObjects(targets, true);

    if (button === 2) {
      const heldItem = this.player.inventory.getSelected()?.item;
      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0], m = hit.object, instanceId = hit.instanceId;
        if (m.userData.type === 'chest' && m.isInstancedMesh) {
          m.getMatrixAt(instanceId, this.player._dummyMatrix);
          this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
          if (!m.userData.chests[instanceId].open) {
            this.openChest(m, instanceId, this.player._tempVector);
            this.swing();
            return;
          }
        }
        if (heldItem && this.player.inventory.has(heldItem)) {
          // 统一使用 hit.point 计算点击的面，确保旋转方块的正确性
          const blockPos = this._getBlockPositionFromHit(hit);
          if (this.tryPlaceBlock(blockPos.x, blockPos.y, blockPos.z, heldItem)) this.swing();
        }
      } else if (heldItem && this.player.inventory.has(heldItem)) {
        this.doSkyPlace(heldItem);
      }
    } else if (button === 0) {
      if (this.player.weaponMode !== WEAPON_TYPES.ARM) {
        this.player.isShooting = true;
        if (this.player.shootCooldown <= 0) {
          if (this.player.weaponMode === WEAPON_TYPES.MAG7) {
            this.player.executeMag7Shot();
            this.player.shootCooldown = 1.5;
          } else {
            this.player.executeShot(targets);
            this.player.shootCooldown = this.player.weapon.config.fireRate;
          }
        }
        return;
      }
      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0], m = hit.object, type = m.userData.type || 'unknown';
        if (e.ctrlKey) {
          if (type === 'tnt') {
            if (m.isInstancedMesh) {
              m.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
              this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
            } else {
              this.player._tempVector.copy(m.position);
            }
            if (!this.player.ignitingTNTs.has(`${this.player._tempVector.x},${this.player._tempVector.y},${this.player._tempVector.z}`)) {
              this.player.ignitingTNTs.add(`${this.player._tempVector.x},${this.player._tempVector.y},${this.player._tempVector.z}`);
              this.explode(this.player._tempVector.x, this.player._tempVector.y, this.player._tempVector.z);
              this.swing();
            }
          }
          return;
        }
        if (type === 'chest' && m.isInstancedMesh) {
          m.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
          this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
          if (!m.userData.chests[hit.instanceId].open) {
            this.openChest(m, hit.instanceId, this.player._tempVector);
            this.swing();
            return;
          }
        }
        this.removeBlock(hit, true);
        this.swing();
      } else {
        this.swing();
      }
    }
  }

  /**
   * 从射线检测击中信息计算放置位置
   * @param {Object} hit - 射线检测击中信息
   * @returns {{ x: number, y: number, z: number }} 放置位置
   */
  _getBlockPositionFromHit(hit) {
    const m = hit.object;
    // 获取方块的世界空间位置
    let blockWorldPos;
    if (m.isInstancedMesh) {
      m.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
      this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
      blockWorldPos = this.player._tempVector;
    } else {
      blockWorldPos = m.position;
    }

    const blockX = Math.floor(blockWorldPos.x);
    const blockY = Math.floor(blockWorldPos.y);
    const blockZ = Math.floor(blockWorldPos.z);

    // 计算击中点相对于方块中心 (块中心 +0.5) 的偏移
    const dx = hit.point.x - (blockX + 0.5);
    const dy = hit.point.y - (blockY + 0.5);
    const dz = hit.point.z - (blockZ + 0.5);

    // 找到绝对值最大的轴，确定点击的面
    const absX = Math.abs(dx), absY = Math.abs(dy), absZ = Math.abs(dz);
    let nx = 0, ny = 0, nz = 0;
    if (absX >= absY && absX >= absZ) {
      nx = dx > 0 ? 1 : -1;
    } else if (absY >= absX && absY >= absZ) {
      ny = dy > 0 ? 1 : -1;
    } else {
      nz = dz > 0 ? 1 : -1;
    }

    return {
      x: Math.floor(blockWorldPos.x + nx),
      y: Math.floor(blockWorldPos.y + ny),
      z: Math.floor(blockWorldPos.z + nz)
    };
  }

  /**
   * 打开宝箱
   * @param {THREE.Mesh} mesh - 宝箱网格对象
   * @param {number} instanceId - 实例ID
   * @param {THREE.Vector3} pos - 宝箱位置
   */
  openChest(mesh, instanceId, pos) {
    const info = mesh.userData.chests[instanceId];
    if (!info || info.open) return;
    info.open = true;
    chestManager.spawnChestAnimation(pos, this.player.world.scene);
    mesh.getMatrixAt(instanceId, this.player._dummyMatrix);
    this.player._dummyMatrix.scale(this.player._zeroVector);
    mesh.setMatrixAt(instanceId, this.player._dummyMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    const drops = pos.y > 60 ? [
        'diamond', 'god_sword', 'gold_apple'
    ] : [['diamond', 'gold', 'apple', 'bookbox', 'planks'][Math.floor(Math.random() * 5)]].concat(
      [['diamond', 'gold', 'apple', 'bookbox', 'planks'][Math.floor(Math.random() * 5)]]
    );
    drops.forEach(item => this.player.inventory.add(item, 1));
  }

  /**
   * 尝试放置方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @param {string} type - 方块类型
   * @returns {boolean} 是否成功放置
   */
  tryPlaceBlock(x, y, z, type) {
    if (this.player.physics.isSolid(x, y, z)) return false;
    if (this.player.position.x - 0.3 < x + 1 &&
      this.player.position.x + 0.3 > x &&
      this.player.position.y < y + 1 &&
      this.player.position.y + 1.8 > y &&
      this.player.position.z - 0.3 < z + 1 &&
      this.player.position.z + 0.3 > z) return false;
    // 获取放置朝向（只有在同一位置移除并放置相同方块时才旋转）
    const orientation = this.getPlacementOrientation(x, y, z, type);
    // 放置后清除移除记忆
    this.clearRemovedBlock();
    this.player.world.setBlock(x, y, z, type, orientation);
    this.player.inventory.remove(type, 1);
    audioManager.playSound('put', 0.3);
    return true;
  }

  /**
   * 记录方块移除时的位置和朝向
   */
  recordRemovedBlock(x, y, z, type, orientation) {
    this.player.lastRemovedBlock = { x, y, z, type, orientation };
  }

  /**
   * 清除移除方块的记忆
   */
  clearRemovedBlock() {
    this.player.lastRemovedBlock = null;
  }

  /**
   * 获取放置方块的朝向
   */
  getPlacementOrientation(x, y, z, type) {
    const props = getBlockProperties(type);
    if (!props.orientationEnabled) {
      return 0;
    }

    // 检查是否在同一位置放置相同类型的方块（用于旋转）
    const isRebuildingSameBlock = this.player.lastRemovedBlock &&
        this.player.lastRemovedBlock.x === x &&
        this.player.lastRemovedBlock.y === y &&
        this.player.lastRemovedBlock.z === z &&
        this.player.lastRemovedBlock.type === type;

    // 获取该物品类型上次记住的朝向
    const lastOrientation = this.player.placementOrientationMemory.get(type);

    let newOrientation;

    if (isRebuildingSameBlock) {
      // 同一位置、相同类型，顺时针旋转 90 度
      newOrientation = nextOrientation(this.player.lastRemovedBlock.orientation);
      // 更新记忆
      this.player.placementOrientationMemory.set(type, newOrientation);
    } else if (lastOrientation !== undefined) {
      // 有记忆，沿用记忆的朝向
      newOrientation = lastOrientation;
    } else {
      // 没有记忆，使用默认朝东
      newOrientation = 0;
    }

    return newOrientation;
  }

  /**
   * 移除方块
   * @param {Object} hit - 点击命中信息
   * @param {boolean} isHandBreak - 是否是徒手破坏
   */
  removeBlock(hit, isHandBreak = false) {
    let m = hit.object;
    while (m && !m.userData.isEntity && !m.userData.type && m.parent && !m.isInstancedMesh && m.type !== 'Scene') m = m.parent;
    const type = m.userData.type || 'unknown';

    // 检查是否为不可破坏方块
    if (type === 'end_stone' || type === 'playground_block' || type === 'playground_center_block') return;

    if (m.isInstancedMesh) {
      m.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
      this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
      // 记录方块位置和朝向到放置记忆
      const bx = Math.floor(this.player._tempVector.x), by = Math.floor(this.player._tempVector.y), bz = Math.floor(this.player._tempVector.z);
      const entry = this.player.world.getBlockEntry(bx, by, bz);
      if (entry) {
        this.recordRemovedBlock(bx, by, bz, entry.type, entry.orientation);
      }
      this.player._dummyMatrix.scale(this.player._zeroVector);
      m.setMatrixAt(hit.instanceId, this.player._dummyMatrix);
      m.instanceMatrix.needsUpdate = true;
      // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
      if (isHandBreak) {
        this.player.world.spawnBlockCrashParticles(this.player._tempVector);
      } else {
        this.player.spawnParticles(this.player._tempVector, type);
      }
      this.player.world.removeBlock(bx, by, bz);
      audioManager.playSound('delete_get', 0.3);
      if (type !== 'water' && type !== 'cloud') this.player.inventory.add(type === 'grass' ? 'dirt' : type, 1);
    } else {
      if (m.userData.isEntity) {
        if (m.userData.collisionBlocks) m.userData.collisionBlocks.forEach(p => this.player.world.removeBlockCollider(p.x, p.y, p.z));
        if (m.parent) m.parent.remove(m);
        // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
        if (isHandBreak) {
          this.player.world.spawnBlockCrashParticles(m.position);
        } else {
          this.player.spawnParticles(m.position, type || 'stone');
        }
        if (type === 'chest') {
          this.player.world.removeBlock(Math.floor(m.position.x), Math.floor(m.position.y), Math.floor(m.position.z));
          this.player.inventory.add('chest', 1);
          audioManager.playSound('delete_get', 0.3);
        }
      } else {
        const bx = Math.floor(m.position.x), by = Math.floor(m.position.y), bz = Math.floor(m.position.z);
        // 记录方块位置和朝向到放置记忆
        const entry = this.player.world.getBlockEntry(bx, by, bz);
        if (entry) {
          this.recordRemovedBlock(bx, by, bz, entry.type, entry.orientation);
        }
        this.player.world.removeBlock(bx, by, bz);
        audioManager.playSound('delete_get', 0.3);
        // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
        if (isHandBreak) {
          this.player.world.spawnBlockCrashParticles(m.position);
        } else {
          this.player.spawnParticles(m.position, type);
        }
        if (m.parent) m.parent.remove(m);
        if (type === 'realistic_trunk') this.player.inventory.add('wood', 1);
        else if (type === 'realistic_leaves') { if (Math.random() < 0.8) this.player.inventory.add('leaves', 1); }
        else this.player.inventory.add(type, 1);
      }
    }
  }

  /**
   * 处理爆炸结果
   * @param {Object} data - 爆炸结果数据
   */
  handleExplosionResult(data) {
    if (data.action === 'explosionResult') {
      const { blocksToDestroy, tntToIgnite, center } = data.payload;
      const ignitingKeys = new Set(this.player.ignitingTNTs);
      tntToIgnite.forEach(tnt => ignitingKeys.add(`${tnt.x},${tnt.y},${tnt.z}`));
      this.player.world.removeBlocksBatch(blocksToDestroy.filter(p => {
        if (ignitingKeys.has(`${p.x},${p.y},${p.z}`)) return false;
        const type = this.player.world.getBlock(p.x, p.y, p.z);
        return type && (type !== 'end_stone' || this.player.world.getBlock(p.x, p.y - 1, p.z));
      }));
      tntToIgnite.forEach(tnt => {
        const key = `${tnt.x},${tnt.y},${tnt.z}`;
        if (this.player.ignitingTNTs.has(key)) return;
        this.player.ignitingTNTs.add(key);
        setTimeout(() => {
          this.player.world.removeBlock(tnt.x, tnt.y, tnt.z);
          this.player.ignitingTNTs.delete(key);
          this.explode(tnt.x, tnt.y, tnt.z);
        }, tnt.delay);
      });

      // 新增：TNT爆炸伤害范围内的丧尸
      if (this.player.game && this.player.game.enemyManager) {
        const explosionCenter = new THREE.Vector3(center.x + 0.5, center.y + 0.5, center.z + 0.5);
        const explosionRadius = 4; // 爆炸伤害范围（方块单位）
        const explosionDamage = 50; // 爆炸伤害值

        const allZombies = this.player.game.enemyManager.getAllEnemies();
        for (const zombie of allZombies) {
          const zombiePos = new THREE.Vector3(zombie.position.x, zombie.position.y + zombie.height / 2, zombie.position.z);
          const distance = explosionCenter.distanceTo(zombiePos);

          if (distance <= explosionRadius) {
            // 使用 EnemyManager 的 applyDamageToEnemy 方法，同时更新本地和 Worker 中的血量
            this.player.game.enemyManager.applyDamageToEnemy(zombie.id, explosionDamage);
            console.log(`[Explosion] 丧尸在爆炸范围内，造成 ${explosionDamage} 点伤害！`);
          }
        }
      }

      this.player._tempVector.set(center.x + 0.5, center.y + 0.5, center.z + 0.5);
      if (this.player.world.spawnExplosionParticles) this.player.world.spawnExplosionParticles(this.player._tempVector);
      audioManager.playSound('explosion', 0.4);
    }
  }

  /**
   * 引爆TNT
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   */
  explode(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (this.player.world.getBlock(bx, by, bz) === 'tnt') {
      this.player.world.removeBlock(bx, by, bz);
      this.player.ignitingTNTs.delete(`${bx},${by},${bz}`);
    }
    const nearbyDeltas = {};
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        for (let dz = -3; dz <= 3; dz++) {
          const tx = bx + dx, ty = by + dy, tz = bz + dz;
          const type = this.player.world.getBlock(tx, ty, tz);
          if (type) nearbyDeltas[`${tx},${ty},${tz}`] = type;
        }
    this.player.explosionWorker.postMessage({ action: 'calculateExplosion', payload: { x, y, z, nearbyDeltas } });
  }

  /**
   * 生成粒子效果
   * @param {THREE.Vector3} pos - 位置
   * @param {string} type - 粒子类型
   */
  spawnParticles(pos, type) {
    if (this.player.world.spawnParticles) this.player.world.spawnParticles(pos, type);
  }

  /**
   * 执行天空放置
   * @param {string} type - 方块类型
   */
  doSkyPlace(type) {
    const origin = this.player.camera.position;
    this.player.camera.getWorldDirection(this.player._direction);
    const step = 0.1, maxDist = 9;
    this.player._tempVector.copy(origin);
    const neighborOffsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for(let d=0; d<maxDist; d+=step) {
      this.player._tempVector.addScaledVector(this.player._direction, step);
      const rx = Math.floor(this.player._tempVector.x), ry = Math.floor(this.player._tempVector.y), rz = Math.floor(this.player._tempVector.z);
      if (!this.player.physics.isSolid(rx, ry, rz)) {
        let hasSolidNeighbor = false, allInvisible = true;
        for (const [dx, dy, dz] of neighborOffsets) {
          if (this.player.physics.isSolid(rx + dx, ry + dy, rz + dz)) {
            hasSolidNeighbor = true;
            if (this.player._direction.dot(new THREE.Vector3(dx, dy, dz).normalize()) > 0.01) { allInvisible = false; break; }
          }
        }
        if (hasSolidNeighbor && allInvisible) { if (this.tryPlaceBlock(rx, ry, rz, type)) { this.swing(); return; } }
      } else break;
    }
  }

  /**
   * 执行挥臂动作
   */
  swing() {
    this.player.swingTime = 10;
  }

  /**
   * 生成轨迹效果
   * @param {THREE.Vector3} start - 起始点
   * @param {THREE.Vector3} end - 结束点
   * @param {Object} config - 配置对象
   */
  spawnTracer(start, end, config) {
    const distance = start.distanceTo(end);
    let mesh;
    if (this.player.tracerPool.length > 0) {
      mesh = this.player.tracerPool.pop();
      mesh.visible = true;
    } else {
      mesh = new THREE.Mesh(this.player.tracerGeometry, this.player.tracerMaterial);
    }

    mesh.material = config.isShotgun ? this.player.mag7TracerMaterial : this.player.tracerMaterial;
    mesh.scale.set(config.tracerThickness, config.tracerThickness, distance);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.player.world.scene.add(mesh);

    let info = this.player.tracerInfoPool.length > 0 ? this.player.tracerInfoPool.pop() : { mesh: null, worldEnd: new THREE.Vector3() };
    info.mesh = mesh;
    info.lifetime = config.tracerLifetime;
    info.maxLifetime = info.lifetime;
    info.localStart = config.localStart;
    info.worldEnd.copy(end);
    info.thickness = config.tracerThickness;
    this.player.tracers.push(info);
  }

  /**
   * 更新轨迹效果
   * @param {number} dt - 时间步长
   */
  updateTracers(dt) {
    for (let i = this.player.tracers.length - 1; i >= 0; i--) {
      const tracer = this.player.tracers[i];
      tracer.lifetime -= dt;
      if (tracer.lifetime <= 0) {
        this.player.world.scene.remove(tracer.mesh);
        tracer.mesh.visible = false;
        this.player.tracerPool.push(tracer.mesh);
        this.player.tracerInfoPool.push(tracer);
        this.player.tracers.splice(i, 1);
      } else {
        this.player._tempVector.copy(tracer.localStart).applyQuaternion(this.player.camera.quaternion).add(this.player.camera.position);
        tracer.mesh.position.copy(this.player._tempVector);
        tracer.mesh.lookAt(tracer.worldEnd);
        tracer.mesh.scale.set(tracer.thickness, tracer.thickness, this.player._tempVector.distanceTo(tracer.worldEnd));
        tracer.mesh.material.opacity = (tracer.lifetime / tracer.maxLifetime);
      }
    }
  }

  /**
   * 更新相机晃动效果
   * @param {number} dx - X轴移动距离
   * @param {number} dz - Z轴移动距离
   * @param {number} dt - 时间步长
   * @param {boolean} isObstructed - 是否受阻
   */
  updateCameraBob(dx, dz, dt, isObstructed) {
    const inputSpeed = Math.sqrt(this.player.velocity.x ** 2 + this.player.velocity.z ** 2);
    const expectedDist = inputSpeed * dt;
    const actualDist = Math.sqrt(dx * dx + dz * dz);
    const isMoving = actualDist > 0.001;
    const isFullSpeed = inputSpeed > 0 && actualDist > expectedDist * 0.95;
    const shouldBob = isMoving && isFullSpeed && !this.player.jumping && !isObstructed;

    if (shouldBob) {
      this.player.bobbingTimer += this.player.bobbingSpeed;
      this.player.bobAmount = THREE.MathUtils.lerp(this.player.bobAmount, this.player.bobbingIntensity, 0.1);
      this.playFootstepSound();
    } else {
      this.player.bobbingTimer = 0;
      this.player.bobAmount = THREE.MathUtils.lerp(this.player.bobAmount, 0, 0.2);
      audioManager.stopSound('running_land');
      audioManager.stopSound('running_water');
    }

    const bobX = Math.sin(this.player.bobbingTimer) * this.player.bobAmount;
    const bobY = Math.cos(this.player.bobbingTimer * 2) * this.player.bobAmount * 0.5;
    this.player.bobOffset.x = THREE.MathUtils.lerp(this.player.bobOffset.x, bobX, 0.3);
    this.player.bobOffset.y = THREE.MathUtils.lerp(this.player.bobOffset.y, bobY, 0.3);

    this.player.camera.position.x += this.player.bobOffset.x;
    this.player.camera.position.y += this.player.bobOffset.y;
  }

  /**
   * 播放脚步声
   */
  playFootstepSound() {
    const blockType = this.player.world.getBlock(Math.floor(this.player.position.x), Math.floor(this.player.position.y), Math.floor(this.player.position.z));
    if (blockType === 'water') {
      audioManager.stopSound('running_land');
      audioManager.playSound('running_water', 0.25, true);
    } else {
      audioManager.stopSound('running_water');
      audioManager.playSound('running_land', 0.2, true);
    }
  }

  /**
   * 更新手臂状态
   * @param {number} dt - 时间步长
   */
  updateArm(dt) {
    if (this.player.weaponMode !== WEAPON_TYPES.ARM) { this.player.arm.visible = false; return; }
    this.player.arm.visible = true;
    if (this.player.drawProgress < 1) this.player.drawProgress = Math.min(1, this.player.drawProgress + dt * 4);
    this.player.arm.position.set(0.07, -0.10 - Math.pow(1 - this.player.drawProgress, 2) * 0.5, -0.12);
    this.player.arm.scale.set(0.1, 0.1, 0.1);
    if (this.player.swingTime > 0) {
      this.player.arm.rotation.x = -0.8 - Math.sin((10 - this.player.swingTime) / 10 * Math.PI) * 0.87;
      this.player.swingTime--;
    } else this.player.arm.rotation.x = -0.8;
  }

  /**
   * 处理射击逻辑
   * @param {number} dt - 时间步长
   */
  handleShooting(dt) {
    if (this.player.shootCooldown > 0) this.player.shootCooldown -= dt;
    if (this.player.weapon && this.player.isShooting && this.player.shootCooldown <= 0) {
      if (this.player.weaponMode === WEAPON_TYPES.GUN || this.player.weaponMode === WEAPON_TYPES.MINIGUN) {
        this.player.executeShot(this.getInteractionTargets());
        this.player.shootCooldown = this.player.weapon.config.fireRate;
      }
    }
  }

  /**
   * 更新武器状态
   * @param {number} dt - 时间步长
   */
  updateWeapon(dt) {
    const targetModel = this.player.weaponMode === WEAPON_TYPES.GUN ? gunModel :
                      (this.player.weaponMode === WEAPON_TYPES.MAG7 ? mag7Model :
                      (this.player.weaponMode === WEAPON_TYPES.MINIGUN ? minigunModel : null));

    if (this.player.weapon && (this.player.weapon.type !== this.player.weaponMode || !targetModel)) {
      this.player.weapon.destroy();
      this.player.weapon = null;
    }

    if (!this.player.weapon && targetModel) {
      this.player.weapon = new Gun(this.player.weaponMode, targetModel, this.player.camera, this.player.world);
    }

    if (this.player.weapon) {
      this.player.weapon.update(dt, this.player.isShooting);
    }
  }

  /**
   * 执行射击动作
   * @param {Array} targets - 交互目标对象数组
   */
  executeShot(targets) {
    this.player.raycaster.far = 40;
    this.player.raycaster.setFromCamera(this.player.center, this.player.camera);
    const hits = this.player.raycaster.intersectObjects(targets, true);
    this.player.raycaster.far = Infinity;

    // Debug logging for raycasting
    if (this.player.game && this.player.game.showDebugInfo) {
      console.log(`[Raycast] targets: ${targets.length}, hits: ${hits.length}`);
      if (hits.length > 0) {
        const hit = hits[0];
        console.log(`[Raycast] Hit[0]:`, hit.object.userData, hit.object.isInstancedMesh, hit.instanceId);
      }
    }

    // 当枪械不能破坏方块时，实心方块可以阻挡子弹
    const canGunsDestroyBlocks = this.player.game?.canGunsDestroyBlocks !== false;

    let finalHit = null;

    // Iterate through hits to find the first solid object (Zombie or Block)
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const obj = hit.object;

      // 1. Check if Zombie
      let isZombie = false;
      if (obj.userData?.renderer || obj.userData?.isZombie || obj.parent?.userData?.isZombie) {
        isZombie = true;
      }

      if (isZombie) {
        finalHit = hit;

        if (this.player.game && this.player.game.enemyManager) {
          const damage = this.player.weaponMode === WEAPON_TYPES.MINIGUN ? 35 : 25;
          let enemyUuid;

          if (obj.userData?.renderer) {
             const zombie = obj.userData.renderer.getZombieAt(hit.instanceId);
             if (zombie) enemyUuid = zombie.id;
          } else {
             enemyUuid = obj.uuid;
             if (!obj.userData?.isZombie && obj.parent?.userData?.isZombie) {
               enemyUuid = obj.parent.uuid;
             }
             if (obj.parent?.userData?.zombieId) enemyUuid = obj.parent.userData.zombieId;
             if (obj.userData?.zombieId) enemyUuid = obj.userData.zombieId;
          }

          if (enemyUuid) {
            this.player.game.enemyManager.applyDamageToEnemy(enemyUuid, damage);
            console.log(`[Combat] 击中丧尸，造成 ${damage} 点伤害！`);
          }
        }
        break;
      }

      // 2. Check if Block (Terrain/Other)
      const blockHit = this._resolveBlockHitFromRaycast(hit);
      const blockType = blockHit?.type;

      if (blockType && blockType !== 'air') {
        if (blockType === 'tnt') {
          finalHit = hit;
          const key = `${blockHit.bx},${blockHit.by},${blockHit.bz}`;
          if (!this.player.ignitingTNTs.has(key)) {
            this.player.ignitingTNTs.add(key);
            this.player.explode(blockHit.bx, blockHit.by, blockHit.bz);
          }
          break;
        }

        const props = getBlockProperties(blockType);
        const isDestructiblePlant = blockType === 'flower' || blockType === 'short_grass' || blockType === 'allium';

        if (props.isSolid || blockType === 'cloud') {
          finalHit = hit;

          if (canGunsDestroyBlocks) {
            this.player.removeBlock(hit);
          }
          break;
        } else if (isDestructiblePlant && canGunsDestroyBlocks) {
          this.player.removeBlock(hit);
        }
      } else {
        const type = obj.userData.type || 'unknown';
        if (type === 'tnt' || type === 'chest') {
           finalHit = hit;
           if (type === 'tnt') {
              if (obj.isInstancedMesh) {
                obj.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
                this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
              } else {
                this.player._tempVector.copy(obj.position);
              }
              const key = `${Math.floor(this.player._tempVector.x)},${Math.floor(this.player._tempVector.y)},${Math.floor(this.player._tempVector.z)}`;
              if (!this.player.ignitingTNTs.has(key)) {
                this.player.ignitingTNTs.add(key);
                this.player.explode(this.player._tempVector.x, this.player._tempVector.y, this.player._tempVector.z);
              }
           } else if (canGunsDestroyBlocks) {
              this.player.removeBlock(hit);
           }
           break;
        }
      }
    }

    const effect = this.player.weapon.onFire(finalHit ? finalHit.point : null);
    this.spawnTracer(effect.start, effect.end, effect.config);
  }

  /**
   * 从射线命中结果中解析方块世界坐标与类型
   * @param {Object} hit - 射线命中结果
   * @returns {{ bx: number, by: number, bz: number, type: string|null }|null}
   */
  _resolveBlockHitFromRaycast(hit) {
    if (!hit || !hit.object) return null;

    const obj = hit.object;
    let bx;
    let by;
    let bz;

    if (obj.isInstancedMesh && hit.instanceId !== undefined) {
      obj.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
      this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
      bx = Math.floor(this.player._tempVector.x);
      by = Math.floor(this.player._tempVector.y);
      bz = Math.floor(this.player._tempVector.z);
    } else if (obj.position) {
      bx = Math.floor(obj.position.x);
      by = Math.floor(obj.position.y);
      bz = Math.floor(obj.position.z);
    } else {
      this.player._tempVector.copy(hit.point).addScaledVector(this.player.raycaster.ray.direction, -0.01);
      bx = Math.floor(this.player._tempVector.x);
      by = Math.floor(this.player._tempVector.y);
      bz = Math.floor(this.player._tempVector.z);
    }

    return {
      bx,
      by,
      bz,
      type: this.player.world.getBlock(bx, by, bz)
    };
  }
}
