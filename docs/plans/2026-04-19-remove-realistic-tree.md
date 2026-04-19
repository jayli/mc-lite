# 移除 RealisticTree 并以黄叶子普通树替代 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 删除 RealisticTree 特殊实体系统，将原本 15% 概率生成 RealisticTree 的位置替换为黄叶子方块树（tree_big 风格），并清理所有相关代码。

**Architecture:** 将 WorldWorker 中 `realisticTrees.push()` 改为调用 `createStructureTask(generateYellowTree)`，生成与普通 tree_big 相同的方块堆叠树（wood 树干 + yellow_leaves 树叶）。删除 RealisticTree.js、RealisticTreeManager.js 及相关导入/调用。

**Tech Stack:** JavaScript, Web Workers, Three.js

---

### Task 1: WorldWorker — 新增 generateYellowTree 并替换 realisticTrees.push

**Files:**
- Modify: `src/workers/WorldWorker.js:1158-1162`（FOREST biome 树木生成处）
- Modify: `src/workers/WorldWorker.js:1993-1995`（在 generateBirchTree 函数后添加 generateYellowTree）

**Step 1: 添加 generateYellowTree 函数**

在 `generateBirchTree` 函数后面（约第 1995 行后）添加：

```js
/**
 * 生成黄叶子大树（替代 RealisticTree）
 * 使用方块堆叠方式，与 tree_big 一致
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateYellowTree(x, y, z, chunk, dObj) {
  Tree.generate(x, y, z, chunk, 'big', dObj, null, 'yellow_leaves');
}
```

**Step 2: 替换 realisticTrees.push 为 createStructureTask**

将第 1161-1162 行：
```js
if (seededRandom(wx, wz, seed + 15) < 0.15) {
  realisticTrees.push({ x: wx, y: h + 1, z: wz });
```

替换为：
```js
if (seededRandom(wx, wz, seed + 15) < 0.15) {
  createStructureTask(
    generateYellowTree.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
    wx, h + 1, wz, 'static_tree'
  );
```

**Step 3: 删除 realisticTrees 变量及相关代码**

在 WorldWorker 中删除：
- 第 448 行：`let realisticTrees = [];`
- 第 510 行 snapshot 中的 `realisticTrees: snapshot.entities.realisticTrees || [],`
- 第 515 行 snapshot 默认值中的 `realisticTrees: [],`
- 第 1702 行：`realisticTrees = savedSnapshot.entities.realisticTrees || [];`
- 第 1716-1721 行：`if (realisticTrees) { realisticTrees.forEach(...) }` 整个代码块
- 第 1903 行 postMessage 中的 `realisticTrees,`
- 第 1905 行 entities 中的 `realisticTrees,`
- 第 1917 行 snapshot entities 中的 `realisticTrees,`

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 4: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "refactor: replace realisticTrees with yellow block trees in WorldWorker"
```

---

### Task 2: 删除 RealisticTree.js 和 RealisticTreeManager.js

**Files:**
- Delete: `src/world/entities/RealisticTree.js`
- Delete: `src/world/entity-system/RealisticTreeManager.js`

**Step 1: 删除文件**

```bash
git rm src/world/entities/RealisticTree.js src/world/entity-system/RealisticTreeManager.js
```

**Step 2: Commit**

```bash
git commit -m "remove: delete RealisticTree and RealisticTreeManager files"
```

---

### Task 3: Chunk.js — 清理 RealisticTree 相关代码

**Files:**
- Modify: `src/world/Chunk.js`

**Step 1: 删除 RealisticTree import**

删除第 23 行：
```js
import { RealisticTree } from './entities/RealisticTree.js';
```

**Step 2: 删除 entities 中的 realisticTrees**

将第 204 行：
```js
this.entities = { realisticTrees: [], modGunMan: [], rovers: [] };
```

改为：
```js
this.entities = { modGunMan: [], rovers: [] };
```

**Step 3: 删除 _handleRealisticTreeRemoval 方法**

删除第 567-600 行（整个 `_handleRealisticTreeRemoval` 方法）。

**Step 4: 删除 addBlockDynamic 中的调用**

将第 1700 行：
```js
this._handleRealisticTreeRemoval(x, y, z, oldType);
```

删除此行。

**Step 5: 删除 assembleEntityPhase 中的 RealisticTree 逻辑**

将第 1461-1465 行：
```js
const realisticTrees = this.pendingSpecialEntityData?.realisticTrees || [];
realisticTrees.forEach(pos => {
  RealisticTree.generate(pos.x, pos.y, pos.z, this, null, true);
});
RealisticTree.createInstancedForChunk(this);
```

删除这 5 行。

**Step 6: 删除 acceptWorkerResult 中的 realisticTrees 相关代码**

将第 1339 行 payload 解构中的 `realisticTrees,` 删除。
将第 1372 行 `this.entities.realisticTrees = realisticTrees || [];` 删除。
将第 1377 行 `realisticTrees: realisticTrees || [],` 从 pendingSpecialEntityData 对象中删除。

**Step 7: 更新注释**

将第 125 行注释中的 `RealisticTree 树干占位` 改为 `特殊实体占位`。
将第 140 行注释中的 `RealisticTree` 改为 `特殊实体`。
将第 202 行注释中的 `realisticTrees 等实体` 改为 `modGunMan、rover 等实体`。

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 8: Commit**

```bash
git add src/world/Chunk.js
git commit -m "refactor: remove RealisticTree code from Chunk.js"
```

---

### Task 4: BlockScatterManager.js — 删除 realisticTrees 分发

**Files:**
- Modify: `src/world/BlockScatterManager.js:69-75`

**Step 1: 删除 scatterEntities 中的 realisticTrees**

将第 73-75 行：
```js
if (entities.realisticTrees?.length) {
  chunk.entities.realisticTrees = entities.realisticTrees;
}
```

删除这 3 行。

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 2: Commit**

```bash
git add src/world/BlockScatterManager.js
git commit -m "refactor: remove realisticTrees from BlockScatterManager"
```

---

### Task 5: Game.js — 删除 realisticTreeManager.init()

**Files:**
- Modify: `src/core/Game.js`

**Step 1: 删除 import**

删除第 10 行：
```js
import { realisticTreeManager } from '../world/entity-system/RealisticTreeManager.js';
```

**Step 2: 删除 init 调用**

删除第 172-173 行：
```js
// 初始化树木管理器（用于生成逼真树木）
realisticTreeManager.init();
```

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 3: Commit**

```bash
git add src/core/Game.js
git commit -m "refactor: remove realisticTreeManager.init() from Game.js"
```

---

### Task 6: ChunkConsolidation.js — 删除 snapshot 中的 realisticTrees

**Files:**
- Modify: `src/world/ChunkConsolidation.js:255-262`

**Step 1: 删除 Worker 回调中的 realisticTrees**

将第 258 行解构中的 `realisticTrees,` 删除。
将第 262 行回调参数中的 `realisticTrees,` 删除。

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 2: Commit**

```bash
git add src/world/ChunkConsolidation.js
git commit -m "refactor: remove realisticTrees from ChunkConsolidation worker callback"
```

---

### Task 7: PlayerInteraction.js — 删除 realistic_trunk/realistic_leaves 掉落物处理

**Files:**
- Modify: `src/actors/player/PlayerInteraction.js:559-560`

**Step 1: 删除 realistic_trunk/realistic_leaves 掉落判断**

将第 559-560 行：
```js
if (type === 'realistic_trunk') this.player.inventory.add('wood', 1);
else if (type === 'realistic_leaves') { if (Math.random() < 0.8) this.player.inventory.add('leaves', 1); }
else this.player.inventory.add(type, 1);
```

改为：
```js
this.player.inventory.add(type, 1);
```

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 2: Commit**

```bash
git add src/actors/player/PlayerInteraction.js
git commit -m "refactor: remove realistic_trunk/leaves drop handling from PlayerInteraction"
```

---

### Task 8: 测试文件清理

**Files:**
- Modify: `src/tests/test-mocks.js:8`
- Modify: `src/tests/test-chunk.js:36`
- Modify: `src/tests/test-world.js:77`

**Step 1: test-mocks.js — 删除 realistic_trunk_collider**

将第 8 行：
```js
const solidTypes = ['stone', 'dirt', 'wood', 'collider', 'realistic_trunk_collider'];
```

改为：
```js
const solidTypes = ['stone', 'dirt', 'wood', 'collider'];
```

**Step 2: test-chunk.js — 删除 realisticTrees**

删除第 36 行：
```js
realisticTrees: [],
```

**Step 3: test-world.js — 删除 realisticTrees**

删除第 77 行：
```js
realisticTrees: [],
```

Run: `npm run lint`
Expected: 无新增错误/警告

**Step 4: Commit**

```bash
git add src/tests/test-mocks.js src/tests/test-chunk.js src/tests/test-world.js
git commit -m "test: remove realisticTrees from test mocks"
```

---

### Task 9: 可选清理 — BlockData.js 中的 realistic 方块定义

**Files:**
- Modify: `src/constants/BlockData.js`
- Modify: `src/core/MaterialManager.js`

**Step 1: BlockData.js — 保留定义（其他代码可能引用）**

`realistic_trunk_collider`、`realistic_oak_leaves`、`realistic_yellow_leaves` 的方块定义**暂时保留**，不删除。原因：
- 这些是方块属性定义，可能被存档数据引用
- 删除可能导致旧存档加载时方块属性缺失
- 作为死代码保留，后续 PR 统一清理

**Step 2: MaterialManager.js — 保留材质定义**

`realistic_trunk_procedural`、`realistic_oak_leaves`、`realistic_yellow_leaves` 材质**暂时保留**，不删除。原因同上。

**Step 3: Commit**

无需提交，此步骤不做修改。

---

### Task 10: 验证 — 运行测试和 lint

**Files:**
- 无修改

**Step 1: 运行 lint**

```bash
npm run lint
```

Expected: 仅有已有的历史警告，无新增警告。

**Step 2: 启动开发服务器验证**

```bash
npm run start
```

访问 http://localhost:8080 ，在森林 biome 中确认：
- 树木正常渲染（黄叶子普通树）
- 无控制台错误
- 树木可以被正常挖掘

**Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address any remaining issues"
```
