// ══════════════════════════════════════════════════════════════════════
//  js/core/migi-donem.js — Dönemsel MI & GIGI (MI_GIGI.csv)
//
//  İŞ KURALI (kullanıcı bildirimi):
//    Prim, dönem bitiminden 2 ay sonra gelen (düzeltilmiş IMS'li) MI & GIGI
//    rakamlarıyla KESİNLEŞİR. Yürüyen dönemde sistem MI=GIGI=100 varsayar.
//    MI = Market İndeksi, GIGI = Grup İçi Gelişim İndeksi.
//
//  MI_GIGI.csv biçimi (; ayraçlı, Türkçe sayı biçimi, UTF-8 BOM):
//    2026;1D;;2D;;3D;;4D;;5D;;6D;
//    ;MI;GIGI;MI;GIGI;...
//    AYKUT DİNLER;154,64%;115,95;128,03%;88,89;...
//    ...boş satır..., sonra 2027 bloğu aynı yapıda.
//  Sütun → PERIODS anahtarı: 1D→1d, 2D→2d, 3D→k1, 4D→4d, 5D→5d, 6D→k2
//  MI=0 ve GIGI=0 → "henüz gelmedi" (null kabul edilir).
//
//  Public API (window): MIGI_DONEM, parseMiGiDonemCSV(text), loadMiGiDonem(),
//    getMiGiDonem(ttt, year, periodKey) → {mi, gi} | null,
//    migiDonemYears() → ['2026','2027'], yearOfPeriodKey(periodKey) → '2026'
//  Bağımlılık: constants.js (GS_MIGI_DONEM_URL), date-utils.js (PERIODS)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._MIGI_DONEM_LOADED) return;
  window._MIGI_DONEM_LOADED = true;

  var COL_KEYS = { '1D': '1d', '2D': '2d', '3D': 'k1', '4D': '4d', '5D': '5d', '6D': 'k2' };

  // { '2026': { '1d': { 'AYKUT DİNLER': {mi:154.64, gi:115.95} | null, ... }, ... }, '2027': {...} }
  window.MIGI_DONEM = {};

  function _num(s) {
    s = String(s == null ? '' : s).trim().replace('%', '').replace(/\s/g, '');
    if (!s || s === '-') return null;
    // Türkçe biçim: binlik '.', ondalık ','. Virgül yoksa ve tek nokta + ≤2 hane
    // varsa nokta ondalık sayılır ("102.81").
    if (s.indexOf(',') === -1 && /^\d+\.\d{1,2}$/.test(s)) return parseFloat(s);
    var v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  function _name(s) {
    return String(s || '').trim().toLocaleUpperCase('tr-TR');
  }

  function parseMiGiDonemCSV(text) {
    var out = {};
    if (!text || String(text).trim().charAt(0) === '<') return out;   // 404 HTML sayfası
    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    var year = null, cols = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim() || !line.replace(/;/g, '').trim()) continue;
      var c = line.split(';').map(function (x) { return x.trim(); });

      // Yıl başlık satırı: "2026;1D;;2D;;3D;..."
      if (/^\d{4}$/.test(c[0])) {
        year = c[0]; cols = [];
        for (var j = 1; j < c.length; j++) {
          var k = COL_KEYS[String(c[j]).toUpperCase()];
          if (k) cols.push({ key: k, miIdx: j, giIdx: j + 1 });
        }
        if (!out[year]) out[year] = {};
        cols.forEach(function (cc) { if (!out[year][cc.key]) out[year][cc.key] = {}; });
        continue;
      }
      // Alt başlık satırı: ";MI;GIGI;MI;GIGI..."
      if (!c[0] && /^MI$/i.test(c[1] || '')) continue;
      if (!year || !c[0] || !cols.length) continue;

      var nm = _name(c[0]);
      cols.forEach(function (cc) {
        var mi = _num(c[cc.miIdx]), gi = _num(c[cc.giIdx]);
        out[year][cc.key][nm] = (mi > 0 && gi > 0) ? { mi: mi, gi: gi } : null;   // 0/0 → henüz gelmedi
      });
    }
    return out;
  }

  function getMiGiDonem(ttt, year, periodKey) {
    var y = window.MIGI_DONEM[String(year)];
    var p = y && y[periodKey];
    return (p && p[_name(ttt)]) || null;
  }

  function migiDonemYears() {
    return Object.keys(window.MIGI_DONEM).sort();
  }

  function yearOfPeriodKey(periodKey) {
    var per = (typeof PERIODS !== 'undefined' ? PERIODS : []).find(function (x) { return x.key === periodKey; });
    return per ? per.start.slice(0, 4) : String(new Date().getFullYear());
  }

  // Ağ/format hatası uygulamayı BOZMAZ — sessizce önceki veri korunur.
  function loadMiGiDonem() {
    if (typeof fetch !== 'function' || typeof GS_MIGI_DONEM_URL === 'undefined') return Promise.resolve(false);
    return fetch(GS_MIGI_DONEM_URL + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : ''; })
      .then(function (txt) {
        var parsed = parseMiGiDonemCSV(txt);
        if (!Object.keys(parsed).length) return false;
        window.MIGI_DONEM = parsed;
        console.log('[migi-donem] MI_GIGI.csv yüklendi:', migiDonemYears().join(', '));
        if (typeof window.renderPrimGecmis === 'function') window.renderPrimGecmis();
        return true;
      })
      .catch(function (e) { console.warn('[migi-donem] yüklenemedi (sessiz):', e && e.message); return false; });
  }

  window.parseMiGiDonemCSV = parseMiGiDonemCSV;
  window.loadMiGiDonem     = loadMiGiDonem;
  window.getMiGiDonem      = getMiGiDonem;
  window.migiDonemYears    = migiDonemYears;
  window.yearOfPeriodKey   = yearOfPeriodKey;
})();
