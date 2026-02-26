// src/core/Game.js
// 游戏主类，负责协调游戏引擎、世界、玩家和UI的初始化与运行循环

import { manualSaveService } from '../services/ManualSaveService.js';
import { persistenceService } from '../services/PersistenceService.js';
import { Engine } from './Engine.js';
import { World } from '../world/World.js';
import { UIManager } from '../ui/UIManager.js';
import { Player } from '../entities/player/Player.js';
import { realisticTreeManager } from '../world/entities/RealisticTreeManager.js';
import { faceCullingSystem } from './FaceCullingSystem.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { EnemyManager } from './EnemyManager.js'; // 替换为新的敌人管理器
import Stats from 'stats';

/**
 * 游戏主类，负责初始化游戏核心组件并管理游戏循环
 */
export class Game {
  /**
   * 构造函数，初始化游戏引擎、世界、玩家和UI
   */
  constructor() {
    // 初始化游戏引擎（Three.js 场景、相机、渲染器等）
    this.engine = new Engine();
    // 初始化游戏世界（地形、区块等）
    this.world = new World(this.engine.scene);
    // 初始化玩家角色
    this.player = new Player(this.world, this.engine.camera);
    this.player.game = this; // 将游戏实例传递给玩家对象
    this.ui = new UIManager(this); // 初始化UI管理器，传递游戏实例

    // 初始化敌人管理器（替代原来的丧尸管理器）
    this.enemyManager = new EnemyManager(this.engine.scene, this.world);

    // 计算金字塔中心点（与 WorldWorker.js 中的逻辑一致）
    const randX = Math.abs(Math.sin(WORLD_CONFIG.SEED * 1.5));
    const randZ = Math.abs(Math.sin(WORLD_CONFIG.SEED * 2.5));
    this.pyramidCenterX = Math.floor(randX * 150) + 50;
    this.pyramidCenterZ = Math.floor(randZ * 150) + 50;

    // 初始化 Stats 监控
    this.stats = new Stats();
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.top = '54px';
    this.stats.dom.style.right = '10px';
    this.stats.dom.style.left = 'auto'; // 确保不靠左
    document.body.appendChild(this.stats.dom);

    this.canGunsDestroyBlocks = false; // 是否允许枪械破坏方块
    this.maxActiveZombies = 20; // 最大活跃丧尸数

    this.isRunning = false; // 游戏运行状态标志
    this.perfStats = { player: 0, world: 0, ui: 0, render: 0 }; // 性能统计数据
    this.showDebugInfo = false; // 是否显示调试信息

    this.lastTime = 0; // 用于计算时间差的时间戳

    // 监听键盘事件
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') {
        this.showDebugInfo = !this.showDebugInfo;
        if (!this.showDebugInfo) {
          console.log('[Debug] 性能监控已关闭');
          if (this.ui && this.ui.hud && this.ui.hud.msgEl) {
            this.ui.hud.msgEl.style.opacity = 0;
          }
        } else {
          console.log('[Debug] 性能监控已开启');
        }
      }

      // 按 M 键执行地图审计（隐藏面剔除审计）
      if (e.code === 'KeyM') {
        console.log('[Debug] 正在执行手动地图审计与场景同步...');
        if (faceCullingSystem) {
          faceCullingSystem.auditWorld(this.world, true);
        }
      }

      // 按 X 键生成一个丧尸
      if (e.code === 'KeyX') {
        const angle = Math.random() * Math.PI * 2; // 随机角度
        const distance = Math.random() * 8 + 2; // 距离玩家2-10格
        const spawnPos = {
          x: this.player.position.x + Math.cos(angle) * distance,
          y: this.player.position.y,
          z: this.player.position.z + Math.sin(angle) * distance
        };

        // 尝试在稍微调整的高度上生成（确保丧尸站在地面上）
        const spawnX = Math.floor(spawnPos.x);
        const spawnZ = Math.floor(spawnPos.z);

        // 找到合适的y位置（在地面上）
        let spawnY = Math.floor(spawnPos.y);
        // 向下找地面
        for (let y = spawnY; y > spawnY - 10; y--) {
          if (this.world.getBlock(spawnX, y, spawnZ) !== null && this.world.getBlock(spawnX, y, spawnZ) !== 'air') {
            spawnY = y + 1; // 在方块上方生成
            break;
          }
        }

        const adjustedSpawnPos = {
          x: spawnPos.x,
          y: spawnY,
          z: spawnPos.z
        };

        // 创建一个僵尸实例用于渲染
        import('../entities/enemy/Zombie.js').then(({ Zombie }) => {
          const zombie = new Zombie(adjustedSpawnPos);

          // 检查是否可以添加更多丧尸
          if (this.enemyManager.addZombie(zombie)) {
            // 将僵尸添加到场景
            this.engine.scene.add(zombie.mesh);

            console.log(`[Debug] 生成了一个丧尸 at (${adjustedSpawnPos.x.toFixed(2)}, ${adjustedSpawnPos.y.toFixed(2)}, ${adjustedSpawnPos.z.toFixed(2)})`);
            console.log(`[Debug] 离玩家距离: ${Math.sqrt(
              Math.pow(adjustedSpawnPos.x - this.player.position.x, 2) +
              Math.pow(adjustedSpawnPos.y - this.player.position.y, 2) +
              Math.pow(adjustedSpawnPos.z - this.player.position.z, 2)
            ).toFixed(2)} 格`);
          }
        });
      }
    });

    // 初始化树木管理器（用于生成逼真树木）
    realisticTreeManager.init();

    // 初始化玩家背包，添加默认物品
    this.player.inventory.add('stone', 1500);
    this.player.inventory.add('stone_diorite', 1500);
    this.player.inventory.add('dirt', 1500);
    this.player.inventory.add('planks', 1500);
    this.player.inventory.add('planks_step', 1500);
    this.player.inventory.add('cobblestone_step', 1500);
    this.player.inventory.add('stone_diorite_step', 1500);
    this.player.inventory.add('wood', 1500);
    this.player.inventory.add('glass_block', 1500);
    this.player.inventory.add('cobblestone', 1500);
    this.player.inventory.add('blue_planks', 1500);
    this.player.inventory.add('glass_blink', 1500);
    this.player.inventory.add('end_stone', 1500);
    this.player.inventory.add('green_planks', 1500);
    this.player.inventory.add('hay_bale', 1500);
    this.player.inventory.add('moss', 1500);
    this.player.inventory.add('bookbox', 1500);
    this.player.inventory.add('mossy_stone', 1500);
    this.player.inventory.add('oak_planks', 1500);
    this.player.inventory.add('swamp_grass', 1500);
    this.player.inventory.add('bricks', 1500);
    this.player.inventory.add('white_planks', 1500);
    this.player.inventory.add('birch_log', 1500);
    this.player.inventory.add('obsidian', 1500);
    this.player.inventory.add('sand', 1500);
    this.player.inventory.add('grass', 1500);
    this.player.inventory.add('dark_planks', 1500);
    this.player.inventory.add('diamond', 1500);
    this.player.inventory.add('gold', 1500);
    this.player.inventory.add('gold_ore', 1500);
    this.player.inventory.add('leaves', 1500);
    this.player.inventory.add('yellow_leaves', 1500);
    this.player.inventory.add('azalea_leaves', 1500);
    this.player.inventory.add('azalea_flowers', 1500);
    this.player.inventory.add('flower', 1500);
    this.player.inventory.add('short_grass', 1500);
    this.player.inventory.add('allium', 1500);
    this.player.inventory.add('gold_block', 1500);
    this.player.inventory.add('emerald', 1500);
    this.player.inventory.add('amethyst', 1500);
    this.player.inventory.add('debris', 1500);
    this.player.inventory.add('iron', 1500);
    this.player.inventory.add('iron_ore', 1500);
    this.player.inventory.add('marble', 1500);
    this.player.inventory.add('cactus', 1500);
    this.player.inventory.add('tnt', 1500);
    this.player.inventory.add('chest', 1500);
    this.player.inventory.add('handrail', 1500);
    this.player.inventory.add('handrailA', 1500);
    // this.player.inventory.add('handrailB', 1500); // 增加了方块旋转，handrailB 就不需要了
    this.player.inventory.add('pillar', 1500);
    // this.player.inventory.add('cloud', 1500);

    // 延迟执行 Face Culling 审计并同步场景
    setTimeout(() => {
      if (faceCullingSystem) {
        faceCullingSystem.auditWorld(this.world, true);
      }
    }, 5000);

    // 设置玩家出生点在金字塔旁边（等待世界加载完成后）
    setTimeout(() => {
      this.setPlayerSpawnAtPyramid();
    }, 500);
  }

  /**
  * 启动游戏循环
  */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.loop();
  }

  /**
  * 停止游戏循环
  */
  stop() {
    this.isRunning = false;
  }

  /**
  * 游戏主循环，使用 requestAnimationFrame 实现循环调用
  * 计算时间差并调用更新和渲染方法
  */
  loop() {
    if (!this.isRunning) return;
    if (this.stats) this.stats.begin();
    requestAnimationFrame(() => this.loop());

    const frameStart = performance.now();
    const dt = (frameStart - this.lastTime) / 1000; // 计算时间差（秒）
    this.lastTime = frameStart;

    this.update(dt); // 更新游戏状态
    this.render();   // 渲染场景

    if (this.stats) this.stats.end();

    const totalFrameTime = performance.now() - frameStart;
    if (this.showDebugInfo && totalFrameTime > 25) {
      console.warn(`[Jank] 帧耗时过长: ${totalFrameTime.toFixed(2)}ms`);
      const uiStats = this.ui.hud.perfStats || { updateFPS: 0, renderHotbar: 0 };
      const overHead = (totalFrameTime - (this.perfStats.player + this.perfStats.world + this.perfStats.ui + this.perfStats.render)).toFixed(2);
      console.table({
        'Player Update': `${this.perfStats.player.toFixed(2)}ms`,
        'World Update': `${this.perfStats.world.toFixed(2)}ms`,
        'UI Update (Total)': `${this.perfStats.ui.toFixed(2)}ms`,
        '  └─ HUD.updateFPS': `${uiStats.updateFPS.toFixed(2)}ms`,
        '  └─ HUD.renderHotbar': `${uiStats.renderHotbar.toFixed(2)}ms`,
        'Render (WebGL)': `${this.perfStats.render.toFixed(2)}ms`,
        'Other (Overhead)': `${overHead}ms`
      });
    }
  }

  /**
    * 更新游戏状态
    * @param {number} dt - 时间差（秒），自上一帧以来的时间
    */
  update(dt) {
    const t1 = performance.now();
    if (this.player) this.player.update(dt); // 更新玩家状态（移动、物理等）
    const t2 = performance.now();

    if (this.world && this.player) this.world.update(this.player.position, dt); // 更新世界状态（区块加载等）
    const t3 = performance.now();

    // 更新敌人管理器（替代原来的丧尸管理器）
    if (this.enemyManager && this.player) {
      this.enemyManager.updateAll(this.player.position, dt);
    }

    if (this.ui) this.ui.update(dt); // 更新UI
    const t4 = performance.now();

    this.perfStats.player = t2 - t1;
    this.perfStats.world = t3 - t2;
    this.perfStats.ui = t4 - t3;

    // 更新光源与太阳位置使其跟随玩家
    if (this.player) {
      // 性能优化：只有当玩家移动超过一定阈值时才更新灯光和天空的位置
      // 这可以显著减少每帧重复的矩阵计算和光源更新，同时减少阴影在微小移动时的抖动
      const distSq = this.player.position.distanceToSquared(this.engine._lastUpdatePos);
      if (distSq > 25) { // 阈值设定为 5个单位距离的平方 (5 * 5 = 25)，即移动超过5格时才同步位置

        // 太阳位置：使太阳始终在距离玩家 150 单位远的位置同步移动，模拟无限远的效果
        if (this.engine.sunSprite) {
          this.engine.sunSprite.position.copy(this.player.position)
            .addScaledVector(this.engine.sunDirection, 150);
        }

        // 天空球位置：始终以玩家为中心，确保玩家无论移动多远都无法到达天空边界
        /* if (this.engine.skyMesh) {
          this.engine.skyMesh.position.copy(this.player.position);
        } */

        // 光源位置：同步移动阴影投射光源，60 是光源相对于玩家的偏移距离，确保阴影覆盖玩家周围区域
        if (this.engine.light) {
          this.engine.light.position.copy(this.player.position)
            .addScaledVector(this.engine.sunDirection, 60);
          this.engine.light.target.position.copy(this.player.position); // 光源始终指向玩家

          // 更新记录位置，用于下一次距离检测
          this.engine._lastUpdatePos.copy(this.player.position);
        }
      }
    }
  }

  /**
    * 渲染游戏场景
    */
  render() {
    const t1 = performance.now();
    this.engine.render(); // 调用引擎渲染方法
    const t2 = performance.now();
    this.perfStats.render = t2 - t1;
  }

  /**
   * 收集当前游戏快照并保存到磁盘
   */
  async saveToDisk() {
    const playerSnapshot = {
      x: this.player.position.x,        // 玩家在X轴上的位置坐标
      y: this.player.position.y,        // 玩家在Y轴上的位置坐标
      z: this.player.position.z,        // 玩家在Z轴上的位置坐标
      pitch: this.player.cameraPitch,   // 玩家相机的俯仰角度（上下视角）
      yaw: this.player.rotation.y       // 玩家的偏航角度（左右视角/水平旋转）
    };

    // 序列化 persistenceService 中的所有区块增量
    const worldDeltas = [];
    for (const [key, data] of persistenceService.cache.entries()) {
      worldDeltas.push({ key, ...data });
    }

    const snapshot = {
      player: playerSnapshot,            // 玩家状态快照（位置、视角等）
      worldDeltas: worldDeltas,         // 世界变化数据（保存所有修改过的区块）
      seed: WORLD_CONFIG.SEED,           // 世界生成种子，用于确保地形一致性
      settings: {                        // 游戏设置
        canGunsDestroyBlocks: this.canGunsDestroyBlocks,
        maxActiveZombies: this.maxActiveZombies
      }
    };

    console.log(`[Save] Game saved with seed: ${WORLD_CONFIG.SEED}`);
    await manualSaveService.save(snapshot);
  }

  /**
   * 将保存的快照数据应用到当前游戏实例
   */
  async applySaveData(saveData) {
    if (!saveData) return;

    // 1. 恢复玩家位置
    const p = saveData.player;
    this.player.position.set(p.x, p.y, p.z);
    this.player.rotation.y = p.yaw;
    this.player.cameraPitch = p.pitch;

    // 同步相机位置
    this.player.camera.position.copy(this.player.position);
    this.player.camera.position.y += 1.65;
    this.player.camera.rotation.set(p.pitch, p.yaw, 0);

    // 2. 注入方块增量缓存
    if (saveData.worldDeltas && persistenceService.injectSaveData) {
      persistenceService.injectSaveData(saveData.worldDeltas);
    }

    // 3. 恢复设置
    if (saveData.settings) {
      this.canGunsDestroyBlocks = saveData.settings.canGunsDestroyBlocks !== undefined ? saveData.settings.canGunsDestroyBlocks : true;
      this.maxActiveZombies = saveData.settings.maxActiveZombies !== undefined ? saveData.settings.maxActiveZombies : 10;
      this.enemyManager.maxActiveZombies = this.maxActiveZombies; // 同步到敌人管理器
      // 更新UI按钮状态
      this.ui.updateActiveButtons();
    }
  }

  /**
   * 设置玩家出生点在金字塔旁边
   */
  setPlayerSpawnAtPyramid() {
    // 金字塔中心点附近出生（距离金字塔边缘 5 格）
    const spawnX = this.pyramidCenterX + 25; // 金字塔半径 20 + 5 格距离
    const spawnZ = this.pyramidCenterZ + 25;

    // 查找地面高度
    let spawnY = 20; // 从空中开始向下查找
    for (let y = spawnY; y > -10; y--) {
      const block = this.world.getBlock(spawnX, y, spawnZ);
      if (block !== null && block !== 'air') {
        spawnY = y + 1; // 在方块上方生成
        break;
      }
    }

    // 设置玩家位置
    this.player.position.set(spawnX, spawnY, spawnZ);
    this.player.camera.position.copy(this.player.position);
    this.player.camera.position.y += 1.65;

    console.log(`[Spawn] 玩家出生在金字塔附近：(${spawnX}, ${spawnY}, ${spawnZ})`);
    console.log(`[Spawn] 金字塔中心点：(${this.pyramidCenterX}, ${this.pyramidCenterZ})`);
  }

}