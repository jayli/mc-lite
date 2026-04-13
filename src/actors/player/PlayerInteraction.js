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
import { resolveBreakBlockPos } from '../../utils/BlockHitResolver.js';
import { Gun, WEAPON_TYPES } from '../weapon/Gun.js';
import { gunModel, mag7Model, minigunModel } from '../../core/Engine.js';
import { minecartLinkDetector } from '../minecart/MinecartLinkDetector.js';

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
    const seen = new Set();
    const pushTarget = (obj) => {
      if (!obj || seen.has(obj)) return;
      seen.add(obj);
      targets.push(obj);
    };

    for (const chunk of this.player.world.chunks.values()) pushTarget(chunk.group);

    // 添加丧尸作为交互目标（如果游戏有敌人管理器）
    if (this.player.game && this.player.game.enemyManager) {
      let hasRenderMeshes = false;

      // 从EnemyManager获取渲染网格（InstancedMesh）
      if (typeof this.player.game.enemyManager.getRenderMeshes === 'function') {
        const renderMeshes = this.player.game.enemyManager.getRenderMeshes();
        hasRenderMeshes = renderMeshes.length > 0;
        for (const mesh of renderMeshes) {
          pushTarget(mesh);
        }
      }

      // 优先使用 InstancedMesh，旧 mesh 只作为回退
      if (!hasRenderMeshes) {
        const enemies = this.player.game.enemyManager.getAllEnemies();
        for (const enemy of enemies) {
          if (enemy.mesh) {
            pushTarget(enemy.mesh);
          }
        }
      }
    }

    chestManager.chestAnimations.forEach(anim => {
      if (anim.mesh) pushTarget(anim.mesh);
    });

    // 添加矿车作为交互目标（使用 InstancedMesh）
    if (this.player.game && this.player.game.minecartRenderer) {
      const renderer = this.player.game.minecartRenderer;
      // 添加车身和车轮网格作为交互目标
      if (renderer.bodyMesh) pushTarget(renderer.bodyMesh);
      if (renderer.wheelMesh) pushTarget(renderer.wheelMesh);
    }

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
      if (hits.length > 0 && hits[0].distance < 15) {
        const hit = hits[0], m = hit.object, instanceId = hit.instanceId;

        // 右键是放置动作，不应拾取矿车。
        // 如果点击矿车位置，后续放置检查会因位置已占用而失败。
        // 不调用 tryPickUpMinecart，避免误消除矿车。

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
      if (hits.length > 0 && hits[0].distance < 15) {
        const hit = hits[0], m = hit.object, type = m.userData.type || 'unknown';

        // ctrl+左键：激活矿车移动
        if (e.ctrlKey) {
          if (this.tryActivateMinecart(hit, e.shiftKey ? 'backward' : 'forward')) {
            this.swing();
            return;
          }

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

        // 普通左键：拾取矿车或挖掘方块
        if (this.tryPickUpMinecart(hit)) {
          this.swing();
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
    // 通过实体注册表检查是否为特殊方块
    const game = this.player.game;
    if (game?.entityRegistry?.isSpecialBlock(type)) {
      const handler = game.entityRegistry.getHandler(type);
      if (handler) {
        return handler.place(x, y, z);
      }
    }

    // 特殊处理：床方块放置时生成床结构
    if (type === 'bed_alias_block') {
      return this.tryPlaceBed(x, y, z);
    }

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
   * 尝试放置床
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean} 是否成功放置
   */
  tryPlaceBed(x, y, z) {
    // 计算玩家面向方向，确定床尾位置
    const playerPos = this.player.position;
    const dx = playerPos.x - (x + 0.5);
    const dz = playerPos.z - (z + 0.5);

    // 根据玩家面向确定床尾位置（床头面向玩家，床尾在后方）
    let tailX = x, tailZ = z;
    if (Math.abs(dx) > Math.abs(dz)) {
      // 玩家在东西方向更远
      tailX = dx > 0 ? x - 1 : x + 1;
    } else {
      // 玩家在南北方向更远
      tailZ = dz > 0 ? z - 1 : z + 1;
    }

    // 检查床头位置是否被占用
    if (this.player.physics.isSolid(x, y, z)) {
      console.warn(`[PlayerInteraction] 床头位置 (${x}, ${y}, ${z}) 被占用，无法放置床`);
      return false;
    }

    // 检查床尾位置是否被占用
    if (this.player.physics.isSolid(tailX, y, tailZ)) {
      console.warn(`[PlayerInteraction] 床尾位置 (${tailX}, ${y}, ${tailZ}) 被占用，无法放置床`);
      return false;
    }

    // 检查玩家是否与床碰撞（检查床头，床尾0.5高度不会碰撞到玩家）
    if (this.player.position.x - 0.3 < x + 1 &&
        this.player.position.x + 0.3 > x &&
        this.player.position.y < y + 0.5 &&
        this.player.position.y + 1.8 > y &&
        this.player.position.z - 0.3 < z + 1 &&
        this.player.position.z + 0.3 > z) {
      console.warn('[PlayerInteraction] 玩家与床头碰撞，无法放置');
      return false;
    }

    // 放置床头
    this.player.world.setBlock(x, y, z, 'bed_head', 0);

    // 放置床尾
    this.player.world.setBlock(tailX, y, tailZ, 'bed_tail', 0);

    // 消耗物品并播放音效
    this.player.inventory.remove('bed_alias_block', 1);
    audioManager.playSound('put', 0.3);

    console.log(`[PlayerInteraction] 床放置成功 at (${x}, ${y}, ${z}), 床尾 at (${tailX}, ${y}, ${tailZ})`);
    return true;
  }

  /**
   * 玩家是否与指定方块位置重叠
   * @param {number} x - 方块坐标 X
   * @param {number} y - 方块坐标 Y
   * @param {number} z - 方块坐标 Z
   * @returns {boolean}
   */
  isPlayerCollidingWithBlock(x, y, z) {
    return this.player.position.x - 0.3 < x + 1 &&
      this.player.position.x + 0.3 > x &&
      this.player.position.y < y + 1 &&
      this.player.position.y + 1.8 > y &&
      this.player.position.z - 0.3 < z + 1 &&
      this.player.position.z + 0.3 > z;
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

    if (m.isInstancedMesh && m.userData?.specialEntityRenderer) {
      const record = m.userData.specialEntityRenderer.getEntityAt(hit.instanceId);
      if (!record) return;

      this.player._tempVector.set(record.x + 0.5, record.y + 0.5, record.z + 0.5);
      if (isHandBreak) {
        this.player.world.spawnBlockCrashParticles(this.player._tempVector);
      } else {
        this.player.spawnParticles(this.player._tempVector, type);
      }
      m.userData.specialEntityRenderer.destroyEntityAt(hit.instanceId);
      audioManager.playSound('delete_get', 0.3);
      return;
    }

    // 检查是否为不可破坏方块
    if (type === 'end_stone' || type === 'playground_block' || type === 'playground_center_block') return;

    if (m.isInstancedMesh) {
      let matrixPosition = null;
      if (hit.instanceId !== undefined) {
        m.getMatrixAt(hit.instanceId, this.player._dummyMatrix);
        this.player._dummyMatrix.decompose(this.player._tempVector, this.player._dummyQuaternion, this.player._dummyScale);
        matrixPosition = {
          x: this.player._tempVector.x,
          y: this.player._tempVector.y,
          z: this.player._tempVector.z
        };
      }

      const resolved = resolveBreakBlockPos({
        hitPoint: hit.point,
        rayDirection: this.player.raycaster?.ray?.direction,
        faceNormal: hit.face?.normal || null,
        matrixPosition,
        getBlockEntry: (x, y, z) => this.player.world.getBlockEntry(x, y, z),
        preferredType: this._getPreferredTypeFromHit(hit, m)
      });
      if (!resolved) return;

      const { x: finalBx, y: finalBy, z: finalBz, entry } = resolved;
      this.player._tempVector.set(finalBx + 0.5, finalBy + 0.5, finalBz + 0.5);
      this.recordRemovedBlock(finalBx, finalBy, finalBz, entry.type, entry.orientation);
      const targetType = entry.type;

      // 在所有相同类型的 InstancedMesh 中查找该位置的实例
      let instanceHidden = false;
      if (targetType && m.userData.type === targetType) {
        // 如果命中的 mesh 类型匹配，直接在该 mesh 中查找
        instanceHidden = this._hideInstancedMeshAtPosition(m, finalBx, finalBy, finalBz);
      }

      // 如果没找到，遍历该 chunk 的所有 InstancedMesh 查找
      if (!instanceHidden) {
        const owner = this.player.world.resolveBlockOwner(finalBx, finalBy, finalBz, { allowScan: true });
        const candidateChunks = [];
        if (owner?.ownerChunk) candidateChunks.push(owner.ownerChunk);
        if (owner?.coordChunk && owner.coordChunk !== owner.ownerChunk) candidateChunks.push(owner.coordChunk);

        for (const chunk of candidateChunks) {
          for (const child of chunk.group.children) {
            if (child.isInstancedMesh && child.userData.type === targetType) {
              if (this._hideInstancedMeshAtPosition(child, finalBx, finalBy, finalBz)) {
                instanceHidden = true;
                break;
              }
            }
          }
          if (instanceHidden) break;
        }
      }

      // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
      if (isHandBreak) {
        this.player.world.spawnBlockCrashParticles(this.player._tempVector);
      } else {
        this.player.spawnParticles(this.player._tempVector, targetType || type);
      }
      this.player.world.removeBlock(finalBx, finalBy, finalBz);
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
      const canTntDestroyBlocks = this.player.game?.canTntDestroyBlocks !== false;
      if (canTntDestroyBlocks) {
        this.player.world.removeBlocksBatch(blocksToDestroy.filter(p => {
          if (ignitingKeys.has(`${p.x},${p.y},${p.z}`)) return false;
          const type = this.player.world.getBlock(p.x, p.y, p.z);
          return type && (type !== 'end_stone' || this.player.world.getBlock(p.x, p.y - 1, p.z));
        }));
      }
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

      // 新增：TNT爆炸摧毁范围内的矿车
      if (this.player.game && this.player.game.minecartManager) {
        const explosionCenter = new THREE.Vector3(center.x + 0.5, center.y + 0.5, center.z + 0.5);
        const explosionRadius = 4; // 爆炸范围（方块单位）

        const minecartsToDestroy = [];
        for (const minecart of this.player.game.minecartManager.minecarts.values()) {
          const minecartPos = new THREE.Vector3(
            minecart.position.x + 0.5,
            minecart.position.y + 0.3,
            minecart.position.z + 0.5
          );
          const distance = explosionCenter.distanceTo(minecartPos);

          if (distance <= explosionRadius) {
            minecartsToDestroy.push(minecart.id);
            console.log(`[Explosion] 矿车在爆炸范围内，即将销毁！`);
          }
        }

        // 销毁矿车（不产生物品掉落）
        for (const id of minecartsToDestroy) {
          this.player.game.minecartManager.removeMinecart(id);
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
   * 尝试拾取矿车
   * @param {Object} hit - 射线检测击中信息
   * @returns {boolean} 是否成功拾取
   */
  tryPickUpMinecart(hit) {
    const game = this.player.game;
    if (!game?.minecartManager) return false;

    // 使用 InstancedMesh 渲染，检查 hit.object 是否是矿车部件
    const m = hit.object;
    if (m.userData?.isMinecartPart && m.userData?.renderer) {
      // 通过渲染器获取矿车实例
      const renderer = m.userData.renderer;
      const instanceId = hit.instanceId;

      // bodyMesh 的实例索引直接对应矿车，wheelMesh 需要转换
      const minecart = renderer.getMinecartAt(instanceId, m);
      if (minecart) {
        const pos = minecart.position;
        const success = game.minecartManager.pickUp(
          pos.x, pos.y, pos.z,
          this.player.inventory
        );
        if (success) {
          audioManager.playSound('delete_get', 0.3);
        }
        return success;
      }
    }

    return false;
  }

  /**
   * 尝试激活矿车移动
   * @param {Object} hit - 射线检测击中信息
   * @param {string} direction - 移动方向 ('forward' | 'backward')
   * @returns {boolean} 是否成功激活
   */
  tryActivateMinecart(hit, direction) {
    const game = this.player.game;
    if (!game?.minecartManager || !game?.minecartRenderer) return false;

    // 检查 hit.object 是否是矿车部件
    const m = hit.object;
    if (m.userData?.isMinecartPart && m.userData?.renderer) {
      const renderer = m.userData.renderer;
      const instanceId = hit.instanceId;

      // 获取矿车实例（传入网格对象以正确处理车轮索引）
      const minecart = renderer.getMinecartAt(instanceId, m);
      if (minecart) {
        const movementState = direction === 'forward' ? 'MOVING_FORWARD' : 'MOVING_BACKWARD';

        // 使用链接检测器激活所有链接的矿车
        minecartLinkDetector.activateLinkedMinecarts(minecart, game.minecartManager, movementState);

        // 播放音效
        audioManager.playSound('put', 0.3);

        return true;
      }
    }

    return false;
  }

  /**
   * 执行天空放置
   * @param {string} type - 方块类型
   */
  doSkyPlace(type) {
    const origin = this.player.camera.position;
    this.player.camera.getWorldDirection(this.player._direction);
    const step = 0.1, maxDist = 15;
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
            // 使用预分配的临时向量避免 GC
            this.player._tempDirVector.set(dx, dy, dz).normalize();
            if (this.player._direction.dot(this.player._tempDirVector) > 0.01) { allInvisible = false; break; }
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

      // 1. Check if Minecart (子弹穿透矿车，不做任何处理)
      const isMinecart = obj.userData?.isMinecartPart === true;
      if (isMinecart) {
        // 矿车不阻止子弹，继续检查后续命中
        continue;
      }

      // 2. Check if Zombie
      let isZombie = false;
      // 注意：矿车的 userData.renderer 是 MinecartInstancedRenderer，不是丧尸渲染器
      // 所以要先排除矿车的情况
      if ((obj.userData?.renderer && !obj.userData?.isMinecartPart) || obj.userData?.isZombie || obj.parent?.userData?.isZombie) {
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

      // 3. Check if Block (Terrain/Other)
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

  /**
   * 从射线命中信息中获取 preferredType
   * 对于 batched mesh，从 world.getBlockEntry 获取真实类型
   * @param {Object} hit - 射线命中信息
   * @param {THREE.Object3D} mesh - 命中的网格对象
   * @returns {string} preferredType
   */
  _getPreferredTypeFromHit(hit, mesh) {
    // 如果是 batched mesh 且有 instanceId，尝试获取真实类型
    if (mesh.userData.type === 'batched' && hit.instanceId !== undefined) {
      // 从矩阵中还原世界坐标
      const matrix = new THREE.Matrix4();
      mesh.instanceMatrix.getMatrixAt(hit.instanceId, matrix);
      const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
      const bx = Math.floor(pos.x);
      const by = Math.floor(pos.y);
      const bz = Math.floor(pos.z);

      // 从 world.getBlockEntry 获取真实类型
      const entry = this.player.world.getBlockEntry(bx, by, bz);
      if (entry?.type) {
        return entry.type;
      }
    }

    // 默认返回 mesh.userData.type
    return mesh.userData.type || 'unknown';
  }

  /**
   * 在指定位置隐藏 InstancedMesh 中的实例
   * 通过查找 instanceIndexMap 或遍历所有实例来找到对应位置的实例并缩放到0
   * @param {THREE.InstancedMesh} mesh - InstancedMesh 对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean} 是否成功隐藏
   */
  _hideInstancedMeshAtPosition(mesh, x, y, z) {
    if (!mesh || !mesh.isInstancedMesh) return false;

    const posKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const type = mesh.userData.type;

    // 获取该坐标所属的 chunk
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const chunkKey = `${cx},${cz}`;
    const chunk = this.player.world.chunks.get(chunkKey);

    // 方法1: 使用 instanceIndexMap 快速查找
    if (chunk && chunk.instanceIndexMap && chunk.instanceIndexMap[type]) {
      const typeMap = chunk.instanceIndexMap[type];
      if (typeMap.has(posKey)) {
        const idx = typeMap.get(posKey);
        const dummy = new THREE.Matrix4();
        mesh.getMatrixAt(idx, dummy);
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(dummy);
        const isExpectedPos =
          Math.floor(pos.x) === Math.floor(x) &&
          Math.floor(pos.y) === Math.floor(y) &&
          Math.floor(pos.z) === Math.floor(z);
        if (!isExpectedPos) {
          // instanceIndexMap 可能在异步合并后暂时失效，降级到全量扫描
        } else {
        // 检查是否已经隐藏（缩放为0）
          const scale = new THREE.Vector3();
          dummy.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
          if (scale.lengthSq() < 0.001) {
            return true; // 已经隐藏
          }
          dummy.scale(this.player._zeroVector);
          mesh.setMatrixAt(idx, dummy);
          mesh.instanceMatrix.needsUpdate = true;
          return true;
        }
      }
    }

    // 方法2: 遍历所有实例查找（降级方案）
    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, dummy);
      pos.setFromMatrixPosition(dummy);
      if (Math.floor(pos.x) === Math.floor(x) &&
          Math.floor(pos.y) === Math.floor(y) &&
          Math.floor(pos.z) === Math.floor(z)) {
        // 检查是否已经隐藏
        const scale = new THREE.Vector3();
        dummy.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        if (scale.lengthSq() < 0.001) {
          return true; // 已经隐藏
        }
        dummy.scale(this.player._zeroVector);
        mesh.setMatrixAt(i, dummy);
        mesh.instanceMatrix.needsUpdate = true;
        return true;
      }
    }

    return false;
  }
}
