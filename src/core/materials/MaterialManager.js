// src/core/materials/MaterialManager.js
import * as THREE from 'three';

export class MaterialManager {
    constructor() {
        this.materials = new Map();
        this.definitions = new Map();
        this.textureLoader = new THREE.TextureLoader();
        this.textureCache = new Map();
        this.defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff });
    }

    preloadTextures(urls) {
        return Promise.all(urls.map(url =>
            this.textureLoader.loadAsync(url).then(texture => {
                texture.magFilter = THREE.NearestFilter;
                texture.colorSpace = THREE.SRGBColorSpace;
                this.textureCache.set(url, texture);
            })
        ));
    }

    registerMaterial(type, definition) {
        this.definitions.set(type, definition);
    }

    getMaterial(type) {
        if (this.materials.has(type)) {
            return this.materials.get(type);
        }

        const def = this.definitions.get(type);
        if (!def) {
            // console.warn(`Material definition not found for type: ${type}`);
            return this.defaultMaterial;
        }

        const mat = this._createMaterial(def);
        this.materials.set(type, mat);
        return mat;
    }

    _createMaterial(def) {
        if (def.textureUrl) {
            const texture = this.textureCache.get(def.textureUrl);
            if (!texture) {
                console.warn(`Texture not preloaded: ${def.textureUrl}`);
                return this.defaultMaterial;
            }
            return new THREE.MeshStandardMaterial({
                map: texture,
                transparent: def.transparent || false,
                opacity: def.opacity || 1,
                side: def.side || THREE.FrontSide,
                alphaTest: def.alphaTest || 0
            });
        }

        if (def.textureGenerator) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            // Fill background with color only if fillBackground is not false
            if (def.color && def.fillBackground !== false) {
                ctx.fillStyle = def.color;
                ctx.fillRect(0, 0, 64, 64);
            }

            def.textureGenerator(ctx);

            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.NearestFilter;
            texture.colorSpace = THREE.SRGBColorSpace;

            return new THREE.MeshStandardMaterial({
                map: texture,
                transparent: def.transparent || false,
                opacity: def.opacity || 1,
                side: def.side || THREE.FrontSide,
                alphaTest: def.alphaTest || 0
            });
        }

        return new THREE.MeshStandardMaterial({
            color: def.color || 0xffffff,
            transparent: def.transparent || false,
            opacity: def.opacity || 1
        });
    }
}

export const materials = new MaterialManager();

// Function to initialize materials, including async texture loading
export async function initializeMaterials() {
    const textureUrls = [
        './src/world/assets/textures/oak_leaves_branch_medium.png'
    ];
    await materials.preloadTextures(textureUrls);
}

// Helper to create simple noise texture logic
function mkMat(col, op=1) {
    return {
        color: col,
        opacity: op,
        transparent: op < 1,
        textureGenerator: (ctx) => {
             for(let i=0;i<100;i++){
                 ctx.fillStyle=`rgba(0,0,0,${Math.random()*0.15})`;
                 ctx.fillRect(Math.random()*64,Math.random()*64,2,2);
             }
        }
    };
}

function mkDetailMat(baseCol, detailCol, isTransparent=false, drawFunc) {
    return {
        color: baseCol,
        transparent: true,
        side: isTransparent ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: 0.5,
        fillBackground: !isTransparent,
        textureGenerator: (ctx) => {
             ctx.fillStyle = detailCol;
             drawFunc(ctx);
        }
    }
}

// Register Defaults
materials.registerMaterial('grass', mkMat('#559944'));
materials.registerMaterial('dirt', mkMat('#5d4037'));
materials.registerMaterial('stone', mkMat('#757575'));
materials.registerMaterial('sand', mkMat('#e6c288'));
materials.registerMaterial('wood', mkMat('#4a3218'));
materials.registerMaterial('planks', mkMat('#a07545'));
materials.registerMaterial('leaves', mkMat('#386628', 0.9));
materials.registerMaterial('water', mkMat('#205099', 0.6));
materials.registerMaterial('swamp_water', mkMat('#2F4F4F', 0.7));
materials.registerMaterial('swamp_grass', mkMat('#4C5E34'));
materials.registerMaterial('cactus', mkMat('#2E8B57'));
materials.registerMaterial('bed', mkMat('#cc0000'));
materials.registerMaterial('carBody', mkMat('#FFD700'));
materials.registerMaterial('wheel', mkMat('#222222'));
materials.registerMaterial('cloud', mkMat('#FFFFFF', 0.9));
materials.registerMaterial('sky_stone', mkMat('#DDDDDD'));
materials.registerMaterial('sky_grass', mkMat('#88CCFF'));
materials.registerMaterial('sky_wood', mkMat('#DDA0DD'));
materials.registerMaterial('sky_leaves', mkMat('#FF69B4', 0.9));
materials.registerMaterial('moss', mkMat('#4B6E31'));
materials.registerMaterial('azalea_log', mkMat('#635338'));
materials.registerMaterial('chest', { color: 0xFFA500 }); // Simple color for now

// Additional items
materials.registerMaterial('diamond', mkMat('#00FFFF'));
materials.registerMaterial('gold', mkMat('#FFD700'));
materials.registerMaterial('apple', mkMat('#FF0000'));
materials.registerMaterial('god_sword', mkMat('#9400D3'));
materials.registerMaterial('gold_apple', mkMat('#FFD700'));

// Complex Mats
materials.registerMaterial('flower', mkDetailMat('#000000', '#FF4444', true, (ctx)=>{
    ctx.fillStyle='#2E8B57'; ctx.fillRect(30,24,4,40);
    ctx.fillStyle='#FF4444'; ctx.beginPath(); ctx.arc(32,24,12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#FFD700'; ctx.beginPath(); ctx.arc(32,24,4,0,Math.PI*2); ctx.fill();
}));

materials.registerMaterial('azalea_leaves', mkDetailMat('#4A6B30', '#E066CC', false, (ctx) => {
    for(let i=0; i<12; i++) {
        const x = Math.random()*56; const y = Math.random()*56;
        ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }
}));

materials.registerMaterial('vine', mkDetailMat(null, '#355E3B', true, (ctx) => {
    ctx.strokeStyle = '#355E3B'; ctx.lineWidth = 3;
    for(let i=0; i<5; i++) {
        ctx.beginPath();
        ctx.moveTo(10+i*10, 0);
        ctx.bezierCurveTo(Math.random()*64, 20, Math.random()*64, 40, 10+i*10, 64);
        ctx.stroke();
    }
}));

materials.registerMaterial('lilypad', mkDetailMat(null, '#228B22', true, (ctx) => {
    ctx.beginPath(); ctx.arc(32,32,28,0.3, Math.PI*1.8); ctx.fill();
}));

materials.registerMaterial('realistic_trunk_procedural', {
    color: '#5D4037', // Dark Brown
    textureGenerator: (ctx) => {
        // Add dark green dots
        ctx.fillStyle = '#006400'; // Dark Green
        for(let i = 0; i < 150; i++) {
            ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
        }
    }
});

// New tree materials
materials.registerMaterial('realistic_oak_leaves', {
    textureUrl: './src/world/assets/textures/oak_leaves_branch_medium.png',
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide
});

