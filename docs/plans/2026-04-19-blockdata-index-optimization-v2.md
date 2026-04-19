# blockData 索引优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `chunk.blockData` 从字符串 key (`"x,y,z"`) 改为数字编码 key (`Map<number, entry>`)，消除 GC 压力。

**Architecture:** 采用大整数乘法编码替代位运算（避免 JS 32bit 截断陷阱）；`blockData` 改为 `Map`，`solidBlocks`/`visibleKeys` 同步改为 `Set<number>`；所有消费者统一通过 `getBlockEntry/setBlockEntry/removeBlockEntry` 访问；Worker 边界保持字符串格式，主线程在收发时做转换。

**Tech Stack:** Vanilla JS, Three.js, Map/Set, postMessage Workers

---

## Task 1: encodeCoord / decodeCoord 编码工具 + 单元测试

**Files:**
- Modify: `src/world/Chunk.js:43-260`（在 static 方法区添加编码函数）
- Test: `src/tests/test-chunk.js`

**Step 1: 在 Chunk 类中添加编码/解码静态方法**

在 `src/world/Chunk.js` 中 `static getAOImpactedNeighborKeys` 方法之后、`constructor` 之前添加：

```js
  /**
   * 将世界坐标编码为数字 key（大整数乘法编码，避免 JS 位运算 32bit 截断）
   * 支持范围: x,z ∈ [-1_000_000, +1_000_000], y ∈ [-512, +512]
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {number} 编码后的数字 key
   */
  static encodeCoord(x, y, z) {
    return ((Math.floor(x) + 1000000) * 2049 + (Math.floor(y) + 512)) * 2000001 + (Math.floor(z) + 1000000);
  }

  /**
   * 将数字 key 解码为世界坐标
   * @param {number} code - 编码后的数字 key
   * @returns {{x:number,y:number,z:number}} 世界坐标
   */
  static decodeCoord(code) {
    const z = (code % 2000001) - 1000000;
    const t = Math.floor(code / 2000001);
    const y = (t % 2049) - 512;
    const x = Math.floor(t / 2049) - 1000000;
    return { x, y, z };
  }
```

**Step 2: 写单元测试验证编码/解码**

在 `src/tests/test-chunk.js` 中添加测试：

```js
function testEncodeDecodeCoord() {
  // 正数
  let code = Chunk.encodeCoord(10, 20, 30);
  let decoded = Chunk.decodeCoord(code);
  assertEqual(decoded.x, 10, 'encode/decode x positive');
  assertEqual(decoded.y, 20, 'encode/decode y positive');
  assertEqual(decoded.z, 30, 'encode/decode z positive');

  // 负数（上次失败的根因场景）
  code = Chunk.encodeCoord(5, -3, 8);
  decoded = Chunk.decodeCoord(code);
  assertEqual(decoded.x, 5, 'encode/decode x with negative y');
  assertEqual(decoded.y, -3, 'encode/decode negative y');
  assertEqual(decoded.z, 8, 'encode/decode z with negative y');

  // 边界值
  code = Chunk.encodeCoord(-1000000, -512, -1000000);
  decoded = Chunk.decodeCoord(code);
  assertEqual(decoded.x, -1000000, 'encode/decode min x');
  assertEqual(decoded.y, -512, 'encode/decode min y');
  assertEqual(decoded.z, -1000000, 'encode/decode min z');

  code = Chunk.encodeCoord(1000000, 512, 1000000);
  decoded = Chunk.decodeCoord(code);
  assertEqual(decoded.x, 1000000, 'encode/decode max x');
  assertEqual(decoded.y, 512, 'encode/decode max y');
  assertEqual(decoded.z, 1000000, 'encode/decode max z');

  // 唯一性
  const set = new Set();
  for (let x = 0; x < 20; x++) {
    for (let y = -10; y < 10; y++) {
      for (let z = 0; z < 20; z++) {
        const c = Chunk.encodeCoord(x, y, z);
        assertTrue(!set.has(c), `duplicate code at ${x},${y},${z}`);
        set.add(c);
      }
    }
  }
}
```

**Step 3: 运行测试**

Run: 启动 `npm run start`，浏览器访问 `http://localhost:8080/src/tests/index.html`，点击"运行所有测试"
Expected: testEncodeDecodeCoord 通过

**Step 4: Commit**

```bash
git add src/world/Chunk.js src/tests/test-chunk.js
git commit -m "feat(chunk): 添加坐标编码/解码工具与单元测试"
```

---

## Task 2: Chunk.js 核心数据结构 + 底层查询方法改造

**Files:**
- Modify: `src/world/Chunk.js:95-530`

**目标：** 将 `blockData` 改为 `Map`，`solidBlocks`/`visibleKeys` 改为 `Set<number>`，删除/改造所有基于字符串 key 的私有查询方法。

**Step 1: 改造 constructor 中的初始化**

```js
// 变更前:
this.blockData = {};
this.solidBlocks = new Set();
this.visibleKeys = new Set();

// 变更后:
this.blockData = new Map();
this.solidBlocks = new Set();
this.visibleKeys = new Set();
```

**Step 2: 改造 _updateBlockState**

```js
_updateBlockState(x, y, z, type, entry) {
  const code = Chunk.encodeCoord(x, y, z);

  // === blockData（权威存储）===
  if (type === 'air') {
    this.blockData.delete(code);
    this.visibleKeys.delete(code);
  } else {
    this.blockData.set(code, entry);
    this.visibleKeys.add(code);
  }

  // 更新碰撞体集合
  const props = getBlockProps(type);
  if (props.isSolid) {
    this.solidBlocks.add(code);
  } else {
    this.solidBlocks.delete(code);
  }

  // === blockDataArray（高性能数组存储）===
  const blockIndex = this._getBlockIndex(x, y, z);
  if (blockIndex >= 0) {
    if (type === 'air') {
      const oldId = this.blockDataArray[blockIndex];
      if (oldId !== 0) {
        this.solidBlockIds.delete(oldId);
        this.blockDataArray[blockIndex] = 0;
      }
    } else {
      const blockId = this._getOrCreateBlockId(entry);
      const oldId = this.blockDataArray[blockIndex];
      if (oldId !== 0 && oldId !== blockId) {
        this.solidBlockIds.delete(oldId);
      }
      this.blockDataArray[blockIndex] = blockId;
      if (props.isSolid) {
        this.solidBlockIds.add(blockId);
      } else {
        this.solidBlockIds.delete(blockId);
      }
    }
  }
}
```

注意：调用方（addBlockDynamic 等）的传参也要从 `(key, type, entry, x, y, z)` 改为 `(x, y, z, type, entry)`。

**Step 3: 删除旧的字符串 key 私有查询方法，添加新的坐标查询方法**

删除 `_getBlockTypeByKey`、`_getBlockEntryByKey`、`_isBlockVisibleByKey`、`_hasBlockByKey`。

改造 `getBlockEntry`：

```js
getBlockEntry(x, y, z) {
  const code = Chunk.encodeCoord(x, y, z);
  // 先查 blockData（权威存储）
  const entry = this.blockData.get(code);
  if (entry) return parseBlockEntry(entry);
  // 回退到 blockDataArray
  const blockIndex = this._getBlockIndex(x, y, z);
  if (blockIndex >= 0) {
    const blockId = this.blockDataArray[blockIndex];
    if (blockId) {
      const arrEntry = this._getEntryFromBlockId(blockId);
      if (arrEntry) return parseBlockEntry(arrEntry);
    }
  }
  return null;
}
```

添加 `hasBlockEntry`：

```js
hasBlockEntry(x, y, z) {
  const code = Chunk.encodeCoord(x, y, z);
  if (this.blockData.has(code)) return true;
  const blockIndex = this._getBlockIndex(x, y, z);
  if (blockIndex >= 0) {
    return this.blockDataArray[blockIndex] !== 0;
  }
  return false;
}
```

**Step 4: 改造 _initArrayStorageFromBlockData**

```js
_initArrayStorageFromBlockData() {
  this.blockDataArray.fill(0);
  this.blockPalette.clear();
  this.blockPaletteReverse.clear();
  this.solidBlockIds.clear();
  this.nextBlockId = 1;

  for (const [code, entry] of this.blockData) {
    const { x, y, z } = Chunk.decodeCoord(code);
    const parsed = parseBlockEntry(entry);
    const type = parsed.type;
    if (!type || type === 'air') continue;

    const lx = x - this.cx * CHUNK_SIZE;
    const ly = y - this.worldY;
    const lz = z - this.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      continue;
    }
    const blockIndex = (ly << 8) | (lz << 4) | lx;
    const blockId = this._getOrCreateBlockId(entry);
    this.blockDataArray[blockIndex] = blockId;

    const props = getBlockProps(type);
    if (props.isSolid) {
      this.solidBlockIds.add(blockId);
    }
  }
}
```

**Step 5: 改造 acceptWorkerResult**

Worker 返回的 `visibleKeys` 和 `solidBlocks` 仍是字符串数组，接收时转换为数字编码：

```js
acceptWorkerResult(payload = {}) {
  const { scatteredBlocks, solidBlocks, realisticTrees, modGunMan, rovers, visibleKeys, snapshot, structureCenters } = payload;

  if (!this.visibleKeys) this.visibleKeys = new Set();
  if (!this.solidBlocks) this.solidBlocks = new Set();
  this.visibleKeys.clear();
  this.solidBlocks.clear();

  if (visibleKeys) {
    for (const key of visibleKeys) {
      const [x, y, z] = key.split(',').map(Number);
      this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
    }
  }
  if (solidBlocks) {
    for (const key of solidBlocks) {
      const [x, y, z] = key.split(',').map(Number);
      this.solidBlocks.add(Chunk.encodeCoord(x, y, z));
    }
  }

  // ... 其余不变
}
```

**Step 6: 运行 lint**

Run: `npm run lint`
Expected: 0 errors（可能有预先存在的 warnings）

**Step 7: Commit**

```bash
git add src/world/Chunk.js
git commit -m "refactor(chunk): blockData 改为 Map，查询方法改为坐标参数"
```

---

## Task 3: Chunk.js 写入路径与公共 API 改造

**Files:**
- Modify: `src/world/Chunk.js:1650-2400`

**Step 1: 改造 addBlockDynamic**

```js
addBlockDynamic(x, y, z, typeOrEntry, orientation = 0) {
  const entry = typeof typeOrEntry === 'string'
    ? { type: typeOrEntry, orientation }
    : parseBlockEntry(typeOrEntry);
  const { type } = entry;
  const blockOrientation = entry.orientation || 0;
  const code = Chunk.encodeCoord(x, y, z);

  if (!this._isInResponsibility(x, y, z)) return;

  // 获取旧方块信息
  const oldEntry = this.blockData.get(code);
  const oldParsed = parseBlockEntry(oldEntry);
  const oldType = oldParsed.type;

  getPersistenceService().recordChangeForChunk(this.cx, this.cz, x, y, z, entry);

  // 改造后的 _updateBlockState 签名：(x, y, z, type, entry)
  this._updateBlockState(x, y, z, type, entry);
  this.saveDebounced();

  // Face Culling 计算...（visibleKeys 操作改用 code）
  // ... 保留原有逻辑，只把 key 改为 code
  // mask === 0 && !fcSystem.isTransparent(type)
  //   ? this.visibleKeys.delete(code)
  //   : this.visibleKeys.add(code);

  // 其余渲染逻辑中 key 均改为 code
}
```

**Step 2: 改造 addBlocksBatchFast**

```js
addBlocksBatchFast(blocks, options = {}) {
  // ...
  for (const block of blocks) {
    const x = Math.floor(block.x);
    const y = Math.floor(block.y);
    const z = Math.floor(block.z);
    const code = Chunk.encodeCoord(x, y, z);

    // ...
    const oldEntry = this.blockData.get(code);
    // ...
    this._updateBlockState(x, y, z, nextType, entry);
    // ...
  }
}
```

**Step 3: 改造 removeBlocksBatch**

```js
removeBlocksBatch(positions, isBatch = true) {
  // ...
  positions.forEach(p => {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    const code = Chunk.encodeCoord(px, py, pz);
    const oldEntry = this.blockData.get(code);

    if (oldEntry) {
      // ...
      delete this.blockData[code];  // 改为 this.blockData.delete(code);
      this.visibleKeys.delete(code);
      this.solidBlocks.delete(code);
      // ...
    }
  });

  // InstancedMesh 移除中 typeMap.has(key) 改为 typeMap.has(code)
  // neighborsToUpdate 中的 key 也改为 code
}
```

**Step 4: 改造 acceptScatteredBlocks**

```js
acceptScatteredBlocks(scatteredBlocks, visibleBlockKeys) {
  const minX = this.cx * CHUNK_SIZE;
  const minZ = this.cz * CHUNK_SIZE;

  for (const block of scatteredBlocks) {
    const localX = block.x - minX;
    const localZ = block.z - minZ;
    if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) continue;

    const code = Chunk.encodeCoord(block.x, block.y, block.z);

    if (block.orientation !== 0) {
      this.blockData.set(code, { type: block.type, orientation: block.orientation });
    } else {
      this.blockData.set(code, block.type);
    }

    const props = getBlockProps(block.type);
    if (props.isSolid) {
      this.solidBlocks.add(code);
    }
  }

  if (visibleBlockKeys) {
    for (const key of visibleBlockKeys) {
      const [x, y, z] = key.split(',').map(Number);
      this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
    }
  }

  this._initArrayStorageFromBlockData();
  this.buildMeshesFromScatteredData();
  this.loadState = 'terrain-built';
  this.isReady = true;
  this.world?.onChunkWorkerReady?.(this);
}
```

**Step 5: 改造 appendScatteredBlocks**

与 acceptScatteredBlocks 类似，将字符串 key 改为数字编码。注意 `key in this.blockData` 改为 `this.blockData.has(code)`。

**Step 6: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 7: Commit**

```bash
git add src/world/Chunk.js
git commit -m "refactor(chunk): 写入路径全面改用数字编码"
```

---

## Task 4: Chunk.js 渲染、AO、辅助方法改造

**Files:**
- Modify: `src/world/Chunk.js:530-1650`, `src/world/Chunk.js:2400-end`

**Step 1: 改造 _revealNeighbors**

```js
_revealNeighbors(x, y, z) {
  const neighbors = Chunk.getAOImpactedNeighborKeys(x, y, z);
  for (const neighbor of neighbors) {
    if (!neighbor.isOrthogonal) continue;
    const nx = neighbor.x, ny = neighbor.y, nz = neighbor.z;
    const nCx = Math.floor(nx / CHUNK_SIZE);
    const nCz = Math.floor(nz / CHUNK_SIZE);

    if (nCx === this.cx && nCz === this.cz) {
      const nCode = Chunk.encodeCoord(nx, ny, nz);
      const entry = this.blockData.get(nCode);
      if (entry) {
        const parsed = parseBlockEntry(entry);
        const props = getBlockProps(parsed.type);
        if (!this.visibleKeys.has(nCode) && props.isRendered !== false) {
          this._refreshBlockRenderMesh(nx, ny, nz, nCode, entry);
        } else if (this.visibleKeys.has(nCode)) {
          this._refreshBlockRenderLightweight(nx, ny, nz, nCode, entry);
        }
      }
    } else {
      // 跨 chunk ...
    }
  }
  this._markDirtyAO(x, y, z, false);
}
```

注意：`getAOImpactedNeighborKeys` 返回的对象中仍有 `key: "x,y,z"` 字符串字段。这个字段是否被使用？搜索发现 `_revealNeighbors` 只用 `neighbor.x/y/z/isOrthogonal`，不用 `neighbor.key`。但其他地方可能用。保险起见，把 `getAOImpactedNeighborKeys` 中的 `key` 也改为数字编码：

```js
static getAOImpactedNeighborKeys(x, y, z) {
  const impacted = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const nx = Math.floor(x + dx);
        const ny = Math.floor(y + dy);
        const nz = Math.floor(z + dz);
        impacted.push({
          x: nx, y: ny, z: nz,
          code: Chunk.encodeCoord(nx, ny, nz),
          isOrthogonal: Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1
        });
      }
    }
  }
  return impacted;
}
```

**Step 2: 改造 _markAllBlocksDirtyAO**

```js
_markAllBlocksDirtyAO() {
  for (const [code, entry] of this.blockData) {
    if (!entry) continue;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
      this.dirtyAOPositions.add(code);
    }
  }
}
```

**Step 3: 改造 _addDirtyAOPosition**

```js
_addDirtyAOPosition(x, y, z) {
  const code = Chunk.encodeCoord(x, y, z);
  const ncx = Math.floor(x / CHUNK_SIZE);
  const ncz = Math.floor(z / CHUNK_SIZE);

  if (ncx === this.cx && ncz === this.cz) {
    const entry = this.blockData.get(code);
    const type = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
    if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
      this.dirtyAOPositions.add(code);
    }
  } else {
    const nChunk = this.world?.chunks?.get(`${ncx},${ncz}`);
    if (nChunk && nChunk.isReady) {
      const entry = nChunk.blockData.get(code);
      const type = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
      if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
        nChunk.dirtyAOPositions.add(code);
      }
    }
  }
}
```

**Step 4: 改造 _executeAORefresh**

```js
_executeAORefresh() {
  this._flushAOOperationQueue();
  if (this.dirtyAOPositions.size === 0) return;
  if (!this.isReady || this.isConsolidating) return;

  const sentCodes = new Set(this.dirtyAOPositions);
  const positions = [...sentCodes].map(code => Chunk.decodeCoord(code));

  // neighborChunks 收集... blockData 传 Object.fromEntries(this.blockData)
  // 其余不变
}
```

**Step 5: 改造 _applyAOResults**

```js
_applyAOResults(results, sentCodes) {
  // ...
  for (const r of results) {
    const code = Chunk.encodeCoord(r.x, r.y, r.z);
    const type = this._getBlockTypeByKey?.(code); // 此方法已删除，需要替代
    // 改为：
    const entry = this.blockData.get(code);
    const type = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
    // ...
    const idx = typeMap.get(code);
    // ...
  }

  if (sentCodes) {
    for (const code of sentCodes) {
      this.dirtyAOPositions.delete(code);
    }
  }
}
```

**Step 6: 改造 _registerLightSources / _unregisterLightSources**

```js
_registerLightSources() {
  if (!this.world.lightSourceManager) return;
  for (const [code, entry] of this.blockData) {
    const parsed = parseBlockEntry(entry);
    if (!parsed.type || parsed.type === 'air') continue;
    const props = getBlockProps(parsed.type);
    if (props.isLightSource) {
      const { x, y, z } = Chunk.decodeCoord(code);
      this.world.lightSourceManager.addLight(x, y, z, parsed.type);
    }
  }
}
```

**Step 7: 改造 buildMeshesFromScatteredData**

```js
buildMeshesFromScatteredData() {
  const groupedByType = {};
  for (const [code, entry] of this.blockData) {
    const parsed = parseBlockEntry(entry);
    const type = parsed.type;
    const orientation = parsed.orientation || 0;
    const { x, y, z } = Chunk.decodeCoord(code);

    if (!groupedByType[type]) groupedByType[type] = [];
    groupedByType[type].push({ code, orientation, x, y, z });
  }

  // ...
  for (let i = 0; i < count; i++) {
    const b = blocks[i];
    // ...
    instanceIndexMap[b.code] = i;  // key 改为 code
  }
  // ...
}
```

**Step 8: 改造 _removeInstancedMeshBlock**

```js
_removeInstancedMeshBlock(code, x, y, z, oldType) {
  // ...
  const typeMap = this.instanceIndexMap[oldType];
  if (typeMap && typeMap.has(code)) {
    const idx = typeMap.get(code);
    // ...
    typeMap.delete(code);
    // ...
  }
  // Fallback 中坐标比较逻辑不变（从 Matrix4 读出的仍是世界坐标）
}
```

**Step 9: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 10: Commit**

```bash
git add src/world/Chunk.js
git commit -m "refactor(chunk): 渲染/AO/辅助方法改用数字编码"
```

---

## Task 5: World.js 跨区块查询改造

**Files:**
- Modify: `src/world/World.js:640-910`

**Step 1: 改造 resolveBlockOwner**

```js
resolveBlockOwner(x, y, z, options = {}) {
  const allowScan = options.allowScan !== false;
  const ix = x | 0, iy = y | 0, iz = z | 0;
  const cx = ix >> 4, cz = iz >> 4;
  const coordChunkKey = `${cx},${cz}`;
  const coordChunk = this.chunks.get(coordChunkKey) || null;
  const blockCode = Chunk.encodeCoord(ix, iy, iz);

  if (coordChunk?.isReady) {
    const lx = ix & 15;
    const ly = iy - coordChunk.worldY;
    const lz = iz & 15;
    if (ly >= 0 && ly < 16) {
      const blockIndex = (ly << 8) | (lz << 4) | lx;
      const blockId = coordChunk.blockDataArray?.[blockIndex];
      if (blockId) {
        const entry = coordChunk._getEntryFromBlockId(blockId);
        if (entry) {
          this.crossChunkOwnerCache.delete(blockCode);
          return { ownerChunk: coordChunk, ownerChunkKey: coordChunkKey, coordChunk, coordChunkKey, blockCode, entry };
        }
      }
    }
    // 回退到 blockData
    const entry = coordChunk.blockData.get(blockCode);
    if (entry) {
      this.crossChunkOwnerCache.delete(blockCode);
      return { ownerChunk: coordChunk, ownerChunkKey: coordChunkKey, coordChunk, coordChunkKey, blockCode, entry };
    }
  }

  const ownerChunkKey = this.crossChunkOwnerCache.get(blockCode);
  if (ownerChunkKey) {
    const ownerChunk = this.chunks.get(ownerChunkKey);
    if (ownerChunk?.isReady) {
      const entry = ownerChunk.blockData.get(blockCode);
      if (entry) {
        return { ownerChunk, ownerChunkKey, coordChunk, coordChunkKey, blockCode, entry };
      }
    }
    this.crossChunkOwnerCache.delete(blockCode);
  }

  if (!allowScan) return null;

  for (const [otherKey, otherChunk] of this.chunks) {
    if (!otherChunk?.isReady || otherKey === coordChunkKey) continue;
    const entry = otherChunk.blockData.get(blockCode);
    if (entry) {
      this.crossChunkOwnerCache.set(blockCode, otherKey);
      return { ownerChunk: otherChunk, ownerChunkKey: otherKey, coordChunk, coordChunkKey, blockCode, entry };
    }
  }
  return null;
}
```

注意：返回字段从 `blockKey` 改为 `blockCode`。所有调用方需要同步检查是否读取 `blockKey` 字段。搜索发现 `checkReveal` 使用 `owner.blockKey` —— 需要改为 `owner.blockCode`。

**Step 2: 改造 isSolid**

```js
isSolid(x, y, z) {
  const cx = x >> 4, cz = z >> 4;
  const key = `${cx},${cz}`;
  const chunk = this.chunks.get(key);

  if (!chunk || !chunk.isReady) {
    const h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);
    return y <= h;
  }

  const ix = x | 0, iy = y | 0, iz = z | 0;
  const lx = ix & 15;
  const ly = iy - chunk.worldY;
  const lz = iz & 15;
  if (ly >= 0 && ly < 16) {
    const blockIndex = (ly << 8) | (lz << 4) | lx;
    const blockId = chunk.blockDataArray?.[blockIndex];
    if (blockId && chunk.solidBlockIds?.has(blockId)) return true;
  }

  const blockCode = Chunk.encodeCoord(ix, iy, iz);
  if (chunk.solidBlocks.has(blockCode)) return true;

  const entry = chunk.blockData.get(blockCode);
  if (entry) {
    const typeStr = typeof entry === 'string' ? entry : (entry?.type || '');
    if (typeStr && getBlockProps(typeStr).isSolid) return true;
  }

  return !!chunk.getSpecialEntityCollisionAt?.(ix, iy, iz);
}
```

**Step 3: 改造 getAllBlockOwners**

```js
getAllBlockOwners(x, y, z) {
  const ix = x | 0, iy = y | 0, iz = z | 0;
  const cx = ix >> 4, cz = iz >> 4;
  const coordChunkKey = `${cx},${cz}`;
  const coordChunk = this.chunks.get(coordChunkKey) || null;
  const blockCode = Chunk.encodeCoord(ix, iy, iz);
  const owners = [];

  if (coordChunk) {
    const entry = coordChunk.blockData.get(blockCode);
    if (entry) {
      owners.push({ ownerChunk: coordChunk, ownerChunkKey: coordChunkKey, coordChunk, coordChunkKey, blockCode, entry });
    }
  }

  for (const [otherKey, otherChunk] of this.chunks) {
    if (!otherChunk || !otherChunk.isReady || otherKey === coordChunkKey) continue;
    const entry = otherChunk.blockData.get(blockCode);
    if (!entry) continue;
    owners.push({ ownerChunk: otherChunk, ownerChunkKey: otherKey, coordChunk, coordChunkKey, blockCode, entry });
  }

  return owners;
}
```

**Step 4: 检查并修复所有 `owner.blockKey` 的调用方**

搜索 `owner.blockKey` 和 `owner.blockCode` 的使用：
- `Chunk.js:checkReveal` 使用 `owner.blockKey` → 改为 `owner.blockCode`
- `Chunk.js:1837`：`const { blockKey, entry } = owner;` → `const { blockCode, entry } = owner;`
- `Chunk.js:1839`：`targetChunk.visibleKeys.has(blockKey)` → `targetChunk.visibleKeys.has(blockCode)`
- `Chunk.js:1841-1849`：传递的 blockKey 参数改为 blockCode

**Step 5: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/world/World.js src/world/Chunk.js
git commit -m "refactor(world): 跨区块查询改用数字编码"
```

---

## Task 6: 渲染管线工具改造

**Files:**
- Modify: `src/world/ChunkConsolidation.js`
- Modify: `src/world/ChunkRenderUtils.js`
- Modify: `src/world/ChunkNeighborUtils.js`
- Modify: `src/world/ChunkMeshDataFilter.js`

**Step 1: ChunkConsolidation.js**

`_applyConsolidateResult`：
- `key = \`${x},${y},${z}\`` 改为 `code = Chunk.encodeCoord(x, y, z)`
- `this.blockData[key]` 改为 `this.blockData.get(code)`
- `_tempOriginalSolidBlocks` 存储的是 Worker 返回的字符串数组，需改为数字编码

`_syncVisibilityAndCollision`：
- `visibleKeys` / `solidBlocks` 数组元素需 `encodeCoord`
- `dynamicMeshes.keys()` 已经是数字编码（Task 3 已改）
- `this.blockData[key]` 改为 `this.blockData.get(code)`

`_convertScatteredBlocksToMeshData`：
- `instanceIndexMap[key] = i` 改为 `instanceIndexMap[code] = i`

`_filterWorkerResult`：
- `filterWorkerResultAgainstBlockData(data, this.blockData)` — blockData 现在是 Map，filter 函数需要适配

**Step 2: ChunkRenderUtils.js**

`regenerateCrossChunkColliders`：
- `key = \`${bx},${by},${bz}\`` 改为 `code = Chunk.encodeCoord(bx, by, bz)`
- `this.blockData[key]` 改为 `this.blockData.get(code)`
- `this.solidBlocks.add(code)`

`processPendingFaceCullingUpdates`：
- `nKey` 从字符串改为数字编码
- `this.blockData[nKey]` 改为 `this.blockData.get(nCode)`
- `nKey.split(',')` 改为 `Chunk.decodeCoord(nCode)`

**Step 3: ChunkNeighborUtils.js**

`createChunkNeighborSampler`：
- `key = \`${nx},${ny},${nz}\`` 改为 `code = Chunk.encodeCoord(nx, ny, nz)`
- `targetChunk.blockData[key]` 改为 `targetChunk.blockData.get(code)`

**Step 4: ChunkMeshDataFilter.js**

所有 `blockData[key]` 改为 `blockData.get(code)`，其中 blockData 参数现在是 Map。

```js
function filterLegacyRenderData(d, blockData) {
  if (!d) return d;
  const filtered = {};
  for (const type in d) {
    if (type.endsWith('_collider')) continue;
    filtered[type] = d[type].filter(pos => {
      const code = Chunk.encodeCoord(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      return getEntryType(blockData.get(code)) === type;
    });
  }
  return filtered;
}

function filterMeshData(meshData, blockData) {
  if (!Array.isArray(meshData)) return meshData;
  const filtered = [];
  for (const item of meshData) {
    if (item.type?.endsWith('_collider')) continue;
    const entries = Object.entries(item.instanceIndexMap || {})
      .map(([key, index]) => ({ code: Number(key), index }))  // key 已是字符串化的数字
      .sort((a, b) => a.index - b.index);

    const keepEntries = entries.filter(({ code }) => getEntryType(blockData.get(code)) === item.type);
    // ...
    const instanceIndexMap = {};
    keepEntries.forEach((entry, newIndex) => {
      instanceIndexMap[entry.code] = newIndex;
    });
    // ...
  }
  return filtered;
}

export function filterWorkerResultAgainstBlockData(data, blockData) {
  let { d, meshData, visibleKeys, solidBlocks } = data;
  if (visibleKeys) {
    visibleKeys = visibleKeys.filter(key => {
      const [x, y, z] = key.split(',').map(Number);
      return blockData.get(Chunk.encodeCoord(x, y, z)) !== undefined;
    });
  }
  if (solidBlocks) {
    solidBlocks = solidBlocks.filter(key => {
      const [x, y, z] = key.split(',').map(Number);
      return blockData.get(Chunk.encodeCoord(x, y, z)) !== undefined;
    });
  }
  return { visibleKeys, solidBlocks, d: filterLegacyRenderData(d, blockData), meshData: filterMeshData(meshData, blockData) };
}
```

注意：`instanceIndexMap` 在 JSON 序列化后，key 会变成字符串。但从 `buildMeshesFromScatteredData` 和 `_convertScatteredBlocksToMeshData` 改造后，`instanceIndexMap` 的 key 应该是数字。在 `filterMeshData` 中 `Object.entries(item.instanceIndexMap)` 得到的 key 是字符串，需要用 `Number(key)` 转换。或者更安全的做法是在序列化/反序列化时保持数字 key —— 但 JS Object 的 key 只能是字符串，所以这里需要显式 `Number(key)`。

实际上 `item.instanceIndexMap` 是从 Worker 传回或从 `buildMeshesFromScatteredData` 构造的。如果是 Worker 传回，经过 postMessage 序列化后 key 会变成字符串。如果是 `buildMeshesFromScatteredData` 直接构造的 `instanceIndexMap[b.code] = i`，由于 `b.code` 是数字，但在 Object 中仍然会被转为字符串 key。

所以无论哪种情况，`Object.entries(item.instanceIndexMap)` 得到的 key 都是字符串。需要统一用 `Number(key)` 转成数字后再查 blockData。这是一个需要小心的点。

**Step 5: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/world/ChunkConsolidation.js src/world/ChunkRenderUtils.js src/world/ChunkNeighborUtils.js src/world/ChunkMeshDataFilter.js
git commit -m "refactor(rendering): 渲染管线工具改用数字编码"
```

---

## Task 7: 面剔除与 AO 工具改造

**Files:**
- Modify: `src/utils/FaceCullingCore.js`
- Modify: `src/core/FaceCullingSystem.js`
- Modify: `src/core/FaceCullingSystemDebug.js`
- Modify: `src/utils/AOUtils.js`

**Step 1: FaceCullingCore.js**

```js
export function createBlockDataNeighborQuery(blockData, x, y, z) {
  return function getNeighborType(dx, dy, dz) {
    const code = Chunk.encodeCoord(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz));
    const entry = blockData.get(code);
    return entry || null;
  };
}

export function createCrossChunkNeighborQuery(blockData, worldChunks, currentCx, currentCz, x, y, z) {
  return function getNeighborType(dx, dy, dz) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const nxChunk = Math.floor(nx / 16);
    const nzChunk = Math.floor(nz / 16);
    const code = Chunk.encodeCoord(Math.floor(nx), Math.floor(ny), Math.floor(nz));

    if (nxChunk === currentCx && nzChunk === currentCz) {
      return blockData.get(code) || null;
    }

    const chunkKey = `${nxChunk},${nzChunk}`;
    const neighborChunk = worldChunks.get(chunkKey);
    if (neighborChunk && neighborChunk.blockData) {
      return neighborChunk.blockData.get(code) || null;
    }
    return null;
  };
}
```

注意：`createBlockMapNeighborQuery` 保留（它接收的是 `Map<string, {type}>`，与 blockData 不同）。检查是否有调用方使用它。

**Step 2: FaceCullingSystem.js**

```js
getBlockFromData(x, y, z, blockData) {
  const code = Chunk.encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
  const type = blockData.get(code);
  return type ? { type } : null;
}
```

注意：此处 `blockData` 参数从 Object 改为 Map。需要检查调用方传入的是什么。在 `FaceCullingSystem.js` 内部，`blockData` 是从 chunk 获取的。如果 `updateChunk` 等方法内部传的是 `chunk.blockData`，那现在就是 Map。

**Step 3: FaceCullingSystemDebug.js**

```js
// 遍历 solidBlocks 时，key 现在是数字编码
for (const key of solidBlocks) {
  const { x, y, z } = Chunk.decodeCoord(key);
  // ...
}
```

已在 constructor 顶部 import Chunk（上次修复已做）。

**Step 4: AOUtils.js**

`createOcclusionChecker`：
```js
const key = `${Math.floor(ox)},${Math.floor(oy)},${Math.floor(oz)}`;
const entry = chunk.blockData[key];
// 改为：
const code = Chunk.encodeCoord(Math.floor(ox), Math.floor(oy), Math.floor(oz));
const entry = chunk.blockData.get(code);
```

`createBlockDataOcclusionChecker`：
```js
export function createBlockDataOcclusionChecker(blockData, getBlockPropsFn, options = {}) {
  const { requireSolid = false } = options;
  return function isOccluding(x, y, z) {
    const code = Chunk.encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
    const entry = blockData.get(code);
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    // ...
  };
}
```

`computeIncrementalAO`：
```js
// blockData 参数改为 Map
// `const type = blockData[key];` 改为 `const type = blockData.get(code);`
// `for (const key of affected)` 中的 key 是字符串（"x,y,z"），需要改为存储 code
```

注意：`computeIncrementalAO` 中的 `affected` Set 存的是字符串 `"x,y,z"`。需要改为存数字编码：

```js
if (operation === 'PLACE' && isAOApplicable(blockType)) {
  affected.add(Chunk.encodeCoord(x, y, z));
}
// ...
const code = Chunk.encodeCoord(nx, ny, nz);
const entry = blockData.get(code);
if (entry && isAOApplicable(typeof entry === 'string' ? entry : entry.type)) {
  affected.add(code);
}
// ...
for (const code of affected) {
  const { x: bx, y: by, z: bz } = Chunk.decodeCoord(code);
  const entry = blockData.get(code);
  // ...
}
```

**Step 5: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/utils/FaceCullingCore.js src/core/FaceCullingSystem.js src/core/FaceCullingSystemDebug.js src/utils/AOUtils.js
git commit -m "refactor(utils): 面剔除与 AO 工具改用数字编码"
```

---

## Task 8: Worker 边界 + 实体服务改造

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Modify: `src/world/entities/RealisticTree.js`
- Modify: `src/services/PlaygroundService.js`
- Modify: `src/world/ChunkGenerator.js`

**Step 1: BlockScatterManager.js**

Worker 返回的 `visibleKeys` 是字符串数组，`visibleBlockKeys` 是字符串 Set。这些在传给 `acceptScatteredBlocks` 时保持不变（因为 acceptScatteredBlocks 内部会做编码转换）。但 BlockScatterManager 内部也构造了 `visibleBlockKeys` Set，它传给 chunk 后由 chunk 内部编码。所以 BlockScatterManager 本身可以保持字符串格式不变。

**Step 2: RealisticTree.js**

```js
// generate 方法中
const code = Chunk.encodeCoord(Math.floor(x), Math.floor(y + i), Math.floor(z));
chunk.solidBlocks.add(code);
chunk.blockData.set(code, 'realistic_trunk_collider');
```

**Step 3: PlaygroundService.js**

```js
detectExistingPlayground() {
  for (const [chunkKey, chunk] of this.world.chunks.entries()) {
    if (chunk.blockData) {
      for (const [code, blockData] of chunk.blockData) {
        const type = typeof blockData === 'string' ? blockData : blockData.type;
        if (type === 'playground_center_block' || type === 'playground_block') {
          const { x, y, z } = Chunk.decodeCoord(code);
          // ...
          this.playgroundBlocks.add(`${px},${y},${pz}`);  // 保持字符串，独立系统
        }
      }
    }
  }
}
```

**Step 4: ChunkGenerator.js**

```js
Chunk.prototype.add = function(x, y, z, type, dObj = null, solid = true, orientation = 0) {
  const code = Chunk.encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
  if (dObj) {
    if (!dObj[type]) dObj[type] = [];
    dObj[type].push({ x, y, z, orientation: orientation || 0 });
  }
  if (solid) {
    this.solidBlocks.add(code);
  }
};
```

**Step 5: 运行 lint**

Run: `npm run lint`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/world/BlockScatterManager.js src/world/entities/RealisticTree.js src/services/PlaygroundService.js src/world/ChunkGenerator.js
git commit -m "refactor(services): Worker 边界与实体服务改用数字编码"
```

---

## Task 9: 持久化兼容层 + 测试改造

**Files:**
- Modify: `src/world/ChunkPersistence.js`
- Modify: `src/tests/test-chunk.js`
- Modify: `src/tests/test-world.js`
- Modify: `src/tests/test-chunk-mesh-data-filter.js`

**Step 1: ChunkPersistence.js**

在 save 路径将 Map 序列化为 Object：

```js
// save 时
const blockDataObj = {};
for (const [code, entry] of this.blockData) {
  const { x, y, z } = Chunk.decodeCoord(code);
  blockDataObj[`${x},${y},${z}`] = entry;
}
// 将 blockDataObj 存入 IndexedDB
```

在 load 路径将 Object 反序列化为 Map：

```js
// load 时
this.blockData = new Map();
for (const [key, entry] of Object.entries(loadedBlockData)) {
  const [x, y, z] = key.split(',').map(Number);
  this.blockData.set(Chunk.encodeCoord(x, y, z), entry);
}
```

**Step 2: test-chunk.js**

所有 `chunk.blockData['5,10,5']` → `chunk.blockData.get(Chunk.encodeCoord(5, 10, 5))`
所有 `Object.keys(chunk.blockData)` → `[...chunk.blockData.keys()]`
所有 `key in chunk.blockData` → `chunk.blockData.has(Chunk.encodeCoord(...))`

**Step 3: test-world.js**

```js
assertUndefined(chunk.blockData.get(Chunk.encodeCoord(5, 10, 5)), 'gunman 占位不应写入 blockData');
```

**Step 4: test-chunk-mesh-data-filter.js**

`filterWorkerResultAgainstBlockData` 的 blockData 参数改为 Map：

```js
const blockData = new Map();
blockData.set(Chunk.encodeCoord(1, 2, 3), 'stone');
// ...
```

**Step 5: 运行测试**

Run: 浏览器访问 `http://localhost:8080/src/tests/index.html`，点击"运行所有测试"
Expected: 所有测试通过

**Step 6: Commit**

```bash
git add src/world/ChunkPersistence.js src/tests/test-chunk.js src/tests/test-world.js src/tests/test-chunk-mesh-data-filter.js
git commit -m "refactor(persistence+tests): 持久化兼容层与测试适配"
```

---

## Task 10: 集成验证（最关键）

**Files:**
- N/A（验证任务）

**Step 1: 运行完整 lint**

Run: `npm run lint`
Expected: 0 errors, 仅预先存在的 warnings

**Step 2: 运行所有单元测试**

Run: 浏览器访问 `http://localhost:8080/src/tests/index.html`，点击"运行所有测试"
Expected: 全部通过

**Step 3: 启动开发服务器并进入游戏验证**

Run: `npm run start`（如未启动）
浏览器访问 `http://localhost:8080/`

**验证清单：**
- [ ] 玩家出生点在地面上，不是飘在空中
- [ ] 玩家能正常行走、跳跃，有正常的重力下落
- [ ] 地面方块完整显示，没有大面积透明区域
- [ ] 玩家可以挖掘方块，挖掘后邻居方块补面正确
- [ ] 玩家可以放置方块，放置后方块正常显示
- [ ] 行走时碰撞检测正常，不会穿墙
- [ ] 远处地形正常加载，没有坐标偏移的"重复地形"
- [ ] 重启游戏后，之前放置/挖掘的方块仍然正确（持久化验证）

**Step 4: 如验证失败，回退检查**

如果玩家飘在空中或地面透明：
1. 检查 `isSolid` 中 `solidBlocks.has(blockCode)` 是否返回 true（断点或 console.log）
2. 检查 `acceptScatteredBlocks` 中 `this.blockData.set(code, ...)` 是否正确写入
3. 检查 `encodeCoord(-3)` 和 `decodeCoord` 是否对称
4. 检查 `visibleKeys` 和 `solidBlocks` 中是否混入了字符串 key

**Step 5: Commit**

```bash
git commit -m "refactor(chunk): blockData 字符串索引全面优化为数字编码"
```

---

## 附录：全局替换模式速查

| 旧模式 | 新模式 |
|--------|--------|
| `this.blockData = {}` | `this.blockData = new Map()` |
| `this.blockData[key]` | `this.blockData.get(code)` |
| `this.blockData[key] = entry` | `this.blockData.set(code, entry)` |
| `delete this.blockData[key]` | `this.blockData.delete(code)` |
| `key in this.blockData` | `this.blockData.has(code)` |
| `Object.entries(this.blockData)` | `[...this.blockData.entries()]` 或 `for (const [code, entry] of this.blockData)` |
| `Object.keys(this.blockData)` | `[...this.blockData.keys()]` |
| `for (const key in this.blockData)` | `for (const [code, entry] of this.blockData)` |
| ``const key = `${x},${y},${z}`;`` | `const code = Chunk.encodeCoord(x, y, z);` |
| `key.split(',').map(Number)` | `Chunk.decodeCoord(code)` |
| `this.solidBlocks.add(key)` | `this.solidBlocks.add(code)` |
| `this.visibleKeys.add(key)` | `this.visibleKeys.add(code)` |
| `this.solidBlocks.has(key)` | `this.solidBlocks.has(code)` |
| `this.visibleKeys.has(key)` | `this.visibleKeys.has(code)` |
| `this.solidBlocks.delete(key)` | `this.solidBlocks.delete(code)` |
| `this.visibleKeys.delete(key)` | `this.visibleKeys.delete(code)` |
| `typeMap.has(key)` | `typeMap.has(code)` |
| `typeMap.get(key)` | `typeMap.get(code)` |
| `typeMap.set(key, idx)` | `typeMap.set(code, idx)` |
| `typeMap.delete(key)` | `typeMap.delete(code)` |
| `this.crossChunkOwnerCache.get(blockKey)` | `this.crossChunkOwnerCache.get(blockCode)` |
| `this.crossChunkOwnerCache.set(blockKey, ...)` | `this.crossChunkOwnerCache.set(blockCode, ...)` |
| `this.dirtyAOPositions.add(key)` | `this.dirtyAOPositions.add(code)` |
| `this.pendingBatchFaceCullingUpdates.add(key)` | `this.pendingBatchFaceCullingUpdates.add(code)` |
