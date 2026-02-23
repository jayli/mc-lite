# API Contracts: 模型创造台

**Feature**: 模型创造台 (Model Creator)
**Date**: 2026-02-23

---

## Internal APIs

### 1. PlaygroundService

创造台核心服务，管理创造台的创建和方块收集。

```javascript
/**
 * PlaygroundService - 创造台服务类
 * 负责创建、管理创造台平台和导出模型数据
 */
export class PlaygroundService {
  /**
   * 获取服务实例（单例）
   * @returns {PlaygroundService}
   */
  static getInstance();

  /**
   * 初始化服务
   * @param {World} world - 游戏世界实例
   */
  initialize(world);

  /**
   * 在玩家附近创建创造台
   * @param {THREE.Vector3} playerPos - 玩家位置
   * @returns {{ success: boolean, error?: string }}
   */
  createPlayground(playerPos);

  /**
   * 检查创造台是否已激活
   * @returns {boolean}
   */
  isPlaygroundActive();

  /**
   * 获取创造台上所有非 playground_block 的方块
   * @returns {ModelBlock[]} 模型方块数组
   */
  getModelBlocks();

  /**
   * 导出模型为 JSON 文件
   * @returns {{ success: boolean, error?: string }}
   */
  exportModel();
}
```

---

### 2. World 扩展方法

在现有 `World` 类上添加模型导出相关方法。

```javascript
/**
 * 从世界数据构建模型方块数组
 * @param {Map<string, any>} blockData - 方块数据 Map
 * @param {THREE.Vector3} origin - 创造台中心坐标
 * @returns {ModelBlock[]} 模型方块数组
 */
function buildModelData(blockData, origin);

/**
 * 导出模型为 JSON 文件并触发下载
 * @param {ModelBlock[]} blocks - 模型方块数组
 */
function downloadModelJSON(blocks);
```

---

### 3. UIManager 扩展

在现有 `UIManager` 类上添加创造台按钮处理。

```javascript
/**
 * 初始化创造台相关 UI 按钮
 * 在 initSettings() 方法中添加:
 * - btn-create-playground: 打开创造台按钮
 * - btn-export-model: 导出模型按钮
 */
```

---

## Data Contracts

### ModelBlock 接口

```typescript
interface ModelBlock {
  x: number;        // 相对 X 坐标 (-20 到 19)
  y: number;        // 相对 Y 坐标 (>= 0)
  z: number;        // 相对 Z 坐标 (-20 到 19)
  type: string;     // 方块类型
  direction: number;// 方向 (0-5)，默认 0
}
```

### ModelJSON 文件结构

```typescript
interface ModelJSON {
  blocks: ModelBlock[];  // 方块数组
  metadata?: {           // 可选元数据
    created?: string;    // ISO 8601 时间戳
    dimensions?: {       // 模型尺寸
      width: number;
      height: number;
      depth: number;
    };
  };
}
```

---

## Error Handling

### PlaygroundService 错误码

| 错误 | 说明 | 处理 |
|------|------|------|
| PLAYGROUND_EXISTS | 创造台已存在 | 提示"创造台已存在" |
| NO_SPACE | 没有足够空间 | 提示玩家移动位置 |
| INVALID_POSITION | 无效位置（空中/水中）| 自动寻找地面位置 |

### 导出错误

| 错误 | 说明 | 处理 |
|------|------|------|
| EMPTY_MODEL | 模型为空 | 导出空数组或提示 |
| DOWNLOAD_FAILED | 下载失败 | 显示错误消息 |
