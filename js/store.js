// ============ 共享配置存储层 ============
// 大屏(data.js)与数据管理后台(admin.js)共用本模块。
// 后台修改的数据写入 localStorage,大屏加载时读取作为初始数据 ——
// 这样无需后端服务,纯前端即可让"管理后台"真正驱动可视化大屏。
window.TwinStore = (function(){
  const KEY = 'twin_admin_config_v1';

  // 默认配置(后台未做任何修改时,大屏使用这套数据)
  const DEFAULTS = {
    // 监测点位 / 设备(对应大屏三维热点标记)
    hotspots: [
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
    ],
    // 园区安全态势 KPI
    kpi: { safeDays:328, online:96.8, riskScore:92, patrolDone:18 },
    // 接入设备总览统计
    center: { devices:248, robots:6, cameras:42, sensors:86 },
    // 巡检任务(任务名称 + 区域)
    patrols: [
      { name:'罐区日常安全巡检', zone:'原料罐区' },
      { name:'反应装置点检', zone:'反应装置区' },
      { name:'消防设施巡查', zone:'公用工程区' },
      { name:'装卸区作业监护', zone:'装卸车区' },
    ],
    // 风险等级分布
    risk: [
      { name:'重大风险', value:1 },
      { name:'较大风险', value:3 },
      { name:'一般风险', value:8 },
      { name:'低风险', value:21 },
    ],
    // 巡检设备运行状态(在线 / 告警 / 离线)
    deviceStatus: [
      { name:'在线', value:236 },
      { name:'告警', value:5 },
      { name:'离线', value:7 },
    ],
  };

  function clone(o){
    try{ return structuredClone(o); }
    catch(e){ return JSON.parse(JSON.stringify(o)); }
  }

  // 读取配置:localStorage 优先,缺失字段用默认补齐
  function load(){
    const base = clone(DEFAULTS);
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){
        const saved = JSON.parse(raw);
        return Object.assign(base, saved);
      }
    }catch(e){ console.warn('[TwinStore] 读取配置失败,使用默认值', e); }
    return base;
  }

  function save(cfg){
    try{
      localStorage.setItem(KEY, JSON.stringify(cfg));
      return true;
    }catch(e){ console.error('[TwinStore] 保存失败', e); return false; }
  }

  function reset(){ localStorage.removeItem(KEY); }

  return { KEY, defaults:()=>clone(DEFAULTS), clone, load, save, reset };
})();
