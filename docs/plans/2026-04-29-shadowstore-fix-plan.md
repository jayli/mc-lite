# ShadowStore 数据一致性修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复两个影响 ShadowStore 数据一致性的 bug——Worker 部分失败静默丢弃，以及矿车跨 chunk 移动后 chunkKey 不更新。

**Architecture:** 修改 `ShadowSyncDispatcher.js` 使其检查 Worker 返回的 `failedKeys` 并重入队失败 key；修正 `ShadowSyncWorker.js` 中的 `successCount` 计数逻辑；在 `MinecartMovementSystem.js` 的跨 chunk 移动处同步更新 `chunkKey`。

**Tech Stack:** JavaScript (ES Modules), IndexedDB, Web Workers, Three.js 项目上下文

**当前分支**: `gen-big-map-first`

---

## Task 1: 修复 `ShadowSyncDispatcher._flush()` —— 检查 failedKeys

**Files:**
- Modify: `src/world/ShadowSyncDispatcher.js:54-62`

**Step 1: 修改 `_flush()` 方法，检查 Worker 返回的 result.failedKeys**

当前 `_flush()` 的 catch 块只在 RPC 异常时重入队，但 Worker 的 `batchSync` 即使有失败 key 也会正常 resolve（返回 `{ success: true, result: { successCount, failedKeys } }`）。需要改为检查 `failedKeys` 并仅重入队失败的 key。

将第 54-62 行的 try-catch 替换为：

```javascript
    try {
      const result = await this._rpc.postMessage('batchSync', { payloads });
      const failedKeys = result?.failedKeys || [];
      if (failedKeys.length > 0) {
        console.warn(`[ShadowSyncDispatcher] ${failedKeys.length} chunk(s) failed to sync:`, failedKeys);
        for (const key of failedKeys) {
          this._pending.add(key);
        }
      }
    } catch (error) {
      console.error('[ShadowSyncDispatcher] Flush failed:', error);
      // RPC 级别失败，所有 key 重入队
      for (const key of keys) {
        this._pending.add(key);
      }
    }
```

**Step 2: 验证修改后文件结构正确**

Run: `node -c src/world/ShadowSyncDispatcher.js`
Expected: no output (syntax OK)

**Step 3: 运行 lint 检查**

Run: `npm run lint`
Expected: no new errors

---

## Task 2: 修复 `ShadowSyncDispatcher.flushAll()` —— 检查 failedKeys

**Files:**
- Modify: `src/world/ShadowSyncDispatcher.js:87-91`

**Step 1: 修改 `flushAll()` 方法，检查 Worker 返回的 result.failedKeys**

当前 `flushAll()` 同样不检查 result，只捕获 RPC 异常。改为：

```javascript
    try {
      const result = await this._rpc.postMessage('flushAll', { allData: plainData });
      const failedKeys = result?.failedKeys || [];
      if (failedKeys.length > 0) {
        console.error(`[ShadowSyncDispatcher] flushAll: ${failedKeys.length} chunk(s) failed to persist:`, failedKeys);
      }
    } catch (error) {
      console.error('[ShadowSyncDispatcher] flushAll failed:', error);
    }
```

注意：`flushAll` 是退出时调用，没有后续的 `_pending` 重入队机制，所以只记录日志告警。

**Step 2: 验证语法**

Run: `node -c src/world/ShadowSyncDispatcher.js`
Expected: no output (syntax OK)

---

## Task 3: 修复 `ShadowSyncWorker.batchSync()` —— 修正 successCount 计数

**Files:**
- Modify: `src/workers/ShadowSyncWorker.js:60-67`

**Step 1: 修正 `batchSync` 中的 successCount 计数逻辑**

当前 `successCount += chunkMap.size` 在 region 存在但内部 chunk 缺失时会虚报。改为逐 chunk 计数：

将 line 60-67 的：
```javascript
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
              }
            }
            store.put(wrapped);
            successCount += chunkMap.size;
```

替换为：
```javascript
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
                successCount++;
              } else {
                failedKeys.push(chunkKey);
              }
            }
            store.put(wrapped);
```

这样只有真正写入的 chunk 才会计入 `successCount`，缺失的 chunk 会被加入 `failedKeys`。

**Step 2: 验证语法**

Run: `node -c src/workers/ShadowSyncWorker.js`
Expected: no output (syntax OK)

---

## Task 4: 修复 `ShadowSyncWorker.flushAll()` —— 修正计数和 failedKeys

**Files:**
- Modify: `src/workers/ShadowSyncWorker.js:121-129` and `src/workers/ShadowSyncWorker.js:136-139`

**Step 1: 修正 `flushAll` 中的 successCount 计数逻辑**

将 line 121-129 的：
```javascript
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
              }
            }
            store.put(wrapped);
            successCount += chunkMap.size;
```

替换为：
```javascript
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
                successCount++;
              } else {
                failedKeys.push(chunkKey);
              }
            }
            store.put(wrapped);
```

**Step 2: 修正 catch 块中的 failedKeys 记录**

将 line 136-139 的 catch 块：
```javascript
    } catch (error) {
      console.error(`[ShadowSyncWorker] Failed to flush region ${rKey}:`, error);
      failedKeys.push(rKey);
```

替换为（记录所有该 region 下的 chunk key 而非只记录 region key）：
```javascript
    } catch (error) {
      console.error(`[ShadowSyncWorker] Failed to flush region ${rKey}:`, error);
      for (const [key] of chunkMap) {
        if (!failedKeys.includes(key)) failedKeys.push(key);
      }
```

**Step 3: 验证语法**

Run: `node -c src/workers/ShadowSyncWorker.js`
Expected: no output (syntax OK)

---

## Task 5: 修复矿车跨 chunk 移动时 chunkKey 不更新

**Files:**
- Modify: `src/actors/minecart/MinecartMovementSystem.js:634-638`

**Step 1: 在跨 chunk 移动判断处添加 chunkKey 更新**

在 `MinecartMovementSystem.update()` 方法的 line 634-638 处（`if (Math.floor(newX) !== currentX || Math.floor(newZ) !== currentZ)` 块内），添加 chunkKey 同步更新：

将 line 634-638 的：
```javascript
    if (Math.floor(newX) !== currentX || Math.floor(newZ) !== currentZ) {
      if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
        manager.updateMinecartPositionIndex(minecart, oldPos);
      }
      minecart.lastTrackPosition = { x: currentX, y: currentY, z: currentZ };
    }
```

替换为：
```javascript
    if (Math.floor(newX) !== currentX || Math.floor(newZ) !== currentZ) {
      if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
        manager.updateMinecartPositionIndex(minecart, oldPos);
      }
      // 跨 chunk 时更新 chunkKey，确保 stopMinecartsForChunk 能正确过滤
      const newChunkKey = manager?.getChunkKeyByPosition(minecart.position);
      if (newChunkKey && newChunkKey !== minecart.chunkKey) {
        minecart.chunkKey = newChunkKey;
      }
      minecart.lastTrackPosition = { x: currentX, y: currentY, z: currentZ };
    }
```

**Step 2: 验证语法**

Run: `node -c src/actors/minecart/MinecartMovementSystem.js`
Expected: no output (syntax OK)

---

## Task 6: 运行 lint 并提交

**Step 1: 运行 lint**

Run: `npm run lint`
Expected: 0 errors, no new warnings compared to baseline

**Step 2: 创建提交**

```bash
git add src/world/ShadowSyncDispatcher.js
git add src/workers/ShadowSyncWorker.js
git add src/actors/minecart/MinecartMovementSystem.js
git commit -m "$(cat <<'EOF'
fix(shadow-store): handle worker partial failures and minecart chunkKey sync

- ShadowSyncDispatcher now checks result.failedKeys and re-queues failed
  chunks instead of silently dropping them
- ShadowSyncWorker batchSync/flushAll now counts success per-chunk instead
  of inflating with chunkMap.size
- MinecartMovementSystem updates minecart.chunkKey when crossing chunk
  boundaries, fixing stopMinecartsForChunk missing moved minecarts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 验证指南

由于此项目使用浏览器内测试（`src/tests/index.html`），修改完成后：

1. 启动开发服务器：`npm run start`
2. 打开浏览器访问 `http://localhost:8080`
3. 在浏览器控制台中观察 `[ShadowSyncDispatcher]` 和 `[ShadowSyncWorker]` 日志
4. 测试场景：
   - 放置/删除炮塔后观察 IndexedDB 是否正确同步（可在 DevTools → Application → IndexedDB 中查看 `world_regions` 表）
   - 让矿车从一个 chunk 移动到另一个 chunk，然后触发 chunk 卸载（走远），再回来验证矿车是否在正确位置
