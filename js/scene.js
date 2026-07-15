// ============ 三维场景引擎 ============
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = '060212-optimized.glb';

// 暴露给非模块脚本的全局接口
const TwinScene = {
  ready: false,
  hotspots: [],
  setView,
  toggleAutoRotate,
  toggleHotspots,
  resetView,
  focusHotspot,
  focusZone,
};
window.TwinScene = TwinScene;

let renderer, scene, camera, controls, container;
let modelRoot, modelCenter = new THREE.Vector3(), modelRadius = 100;
let groundY = 0;          // 设备核心区底面(含深入地下的基础/管线)
let groundTopY = 0;       // 模型自带地面的可见顶面(巡检路线/网格贴在此高度)
let coreSpanX = 100, coreSpanZ = 100, coreHeight = 50;
let autoRotate = true;
let hotspotsVisible = true;
let flyAnim = null;
let _lastFrame = performance.now();   // 上一帧时间戳(供 animate 计算 dt)
const hotspotLayer = document.getElementById('hotspot-layer');
const tmpV = new THREE.Vector3();
const compassPointer = document.getElementById('compass-pointer');

// ── 巡检路线相关状态(必须在 animate() 调用之前声明,否则首帧 updatePatrol 会触发 TDZ)──
let patrolCurve = null, patrolGroup = null;
let patrolRoad = null, patrolChevrons = [], patrolPoles = [];
let patrolBot = null, patrolHalo = null, patrolBeacon = null;
let patrolActive = false, patrolT = 0, patrolFlow = 0;
const patrolBotEl = document.getElementById('patrol-bot-label');
const _tan = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0,1,0);

// 视角预设。dir = 相机相对中心的方向(归一化前),y 分量决定俯角;dist = 距离系数 × modelRadius。
// overview 模拟航拍斜俯视(约 30° 俯角),能看清设备又纵览全厂;patrol 更低更近,贴近地面巡视。
const VIEWS = {
  overview: { dir:[0.55, 0.62, 0.95], dist:2.0 },
  patrol:   { dir:[0.85, 0.40, 0.75], dist:1.3 },
};

initThree();
loadModel();
animate();

function initThree(){
  container = document.getElementById('scene-container');
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));   // 用设备真实像素比,避免发虚
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07101f, 0.0); // 加载后按尺度设置

  // 环境贴图:给金属设备(储罐/管道)真实反光,提升质感与清晰度
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 5e6);
  camera.position.set(200, 200, 300);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI * 0.495; // 不穿透地面
  controls.addEventListener('start', ()=>{ autoRotate = false; syncRotateBtn(); });

  // 灯光
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a1424, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6fa8ff, 0.6);
  fill.position.set(-1, 0.6, -1);
  scene.add(fill);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function loadModel(){
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('./libs/jsm/loaders/');
  loader.setDRACOLoader(dracoLoader);
  const tip = document.getElementById('loading-tip');
  tip.textContent = '正在加载三维模型数据…';
  loader.load(MODEL_URL,
    (gltf)=>{
     try{
      modelRoot = gltf.scene;

      // —— 厂区主体识别 ——
      // 模型含天空球(又大又高)和多块大地面/水面(又大又扁),
      // 真正的厂区设备高度密集地聚集在一个约 1073×949 的小区域。
      // 策略:① 只隐藏「又大又高」的天空球(保留扁平大地面,否则设备会悬空);
      //       ② 用设备网格中心的 XZ 分位锁定密集区作为相机焦点。
      const meshInfos = [];
      const _b = new THREE.Box3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
      modelRoot.updateWorldMatrix(true, true);
      modelRoot.traverse(o=>{
        if(!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        _b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        _b.getCenter(_c); _b.getSize(_s);
        meshInfos.push({ obj:o, cx:_c.x, cy:_c.y, cz:_c.z,
          minY:_b.min.y, maxY:_b.max.y,
          sizeX:_s.x, sizeY:_s.y, sizeZ:_s.z,
          spanXZ:Math.max(_s.x,_s.z),                 // 水平跨度
          size:Math.max(_s.x,_s.y,_s.z) });
      });

      // ① 只隐藏「又大又高」的环境壳(天空球/穹顶):水平跨度大 且 高度也大。
      //    扁平的大网格(地面/水面/地坪)保留下来 —— 这是设备真正"踩"着的地面。
      const SHELL_SPAN = 6000;     // 水平跨度阈值
      const SHELL_TALL = 3000;     // 高度阈值:超过才算穹顶
      let hidden = 0;
      meshInfos.forEach(m=>{
        if(m.spanXZ > SHELL_SPAN && m.sizeY > SHELL_TALL){ m.obj.visible = false; hidden++; }
      });

      // 用于密集区计算的"设备网格":排除已隐藏的壳 + 排除超大扁平地面(避免地面把焦点带偏)
      const FLAT_GROUND = 3000;    // 水平跨度超过此值且很薄 → 视为地面,不参与密集区
      const dev = meshInfos.filter(m=> m.obj.visible &&
        !(m.spanXZ > FLAT_GROUND && m.sizeY < m.spanXZ*0.06));
      const pct = (arr,q)=>{ const s=arr.slice().sort((a,b)=>a-b); return s[Math.floor(q*(s.length-1))]||0; };
      const xs=dev.map(m=>m.cx), zs=dev.map(m=>m.cz);
      const x10=pct(xs,0.08), x90=pct(xs,0.92), z10=pct(zs,0.08), z90=pct(zs,0.92);

      // 用密集区内网格的真实包围盒确定焦点与尺度
      const coreBox = new THREE.Box3();
      dev.forEach(m=>{
        if(m.cx>=x10 && m.cx<=x90 && m.cz>=z10 && m.cz<=z90){
          _b.copy(m.obj.geometry.boundingBox).applyMatrix4(m.obj.matrixWorld);
          coreBox.union(_b);
        }
      });
      if(coreBox.isEmpty()) coreBox.setFromObject(modelRoot);
      coreBox.getCenter(modelCenter);
      coreBox.getSize(_s);
      groundY = coreBox.min.y;
      coreSpanX = _s.x; coreSpanZ = _s.z; coreHeight = _s.y;
      // 半径以水平跨度为准(厂区扁平,不让矮高度影响取景)
      modelRadius = Math.max(_s.x, _s.z) * 0.5 || 100;

      // —— 确定地面可见顶面 ——
      // 巡检路线、参考网格应贴在模型自带地面的"上表面",而不是设备最低点(常深入地下)。
      // 找覆盖核心区中心、面积大且较薄的网格,取其顶面 maxY;找不到则退回核心区底面。
      groundTopY = groundY;
      let bestArea = 0;
      meshInfos.forEach(m=>{
        if(!m.obj.visible) return;
        const flat = m.sizeY < m.spanXZ*0.08;            // 扁平
        const coversCenter = Math.abs(m.cx-modelCenter.x) < m.sizeX*0.5 + coreSpanX*0.2 &&
                             Math.abs(m.cz-modelCenter.z) < m.sizeZ*0.5 + coreSpanZ*0.2;
        const big = m.spanXZ > coreSpanX*0.8;            // 至少和核心区一样大
        if(flat && big && coversCenter){
          const area = m.sizeX * m.sizeZ;
          if(area > bestArea){ bestArea = area; groundTopY = m.maxY; }
        }
      });

      console.log('[Twin] 厂区设备核心区 尺寸', _s.toArray().map(v=>v.toFixed(0)),
                  '中心', modelCenter.toArray().map(v=>v.toFixed(0)),
                  '| 半径', modelRadius.toFixed(0), '| 已隐藏穹顶', hidden, '个',
                  '| 地面顶面 y≈', groundTopY.toFixed(1));

      // —— 治标:给"扁平大地面"换上深灰沥青材质 ——
      // 模型里这几块地面要么无材质(glTF 默认纯白),要么是纯白 VRay 材质,看起来惨白。
      // 不改模型文件,直接在加载后把它们的材质替换成深灰路面材质。
      const groundMat = new THREE.MeshStandardMaterial({
        color:0x2b3647, roughness:0.94, metalness:0.0, envMapIntensity:0.5 });
      let groundFixed = 0;
      meshInfos.forEach(m=>{
        if(!m.obj.visible) return;
        const flat = m.sizeY < m.spanXZ*0.06;            // 很薄
        const big  = m.spanXZ > coreSpanX*0.8;           // 至少和核心区一样大
        if(flat && big){ m.obj.material = groundMat; groundFixed++; }
      });
      if(groundFixed) console.log('[Twin] 已替换地面材质(深灰):', groundFixed, '块');

      // 提升材质观感(跳过刚替换的地面材质,保持其哑光深灰)
      modelRoot.traverse(o=>{
        if(o.isMesh){
          o.frustumCulled = true;
          if(o.material && o.material !== groundMat){
            const mats = Array.isArray(o.material)?o.material:[o.material];
            mats.forEach(m=>{
              if('metalness' in m) m.metalness = Math.min(m.metalness ?? 0.4, 0.6);
              if('roughness' in m) m.roughness = Math.max(m.roughness ?? 0.6, 0.5);
              m.envMapIntensity = 0.8;
            });
          }
        }
      });
      scene.add(modelRoot);

      // 地面网格(以模型为中心)
      addGround();

      // 雾:极淡,仅给远景一点空气感,避免糊化设备细节
      scene.fog.density = 0.35 / (modelRadius * 30);

      // 相机限制(允许拉近看设备细节,也能拉远纵览)
      controls.target.set(modelCenter.x, groundY + coreHeight*0.25, modelCenter.z);
      controls.minDistance = modelRadius * 0.15;
      controls.maxDistance = modelRadius * 6;
      controls.maxPolarAngle = Math.PI * 0.49;   // 不穿地
      // 裁剪面自适应:近裁剪面要足够小以保留细节
      camera.near = Math.max(0.1, modelRadius * 0.003);
      camera.far = modelRadius * 40;
      camera.updateProjectionMatrix();

      buildHotspots();
      buildPatrolRoute();
      setView('overview', true);
      autoRotate = true; syncRotateBtn(); // 初始默认自动旋转

      TwinScene.ready = true;
      finishLoading();
     }catch(e){
      // 模型已成功解析,但场景初始化代码出错 —— 单独区分,打印真实堆栈
      console.error('[Twin] 场景初始化失败:', e);
      const tipEl = document.getElementById('loading-tip');
      if(tipEl) tipEl.textContent = '场景初始化失败:' + (e && e.message ? e.message : e);
     }
    },
    (xhr)=>{
      if(xhr.lengthComputable){
        const pct = Math.min(99, Math.round(xhr.loaded/xhr.total*100));
        setProgress(pct);
      }else{
        // 无 content-length 时按已加载字节估算(总量约 294MB)
        const pct = Math.min(99, Math.round(xhr.loaded/308366796*100));
        setProgress(pct);
      }
    },
    (err)=>{
      console.error('[Twin] 模型加载/解析失败:', err);
      const tipEl = document.getElementById('loading-tip');
      if(tipEl) tipEl.textContent = '模型加载失败:' + (err && err.message ? err.message : '请检查文件或刷新重试');
    }
  );
}

function addGround(){
  const floorY = groundTopY;          // 贴在模型自带地面的可见顶面
  const span = modelRadius * 2.6;     // 网格覆盖范围,略大于厂区
  const grid = new THREE.GridHelper(span, 48, 0x1f6fb0, 0x0d3a63);
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  grid.material.depthWrite = false;   // 网格不写深度,避免与真实地面 z-fighting
  grid.position.set(modelCenter.x, floorY + 0.4, modelCenter.z);
  scene.add(grid);

  // 中心光圈地面
  const ringGeo = new THREE.RingGeometry(span*0.02, span*0.52, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color:0x21d4fd, transparent:true, opacity:0.05, side:THREE.DoubleSide, depthWrite:false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI/2;
  ring.position.set(modelCenter.x, floorY + 0.6, modelCenter.z);
  scene.add(ring);
}

// 设置进度(导出给 main 使用)
function setProgress(pct){
  const bar = document.getElementById('loading-bar-inner');
  const txt = document.getElementById('loading-pct');
  if(bar) bar.style.width = pct + '%';
  if(txt) txt.textContent = pct;
}

function finishLoading(){
  setProgress(100);
  const mask = document.getElementById('loading-mask');
  setTimeout(()=>{ mask.classList.add('hide'); }, 450);
  // 通知 main 启动数据刷新
  window.dispatchEvent(new CustomEvent('twin-ready'));
}

// ============ 热点 ============
function buildHotspots(){
  // 厂区为扁平布局:热点在 XZ 平面按比例散布,高度贴近地面略微抬升。
  const defs = (window.HOTSPOT_DEFS || []);
  const lift = Math.max(coreHeight * 0.6, modelRadius * 0.04); // 标记抬升高度
  TwinScene.hotspots = defs.map(def=>{
    const pos = new THREE.Vector3(
      modelCenter.x + def.rx * coreSpanX * 0.5,
      groundY + lift + (def.ry||0) * coreHeight,
      modelCenter.z + def.rz * coreSpanZ * 0.5
    );
    const el = document.createElement('div');
    el.className = 'hotspot t-' + def.type + (def.alarm ? ' alarm' : '');
    el.innerHTML = `<div class="hs-pin">
        <div class="hs-label">${def.name}<b>${def.value||''}</b></div>
        <div class="hs-dot"></div><div class="hs-ripple"></div>
      </div>`;
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      el.classList.add('clicking');
      setTimeout(()=> el.classList.remove('clicking'), 600);
      window.dispatchEvent(new CustomEvent('hotspot-click', { detail:{ def, screenX:e.clientX, screenY:e.clientY } }));
      focusHotspot(def.id);
    });
    hotspotLayer.appendChild(el);
    return { def, pos, el };
  });
}

// ============ 巡检路线 ============
// 沿厂区主干道定义一条环形巡检路线(相对中心比例 rx,rz),贴地生成"道路带"+
// 流动方向箭头 + 沿路行驶的巡检机器人,尽量贴近真实巡检场景。
// 注:相关状态变量已在文件顶部声明(避免首帧 updatePatrol 触发 TDZ)。

// 环形主干道路点:沿厂区外围一圈(圆角矩形),贴合道路走向。
const PATROL_WAYPOINTS = [
  { rx:-0.46, rz:-0.40 },
  { rx: 0.00, rz:-0.46 },
  { rx: 0.46, rz:-0.40 },
  { rx: 0.52, rz: 0.00 },
  { rx: 0.46, rz: 0.40 },
  { rx: 0.00, rz: 0.46 },
  { rx:-0.46, rz: 0.40 },
  { rx:-0.52, rz: 0.00 },
];

function patrolY(){ return groundTopY + Math.max(modelRadius*0.006, 1.0); }

function buildPatrolRoute(){
  patrolGroup = new THREE.Group();
  const y = patrolY();
  const pts = PATROL_WAYPOINTS.map(w=> new THREE.Vector3(
    modelCenter.x + w.rx * coreSpanX,
    y,
    modelCenter.z + w.rz * coreSpanZ
  ));
  patrolCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

  // —— 贴地道路带(扁平 ribbon,而非悬空发光管)——
  const N = 360;
  const halfW = Math.max(modelRadius*0.018, 6);
  const pos = [], idx = [];
  for(let i=0;i<=N;i++){
    const t = i/N;
    const p = patrolCurve.getPointAt(t);
    patrolCurve.getTangentAt(t, _tan); _tan.y = 0; _tan.normalize();
    _side.crossVectors(_up, _tan).normalize().multiplyScalar(halfW);
    pos.push(p.x - _side.x, y, p.z - _side.z);
    pos.push(p.x + _side.x, y, p.z + _side.z);
    if(i<N){ const a=i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx);
  const roadMat = new THREE.MeshBasicMaterial({ color:0x0e3f63, transparent:true, opacity:0.55,
    side:THREE.DoubleSide, depthWrite:false });
  patrolRoad = new THREE.Mesh(geo, roadMat);
  patrolGroup.add(patrolRoad);

  // 道路两侧发光边线
  const edgeL=[], edgeR=[];
  for(let i=0;i<=N;i++){ const k=i*6; edgeL.push(pos[k],pos[k+1]+0.3,pos[k+2]); edgeR.push(pos[k+3],pos[k+4]+0.3,pos[k+5]); }
  const mkEdge = arr=>{ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color:0x21d4fd, transparent:true, opacity:0.7 })); };
  patrolGroup.add(mkEdge(edgeL)); patrolGroup.add(mkEdge(edgeR));

  // —— 流动方向箭头(沿路均匀分布,逐帧前移,清晰表达巡检方向)——
  const chevCount = 28;
  const chevW = halfW*0.7, chevLen = halfW*1.1;
  const chevShape = new THREE.Shape();
  chevShape.moveTo(0, chevLen*0.6); chevShape.lineTo(-chevW, -chevLen*0.4);
  chevShape.lineTo(0, -chevLen*0.05); chevShape.lineTo(chevW, -chevLen*0.4); chevShape.closePath();
  const chevGeo = new THREE.ShapeGeometry(chevShape);
  chevGeo.rotateX(Math.PI/2);   // 平铺在地面,箭头尖端朝行进方向(局部 +Z)
  for(let i=0;i<chevCount;i++){
    const m = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color:0x7fe9ff, transparent:true, opacity:0.85,
      side:THREE.DoubleSide, depthWrite:false }));
    patrolChevrons.push(m); patrolGroup.add(m);
  }

  // 路点标桩(贴地小立柱 + 顶灯)
  patrolPoles = pts.map((p)=>{
    const g = new THREE.Group();
    const poleH = Math.max(coreHeight*0.12, modelRadius*0.03);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(modelRadius*0.0035, modelRadius*0.0045, poleH, 10),
      new THREE.MeshBasicMaterial({ color:0x2ee6a6, transparent:true, opacity:0.55 }));
    pole.position.set(p.x, y + poleH*0.5, p.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(modelRadius*0.006, 12, 12),
      new THREE.MeshBasicMaterial({ color:0x2ee6a6 }));
    cap.position.set(p.x, y + poleH, p.z);
    g.add(pole); g.add(cap);
    patrolGroup.add(g);
    return g;
  });

  // —— 巡检机器人(贴地行驶,朝向行进方向)——
  const botR = Math.max(modelRadius*0.011, 2.2);
  patrolBot = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(botR, 18, 18),
    new THREE.MeshBasicMaterial({ color:0xffcc33 }));
  body.position.y = botR;
  patrolHalo = new THREE.Mesh(new THREE.RingGeometry(botR*1.7, botR*2.4, 28),
    new THREE.MeshBasicMaterial({ color:0xffcc33, transparent:true, opacity:0.5, side:THREE.DoubleSide, depthWrite:false }));
  patrolHalo.rotation.x = -Math.PI/2; patrolHalo.position.y = 0.5;
  // 向上的探照光柱,提升存在感
  patrolBeacon = new THREE.Mesh(
    new THREE.ConeGeometry(botR*1.3, botR*6, 16, 1, true),
    new THREE.MeshBasicMaterial({ color:0xffe08a, transparent:true, opacity:0.18, side:THREE.DoubleSide, depthWrite:false }));
  patrolBeacon.position.y = botR*3 + botR;
  patrolBot.add(body); patrolBot.add(patrolHalo); patrolBot.add(patrolBeacon);
  patrolGroup.add(patrolBot);

  patrolGroup.visible = false;
  scene.add(patrolGroup);
}

function showPatrolRoute(show){
  if(!patrolGroup) return;
  patrolActive = show;
  patrolGroup.visible = show;
  if(patrolBotEl) patrolBotEl.style.display = show ? 'block' : 'none';
}

function updatePatrol(dt){
  if(!patrolActive || !patrolCurve || !patrolBot) return;
  const y = patrolY();

  // 机器人沿路行驶并朝向前进方向
  patrolT = (patrolT + dt * 0.03) % 1;
  const pos = patrolCurve.getPointAt(patrolT);
  patrolBot.position.set(pos.x, y, pos.z);
  patrolCurve.getTangentAt(patrolT, _tan); _tan.y = 0;
  if(_tan.lengthSq() > 1e-6){
    patrolBot.rotation.y = Math.atan2(_tan.x, _tan.z);
  }
  // 光环呼吸
  patrolFlow = (patrolFlow + dt) % 1000;
  if(patrolHalo){ const s = 1 + Math.sin(patrolFlow*4)*0.12; patrolHalo.scale.set(s,s,1); }

  // 方向箭头流动:沿曲线匀速前移
  if(patrolChevrons.length){
    const n = patrolChevrons.length;
    const base = (patrolFlow*0.06) % 1;
    for(let i=0;i<n;i++){
      const t = (base + i/n) % 1;
      const p = patrolCurve.getPointAt(t);
      patrolCurve.getTangentAt(t, _tan); _tan.y = 0; _tan.normalize();
      const m = patrolChevrons[i];
      m.position.set(p.x, y + 0.5, p.z);
      m.rotation.y = Math.atan2(_tan.x, _tan.z);
      // 越靠近机器人前方越亮,形成"流向"感
      let d = (t - patrolT + 1) % 1;
      m.material.opacity = 0.25 + 0.6 * (1 - d);
    }
  }

  // 机器人屏幕标签
  if(patrolBotEl && hotspotsVisible){
    tmpV.set(pos.x, y + coreHeight*0.25, pos.z); tmpV.project(camera);
    if(tmpV.z < 1){
      patrolBotEl.style.display='block';
      patrolBotEl.style.left = (tmpV.x*0.5+0.5)*window.innerWidth + 'px';
      patrolBotEl.style.top = (-tmpV.y*0.5+0.5)*window.innerHeight + 'px';
    }else patrolBotEl.style.display='none';
  }
}


const HS_PRIORITY = { alarm:5, sensor:4, camera:3, tank:2, fire:1 };
function updateHotspots(){
  if(!TwinScene.ready) return;
  const w = window.innerWidth, h = window.innerHeight;
  const visible = [];
  for(const hs of TwinScene.hotspots){
    tmpV.copy(hs.pos).project(camera);
    const behind = tmpV.z > 1;
    if(behind || !hotspotsVisible){ hs.el.style.display='none'; continue; }
    const x = Math.round((tmpV.x*0.5+0.5)*w);
    const y = Math.round((-tmpV.y*0.5+0.5)*h);
    const d = camera.position.distanceTo(hs.pos);
    const opacity = Math.max(0.35, Math.min(1, modelRadius*3/d));
    const type = hs.def.type;
    const priority = hs.def.alarm ? HS_PRIORITY.alarm : (HS_PRIORITY[type] || 2);
    let pw = hs._cachedW || 120;
    let ph = hs._cachedH || 40;
    if(!hs._cachedW){
      const lb = hs.el.querySelector('.hs-label');
      if(lb){
        const ww = lb.offsetWidth;
        const hh = lb.offsetHeight;
        if(ww > 0){
          hs._cachedW = ww + 20;
          hs._cachedH = hh + 24;
          pw = hs._cachedW;
          ph = hs._cachedH;
        }
      }
    }
    visible.push({ hs, x, y, d, opacity, priority, pw, ph });
  }
  visible.sort((a,b) => b.priority - a.priority || a.d - b.d);
  const placed = [];
  for(const item of visible){
    const el = item.hs.el;
    const pw = item.pw, ph = item.ph;
    let overlapped = false;
    for(const p of placed){
      if(Math.abs(item.x - p.x) < (pw + p.w) * 0.5 && Math.abs(item.y - p.y) < (ph + p.h) * 0.5){
        overlapped = true;
        break;
      }
    }
    if(overlapped){
      if(el.style.display !== 'none'){
        el.style.display = 'none';
      }
    }else{
      el.style.display = 'block';
      el.style.left = item.x + 'px';
      el.style.top = item.y + 'px';
      el.style.opacity = item.opacity;
      placed.push({ x:item.x, y:item.y, w:pw, h:ph });
    }
  }
}

// ============ 交互 API ============
function setView(name, instant){
  const v = VIEWS[name] || VIEWS.overview;
  const dir = new THREE.Vector3(...v.dir).normalize();
  const dist = modelRadius * v.dist;
  // 切换到巡检路线视角时显示路径,其余视角隐藏
  showPatrolRoute(name === 'patrol');
  // 视点对准厂区地面略上方(设备集中高度),避免被高塔抬高视线
  const focus = new THREE.Vector3(modelCenter.x, groundY + coreHeight*0.25, modelCenter.z);
  const target = focus.clone().add(dir.multiplyScalar(dist));
  flyTo(target, focus, instant);
}

function focusHotspot(id){
  const hs = TwinScene.hotspots.find(h=>h.def.id===id);
  if(!hs) return;
  const dir = new THREE.Vector3().subVectors(camera.position, hs.pos).normalize();
  const target = hs.pos.clone().add(dir.multiplyScalar(modelRadius*0.6));
  flyTo(target, hs.pos, false);
}

function flyTo(camTarget, lookTarget, instant){
  autoRotate = false; syncRotateBtn();
  if(instant){
    camera.position.copy(camTarget);
    controls.target.copy(lookTarget);
    controls.update();
    return;
  }
  const start = performance.now(), dur = 1100;
  const cp0 = camera.position.clone(), tp0 = controls.target.clone();
  flyAnim = (now)=>{
    let t = Math.min(1,(now-start)/dur);
    const e = t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2; // easeInOutQuad
    camera.position.lerpVectors(cp0, camTarget, e);
    controls.target.lerpVectors(tp0, lookTarget, e);
    controls.update();
    if(t>=1) flyAnim=null;
  };
}

function resetView(){ autoRotate=true; syncRotateBtn(); setView('overview', false); }
function toggleAutoRotate(){ autoRotate = !autoRotate; syncRotateBtn(); return autoRotate; }
function toggleHotspots(){ hotspotsVisible = !hotspotsVisible; return hotspotsVisible; }
function syncRotateBtn(){ window.dispatchEvent(new CustomEvent('autorotate-change',{detail:autoRotate})); }
function focusZone(zone){
  const zoneOffsets = {
    '原料罐区': [-0.4, 0.15, -0.3],
    '反应装置区': [0.2, 0.2, 0.1],
    '成品罐区': [0.4, 0.12, -0.35],
    '公用工程区': [-0.3, 0.1, 0.4],
    '装卸车区': [0.5, 0.08, 0.3],
    '污水处理区': [-0.5, 0.06, -0.45],
  };
  const offset = zoneOffsets[zone];
  if(offset){
    const camTarget = new THREE.Vector3(
      modelCenter.x + offset[0] * 40,
      modelCenter.y + offset[1] * 60 + 15,
      modelCenter.z + offset[2] * 40
    );
    const lookTarget = new THREE.Vector3(
      modelCenter.x + offset[0] * 20,
      modelCenter.y + 2,
      modelCenter.z + offset[2] * 20
    );
    const start = performance.now(), dur = 1100;
    const cp0 = camera.position.clone(), tp0 = controls.target.clone();
    flyAnim = (now)=>{
      let t = Math.min(1,(now-start)/dur);
      const e = t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
      camera.position.lerpVectors(cp0, camTarget, e);
      controls.target.lerpVectors(tp0, lookTarget, e);
      controls.update();
      if(t>=1) flyAnim=null;
    };
  }
}

function onPointerDown(){ /* 由 OrbitControls 处理;此处保留以便未来拾取 */ }

function onResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(){
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - _lastFrame) / 1000);  // 秒,限幅防卡顿跳变
  _lastFrame = now;
  if(flyAnim) flyAnim(now);
  if(autoRotate && TwinScene.ready && !flyAnim){
    // 绕厂区焦点缓慢旋转(保持当前俯角与距离)
    const a = 0.0012;
    const fy = groundY + coreHeight*0.25;
    const dx = camera.position.x - modelCenter.x;
    const dz = camera.position.z - modelCenter.z;
    camera.position.x = modelCenter.x + dx*Math.cos(a) - dz*Math.sin(a);
    camera.position.z = modelCenter.z + dx*Math.sin(a) + dz*Math.cos(a);
    controls.target.set(modelCenter.x, fy, modelCenter.z);
  }
  controls.update();
  updatePatrol(dt);
  renderer.render(scene, camera);
  updateHotspots();
  updateCompass();
}

function updateCompass(){
  if(!compassPointer || !TwinScene.ready) return;
  const dx = camera.position.x - modelCenter.x;
  const dz = camera.position.z - modelCenter.z;
  const angle = Math.atan2(dx, dz);
  compassPointer.style.transform = 'rotate(' + angle + 'rad)';
}
