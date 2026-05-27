# Feature Specification: Three.js r160 → r184 升级

**Feature Branch**: `031-upgrade-threejs-r184`  
**Created**: 2026-05-27  
**Status**: Draft  
**Input**: 将项目的 Three.js 从 r160 (0.160.0) 升级到 r184 (0.184.0)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CDN 版本升级后游戏正常运行 (Priority: P1)

作为开发者，我希望将 Three.js CDN 引用从 0.160.0 升级到 0.184.0 后，游戏的所有核心功能（渲染、交互、物理）仍然正常工作，不出现运行时错误。

**Why this priority**: 这是升级的基础前提。如果游戏无法正常运行，其他一切都没有意义。

**Independent Test**: 启动开发服务器，进入游戏，执行基本操作（移动、放置方块、挖掘方块），观察控制台无报错，画面正常渲染。

**Acceptance Scenarios**:

1. **Given** CDN 版本号已改为 0.184.0，**When** 启动开发服务器并打开游戏页面，**Then** 游戏正常加载，控制台无 Three.js 相关报错
2. **Given** 游戏已加载，**When** 玩家移动、挖掘、放置方块，**Then** InstancedMesh 渲染正常，方块显示正确
3. **Given** 游戏已加载，**When** 触发区块加载/卸载，**Then** 区块正常生成和渲染，无内存泄漏警告

---

### User Story 2 - 已废弃 API 适配 (Priority: P1)

作为开发者，我需要将项目中使用的已废弃 Three.js API（`BufferAttribute.updateRange`）迁移到新版 API（`addUpdateRange`），确保 InstancedMesh 的增量更新机制正常工作。

**Why this priority**: `updateRange` API 在 r184 中已被移除，不适配会导致运行时报错，属于必须完成的阻塞项。

**Independent Test**: 进入游戏后放置/删除多个方块，触发 GlobalInstancedMeshManager 的增量更新逻辑，验证方块渲染正确无闪烁。

**Acceptance Scenarios**:

1. **Given** 使用新的 `addUpdateRange` API，**When** 放置单个方块触发 InstancedMesh 局部更新，**Then** 新方块正确渲染，无视觉闪烁
2. **Given** 使用新的 `addUpdateRange` API，**When** 批量操作方块触发合并机制，**Then** 合并后的 InstancedMesh 显示正确

---

### User Story 3 - 颜色输出一致性 (Priority: P2)

作为开发者，我需要确保升级后游戏画面的色彩表现与 r160 版本一致，不出现色偏或过亮/过暗。

**Why this priority**: r164+ 默认启用 SRGBColorSpace 输出，可能导致色彩偏差。虽不致命但影响视觉体验。

**Independent Test**: 对比升级前后的游戏画面截图，确认方块材质颜色、天空颜色、光照效果一致。

**Acceptance Scenarios**:

1. **Given** 升级到 r184，**When** 观察游戏场景中方块材质颜色，**Then** 颜色与 r160 版本视觉一致，无明显色偏
2. **Given** 升级到 r184，**When** 经历白天/夜晚光照切换，**Then** 日夜光照效果表现正常

---

### Edge Cases

- 自定义 ShaderMaterial（水面、雨滴、BatchedMaterial）在 r184 下的 GLSL 兼容性
- 大量 InstancedMesh 实例（>10000 个方块）时的增量更新性能
- Worker 传回数据后 InstancedBufferAttribute 更新时序

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: index.html 中 Import Maps 的 Three.js CDN 地址 MUST 从 `three@0.160.0` 更新为 `three@0.184.0`（含 build 和 examples/jsm 路径）
- **FR-002**: `GlobalInstancedMeshManager.js` 中的 `buffer.updateRange = {offset, count}` 模式 MUST 替换为 `buffer.addUpdateRange(start, count)` + `buffer.clearUpdateRanges()`
- **FR-003**: 升级后所有现有测试 MUST 通过（`node command/run-tests.js`）
- **FR-004**: 升级后 `npm run lint` MUST 无新增错误
- **FR-005**: 如果颜色输出有偏差，MUST 通过显式设置 `renderer.outputColorSpace` 修复

### Key Entities

- **Import Map**: index.html 中的 Three.js CDN 路径配置，控制运行时加载的 Three.js 版本
- **GlobalInstancedMeshManager**: 管理所有 InstancedMesh 实例的增量更新、扩容和回收

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 游戏启动后控制台无 Three.js 相关报错或 deprecation 警告
- **SC-002**: 所有自动化测试通过（`node command/run-tests.js` 返回成功）
- **SC-003**: 方块放置/删除操作响应流畅，无视觉闪烁或渲染异常
- **SC-004**: 游戏画面色彩与升级前保持视觉一致

## Assumptions

- 项目中仅有 `GlobalInstancedMeshManager.js` 使用了已废弃的 `updateRange` API
- `ShaderMaterial` 中的 GLSL 代码在 r184 的 WebGLRenderer 路径下仍完全兼容
- `onBeforeCompile` 钩子在 r184 的 WebGLRenderer 路径下仍正常工作
- CDN (jsdelivr) 上 three@0.184.0 的目录结构与 0.160.0 一致（build/、examples/jsm/）
