import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// --- 1. 场景初始化 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 20, 90);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- 2. 几何体与材质 ---
const geoBlock = new THREE.BoxGeometry(1, 1, 1);
const particleGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);

// 十字交叉模型 (花朵/藤蔓)
function buildCrossGeo(offsetY = -0.25) {
    const p1 = new THREE.PlaneGeometry(0.7, 0.7);
    const p2 = new THREE.PlaneGeometry(0.7, 0.7);
    p2.rotateY(Math.PI / 2);
    const merged = BufferGeometryUtils.mergeGeometries([p1, p2]);
    merged.translate(0, offsetY, 0);
    return merged;
}
const geoFlower = buildCrossGeo(-0.25); // 贴地
const geoVine = buildCrossGeo(0);       // 居中 (悬挂)

// 睡莲模型
function buildLilyGeo() {
    const geo = new THREE.PlaneGeometry(0.8, 0.8);
    geo.rotateX(-Math.PI/2);
    geo.translate(0, -0.48, 0); // 浮在水面
    return geo;
}
const geoLily = buildLilyGeo();

// 仙人掌模型
function buildCactusGeo() {
    const geoms = [];
    geoms.push(new THREE.BoxGeometry(0.65, 1, 0.65)); // 主干
    const la = new THREE.BoxGeometry(0.25, 0.25, 0.25); la.translate(-0.4, 0.1, 0); geoms.push(la);
    const lau = new THREE.BoxGeometry(0.25, 0.4, 0.25); lau.translate(-0.4, 0.35, 0); geoms.push(lau);
    const ra = new THREE.BoxGeometry(0.25, 0.25, 0.25); ra.translate(0.4, -0.1, 0); geoms.push(ra);
    const rau = new THREE.BoxGeometry(0.25, 0.3, 0.25); rau.translate(0.4, 0.1, 0); geoms.push(rau);
    return BufferGeometryUtils.mergeGeometries(geoms);
}
const geoCactus = buildCactusGeo();

// 通用材质生成
function mkMat(col, op=1) {
    const c = document.createElement('canvas'); c.width=64; c.height=64; const x=c.getContext('2d');
    x.fillStyle = col; x.fillRect(0,0,64,64);
    for(let i=0;i<100;i++){ x.fillStyle=`rgba(0,0,0,${Math.random()*0.15})`; x.fillRect(Math.random()*64,Math.random()*64,2,2); }
    const t = new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({map:t, transparent:op<1, opacity:op});
}

// 高级纹理生成 (带花纹/透明)
function mkDetailMat(baseCol, detailCol, isTransparent=false, drawFunc) {
    const c = document.createElement('canvas'); c.width=64; c.height=64; const ctx=c.getContext('2d');
    if(!isTransparent) { ctx.fillStyle = baseCol; ctx.fillRect(0,0,64,64); }

    ctx.fillStyle = detailCol;
    drawFunc(ctx);

    const t = new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({map:t, transparent:true, side: isTransparent ? THREE.DoubleSide : THREE.FrontSide, alphaTest:0.5});
}

// 杜鹃花叶纹理
const matAzaleaLeaves = mkDetailMat('#4A6B30', '#E066CC', false, (ctx) => {
    // 绘制粉色花朵
    for(let i=0; i<12; i++) {
        const x = Math.random()*56; const y = Math.random()*56;
        ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }
});

// 藤蔓纹理
const matVine = mkDetailMat(null, '#355E3B', true, (ctx) => {
    // 绘制乱序藤蔓线条
    ctx.strokeStyle = '#355E3B'; ctx.lineWidth = 3;
    for(let i=0; i<5; i++) {
        ctx.beginPath();
        ctx.moveTo(10+i*10, 0);
        ctx.bezierCurveTo(Math.random()*64, 20, Math.random()*64, 40, 10+i*10, 64);
        ctx.stroke();
    }
});

// 睡莲纹理
const matLily = mkDetailMat(null, '#228B22', true, (ctx) => {
    ctx.beginPath(); ctx.arc(32,32,28,0.3, Math.PI*1.8); ctx.fill(); // 缺口圆
});

const ITEMS = {
    'dirt': { col: '#5D4037' }, 'stone': { col: '#757575' }, 'wood': { col: '#5D4037' },
    'sand': { col: '#E6C288' }, 'planks': { col: '#C19A6B' }, 'cactus': { col: '#2E8B57' },
    'diamond': { col: '#00FFFF' }, 'gold': { col: '#FFD700' }, 'apple': { col: '#FF0000' },
    'flower': { col: '#FF4444' }, 'car': { col: '#333333' },
    'cloud': { col: '#FFFFFF' }, 'sky_stone': { col: '#DDDDDD' }, 'sky_wood': { col: '#DDA0DD' },
    'gold_apple': { col: '#FFD700' }, 'god_sword': { col: '#9400D3' },
    'moss': { col: '#4B6E31' }, 'azalea_log': { col: '#635338' }, 'azalea_leaves': { col: '#4A6B30' },
    'vine': { col: '#355E3B' }, 'lilypad': { col: '#228B22' }
};

const mats = {
    grass: mkMat('#559944'), dirt: mkMat('#5d4037'), stone: mkMat('#757575'),
    sand: mkMat('#e6c288'), wood: mkMat('#4a3218'), planks: mkMat('#a07545'),
    leaves: mkMat('#386628', 0.9), water: mkMat('#205099', 0.6),
    cactus: mkMat('#2E8B57'),
    flower: mkDetailMat('#000000', '#FF4444', true, (ctx)=>{
        // 简单的花
        ctx.fillStyle='#2E8B57'; ctx.fillRect(30,24,4,40);
        ctx.fillStyle='#FF4444'; ctx.beginPath(); ctx.arc(32,24,12,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#FFD700'; ctx.beginPath(); ctx.arc(32,24,4,0,Math.PI*2); ctx.fill();
    }),
    chest: new THREE.MeshStandardMaterial({color:0xFFA500}),
    bed: mkMat('#cc0000'), carBody: mkMat('#FFD700'), wheel: mkMat('#222222'),
    cloud: mkMat('#FFFFFF', 0.9),
    sky_stone: mkMat('#DDDDDD'), sky_grass: mkMat('#88CCFF'),
    sky_wood: mkMat('#DDA0DD'), sky_leaves: mkMat('#FF69B4', 0.9),
    // 新增
    moss: mkMat('#4B6E31'), azalea_log: mkMat('#635338'), azalea_leaves: matAzaleaLeaves,
    swamp_water: mkMat('#2F4F4F', 0.7), swamp_grass: mkMat('#4C5E34'),
    vine: matVine, lilypad: matLily
};

const geomMap = {
    'flower': geoFlower, 'vine': geoVine, 'lilypad': geoLily,
    'cactus': geoCactus, 'default': geoBlock
};

// --- 3. 全局状态 ---
const CHUNK_SIZE = 16;
const RENDER_DIST = 3;
const chunks = new Map();
const solidBlocks = new Map();
const interactables = [];
const activeParticles = [];
const activeChests = [];
const SEED = Math.random() * 9999;
const placedMeshes = [];

// --- 4. 生成算法 ---
function noise(x, z, scale=0.05) {
    const nx = x + SEED, nz = z + SEED;
    return Math.sin(nx*scale)*2 + Math.cos(nz*scale)*2;
}

// [增强] 群系逻辑
function getBiome(x, z) {
    const temp = noise(x, z, 0.01); // 温度
    const humidity = noise(x + 1000, z + 1000, 0.015); // 湿度

    if (temp > 1.2) return 'FOREST';
    if (temp > 0.6 && temp <= 1.2 && humidity > 0) return 'AZALEA'; // 杜鹃林
    if (temp < -1.5) return 'DESERT';
    if (temp > -1.5 && temp < -0.8 && humidity > 0.5) return 'SWAMP'; // 沼泽
    return 'PLAINS';
}

class Chunk {
    constructor(cx, cz) {
        this.cx = cx; this.cz = cz;
        this.group = new THREE.Group();
        this.keys = [];
        this.gen();
    }

    gen() {
        const d = {}; for(let k in mats) d[k]=[];
        const centerBiome = getBiome(this.cx*CHUNK_SIZE, this.cz*CHUNK_SIZE);

        for(let x=0; x<CHUNK_SIZE; x++) {
            for(let z=0; z<CHUNK_SIZE; z++) {
                const wx=this.cx*CHUNK_SIZE+x, wz=this.cz*CHUNK_SIZE+z;
                let h = Math.floor(noise(wx, wz, 0.08) + noise(wx, wz, 0.02)*3);

                // 地形微调
                if(centerBiome === 'DESERT') h = Math.floor(h * 0.5 + 2);
                if(centerBiome === 'SWAMP') h = Math.floor(h * 0.3 - 2); // 沼泽低洼

                const wLvl = -2;

                if(h < wLvl) {
                    // 水下
                    let water = centerBiome === 'SWAMP' ? 'swamp_water' : 'water';
                    this.add(wx,h,wz,'sand',d);
                    for(let k=1; k<=3; k++) this.add(wx,h-k,wz,'sand',d);
                    for(let y=h+1;y<=wLvl;y++) this.add(wx,y,wz,water,d,false);

                    // 沼泽睡莲
                    if(centerBiome === 'SWAMP' && Math.random()<0.08) {
                        this.add(wx, wLvl+1, wz, 'lilypad', d, false);
                    }

                    if(h<-6 && Math.random()<0.003) this.structure('ship', wx, h+1, wz, d);
                } else {
                    // 地表
                    let surf = 'grass', sub = 'dirt';
                    if(centerBiome === 'DESERT') { surf='sand'; sub='sand'; }
                    if(centerBiome === 'AZALEA') { surf='moss'; sub='dirt'; }
                    if(centerBiome === 'SWAMP') { surf='swamp_grass'; sub='dirt'; }

                    this.add(wx,h,wz,surf,d);
                    this.add(wx,h-1,wz,sub,d);
                    for(let k=2; k<=12; k++) this.add(wx,h-k,wz,'stone',d);

                    // 植被生成
                    if(centerBiome === 'FOREST') {
                        if(Math.random()<0.05) this.structure('treeBig', wx, h+1, wz, d);
                    } else if(centerBiome === 'AZALEA') {
                        if(Math.random()<0.06) this.structure('azalea', wx, h+1, wz, d);
                    } else if(centerBiome === 'SWAMP') {
                        if(Math.random()<0.03) this.structure('swamp', wx, h+1, wz, d);
                    } else if(centerBiome === 'DESERT') {
                        if(Math.random()<0.01) this.structure('cactus', wx, h+1, wz, d);
                        if(Math.random()<0.001) this.structure('rover', wx, h+1, wz, d);
                    } else {
                        if(Math.random()<0.005) this.structure('tree', wx, h+1, wz, d);
                        if(Math.random()<0.05) this.add(wx, h+1, wz, 'flower', d, false);
                        if(Math.random()<0.001) this.structure('house', wx, h+1, wz, d);
                    }
                }

                // 静态云层 (Y=55)
                if(noise(wx, wz, 0.03) > 1.2) {
                    this.add(wx, 55, wz, 'cloud', d);
                }
            }
        }

        // 空岛 (Y=40~70)
        if(Math.random() < 0.15) {
            const islandY = 40 + Math.floor(Math.random() * 30);
            const centerWx = this.cx * CHUNK_SIZE + 8;
            const centerWz = this.cz * CHUNK_SIZE + 8;
            this.buildFloatingIsland(centerWx, islandY, centerWz, d);
        }

        const dum = new THREE.Object3D();
        for(let t in d) {
            if(d[t].length===0) continue;
            const geom = geomMap[t] || geomMap['default'];
            const m = new THREE.InstancedMesh(geom, mats[t], d[t].length);
            m.userData = { type: t, chests: {} };
            d[t].forEach((p,i) => {
                dum.position.set(p.x,p.y,p.z); dum.updateMatrix(); m.setMatrixAt(i,dum.matrix);
                if(t==='chest') m.userData.chests[i] = {open:false};
            });
            // 半透明和特殊模型不投阴影
            if(!['water','swamp_water','cloud','vine','lilypad','flower'].includes(t)) {
                m.castShadow=true; m.receiveShadow=true;
            }
            this.group.add(m); interactables.push(m);
        }
        scene.add(this.group);
    }

    add(x,y,z,t,l,s=true) {
        if(l[t]) l[t].push({x,y,z});
        if(['flower','vine','lilypad'].includes(t)) s=false;
        if(s) { const k=`${x},${y},${z}`; solidBlocks.set(k, true); this.keys.push(k); }
    }

    buildFloatingIsland(cx, cy, cz, d) {
        const radius = 5 + Math.floor(Math.random() * 5);
        const height = 5 + Math.floor(Math.random() * 3);
        for(let y = 0; y <= height; y++) {
            const r = Math.floor(radius * Math.pow(y/height, 0.7));
            for(let dx = -r; dx <= r; dx++) {
                for(let dz = -r; dz <= r; dz++) {
                    if(dx*dx + dz*dz <= r*r) {
                        let type = (y === height) ? 'sky_grass' : 'sky_stone';
                        this.add(cx+dx, cy+y, cz+dz, type, d);
                        if(y === height && Math.random() < 0.1) {
                            this.structure('skyTree', cx+dx, cy+y+1, cz+dz, d);
                        }
                    }
                }
            }
        }
        this.add(cx, cy+height+1, cz, 'chest', d);
    }

    structure(type, x, y, z, l) {
        if(type==='tree' || type==='skyTree') {
            let wT = type==='skyTree' ? 'sky_wood' : 'wood';
            let lT = type==='skyTree' ? 'sky_leaves' : 'leaves';
            for(let i=0;i<4;i++) this.add(x,y+i,z, wT, l);
            for(let lx=x-2;lx<=x+2;lx++) for(let ly=y+2;ly<=y+4;ly++) for(let lz=z-2;lz<=z+2;lz++)
                if((lx!=x||lz!=z||ly>y+3)&&Math.random()>0.3) this.add(lx,ly,lz, lT, l);
        }
        else if(type==='treeBig') {
            const h = 6 + Math.floor(Math.random() * 8);
            for(let i=0;i<h;i++) this.add(x,y+i,z,'wood',l);
            for(let lx=x-2;lx<=x+2;lx++) for(let ly=y+h-3;ly<=y+h;ly++) for(let lz=z-2;lz<=z+2;lz++)
                this.add(lx,ly,lz,'leaves',l);
        }
        else if(type==='azalea') { // 杜鹃花树
            const h = 4 + Math.floor(Math.random()*3);
            for(let i=0;i<h;i++) this.add(x,y+i,z,'azalea_log',l);
            // 灌木状树叶
            for(let lx=x-2;lx<=x+2;lx++) for(let ly=y+h-2;ly<=y+h;ly++) for(let lz=z-2;lz<=z+2;lz++) {
                if(Math.abs(lx-x)+Math.abs(ly-(y+h))+Math.abs(lz-z) <= 2.5) {
                    this.add(lx,ly,lz,'azalea_leaves',l);
                }
            }
        }
        else if(type==='swamp') { // 沼泽树
            const h = 5 + Math.floor(Math.random()*4);
            for(let i=0;i<h;i++) this.add(x,y+i,z,'wood',l);
            // 宽大树冠
            for(let lx=x-3;lx<=x+3;lx++) for(let lz=z-3;lz<=z+3;lz++) {
                if(Math.abs(lx-x)+Math.abs(lz-z) <= 3.5) {
                    this.add(lx,y+h-1,lz,'leaves',l);
                    this.add(lx,y+h,lz,'leaves',l);
                    // 垂下藤蔓
                    if(Math.random()<0.3 && Math.abs(lx-x)>1) {
                        for(let v=1; v<=3; v++) this.add(lx, y+h-1-v, lz, 'vine', l, false);
                    }
                }
            }
        }
        else if(type==='cactus') this.add(x,y,z,'cactus',l);
        else if(type==='house') {
            for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++) this.add(x+i,y-1,z+j,'stone',l);
            for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++) {
                if(Math.abs(i)==2||Math.abs(j)==2) {
                    if(i==0&&j==2) continue;
                    if((i==-2||i==2)&&j==0) { this.add(x+i,y,z+j,'planks',l); this.add(x+i,y+2,z+j,'planks',l); }
                    else for(let h=0;h<3;h++) this.add(x+i,y+h,z+j,'planks',l);
                }
            }
            for(let h=0;h<3;h++) for(let i=-2+h;i<=2-h;i++) { this.add(x+i,y+3+h,z-2+h,'wood',l); this.add(x+i,y+3+h,z+2-h,'wood',l); }
            for(let j=-1;j<=1;j++) this.add(x,y+5,z+j,'wood',l);
            this.add(x-1,y,z-1,'bed',l,false); this.add(x+1,y,z-1,'chest',l);
        }
        else if(type==='rover') {
            this.add(x-1, y, z-1, 'wheel', l); this.add(x+1, y, z-1, 'wheel', l);
            this.add(x-1, y, z+1, 'wheel', l); this.add(x+1, y, z+1, 'wheel', l);
            for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=2;dz++) this.add(x+dx, y+1, z+dz, 'carBody', l);
            this.add(x, y+2, z, 'chest', l);
        }
        else if(type==='ship') {
            for(let dz=-3; dz<=3; dz++) for(let dx=-2; dx<=2; dx++) {
                if(Math.abs(dx)===2 || Math.abs(dz)===3) { this.add(x+dx, y+1, z+dz, 'wood', l); this.add(x+dx, y+2, z+dz, 'planks', l); }
                else this.add(x+dx, y, z+dz, 'planks', l);
            }
            for(let i=0; i<5; i++) this.add(x, y+i, z, 'wood', l);
            this.add(x, y+1, z+2, 'chest', l);
        }
    }

    dispose() {
        scene.remove(this.group);
        this.keys.forEach(k => solidBlocks.delete(k));
        this.group.children.forEach(m => {
            const idx = interactables.indexOf(m);
            if(idx > -1) interactables.splice(idx, 1);
        });
    }
}

// --- 5. 玩家与手臂 ---
const player = new THREE.Group();
player.scale.set(0.6, 0.6, 0.6);
scene.add(player);

let spawnFound = false;
for(let i=0; i<1000; i++) {
    const tx = (Math.random() - 0.5) * 20000;
    const tz = (Math.random() - 0.5) * 20000;
    // 优先出生在森林或平原，避免海里或沼泽水里
    if(getBiome(tx, tz) === 'FOREST' || getBiome(tx, tz) === 'PLAINS') {
        player.position.set(tx, 60, tz);
        spawnFound = true;
        break;
    }
}
if(!spawnFound) player.position.set(0, 60, 0);

const armR = new THREE.Mesh(new THREE.BoxGeometry(0.4,1.2,0.4), mkMat('#eebb99'));
armR.position.set(0.6, -0.6, -1.2); armR.rotation.x = 0.2; armR.visible = false;
camera.add(armR);

const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.castShadow=true; light.shadow.mapSize.set(1024,1024);
light.shadow.camera.left=-30; light.shadow.camera.right=30; light.shadow.camera.top=30; light.shadow.camera.bottom=-30;
scene.add(light); scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if(e.code==='KeyZ') toggleInventory();
    if(['Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)) selectSlot(parseInt(e.code.replace('Digit',''))-1);
});
window.addEventListener('keyup', e => keys[e.code] = false);

let cameraPitch = 0;
document.body.addEventListener('click', () => { if(!isInventoryOpen) document.body.requestPointerLock(); });
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === document.body) {
        player.rotation.y -= e.movementX * 0.002;
        cameraPitch -= e.movementY * 0.002;
        cameraPitch = Math.max(-1.5, Math.min(1.5, cameraPitch));
    }
});

// --- 6. 交互 (修复版虚空搭路) ---
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0,0);
const dum = new THREE.Matrix4();
let swingTime = 0;

function showMessage(text) {
    const msgEl = document.getElementById('msg');
    msgEl.innerText = text; msgEl.style.opacity = 1;
    setTimeout(() => msgEl.style.opacity = 0, 2000);
}

function tryPlaceBlock(x, y, z, heldItem) {
    const k = `${x},${y},${z}`;
    if(solidBlocks.has(k)) return false;

    // 碰撞检测
    const pPos = player.position;
    if(x >= pPos.x - 0.5 && x <= pPos.x + 0.5 &&
       z >= pPos.z - 0.5 && z <= pPos.z + 0.5 &&
       y >= pPos.y - 0.5 && y <= pPos.y + 1.2) {
        return false;
    }

    placeBlock(x, y, z, heldItem);
    inventory[heldItem]--;
    updateUI();
    swingTime = 10;
    return true;
}

function interact(button) {
    if(document.pointerLockElement !== document.body) return;
    raycaster.setFromCamera(center, camera);

    const targets = [...interactables.filter(m=>m.parent), ...placedMeshes];
    const hits = raycaster.intersectObjects(targets);

    // 右键放置
    if(button === 2) {
        const heldItem = getSelectedItem();

        // 1. 常规贴面放置
        if(hits.length > 0 && hits[0].distance < 5) {
            const hit = hits[0];
            const m = hit.object;
            let targetPos = new THREE.Vector3();
            if(m.isInstancedMesh) {
                m.getMatrixAt(hit.instanceId, dum); dum.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
            } else targetPos.copy(m.position);

            // 开箱
            let type = m.userData.type || 'unknown';
            if(type === 'chest' && m.isInstancedMesh) {
                const info = m.userData.chests[hit.instanceId];
                if(!info.open) { openChest(m, hit.instanceId, targetPos); swingTime = 10; return; }
            }

            if(heldItem && inventory[heldItem] > 0) {
                // 使用法线
                const normal = hit.face.normal;
                const px = Math.round(targetPos.x + normal.x);
                const py = Math.round(targetPos.y + normal.y);
                const pz = Math.round(targetPos.z + normal.z);
                if(tryPlaceBlock(px, py, pz, heldItem)) return;
            }
        }

        // 2. 虚空搭路 (Raycast Stepping)
        else if (heldItem && inventory[heldItem] > 0) {
            const origin = camera.position.clone();
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);

            const step = 0.1;
            const maxDist = 5;
            const rayPos = origin.clone();

            for(let d=0; d<maxDist; d+=step) {
                rayPos.add(direction.clone().multiplyScalar(step));
                const rx = Math.round(rayPos.x);
                const ry = Math.round(rayPos.y);
                const rz = Math.round(rayPos.z);

                // 找空气
                if(!solidBlocks.has(`${rx},${ry},${rz}`)) {
                    // 检查邻居
                    if (solidBlocks.has(`${rx+1},${ry},${rz}`) || solidBlocks.has(`${rx-1},${ry},${rz}`) ||
                        solidBlocks.has(`${rx},${ry+1},${rz}`) || solidBlocks.has(`${rx},${ry-1},${rz}`) ||
                        solidBlocks.has(`${rx},${ry},${rz+1}`) || solidBlocks.has(`${rx},${ry},${rz-1}`)) {
                        if(tryPlaceBlock(rx, ry, rz, heldItem)) return;
                    }
                } else break; // 撞墙停止
            }
        }
    }

    // 左键挖掘
    else if(button === 0) {
        if(hits.length > 0 && hits[0].distance < 5) {
            const hit = hits[0];
            const m = hit.object;
            let targetPos = new THREE.Vector3();
            if(m.isInstancedMesh) {
                m.getMatrixAt(hit.instanceId, dum); dum.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
            } else targetPos.copy(m.position);

            let type = m.userData.type || 'unknown';
            if(type === 'chest') {
                if(m.isInstancedMesh) {
                    const info = m.userData.chests[hit.instanceId];
                    if(!info.open) openChest(m, hit.instanceId, targetPos);
                } else removeBlock(m, hit.instanceId, targetPos);
            } else removeBlock(m, hit.instanceId, targetPos);
            swingTime = 10;
        } else swingTime = 10;
    }
}

function openChest(mesh, instanceId, pos) {
    const info = mesh.userData.chests[instanceId];
    info.open = true;
    dum.scale(new THREE.Vector3(0,0,0)); mesh.setMatrixAt(instanceId, dum); mesh.instanceMatrix.needsUpdate=true;
    spawnChestAnimation(pos, mesh.parent || scene);

    let drops = [];
    if(pos.y > 60) {
        drops = ['diamond', 'god_sword', 'gold_apple'];
        showMessage(`发现天域宝藏！获得: 钻石, 神剑, 金苹果!`);
    } else {
        const possible = ['diamond','gold','apple','bed','planks'];
        const item = possible[Math.floor(Math.random()*possible.length)];
        drops = [item, item];
        showMessage(`你打开了箱子，发现了: ${item} x2`);
    }
    drops.forEach(item => addItem(item, 1));
}

function removeBlock(mesh, instanceId, pos) {
    if(mesh.isInstancedMesh) {
        mesh.getMatrixAt(instanceId, dum);
        dum.scale(new THREE.Vector3(0,0,0));
        mesh.setMatrixAt(instanceId, dum);
        mesh.instanceMatrix.needsUpdate=true;
        let t = mesh.userData.type;
        spawnParticles(pos, ITEMS[t]?ITEMS[t].col:'#fff');
        if(t!=='water' && t!=='cloud') addItem(t==='grass'?'dirt':t);
    } else {
        scene.remove(mesh);
        placedMeshes.splice(placedMeshes.indexOf(mesh), 1);
        spawnParticles(pos, ITEMS[mesh.userData.type]?ITEMS[mesh.userData.type].col:'#fff');
        addItem(mesh.userData.type);
    }
    solidBlocks.delete(`${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`);
}

function placeBlock(x, y, z, type) {
    let geom = geomMap[type] || geomMap['default'];
    const mat = mats[type] || mats.dirt;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.userData = { type: type };
    if(type!=='flower' && type!=='vine' && type!=='lilypad') {
        mesh.castShadow = true; mesh.receiveShadow = true;
    }
    scene.add(mesh);
    placedMeshes.push(mesh);
    if(type !== 'flower' && type !== 'vine' && type !== 'lilypad') solidBlocks.set(`${x},${y},${z}`, true);
}

window.addEventListener('mousedown', e => interact(e.button));

// --- 7. 特效 ---
function spawnParticles(pos, colorHex) {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    for(let i=0; i<5; i++) {
        const p = new THREE.Mesh(particleGeo, mat);
        p.position.copy(pos).addScalar((Math.random()-0.5)*0.8);
        p.userData = { vel: new THREE.Vector3((Math.random()-0.5)*0.2, Math.random()*0.2, (Math.random()-0.5)*0.2), life: 1.0 };
        scene.add(p); activeParticles.push(p);
    }
}
function spawnChestAnimation(pos, parent) {
    const g = new THREE.Group(); g.position.copy(pos);
    const m = mats.chest;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.6,0.8), m); b.position.y=0.3;
    const piv = new THREE.Group(); piv.position.set(0,0.6,-0.4);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.2,0.8), m); lidMesh.position.set(0,0.1,0.4);
    piv.add(lidMesh); g.add(b, piv); parent.add(g);
    activeChests.push({ mesh: g, lid: piv, opening: true, t: 0 });
}

// --- 8. UI & 背包 (初始1000) ---
const inventory = { 'dirt': 1000, 'wood': 1000 };
let selectedSlot = 0;
let isInventoryOpen = false;

function getSelectedItem() {
    const keys = Object.keys(inventory);
    if(selectedSlot < keys.length) return keys[selectedSlot];
    return null;
}

function updateUI() {
    const h = document.getElementById('hotbar'); if(h) h.innerHTML='';
    const keys = Object.keys(inventory);
    for(let i=0; i<5; i++) {
        const k = keys[i];
        const d=document.createElement('div'); d.className='slot' + (i===selectedSlot ? ' selected' : '');
        if(k) {
            const c=document.createElement('canvas'); c.width=32; c.height=32; const x=c.getContext('2d');
            x.fillStyle=ITEMS[k]?ITEMS[k].col:'#fff'; x.fillRect(4,4,24,24); x.strokeStyle='#000'; x.strokeRect(4,4,24,24);
            const img=document.createElement('img'); img.src=c.toDataURL();
            const n=document.createElement('span'); n.className='count'; n.innerText=inventory[k];
            d.append(img, n);
        }
        if(h) h.appendChild(d);
    }
    if(isInventoryOpen) {
        const g = document.getElementById('inventory-grid'); if(g) g.innerHTML='';
        keys.forEach((k, idx) => {
            const d=document.createElement('div'); d.className='slot';
            if (idx === selectedSlot) d.style.borderColor = '#FFFF00';
            const c=document.createElement('canvas'); c.width=32; c.height=32; const x=c.getContext('2d');
            x.fillStyle=ITEMS[k]?ITEMS[k].col:'#fff'; x.fillRect(4,4,24,24); x.strokeStyle='#000'; x.strokeRect(4,4,24,24);
            const img=document.createElement('img'); img.src=c.toDataURL();
            const n=document.createElement('span'); n.className='count'; n.innerText=inventory[k];
            d.onclick = () => { selectedSlot = idx; updateUI(); };
            d.append(img, n); if(g) g.appendChild(d);
        });
    }
}
function selectSlot(idx) { selectedSlot = idx; updateUI(); }
function addItem(t, n=1) { if(!ITEMS[t]) return; inventory[t]=(inventory[t]||0)+n; updateUI(); }
function toggleInventory() {
    isInventoryOpen = !isInventoryOpen;
    const m = document.getElementById('inventory-modal');
    if(isInventoryOpen) { document.exitPointerLock(); if(m) m.style.display='flex'; updateUI(); }
    else { if(m) m.style.display='none'; document.body.requestPointerLock(); }
}
updateUI();

// --- 9. 物理与循环 ---
let vy = 0; let jumping = false; const PLAYER_H = 1.1;
function isSolid(x,y,z) { return solidBlocks.has(`${Math.round(x)},${Math.round(y)},${Math.round(z)}`); }
function checkCol(nx, nz) {
    const y1 = Math.floor(player.position.y);
    const y2 = Math.floor(player.position.y + PLAYER_H*0.8);
    return isSolid(nx, y1, nz) || isSolid(nx, y2, nz);
}

function animate() {
    requestAnimationFrame(animate);

    for(let i=activeParticles.length-1; i>=0; i--) {
        const p = activeParticles[i];
        p.userData.life -= 0.02; p.position.add(p.userData.vel); p.userData.vel.y -= 0.01; p.scale.setScalar(p.userData.life);
        if(p.userData.life <= 0) { scene.remove(p); p.material.dispose(); activeParticles.splice(i, 1); }
    }
    for(let i=activeChests.length-1; i>=0; i--) {
        const c = activeChests[i];
        if(!c.mesh.parent) { activeChests.splice(i, 1); continue; }
        if(c.opening && c.t < 1) { c.t += 0.05; c.lid.rotation.x = THREE.MathUtils.lerp(0, -1.9, c.t); }
    }

    if(isInventoryOpen) return;

    const speed = 0.12;
    if(keys['ArrowLeft']) player.rotation.y += 0.04;
    if(keys['ArrowRight']) player.rotation.y -= 0.04;

    let dx=0, dz=0;
    if(keys['ArrowUp']||keys['KeyW']) { dx -= Math.sin(player.rotation.y)*speed; dz -= Math.cos(player.rotation.y)*speed; }
    if(keys['ArrowDown']||keys['KeyS']) { dx += Math.sin(player.rotation.y)*speed; dz += Math.cos(player.rotation.y)*speed; }
    if(keys['KeyA']) { dx -= Math.cos(player.rotation.y)*speed; dz += Math.sin(player.rotation.y)*speed; }
    if(keys['KeyD']) { dx += Math.cos(player.rotation.y)*speed; dz -= Math.sin(player.rotation.y)*speed; }

    // 物理移动
    let nextX = player.position.x + dx;
    if (checkCol(nextX, player.position.z)) {
        if (isSolid(nextX, Math.floor(player.position.y), player.position.z) &&
           !isSolid(nextX, Math.floor(player.position.y)+1, player.position.z) &&
           !isSolid(player.position.x, Math.floor(player.position.y)+2, player.position.z)) {
            player.position.y += 1.0; player.position.x = nextX;
        }
    } else player.position.x = nextX;

    let nextZ = player.position.z + dz;
    if (checkCol(player.position.x, nextZ)) {
        if (isSolid(player.position.x, Math.floor(player.position.y), nextZ) &&
           !isSolid(player.position.x, Math.floor(player.position.y)+1, nextZ) &&
           !isSolid(player.position.x, Math.floor(player.position.y)+2, player.position.z)) {
            player.position.y += 1.0; player.position.z = nextZ;
        }
    } else player.position.z = nextZ;

    let gy = -100;
    const px=Math.round(player.position.x), pz=Math.round(player.position.z), py=Math.floor(player.position.y);

    for(let k=0;k<=4;k++) if(isSolid(px,py-k,pz)) { gy=py-k+1; break; }
    if(gy===-100) gy=Math.floor(noise(px,pz)*0.5)+1;

    player.position.y += vy;
    if(player.position.y < gy) { player.position.y = gy; vy = 0; jumping = false; } else vy -= 0.015;
    if(keys['Space'] && !jumping) { vy = 0.22; jumping = true; }
    if(player.position.y < -20) { player.position.y = 60; camera.position.y = 61; }

    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, player.position.y + 1.0, 0.25);
    camera.rotation.y = player.rotation.y; camera.rotation.x = cameraPitch;

    if(swingTime > 0) {
        armR.visible = true;
        armR.rotation.x = -Math.PI/2 + Math.sin(swingTime*0.3);
        swingTime--;
    } else { armR.visible = false; }

    light.position.set(player.position.x+20, player.position.y+40, player.position.z+20);
    light.target.position.copy(player.position); light.target.updateMatrixWorld();

    const cx=Math.floor(player.position.x/CHUNK_SIZE), cz=Math.floor(player.position.z/CHUNK_SIZE);
    for(let i=-RENDER_DIST;i<=RENDER_DIST;i++) for(let j=-RENDER_DIST;j<=RENDER_DIST;j++) {
        const k=`${cx+i},${cz+j}`; if(!chunks.has(k)) chunks.set(k, new Chunk(cx+i,cz+j));
    }
    for(const [k,c] of chunks) if(Math.abs(c.cx-cx)>RENDER_DIST+1 || Math.abs(c.cz-cz)>RENDER_DIST+1) { c.dispose(); chunks.delete(k); }

    renderer.render(scene, camera);
}

animate();
window.addEventListener('resize', () => {
    camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
});
