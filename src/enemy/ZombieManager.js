/**
 * 丧尸管理器 - 管理游戏中所有的丧尸实体
 */
export class ZombieManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.zombies = [];
        this.maxActiveZombies = 10; // 最大活跃丧尸数

        // 性能优化：批量更新
        this.updateQueue = [];
    }

    /**
     * 生成一个新丧尸
     * @param {Object} position - 丧尸生成位置 {x, y, z}
     */
    spawnZombie(position) {
        if (this.zombies.length >= this.maxActiveZombies) {
            console.warn('达到最大丧尸数量限制');
            return null;
        }

        const zombie = new Zombie(position);

        // 将丧尸添加到场景中
        this.scene.add(zombie.mesh);

        // 添加到管理器数组
        this.zombies.push(zombie);

        return zombie;
    }

    /**
     * 从世界中移除丧尸
     * @param {Zombie} zombie - 要移除的丧尸实例
     */
    removeZombie(zombie) {
        // 从场景中移除
        if (zombie.mesh.parent) {
            zombie.mesh.parent.remove(zombie.mesh);
        }

        // 从管理器数组中移除
        const index = this.zombies.indexOf(zombie);
        if (index !== -1) {
            this.zombies.splice(index, 1);
        }
    }

    /**
     * 批量更新所有丧尸
     * @param {Object} playerPosition - 玩家位置
     */
    updateAll(playerPosition) {
        for (let i = this.zombies.length - 1; i >= 0; i--) {
            const zombie = this.zombies[i];

            // 更新丧尸状态
            zombie.update(
                playerPosition,
                this.world.getBlockAt.bind(this.world)
            );

            // 检查丧尸是否死亡，如果是则移除
            if (!zombie.isAlive) {
                this.removeZombie(zombie);
            }
        }
    }

    /**
     * 获取所有活跃丧尸
     */
    getAllZombies() {
        return [...this.zombies]; // 返回副本以防止外部修改
    }

    /**
     * 获取附近的丧尸
     * @param {Object} position - 参考点位置
     * @param {number} radius - 搜索半径
     */
    getZombiesNear(position, radius) {
        return this.zombies.filter(zombie => {
            const dx = zombie.position.x - position.x;
            const dy = zombie.position.y - position.y;
            const dz = zombie.position.z - position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            return distance <= radius;
        });
    }

    /**
     * 检查是否有丧尸在某个位置
     * @param {Object} position - 检查位置
     * @param {number} tolerance - 容差
     */
    isZombieAt(position, tolerance = 0.5) {
        return this.zombies.some(zombie => {
            const dx = Math.abs(zombie.position.x - position.x);
            const dy = Math.abs(zombie.position.y - position.y);
            const dz = Math.abs(zombie.position.z - position.z);

            return dx <= tolerance && dy <= tolerance && dz <= tolerance;
        });
    }
}