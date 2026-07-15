// ============ ECharts 图表层 ============
window.TwinCharts = (function(){
  const C = {
    cyan:'#21d4fd', blue:'#2a7fff', green:'#2ee6a6', yellow:'#ffcc33',
    orange:'#ff9a3c', red:'#ff4d5e', txt:'#cfe8ff', dim:'#6f8fb5',
  };
  const charts = {};
  const grid = { left:30, right:8, top:30, bottom:26 };
  const axisLine = { lineStyle:{ color:'rgba(33,212,253,.25)' } };
  const splitLine = { lineStyle:{ color:'rgba(33,212,253,.08)' } };
  const axisLabel = { color:C.dim, fontSize:11 };

  function init(id){
    const dom = document.getElementById(id);
    const c = echarts.init(dom);
    charts[id] = c;
    return c;
  }

  // ---- 气体监测(多折线)----
  function gas(){
    const c = init('chart-gas');
    const d = TwinData.state.gas;
    c.setOption({
      tooltip:{ trigger:'axis', backgroundColor:'rgba(6,20,42,.9)', borderColor:C.cyan, textStyle:{color:C.txt} },
      legend:{ data:['H₂S(ppm)','可燃气(%LEL)','CO(ppm)'], textStyle:{color:C.dim,fontSize:11}, top:0, itemWidth:14, itemHeight:8 },
      grid:{ ...grid, top:34 },
      xAxis:{ type:'category', data:d.time, boundaryGap:false, axisLine, axisLabel:{...axisLabel, interval:4}, axisTick:{show:false} },
      yAxis:{ type:'value', axisLine:{show:false}, axisLabel, splitLine, axisTick:{show:false} },
      series:[
        line('H₂S(ppm)', d.h2s, C.green),
        line('可燃气(%LEL)', d.lel, C.cyan),
        line('CO(ppm)', d.co, C.orange),
      ]
    });
  }
  function line(name, data, color){
    return {
      name, type:'line', data, smooth:true, symbol:'none', lineStyle:{width:2,color},
      areaStyle:{ color:new echarts.graphic.LinearGradient(0,0,0,1,[
        {offset:0,color:color+'55'},{offset:1,color:color+'05'}]) }
    };
  }

  // ---- 设备状态(环形)----
  function device(){
    const c = init('chart-device');
    const d = TwinData.state.deviceStatus;
    const total = d.reduce((s,x)=>s+x.value,0);
    c.setOption({
      tooltip:{ trigger:'item', backgroundColor:'rgba(6,20,42,.9)', borderColor:C.cyan, textStyle:{color:C.txt} },
      legend:{ orient:'vertical', right:10, top:'center', textStyle:{color:C.txt,fontSize:12}, itemWidth:10, itemHeight:10,
        formatter:(n)=>{ const it=d.find(x=>x.name===n); return n+'  '+it.value; } },
      graphic:{ type:'text', left:'32%', top:'44%', style:{ text:total+'\n台', textAlign:'center', fill:C.txt, fontSize:14, lineHeight:20 } },
      series:[{
        type:'pie', radius:['52%','74%'], center:['35%','50%'], avoidLabelOverlap:false,
        label:{show:false}, labelLine:{show:false},
        data:[
          { value:d[0].value, name:'在线', itemStyle:{color:C.green} },
          { value:d[1].value, name:'告警', itemStyle:{color:C.yellow} },
          { value:d[2].value, name:'离线', itemStyle:{color:C.red} },
        ],
        itemStyle:{ borderColor:'#06162e', borderWidth:2 },
      }]
    });
  }

  // ---- 告警趋势(柱)----
  function trend(){
    const c = init('chart-trend');
    const d = TwinData.state.trend;
    c.setOption({
      tooltip:{ trigger:'axis', backgroundColor:'rgba(6,20,42,.9)', borderColor:C.cyan, textStyle:{color:C.txt} },
      grid,
      xAxis:{ type:'category', data:d.days, axisLine, axisLabel, axisTick:{show:false} },
      yAxis:{ type:'value', axisLine:{show:false}, axisLabel, splitLine },
      series:[{
        type:'bar', data:d.counts, barWidth:'46%',
        itemStyle:{ borderRadius:[4,4,0,0], color:new echarts.graphic.LinearGradient(0,0,0,1,[
          {offset:0,color:C.cyan},{offset:1,color:'rgba(42,127,255,.25)'}]) },
        label:{show:true,position:'top',color:C.txt,fontSize:11},
      }]
    });
  }

  // ---- 风险等级分布(玫瑰/漏斗式条)----
  function risk(){
    const c = init('chart-risk');
    const d = TwinData.state.risk;
    const colors=[C.red,C.orange,C.yellow,C.green];
    c.setOption({
      tooltip:{ trigger:'item', backgroundColor:'rgba(6,20,42,.9)', borderColor:C.cyan, textStyle:{color:C.txt} },
      grid:{ left:62, right:36, top:10, bottom:10 },
      xAxis:{ type:'value', axisLine:{show:false}, axisLabel:{show:false}, splitLine:{show:false} },
      yAxis:{ type:'category', inverse:true, data:d.map(x=>x.name), axisLine, axisTick:{show:false},
        axisLabel:{color:C.txt,fontSize:12} },
      series:[{
        type:'bar', data:d.map((x,i)=>({value:x.value,itemStyle:{color:colors[i],borderRadius:[0,8,8,0]}})),
        barWidth:14,
        label:{show:true,position:'right',color:C.txt,fontSize:12,formatter:'{c} 项'},
        showBackground:true, backgroundStyle:{color:'rgba(33,212,253,.06)',borderRadius:8},
      }]
    });
  }

  function initAll(){ gas(); device(); trend(); risk(); }

  function refreshGas(){
    const d = TwinData.state.gas;
    charts['chart-gas'] && charts['chart-gas'].setOption({
      xAxis:{ data:d.time },
      series:[{data:d.h2s},{data:d.lel},{data:d.co}]
    });
  }
  function refreshTrend(){
    const d = TwinData.state.trend;
    charts['chart-trend'] && charts['chart-trend'].setOption({ xAxis:{data:d.days}, series:[{data:d.counts}] });
  }
  function refreshDevice(){
    const d = TwinData.state.deviceStatus;
    charts['chart-device'] && charts['chart-device'].setOption({ series:[{data:[
      {value:d[0].value,name:'在线',itemStyle:{color:C.green}},
      {value:d[1].value,name:'告警',itemStyle:{color:C.yellow}},
      {value:d[2].value,name:'离线',itemStyle:{color:C.red}},
    ]}] });
  }

  function resize(){ Object.values(charts).forEach(c=>c.resize()); }

  return { initAll, refreshGas, refreshTrend, refreshDevice, resize };
})();
