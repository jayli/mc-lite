# 炮塔枪造型重设计实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 将现有炮塔的简单枪造型替换为现代化楔形炮塔设计

**Architecture:** 使用 Three.js 基础几何体（BoxGeometry、CylinderGeometry）组合成楔形炮塔主体 + 细长炮管 + 蓝色瞄准器，保持现有旋转和射击逻辑不变

**Tech Stack:** Three.js r160, ES2020+, 现有 Turret.js 架构

---

## Task 1: 更新配置常量

**Files:**
- Modify: `src/actors/turret/Turret.js:10-47`

**Step 1: 替换原有枪配置为新的炮塔配置**

将原有的 `GUN_HANDLE_SIZE`、`GUN_BARREL_SIZE`、`MUZZLE_SIZE` 配置替换为新的楔形炮塔配置：

```javascript
// 新的炮塔外观配置
TURRET_TOWER_SIZE: {
  FRONT: [1.6, 1.2, 0.4],      // 前装甲板 [宽, 高, 深]
  SIDE: [0.8, 1.0, 1.5],       // 侧装甲板 [宽, 高, 深]
  TOP: [1.6, 0.3, 1.5],        // 顶装甲板 [宽, 高, 深]
  BACK: [1.6, 1.2, 0.3],       // 后装甲板 [宽, 高, 深]
},
TURRET_TOWER_COLOR: {
  MAIN: 0xcccccc,   // 浅灰色主体
  DARK: 0xbbbbbb,   // 中灰色后板
},
TURRET_TOWER_POS: {
  FRONT: [0, -0.2, 0.6],       // 前板相对位置
  LEFT: [-0.8, -0.1, -0.2],    // 左板相对位置
  RIGHT: [0.8, -0.1, -0.2],    // 右板相对位置
  TOP: [0, 0.6, -0.2],         // 顶板相对位置
  BACK: [0, -0.2, -0.95],      // 后板相对位置
},

// 炮管系统配置
GUN_BARREL_SIZE: {
  LENGTH: 3.0,           // 炮管长度
  DIAMETER: 0.3,         // 炮管直径
},
GUN_ROOT_SIZE: [0.6, 0.6, 0.4],  // 炮管根部尺寸
GUN_SIGHT_SIZE: [0.3, 0.3, 0.4], // 瞄准器尺寸
GUN_COLOR: {
  BARREL: 0x222222,      // 黑色炮管
  ROOT: 0xeeeeee,        // 白色根部
  SIGHT: 0x3366cc,       // 蓝色瞄准器
},
GUN_POS: {
  BARREL_Z: 2.0,         // 炮管 Z 偏移
  ROOT_Z: 0.5,           // 根部 Z 偏移
  SIGHT_Y: 0.5,          // 瞄准器 Y 偏移
  SIGHT_Z: 0.3,          // 瞄准器 Z 偏移
},

// 更新炮口位置（新炮管更长）
MUZZLE_OFFSET_Z: 3.5,    // 炮口在炮管最前端
```

**Step 2: 验证配置语法**

运行: `npm run lint -- src/actors/turret/Turret.js`
Expected: 无语法错误

**Step 3: Commit**

```bash
git add src/actors/turret/Turret.js
git commit -m "feat: update turret gun configuration constants for modern design"
```

---

## Task 2: 重写炮塔顶部创建方法

**Files:**
- Modify: `src/actors/turret/Turret.js:162-193`

**Step 1: 重写 createTurretTopBlocks 方法**

完全替换现有的 `createTurretTopBlocks` 方法：

```javascript
/**
 * 创建炮塔顶部的楔形结构（替代原来的简单枪造型）
 * 现代化海军炮塔风格：楔形主体 + 细长炮管 + 蓝色瞄准器
 */
createTurretTopBlocks() {
  console.log(`[Turret ${this.id}] 创建现代化楔形炮塔...`);

  // === 创建炮塔主体（楔形结构）===

  // 1. 前装甲板（倾斜前表面）
  const frontGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.FRONT);
  const mainMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.TURRET_TOWER_COLOR.MAIN });
  const front = new THREE.Mesh(frontGeometry, mainMaterial);
  front.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.FRONT);
  this.pitchObject.add(front);
  this.turretMeshes.push(front);

  // 2. 左侧装甲板
  const leftGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.SIDE);
  const left = new THREE.Mesh(leftGeometry, mainMaterial);
  left.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.LEFT);
  this.pitchObject.add(left);
  this.turretMeshes.push(left);

  // 3. 右侧装甲板
  const rightGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.SIDE);
  const right = new THREE.Mesh(rightGeometry, mainMaterial);
  right.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.RIGHT);
  this.pitchObject.add(right);
  this.turretMeshes.push(right);

  // 4. 顶部装甲板
  const topGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.TOP);
  const top = new THREE.Mesh(topGeometry, mainMaterial);
  top.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.TOP);
  this.pitchObject.add(top);
  this.turretMeshes.push(top);

  // 5. 后装甲板（深色）
  const backGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.BACK);
  const darkMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.TURRET_TOWER_COLOR.DARK });
  const back = new THREE.Mesh(backGeometry, darkMaterial);
  back.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.BACK);
  this.pitchObject.add(back);
  this.turretMeshes.push(back);

  // === 创建炮管系统 ===

  // 6. 炮管（细长圆柱）
  const barrelGeometry = new THREE.CylinderGeometry(
    TURRET_CONFIG.GUN_BARREL_SIZE.DIAMETER / 2,
    TURRET_CONFIG.GUN_BARREL_SIZE.DIAMETER / 2,
    TURRET_CONFIG.GUN_BARREL_SIZE.LENGTH,
    12
  );
  // 旋转圆柱使其沿 Z 轴延伸
  barrelGeometry.rotateX(Math.PI / 2);
  const barrelMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.BARREL });
  const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrel.position.set(0, 0, TURRET_CONFIG.GUN_POS.BARREL_Z);
  this.pitchObject.add(barrel);
  this.turretMeshes.push(barrel);

  // 7. 炮管根部（白色连接机构）
  const rootGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.GUN_ROOT_SIZE);
  const rootMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.ROOT });
  const root = new THREE.Mesh(rootGeometry, rootMaterial);
  root.position.set(0, 0, TURRET_CONFIG.GUN_POS.ROOT_Z);
  this.pitchObject.add(root);
  this.turretMeshes.push(root);

  // 8. 蓝色瞄准器（光学传感器）
  const sightGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.GUN_SIGHT_SIZE);
  const sightMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.SIGHT });
  const sight = new THREE.Mesh(sightGeometry, sightMaterial);
  sight.position.set(0, TURRET_CONFIG.GUN_POS.SIGHT_Y, TURRET_CONFIG.GUN_POS.SIGHT_Z);
  this.pitchObject.add(sight);
  this.turretMeshes.push(sight);

  console.log(`[Turret ${this.id}] 炮塔创建完成: 5个主体部件 + 3个炮管部件`);
}
```

**Step 2: 运行 lint 检查**

Run: `npm run lint -- src/actors/turret/Turret.js`
Expected: 无语法错误

**Step 3: Commit**

```bash
git add src/actors/turret/Turret.js
git commit -m "feat: implement modern wedge-shaped turret design"
```

---

## Task 3: 验证游戏运行

**Files:**
- Test: 游戏运行验证

**Step 1: 启动开发服务器**

Run: `npm run start`
Expected: 服务器启动在 8080 端口

**Step 2: 打开游戏验证炮塔外观**

1. 打开浏览器访问 `http://localhost:8080`
2. 放置一个炮塔（如果已有存档，检查现有炮塔）
3. 观察新炮塔外观：
   - [ ] 楔形主体呈现
   - [ ] 黑色细长炮管
   - [ ] 白色根部连接
   - [ ] 蓝色瞄准器

**Step 3: 测试功能**

1. 炮塔能正常旋转（偏航）
2. 炮塔能正常俯仰（当附近有敌人）
3. 炮弹从炮管前端正确发射
4. 射击命中逻辑正常

**Step 4: Commit 完成**

```bash
git commit -m "feat: complete modern turret gun redesign

- Replace simple gun with wedge-shaped turret body
- Add long black barrel (3.0 length, 0.3 diameter)
- Add white mounting root
- Add blue optical sight
- Update muzzle offset for new barrel length"
```

---

## 附录：修改前后对比

### 外观对比
| 方面 | 旧版 | 新版 |
|------|------|------|
| 主体 | 简单方块枪把 | 楔形多面体装甲 |
| 炮管 | 短粗方块 | 细长圆柱 |
| 颜色 | 灰/深灰/黑 | 浅灰装甲 + 黑炮管 + 蓝瞄准器 |
| 视觉风格 | 简陋 | 现代化海军炮塔 |

### 文件变更摘要
- `src/actors/turret/Turret.js`: 更新配置 + 重写 createTurretTopBlocks 方法

### 配置变更摘要
- 移除: `GUN_HANDLE_*`, `GUN_BARREL_*`, `MUZZLE_*` 旧配置
- 新增: `TURRET_TOWER_*`, `GUN_BARREL_*`, `GUN_POS` 新配置
- 修改: `MUZZLE_OFFSET_Z` 从 3.1 改为 3.5（适应更长炮管）
