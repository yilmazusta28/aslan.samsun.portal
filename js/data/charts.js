// ══════════════════════════════════════════════════════════════
//  js/data/charts.js — Chart.js Yardımcı Katmanı
//  Phase 3.0 + Tema Fix
//  Globals: charts{}, destroyChart(), mkChart(), refreshChartThemes()
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

var charts = {};

// ── Chart Temizleme ──────────────────────────────────────────
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Aktif Tema Renkleri ──────────────────────────────────────
function _chartTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid:   isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    tick:   isDark ? '#A0AEC0'                : '#718096',
    legend: isDark ? '#CBD5E1'                : '#4A5568',
  };
}

// ── Chart Oluştur ────────────────────────────────────────────
function mkChart(id, type, data, opts) {
  opts = opts || {};
  // Canvas yoksa veya DOM'dan kaldırıldıysa sessizce çık
  var ctx = document.getElementById(id);
  if (!ctx || !ctx.isConnected) return;
  destroyChart(id);
  var th = _chartTheme();
  charts[id] = new Chart(ctx, {
    type: type,
    data: data,
    options: _mergeChartOpts(type, th, opts)
  });
  return charts[id];
}

// ── Options Birleştirici ─────────────────────────────────────
function _mergeChartOpts(type, th, extra) {
  var base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: th.legend, font: { size: 10, family: 'Inter' }, padding: 8 }
      },
      tooltip: {
        bodyFont:  { family: 'JetBrains Mono', size: 11 },
        titleFont: { family: 'Inter', size: 11 }
      }
    },
    scales: (['pie','doughnut'].indexOf(type) === -1) ? {
      x: { grid: { color: th.grid }, ticks: { color: th.tick, font: { size: 9 } } },
      y: { grid: { color: th.grid }, ticks: { color: th.tick, font: { size: 9 }, callback: function(v){ return fK(v); } } }
    } : undefined
  };
  // extra.scales varsa derinlemesine birleştir
  if (extra && extra.scales && base.scales) {
    if (extra.scales.x) base.scales.x = Object.assign({}, base.scales.x, extra.scales.x);
    if (extra.scales.y) base.scales.y = Object.assign({}, base.scales.y, extra.scales.y);
    delete extra.scales;
  }
  return Object.assign(base, extra);
}

// ── Tema Değişiminde Tüm Chart'ları Güncelle ─────────────────
// toggleDarkMode() tarafından çağrılır
function refreshChartThemes() {
  var th = _chartTheme();
  Object.keys(charts).forEach(function(id) {
    var c = charts[id];
    if (!c || !c.options) return;
    try {
      // Scale renklerini güncelle
      if (c.options.scales) {
        ['x','y'].forEach(function(ax) {
          if (!c.options.scales[ax]) return;
          if (c.options.scales[ax].grid)  c.options.scales[ax].grid.color  = th.grid;
          if (c.options.scales[ax].ticks) c.options.scales[ax].ticks.color = th.tick;
        });
      }
      // Legend rengi
      if (c.options.plugins && c.options.plugins.legend && c.options.plugins.legend.labels) {
        c.options.plugins.legend.labels.color = th.legend;
      }
      c.update('none'); // 'none' = animasyonsuz hızlı güncelleme
    } catch(e) {}
  });
}

// ═══════════════════════════════════════════════════════════
//  ROUTING
// ═══════════════════════════════════════════════════════════
