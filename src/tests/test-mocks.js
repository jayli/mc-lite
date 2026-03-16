const transparentTypes = ['glass_block', 'leaves', 'water', 'air'];
const solidTypes = ['stone', 'dirt', 'wood', 'collider', 'realistic_trunk_collider'];

export const mockFaceCullingSystem = {
  isEnabled: () => false,
  isTransparent: (type) => transparentTypes.includes(type),
  calculateFaceVisibility: () => 63,
  updateBlock: () => {},
  updateNeighbors: () => {}
};

export const mockMaterials = {
  getMaterial: () => {
    const material = {
      clone: () => ({ ...material }),
      dispose: () => {}
    };
    return material;
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
