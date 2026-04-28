// src/world/SpecialEntitiesShadowStore.js
/**
 * SpecialEntitiesShadowStore — 特殊实体的统一内存存储（影子存储）。
 *
 * 按 chunk 组织，提供 O(1) 的增删查接口。
 * chunk 卸载时不清理数据，常驻内存。
 */

export class SpecialEntitiesShadowStore {
  constructor() {
    // "cx,cz" -> { turrets: Map<id, data>, zombieNests: Map<id, data>, minecarts: Map<id, data> }
    this._chunks = new Map();
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _ensureChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    if (!this._chunks.has(key)) {
      this._chunks.set(key, {
        turrets: new Map(),
        zombieNests: new Map(),
        minecarts: new Map()
      });
    }
    return this._chunks.get(key);
  }

  // ---------- 增删查（同步，O(1)）----------

  addEntity(type, cx, cz, id, data) {
    const chunk = this._ensureChunk(cx, cz);
    const mapName = type === 'turret' ? 'turrets' : type === 'zombieNest' ? 'zombieNests' : 'minecarts';
    chunk[mapName].set(id, { ...data, id });
  }

  removeEntity(type, cx, cz, id) {
    const key = this._chunkKey(cx, cz);
    const chunk = this._chunks.get(key);
    if (!chunk) return;
    const mapName = type === 'turret' ? 'turrets' : type === 'zombieNest' ? 'zombieNests' : 'minecarts';
    chunk[mapName].delete(id);
  }

  getEntity(type, cx, cz, id) {
    const key = this._chunkKey(cx, cz);
    const chunk = this._chunks.get(key);
    if (!chunk) return undefined;
    const mapName = type === 'turret' ? 'turrets' : type === 'zombieNest' ? 'zombieNests' : 'minecarts';
    return chunk[mapName].get(id);
  }

  getAllEntities(type, cx, cz) {
    const key = this._chunkKey(cx, cz);
    const chunk = this._chunks.get(key);
    if (!chunk) return [];
    const mapName = type === 'turret' ? 'turrets' : type === 'zombieNest' ? 'zombieNests' : 'minecarts';
    return Array.from(chunk[mapName].values());
  }

  getAllEntitiesInChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    const chunk = this._chunks.get(key);
    if (!chunk) return { turrets: [], zombieNests: [], minecarts: [] };
    return {
      turrets: Array.from(chunk.turrets.values()),
      zombieNests: Array.from(chunk.zombieNests.values()),
      minecarts: Array.from(chunk.minecarts.values())
    };
  }

  // ---------- 批量操作----------

  serializeChunk(cx, cz) {
    const entities = this.getAllEntitiesInChunk(cx, cz);
    return {
      turrets: entities.turrets,
      zombieNests: entities.zombieNests,
      minecarts: entities.minecarts
    };
  }

  deserializeAndMerge(cx, cz, data) {
    const chunk = this._ensureChunk(cx, cz);
    if (data?.turrets?.length) {
      for (const turret of data.turrets) {
        chunk.turrets.set(turret.id, turret);
      }
    }
    if (data?.zombieNests?.length) {
      for (const nest of data.zombieNests) {
        chunk.zombieNests.set(nest.id, nest);
      }
    }
    if (data?.minecarts?.length) {
      for (const minecart of data.minecarts) {
        chunk.minecarts.set(minecart.id, minecart);
      }
    }
  }

  // ---------- 全量操作----------

  getAllChunkKeys() {
    return Array.from(this._chunks.keys());
  }

  getAllData() {
    const result = new Map();
    for (const [key] of this._chunks) {
      const [cx, cz] = key.split(',').map(Number);
      result.set(key, this.serializeChunk(cx, cz));
    }
    return result;
  }

  destroyAll() {
    this._chunks.clear();
  }
}

export const specialEntitiesShadowStore = new SpecialEntitiesShadowStore();
