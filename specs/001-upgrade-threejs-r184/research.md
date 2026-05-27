# Research: Three.js r160 → r184 升级

## 1. BufferAttribute.updateRange API 迁移

**Decision**: 使用 `addUpdateRange(start, count)` + `clearUpdateRanges()` 替代旧的 `updateRange = {offset, count}`

**Rationale**:
- r184 中 `BufferAttribute` 不再有单一的 `updateRange` 属性
- 新 API 使用数组 `updateRanges`，支持多段更新（更灵活）
- `addUpdateRange(start, count)` 中 `start` 对应旧 API 的 `offset`

**Alternatives considered**:
- 直接设置 `needsUpdate = true`（全量上传）：性能退化，不可接受
- 降级到兼容版本（如 r170）：无意义，r184 改动量一样

**Migration pattern**:
```javascript
// 旧 API (r160)
buffer.updateRange.offset = offset;
buffer.updateRange.count = count;
buffer.needsUpdate = true;

// 新 API (r184)
buffer.clearUpdateRanges();
buffer.addUpdateRange(offset, count);
buffer.needsUpdate = true;
```

## 2. 颜色空间管理

**Decision**: 预计无需改动，r160 已使用 `SRGBColorSpace`，r184 默认行为一致

**Rationale**:
- 项目已使用 `THREE.SRGBColorSpace`（5 处引用）
- `renderer.outputColorSpace` 在 r164+ 默认为 `SRGBColorSpace`，与项目现有行为一致
- 项目未使用已废弃的 `outputEncoding` / `sRGBEncoding` / `LinearEncoding`

**Alternatives considered**:
- 显式设置 `renderer.outputColorSpace = THREE.SRGBColorSpace`：可作为防御性措施，但非必须

## 3. InstancedMesh 兼容性

**Decision**: 无需改动，r184 保持 API 兼容

**Rationale**:
- `setMatrixAt` / `instanceMatrix` / `InstancedBufferAttribute` 均未变更
- `mesh.count` 仍为直接属性（非 getter/setter）
- 自定义 attribute 通过 `geometry.setAttribute` 添加的模式不变

## 4. ShaderMaterial / onBeforeCompile 兼容性

**Decision**: 无需改动

**Rationale**:
- `ShaderMaterial` 仍支持 GLSL vertex/fragment shader 字符串
- `onBeforeCompile` 在 WebGLRenderer 路径下仍被调用（r184 源码确认）
- GLSL 内置函数（`texture2D`、`gl_Position`、`gl_FragColor`）在 WebGL 路径下不变

## 5. CDN 路径结构

**Decision**: 直接替换版本号即可

**Rationale**:
- `three@0.184.0/build/three.module.js` — 已验证 HTTP 200
- `three@0.184.0/examples/jsm/loaders/GLTFLoader.js` — 已验证 HTTP 200
- `three@0.184.0/examples/jsm/utils/BufferGeometryUtils.js` — 已验证 HTTP 200
- `three@0.184.0/examples/jsm/libs/stats.module.js` — 已验证 HTTP 200

## 6. 其他确认安全的 API

| API | r184 状态 |
|-----|-----------|
| `WebGLRenderer` | 存在 |
| `PCFSoftShadowMap` | 存在 |
| `ACESFilmicToneMapping` | 存在 |
| `MeshLambertMaterial` | 存在 |
| `MeshStandardMaterial` | 存在 |
| `BoxGeometry` / `PlaneGeometry` | 存在 |
| `DynamicDrawUsage` | 存在 |
| `LineSegments` | 存在 |
| `DirectionalLight` | 存在 |
| `AudioListener` | 存在 |
| `Raycaster` | 存在 |
