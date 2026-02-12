import * as THREE from 'three';

export class ZombieInstancedRenderer {
  constructor(scene, maxCount = 100) {
    this.scene = scene;
    this.maxCount = maxCount;
    this.instanceMap = []; // map instanceId to zombie object

    // Create shared geometry and materials
    this.initResources();

    // Create InstancedMeshes
    this.initInstancedMeshes();

    // Add to scene
    this.addToScene();

    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  initResources() {
    // 1. Head Texture & Material
    const headTexture = this.createMosaicTexture('head');
    this.headMaterial = new THREE.MeshLambertMaterial({
      map: headTexture,
      color: 0xffffff,
    });
    this.headGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);

    // 2. Body Material
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // Use white to allow vertex colors to control color
    });
    this.bodyGeometry = new THREE.BoxGeometry(0.55, 0.63, 0.45);

    // 3. Arm Material
    this.armMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // Use white to allow vertex colors to control color
    });
    this.armGeometry = new THREE.BoxGeometry(0.23, 0.8, 0.23);

    // 4. Leg Material
    this.legMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // Use white to allow vertex colors to control color
    });
    this.legGeometry = new THREE.BoxGeometry(0.26, 1, 0.26);

    // Color definitions
    this.colors = {
      head: new THREE.Color(0xffffff),
      body: new THREE.Color(0x037c7c),
      arm: new THREE.Color(0x699058),
      leg: new THREE.Color(0x322b71),
      flash: new THREE.Color(0xff0000)
    };
  }

  initInstancedMeshes() {
    // Helper to create InstancedMesh
    const createMesh = (geo, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData = { isZombiePart: true, renderer: this };
      mesh.frustumCulled = false; // Disable frustum culling to prevent zombies from disappearing

      // Initialize bounding sphere to infinity to prevent Raycaster culling
      // We set both geometry and mesh bounding spheres to infinity to be safe across Three.js versions
      if (!mesh.geometry.boundingSphere) {
        mesh.geometry.computeBoundingSphere();
      }
      mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

      // Initialize instanceColor to ensure it exists and has correct size
      // We use maxCount, not current count, to allocate buffer
      if (mesh.setColorAt) {
        // Initialize with white color
        const color = new THREE.Color(0xffffff);
        for (let i = 0; i < this.maxCount; i++) {
          mesh.setColorAt(i, color);
        }
      }

      return mesh;
    };

    this.meshes = {
      head: createMesh(this.headGeometry, this.headMaterial),
      body: createMesh(this.bodyGeometry, this.bodyMaterial),
      leftArm: createMesh(this.armGeometry, this.armMaterial),
      rightArm: createMesh(this.armGeometry, this.armMaterial),
      leftLeg: createMesh(this.legGeometry, this.legMaterial),
      rightLeg: createMesh(this.legGeometry, this.legMaterial)
    };
  }

  addToScene() {
    Object.values(this.meshes).forEach(mesh => {
      this.scene.add(mesh);
    });
  }

  update(zombies) {
    let count = 0;
    this.instanceMap = [];

    // Reset counts
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = 0;
    });

    // Iterate through all zombies (Map values or Array)
    const zombieList = Array.isArray(zombies) ? zombies : Array.from(zombies.values());

    // Limit to maxCount
    const renderCount = Math.min(zombieList.length, this.maxCount);

    for (let i = 0; i < renderCount; i++) {
      const zombie = zombieList[i];
      this.instanceMap[i] = zombie;

      // Base transform (Zombie Position & Rotation)
      const px = zombie.position.x;
      const py = zombie.position.y;
      const pz = zombie.position.z;
      const ry = zombie.rotation.y; // Y-axis rotation

      // Determine color (flash red if damaged)
      // Check for zombie.isFlashing or implement flash logic here
      const isFlashing = zombie.isFlashing;

      // --- Head ---
      // Local: (0, 1.8, 0)
      this.updatePart(this.meshes.head, i, px, py, pz, ry, 0, 1.8, 0, 0, 0, 0, isFlashing, 'head');

      // --- Body ---
      // Local: (0, 1.15, 0)
      this.updatePart(this.meshes.body, i, px, py, pz, ry, 0, 1.15, 0, 0, 0, 0, isFlashing, 'body');

      // --- Left Arm ---
      // Local: (-0.43, 1.3, 0.3), rot x = -PI/2.4
      this.updatePart(this.meshes.leftArm, i, px, py, pz, ry, -0.43, 1.3, 0.3, -Math.PI / 2.4, 0, 0, isFlashing, 'arm');

      // --- Right Arm ---
      // Local: (0.43, 1.3, 0.3), rot x = -PI/2.7
      this.updatePart(this.meshes.rightArm, i, px, py, pz, ry, 0.43, 1.3, 0.3, -Math.PI / 2.7, 0, 0, isFlashing, 'arm');

      // --- Left Leg ---
      // Local: (-0.14, 0.4, 0)
      this.updatePart(this.meshes.leftLeg, i, px, py, pz, ry, -0.14, 0.4, 0, 0, 0, 0, isFlashing, 'leg');

      // --- Right Leg ---
      // Local: (0.14, 0.4, 0)
      this.updatePart(this.meshes.rightLeg, i, px, py, pz, ry, 0.14, 0.4, 0, 0, 0, 0, isFlashing, 'leg');

      count++;
    }

    // Update counts and notify Three.js to update buffers
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  updatePart(mesh, index, px, py, pz, ry, offX, offY, offZ, rotX, rotY, rotZ, isFlashing, type) {
    this.dummy.position.set(offX, offY, offZ);
    this.dummy.rotation.set(rotX, rotY, rotZ);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix(); // Local matrix

    // Optimization: Reuse a parent dummy object
    if (!this.parentDummy) this.parentDummy = new THREE.Object3D();

    this.parentDummy.position.set(px, py, pz);
    this.parentDummy.rotation.set(0, ry, 0); // Only Y rotation for zombie base
    this.parentDummy.updateMatrix();

    // Multiply matrices: parent * local
    if (!this._tempMatrix) this._tempMatrix = new THREE.Matrix4();
    this._tempMatrix.multiplyMatrices(this.parentDummy.matrix, this.dummy.matrix);

    mesh.setMatrixAt(index, this._tempMatrix);

    // Color
    const color = isFlashing ? this.colors.flash : this.colors[type];
    mesh.setColorAt(index, color);
  }

  // Copied from Zombie.js
  createMosaicTexture(type = 'head') {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const palettes = {
      head: { base: [64, 107, 48], noise: [[48, 80, 36], [80, 134, 60], [96, 160, 72]] },
      // other palettes unused for texture generation in original code (only head uses texture)
    };

    const palette = palettes[type] || palettes.head;
    const mosaicSize = 4;

    for (let y = 0; y < size; y += mosaicSize) {
      for (let x = 0; x < size; x += mosaicSize) {
        const useNoise = Math.random() > 0.3;
        let color;
        if (useNoise) {
          const noiseIndex = Math.floor(Math.random() * palette.noise.length);
          color = palette.noise[noiseIndex];
        } else {
          const variation = 10;
          color = [
            Math.max(0, Math.min(255, palette.base[0] + (Math.random() - 0.5) * variation)),
            Math.max(0, Math.min(255, palette.base[1] + (Math.random() - 0.5) * variation)),
            Math.max(0, Math.min(255, palette.base[2] + (Math.random() - 0.5) * variation))
          ];
        }
        ctx.fillStyle = `rgb(${Math.floor(color[0])}, ${Math.floor(color[1])}, ${Math.floor(color[2])})`;
        ctx.fillRect(x, y, mosaicSize, mosaicSize);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  getZombieAt(instanceId) {
    return this.instanceMap[instanceId];
  }

  dispose() {
    Object.values(this.meshes).forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      // Material disposal if needed (shared materials)
    });
    this.headMaterial.dispose();
    this.bodyMaterial.dispose();
    this.armMaterial.dispose();
    this.legMaterial.dispose();
  }
}
