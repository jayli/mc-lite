// src/tests/test-mocks.js
/**
 * 测试模拟对象
 * 提供 FaceCullingSystem、Materials 和 BlockData 的模拟实现
 */

const transparentTypes = ['glass_block', 'leaves', 'water', 'air'];
const solidTypes = ['stone', 'dirt', 'wood', 'collider'];

export const mockFaceCullingSystem = {
  isEnabled: () => false,
  isTransparent: (type) => transparentTypes.includes(type),
  calculateFaceVisibility: () => 63,
  updateBlock: () => {},
  updateNeighbors: () => {}
};

export const mockMaterials = {
  aoEnabled: true,
  getMaterial: () => {
    const material = {
      clone: () => ({ ...material }),
      dispose: () => {}
    };
    return material;
  },
  toggleAO() {
    this.aoEnabled = !this.aoEnabled;
  },
  setAOEnabled(enabled) {
    this.aoEnabled = enabled;
  },
  isAOEnabled() {
    return this.aoEnabled;
  },
  dispose: () => {}
};

export const mockBlockData = {
  getBlockProperties: (type) => ({
    isSolid: solidTypes.includes(type),
    isTransparent: transparentTypes.includes(type),
    isRendered: type !== 'air' && type !== 'collider',
    isAOEnabled: true,
    geometryType: 'default'
  })
};
