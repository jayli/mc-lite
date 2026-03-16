// src/core/FaceCullingSystemDebug.js
/**
 * FaceCullingSystem 调试和性能监控方法
 * 物理切分自 FaceCullingSystem.js，逻辑 100% 一致
 */

import * as THREE from 'three';
import { faceMask } from '../utils/FaceCullingUtils.js';

/**
 * 应用调试和性能监控方法到 FaceCullingSystem 类
 * @param {typeof FaceCullingSystem} FaceCullingSystem - FaceCullingSystem 类
 */
export function applyFaceCullingSystemDebug(FaceCullingSystem) {
  Object.assign(FaceCullingSystem.prototype, {
    /**
     * 添加调试方块
     * @param {string} id - 标识符
     * @param {THREE.Vector3} position - 位置
     * @param {number} faceMask - 面位掩码
     */
    addDebugBlock(id, position, faceMask) {
      if (!this.debugMode || !this.debugScene) return;

      const debugObj = this.createDebugVisualization(position, faceMask);
      this.debugObjects.set(id, debugObj);
      this.debugScene.add(debugObj);

      console.log('Debug block added:', { id, position, faceMask });
    },

    /**
     * 更新调试方块
     * @param {string} id - 标识符
     * @param {number} faceMask - 新面位掩码
     */
    updateDebugBlock(id, faceMask) {
      if (!this.debugMode || !this.debugScene) return;

      const debugObj = this.debugObjects.get(id);
      if (debugObj) {
        this.debugScene.remove(debugObj);
        const newObj = this.createDebugVisualization(debugObj.position, faceMask);
        this.debugObjects.set(id, newObj);
        this.debugScene.add(newObj);

        console.log('Debug block updated:', { id, faceMask });
      }
    },

    /**
     * 移除调试方块
     * @param {string} id - 标识符
     */
    removeDebugBlock(id) {
      if (!this.debugScene) return;

      const debugObj = this.debugObjects.get(id);
      if (debugObj) {
        this.debugScene.remove(debugObj);
        this.debugObjects.delete(id);
        console.log('Debug block removed:', id);
      }
    },

    /**
     * 清理调试对象
     */
    clearDebugObjects() {
      if (this.debugScene) {
        for (const obj of this.debugObjects.values()) {
          this.debugScene.remove(obj);
        }
      }
      this.debugObjects.clear();
      console.log('Debug objects cleared');
    },

    /**
     * 创建性能面板可视化
     * @returns {THREE.Object3D} 性能面板对象
     */
    createPerformancePanel() {
      const panel = new THREE.Group();
      panel.position.set(5, 5, -10); // 放在相机前方右侧

      // 创建面板背景
      const backgroundGeometry = new THREE.PlaneGeometry(4, 3);
      const backgroundMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.7
      });
      const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
      panel.add(background);

      // 这里可以添加文本和图表
      // 实际实现可以使用CSS2DRenderer或自定义着色器

      return panel;
    },

    /**
     * 开始性能监控
     */
    startPerformanceMonitoring() {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
      }

      this.monitoringInterval = setInterval(() => {
        this.recordPerformanceSnapshot();
      }, this.config.monitoringInterval);

      console.log('性能监控已启动，间隔:', this.config.monitoringInterval, 'ms');
    },

    /**
     * 停止性能监控
     */
    stopPerformanceMonitoring() {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      console.log('性能监控已停止');
    },

    /**
     * 记录性能快照
     */
    recordPerformanceSnapshot() {
      const stats = this.getStats();
      const snapshot = {
        timestamp: Date.now(),
        optimizationRate: stats.optimizationRate,
        updateTime: stats.updateTime,
        performanceScore: stats.performanceScore,
        totalBlocksProcessed: stats.totalBlocksProcessed,
        facesCulled: stats.facesCulled,
        facesRendered: stats.facesRendered,
        errorCount: stats.errorCount,
        memoryUsage: stats.memoryUsage
      };

      this.performanceHistory.push(snapshot);

      // 限制历史记录大小
      if (this.performanceHistory.length > this.maxHistorySize) {
        this.performanceHistory.shift();
      }

      // 触发性能事件
      this.emit('performanceSnapshot', snapshot);

      // 检查性能警告
      this.checkPerformanceWarnings(snapshot);
    },

    /**
     * 检查性能警告
     * @param {Object} snapshot - 性能快照
     */
    checkPerformanceWarnings(snapshot) {
      const warnings = [];

      if (snapshot.optimizationRate < 0.3) {
        warnings.push(`优化率过低: ${(snapshot.optimizationRate * 100).toFixed(1)}%`);
      }

      if (snapshot.updateTime > 16) {
        warnings.push(`更新时间过长: ${snapshot.updateTime.toFixed(2)}ms`);
      }

      if (snapshot.performanceScore < 60) {
        warnings.push(`性能评分低: ${snapshot.performanceScore.toFixed(1)}/100`);
      }

      if (warnings.length > 0) {
        const warningMessage = warnings.join('; ');
        // console.warn('性能警告:', warningMessage);
        this.emit('performanceWarning', { warnings, snapshot });
      }
    },

    /**
     * 异步审计整个世界的 Face Culling 情况 (分片执行，避免卡顿)
     * @param {Object} world - 世界对象
     * @returns {Promise<Object>} 审计结果
     */
    async auditWorld(world) {
      // console.log('开始异步审计世界 Face Culling 情况...');
      document.getElementById("perf").innerHTML = `开始审计地图 Face Culling 情况...`;
      const startTime = performance.now();

      let totalBlocks = 0;
      let totalFaces = 0;
      let hiddenFaces = 0;
      let visibleFaces = 0;

      const chunks = Array.from(world.chunks.values());
      const totalChunks = chunks.length;
      let processedChunks = 0;

      return new Promise((resolve) => {
        const processNextBatch = () => {
          const batchStartTime = performance.now();

          // 每次处理最多 5ms，避免掉帧
          while (processedChunks < totalChunks && performance.now() - batchStartTime < 5) {
            const chunk = chunks[processedChunks++];

            for (const key of chunk.solidBlocks) {
              totalBlocks++;
              totalFaces += 6;

              const [x, y, z] = key.split(',').map(Number);

              // 检查 6 个方向的邻居
              const directions = [
                [0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]
              ];

              for (const [dx, dy, dz] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                const nz = z + dz;

                if (world.isSolid(nx, ny, nz)) {
                  // 如果是固体，进一步检查是否为透明/碰撞体（非遮挡方块）
                  const neighborType = world.getBlock(nx, ny, nz);
                  if (neighborType && this.isTransparent(neighborType)) {
                    visibleFaces++;
                  } else {
                    hiddenFaces++;
                  }
                } else {
                  visibleFaces++;
                }
              }
            }
          }

          if (processedChunks < totalChunks) {
            // 继续下一批
            if (window.requestIdleCallback) {
                window.requestIdleCallback(processNextBatch);
            } else {
                setTimeout(processNextBatch, 0);
            }
          } else {
            // 完成
            const endTime = performance.now();
            const duration = endTime - startTime;

            const stats = {
              totalBlocks,
              totalFaces,
              hiddenFaces,
              visibleFaces,
              cullingRate: totalFaces > 0 ? (hiddenFaces / totalFaces) : 0,
              duration
            };

            var retMsg = `地图绘制审计完成（耗时: ${duration.toFixed(2)}ms）<br />`;
            retMsg += `- 总方块数: ${stats.totalBlocks}<br />`;
            retMsg += `- 总面数: ${stats.totalFaces}<br />`;
            retMsg += `- 隐藏面 (被剔除): ${stats.hiddenFaces}<br />`;
            retMsg += `- 可见面 (需渲染): ${stats.visibleFaces}<br />`;
            retMsg += `- 剔除率: ${(stats.cullingRate * 100).toFixed(2)}%`;
            document.getElementById("perf").innerHTML = retMsg;

            // console.log(`异步审计完成 (耗时: ${duration.toFixed(2)}ms):`);
            // console.log(`- 总方块数: ${stats.totalBlocks}`);
            // console.log(`- 总面数: ${stats.totalFaces}`);
            // console.log(`- 隐藏面 (被剔除): ${stats.hiddenFaces}`);
            // console.log(`- 可见面 (需渲染): ${stats.visibleFaces}`);
            // console.log(`- 剔除率: ${(stats.cullingRate * 100).toFixed(2)}%`);

            resolve(stats);
          }
        };

        // 启动处理
        processNextBatch();
      });
    },

    /**
     * 获取性能历史
     * @param {number} limit - 限制返回的记录数
     * @returns {Array} 性能历史记录
     */
    getPerformanceHistory(limit = 20) {
      const history = [...this.performanceHistory];
      if (limit && history.length > limit) {
        return history.slice(-limit);
      }
      return history;
    },

    /**
     * 获取性能趋势
     * @returns {Object} 性能趋势分析
     */
    getPerformanceTrend() {
      if (this.performanceHistory.length < 2) {
        return { trend: 'insufficient data', samples: this.performanceHistory.length };
      }

      const recent = this.performanceHistory.slice(-10);
      const first = recent[0];
      const last = recent[recent.length - 1];

      const optimizationRateChange = last.optimizationRate - first.optimizationRate;
      const updateTimeChange = last.updateTime - first.updateTime;
      const performanceScoreChange = last.performanceScore - first.performanceScore;

      let trend = 'stable';
      if (performanceScoreChange > 5) trend = 'improving';
      if (performanceScoreChange < -5) trend = 'degrading';

      return {
        trend,
        optimizationRate: {
          current: last.optimizationRate,
          change: optimizationRateChange,
          trend: optimizationRateChange > 0 ? 'improving' : optimizationRateChange < 0 ? 'degrading' : 'stable'
        },
        updateTime: {
          current: last.updateTime,
          change: updateTimeChange,
          trend: updateTimeChange < 0 ? 'improving' : updateTimeChange > 0 ? 'degrading' : 'stable'
        },
        performanceScore: {
          current: last.performanceScore,
          change: performanceScoreChange,
          trend: performanceScoreChange > 0 ? 'improving' : performanceScoreChange < 0 ? 'degrading' : 'stable'
        },
        samples: recent.length
      };
    },

    /**
     * 生成性能报告
     * @returns {Object} 性能报告
     */
    generatePerformanceReport() {
      const stats = this.getStats();
      const trend = this.getPerformanceTrend();
      const history = this.getPerformanceHistory(10);

      return {
        summary: {
          enabled: stats.enabled,
          optimizationRate: stats.optimizationRate,
          performanceScore: stats.performanceScore,
          status: stats.isDegraded ? 'degraded' : 'normal',
          trend: trend.trend
        },
        metrics: {
          blocksProcessed: stats.totalBlocksProcessed,
          facesCulled: stats.facesCulled,
          facesRendered: stats.facesRendered,
          updateTime: stats.updateTime,
          errorCount: stats.errorCount,
          memoryUsage: stats.memoryUsage
        },
        trendAnalysis: trend,
        recentHistory: history,
        recommendations: this.generateRecommendations(stats, trend)
      };
    },

    /**
     * 生成性能优化建议
     * @param {Object} stats - 当前统计
     * @param {Object} trend - 性能趋势
     * @returns {Array} 建议列表
     */
    generateRecommendations(stats, trend) {
      const recommendations = [];

      if (stats.optimizationRate < 0.3) {
        recommendations.push({
          priority: 'high',
          issue: '优化率过低',
          suggestion: '检查透明方块配置，确保固体方块被正确识别',
          action: '验证透明方块类型列表，调整算法参数'
        });
      }

      if (stats.updateTime > 16) {
        recommendations.push({
          priority: 'high',
          issue: '更新时间过长',
          suggestion: '算法执行时间超过一帧时间(16ms)',
          action: '考虑启用懒更新或减少批量更新大小'
        });
      }

      if (stats.errorCount > 5) {
        recommendations.push({
          priority: 'medium',
          issue: '错误计数较高',
          suggestion: '系统出现较多计算错误',
          action: '检查错误日志，考虑临时禁用优化'
        });
      }

      if (trend.trend === 'degrading') {
        recommendations.push({
          priority: 'medium',
          issue: '性能趋势下降',
          suggestion: '系统性能正在下降',
          action: '监控内存使用，清理缓存'
        });
      }

      if (recommendations.length === 0) {
        recommendations.push({
          priority: 'low',
          issue: '无',
          suggestion: '系统运行良好',
          action: '继续保持当前配置'
        });
      }

      return recommendations;
    },

    /**
     * 初始化调试场景
     * @param {THREE.Scene} scene - Three.js场景
     */
    initDebugScene(scene) {
      this.debugScene = scene;
      console.log('Debug scene initialized');
    },

    /**
     * 创建调试可视化对象
     * @param {THREE.Vector3} position - 位置
     * @param {number} faceMaskValue - 面位掩码
     * @returns {THREE.Object3D} 调试对象
     */
    createDebugVisualization(position, faceMaskValue) {
      const group = new THREE.Group();
      group.position.copy(position);

      // 创建面可视化
      const faceGeometry = new THREE.PlaneGeometry(0.9, 0.9);
      const visibleMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
      });
      const hiddenMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
      });

      // 六个面的位置和旋转
      const faceConfigs = [
        { mask: faceMask.TOP, position: [0, 0.5, 0], rotation: [0, 0, 0] },
        { mask: faceMask.BOTTOM, position: [0, -0.5, 0], rotation: [Math.PI, 0, 0] },
        { mask: faceMask.NORTH, position: [0, 0, -0.5], rotation: [0, Math.PI / 2, 0] },
        { mask: faceMask.SOUTH, position: [0, 0, 0.5], rotation: [0, -Math.PI / 2, 0] },
        { mask: faceMask.WEST, position: [-0.5, 0, 0], rotation: [0, 0, Math.PI / 2] },
        { mask: faceMask.EAST, position: [0.5, 0, 0], rotation: [0, 0, -Math.PI / 2] }
      ];

      for (const config of faceConfigs) {
        const isVisible = (faceMaskValue & config.mask) !== 0;
        const material = isVisible ? visibleMaterial : hiddenMaterial;

        const faceMesh = new THREE.Mesh(faceGeometry, material);
        faceMesh.position.set(...config.position);
        faceMesh.rotation.set(...config.rotation);

        // 添加标签
        const label = this.createFaceLabel(config.mask, isVisible);
        label.position.set(config.position[0], config.position[1] + 0.1, config.position[2]);
        faceMesh.add(label);

        group.add(faceMesh);
      }

      // 添加中心点
      const centerGeometry = new THREE.SphereGeometry(0.05, 8, 8);
      const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      const center = new THREE.Mesh(centerGeometry, centerMaterial);
      group.add(center);

      return group;
    },

    /**
     * 创建面标签
     * @param {number} face - 面位掩码
     * @param {boolean} isVisible - 是否可见
     * @returns {THREE.Object3D} 标签对象
     */
    createFaceLabel(face, isVisible) {
      // 创建文本精灵（简化版，实际可以使用TextGeometry或CSS2DRenderer）
      const geometry = new THREE.PlaneGeometry(0.2, 0.1);
      const material = new THREE.MeshBasicMaterial({
        color: isVisible ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.8
      });

      const label = new THREE.Mesh(geometry, material);

      // 添加文本（这里使用简单几何体，实际项目可以使用更高级的文本渲染）
      const faceName = this.getFaceName(face);
      label.userData = { face: faceName, visible: isVisible };

      return label;
    }
  });
}
