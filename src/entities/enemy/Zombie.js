import * as THREE from 'three';

/**
 * 丧尸实体类 - 符合我的世界原版风格的敌人
 * 尺寸：1x1x2 方块单位
 * 功能：追踪玩家、碰撞检测、生命值管理
 */
export class Zombie {
    constructor(position = { x: 0, y: 0, z: 0 }) {
        // 基础属性
        this.position = { ...position };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };

        // 物理属性
        this.width = 0.6;  // 略小于1个方块，便于移动
        this.height = 1.8; // 2个方块高度
        this.speed = 0.02;
        this.perceptionRange = 10; // 感知范围

        // 状态属性
        this.health = 100;
        this.maxHealth = 100;
        this.state = 'idle'; // idle, chasing
        this.isAlive = true;

        // 目标（玩家）
        this.target = null;

        // 创建僵尸几何体（我的世界风格的方块化人体）
        this.mesh = this.createZombieMesh();
    }

    /**
     * 创建我的世界风格的丧尸几何体
     */
    createZombieMesh() {
        const group = new THREE.Group();

        // 材质 - 接近我的世界丧尸的颜色
        const zombieMaterial = new THREE.MeshLambertMaterial({
            color: 0x8EB87B, // 绿色调，符合丧尸外观
            wireframe: false
        });

        // 头部 (1x1x1 方块)
        const headGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const head = new THREE.Mesh(headGeometry, zombieMaterial);
        head.position.set(0, 1.5, 0); // 头部在身体上方
        group.add(head);

        // 身体 (0.75x1x0.5 方块)
        const bodyGeometry = new THREE.BoxGeometry(0.75, 1, 0.5);
        const body = new THREE.Mesh(bodyGeometry, zombieMaterial);
        body.position.set(0, 0.5, 0);
        group.add(body);

        // 左臂 (0.3x0.8x0.3 方块)
        const leftArmGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.3);
        const leftArm = new THREE.Mesh(leftArmGeometry, zombieMaterial);
        leftArm.position.set(-0.55, 0.9, 0);
        group.add(leftArm);

        // 右臂 (0.3x0.8x0.3 方块)
        const rightArmGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.3);
        const rightArm = new THREE.Mesh(rightArmGeometry, zombieMaterial);
        rightArm.position.set(0.55, 0.9, 0);
        group.add(rightArm);

        // 左腿 (0.35x0.8x0.35 方块)
        const leftLegGeometry = new THREE.BoxGeometry(0.35, 0.8, 0.35);
        const leftLeg = new THREE.Mesh(leftLegGeometry, zombieMaterial);
        leftLeg.position.set(-0.19, -0.2, 0);
        group.add(leftLeg);

        // 右腿 (0.35x0.8x0.35 方块)
        const rightLegGeometry = new THREE.BoxGeometry(0.35, 0.8, 0.35);
        const rightLeg = new THREE.Mesh(rightLegGeometry, zombieMaterial);
        rightLeg.position.set(0.19, -0.2, 0);
        group.add(rightLeg);

        // 设置userData标记这是一个丧尸，方便射线检测
        group.userData = { type: 'zombie', isZombie: true };

        // 设置全局位置
        group.position.set(this.position.x, this.position.y, this.position.z);

        return group;
    }

    /**
     * 检测玩家是否在感知范围内
     * @param {Object} playerPosition - 玩家位置 {x, y, z}
     */
    detectPlayer(playerPosition) {
        const dx = this.position.x - playerPosition.x;
        const dy = this.position.y - playerPosition.y;
        const dz = this.position.z - playerPosition.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance <= this.perceptionRange) {
            this.target = { ...playerPosition };
            this.state = 'chasing';
            return true;
        } else if (distance > this.perceptionRange + 2) { // 添加一点迟滞
            this.target = null;
            this.state = 'idle';
        }
        return false;
    }

    /**
     * 移动丧尸
     */
    move() {
        if (!this.target || this.state !== 'chasing' || !this.isAlive) {
            // 在闲置状态下做一些轻微的随机移动或动画
            this.velocity.x = 0;
            this.velocity.z = 0;
            return;
        }

        // 计算朝向玩家的方向
        const dx = this.target.x - this.position.x;
        const dz = this.target.z - this.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance > 0.5) { // 只有当距离足够远时才移动
            // 标准化方向向量
            this.velocity.x = (dx / distance) * this.speed;
            this.velocity.z = (dz / distance) * this.speed;
        } else {
            // 接近玩家时减速
            this.velocity.x *= 0.5;
            this.velocity.z *= 0.5;
        }

        // 更新位置
        this.position.x += this.velocity.x;
        this.position.z += this.velocity.z;

        // 更新朝向（Y轴旋转）
        if (this.velocity.x !== 0 || this.velocity.z !== 0) {
            this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
        }

        // 应用新位置到mesh
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.y = this.rotation.y;
    }

    /**
     * 检查与世界的碰撞
     * @param {Function} getBlockFunc - 获取指定坐标的方块类型函数
     */
    checkCollision(getBlockFunc) {
        const posX = Math.floor(this.position.x);
        const posY = Math.floor(this.position.y);
        const posZ = Math.floor(this.position.z);

        // 检查水平移动方向的碰撞
        const nextPosX = Math.floor(this.position.x + this.velocity.x);
        const nextPosZ = Math.floor(this.position.z + this.velocity.z);

        // 检查前方X方向是否有方块 (检查两个Y层，确保丧尸不会被卡住)
        if (getBlockFunc(nextPosX, posY, posZ) || getBlockFunc(nextPosX, posY - 1, posZ)) {
            // 如果前方有方块，停下X方向移动
            this.velocity.x = 0;
        }

        // 检查前方Z方向是否有方块
        if (getBlockFunc(posX, posY, nextPosZ) || getBlockFunc(posX, posY - 1, nextPosZ)) {
            // 如果前方有方块，停下Z方向移动
            this.velocity.z = 0;
        }

        // 查找合适的站立高度
        let groundY = posY;
        let foundGround = false;

        // 向下搜索地面（最多向下5个方块）
        for (let y = posY; y >= posY - 5; y--) {
            if (getBlockFunc(posX, y, posZ)) {
                groundY = y + 1; // 站在方块上
                foundGround = true;
                break;
            }
        }

        // 如果找到了地面，确保丧尸站在地面之上
        if (foundGround) {
            const desiredY = groundY + this.height / 2; // 丧尸中心点应位于脚部上方

            // 如果当前高度高于理想地面高度，则下降（实现下台阶功能）
            if (this.position.y > desiredY) {
                this.position.y = Math.max(desiredY, this.position.y - 0.1); // 平滑下降
            } else {
                // 如果当前高度低于地面高度，调整到正确位置（上台阶）
                this.position.y = desiredY;
            }
        }

        // 检查前方是否有台阶可以攀爬
        if (this.velocity.x !== 0 || this.velocity.z !== 0) {
            // 计算前方位置
            const aheadX = Math.floor(this.position.x + this.velocity.x * 2);
            const aheadZ = Math.floor(this.position.z + this.velocity.z * 2);

            // 检查前方是否有台阶（比当前位置高最多1个方块）
            for (let testY = posY; testY <= posY + 1; testY++) {
                if (getBlockFunc(aheadX, testY, posZ) && !getBlockFunc(aheadX, testY + 1, posZ)) {
                    // 前方有台阶，检查是否可以攀爬
                    if (getBlockFunc(aheadX, testY - 1, posZ)) {
                        // 设置丧尸在台阶上方的高度
                        this.position.y = testY + 1 + this.height/2;
                        break;
                    }
                }

                if (getBlockFunc(posX, testY, aheadZ) && !getBlockFunc(posX, testY + 1, aheadZ)) {
                    // 前方有台阶，检查是否可以攀爬
                    if (getBlockFunc(posX, testY - 1, aheadZ)) {
                        // 设置丧尸在台阶上方的高度
                        this.position.y = testY + 1 + this.height/2;
                        break;
                    }
                }
            }
        }

        // 确保Y位置正确
        this.mesh.position.y = this.position.y;
    }

    /**
     * 应用伤害
     * @param {number} damage - 伤害值
     */
    takeDamage(damage) {
        if (!this.isAlive) return;

        this.health -= damage;

        // 视觉反馈 - 闪红
        this.flashDamage();

        if (this.health <= 0) {
            this.die();
        }
    }

    /**
     * 伤害时的视觉反馈
     */
    flashDamage() {
        // 创建临时红色材质以表示受伤
        const redMaterial = new THREE.MeshLambertMaterial({
            color: 0xFF0000,
            transparent: true,
            opacity: 0.7
        });

        // 应用到所有子网格
        this.mesh.traverse((child) => {
            if (child.isMesh) {
                const originalMaterial = child.material;
                child.material = redMaterial;

                // 0.2秒后恢复原材质
                setTimeout(() => {
                    child.material = originalMaterial;
                }, 200);
            }
        });
    }

    /**
     * 死亡处理
     */
    die() {
        this.isAlive = false;
        this.state = 'dead';

        // 可选：播放死亡动画，然后从场景中移除
        setTimeout(() => {
            if (this.mesh.parent) {
                this.mesh.parent.remove(this.mesh);
            }
        }, 1000);
    }

    /**
     * 更新丧尸状态
     * @param {Object} playerPosition - 玩家位置
     * @param {Function} getBlockAt - 获取方块的函数
     */
    update(playerPosition, getBlockAt) {
        if (!this.isAlive) return;

        // 检测玩家
        this.detectPlayer(playerPosition);

        // 移动
        this.move();

        // 检查碰撞
        this.checkCollision(getBlockAt);
    }

    /**
     * 获取丧尸的边界框用于碰撞检测
     */
    getBoundingBox() {
        return {
            minX: this.position.x - this.width / 2,
            maxX: this.position.x + this.width / 2,
            minY: this.position.y - this.height / 2,
            maxY: this.position.y + this.height / 2,
            minZ: this.position.z - this.width / 2,
            maxZ: this.position.z + this.width / 2
        };
    }
}