# Implementation Plan: AO 阴影渲染逻辑重构

**Branch**: `001-refactor-ao-shadows` | **Date**: 2026-03-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-refactor-ao-shadows/spec.md`

## Summary

重构 AO（环境光遮蔽）阴影渲染逻辑，使其统一适用于所有实心且不透明的方块，无需单独配置。保持原有 AO 计算公式和采样逻辑不变，仅重构数据流和集成层，将 AO 计算尽量移至 Worker 中进行，避免阻塞主线程，同时解决与 Chunk、实体、动态方块的兼容性问题。

## Technical Context

**Language/Version**: ES6+ Modules (JavaScript)
**Primary Dependencies**: Three.js (r128+)
**Storage**: IndexedDB (通过 PersistenceWorker)
**Testing**: 浏览器内测试套件 (src/tests/index.html)
**Target Platform**: 现代 Web 浏览器 (支持 WebGL 2.0)
**Project Type**: 3D 体素游戏客户端 (Minecraft 克隆)
**Performance Goals**:
- 渲染距离内 1000+ 方块场景下，AO 计算导致的帧率下降不超过 15%
- AO 阴影更新延迟不超过 1 帧
- 主线程阻塞时间最小化（AO 计算移至 Worker）

**Constraints**:
- 必须保留原有 AO 计算公式和采样逻辑
- 必须利用现有 Worker 机制（FaceCullingWorker、WorldWorker）
- 必须符合项目宪法（内存管理、InstancedMesh 渲染优化）
- 仅对方块生效，不影响 mod 模型

**Scale/Scope**:
- 渲染距离：3 个区块
- 区块大小：16x16x256
- 单区块方块数：最多 65,536

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法原则 | 合规性 | 说明 |
|----------|--------|------|
| I. 面向对象与逻辑分层 | ✅ 合规 | AO 系统独立于 Chunk/Entity 层，仅依赖 BlockData |
| II. 内存效率与 GC | ✅ 合规 | AO 数据打包存储，避免每帧创建临时对象 |
| III. 主动资源释放 | ✅ 合规 | Chunk 销毁时同步释放 AO 相关资源 |
| IV. WebGL/Three.js 优化 | ✅ 合规 | 使用 InstancedMesh，AO 数据通过 vertex attributes 传递 |
| V. 简洁性与核心机制 | ✅ 合规 | 统一 AO 逻辑，消除特殊配置 |
| VI. 资源管理 | ✅ 合规 | AO 数据存于 src 目录，不依赖外部资源 |

## Project Structure

### Documentation (this feature)

```text
specs/001-refactor-ao-shadows/
├── plan.md              # 本文件
├── research.md          # Phase 0 输出：现有 AO 逻辑分析与技术方案
├── data-model.md        # Phase 1 输出：AO 数据结构与接口定义
├── quickstart.md        # Phase 1 输出：开发者快速上手指南
├── contracts/           # Phase 1 输出：Worker 消息协议
│   └── ao-worker-protocol.md
└── tasks.md             # Phase 2 输出（/speckit.tasks 生成）
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── MaterialManager.js       # 材质管理（AO shader 注入点）
│   ├── FaceCullingSystem.js     # 主线程 Face Culling 系统
│   └── AOSystem.js              # 【新增】统一 AO 计算与管理系统
├── world/
│   ├── Chunk.js                 # 区块管理（AO 数据集成点）
│   └── World.js                 # 世界管理（Chunk 容器）
├── workers/
│   ├── FaceCullingWorker.js     # 【修改】添加 AO 计算逻辑
│   └── WorldWorker.js           # 【修改】地形生成时 AO 计算
├── constants/
│   └── BlockData.js             # 方块属性（solid/transparent）
├── utils/
│   └── AOUtils.js               # 【新增】AO 计算辅助函数
└── tests/
    ├── test-ao.js               # 【新增】AO 单元测试
    └── test-chunk.js            # 【修改】AO 集成测试
```

**Structure Decision**: 采用单项目结构，新增 `AOSystem.js` 作为核心协调器，将 AO 计算逻辑移至 Worker，主线程仅负责结果应用。

## Complexity Tracking

| 复杂性项 | 为什么需要 | 拒绝的更简单方案 |
|----------|------------|------------------|
| Worker 异步计算 | AO 计算涉及大量邻域查询，同步执行会阻塞主线程导致卡顿 | 主线程分片执行：无法充分利用多核，延迟仍高 |
| 统一 AO 数据流 | 当前多源 AO 逻辑（Chunk 生成、动态放置）分散，难以维护 | 保持现状：Bug 频发，难以调试和扩展 |
| 保留原有算法 | 确保视觉效果一致性，避免重新调参 | 完全重写：风险高，视觉效果需重新验证 |

## Phase 0: Research & Analysis

### 0.1 现有 AO 实现分析

**目标**: 理解当前 AO 计算的核心公式、采样逻辑和数据流

**研究任务**:
1. 分析 `MaterialManager.js` 中的 shader 修改逻辑（`_applyShaderModifications`）
2. 分析 `Chunk.js` 中 AO 数据的生成和传递流程
3. 分析 `FaceCullingWorker.js` 中是否有 AO 计算逻辑
4. 识别当前 AO 与 Map 地形阴影不兼容的根因

**预期输出**: `research.md` 中的技术发现

### 0.2 Worker 计算边界定义

**目标**: 确定哪些 AO 计算应该移至 Worker

**研究问题**:
- 区块初始化时的批量 AO 计算（当前在 WorldWorker 中是否已存在？）
- 动态方块放置/破坏时的增量 AO 计算（当前在 FaceCullingSystem 中）
- Chunk 边界跨区 AO 计算（当前如何处理？）

**预期输出**: `research.md` 中的职责划分

### 0.3 性能基线测量

**目标**: 建立当前 AO 性能基线

**测量指标**:
- 区块生成时 AO 计算耗时（ms）
- 动态方块更新时 AO 计算耗时（ms）
- AO 计算占主线程时间比例

**预期输出**: `research.md` 中的性能数据

---

## Phase 1: Design & Contracts

### 1.1 数据模型设计 (`data-model.md`)

**AO 数据结构**:
```javascript
// 每个方块的 AO 数据存储（4 位编码 per vertex）
{
  x, y, z: number,       // 方块坐标
  type: string,          // 方块类型
  aoData: Uint8Array,    // AO 数据打包：每顶点 2 位 x 24 顶点 = 6 字节
  visibility: number     // Face visibility mask (6 bits)
}

// BlockData.js 新增属性
{
  solid: boolean,        // 实心（参与 AO 计算）
  transparent: boolean   // 透明（排除 AO 计算）
}
```

**实体关系**:
- `AOSystem` → 管理所有 AO 计算请求
- `Chunk` → 存储 AO 数据并提供给 `InstancedMesh`
- `FaceCullingWorker` → 执行批量 AO 计算
- `MaterialManager` → 注入 AO shader 逻辑

### 1.2 Worker 消息协议 (`contracts/ao-worker-protocol.md`)

**请求类型**:
```typescript
// 批量 AO 计算请求
{
  type: 'COMPUTE_AO_BATCH',
  id: number,
  data: {
    blocks: Array<{x, y, z, type}>,
    blockData: Record<string, string>,  // 完整方块数据
    cx, cz: number                       // 区块坐标
  }
}

// 增量 AO 更新请求
{
  type: 'COMPUTE_AO_INCREMENTAL',
  id: number,
  data: {
    position: {x, y, z},
    operation: 'PLACE' | 'DESTROY',
    blockType: string,
    neighborhoodRadius: number
  }
}
```

**响应类型**:
```typescript
{
  type: 'AO_RESULT',
  id: number,
  data: {
    aoData: Map<string, Uint8Array>,    // 方块坐标 → AO 数据
    affectedNeighbors: Array<{x, y, z}>, // 受影响的邻居
    duration: number                     // 计算耗时 (ms)
  }
}
```

### 1.3 快速上手指南 (`quickstart.md`)

**目标**: 帮助开发者理解新的 AO 架构

**内容大纲**:
1. AO 系统架构概览图
2. 核心概念：实心/透明、AO 采样、vertex attributes
3. 调试技巧：如何查看 AO 数据、性能分析
4. 常见问题解答

### 1.4 Agent Context 更新

运行 `.specify/scripts/bash/update-agent-context.sh claude` 添加新技术：
- AOSystem.js 核心职责
- Worker AO 计算协议
- AO 数据打包格式（2-bit per vertex）

---

## Phase 2: Task Breakdown

**任务分解将在 `/speckit.tasks` 命令中生成**，此处预留结构：

### 阶段 A: 研究与设计（Phase 0-1）
- 任务 A1: 现有 AO 代码审计
- 任务 A2: 性能基线测量
- 任务 A3: Worker 边界定义
- 任务 A4: 数据模型设计
- 任务 A5: Worker 协议定义

### 阶段 B: 核心实现（Phase 2）
- 任务 B1: 创建 AOSystem.js 框架
- 任务 B2: 实现 AOUtils.js 辅助函数
- 任务 B3: 扩展 FaceCullingWorker AO 计算
- 任务 B4: 修改 Chunk.js 集成新 AO 系统
- 任务 B5: 更新 MaterialManager.js 简化 AO 检测

### 阶段 C: 测试与验证（Phase 3）
- 任务 C1: 编写 AO 单元测试
- 任务 C2: 性能回归测试
- 任务 C3: 视觉一致性验证
- 任务 C4: Bug 修复与优化

### 阶段 D: 文档与清理（Phase 4）
- 任务 D1: 更新 quickstart.md
- 任务 D2: 清理旧 AO 配置（isAOEnabled）
- 任务 D3: 代码审查与重构

---

## Constitution Re-Check (Post-Design)

*在完成 Phase 1 设计后重新评估*

| 宪法原则 | 状态 | 验证项 |
|----------|------|--------|
| I. 逻辑分层 | ⏳ 待验证 | AOSystem 是否独立于 Chunk/Entity |
| II. 内存效率 | ⏳ 待验证 | AO 数据打包是否避免 GC 压力 |
| III. 资源释放 | ⏳ 待验证 | Chunk 销毁时 AO 数据是否清理 |
| IV. 渲染优化 | ⏳ 待验证 | InstancedMesh AO attribute 是否正确 |
| V. 简洁性 | ⏳ 待验证 | 是否消除 isAOEnabled 特殊配置 |
| VI. 资源管理 | ⏳ 待验证 | 是否仅使用 src 目录资源 |

---

## Risk Assessment

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| AO 算法修改导致视觉不一致 | 高 | 中 | 严格保留原有公式，仅重构数据流 |
| Worker 通信开销超过收益 | 中 | 低 | 批量处理 + 数据打包，减少消息数量 |
| Chunk 边界 AO 断裂 | 高 | 中 | 跨区块查询逻辑需仔细验证 |
| 动态方块 AO 更新延迟 | 中 | 中 | 增量计算 + 优先级队列 |

## Next Steps

1. 执行 `/speckit.tasks` 生成详细任务列表
2. 按任务顺序执行实现
3. 每个任务完成后更新本计划文件
