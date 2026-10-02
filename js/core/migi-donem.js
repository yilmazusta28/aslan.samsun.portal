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
  window.MIGI_TL_NATIONAL = window.MIGI_TL_NATIONAL || [];   // NATIONAL satırları (data-loader doldurur)

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

  // ── OTOMATİK MI & GIGI ────────────────────────────────────────
  // Kesinleşmiş IMS'li MI_GIGI.csv değeri gelene kadar, sistemdeki MI_GI_TL_TOPLAM.csv
  // (2025 referanslı) verisinden TAHMİN eder; kesin değer gelince onu kullanır.
  //   • Kesin   : MI_GIGI.csv → {source:'final'}
  //   • Tahmin  : dönem sonuna kadar olan EN GÜNCEL ayın GENEL satırı →
  //       MI   = Market İndeksi (MI)
  //       GIGI = Büyüme İndeksi ÷ NATIONAL Büyüme İndeksi × 100
  //     (1D-3D kesin değerlerle karşılaştırma: GIGI ort. sapma ≈6 puan; ham EVOL ≈+26,
  //      ham Büyüme İnd. ≈+59 puan şişiriyordu. MI ort. ≈+5 puan.) NATIONAL yoksa GIGI=100.
  // ── GIGI (PDF formülü): (TTT son dönem satışı ÷ TTT geçen yıl aynı dönem satışı) ÷
  //    (National son dönem ÷ National geçen yıl aynı dönem) × 100.
  //  Geçen yılın dönem satışı sistemde yok ama MI_GI_TL_TOPLAM.csv'deki YTD Büyüme İndeksi
  //  (= bu yıl YTD ÷ geçen yıl YTD) içinde gizli: geçen yıl YTD(n) = bu yıl YTD(n) ÷ BI(n).
  //  Dönem n geçen yıl satışı = geçen yıl YTD(n) − geçen yıl YTD(n−1); bu yıl dönem satışı
  //  YTD_TL.csv'deki (kesinleşmiş IMS) n.DÖNEM bloğundan. Aylar: dönem n ↔ BI ayı 2n.
  //  (1-3. dönem kesin değerlerle karşılaştırma: ort. mutlak sapma ≈3,8 puan.)
  var PNO = { '1d': 1, '2d': 2, 'k1': 3, '4d': 4, '5d': 5, 'k2': 6 };
  function _growth(person, n) {
    var d = window.YTD_TL_DATA; if (!d || !d.data) return null;
    var nm = _name(person), isNat = nm === 'NATIONAL';
    var sat = function (k) {
      var rows = d.data[k + '.DÖNEM']; if (!rows) return null;
      var r = rows.find(function (x) { return _name(x.personel) === nm; });
      var t = r && r.products && r.products.TOPLAM;
      return (t && t.satis > 0) ? t.satis : null;
    };
    var bi = function (m) {
      var key = (m < 10 ? '0' : '') + m + '/2026';
      var src = isNat ? (window.MIGI_TL_NATIONAL || []) : (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []);
      var r = src.find(function (x) { return _name(x.person) === nm && x.donem === key && x.bi > 0 && (!x.ilac || x.ilac === 'GENEL'); });
      return r ? r.bi : null;
    };
    var cumN = 0, cumP = 0, sN = null;
    for (var k = 1; k <= n; k++) {
      var v = sat(k); if (v == null) return null;
      cumN += v; if (k < n) cumP += v; else sN = v;
    }
    var biN = bi(2 * n); if (!biN) return null;
    if (n === 1) return biN;
    var biP = bi(2 * (n - 1)); if (!biP) return null;
    var base = cumN / biN * 100 - cumP / biP * 100;       // geçen yıl aynı dönem satışı
    return base > 0 ? sN / base * 100 : null;
  }
  function gigiDonemFormul(ttt, n) {
    var g = _growth(ttt, n), gn = _growth('NATIONAL', n);
    return (g && gn) ? g / gn * 100 : null;
  }

  // @returns {mi, gi, source:'final'|'estimate', donem:'MM/YYYY'|null, giFallback:bool, giNote:string} | null
  function getMiGiOtomatik(ttt, periodKey) {
    var per = null, key = periodKey;
    if (!key && typeof getEffectivePeriod === 'function') { var ep = getEffectivePeriod(); key = ep && ep.key; }
    if (key && typeof PERIODS !== 'undefined') per = PERIODS.find(function (x) { return x.key === key; }) || null;
    if (per) {
      var fin = getMiGiDonem(ttt, per.start.slice(0, 4), key);
      if (fin) return { mi: fin.mi, gi: fin.gi, source: 'final', donem: null, giFallback: false };
    }
    var num = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
    var endNum = per ? (+per.end.slice(0, 4)) * 100 + (+per.end.slice(5, 7)) : 999999;
    var nm = _name(ttt);
    var rows = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(function (r) {
      return _name(r.person) === nm && r.ilac === 'GENEL' && r.mi > 0 && num(r.donem) <= endNum;
    });
    if (!rows.length) return null;
    var last = rows.reduce(function (a, r) { return num(r.donem) > num(a.donem) ? r : a; });
    var nat = (window.MIGI_TL_NATIONAL || []).find(function (r) { return r.donem === last.donem && r.bi > 0; });
    var gi = null, giNote = '';
    // 1) PDF formülü, dönem bazlı (bu dönem yoksa en yakın tamamlanmış önceki dönem)
    for (var n = PNO[key] || 0; n >= 1 && gi == null; n--) {
      var gf = gigiDonemFormul(ttt, n);
      if (gf != null) { gi = gf; giNote = 'GIGI: ' + n + '. dönem formülü (TTT büyümesi ÷ National büyümesi)' + (n !== PNO[key] ? ' — bu dönem verisi henüz yok' : ''); }
    }
    // 2) Yedek: son ay YTD Büyüme İndeksi ÷ National (dönem bazlı değil, kaba)
    if (gi == null && last.bi > 0 && nat) { gi = last.bi / nat.bi * 100; giNote = 'GIGI: YTD büyüme ÷ National (kaba)'; }
    return { mi: last.mi, gi: gi != null ? gi : 100, source: 'estimate', donem: last.donem, giFallback: gi == null, giNote: giNote };
  }

  window.getMiGiOtomatik   = getMiGiOtomatik;
  window.gigiDonemFormul   = gigiDonemFormul;
  window.parseMiGiDonemCSV = parseMiGiDonemCSV;
  window.loadMiGiDonem     = loadMiGiDonem;
  window.getMiGiDonem      = getMiGiDonem;
  window.migiDonemYears    = migiDonemYears;
  window.yearOfPeriodKey   = yearOfPeriodKey;
})();
