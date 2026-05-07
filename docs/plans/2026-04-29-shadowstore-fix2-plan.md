# ShadowStore 二次修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复三个上次提交遗漏的问题——失败 key 不重试、空 runtimeEntities 不清空 ShadowStore、flushAll 未接入生命周期。

**Architecture:** 修改 `ShadowSyncDispatcher.js` 使 `_flush()` 在重入队失败 key 后调用 `_scheduleFlush()` 自动重试；修改 `Chunk.js` 在加载空实体数据时清空 ShadowStore；在 `dispose()` 中调用 `flushAll()` 确保退出前数据落盘。

**Tech Stack:** JavaScript (ES Modules), IndexedDB, Web Workers

**当前分支**: `gen-big-map-first`

---

## Task 1: `_flush()` 失败 key 重入队后重新调度 flush

**Files:**
- Modify: `src/world/ShadowSyncDispatcher.js:57-69`

**Step 1: 在 try 块的 failedKeys 重入队后添加 `_scheduleFlush()`**

当前 `_flush()` 将 failedKeys 加入 `_pending` 后不调度，如果后续没有新的 `markDirty`，失败 key 永远不会重试。

将第 57-62 行：
```javascript
      if (failedKeys.length > 0) {
        console.warn(`[ShadowSyncDispatcher] ${failedKeys.length} chunk(s) failed to sync:`, failedKeys);
        for (const key of failedKeys) {
          this._pending.add(key);
        }
      }
```

替换为：
```javascript
      if (failedKeys.length > 0) {
        console.warn(`[ShadowSyncDispatcher] ${failedKeys.length} chunk(s) failed to sync:`, failedKeys);
        for (const key of failedKeys) {
          this._pending.add(key);
        }
        this._scheduleFlush();
      }
```

**Step 2: 在 catch 块的重入队后也添加 `_scheduleFlush()`**

将第 63-69 行：
```javascript
    } catch (error) {
      console.error('[ShadowSyncDispatcher] Flush failed:', error);
      // RPC 级别失败，所有 key 重入队
      for (const key of keys) {
        this._pending.add(key);
      }
    }
```

替换为：
```javascript
    } catch (error) {
      console.error('[ShadowSyncDispatcher] Flush failed:', error);
      // RPC 级别失败，所有 key 重入队
      for (const key of keys) {
        this._pending.add(key);
      }
      this._scheduleFlush();
    }
```

**Step 3: 验证语法**

Run: `node -c src/world/ShadowSyncDispatcher.js`
Expected: no output (syntax OK)

---

## Task 2: `Chunk.loadFromRecord` 处理空 runtimeEntities 场景

**Files:**
- Modify: `src/world/Chunk.js:345-359`

**Step 1: 在 else 分支中添加空数据清空逻辑**

当前代码在 `hasRuntimeEntities` 为 false 时进入 else 分支，如果 `cache.entities` 也没有数据，`_needsEntityMigration` 设为 false 但不清空 ShadowStore。

在第 349 行 `const cacheEntities = hydrateResult?.entities;` 之后，修改 else 分支的内层逻辑。

将第 349-358 行：
```javascript
      const cacheEntities = hydrateResult?.entities;
      if (cacheEntities && (
        cacheEntities.turrets?.length > 0 ||
        cacheEntities.zombieNests?.length > 0 ||
        cacheEntities.minecarts?.length > 0
      )) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, cacheEntities);
        this._needsEntityMigration = true;
      } else {
        this._needsEntityMigration = false;
      }
```

替换为：
```javascript
      const cacheEntities = hydrateResult?.entities;
      if (cacheEntities && (
        cacheEntities.turrets?.length > 0 ||
        cacheEntities.zombieNests?.length > 0 ||
        cacheEntities.minecarts?.length > 0
      )) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, cacheEntities);
        this._needsEntityMigration = true;
      } else {
        // 空数据也需要清空 ShadowStore，避免已删除实体在 chunk 重载后回流
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, {
          turrets: [],
          zombieNests: [],
          minecarts: []
        });
        this._needsEntityMigration = false;
      }
```

注意：`deserializeAndMerge` 内部会先 `clear()` 该 chunk 的三个 Map，所以即使 ShadowStore 中本来就没有这个 chunk 的数据，调用也是安全的。

**Step 2: 验证语法**

Run: `node -c src/world/Chunk.js`
Expected: no output (syntax OK)

---

## Task 3: `dispose()` 中调用 `flushAll()`

**Files:**
- Modify: `src/world/ShadowSyncDispatcher.js:134-143`

**Step 1: 在 dispose 方法中调用 flushAll**

当前 `dispose()` 只清理 timer 和终止 worker，不触发最终 flush。

将第 134-143 行：
```javascript
  dispose() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._rpc) {
      this._rpc.worker?.terminate();
      this._rpc = null;
    }
  }
```

替换为：
```javascript
  dispose() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    // 退出前全量 flush，确保最后脏数据落盘
    if (this._pending.size > 0 || this._rpc) {
      this.flushAll();
    }
    if (this._rpc) {
      this._rpc.worker?.terminate();
      this._rpc = null;
    }
  }
```

注意：`flushAll()` 是 async 方法，但在 dispose 中没有 await。这是因为 dispose 通常在同步上下文中调用（如页面关闭），无法 await async 函数。`flushAll` 会立即开始执行，即使 worker 在 flush 完成前被 terminate，Worker 内的 IndexedDB 事务也会尽力完成。

**Step 2: 验证语法**

Run: `node -c src/world/ShadowSyncDispatcher.js`
Expected: no output (syntax OK)

---

## Task 4: 运行 lint 并提交

**Step 1: 运行 lint**

Run: `npm run lint`
Expected: 0 errors, no new warnings

**Step 2: 创建提交**

```bash
git add src/world/ShadowSyncDispatcher.js src/world/Chunk.js docs/plans/2026-04-29-shadowstore-fix2-design.md docs/plans/2026-04-29-shadowstore-fix2-plan.md
git commit -m "$(cat <<'EOF'
fix(shadow-store): retry failed flushes, clear on empty load, wire flushAll to dispose

- _flush() now calls _scheduleFlush() after re-queuing failed keys,
  ensuring automatic retry on next debounce cycle
- Chunk.loadFromRecord calls deserializeAndMerge with empty data when
  no runtimeEntities are found, preventing deleted entity resurrection
- ShadowSyncDispatcher.dispose() calls flushAll() before terminating
  the worker, persisting final dirty data on exit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 验证指南

1. 启动开发服务器：`npm run start`
2. 浏览器控制台观察 `[ShadowSyncDispatcher]` 日志：失败 key 应在 500ms 后自动重试
3. 删除所有炮塔后重启游戏，确认炮塔不再回流
4. 正常退出游戏，检查 IndexedDB 中 `world_regions` 表数据是否已落盘
