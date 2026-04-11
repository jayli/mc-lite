// src/core/Game.js
// 游戏主类，负责协调游戏引擎、世界、玩家和UI的初始化与运行循环

import { manualSaveService } from '../services/ManualSaveService.js';
import { persistenceService } from '../services/PersistenceService.js';
import { Engine, VISUAL_STYLE_KEYS } from './Engine.js';
import { World } from '../world/World.js';
import { UIManager } from '../ui/UIManager.js';
import { Player } from '../actors/player/Player.js';
import { realisticTreeManager } from '../world/entity-system/RealisticTreeManager.js';
import { faceCullingSystem } from './FaceCullingSystem.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { EnemyManager } from './EnemyManager.js'; // 替换为新的敌人管理器
import { TurretManager } from '../actors/turret/TurretManager.js';
import { ZombieNestManager } from '../actors/zombie-nest/ZombieNestManager.js';
import { MinecartManager } from '../actors/minecart/MinecartManager.js';
import { MinecartInstancedRenderer } from '../actors/minecart/MinecartInstancedRenderer.js';
import { getRotationAngle } from '../utils/OrientationUtils.js';
import { EntityRegistry } from '../actors/entity-registry/EntityRegistry.js';
import { TurretPlacementHandler } from '../actors/turret/TurretPlacementHandler.js';
import { ZombieNestPlacementHandler } from '../actors/zombie-nest/ZombieNestPlacementHandler.js';
import { MinecartPlacementHandler } from '../actors/minecart/MinecartPlacementHandler.js';
import { preloadAllStructures } from '../world/entity-system/StructureLoader.js';
import { DEFAULT_INVENTORY_COUNT, DEFAULT_TEXTURE_BLUR_LEVEL, DEFAULT_COLOR_HUE_SHIFT } from '../constants/GameConfig.js';
import { materials } from './MaterialManager.js';
import { LightSourceManager } from './LightSourceManager.js';
import { RainEffect } from '../world/effects/RainEffect.js';
import { audioManager } from './AudioManager.js';
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
    this.world.persistenceService = persistenceService;

    // 初始化光源管理器（追踪发光方块并创建 PointLight）
    this.lightSourceManager = new LightSourceManager(this.engine.scene);
    this.world.lightSourceManager = this.lightSourceManager;

    // 阴影按需刷新：由 World 在区块/方块变化时请求
    this.world.setShadowUpdateCallback(() => this.engine.requestShadowMapUpdate());
    // 初始化玩家角色
    this.player = new Player(this.world, this.engine.camera);
    this.player.game = this; // 将游戏实例传递给玩家对象
    this.ui = new UIManager(this); // 初始化UI管理器，传递游戏实例

    // 初始化敌人管理器（替代原来的丧尸管理器）
    this.enemyManager = new EnemyManager(this.engine.scene, this.world);

    // 初始化炮塔管理器
    this.turretManager = new TurretManager(this.engine.scene, this.world, this.enemyManager);
    this.zombieNestManager = new ZombieNestManager(this.engine.scene, this.world, this.enemyManager);
    // 让 Chunk 生成回调可直接恢复该 Chunk 的巢穴和炮塔运行时实例
    this.world.zombieNestManager = this.zombieNestManager;
    this.world.turretManager = this.turretManager;

    // 初始化矿车管理器
    this.minecartRenderer = new MinecartInstancedRenderer(this.engine.scene);
    this.minecartManager = new MinecartManager(this.engine.scene, this.world, this.minecartRenderer);
    this.world.minecartManager = this.minecartManager;

    // 初始化实体注册表
    this.entityRegistry = new EntityRegistry();
    this.initEntityRegistry();

    // 初始化 Stats 监控
    this.stats = new Stats();
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.top = '10px';
    this.stats.dom.style.right = '10px';
    this.stats.dom.style.left = 'auto'; // 确保不靠左
    document.body.appendChild(this.stats.dom);

    this.canGunsDestroyBlocks = false; // 是否允许枪械破坏方块
    this.canTntDestroyBlocks = false; // 是否允许 TNT 爆炸破坏方块
    this.maxActiveZombies = 20; // 最大活跃丧尸数
    this.textureBlurLevel = materials.getTextureBlurLevel();
    this.colorHueShift = this.engine.getColorHueShift(); // 色调偏移值

    // 下雨效果状态
    this.rainState = { enabled: false, lastToggleTime: 0 };
    this.rainEffect = null;

    this.isRunning = false; // 游戏运行状态标志
    this.perfStats = { player: 0, world: 0, ui: 0, render: 0 }; // 性能统计数据
    this.showDebugInfo = false; // 是否显示调试信息
    this._gameplayReady = false; // 游戏是否已准备好（用于控制加载模态框）

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
        import('../actors/enemy/Zombie.js').then(({ Zombie }) => {
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
    this.player.inventory.add('stone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('stone_diorite', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('dirt', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('planks_step', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('cobblestone_step', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('cobblestone_step_updown', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('stone_diorite_step', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('wood', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('dark_oak', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('glass_block', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('cobblestone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('blue_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('glass_blink', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('end_stone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('green_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('hay_bale', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('moss', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('bookbox', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('mossy_stone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('oak_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('swamp_grass', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('white_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('birch_log', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('obsidian', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('sand', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('sand_train_track', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('sand_train_track_corner', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('grass', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('dark_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('diamond', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('gold', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('gold_ore', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('leaves', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('yellow_leaves', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('azalea_leaves', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('azalea_flowers', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('flower', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('short_grass', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('allium', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('azure_bluet', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('dead_bush', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('oxeye_daisy', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('red_mushroom', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('gold_block', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('emerald', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('amethyst', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('debris', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('iron', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('iron_ore', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('marble', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('cactus', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('tnt', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('chest', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('handrail', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('handrailA', DEFAULT_INVENTORY_COUNT);
    // this.player.inventory.add('handrailB', DEFAULT_INVENTORY_COUNT); // 增加了方块旋转，handrailB 就不需要了
    this.player.inventory.add('vertical_pillar', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('horizontal_pillar', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('snow', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('snow_grass', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('ice', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('snow_leaves', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('turret_alias_block', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('zombie_nest_alias_block', DEFAULT_INVENTORY_COUNT);

    // 新增方块 (30种)
    this.player.inventory.add('deepslate', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('deepslate_diamond_ore', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('polished_deepslate', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('glowstone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('ochre_froglight', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('oxidized_cut_copper', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('weathered_cut_copper', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('water', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('lava', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('block_of_quartz', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('quartz_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('brain_coral_block', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('block_of_amber', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('floatato', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('clay', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('end_stone_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('smooth_stone', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('smooth_stone_1', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('stone_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('tuff_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('snow_block', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('light_gray_cloth', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('pink_wool', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('nether_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('nether_bricks_1', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('nether_gold_ore', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('netherrack', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('polished_blackstone_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('oak_planks_1', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('acacia_planks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('bedrock', DEFAULT_INVENTORY_COUNT);

    // 新增方块 (6种) - 属性与 stone 一致
    this.player.inventory.add('polished_diorite', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('polished_granite', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('piston', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('piston_head', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('mud_bricks', DEFAULT_INVENTORY_COUNT);
    this.player.inventory.add('orange_shulker_box', DEFAULT_INVENTORY_COUNT);

    // 床方块
    this.player.inventory.add('bed_alias_block', DEFAULT_INVENTORY_COUNT);

    // 矿车物品
    this.player.inventory.add('mine_cart', DEFAULT_INVENTORY_COUNT);

    // 吊灯方块
    this.player.inventory.add('hanging_lamp', DEFAULT_INVENTORY_COUNT);

    // this.player.inventory.add('cloud', DEFAULT_INVENTORY_COUNT);

    // 预加载 JSON 结构数据
    preloadAllStructures().then(() => {
      console.log('[Game] All JSON structures preloaded');

      // 材质合批报告（调试用）
      materials.reportTextureGroups();
    }).catch(err => {
      console.warn('[Game] Failed to preload structures:', err);
    });

    // 延迟执行 Face Culling 审计并同步场景
    setTimeout(() => {
      if (faceCullingSystem) {
        faceCullingSystem.auditWorld(this.world, true);
      }
    }, 5000);
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
    audioManager.stopSound('rain');
  }

  /**
   * 初始化实体注册表
   * 注册所有复杂实体类型的放置处理器
   */
  initEntityRegistry() {
    // 注册炮塔放置处理器
    this.entityRegistry.register('turret_alias_block', new TurretPlacementHandler({
      player: this.player,
      world: this.world,
      game: this,
      turretManager: this.turretManager
    }));

    // 注册丧尸巢穴放置处理器
    this.entityRegistry.register('zombie_nest_alias_block', new ZombieNestPlacementHandler({
      player: this.player,
      world: this.world,
      game: this,
      zombieNestManager: this.zombieNestManager
    }));

    // 注册矿车放置处理器
    this.entityRegistry.register('mine_cart', new MinecartPlacementHandler({
      player: this.player,
      world: this.world,
      game: this,
      minecartManager: this.minecartManager
    }));

    console.log('[Game] EntityRegistry 初始化完成，已注册', this.entityRegistry.getRegistrationCount(), '个实体类型');
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
    const gameplayReady = this.world?.isGameplayReady?.() ?? true;

    // 首次进入 gameplayReady 状态时，隐藏加载模态框并锁定鼠标
    if (gameplayReady && !this._gameplayReady) {
      this._gameplayReady = true;
      const loadingModal = document.getElementById('game-loading-modal');
      if (loadingModal) {
        loadingModal.style.display = 'none';
      }
      // 请求鼠标锁定，让玩家可以控制视角
      // 浏览器要求用户手势才能锁定，首次可能失败，玩家点击画面后会再次触发
      if (document.body.requestPointerLock) {
        document.body.requestPointerLock().catch(() => {});
      }
      console.log('[Game] 世界加载完成，进入游戏');
    }

    if (this.player && gameplayReady) this.player.update(dt); // 更新玩家状态（移动、物理等）
    const t2 = performance.now();

    if (this.world && this.player) this.world.update(this.player.position, dt); // 更新世界状态（区块加载等）
    const t3 = performance.now();

    // 更新敌人管理器（替代原来的丧尸管理器）
    if (gameplayReady && this.enemyManager && this.player) {
      this.enemyManager.updateAll(this.player.position, dt);
    }

    // 更新炮塔管理器
    if (gameplayReady && this.turretManager) {
      this.turretManager.update(dt);
    }

    // 更新矿车管理器
    if (gameplayReady && this.minecartManager) {
      this.minecartManager.update(dt, getRotationAngle, this.player);
    }

    // 更新丧尸巢穴管理器
    if (gameplayReady && this.zombieNestManager) {
      this.zombieNestManager.update(dt);
    }

    // 更新下雨效果
    if (gameplayReady && this.rainEffect && this.rainState.enabled && this.player) {
      this.rainEffect.update(this.player.position, dt);
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
        if (this.engine.moonSprite) {
          this.engine.moonSprite.position.copy(this.player.position)
            .addScaledVector(this.engine.moonDirection, 150);
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
        }

        // 月光位置：与太阳光一致跟随玩家，但方向独立，作为黑夜柔和补光
        if (this.engine.moonLight) {
          this.engine.moonLight.position.copy(this.player.position)
            .addScaledVector(this.engine.moonDirection, 56);
          this.engine.moonLight.target.position.copy(this.player.position);
        }

        if (this.engine.light) {
          // 更新记录位置，用于下一次距离检测
          this.engine._lastUpdatePos.copy(this.player.position);
          // 玩家移动超过阈值后，请求刷新阴影贴图
          this.engine.requestShadowMapUpdate();
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
    const snapshot = this.collectSnapshot();
    console.log(`[Save] Game saved with seed: ${WORLD_CONFIG.SEED}`);
    await manualSaveService.save(snapshot);
  }

  /**
   * 收集当前游戏快照数据
   * @returns {object} 游戏快照对象
   */
  collectSnapshot() {
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
      // 调试：记录包含炮塔的区块
      if (data.entities?.turrets?.length > 0) {
        console.log(`[Save] 导出炮塔数据: chunk ${key}, 数量:`, data.entities.turrets.length);
      }
    }

    return {
      player: playerSnapshot,            // 玩家状态快照（位置、视角等）
      worldDeltas: worldDeltas,         // 世界变化数据（保存所有修改过的区块）
      seed: WORLD_CONFIG.SEED,           // 世界生成种子，用于确保地形一致性
      settings: {                        // 游戏设置
        canGunsDestroyBlocks: this.canGunsDestroyBlocks,
        canTntDestroyBlocks: this.canTntDestroyBlocks,
        maxActiveZombies: this.maxActiveZombies,
        visualStyle: this.engine.currentVisualStyle,
        textureBlurLevel: this.textureBlurLevel,
        colorHueShift: this.colorHueShift
      }
    };
  }

  /**
   * 设置全局贴图像素模糊程度（0~1）
   * @param {number} blurLevel - 0为清晰像素风，1为最大模糊
   */
  setTextureBlurLevel(blurLevel) {
    materials.setTextureBlurLevel(blurLevel);
    this.textureBlurLevel = materials.getTextureBlurLevel();
  }

  /**
   * 设置色调偏移值（度数）
   * @param {number} hueShift - 色调偏移度数（正值偏暖，负值偏冷）
   */
  setColorHueShift(hueShift) {
    this.engine.setColorHueShift(hueShift);
    this.colorHueShift = this.engine.getColorHueShift();
  }

  /**
   * 根据当前分辨率档位返回下雨质量预设
   * 目标：在低分辨率/性能档位主动降低雨滴数量，减少 FPS 波动
   */
  getRainQualityOptions() {
    const scale = this.engine?.resolutionScale ?? 1;
    if (scale <= 0.4) {
      return { particleCount: 120, radius: 18, speed: 22, dropLength: 0.45, refreshDistance: 10, lineWidth: 2 };
    }
    if (scale <= 0.7) {
      return { particleCount: 187, radius: 18, speed: 23, dropLength: 0.48, refreshDistance: 9, lineWidth: 2 };
    }
    return { particleCount: 267, radius: 18, speed: 24, dropLength: 0.5, refreshDistance: 8, lineWidth: 2 };
  }

  /**
   * 在分辨率变化时重建雨效参数，确保雨滴数量与当前档位匹配
   */
  refreshRainQualityIfNeeded() {
    if (!this.rainState.enabled) return;
    const playerPos = this.player ? this.player.position : { x: 0, y: 0, z: 0 };
    if (this.rainEffect) {
      this.rainEffect.dispose();
      this.rainEffect = null;
    }
    const qualityOptions = this.getRainQualityOptions();
    this.rainEffect = new RainEffect(this.engine.scene, {
      playerPos,
      world: this.world,
      ...qualityOptions
    });
  }

  /**
   * 切换下雨效果
   */
  toggleRain() {
    this.rainState.enabled = !this.rainState.enabled;
    if (this.rainState.enabled) {
      // 开启下雨，传入玩家位置
      const playerPos = this.player ? this.player.position : { x: 0, y: 0, z: 0 };
      const qualityOptions = this.getRainQualityOptions();
      this.rainEffect = new RainEffect(this.engine.scene, {
        playerPos,
        world: this.world,
        ...qualityOptions
      });
      audioManager.playSound('rain', 0.2, true);
      this.ui.hud.showMessage('已开启下雨');
    } else {
      // 关闭下雨
      if (this.rainEffect) {
        this.rainEffect.dispose();
        this.rainEffect = null;
      }
      audioManager.stopSound('rain');
      this.ui.hud.showMessage('已关闭下雨');
    }
  }

  /**
   * 导出存档到 JSON 文件
   */
  async exportToFile() {
    const snapshot = this.collectSnapshot();
    const saveData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      ...snapshot
    };

    // 创建 JSON Blob
    const jsonStr = JSON.stringify(saveData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    // 生成文件名：mc_save_YYYYMMDD_HHMMSS.json
    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const timeStr = String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const filename = `mc_save_${dateStr}_${timeStr}.json`;

    // 使用 File System Access API（如果支持）
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Minecraft Save Files',
            accept: { 'application/json': ['.json'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { success: true, filename };
      } catch (err) {
        // 用户取消操作，不执行下载
        if (err.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        // 其他 API 失败，继续执行传统下载方式
        console.warn('[Export] File System Access API failed, falling back to download:', err);
      }
    }

    // 回退：使用传统下载方式
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true, filename };
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
      this.canTntDestroyBlocks = saveData.settings.canTntDestroyBlocks !== undefined ? saveData.settings.canTntDestroyBlocks : false;
      this.maxActiveZombies = saveData.settings.maxActiveZombies !== undefined ? saveData.settings.maxActiveZombies : 10;
      this.enemyManager.maxActiveZombies = this.maxActiveZombies; // 同步到敌人管理器
      const visualStyle = saveData.settings.visualStyle || VISUAL_STYLE_KEYS.MORNING;
      this.engine.setVisualStyle(visualStyle);
      const textureBlurLevel = saveData.settings.textureBlurLevel !== undefined
        ? saveData.settings.textureBlurLevel
        : DEFAULT_TEXTURE_BLUR_LEVEL;
      this.setTextureBlurLevel(textureBlurLevel);
      const colorHueShift = saveData.settings.colorHueShift !== undefined
        ? saveData.settings.colorHueShift
        : DEFAULT_COLOR_HUE_SHIFT;
      this.setColorHueShift(colorHueShift);
    }

    // 4. 从存档恢复丧尸巢穴和炮塔实例
    if (saveData.worldDeltas) {
      console.log('[Save] 开始恢复实体，区块数量:', saveData.worldDeltas.length);
      for (const chunk of saveData.worldDeltas) {
        const { key, entities } = chunk;
        if (!entities) continue;
        const [cx, cz] = key.split(',').map(Number);

        // 恢复丧尸巢穴
        if (Array.isArray(entities.zombieNests) && entities.zombieNests.length > 0) {
          console.log(`[Save] 恢复丧尸巢穴: chunk ${key}, 数量:`, entities.zombieNests.length);
          this.zombieNestManager.restoreNestsForChunk(cx, cz, entities.zombieNests);
        }

        // 恢复炮塔
        if (Array.isArray(entities.turrets) && entities.turrets.length > 0) {
          console.log(`[Save] 恢复炮塔: chunk ${key}, 数量:`, entities.turrets.length);
          this.turretManager.restoreTurretsForChunk(cx, cz, entities.turrets);
        }

        // 恢复矿车
        if (Array.isArray(entities.minecarts) && entities.minecarts.length > 0) {
          console.log(`[Save] 恢复矿车: chunk ${key}, 数量:`, entities.minecarts.length);
          this.minecartManager.restoreMinecartsForChunk(cx, cz, entities.minecarts);
        }
      }
    }

    // 5. 检测创造台状态并更新UI
    if (this.ui) {
      // 重新检测创造台（存档数据已注入）
      const { playgroundService } = await import('../services/PlaygroundService.js');
      playgroundService.detectExistingPlayground();
      // 更新UI按钮状态
      this.ui.updatePlaygroundButtonState();
    }
  }

}
