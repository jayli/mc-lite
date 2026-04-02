# Research: 下雨功能开关

**Feature**: 030-rain-toggle
**Date**: 2026-04-02

## 研究任务

### 1. Three.js 雨滴粒子系统实现方式

**Decision**: 使用 `THREE.Points` + `BufferGeometry` + `THREE.PointsMaterial`

**Rationale**:
- Points 比 Sprite 更高效，适合渲染大量相似粒子
- BufferGeometry 避免每帧更新 geometry，性能更好
- PointsMaterial 支持透明度和大小衰减，适合雨滴视觉效果
- 现有 ParticleSystem.js 使用 Sprite 序列帧特效，不适合持续性下雨效果

**Alternatives Considered**:
- InstancedMesh: 过于复杂，适合复杂几何体而非简单粒子
- Sprite 数组: 性能较差，每帧需更新多个 Sprite
- ShaderMaterial: 过度工程，PointsMaterial 已满足需求

### 2. 雨滴位置更新策略

**Decision**: 每帧更新 BufferGeometry 的 position 属性，使用 `geometry.attributes.position.needsUpdate = true`

**Rationale**:
- BufferGeometry 支持动态更新，只需标记 needsUpdate
- 雨滴数量较少（50-100颗），每帧更新开销可接受
- 避免创建/销毁对象，符合内存效率原则

**Alternatives Considered**:
- 预计算动画路径: 不适合玩家移动场景，雨滴需跟随玩家
- 使用 Object3D 数组: 性能较差，Draw Call 过多

### 3. 雨滴跟随玩家移动

**Decision**: 雨滴在以玩家为中心的50米半径圆柱体内随机生成

**Rationale**:
- 规格要求雨滴出现在玩家周围50米半径
- 圆柱体（而非球体）更适合地面场景
- 玩家移动时，雨滴区域随之移动，超出范围的雨滴重置到新位置

**Alternatives Considered**:
- 固定世界坐标: 玩家离开区域后雨滴消失，体验差
- 全屏空间雨滴: 不符合规格的50米半径要求

### 4. 雨滴视觉效果

**Decision**: 使用简单的直线或短矩形表示雨滴，半透明白色/蓝色

**Rationale**:
- 体素游戏风格简洁，不需要复杂雨滴形状
- PointsMaterial 的 `size` 属性控制雨滴大小
- 透明度 0.4-0.6 模拟雨滴半透明感

**Alternatives Considered**:
- 雨滴纹理: 需要额外资源，增加加载开销
- 雨滴动画（弯曲轨迹）: 过度复杂，不符合简洁原则

### 5. 按钮防抖实现

**Decision**: 使用时间戳差值判断，100-200ms 内重复点击无效

**Rationale**:
- 简单高效，无需额外库
- 与现有 UIManager.js 的按钮处理方式一致
- 符合规格要求的100-200ms防抖

**Alternatives Considered**:
- Lodash debounce: 引入外部依赖，过度工程
- Promise 延迟: 不适合简单开关逻辑

### 6. 按钮样式继承

**Decision**: 继承现有 `btn-small btn-status-toggle` 样式类

**Rationale**:
- 与 TNT 破坏方块按钮风格一致
- 无需新增 CSS，减少维护成本
- 符合规格 FR-008 要求

**Alternatives Considered**:
- 新建专属样式类: 过度工程，不符合简洁原则

## 技术决策总结

| 问题 | 决策 | 关键实现 |
|------|------|----------|
| 粒子渲染 | THREE.Points + BufferGeometry | 高效粒子渲染 |
| 位置更新 | 每帧更新 position 属性 | needsUpdate = true |
| 跟随玩家 | 圆柱体内随机生成 | 玩家为中心，半径50米 |
| 雨滴外观 | PointsMaterial，半透明 | size=0.1, opacity=0.5 |
| 按钮防抖 | 时间戳差值 | lastClickTime + delta |
| 按钮样式 | 继承现有类 | btn-small btn-status-toggle |