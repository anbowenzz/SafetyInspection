// ============ 主控:布局缩放 / 时钟 / 渲染 / 实时刷新 ============
(function(){
  const $ = id => document.getElementById(id);

  // ---- 退出登录 ----
  const logoutBtn = $('btn-logout');
  if(logoutBtn){
    logoutBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      try{ sessionStorage.removeItem('twin_auth'); }catch(_){}
      location.replace('login.html');
    });
  }

  // ---- 缩放(按高度铺满,宽度自适应)----
  // 大屏按 1080 高度等比缩放;宽度则铺满整个窗口,多出来的宽度由中间列(1fr)吸收,
  // 这样左右两列面板能顶到屏幕真正的左右边缘,而不是被关在居中的 1920 框里留黑边。
  function fitScale(){
    const dash = $('dashboard');
    const s = window.innerHeight / 1080;        // 仅按高度缩放
    const designW = window.innerWidth / s;       // 缩放后正好铺满窗口宽度的设计宽度
    dash.style.width = designW + 'px';
    dash.style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', ()=>{ fitScale(); TwinCharts.resize && TwinCharts.resize(); });
  fitScale();

  // ---- 顶栏时钟 ----
  function pad(n){ return n<10?'0'+n:''+n; }
  const WD=['周日','周一','周二','周三','周四','周五','周六'];
  function clock(){
    const d=new Date();
    $('sys-clock').textContent = pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
    $('sys-date').textContent = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+WD[d.getDay()];
  }
  clock(); setInterval(clock,1000);

  // ---- KPI 卡片 ----
  function renderKPI(){
    const k = TwinData.state.kpi;
    const cards = [
      { cls:'ok', label:'安全运行天数', value:k.safeDays, unit:'天', trend:'<span class="down">▲ 持续</span>' },
      { cls:'', label:'设备在线率', value:k.online, unit:'%', trend:'<span class="down">▲ 正常</span>' },
      { cls:'', label:'安全评分', value:k.riskScore, unit:'分', trend:'<span class="down">▲ 良好</span>' },
      { cls:'', label:'今日巡检完成', value:k.patrolDone, unit:'次', trend:'<span class="down">▲ 进行中</span>' },
    ];
    $('kpi-grid').innerHTML = cards.map(c=>`
      <div class="kpi-card ${c.cls}">
        <div class="k-label">${c.label}</div>
        <div class="k-value">${c.value}<span class="unit">${c.unit}</span></div>
        <div class="k-trend">${c.trend}</div>
      </div>`).join('');
  }

  // ---- 中部统计条 ----
  function renderCenterStat(){
    const c = TwinData.state.center;
    const items=[
      { ico:'🛰', num:c.devices, unit:'台', lab:'接入设备总数' },
      { ico:'🤖', num:c.robots, unit:'台', lab:'巡检机器人' },
      { ico:'📷', num:c.cameras, unit:'路', lab:'视频监控' },
      { ico:'📡', num:c.sensors, unit:'个', lab:'物联传感器' },
    ];
    $('cstat').innerHTML = items.map(i=>`
      <div class="cs-card">
        <div class="cs-ico">${i.ico}</div>
        <div><div class="cs-num">${i.num}<span class="unit">${i.unit}</span></div>
        <div class="cs-lab">${i.lab}</div></div>
      </div>`).join('');
  }

  // ---- 告警列表 ----
  function renderAlarms(){
    const list = TwinData.state.alarms.slice(0,8);
    $('alarm-list').innerHTML = list.map(a=>`
      <div class="alarm-row lv-${a.lv}">
        <div class="a-icon">${a.icon}</div>
        <div class="a-main">
          <div class="a-title">${a.title}</div>
          <div class="a-meta">${a.zone} · ${a.time}</div>
        </div>
        <div class="a-tag">${a.lv==='high'?'高':a.lv==='mid'?'中':'低'}</div>
      </div>`).join('');
  }

  // ---- 巡检任务 ----
  function renderPatrol(){
    const list = TwinData.state.patrols;
    const stMap={run:['st-run','执行中'],wait:['st-wait','待执行'],done:['st-done','已完成']};
    $('patrol-list').innerHTML = list.map(p=>{
      const st=stMap[p.state];
      return `<div class="patrol-row" data-pid="${p.no}">
        <div class="p-no">${pad(p.no)}</div>
        <div class="p-main">
          <div class="p-name">${p.name}</div>
          <div class="p-sub">区域:${p.zone}</div>
        </div>
        <div class="p-prog">
          <div class="p-bar"><i style="width:${p.progress}%"></i></div>
          <div class="p-pct">${p.progress}%</div>
        </div>
        <div class="p-state ${st[0]}">${st[1]}</div>
      </div>`;
    }).join('');
    document.querySelectorAll('.patrol-row').forEach(el=>{
      el.addEventListener('click', ()=>{
        document.querySelectorAll('.patrol-row').forEach(r=>r.classList.remove('clicked'));
        el.classList.add('clicked');
        const pid = el.dataset.pid;
        const patrol = TwinData.state.patrols.find(p=>p.no==pid);
        if(patrol && window.TwinScene){
          TwinScene.focusZone(patrol.zone);
        }
      });
    });
  }

  // ---- 设备弹窗 ----
  function showDevicePopup(def, x, y){
    const det = TwinData.deviceDetail(def);
    $('dp-title').textContent = det.title + ' · ' + det.idLabel;
    $('dp-body').innerHTML =
      det.rows.map(r=>`<div class="dp-row"><span class="dl">${r[0]}</span><span class="dv">${r[1]}</span></div>`).join('')
      + `<div class="dp-state ${det.stateCls}">${det.stateTxt}</div>`;
    const pop = $('device-popup');
    pop.classList.remove('hidden');
    // 定位在点击点附近,避免越界
    const pw=312, ph=pop.offsetHeight||220;
    let px = x+16, py = y-20;
    if(px+pw>window.innerWidth) px = x-pw-16;
    if(py+ph>window.innerHeight) py = window.innerHeight-ph-16;
    if(py<8) py=8;
    pop.style.left=px+'px'; pop.style.top=py+'px';
  }
  $('dp-close').addEventListener('click', ()=> $('device-popup').classList.add('hidden'));
  window.addEventListener('hotspot-click', e=>{
    showDevicePopup(e.detail.def, e.detail.screenX, e.detail.screenY);
  });

  // ---- 工具栏交互 ----
  const toolbar = $('center-toolbar');
  // 进入「巡检路线」视角时隐藏左右图表列,其余视角恢复
  function setSideHidden(hide){
    $('dashboard').classList.toggle('hide-side', hide);
    setTimeout(()=>{ TwinCharts.resize && TwinCharts.resize(); }, 480); // 显隐过渡后重算图表尺寸
  }
  toolbar.addEventListener('click', e=>{
    const btn = e.target.closest('.tool-btn'); if(!btn) return;
    const view = btn.dataset.view, toggle = btn.dataset.toggle, action = btn.dataset.action;
    if(view){
      toolbar.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      setSideHidden(view === 'patrol');
      window.TwinScene && TwinScene.setView(view, false);
    }else if(toggle==='autorotate'){
      const on = TwinScene.toggleAutoRotate();
      btn.classList.toggle('active', on);
    }else if(toggle==='hotspots'){
      const vis = TwinScene.toggleHotspots();
      btn.textContent = vis ? '隐藏标记' : '显示标记';
      btn.classList.toggle('active', !vis);
    }else if(action==='reset'){
      TwinScene.resetView();
      setSideHidden(false);
      toolbar.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));
      toolbar.querySelector('[data-view="overview"]').classList.add('active');
    }
  });
  // 自动旋转默认开启 → 同步按钮高亮
  window.addEventListener('autorotate-change', e=>{
    const b = toolbar.querySelector('[data-toggle="autorotate"]');
    if(b) b.classList.toggle('active', !!e.detail);
  });

  // ---- 实时巡检任务面板:收起 / 展开 ----
  const patrolPanel = $('panel-patrol');
  const patrolToggle = $('patrol-toggle');
  if(patrolToggle){
    patrolToggle.addEventListener('click', ()=>{
      patrolPanel.classList.toggle('collapsed');
    });
  }

  // ---- 首屏渲染 ----
  renderKPI(); renderCenterStat(); renderAlarms(); renderPatrol();

  // ---- 等 3D 就绪后初始化图表 + 启动实时循环 ----
  function startLive(){
    TwinCharts.initAll();
    const b = toolbar.querySelector('[data-toggle="autorotate"]');
    if(b) b.classList.add('active');

    // 高频:气体曲线 + KPI(3s)
    setInterval(()=>{
      TwinData.tick();
      TwinCharts.refreshGas();
      renderKPI();
    }, 3000);

    // 中频:告警 + 巡检(4s)
    setInterval(()=>{
      const a = TwinData.maybeNewAlarm();
      if(a){ renderAlarms(); flashAlarm(a); }
      TwinData.tickPatrol();
      renderPatrol();
    }, 4000);

    // 低频:设备状态环 + 趋势(8s)
    setInterval(()=>{
      const ds = TwinData.state.deviceStatus;
      // 轻微波动在线/告警数
      const drift = Math.random()<0.5?1:-1;
      ds[1].value = Math.max(0, Math.min(12, ds[1].value + drift));
      TwinCharts.refreshDevice();
    }, 8000);
  }

  function flashAlarm(a){
    // 高级别告警 → 顶栏状态短暂变红
    if(a.lv==='high'){
      const rs=document.querySelector('.run-state');
      if(rs){ rs.style.color='#ff4d5e'; rs.querySelector('.dot').style.background='#ff4d5e';
        setTimeout(()=>{ rs.style.color=''; rs.querySelector('.dot').style.background=''; },1500); }
    }
  }

  window.addEventListener('twin-ready', startLive);

  // 安全兜底:若 8s 后 3D 仍未就绪(极端情况),也展示已就绪的 2D 部分
  setTimeout(()=>{ if(!window.TwinScene || !TwinScene.ready){ /* 仅 2D 数据已渲染 */ } }, 8000);
})();
