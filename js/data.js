// ============ 数据层:热点定义 + 模拟数据引擎 ============
// 热点坐标用相对模型中心的比例 (rx,ry,rz),由 scene.js 换算为真实坐标。
// 注:模型为通用命名网格,无语义标签,故巡检点按厂区典型分区布置。
// 初始数据从共享存储(store.js)读取 —— 数据管理后台修改后即可在大屏生效。
const TWIN_CFG = (window.TwinStore ? window.TwinStore.load() : null) || {};
window.HOTSPOT_DEFS = TWIN_CFG.hotspots || [
  { id:'CAM-01', type:'camera', name:'1号门禁监控', value:'在线' },
  { id:'CAM-02', type:'camera', name:'罐区周界监控', value:'在线' },
  { id:'CAM-03', type:'camera', name:'装置区监控', value:'在线' },
  { id:'GAS-01', type:'sensor', name:'H₂S 气体探测', value:'2ppm' },
  { id:'GAS-02', type:'sensor', name:'可燃气探测器', value:'0.3%LEL' },
  { id:'GAS-03', type:'sensor', name:'CO 气体探测', value:'8ppm', alarm:true },
  { id:'TANK-01', type:'tank', name:'1#原料储罐', value:'78%' },
  { id:'TANK-02', type:'tank', name:'2#成品储罐', value:'62%' },
  { id:'FIRE-01', type:'fire', name:'消防泵站', value:'就绪' },
  { id:'FIRE-02', type:'fire', name:'泡沫灭火站', value:'就绪' },
];

// 给每个热点分配空间位置(相对比例),分散在厂区不同方位与高度
(function placeHotspots(){
  const ring = [
    [-0.55, 0.10,  0.45], [0.50, 0.12, -0.40], [0.10, 0.18, 0.60],
    [-0.40, 0.22, -0.50], [0.62, 0.08, 0.20], [-0.20, 0.30, -0.15],
    [0.30, 0.06, 0.35], [-0.62, 0.14, -0.10], [0.45, 0.20, 0.55], [-0.10, 0.10, -0.62],
  ];
  window.HOTSPOT_DEFS.forEach((d,i)=>{ const p=ring[i%ring.length]; d.rx=p[0]; d.ry=p[1]; d.rz=p[2]; });
})();

// 设备详情元数据(弹窗用)
window.DEVICE_META = {
  camera: { unit:'', rows:['分辨率','码流','在线时长'], label:'视频监控' },
  sensor: { unit:'', rows:['量程','报警阈值','响应时间'], label:'气体探测器' },
  tank:   { unit:'', rows:['容积','介质','温度'], label:'储罐液位' },
  fire:   { unit:'', rows:['压力','流量','检修日期'], label:'消防设施' },
};

// ============ 实时模拟数据引擎 ============
window.TwinData = (function(){
  const rnd = (a,b)=> a + Math.random()*(b-a);
  const ri = (a,b)=> Math.floor(rnd(a,b+1));
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];

  const ZONES = ['原料罐区','反应装置区','成品罐区','公用工程区','装卸车区','污水处理区'];
  const ALARM_TYPES = [
    { t:'可燃气体浓度超限', lv:'high', icon:'🔥' },
    { t:'H₂S 浓度异常', lv:'high', icon:'☣' },
    { t:'储罐液位偏高', lv:'mid', icon:'🛢' },
    { t:'设备温度过高', lv:'mid', icon:'🌡' },
    { t:'巡检人员越界', lv:'mid', icon:'🚷' },
    { t:'摄像头离线', lv:'low', icon:'📷' },
    { t:'消防水压偏低', lv:'low', icon:'💧' },
    { t:'未佩戴安全帽', lv:'low', icon:'⛑' },
  ];
  const PATROL_TASKS = (TWIN_CFG.patrols && TWIN_CFG.patrols.length) ? TWIN_CFG.patrols : [
    { name:'罐区日常安全巡检', zone:'原料罐区' },
    { name:'反应装置点检', zone:'反应装置区' },
    { name:'消防设施巡查', zone:'公用工程区' },
    { name:'装卸区作业监护', zone:'装卸车区' },
  ];

  // 状态(初始值取自共享存储,后台可配置)
  const state = {
    kpi: Object.assign({ safeDays:328, online:96.8, riskScore:92, patrolDone:18 }, TWIN_CFG.kpi||{}),
    center: Object.assign({ devices:248, robots:6, cameras:42, sensors:86 }, TWIN_CFG.center||{}),
    gas: { time:[], h2s:[], lel:[], co:[] },
    alarms: [],
    patrols: [],
    trend: { days:[], counts:[] },
    risk: TWIN_CFG.risk || [
      { name:'重大风险', value:1 },
      { name:'较大风险', value:3 },
      { name:'一般风险', value:8 },
      { name:'低风险', value:21 },
    ],
    deviceStatus: TWIN_CFG.deviceStatus || [
      { name:'在线', value:236 },
      { name:'告警', value:5 },
      { name:'离线', value:7 },
    ],
  };

  function pad(n){ return n<10?'0'+n:''+n; }
  function nowHM(){ const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }

  // 初始化气体曲线(近 20 个点)
  (function initGas(){
    for(let i=19;i>=0;i--){
      const d=new Date(Date.now()-i*3000);
      state.gas.time.push(pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()));
      state.gas.h2s.push(+rnd(0,5).toFixed(1));
      state.gas.lel.push(+rnd(0,8).toFixed(1));
      state.gas.co.push(+rnd(2,15).toFixed(1));
    }
  })();

  // 初始化趋势(近 7 天)
  (function initTrend(){
    for(let i=6;i>=0;i--){
      const d=new Date(Date.now()-i*86400000);
      state.trend.days.push((d.getMonth()+1)+'/'+d.getDate());
      state.trend.counts.push(ri(3,18));
    }
  })();

  // 初始化告警
  let alarmSeq = 1000;
  function genAlarm(ageSec){
    const a = pick(ALARM_TYPES);
    const d = new Date(Date.now() - (ageSec||0)*1000);
    return {
      id: ++alarmSeq,
      title: a.t, lv: a.lv, icon: a.icon,
      zone: pick(ZONES),
      time: pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()),
    };
  }
  (function initAlarms(){
    for(let i=0;i<6;i++) state.alarms.push(genAlarm(i*40));
  })();

  // 初始化巡检任务
  (function initPatrol(){
    state.patrols = PATROL_TASKS.map((t,i)=>({
      ...t, no:i+1,
      progress: i===0?ri(40,80): i===1?ri(10,40): 0,
      state: i===0?'run': i===1?'run':'wait',
    }));
    state.patrols[0].state='run';
  })();

  // 每个 tick 推进数据
  function tick(){
    // 气体曲线滚动
    const g = state.gas;
    g.time.push(nowHM()); g.time.shift();
    const lastCo = g.co[g.co.length-1];
    g.h2s.push(+Math.max(0, g.h2s[g.h2s.length-1]+rnd(-1,1)).toFixed(1)); g.h2s.shift();
    g.lel.push(+Math.max(0, g.lel[g.lel.length-1]+rnd(-1.2,1.2)).toFixed(1)); g.lel.shift();
    g.co.push(+Math.max(0, Math.min(40, lastCo+rnd(-2,2.5))).toFixed(1)); g.co.shift();

    // KPI 微动
    state.kpi.online = +(95 + rnd(0,4)).toFixed(1);
    state.kpi.riskScore = ri(88,97);
  }

  // 告警声音系统
  const audioCtx = (function(){
    try{ return new (window.AudioContext || window.webkitAudioContext)(); }catch(_){ return null; }
  })();
  function playAlarmSound(lv){
    if(!audioCtx) return;
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const freqs = { high:[880, 660], mid:[660, 440], low:[440, 330] };
    const durations = { high:0.3, mid:0.2, low:0.15 };
    const f = freqs[lv] || freqs.mid;
    const d = durations[lv] || 0.2;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f[0], audioCtx.currentTime);
    osc.frequency.setValueAtTime(f[1], audioCtx.currentTime + d*0.4);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + d);
    osc.start();
    osc.stop(audioCtx.currentTime + d);
  }

  // 偶发新增告警
  function maybeNewAlarm(){
    if(Math.random() < 0.55){
      const a = genAlarm(0);
      state.alarms.unshift(a);
      if(state.alarms.length>30) state.alarms.pop();
      playAlarmSound(a.lv);
      return a;
    }
    return null;
  }

  // 推进巡检进度
  function tickPatrol(){
    state.patrols.forEach(p=>{
      if(p.state==='run'){
        p.progress += ri(2,7);
        if(p.progress>=100){ p.progress=100; p.state='done'; }
      }
    });
    // 若有等待任务且运行任务<2,启动下一个
    const running = state.patrols.filter(p=>p.state==='run').length;
    if(running<2){
      const wait = state.patrols.find(p=>p.state==='wait');
      if(wait) wait.state='run';
    }
    // 全部完成则重置
    if(state.patrols.every(p=>p.state==='done')){
      state.kpi.patrolDone += state.patrols.length;
      state.patrols.forEach((p,i)=>{ p.progress=0; p.state=i===0?'run':'wait'; });
    }
  }

  function deviceDetail(def){
    const meta = window.DEVICE_META[def.type];
    let rows=[], stateCls='ok', stateTxt='运行正常';
    const ri2=(a,b)=>Math.floor(rnd(a,b));
    if(def.type==='camera'){
      rows=[['分辨率','1920×1080'],['码流','4 Mbps'],['在线时长', ri2(20,400)+' 天'],['IP 地址','10.20.3.'+ri2(2,250)]];
    }else if(def.type==='sensor'){
      const val = def.value;
      const alarm = def.alarm;
      rows=[['实时读数', val],['报警阈值', def.id.startsWith('GAS-02')?'25%LEL':'10ppm'],['响应时间','< 5 s'],['校准日期','2026-05-1'+ri2(0,9)]];
      if(alarm){ stateCls='warn'; stateTxt='浓度偏高 · 关注中'; }
    }else if(def.type==='tank'){
      rows=[['当前液位', def.value],['容积','5000 m³'],['介质','液态烃'],['温度', ri2(18,32)+' ℃']];
    }else if(def.type==='fire'){
      rows=[['系统压力', (rnd(0.6,0.9)).toFixed(2)+' MPa'],['流量', ri2(80,160)+' m³/h'],['状态','就绪'],['上次检修','2026-04-2'+ri2(0,8)]];
    }
    return { title:def.name, idLabel:def.id, kind:meta?meta.label:'设备', rows, stateCls, stateTxt };
  }

  return {
    state,
    tick, maybeNewAlarm, tickPatrol,
    deviceDetail,
  };
})();
