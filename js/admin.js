// ============ 数据管理后台逻辑 ============
(function(){
  const $ = id => document.getElementById(id);
  const HOTSPOT_TYPES = [
    { v:'camera', t:'视频监控' },
    { v:'sensor', t:'气体探测' },
    { v:'tank',   t:'储罐液位' },
    { v:'fire',   t:'消防设施' },
  ];
  const TYPE_LABEL = { camera:'视频监控', sensor:'气体探测', tank:'储罐液位', fire:'消防设施' };

  // 当前编辑中的配置(从存储载入的工作副本)
  let cfg = TwinStore.load();

  // 显示当前操作员
  try{ const u = sessionStorage.getItem('twin_user'); if(u) $('cur-user').textContent = u; }catch(_){}

  // ---------- 提示条 ----------
  let toastTimer = null;
  function toast(msg, isErr){
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> t.className = 'toast', 2200);
  }

  // ---------- 导航切换 ----------
  $('admin-nav').addEventListener('click', e=>{
    const item = e.target.closest('.nav-item'); if(!item) return;
    const view = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n===item));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.dataset.view===view));
  });

  // ---------- 工具函数 ----------
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const num = (v, def) => { const n = parseFloat(v); return isNaN(n) ? (def||0) : n; };

  // ============ 概览 ============
  function renderOverview(){
    const k = cfg.kpi, c = cfg.center;
    $('overview-stats').innerHTML = [
      ['安全运行天数', k.safeDays, '天'],
      ['设备在线率', k.online, '%'],
      ['安全评分', k.riskScore, '分'],
      ['今日巡检完成', k.patrolDone, '次'],
    ].map(s=>`<div class="stat-card"><div class="sc-lab">${s[0]}</div><div class="sc-val">${esc(s[1])}<span class="u">${s[2]}</span></div></div>`).join('');
    $('overview-counts').innerHTML = [
      ['监测点位', cfg.hotspots.length, '个'],
      ['巡检任务', cfg.patrols.length, '项'],
      ['接入设备总数', c.devices, '台'],
      ['物联传感器', c.sensors, '个'],
    ].map(s=>`<div class="stat-card"><div class="sc-lab">${s[0]}</div><div class="sc-val">${esc(s[1])}<span class="u">${s[2]}</span></div></div>`).join('');
  }

  // ============ 监测点位表 ============
  function typeSelect(val){
    return `<select data-field="type">` +
      HOTSPOT_TYPES.map(o=>`<option value="${o.v}" ${o.v===val?'selected':''}>${o.t}</option>`).join('') +
      `</select>`;
  }
  function renderHotspots(){
    const tb = $('tbl-hotspots').querySelector('tbody');
    tb.innerHTML = cfg.hotspots.map((h,i)=>`
      <tr data-i="${i}">
        <td><input data-field="id" value="${esc(h.id)}" /></td>
        <td>${typeSelect(h.type)}</td>
        <td><input data-field="name" value="${esc(h.name)}" /></td>
        <td><input data-field="value" value="${esc(h.value)}" /></td>
        <td style="text-align:center"><input type="checkbox" data-field="alarm" ${h.alarm?'checked':''} /></td>
        <td><button class="row-del" data-del="${i}">删除</button></td>
      </tr>`).join('');
  }
  // 表格输入实时写回工作副本
  $('tbl-hotspots').addEventListener('input', e=>{
    const tr = e.target.closest('tr'); if(!tr) return;
    const i = +tr.dataset.i, f = e.target.dataset.field; if(f==null) return;
    const h = cfg.hotspots[i];
    if(f==='alarm') h.alarm = e.target.checked; else h[f] = e.target.value;
  });
  $('tbl-hotspots').addEventListener('change', e=>{
    if(e.target.dataset.field==='type'){
      const tr = e.target.closest('tr'); cfg.hotspots[+tr.dataset.i].type = e.target.value;
    }
  });
  $('tbl-hotspots').addEventListener('click', e=>{
    if(e.target.dataset.del!=null){
      cfg.hotspots.splice(+e.target.dataset.del, 1); renderHotspots();
    }
  });
  $('add-hotspot').addEventListener('click', ()=>{
    const n = cfg.hotspots.length+1;
    cfg.hotspots.push({ id:'DEV-'+String(n).padStart(2,'0'), type:'camera', name:'新增监测点', value:'在线' });
    renderHotspots();
  });

  // ============ KPI 表单 ============
  const KPI_FIELDS = [
    ['safeDays','安全运行天数','天'], ['online','设备在线率','%'],
    ['riskScore','安全评分','分'], ['patrolDone','今日巡检完成','次'],
  ];
  function renderKpi(){
    $('form-kpi').innerHTML = KPI_FIELDS.map(f=>`
      <div class="fg-item">
        <label>${f[1]}(${f[2]})</label>
        <input type="number" step="0.1" data-kpi="${f[0]}" value="${esc(cfg.kpi[f[0]])}" />
      </div>`).join('');
  }
  $('form-kpi').addEventListener('input', e=>{
    const k = e.target.dataset.kpi; if(k) cfg.kpi[k] = num(e.target.value);
  });

  // ============ 设备总览表单 ============
  const CENTER_FIELDS = [
    ['devices','接入设备总数','台'], ['robots','巡检机器人','台'],
    ['cameras','视频监控','路'], ['sensors','物联传感器','个'],
  ];
  function renderCenter(){
    $('form-center').innerHTML = CENTER_FIELDS.map(f=>`
      <div class="fg-item">
        <label>${f[1]}(${f[2]})</label>
        <input type="number" data-center="${f[0]}" value="${esc(cfg.center[f[0]])}" />
      </div>`).join('');
  }
  $('form-center').addEventListener('input', e=>{
    const c = e.target.dataset.center; if(c) cfg.center[c] = num(e.target.value);
  });

  // ============ 巡检任务表 ============
  function renderPatrols(){
    const tb = $('tbl-patrols').querySelector('tbody');
    tb.innerHTML = cfg.patrols.map((p,i)=>`
      <tr data-i="${i}">
        <td>${i+1}</td>
        <td><input data-field="name" value="${esc(p.name)}" /></td>
        <td><input data-field="zone" value="${esc(p.zone)}" /></td>
        <td><button class="row-del" data-del="${i}">删除</button></td>
      </tr>`).join('');
  }
  $('tbl-patrols').addEventListener('input', e=>{
    const tr = e.target.closest('tr'); if(!tr) return;
    const f = e.target.dataset.field; if(f) cfg.patrols[+tr.dataset.i][f] = e.target.value;
  });
  $('tbl-patrols').addEventListener('click', e=>{
    if(e.target.dataset.del!=null){ cfg.patrols.splice(+e.target.dataset.del,1); renderPatrols(); }
  });
  $('add-patrol').addEventListener('click', ()=>{
    cfg.patrols.push({ name:'新增巡检任务', zone:'公用工程区' }); renderPatrols();
  });

  // ============ 风险分布 / 设备状态(数量可编辑,名称固定)============
  function renderValTable(tblId, arr){
    const tb = $(tblId).querySelector('tbody');
    tb.innerHTML = arr.map((r,i)=>`
      <tr data-i="${i}">
        <td>${esc(r.name)}</td>
        <td><input type="number" min="0" data-val value="${esc(r.value)}" /></td>
      </tr>`).join('');
  }
  // 直接引用 cfg.*(reset/load 会替换数组实例,故监听器内按需读取 cfg)
  $('tbl-risk').addEventListener('input', e=>{
    if(e.target.dataset.val==null) return;
    const tr = e.target.closest('tr'); cfg.risk[+tr.dataset.i].value = Math.max(0, Math.round(num(e.target.value)));
  });
  $('tbl-device').addEventListener('input', e=>{
    if(e.target.dataset.val==null) return;
    const tr = e.target.closest('tr'); cfg.deviceStatus[+tr.dataset.i].value = Math.max(0, Math.round(num(e.target.value)));
  });

  // ============ 全量渲染 ============
  function renderAll(){
    renderOverview(); renderHotspots(); renderKpi(); renderCenter();
    renderPatrols(); renderValTable('tbl-risk', cfg.risk); renderValTable('tbl-device', cfg.deviceStatus);
  }

  // ============ 保存 / 重置 / 退出 ============
  function validate(){
    // 监测点位编号必填且不重复
    const ids = cfg.hotspots.map(h=>(h.id||'').trim());
    if(ids.some(id=>!id)) return '存在编号为空的监测点位';
    if(new Set(ids).size !== ids.length) return '监测点位编号存在重复';
    if(cfg.patrols.some(p=>!(p.name||'').trim())) return '存在名称为空的巡检任务';
    return null;
  }
  $('btn-save').addEventListener('click', ()=>{
    const err = validate();
    if(err){ toast(err, true); return; }
    if(TwinStore.save(cfg)){ toast('已保存,返回大屏即可生效'); }
    else toast('保存失败,请检查浏览器存储权限', true);
  });
  $('btn-reset').addEventListener('click', ()=>{
    if(!confirm('确定恢复为默认数据吗?当前未保存的修改将丢失。')) return;
    TwinStore.reset();
    cfg = TwinStore.load();
    renderAll();
    toast('已恢复默认数据(记得点保存以应用到大屏)');
  });
  $('btn-logout').addEventListener('click', ()=>{
    try{ sessionStorage.removeItem('twin_auth'); }catch(_){}
    location.replace('login.html');
  });

  // 首屏
  renderAll();
})();



