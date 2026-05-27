# Quickstart: Three.js r160 → r184 升级

## 改动清单

### 1. index.html — CDN 版本号

将 Import Maps 中的三处 `0.160.0` 改为 `0.184.0`：

```
"three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js"
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"
"stats": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/stats.module.js"
```

### 2. GlobalInstancedMeshManager.js — updateRange 迁移

替换 `updateRange.offset` / `updateRange.count` 为 `addUpdateRange`：

```javascript
// 替换前
this.mesh.instanceMatrix.updateRange.offset = offset;
this.mesh.instanceMatrix.updateRange.count = count;

// 替换后
this.mesh.instanceMatrix.clearUpdateRanges();
this.mesh.instanceMatrix.addUpdateRange(offset, count);
```

### 3. Engine.js — 颜色空间（视情况）

如果画面出现色偏，在 renderer 初始化后添加：

```javascript
this.renderer.outputColorSpace = THREE.SRGBColorSpace;
```

## 验证步骤

1. `npm run start` 启动开发服务器
2. 打开浏览器访问游戏
3. 检查控制台无报错
4. 放置/删除方块验证渲染正常
5. `node command/run-tests.js` 确认测试通过
6. `npm run lint` 确认无新增错误
