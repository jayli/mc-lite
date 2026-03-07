# Chunk.js 分拆重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将1794行的Chunk.js按功能职责拆分为5个独立模块，保持功能完全兼容，提升代码可维护性。

**Architecture:** 采用渐进式分拆策略，每次抽离一个功能模块，每完成一个模块都进行功能验证，确保不破坏现有功能。所有方法仍然挂载在Chunk类原型上，对外API保持完全不变。

**Tech Stack:** JavaScript ES6+, Three.js, Web Workers

---

### Task 1: 创建子模块骨架文件

**Files:**
- Create: `src/world/ChunkConsolidation.js`
- Create: `src/world/ChunkGenerator.js`
- Create: `src/world/ChunkPersistence.js`
- Create: `src/world/ChunkRenderUtils.js`

**Step 1: 创建四个空的子模块文件**
```javascript
// 每个文件的初始结构：
export function extendChunk(Chunk) {
  // 方法将被挂载到这里
}
```

**Step 2: 在Chunk.js中导入子模块**
在Chunk.js的导入部分添加：
```javascript
import { extendChunk as extendWithConsolidation } from './ChunkConsolidation.js';
import { extendChunk as extendWithGenerator } from './ChunkGenerator.js';
import { extendChunk as extendWithPersistence } from './ChunkPersistence.js';
import { extendChunk as extendWithRenderUtils } from './ChunkRenderUtils.js';
```

**Step 3: 在Chunk类定义后调用扩展方法**
```javascript
// Chunk类定义结束后
extendWithConsolidation(Chunk);
extendWithGenerator(Chunk);
extendWithPersistence(Chunk);
extendWithRenderUtils(Chunk);
```

**Step 4: 验证代码可以正常运行**
启动开发服务器，确保没有导入错误。

**Step 5: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): add submodule skeleton files"
```

---

### Task 2: 抽离 Consolidation 模块

**Files:**
- Modify: `src/world/ChunkConsolidation.js`
- Modify: `src/world/Chunk.js:283-470` (删除原scheduleConsolidation和consolidate方法)

**Step 1: 复制相关方法到ChunkConsolidation.js**
将scheduleConsolidation()、consolidate()及相关辅助方法移动到extendChunk函数中：
```javascript
export function extendChunk(Chunk) {
  Chunk.prototype.scheduleConsolidation = function() {
    // 原代码
  };

  Chunk.prototype.consolidate = async function() {
    // 原代码
  };

  // 其他相关辅助方法
}
```

**Step 2: 处理依赖**
确保方法中使用的所有内部属性和外部依赖都能正确访问，需要的导入添加到ChunkConsolidation.js顶部。

**Step 3: 删除Chunk.js中的原有代码**
删除Chunk.js中对应的方法定义。

**Step 4: 验证功能**
启动游戏，测试方块添加/删除功能，确认合并机制正常工作。

**Step 5: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): extract consolidation module"
```

---

### Task 3: 抽离 Generator 模块

**Files:**
- Modify: `src/world/ChunkGenerator.js`
- Modify: `src/world/Chunk.js:550-782` (删除原gen方法)

**Step 1: 复制gen方法及相关辅助方法到ChunkGenerator.js**
```javascript
export function extendChunk(Chunk) {
  Chunk.prototype.gen = async function() {
    // 原代码
  };

  // 相关辅助方法
}
```

**Step 2: 处理依赖**
添加必要的导入，确保所有内部属性访问正常。

**Step 3: 删除Chunk.js中的原有代码**
删除Chunk.js中对应的方法定义。

**Step 4: 验证功能**
测试新方块生成、地形加载功能，确认生成逻辑正常。

**Step 5: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): extract generator module"
```

---

### Task 4: 抽离 Persistence 模块

**Files:**
- Modify: `src/world/ChunkPersistence.js`
- Modify: `src/world/Chunk.js:471-549, 821-1288` (删除save相关方法)

**Step 1: 复制持久化相关方法到ChunkPersistence.js**
```javascript
export function extendChunk(Chunk) {
  Chunk.prototype._saveChestStates = function() {
    // 原代码
  };

  Chunk.prototype.saveDebounced = function() {
    // 原代码
  };

  // 其他相关保存/加载方法
}
```

**Step 2: 处理依赖**
添加必要的导入。

**Step 3: 删除Chunk.js中的原有代码**
删除Chunk.js中对应的方法定义。

**Step 4: 验证功能**
测试数据保存/加载功能，确认持久化正常工作。

**Step 5: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): extract persistence module"
```

---

### Task 5: 抽离 RenderUtils 模块

**Files:**
- Modify: `src/world/ChunkRenderUtils.js`
- Modify: `src/world/Chunk.js:783-820, 1289-1794` (删除渲染相关方法)

**Step 1: 复制渲染相关方法到ChunkRenderUtils.js**
```javascript
export function extendChunk(Chunk) {
  Chunk.prototype.dispose = function() {
    // 原代码
  };

  Chunk.prototype.regenerateCrossChunkColliders = function() {
    // 原代码
  };

  Chunk.prototype._scheduleBatchFaceCullingUpdate = function() {
    // 原代码
  };

  Chunk.prototype.processPendingFaceCullingUpdates = function() {
    // 原代码
  };

  // 其他渲染相关工具方法
}
```

**Step 2: 处理依赖**
添加必要的导入。

**Step 3: 删除Chunk.js中的原有代码**
删除Chunk.js中对应的方法定义。

**Step 4: 验证功能**
测试渲染功能、AO计算、碰撞体生成，确认所有渲染逻辑正常。

**Step 5: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): extract render utils module"
```

---

### Task 6: 清理和优化

**Files:**
- Modify: `src/world/Chunk.js`
- Test: 运行所有测试

**Step 1: 清理Chunk.js**
- 移除不需要的导入
- 整理剩余代码结构
- 添加必要的注释

**Step 2: 运行所有测试**
访问 http://localhost:8080/src/tests/index.html，运行所有测试，确保全部通过。

**Step 3: 性能验证**
测试游戏性能，确认分拆后没有性能下降。

**Step 4: Commit**
```bash
git add src/world/Chunk*.js
git commit -m "refactor(chunk): clean up and optimize after split"
```

---

## 完成标准
1. Chunk.js 代码行数减少到 ~350 行
2. 所有功能与分拆前完全一致
3. 所有测试通过
4. 没有性能退化
