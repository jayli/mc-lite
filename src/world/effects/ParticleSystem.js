// src/world/effects/ParticleSystem.js
// 这里是原来粒子特效的重写，现在都已经改为了序列帧的实现方式
// 性能比之前用粒子示例模拟效果更好一些，而且这是实现特效的标准做法
import * as THREE from 'three';

/**
 * 粒子系统管理器
 * 统一管理 2D 序列帧特效（挖掘、爆炸等）
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.textureLoader = new THREE.TextureLoader();

    // --- 挖掘特效配置 (Pick) ---
    this.MAX_DIG_BILLBOARDS = 20;
    this.digBillboards = [];
    this.initEffectPool(
      'src/world/assets/gif/pick.png',
      5, 3, // 5x3 布局
      0.35,  // 持续 0.35s
      this.MAX_DIG_BILLBOARDS,
      this.digBillboards,
      false // 不使用 AdditiveBlending
    );

    // --- 爆炸特效配置 (Blow) ---
    this.MAX_EXPLOSION_BILLBOARDS = 10;
    this.explosionBillboards = [];
    this.initEffectPool(
      'src/world/assets/gif/big_blow.png',
      5, 2, // 5x2 布局
      0.5,   // 持续 0.5s
      this.MAX_EXPLOSION_BILLBOARDS,
      this.explosionBillboards,
      true  // 使用 AdditiveBlending 增强发光感
    );
  }

  /**
   * 初始化特效对象池
   */
  initEffectPool(path, tilesX, tilesY, maxLife, count, pool, useAdditive) {
    const texture = this.textureLoader.load(path);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.repeat.set(1 / tilesX, 1 / tilesY);

    for (let i = 0; i < count; i++) {
      const tex = texture.clone();
      tex.needsUpdate = true;

      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: useAdditive ? THREE.AdditiveBlending : THREE.NormalBlending
      });

      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.scene.add(sprite);

      pool.push({
        sprite,
        active: false,
        timer: 0,
        maxLife,
        tilesX,
        tilesY,
        totalFrames: tilesX * tilesY
      });
    }
  }

  /**
   * 每帧更新所有活跃特效
   * @param {number} dt - 增量时间
   */
  update(dt) {
    this._updatePool(this.digBillboards, dt, (progress, sprite) => {
      // 挖掘特效特有动画：爆开并缩小
      const scale = 1.0 + progress * 2.0;
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = 1.0 - progress;
    });

    this._updatePool(this.explosionBillboards, dt, (progress, sprite) => {
      // 爆炸特效特有动画：快速扩张并淡出
      const scale = 3.0 + progress * 5.0;
      sprite.scale.set(scale, scale, 1);
      // 前 80% 保持亮，最后 20% 消失
      sprite.material.opacity = progress < 0.8 ? 1.0 : 1.0 - (progress - 0.8) / 0.2;
    });
  }

  /**
   * 内部更新逻辑
   */
  _updatePool(pool, dt, animCallback) {
    for (const item of pool) {
      if (!item.active) continue;
      item.timer += dt;
      const progress = item.timer / item.maxLife;

      if (progress >= 1) {
        item.active = false;
        item.sprite.visible = false;
      } else {
        // 更新序列帧
        const currentFrame = Math.floor(progress * item.totalFrames);
        const col = currentFrame % item.tilesX;
        const row = Math.floor(currentFrame / item.tilesX);

        const tex = item.sprite.material.map;
        tex.offset.x = col / item.tilesX;
        tex.offset.y = 1.0 - (1.0 / item.tilesY) - (row / item.tilesY);

        // 自定义动画
        animCallback(progress, item.sprite);
      }
    }
  }

  /**
   * 触发挖掘粒子
   */
  spawnDigEffect(pos) {
    const item = this.digBillboards.find(b => !b.active);
    if (item) {
      item.active = true;
      item.timer = 0;
      item.sprite.position.copy(pos);
      item.sprite.visible = true;
      item.sprite.scale.set(1, 1, 1);
      item.sprite.material.opacity = 1;
    }
  }

  /**
   * 触发爆炸效果
   */
  spawnExplosionEffect(pos) {
    const item = this.explosionBillboards.find(b => !b.active);
    if (item) {
      item.active = true;
      item.timer = 0;
      item.sprite.position.copy(pos);
      item.sprite.visible = true;
      item.sprite.scale.set(3, 3, 1);
      item.sprite.material.opacity = 1;
      item.sprite.material.rotation = Math.random() * Math.PI;
    }
  }
}
