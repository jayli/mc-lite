import * as THREE from 'three';

/**
 * 静态模型实例化渲染器
 * 将一个静态模型拆分为多个 InstancedMesh，复用于同类实体渲染
 */
export class StaticModelInstancedRenderer {
  /**
   * @param {Object} options
   * @param {THREE.Object3D} options.sourceModel - 作为模板的静态模型
   * @param {Array<{id:string,x:number,y:number,z:number,rotationY?:number}>} options.records - 实例记录
   * @param {string} options.entityType - 实体类型
   * @param {Object} options.ownerChunk - 所属 Chunk
   */
  constructor({ sourceModel, records, entityType, ownerChunk }) {
    this.sourceModel = sourceModel;
    this.records = Array.isArray(records) ? records : [];
    this.entityType = entityType;
    this.ownerChunk = ownerChunk;
    this.meshes = [];
    this.instanceIndexById = new Map();
    this._dummy = new THREE.Object3D();

    this._build();
  }

  _build() {
    if (!this.sourceModel || this.records.length === 0) return;
    if (
      typeof this.sourceModel.updateMatrixWorld !== 'function' ||
      typeof this.sourceModel.traverse !== 'function'
    ) {
      return;
    }

    this.sourceModel.updateMatrixWorld(true);

    this.records.forEach((record, index) => {
      this.instanceIndexById.set(record.id, index);
    });

    this.sourceModel.traverse((child) => {
      if (!child.isMesh || !child.geometry || !child.material) return;

      const bakedGeometry = child.geometry.clone();
      bakedGeometry.applyMatrix4(child.matrixWorld);

      const mesh = new THREE.InstancedMesh(
        bakedGeometry,
        child.material,
        this.records.length
      );
      mesh.castShadow = child.castShadow;
      mesh.receiveShadow = child.receiveShadow;
      mesh.frustumCulled = false;
      mesh.userData = {
        type: this.entityType,
        isEntity: true,
        specialEntityRenderer: this
      };

      this.records.forEach((record, index) => {
        this._setMatrix(mesh, index, record);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.push(mesh);
    });
  }

  _setMatrix(mesh, index, record, hidden = false) {
    if (hidden) {
      this._dummy.position.set(0, 0, 0);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.set(0, 0, 0);
    } else {
      this._dummy.position.set(record.x + 0.5, record.y, record.z + 0.5);
      this._dummy.rotation.set(0, record.rotationY || 0, 0);
      this._dummy.scale.set(1, 1, 1);
    }
    this._dummy.updateMatrix();
    mesh.setMatrixAt(index, this._dummy.matrix);
  }

  attachToGroup(group) {
    if (!group) return;
    this.meshes.forEach(mesh => group.add(mesh));
  }

  detachFromGroup(group) {
    if (!group) return;
    this.meshes.forEach(mesh => group.remove(mesh));
  }

  getEntityAt(instanceId) {
    if (instanceId === undefined || instanceId === null) return null;
    return this.records[instanceId] || null;
  }

  destroyEntityAt(instanceId) {
    const record = this.getEntityAt(instanceId);
    if (!record || !this.ownerChunk) return false;
    return this.ownerChunk.destroySpecialEntity(this.entityType, record.id);
  }

  hideEntity(entityId) {
    const index = this.instanceIndexById.get(entityId);
    if (index === undefined) return false;

    const record = this.records[index];
    if (!record) return false;

    this.meshes.forEach((mesh) => {
      this._setMatrix(mesh, index, record, true);
      mesh.instanceMatrix.needsUpdate = true;
    });
    this.records[index] = null;
    return true;
  }

  dispose() {
    this.meshes.forEach((mesh) => {
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.meshes = [];
    this.instanceIndexById.clear();
  }
}
