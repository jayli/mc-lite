/**
 * 丧尸实体类 - 符合我的世界原版风格的敌人
 * 尺寸：1x1x2 方块单位
 * 功能：追踪玩家、碰撞检测、生命值管理
 */
class Zombie {
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
     * @param {Function} getBlockAt - 获取指定坐标的方块类型函数
     */
    checkCollision(getBlockAt) {
        // 检查当前位置下方是否有方块（地面）
        const feetY = Math.floor(this.position.y - this.height/2);
        const headY = Math.floor(this.position.y + this.height/2);
        const posX = Math.floor(this.position.x);
        const posZ = Math.floor(this.position.z);

        // 检查脚下是否有方块
        if (!getBlockAt(posX, feetY, posZ)) {
            // 如果脚下没有方块，则应用重力（但丧尸不应掉落太远）
            // 对丧尸来说，这里简化处理，只确保它不会穿过地面
        }

        // 检查头部是否有障碍物
        if (getBlockAt(posX, headY, posZ)) {
            // 简单地将丧尸向下移动一点
            this.position.y -= 0.1;
            this.mesh.position.y = this.position.y;
        }

        // 检查水平方向碰撞（前方）
        const forwardX = Math.floor(this.position.x + this.velocity.x * 2); // *2 是为了提前检测
        const forwardZ = Math.floor(this.position.z + this.velocity.z * 2);

        if (getBlockAt(forwardX, Math.floor(this.position.y), forwardZ)) {
            // 遇到障碍物时，尝试寻找可通行路径
            // 这里简化处理，只是停止前进
            this.velocity.x = 0;
            this.velocity.z = 0;
        }

        // 检查丧尸是否试图向上爬过台阶（1格高度）
        const obstacleAtHeadLevel = getBlockAt(posX, headY, posZ);
        const potentialStepAtHeadLevel = getBlockAt(posX, headY - 1, posZ);

        // 简单的台阶检测：允许丧尸上下1格高度的台阶
        if (!obstacleAtHeadLevel && potentialStepAtHeadLevel) {
            // 如果前方1格高的地方是实心块，丧尸可以向上移动
            if (Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001) {
                // 小幅提升丧尸高度以跨过台阶
                this.position.y += 0.05; // 逐步升高，模拟上台阶
                this.mesh.position.y = this.position.y;
            }
        }
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

// 导出Zombie类（如果在模块系统中使用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Zombie;
}