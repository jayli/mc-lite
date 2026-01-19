// src/entities/player/Slots.js
export class Slot {
    constructor(id, item = null, count = 0, meta = {}) {
        this.id = id;
        this.item = item;
        this.count = count;
        this.meta = meta;
    }

    set(item, count, meta = {}) {
        this.item = item;
        this.count = count;
        this.meta = meta;
    }

    clear() {
        this.item = null;
        this.count = 0;
        this.meta = {};
    }

    isEmpty() {
        return this.item === null || this.count <= 0;
    }
}

export class Inventory {
    constructor(size = 36) {
        this.slots = [];
        for (let i = 0; i < size; i++) {
            this.slots.push(new Slot(i));
        }
        this.selectedSlot = 0;
    }

    add(item, count = 1) {
        // Simple add logic: try stack, then empty slot
        for (const slot of this.slots) {
            if (slot.item === item) {
                slot.count += count;
                return true;
            }
        }
        for (const slot of this.slots) {
            if (slot.isEmpty()) {
                slot.set(item, count);
                return true;
            }
        }
        return false;
    }

    remove(item, count = 1) {
        // Simple remove logic
        for (const slot of this.slots) {
            if (slot.item === item) {
                if (slot.count >= count) {
                    slot.count -= count;
                    if (slot.count <= 0) slot.clear();
                    return true;
                }
            }
        }
        return false;
    }

    has(item, count = 1) {
        let total = 0;
        for (const slot of this.slots) {
            if (slot.item === item) total += slot.count;
        }
        return total >= count;
    }

    getSelected() {
        return this.slots[this.selectedSlot];
    }
}
