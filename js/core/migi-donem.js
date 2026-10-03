// ══════════════════════════════════════════════════════════════════════
//  js/core/migi-donem.js — Dönemsel MI & GIGI (MI_GIGI.csv)
//
//  İŞ KURALI (2026 İLKO TTT Prim sunumu):
//    MI   (Market İndeksi)       = TTT Pazar Payı ÷ Türkiye (National) Pazar Payı × 100
//                                  Pazar Payı = dönem satışı ÷ dönem pazarı (2 aylık)
//    GIGI (Grup İçi Gelişim İnd.) = (TTT son dönem satışı ÷ TTT geçen yıl aynı dönem)
//                                  ÷ (National son dönem ÷ National geçen yıl aynı dönem) × 100
//    Prim, dönem bitiminden 2 ay sonra gelen kesinleşmiş IMS ile kesinleşir.
//
//  MI_GIGI.csv — İKİ BİÇİM desteklenir (otomatik algılanır):
//   1) YENİ (ham veri; MI & GIGI KODDA hesaplanır — önerilen):
//        " 1D ; TÜM ÜRÜNLER TOPLAM [TL] ;..."  blokları. Her blokta üç yıl grubu
//        (2025/2026/2027 · 8'er sütun: HEDEF · SATIŞ · REAL · PRİM P. · PAZAR P. · PAZAR ·
//        ay1 SATIŞ · ay2 SATIŞ). Yeni dönem/yıl verisi eklenince sistem kendiliğinden hesaplar.
//   2) ESKİ (hazır sonuç): "2026;1D;;2D;..." → ";MI;GIGI;..." satırları.
//  Sütun/blok → PERIODS anahtarı: 1D→1d, 2D→2d, 3D→k1, 4D→4d, 5D→5d, 6D→k2
//
//  Public API (window): MIGI_RAW (yeni biçim ham veri), MIGI_DONEM (kesin MI/GIGI),
//    parseMiGiDonemCSV(text), loadMiGiDonem(), getMiGiDonem(ttt, year, key) → {mi, gi, primP?} | null,
//    getMiGiOtomatik(ttt, key) → kesin ya da TAHMİN, gigiDonemFormul, migiDonemYears, yearOfPeriodKey
//  Bağımlılık: constants.js (GS_MIGI_DONEM_URL), date-utils.js (PERIODS)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._MIGI_DONEM_LOADED) return;
  window._MIGI_DONEM_LOADED = true;

  var COL_KEYS = { '1D': '1d', '2D': '2d', '3D': 'k1', '4D': '4d', '5D': '5d', '6D': 'k2' };
  var PNO  = { '1d': 1, '2d': 2, 'k1': 3, '4d': 4, '5d': 5, 'k2': 6 };
  var PKEY = ['', '1d', '2d', 'k1', '4d', '5d', 'k2'];

  // MIGI_DONEM: { '2026': { '1d': { 'AYKUT DİNLER': {mi, gi, primP, ...} | null } } }  (yalnız KESİNLEŞMİŞ dönemler)
  // MIGI_RAW  : { '1d': { 'AYKUT DİNLER': { '2025': {hedef,satis,real,primP,pazarPay,pazar}, '2026': {...} } } }
  window.MIGI_DONEM = {};
  window.MIGI_RAW = {};
  window.MIGI_TL_NATIONAL = window.MIGI_TL_NATIONAL || [];   // NATIONAL satırları (data-loader doldurur)

  function _num(s) {
    s = String(s == null ? '' : s).trim().replace('%', '').replace(/\s/g, '');
    if (!s || s === '-') return null;
    if (s.indexOf(',') === -1 && /^\d+\.\d{1,2}$/.test(s)) return parseFloat(s);   // "102.81"
    var v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(v) ? null : v;
  }
  function _name(s) { return String(s || '').trim().toLocaleUpperCase('tr-TR'); }

  // ── ESKİ biçim (hazır MI/GIGI sonuçları) ──────────────────────
  function _parseOld(text) {
    var out = {};
    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    var year = null, cols = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim() || !line.replace(/;/g, '').trim()) continue;
      var c = line.split(';').map(function (x) { return x.trim(); });
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
      if (!c[0] && /^MI$/i.test(c[1] || '')) continue;
      if (!year || !c[0] || !cols.length) continue;
      var nm = _name(c[0]);
      cols.forEach(function (cc) {
        var mi = _num(c[cc.miIdx]), gi = _num(c[cc.giIdx]);
        out[year][cc.key][nm] = (mi > 0 && gi > 0) ? { mi: mi, gi: gi } : null;
      });
    }
    return out;
  }

  // ── YENİ biçim (ham veri) ─────────────────────────────────────
  function _parseRaw(text) {
    var raw = {}, cur = null, groups = [];
    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    lines.forEach(function (line) {
      if (!line.replace(/;/g, '').trim()) return;
      var c = line.split(';').map(function (x) { return x.trim(); });
      if (/^\dD$/i.test(c[0]) && /TÜM ÜRÜNLER/i.test(c[1] || '')) {          // blok başlığı: "1D ; TÜM ÜRÜNLER TOPLAM [TL]"
        cur = COL_KEYS[c[0].toUpperCase()] || null; groups = []; if (cur && !raw[cur]) raw[cur] = {}; return;
      }
      if (!cur) return;
      if (!c[0] && c.some(function (x) { return /^\d{4}\/\dD$/i.test(x); })) {  // "; 2025/1D ;...; 2026/1D ;..."
        groups = [];
        c.forEach(function (x, i) { var m = /^(\d{4})\/\dD$/i.exec(x); if (m) groups.push({ year: m[1], idx: i }); });
        return;
      }
      if (!c[0] || /^PERSONEL$/i.test(c[0]) || !groups.length) return;
      var nm = _name(c[0]);
      groups.forEach(function (g) {
        var sat = _num(c[g.idx + 1]);
        if (!(sat > 0)) return;
        if (!raw[cur][nm]) raw[cur][nm] = {};
        raw[cur][nm][g.year] = { hedef: _num(c[g.idx]), satis: sat, real: _num(c[g.idx + 2]), primP: _num(c[g.idx + 3]),
                                 pazarPay: _num(c[g.idx + 4]), pazar: _num(c[g.idx + 5]) };
      });
    });
    return raw;
  }

  // Ham veriden KESİN MI & GIGI (yalnız o yılın satışı + pazarı + geçen yıl satışı olanlar)
  function _computeFinal(raw) {
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var blk = raw[key], nat = blk['NATIONAL'];
      if (!nat) return;
      Object.keys(blk).forEach(function (nm) {
        Object.keys(blk[nm]).forEach(function (y) {
          var py = String(+y - 1), cur = blk[nm][y], prev = blk[nm][py], nc = nat[y], np = nat[py];
          if (!(cur && prev && nc && np && cur.pazar > 0 && nc.pazar > 0 && prev.satis > 0 && np.satis > 0)) return;
          var mi = (cur.satis / cur.pazar) / (nc.satis / nc.pazar) * 100;
          var gi = (cur.satis / prev.satis) / (nc.satis / np.satis) * 100;
          if (!out[y]) out[y] = {};
          if (!out[y][key]) out[y][key] = {};
          out[y][key][nm] = { mi: mi, gi: gi, primP: cur.primP > 0 ? cur.primP : null, hedef: cur.hedef, satis: cur.satis, real: cur.real };
        });
      });
    });
    return out;
  }

  // Giriş noktası: biçimi algıla → MIGI_RAW (yan etki) + kesin MI/GIGI döndür
  function parseMiGiDonemCSV(text) {
    window.MIGI_RAW = {};
    if (!text || String(text).trim().charAt(0) === '<') return {};      // 404 HTML sayfası
    if (/TÜM ÜRÜNLER TOPLAM\s*\[TL\]/i.test(text)) {
      window.MIGI_RAW = _parseRaw(text);
      return _computeFinal(window.MIGI_RAW);
    }
    return _parseOld(text);
  }

  function getMiGiDonem(ttt, year, periodKey) {
    var y = window.MIGI_DONEM[String(year)];
    var p = y && y[periodKey];
    return (p && p[_name(ttt)]) || null;
  }
  function migiDonemYears() { return Object.keys(window.MIGI_DONEM).sort(); }
  function yearOfPeriodKey(periodKey) {
    var per = (typeof PERIODS !== 'undefined' ? PERIODS : []).find(function (x) { return x.key === periodKey; });
    return per ? per.start.slice(0, 4) : String(new Date().getFullYear());
  }

  function loadMiGiDonem() {
    if (typeof fetch !== 'function' || typeof GS_MIGI_DONEM_URL === 'undefined') return Promise.resolve(false);
    return fetch(GS_MIGI_DONEM_URL + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : ''; })
      .then(function (txt) {
        var parsed = parseMiGiDonemCSV(txt);
        if (!Object.keys(parsed).length && !Object.keys(window.MIGI_RAW).length) return false;
        window.MIGI_DONEM = parsed;
        console.log('[migi-donem] MI_GIGI.csv yüklendi:', migiDonemYears().join(', ') || '(kesin dönem yok)');
        if (typeof window.renderPrimGecmis === 'function') window.renderPrimGecmis();
        return true;
      })
      .catch(function (e) { console.warn('[migi-donem] yüklenemedi (sessiz):', e && e.message); return false; });
  }

  // ── OTOMATİK (TAHMİN) ─────────────────────────────────────────
  // Kesin değer (MI_GIGI.csv'de o dönemin 2026 pazarı+satışı) gelene kadar:
  //   GIGI → PDF formülü: YTD_TL.csv'deki dönem satışı ÷ MI_GIGI.csv'deki geçen yıl aynı dönem
  //          satışı (TTT ve National). Geçen yıl verisi yoksa → eski Büyüme-İndeksi türetmesi → kaba oran.
  //   MI   → (dönem pazarı henüz yok) sistemdeki son MI (MI_GI_TL_TOPLAM.csv, YTD) → yoksa son kesin dönem MI.
  function _ytdSatis(person, key) {
    var d = window.YTD_TL_DATA; if (!d || !d.data) return null;
    var rows = d.data[PNO[key] + '.DÖNEM']; if (!rows) return null;
    var nm = _name(person);
    var r = rows.find(function (x) { return _name(x.personel) === nm; });
    var t = r && r.products && r.products.TOPLAM;
    return (t && t.satis > 0) ? t.satis : null;
  }
  function _gigiFromRawBase(ttt, key) {
    var blk = window.MIGI_RAW && window.MIGI_RAW[key]; if (!blk) return null;
    var nm = _name(ttt);
    var b = blk[nm] && blk[nm]['2025'], bn = blk['NATIONAL'] && blk['NATIONAL']['2025'];
    var s = _ytdSatis(ttt, key), sn = _ytdSatis('NATIONAL', key);
    if (!(b && bn && b.satis > 0 && bn.satis > 0 && s && sn)) return null;
    return (s / b.satis) / (sn / bn.satis) * 100;
  }

  // Eski türetme (MI_GI_TL_TOPLAM Büyüme İndeksi'nden; yalnız yeni biçim verisi yokken yedek)
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
    for (var k = 1; k <= n; k++) { var v = sat(k); if (v == null) return null; cumN += v; if (k < n) cumP += v; else sN = v; }
    var biN = bi(2 * n); if (!biN) return null;
    if (n === 1) return biN;
    var biP = bi(2 * (n - 1)); if (!biP) return null;
    var base = cumN / biN * 100 - cumP / biP * 100;
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
    var year = per ? per.start.slice(0, 4) : String(new Date().getFullYear());
    if (per) {
      var fin = getMiGiDonem(ttt, year, key);
      if (fin) return { mi: fin.mi, gi: fin.gi, source: 'final', donem: null, giFallback: false, giNote: '' };
    }
    var cur = PNO[key] || 0, nm = _name(ttt);

    // MI: sistemdeki son MI (YTD) → yoksa en yakın önceki KESİN dönem MI
    var num = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
    var endNum = per ? (+per.end.slice(0, 4)) * 100 + (+per.end.slice(5, 7)) : 999999;
    var rows = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(function (r) {
      return _name(r.person) === nm && r.ilac === 'GENEL' && r.mi > 0 && num(r.donem) <= endNum;
    });
    var mi = null, donem = null, miNote = '';
    if (rows.length) {
      var last = rows.reduce(function (a, r) { return num(r.donem) > num(a.donem) ? r : a; });
      mi = last.mi; donem = last.donem; miNote = 'MI: ' + last.donem + ' YTD (eski tablo)';
    } else {
      for (var m = cur - 1; m >= 1 && mi == null; m--) {
        var f = getMiGiDonem(ttt, year, PKEY[m]);
        if (f) { mi = f.mi; miNote = 'MI: ' + m + '. dönem kesin değeri'; }
      }
    }
    if (mi == null) return null;

    // GIGI: bu dönem → (yoksa) en yakın önceki tamamlanmış dönem
    var gi = null, giNote = '';
    for (var n = cur; n >= 1 && gi == null; n--) {
      var k = PKEY[n], tag = (n !== cur) ? ' — bu dönem verisi henüz yok' : '';
      var fk = (n < cur) ? getMiGiDonem(ttt, year, k) : null;
      if (fk) { gi = fk.gi; giNote = 'GIGI: ' + n + '. dönem kesin değeri' + tag; continue; }
      var g1 = _gigiFromRawBase(ttt, k);
      if (g1 != null) { gi = g1; giNote = 'GIGI: ' + n + '. dönem — YTD_TL satışı ÷ 2025 aynı dönem (National ile kıyas)' + tag; continue; }
      var g2 = gigiDonemFormul(ttt, n);
      if (g2 != null) { gi = g2; giNote = 'GIGI: ' + n + '. dönem büyüme formülü (eski tablo)' + tag; }
    }
    return { mi: mi, gi: gi != null ? gi : 100, source: 'estimate', donem: donem, giFallback: gi == null, giNote: giNote || miNote };
  }

  window.getMiGiOtomatik   = getMiGiOtomatik;
  window.gigiDonemFormul   = gigiDonemFormul;
  window.parseMiGiDonemCSV = parseMiGiDonemCSV;
  window.loadMiGiDonem     = loadMiGiDonem;
  window.getMiGiDonem      = getMiGiDonem;
  window.migiDonemYears    = migiDonemYears;
  window.yearOfPeriodKey   = yearOfPeriodKey;
})();
