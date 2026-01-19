// src/world/entities/Cloud.js
export class Cloud {
    static generate(x, y, z, chunk, dObj = null) {
        chunk.add(x, y, z, 'cloud', dObj);
    }
}
