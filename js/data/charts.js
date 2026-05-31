// ══════════════════════════════════════════════════════════════
//  js/data/charts.js — Chart.js Yardımcı Katmanı
//  Phase 3.0 extraction
//  Globals: charts{}, destroyChart(), mkChart()
//  Bağımlılık: Chart.js (chart.umd.min.js) + js/core/formatters.js (fK)
//  Yükleme sırası: chart.umd → formatters → charts.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Aktif Chart Instance Registri ───────────────────────────
var charts = {};

// ── Chart Temizleme ──────────────────────────────────────────
function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id]}}

function mkChart(id,type,data,opts={}){
  destroyChart(id);
  const ctx=document.getElementById(id);if(!ctx)return;
  charts[id]=new Chart(ctx,{type,data,options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{labels:{color:'#718096',font:{size:10,family:'Inter'},padding:8}},
      tooltip:{bodyFont:{family:'JetBrains Mono',size:11},titleFont:{family:'Inter',size:11}}
    },
    scales:(!['pie','doughnut'].includes(type))?{
      x:{grid:{color:'#F0F4F8'},ticks:{color:'#718096',font:{size:9}}},
      y:{grid:{color:'#F0F4F8'},ticks:{color:'#718096',font:{size:9},callback:v=>fK(v)}}
    }:undefined,...opts
  }});
  return charts[id];
}

// ═══════════════════════════════════════════════════════════
//  ROUTING
// ═══════════════════════════════════════════════════════════
