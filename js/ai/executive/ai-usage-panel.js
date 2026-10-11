// ══════════════════════════════════════════════════════════════
//  js/ai/executive/ai-usage-panel.js — Yönetici paneli: "AI Kullanım & Maliyet"
//
//  Worker'ın POST /ai-usage uç noktasını (worker.js — yalnız manager/admin imzalı jetonu)
//  okuyup kullanıcı bazında günlük token/maliyet tablosunu gösterir:
//    • seçili gün için kullanıcı satırları (çağrı, girdi/çıktı token, cache isabeti, kesilen yanıt, tahmini ₺)
//    • "Son 7 gün" mini özeti (gün başına çağrı + tahmini maliyet)
//  Gün sınırı worker'da UTC'dir (Türkiye saatiyle 03:00'te değişir).
//  Tahmini maliyet worker'daki fiyat tablosundan gelir (PV_PRICES / PV_USDTRY ile ayarlanır).
//
//  Bağımlılıklar: pvAuthHeaders() (js/core/pv-auth.js), _getProxyUrl() (js/ai/ai-service.js).
//  GitHub Pages compatible: classic script, no ES modules.
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var HOST_ID = 'aiUsageCard';
  var _day = null;          // seçili gün (UTC, YYYY-MM-DD)
  var _busy = false;

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _utcToday() { return new Date().toISOString().slice(0, 10); }
  function _num(n) { return (+n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }); }
  function _money(tl, usd) {
    if (tl != null) return _num(tl) + ' ₺';
    return '$' + (+usd || 0).toFixed(2);
  }
  function _baseUrl() {
    var u = (typeof _getProxyUrl === 'function') ? _getProxyUrl() : (window.AI_PROXY_URL || '');
    return String(u || '').replace(/\/+$/, '');
  }

  async function _fetchUsage(day) {
    var headers = Object.assign({ 'Content-Type': 'application/json' },
      (typeof pvAuthHeaders === 'function') ? await pvAuthHeaders() : {});
    var res = await fetch(_baseUrl() + '/ai-usage', { method: 'POST', headers: headers, body: JSON.stringify({ day: day }) });
    if (res.status === 403) throw new Error('Bu özet yalnızca yönetici hesabıyla (imzalı oturum) görülebilir.');
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || !Array.isArray(data.users)) {
      throw new Error('Kullanım özeti alınamadı (HTTP ' + res.status + '). Worker\'ın güncel sürümü (/ai-usage) yüklü mü?');
    }
    return data;
  }

  // Kullanıcı satırı: modellerin token toplamları
  function _sumModels(models) {
    var t = { in: 0, out: 0, cw: 0, cr: 0 };
    Object.keys(models || {}).forEach(function (k) {
      var m = models[k] || {};
      t.in += m.in || 0; t.out += m.out || 0; t.cw += m.cw || 0; t.cr += m.cr || 0;
    });
    return t;
  }
  function _modelTip(models) {
    return Object.keys(models || {}).map(function (k) {
      var m = models[k];
      return k + ': ' + m.calls + ' çağrı, girdi ' + _num(m.in) + ', çıktı ' + _num(m.out) + ', cache okuma ' + _num(m.cr);
    }).join('\n');
  }

  function _tableHtml(data) {
    var th = 'style="text-align:left;padding:5px 6px;font-size:10px;color:var(--dim);border-bottom:1px solid var(--border);white-space:nowrap"';
    var thr = th.replace('text-align:left', 'text-align:right');
    var td = 'style="padding:5px 6px;font-size:11px;border-bottom:1px solid var(--border)"';
    var tdr = td.replace('padding', 'text-align:right;font-variant-numeric:tabular-nums;padding');
    var totIn = 0, totOut = 0, totCr = 0, totAllIn = 0, totTrunc = 0;
    var rows = data.users.map(function (u) {
      var s = _sumModels(u.models);
      var allIn = s.in + s.cw + s.cr;
      totIn += s.in; totOut += s.out; totCr += s.cr; totAllIn += allIn; totTrunc += u.truncated || 0;
      var hit = allIn > 0 ? Math.round(s.cr / allIn * 100) : 0;
      return '<tr title="' + _esc(_modelTip(u.models)) + '">' +
        '<td ' + td + '>' + _esc(u.user) + '</td>' +
        '<td ' + tdr + '>' + _num(u.calls) + '</td>' +
        '<td ' + tdr + '>' + _num(allIn) + '</td>' +
        '<td ' + tdr + '>' + _num(s.out) + '</td>' +
        '<td ' + tdr + '>%' + hit + '</td>' +
        '<td ' + tdr + '>' + (u.truncated ? '<span style="color:#DC2626;font-weight:700">' + _num(u.truncated) + '</span>' : '0') + '</td>' +
        '<td ' + tdr.replace('padding', 'font-weight:700;padding') + '>' + _esc(_money(u.est_tl, u.est_usd)) + '</td></tr>';
    }).join('');
    var tot = data.total || {};
    var hitAll = totAllIn > 0 ? Math.round(totCr / totAllIn * 100) : 0;
    var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>' +
      '<th ' + th + '>Kullanıcı</th><th ' + thr + '>Çağrı</th><th ' + thr + '>Girdi tok.</th><th ' + thr + '>Çıktı tok.</th>' +
      '<th ' + thr + '>Cache isabeti</th><th ' + thr + '>Kesilen</th><th ' + thr + '>Tahmini maliyet</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" ' + td + '>Bu gün için kayıtlı AI çağrısı yok.</td></tr>') +
      '</tbody>' + (rows ? '<tfoot><tr style="font-weight:800"><td ' + td + '>Toplam</td><td ' + tdr + '>' + _num(tot.calls) + '</td>' +
      '<td ' + tdr + '>' + _num(totAllIn) + '</td><td ' + tdr + '>' + _num(totOut) + '</td><td ' + tdr + '>%' + hitAll + '</td>' +
      '<td ' + tdr + '>' + _num(totTrunc) + '</td><td ' + tdr + '>' + _esc(_money(tot.est_tl, tot.est_usd)) + '</td></tr></tfoot>' : '') +
      '</table></div>';
    if (totTrunc > 0) {
      html += '<div style="margin-top:8px;font-size:10.5px;color:#B45309">⚠️ ' + _num(totTrunc) +
        ' yanıt çıktı sınırına (max_tokens) takılıp kesildi. Worker sınırı (MAX_TOKENS_CAP) istenen uzunluğun altında olabilir.</div>';
    }
    if (rows && totAllIn > 0 && totCr === 0) {
      html += '<div style="margin-top:6px;font-size:10.5px;color:var(--dim)">ℹ️ Cache isabeti %0: sohbet bağlamı cache\'ten okunmuyor olabilir (5 dk\'dan uzun aralıklar normaldir).</div>';
    }
    return html;
  }

  function _utcDaysBack(n) {
    var out = [], d = new Date();
    for (var i = 0; i < n; i++) { out.push(new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10)); }
    return out;
  }

  async function _weekHtml() {
    var days = _utcDaysBack(7);
    var results = await Promise.all(days.map(function (d) {
      return _fetchUsage(d).then(function (r) { return { day: d, total: r.total || {}, ok: true }; })
        .catch(function () { return { day: d, total: {}, ok: false }; });
    }));
    var sumUsd = 0, sumTl = 0, hasTl = false, sumCalls = 0;
    var td = 'style="padding:4px 6px;font-size:11px;border-bottom:1px solid var(--border)"';
    var tdr = td.replace('padding', 'text-align:right;font-variant-numeric:tabular-nums;padding');
    var rows = results.map(function (r) {
      sumCalls += r.total.calls || 0; sumUsd += r.total.est_usd || 0;
      if (r.total.est_tl != null) { hasTl = true; sumTl += r.total.est_tl; }
      return '<tr><td ' + td + '>' + _esc(r.day) + '</td><td ' + tdr + '>' + (r.ok ? _num(r.total.calls) : '—') + '</td><td ' + tdr + '>' +
        (r.ok ? _esc(_money(r.total.est_tl, r.total.est_usd)) : '—') + '</td></tr>';
    }).join('');
    return '<div style="margin-top:12px;font-size:11px;font-weight:800">Son 7 gün (UTC)</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:4px"><tbody>' + rows + '</tbody><tfoot><tr style="font-weight:800"><td ' + td +
      '>Toplam</td><td ' + tdr + '>' + _num(sumCalls) + '</td><td ' + tdr + '>' + _esc(_money(hasTl ? sumTl : null, sumUsd)) + '</td></tr></tfoot></table>';
  }

  async function renderAiUsagePanel(day, withWeek) {
    var host = document.getElementById(HOST_ID);
    if (!host || _busy) return;
    _busy = true;
    _day = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : (_day || _utcToday());
    var ctl = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
      '<input type="date" id="aiUsageDay" value="' + _esc(_day) + '" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surf);color:var(--text)">' +
      '<button type="button" class="btn" style="font-size:11px;padding:4px 10px" onclick="renderAiUsagePanel(document.getElementById(\'aiUsageDay\').value)">Yenile</button>' +
      '<button type="button" class="btn" style="font-size:11px;padding:4px 10px" onclick="renderAiUsagePanel(document.getElementById(\'aiUsageDay\').value,true)">Son 7 gün</button>' +
      '<span style="font-size:10px;color:var(--dim)">Gün sınırı UTC (TR 03:00)</span></div>';
    host.innerHTML = ctl + '<div style="font-size:11px;color:var(--dim)">⏳ Yükleniyor…</div>';
    try {
      var data = await _fetchUsage(_day);
      var body = _tableHtml(data);
      if (withWeek) body += await _weekHtml();
      host.innerHTML = ctl + body;
    } catch (e) {
      host.innerHTML = ctl + '<div style="font-size:11px;color:#DC2626">⚠️ ' + _esc(e.message) + '</div>';
    } finally {
      _busy = false;
    }
  }

  window.renderAiUsagePanel = renderAiUsagePanel;
  window._aiUsagePanelTest = { tableHtml: _tableHtml, sumModels: _sumModels };
})();
