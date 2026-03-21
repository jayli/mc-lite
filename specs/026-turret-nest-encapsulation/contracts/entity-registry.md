# Interface Contracts: 实体注册表

**Feature**: 026-turret-nest-encapsulation
**Date**: 2026-03-21

## EntityRegistry Interface

### Constructor

```javascript
new EntityRegistry()
```

### Methods

#### register

```javascript
/**
 * Register a placement handler for a block type
 * @param {string} blockType - The block type identifier (e.g., 'turret_alias_block')
 * @param {EntityPlacementHandler} handler - The placement handler instance
 * @returns {void}
 */
register(blockType, handler)
```

**Preconditions**:
- `blockType` must be a non-empty string
- `handler` must be an instance of EntityPlacementHandler

**Postconditions**:
- `isSpecialBlock(blockType)` returns `true`
- `getHandler(blockType)` returns `handler`

#### getHandler

```javascript
/**
 * Get the placement handler for a block type
 * @param {string} blockType - The block type identifier
 * @returns {EntityPlacementHandler | undefined}
 */
getHandler(blockType)
```

**Returns**: The registered handler, or `undefined` if not registered.

#### isSpecialBlock

```javascript
/**
 * Check if a block type has a registered placement handler
 * @param {string} blockType - The block type identifier
 * @returns {boolean}
 */
isSpecialBlock(blockType)
```

**Returns**: `true` if a handler is registered for the block type.

#### unregister

```javascript
/**
 * Unregister a placement handler
 * @param {string} blockType - The block type identifier
 * @returns {boolean} - True if a handler was removed
 */
unregister(blockType)
```

---

## EntityPlacementHandler Interface

### Constructor

```javascript
/**
 * @param {Player} player - The player instance
 * @param {World} world - The world instance
 * @param {Manager} manager - The entity manager (e.g., TurretManager)
 */
new EntityPlacementHandler(player, world, manager)
```

### Methods

#### canPlace

```javascript
/**
 * Check if the entity can be placed at the given position
 * @param {number} x - Block X coordinate
 * @param {number} y - Block Y coordinate
 * @param {number} z - Block Z coordinate
 * @returns {boolean}
 */
canPlace(x, y, z)
```

**Must check**:
- Manager availability
- Entity count limits
- Space availability
- Player collision

#### place

```javascript
/**
 * Place the entity at the given position
 * @param {number} x - Block X coordinate
 * @param {number} y - Block Y coordinate
 * @param {number} z - Block Z coordinate
 * @returns {boolean} - True if placement succeeded
 */
place(x, y, z)
```

**Must**:
- Place all required blocks
- Create entity instance via manager
- Remove item from player inventory
- Play placement sound
- Return success status

**On failure**:
- Rollback any placed blocks
- Return `false`

---

## PlayerInteraction Contract

### Modified Method

#### tryPlaceBlock

```javascript
/**
 * Attempt to place a block or special entity
 * @param {number} x - Block X coordinate
 * @param {number} y - Block Y coordinate
 * @param {number} z - Block Z coordinate
 * @param {string} type - Block type
 * @returns {boolean} - True if placement succeeded
 */
tryPlaceBlock(x, y, z, type)
```

**Behavior**:
1. Query `game.entityRegistry.isSpecialBlock(type)`
2. If special block:
   - Get handler via `game.entityRegistry.getHandler(type)`
   - Check `handler.canPlace(x, y, z)`
   - If can place, call `handler.place(x, y, z)`
   - Return result
3. If regular block:
   - Execute standard block placement logic

---

## Game Contract

### New Field

```javascript
/**
 * Entity registry for complex entities
 * @type {EntityRegistry}
 */
entityRegistry
```

### Initialization

```javascript
/**
 * Initialize entity registry and register all placement handlers
 * Called during game initialization
 */
initEntityRegistry()
```

**Must**:
- Create `EntityRegistry` instance
- Register all known entity types
- Store registry as `this.entityRegistry`
