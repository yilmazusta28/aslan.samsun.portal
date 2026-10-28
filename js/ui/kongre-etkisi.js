// ══════════════════════════════════════════════════════════════════════
//  js/ui/kongre-etkisi.js — Kongre Etkisi Analizi ("kongre karşılığını buldu mu?")
//
//  NEREDE GÖRÜNÜR
//    • Temsilci  : Performans › 🎪 Kongre Etkisi        (#perfKongreEtkisi)
//    • Yönetici  : "AI Eğitim Girdileri Özeti" kartından hemen sonra (#mgrKongreEtkisi)
//
//  KAYNAKLAR (repo kökü, ';' ayraçlı, Türkçe sayı biçimi — YENI IMS .xlsm'den otomasyonla gelir)
//    KONGRE_TAKIP_1.csv : kongre × ürün × TTT × brick için AYLIK kutu, pazar payı (geçen yıl / bu yıl) ve
//                         EVO indeksi; sağda YTD pazar payı + EVO. Ay başlıklarından okunur ("OCAK 26" …).
//    KONGRE_TAKIP_2.csv : kongreye katılan hekimler + bulundukları BRICK'in ürün bazlı YTD karşılaştırması
//                         (PANOCER / ACIDPASS / GRIPORT COLD: YTD-2 = geçen yıl, YTD-1 = bu yıl kutu, pazar payı,
//                         EVO, TL; ayrıca TÜM ÜRÜNLER pazar payı/EVO).
//
//  YÖNTEM — KONGRE TARİHİNDEN BAĞIMSIZ, BÖLGE (KONTROL GRUBU) KIYASLI
//    Karar: kongreye hekim gönderilen brick–ürün, hiç hekim gönderilmeyen bölge bricklerinin (MI_GI-KUTU.csv)
//    medyanıyla kıyaslanır: (EVO farkı ±10 puan) + (kutu büyüme indeksi farkı ±10 puan) → İvme/Pozitif/Nötr/Zayıflama/Düşüş.
//    Bölge verisi yoksa yalnızca geçen yıla göre (Kutu YoY ±%10 + EVO 110/90) karar verilir.
//    6 aylık dönemler: 1. altı ay (Oca–Haz), 2. altı ay (Tem–…), toplam; dönem EVO'su aylık veriden hesaplanır.
//    Grup düzeyi: ürün bazında kongre vs kontrol medyan farkı + permütasyon p-değeri + fark seyri (seçilim kontrolü).
//    Güven: hacim + kontrol büyüklüğü + sinyal uyumu. Oranlar benzersiz brick–ürün üzerinden.
//  Not: Analiz kongre ile tutarlı sinyali gösterir; tek başına nedensellik kanıtı değildir.
//
//  GİZLİLİK: ttt-lock.js kuralı — kilitli temsilci yalnızca KENDİ satırlarını görür (arayüz kısıtı).
//  Bağımlılık: yok (isTttLocked / LOGGED_IN_USER varsa kullanır). Classic script, ES module yok.
//  Public API: window.renderKongreEtkisi(mount?), window.renderKongreEtkisiManager(), window.PVKongre
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._KONGRE_ETKISI_LOADED) return;
  window._KONGRE_ETKISI_LOADED = true;

  var SRC1 = './KONGRE_TAKIP_1.csv';
  var SRC2 = './KONGRE_TAKIP_2.csv';
  var AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var AY_KEY = ['OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN', 'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'];
  var PROD_BLOCKS = ['PANOCER', 'ACIDPASS', 'GRIPORT COLD'];     // KONGRE_TAKIP_2'de YTD bloğu olan ürünler
  var SRC_MI = './MI_GI-KUTU.csv';            // bölgedeki TÜM brick × ürün (kontrol grubu için)
  var ESIK = { kutuPct: 10, evoUst: 110, evoAlt: 90, momFark: 5, dusukHacim: 200, bolgeEvo: 10, bolgeBuy: 10, minKontrol: 8, permIter: 2000 };

  var VERDICT = {
    ivme:    { lbl: 'İVME YAKALADI', ic: '🚀', c: '#15803D', bg: 'rgba(22,163,74,.15)',   rank: 5 },
    pozitif: { lbl: 'POZİTİF',       ic: '📈', c: '#16A34A', bg: 'rgba(34,197,94,.12)',   rank: 4 },
    notr:    { lbl: 'NÖTR',          ic: '➖', c: '#64748B', bg: 'rgba(100,116,139,.15)', rank: 3 },
    zayif:   { lbl: 'ZAYIFLAMA',     ic: '⚠️', c: '#D97706', bg: 'rgba(245,158,11,.17)',  rank: 2 },
    dusus:   { lbl: 'DÜŞÜŞ',         ic: '📉', c: '#DC2626', bg: 'rgba(239,68,68,.15)',   rank: 1 },
    veri:    { lbl: 'VERİ YETERSİZ', ic: '❔', c: '#64748B', bg: 'rgba(100,116,139,.12)', rank: -1 }
  };
  var OLCULEN = ['ivme', 'pozitif', 'notr', 'zayif', 'dusus'];

  var D = null;               // { units, att, kongreler, err }
  var loadPromise = null;
  var RAW = { k1: '', k2: '' };   // ham CSV metinleri (Excel indirme yedeği için)
  var ST = {
    rep: { ttt: null, urun: '', kongre: '', sonuc: '', hekim: '', sirala: 'iyi' },
    mgr: { ttt: '', urun: '', kongre: '', sonuc: '', hekim: '', sirala: 'iyi' }
  };

  // ───────────────────────── yardımcılar ─────────────────────────
  function key(s) {
    return String(s == null ? '' : s)
      .replace(/İ/g, 'I').replace(/ı/g, 'I').toUpperCase()
      .replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
      .replace(/Ö/g, 'O').replace(/Ç/g, 'C').replace(/\s+/g, ' ').trim();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function numN(v) {
    var s = String(v == null ? '' : v).replace('%', '').replace(/\s/g, '');
    if (!s || s === '-') return null;
    var n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function sgn(n, d) {
    if (n == null || isNaN(n)) return '—';
    var t = fmt(Math.abs(n), d || 0);
    return (n > 0 ? '+' : (n < 0 ? '−' : '')) + t;
  }
  function grid(text) {
    return String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
      .filter(function (l) { return l.replace(/;/g, '').trim().length; })
      .map(function (l) { return l.split(';').map(function (s) { return s.trim(); }); });
  }
  function mean(a) {
    a = a.filter(function (v) { return v != null; });
    return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null;
  }

  // ───────────────────────── CSV ayrıştırma ─────────────────────────
  function parse1(text) {
    var g = grid(text), hi = -1, i, m;
    for (i = 0; i < g.length; i++) { if (key(g[i][0]).indexOf('KONGRE ADI') === 0) { hi = i; break; } }
    if (hi < 0) throw new Error('KONGRE_TAKIP_1: "KONGRE ADI" başlık satırı bulunamadı');
    var mc = {}, ytd = -1;
    g[hi].forEach(function (c, ci) {
      var k = key(c), mm = /^([A-Z]+) (\d{2})$/.exec(k);
      if (mm) { var ai = AY_KEY.indexOf(mm[1]); if (ai >= 0) mc[ai + 1] = ci; }
      else if (k === 'YTD') ytd = ci;
    });
    var rows = [], seen = {};
    for (i = hi + 2; i < g.length; i++) {          // hi+1 = alt başlık (KUTU SATIŞ / PAZAR PAYI …)
      var r = g[i], kg = r[0], ur = r[1], tt = r[2], br = r[3];
      if (!kg || kg === '0' || !ur || ur === '0' || !tt || tt === '0') continue;
      var id = [key(kg), key(ur), key(tt), key(br)].join('|');
      if (seen[id]) continue;                         // aynı brick'e giden birden çok hekim → tek satır
      seen[id] = 1;
      var ay = [null];
      for (m = 1; m <= 12; m++) {
        var c = mc[m];
        if (c == null) { ay[m] = { has: false }; continue; }
        var kutu = numN(r[c]);
        ay[m] = { has: (r[c] !== '' && kutu !== null), kutu: kutu, ms25: numN(r[c + 1]), ms26: numN(r[c + 2]), evo: numN(r[c + 3]) };
      }
      rows.push({
        id: id, kongre: kg, urun: ur, ttt: tt, brick: br, ay: ay,
        ytd: ytd >= 0 ? { kutu: numN(r[ytd]), ms25: numN(r[ytd + 1]), ms26: numN(r[ytd + 2]), evo: numN(r[ytd + 3]) } : null
      });
    }
    return rows;
  }

  function blockStarts(g, hi) {
    var out = [], r;
    for (r = 0; r < hi; r++) {
      g[r].forEach(function (c, ci) {
        var k = key(c);
        if (!k || k.slice(-4) !== 'KUTU') return;
        var u = null;
        if (k.indexOf('PANOCER') >= 0) u = 'PANOCER';
        else if (k.indexOf('ACIDPASS') >= 0) u = 'ACIDPASS';
        else if (k.indexOf('COLD') >= 0) u = 'GRIPORT COLD';
        else if (k.indexOf('TUMURUN') >= 0) u = 'TUM';
        if (u) out.push({ urun: u, col: ci });
      });
    }
    return out;
  }
  function blockVals(r, b) {
    var c = b.col;
    if (b.urun === 'TUM') return { ms25: numN(r[c]), ms26: numN(r[c + 1]), evo: numN(r[c + 2]), tl: numN(r[c + 3]) };
    return { k25: numN(r[c]), k26: numN(r[c + 1]), ms25: numN(r[c + 2]), ms26: numN(r[c + 3]), evo: numN(r[c + 4]), tl: numN(r[c + 5]) };
  }
  function hasNum(o) { return !!o && Object.keys(o).some(function (k) { return o[k] != null; }); }

  function parse2(text) {
    var g = grid(text), hi = -1, i;
    for (i = 0; i < g.length; i++) { if (key(g[i][0]) === 'TOPLANTI / KONGRE') { hi = i; break; } }
    if (hi < 0) throw new Error('KONGRE_TAKIP_2: "TOPLANTI / KONGRE" başlık satırı bulunamadı');
    var ix = {};
    g[hi].forEach(function (c, ci) { var k = key(c); if (ix[k] == null) ix[k] = ci; });
    function cell(r, name) { var c = ix[name]; return c == null ? '' : (r[c] || ''); }
    var blocks = blockStarts(g, hi);
    var att = {}, kongreAd = {}, grp = {}, bl = {};
    for (i = hi + 1; i < g.length; i++) {
      var r = g[i], kg = r[0];
      if (!kg || kg === '0') continue;
      kongreAd[key(kg)] = kg;
      var tt = cell(r, 'TTT ADI'), br = cell(r, 'BRICK'), ad = cell(r, 'AD-SOYAD');
      if (!tt) continue;
      var bk = key(tt) + '|' + key(br) + '|';
      blocks.forEach(function (b) {                       // brick bazlı YTD blokları (aynı brick'te hekimler aynı sayıyı taşır)
        var v = blockVals(r, b), k = bk + (b.urun === 'TUM' ? 'TUM' : key(b.urun));
        if (hasNum(v) && !hasNum(bl[k])) bl[k] = v;
      });
      var gk = [key(kg), key(tt), key(br)].join('|');
      var gg = grp[gk] || (grp[gk] = { kongre: kg, ttt: tt, brick: br, urunler: {} });
      var u1 = cell(r, 'URUN 1'), u2 = cell(r, 'URUN 2');
      [u1, u2].forEach(function (u) { if (u) gg.urunler[u] = 1; });
      if (!ad) continue;
      var a = att[gk] || (att[gk] = { sayi: 0, hekimler: [], urunler: {}, _s: {} });
      var dk = key(ad) + '|' + key(cell(r, 'UNITE')), prods = [u1, u2].filter(Boolean);
      if (a._s[dk]) {      // aynı hekim başka satırda tekrar geçiyorsa yalnızca ürünlerini birleştir
        prods.forEach(function (pr) { if (a._s[dk].urunler.indexOf(pr) < 0) a._s[dk].urunler.push(pr); });
      } else {
        var hk = { ad: ad, unvan: cell(r, 'UNVAN'), brans: cell(r, 'BRANS'), unite: cell(r, 'UNITE'), il: cell(r, 'HEKIMIN BULUNDUGU IL'), urunler: prods.slice() };
        a._s[dk] = hk; a.sayi++; a.hekimler.push(hk);
      }
      prods.forEach(function (pr) { a.urunler[pr] = 1; });
    }
    return { att: att, kongreAd: kongreAd, grp: grp, blocks: bl };
  }

  // MI_GI-KUTU.csv: bölgedeki tüm brick × ürün için aylık (kümülatif) BÜYÜME / EVO / MARKET / PAZAR PAYI indeksleri
  function parseMi(text) {
    var g = grid(text), hi = -1, i, c;
    for (i = 0; i < g.length; i++) { if (key(g[i][0]).indexOf('333 SIRA') === 0) { hi = i; break; } }
    if (hi < 2) throw new Error('MI_GI-KUTU: başlık satırları bulunamadı');
    var rm = g[hi - 2], rt = g[hi - 1], rp = g[hi], curM = null, curT = null, cols = [];
    for (c = 4; c < rp.length; c++) {
      if (rm[c]) { var pr = key(rm[c]).split(' '), ai = AY_KEY.indexOf(pr[pr.length - 1]); if (ai >= 0) curM = ai + 1; }
      if (rt[c]) { var k = key(rt[c]); curT = k.indexOf('BUYUME') >= 0 ? 'buy' : (k.indexOf('EVOL') >= 0 ? 'evo' : (k.indexOf('MARKET') >= 0 ? 'mkt' : (k.indexOf('PAZAR') >= 0 ? 'pay' : null))); }
      if (rp[c] && curM && curT) cols.push({ c: c, m: curM, t: curT, p: key(rp[c]) });
    }
    var rows = {}, bricks = [];
    for (i = hi + 1; i < g.length; i++) {
      var r = g[i]; if (!r[3]) continue;
      var tb = key(r[2]) + '|' + key(r[3]), o = {};
      bricks.push(tb);
      cols.forEach(function (x) {
        var v = numN(r[x.c]); if (v == null) return;
        var pm = o[x.p] || (o[x.p] = {}), mm = pm[x.m] || (pm[x.m] = {});
        mm[x.t] = v;
      });
      rows[tb] = o;
    }
    return { rows: rows, bricks: bricks };
  }

  function medianOf(a) {
    if (!a.length) return null;
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // İki grubun medyan farkı için permütasyon p-değeri (iki yönlü) — "bu fark şansa bağlı olabilir mi?"
  function permP(A, C, iters) {
    if (A.length < 2 || C.length < 2) return null;
    var all = A.concat(C), nA = A.length, obs = Math.abs(medianOf(A) - medianOf(C)), cnt = 0, rnd = rng(20261026), i, j, k, t;
    for (i = 0; i < iters; i++) {
      for (j = all.length - 1; j > 0; j--) { k = Math.floor(rnd() * (j + 1)); t = all[j]; all[j] = all[k]; all[k] = t; }
      if (Math.abs(medianOf(all.slice(0, nA)) - medianOf(all.slice(nA))) >= obs - 1e-9) cnt++;
    }
    return (cnt + 1) / (iters + 1);
  }

  // Kontrol grubu: hiç hekim gönderilmeyen bricklerin ürün bazlı aylık medyanları + bölge dağılımı
  function buildRegion(mi, att, units) {
    var expAny = {}, expProd = {}, R = { mi: mi, ctrl: {}, all: {}, meta: {}, expProd: expProd, expAny: expAny, grp: [] };
    Object.keys(att).forEach(function (gk) { var p = gk.split('|'); expAny[p[1] + '|' + p[2]] = 1; });
    units.forEach(function (u) { var tb = key(u.ttt) + '|' + key(u.brick); expAny[tb] = 1; (expProd[key(u.urun)] = expProd[key(u.urun)] || {})[tb] = 1; });
    Object.keys(D && D.agg ? D.agg : {}).forEach(function (k) { var p = k.split('|'); (expProd[p[2]] = expProd[p[2]] || {})[p[0] + '|' + p[1]] = 1; });
    var prods = {};
    Object.keys(mi.rows).forEach(function (tb) { Object.keys(mi.rows[tb]).forEach(function (pk) { prods[pk] = 1; }); });
    Object.keys(prods).forEach(function (pk) {
      var months = {};
      Object.keys(mi.rows).forEach(function (tb) {
        var pm = mi.rows[tb][pk]; if (!pm) return;
        Object.keys(pm).forEach(function (m) {
          if (pm[m].evo == null) return;
          var A = R.all[pk + '|' + m] || (R.all[pk + '|' + m] = { evo: [] });
          A.evo.push(pm[m].evo); months[m] = (months[m] || 0) + 1;
          if (!expAny[tb]) {
            var C = R.ctrl[pk + '|' + m] || (R.ctrl[pk + '|' + m] = { evo: [], buy: [] });
            C.evo.push(pm[m].evo); if (pm[m].buy != null) C.buy.push(pm[m].buy);
          }
        });
      });
      var ms = Object.keys(months).map(Number).filter(function (m) { return months[m] >= 10; }).sort(function (a, b) { return a - b; });
      if (ms.length) R.meta[pk] = { months: ms, late: ms[ms.length - 1], early: ms.length >= 3 ? ms[1] : ms[0] };
    });
    // grup düzeyi: kongre brickleri vs kontrol — ürün bazında
    Object.keys(R.meta).forEach(function (pk) {
      var meta = R.meta[pk], tbs = Object.keys(expProd[pk] || {}).filter(function (tb) { return mi.rows[tb] && mi.rows[tb][pk]; });
      function vals(m) {
        var A = [];
        tbs.forEach(function (tb) { var v = mi.rows[tb][pk][m]; if (v && v.evo != null) A.push(v.evo); });
        var C = R.ctrl[pk + '|' + m];
        return { A: A, C: C ? C.evo : [] };
      }
      var L = vals(meta.late);
      if (!L.A.length || L.C.length < ESIK.minKontrol) return;
      var seri = meta.months.map(function (m) { var v = vals(m); return (v.A.length && v.C.length >= ESIK.minKontrol) ? { m: m, gap: medianOf(v.A) - medianOf(v.C), a: medianOf(v.A), c: medianOf(v.C) } : null; }).filter(Boolean);
      R.grp.push({ pk: pk, late: meta.late, nA: L.A.length, nC: L.C.length, medA: medianOf(L.A), medC: medianOf(L.C), gap: medianOf(L.A) - medianOf(L.C), seri: seri, p: permP(L.A, L.C, ESIK.permIter) });
    });
    return R;
  }

  // Bölge kıyası sonucundan (bolgeAt çıktısı) 5'li karar: EVO farkı ve kutu büyüme farkı, her biri ±10 puan eşikli
  function durumFromBolge(b) {
    if (!b) return null;
    var rE = b.relEvo >= ESIK.bolgeEvo ? 1 : (b.relEvo <= -ESIK.bolgeEvo ? -1 : 0);
    var rB = b.relBuy == null ? null : (b.relBuy >= ESIK.bolgeBuy ? 1 : (b.relBuy <= -ESIK.bolgeBuy ? -1 : 0));
    if (rB == null) return { d: rE > 0 ? 'pozitif' : (rE < 0 ? 'zayif' : 'notr'), tek: true, karisik: false };
    var t = rE + rB;
    return { d: t >= 2 ? 'ivme' : t === 1 ? 'pozitif' : t === 0 ? 'notr' : t === -1 ? 'zayif' : 'dusus', tek: false, karisik: (rE * rB === -1) };
  }

  // Bir brick–ürünün belirli ayda (kümülatif) bölgeye göre durumu
  function bolgeAt(u, m) {
    if (!D || !D.reg) return null;
    var R = D.reg, tb = key(u.ttt) + '|' + key(u.brick), pk = key(u.urun), row = R.mi.rows[tb];
    if (!row || !row[pk] || !row[pk][m] || row[pk][m].evo == null) return null;
    var C = R.ctrl[pk + '|' + m], A = R.all[pk + '|' + m];
    if (!C || C.evo.length < ESIK.minKontrol) return null;
    var v = row[pk][m], mb = medianOf(C.buy);
    var le = A.evo.filter(function (x) { return x <= v.evo; }).length;
    return { m: m, evo: v.evo, buy: v.buy, ctrlEvo: medianOf(C.evo), ctrlBuy: mb, n: C.evo.length, nAll: A.evo.length,
      relEvo: v.evo - medianOf(C.evo), relBuy: (v.buy != null && mb != null) ? v.buy - mb : null, pct: Math.round(le / A.evo.length * 100) };
  }
  function bolgeOf(u) {
    if (!D || !D.reg) return null;
    var meta = D.reg.meta[key(u.urun)]; if (!meta) return null;
    var b = bolgeAt(u, meta.late); if (!b) return null;
    var e = bolgeAt(u, meta.early); b.relEvoEarly = e ? e.relEvo : null; b.earlyM = e ? e.m : null;
    return b;
  }

  // ───────────────────────── 6 aylık dönemler ─────────────────────────
  var DONEM = [{ k: 'h1', ad: '1. Altı Ay', a: 1, b: 6 }, { k: 'h2', ad: '2. Altı Ay', a: 7, b: 12 }];
  // Dönem EVO'suna göre derece (tek metrik; geçen yıla göre pazara göre gelişim)
  function gradeEvo(e) { return e == null ? 'veri' : (e >= 125 ? 'ivme' : (e >= 110 ? 'pozitif' : (e > 90 ? 'notr' : (e > 75 ? 'zayif' : 'dusus')))); }
  // Dönem içindeki aylar için kutu toplamı, pazar payı (pazar büyüklüğüyle ağırlıklı), EVO
  function periodStats(u, a, b) {
    if (!u.ay) return null;
    var L = [], m;
    for (m = a; m <= b; m++) { var d = u.ay[m]; if (d && d.has && d.kutu != null) L.push({ m: m, d: d }); }
    if (!L.length) return null;
    var kutu = L.reduce(function (s2, x) { return s2 + x.d.kutu; }, 0), W = 0, S26 = 0, S25 = 0, ms26, ms25;
    L.forEach(function (x) {
      var d = x.d;
      if (d.ms26 != null && d.ms26 > 0 && d.kutu > 0 && d.ms25 != null) { var mk = d.kutu / (d.ms26 / 100); W += mk; S26 += d.kutu; S25 += d.ms25 / 100 * mk; }
    });
    if (W > 0) { ms26 = S26 / W * 100; ms25 = S25 / W * 100; }
    else { ms26 = mean(L.map(function (x) { return x.d.ms26; })); ms25 = mean(L.map(function (x) { return x.d.ms25; })); }
    var evo = (ms25 != null && ms25 > 0 && ms26 != null) ? ms26 / ms25 * 100 : null;
    return { a: a, b: b, n: L.length, ilk: L[0].m, son: L[L.length - 1].m, kutu: kutu, ortKutu: kutu / L.length, ms25: ms25, ms26: ms26,
      pp: (ms25 != null && ms26 != null) ? ms26 - ms25 : null, evo: evo, durum: gradeEvo(evo) };
  }
  function donemAd(P) { return AY_KISA[P.ilk - 1] + (P.ilk !== P.son ? '–' + AY_KISA[P.son - 1] : ''); }

  // KONGRE_TAKIP_1 satırları + KONGRE_TAKIP_2'den gelen (ürün bloğu olan) kongre/brick/ürün kombinasyonları
  function buildUnits(rows1, p2) {
    var units = [], byId = {};
    rows1.forEach(function (r) {
      var u = { id: r.id, kongre: r.kongre, urun: r.urun, ttt: r.ttt, brick: r.brick, ay: r.ay, ytd: r.ytd, src1: true };
      byId[r.id] = u; units.push(u);
    });
    Object.keys(p2.grp).forEach(function (gk) {
      var g = p2.grp[gk];
      Object.keys(g.urunler).forEach(function (un) {
        var uk = key(un);
        if (PROD_BLOCKS.indexOf(uk) < 0) return;           // FAMTREC vb.: KONGRE_TAKIP_2'de YTD bloğu yok
        var id = [key(g.kongre), uk, key(g.ttt), key(g.brick)].join('|');
        if (byId[id]) return;
        var u = { id: id, kongre: g.kongre, urun: un, ttt: g.ttt, brick: g.brick, ay: null, ytd: null, src1: false };
        byId[id] = u; units.push(u);
      });
    });
    units.forEach(function (u) {
      var bk = key(u.ttt) + '|' + key(u.brick) + '|';
      u.yoy = p2.blocks[bk + key(u.urun)] || null;
      u.tum = p2.blocks[bk + 'TUM'] || null;
    });
    return units.filter(function (u) { return u.src1 || hasNum(u.yoy); });
  }

  // ───────────────────────── analiz motoru ─────────────────────────
  function analyze(u, att, ctx) {
    var o = { durum: 'veri' }, y = u.yoy, t = u.ytd, m;
    o.k25 = y ? y.k25 : null;
    o.k26 = (y && y.k26 != null) ? y.k26 : (t ? t.kutu : null);
    o.kutuD = (o.k25 != null && o.k26 != null) ? (o.k25 > 0 ? (o.k26 / o.k25 - 1) * 100 : (o.k26 > 0 ? 100 : 0)) : null;
    var ms = (t && t.ms25 != null && t.ms26 != null) ? t : ((y && y.ms25 != null && y.ms26 != null) ? y : null);
    o.ms25 = ms ? ms.ms25 : null; o.ms26 = ms ? ms.ms26 : null;
    o.evo = ms ? (ms.evo != null ? ms.evo : (ms.ms25 > 0 ? ms.ms26 / ms.ms25 * 100 : null)) : null;
    o.ppD = (o.ms25 != null && o.ms26 != null) ? (o.ms26 - o.ms25) : null;
    o.tumEvo = u.tum ? u.tum.evo : null;
    o.tl = y ? y.tl : null;
    o.net = (o.k25 != null && o.k26 != null) ? (o.k26 - o.k25) : null;
    // aylık katman (yalnız KONGRE_TAKIP_1 kayıtları)
    o.aylik = []; o.nUst = 0; o.evoL3 = null; o.mom = null; o.last = 0;
    o.ks = kutuStats(u);
    // hekim yoğunluğu: aynı bricten aynı ürün için kaç hekim gönderilmiş
    var hl = urunHekimleri(u, att);
    o.hekimEsles = hl.length > 0;
    o.hekimListe = hl.length ? hl : (att ? att.hekimler : []);
    o.hekimN = o.hekimListe.length;
    o.brickHekim = ctx ? Object.keys(ctx.hekim).length : o.hekimN;
    o.brickKongre = ctx ? Object.keys(ctx.kongre).length : (att ? 1 : 0);
    o.netHekim = (o.net != null && o.brickHekim > 0) ? o.net / o.brickHekim : null;
    o.coklu = o.hekimN >= 2;
    if (u.ay) {
      for (m = 1; m <= 12; m++) {
        var d = u.ay[m];
        if (d.has) o.last = m;
        if (d.has && d.ms25 != null && d.ms26 != null) { o.aylik.push(m); if (d.ms26 > d.ms25) o.nUst++; }
      }
      var ev = o.aylik.filter(function (x) { return u.ay[x].evo != null; }).slice(-3).map(function (x) { return u.ay[x].evo; });
      o.evoL3 = ev.length ? mean(ev) : null;
      if (o.evoL3 != null && o.evo != null) o.mom = o.evoL3 - o.evo;
    }
    // karar
    var sK = o.kutuD == null ? null : (o.kutuD >= ESIK.kutuPct ? 1 : (o.kutuD <= -ESIK.kutuPct ? -1 : 0));
    var sE = o.evo == null ? null : (o.evo >= ESIK.evoUst ? 1 : (o.evo <= ESIK.evoAlt ? -1 : 0));
    if (sK != null && sE != null) {
      var s = sK + sE;
      o.durum = s >= 2 ? 'ivme' : s === 1 ? 'pozitif' : s === 0 ? 'notr' : s === -1 ? 'zayif' : 'dusus';
      o.karisik = (sK * sE === -1);
    } else if (sK != null || sE != null) {
      var one = sK != null ? sK : sE;
      o.durum = one > 0 ? 'pozitif' : (one < 0 ? 'zayif' : 'notr');
      o.tek = true;
    }
    o.durumMutlak = o.durum;                       // geçen yıla göre (kontrolsüz) sonuç — bilgi amaçlı korunur
    // 6 aylık dönemler (aylık veri olan kayıtlar)
    o.donem = { h1: periodStats(u, 1, 6), h2: periodStats(u, 7, 12), tam: periodStats(u, 1, 12) };
    // Bölge (kontrol grubu) kıyası: kongre dışı bricklerin medyanına göre — asıl karar bu olur
    var bl = bolgeOf(u);
    o.mod = 'mutlak';
    if (bl) {
      o.bolge = bl; o.mod = 'bolge';
      var dv = durumFromBolge(bl);
      o.durum = dv.d; o.tek = dv.tek; o.karisik = dv.karisik;
      o.ekKutu = (o.k25 != null && o.k26 != null && bl.ctrlBuy != null) ? o.k26 - o.k25 * bl.ctrlBuy / 100 : null;   // bölge hızında büyüseydi beklenenden fark
      // H1'e denk bölge farkı (MI kümülatif: Haziran = ilk 6 ay)
      var meta = D && D.reg ? D.reg.meta[key(u.urun)] : null;
      o.bolgeH1 = (meta && meta.months.indexOf(6) >= 0) ? bolgeAt(u, 6) : null;
      var dh = durumFromBolge(o.bolgeH1);
      o.durumH1B = dh ? dh.d : null;                                        // 1. altı ay (Haziran kümülatifi) — bölgeye göre
      o.h2Delta = o.bolgeH1 ? bl.relEvo - o.bolgeH1.relEvo : null;           // H1 sonundan son aya bölgeye göre fark değişimi (2. altı ay yönü)
      o.h2Yon = o.h2Delta == null ? null : (o.h2Delta >= ESIK.bolgeEvo ? 'guclendi' : (o.h2Delta <= -ESIK.bolgeEvo ? 'zayifladi' : 'sabit'));
    }
    if (o.durum === 'veri') { o.yorum = 'Bu kayıt için karşılaştırma yapılabilecek veri (kutu / pazar payı / bölge) bulunmuyor.'; return o; }
    o.dusukHacim = (o.k26 != null && o.k26 < ESIK.dusukHacim);
    // güven düzeyi: hacim, kontrol grubu büyüklüğü, sinyal uyumu
    var gv = (o.k26 == null || o.k26 < ESIK.dusukHacim) ? 0 : (o.k26 < 500 ? 1 : 2);
    if (o.bolge && o.bolge.n < 12) gv = Math.min(gv, 1);
    if (!o.bolge) gv = Math.min(gv, 1);
    if (o.karisik) gv = Math.max(0, gv - 1);
    o.guven = gv;
    o.yorum = yorum(u, o, att);
    return o;
  }

  // Aylık kutu çıkışı (KONGRE_TAKIP_1 "KUTU SATIŞ"): ay ay seri, aya göre değişim, ortalama, en yüksek/düşük, son 3 ay eğilimi
  function kutuStats(u) {
    if (!u.ay) return null;
    var L = [], m;
    for (m = 1; m <= 12; m++) { var d = u.ay[m]; if (d.has && d.kutu != null) L.push({ m: m, kutu: d.kutu, mom: null }); }
    if (L.length < 2) return null;
    L.forEach(function (x, i) { if (i > 0 && L[i - 1].m === x.m - 1 && L[i - 1].kutu > 0) x.mom = (x.kutu / L[i - 1].kutu - 1) * 100; });
    var tot = L.reduce(function (a, b) { return a + b.kutu; }, 0);
    var mx = L.reduce(function (a, b) { return b.kutu > a.kutu ? b : a; }), mn = L.reduce(function (a, b) { return b.kutu < a.kutu ? b : a; });
    var l3 = L.slice(-3), onc = L.slice(0, -3);
    var l3a = mean(l3.map(function (x) { return x.kutu; })), onca = onc.length ? mean(onc.map(function (x) { return x.kutu; })) : null;
    return {
      L: L, toplam: tot, ort: tot / L.length, mx: mx, mn: mn, son: L[L.length - 1], l3a: l3a, onca: onca,
      trend: (onca != null && onca > 0) ? (l3a / onca - 1) * 100 : null,
      artis: L.filter(function (x) { return x.mom != null && x.mom >= 5; }).length,
      dus: L.filter(function (x) { return x.mom != null && x.mom <= -5; }).length
    };
  }

  // Bu kongrede bu ÜRÜN için gönderilen hekimler (KONGRE_TAKIP_2 "ÜRÜN 1 / ÜRÜN 2")
  function urunHekimleri(u, att) {
    if (!att) return [];
    var uk = key(u.urun);
    return att.hekimler.filter(function (h) { return h.urunler.some(function (pr) { return key(pr) === uk; }); });
  }
  // Aynı brick + ürün için TÜM kongrelerde gönderilen farklı hekim / kongre sayısı
  function buildAgg(att) {
    var agg = {};
    Object.keys(att).forEach(function (gk) {
      var parts = gk.split('|'), kg = parts[0], tt = parts[1], br = parts[2];
      att[gk].hekimler.forEach(function (h) {
        h.urunler.forEach(function (pr) {
          var k = tt + '|' + br + '|' + key(pr), A = agg[k] || (agg[k] = { kongre: {}, hekim: {} });
          A.kongre[kg] = 1; A.hekim[key(h.ad) + '|' + key(h.unite)] = 1;
        });
      });
    });
    return agg;
  }
  function bransOzet(att) { return bransOzetL(att.hekimler); }
  function bransOzetL(list) {
    var c = {}, o = [];
    list.forEach(function (h) { var b = h.brans || 'Branş belirtilmemiş'; c[b] = (c[b] || 0) + 1; });
    Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).forEach(function (b) { o.push(b + ': ' + c[b]); });
    return o.slice(0, 4).join(', ');
  }

  var GUVEN = ['düşük', 'orta', 'yüksek'];
  function lc(x) { return String(x).toLocaleLowerCase('tr'); }
  function bolgeCumle(u, o) {
    var b = o.bolge, t = 'Bölge kıyası (' + AY_ADI[b.m - 1] + ' itibarıyla): kongreye hekim gönderilmeyen ' + b.n + ' brickte ' + u.urun + ' EVO medyanı ' + fmt(b.ctrlEvo) +
      (b.ctrlBuy != null ? ', kutu büyüme indeksi medyanı ' + fmt(b.ctrlBuy) : '') + '. Bu brickte EVO ' + fmt(b.evo) + ' (' + sgn(b.relEvo) + ' puan)' +
      (b.relBuy != null ? ', kutu büyüme indeksi ' + fmt(b.buy) + ' (' + sgn(b.relBuy) + ' puan)' : '') + '; bölgedeki ' + b.nAll + ' brick içinde %' + b.pct + '\'lik dilimde.';
    var A = o.durumMutlak, R = o.durum, pos = function (d) { return d === 'ivme' || d === 'pozitif'; }, neg = function (d) { return d === 'zayif' || d === 'dusus'; };
    if (pos(A) && !pos(R)) t += ' Geçen yıla göre görülen artış bölge genelinde de var; bu artış kongreye atfedilemez.';
    else if (!pos(A) && pos(R)) t += ' Mutlak değerler zayıf görünse de bölgedeki diğer bricklere göre daha iyi seyrediyor.';
    else if (neg(A) && neg(R)) t += ' Hem geçen yıla hem bölgeye göre geride.';
    if (o.ekKutu != null) t += ' Brick bölge büyüme hızında ilerleseydi beklenen kutuya göre ' + sgn(o.ekKutu) + ' kutu fark var.';
    if (b.relEvoEarly != null && b.relEvo >= ESIK.bolgeEvo && b.relEvoEarly >= ESIK.bolgeEvo * 0.7) t += ' Bölgeye göre üstünlük ' + AY_ADI[b.earlyM - 1] + ' ayında da mevcuttu; fark sonradan oluşmamış, kongre öncesi seçilim etkisi olabilir.';
    else if (b.relEvoEarly != null && b.relEvo >= ESIK.bolgeEvo && b.relEvoEarly < ESIK.bolgeEvo * 0.7) t += ' ' + AY_ADI[b.earlyM - 1] + ' ayında bölgeden belirgin ayrışmıyordu; fark sonradan açılmış.';
    return t;
  }
  function bolgeKarar(o) {
    switch (o.durum) {
      case 'ivme': return 'Brick, kongreye hekim gönderilmeyen bricklere göre belirgin üstün: kongre katılımıyla tutarlı olumlu bir sinyal (nedensellik kanıtı değil; hekim gönderilen bricklerin baştan farklı olma ihtimali var). Ivmeyi korumak için hekimlere takip ziyareti planlanmalı.'.replace('Ivmeyi', 'İvmeyi');
      case 'pozitif': return 'Brick bölge ortalamasının üzerinde ancak fark güçlü değil; hedefli takip ziyaretleriyle pekiştirilebilir.';
      case 'notr': return 'Brick bölge ortalamasından ayrışmıyor: kongre katılımının ek bir etkisi bu verilerde görülmüyor. Hekimlerle sonuç odaklı görüşme önerilir.';
      case 'zayif': return 'Brick bölge ortalamasının altında: kongre katılımına rağmen karşılık görülmüyor. Rakip aktivitesi, stok/erişim ve hekim geri bildirimi kontrol edilmeli.';
      case 'dusus': return 'Brick bölgenin belirgin altında: kongre yatırımı bu bricte karşılık bulmamış görünüyor. Acil saha incelemesi önerilir.';
    }
    return '';
  }
  function donemCumle(o) {
    var h1 = o.donem.h1, h2 = o.donem.h2, rk = function (d) { return VERDICT[d].rank; };
    var t = 'Dönemsel: ' + DONEM[0].ad + ' (' + donemAd(h1) + ') EVO ' + fmt(h1.evo) + ' (' + lc(VERDICT[h1.durum].lbl) + '), ' + DONEM[1].ad + ' (' + donemAd(h2) + (h2.n < 6 ? ', kısmi: ' + h2.n + ' ay' : '') + ') EVO ' + fmt(h2.evo) + ' (' + lc(VERDICT[h2.durum].lbl) + '); aylık ortalama kutu ' + fmt(h1.ortKutu) + ' → ' + fmt(h2.ortKutu) + '.';
    if (h1.evo != null && h2.evo != null) t += rk(h2.durum) > rk(h1.durum) ? ' İkinci yarıda pazara göre performans güçleniyor.' : (rk(h2.durum) < rk(h1.durum) ? ' İkinci yarıda pazara göre performans zayıflıyor.' : ' İki dönem benzer seyrediyor.');
    if (o.bolgeH1 && o.bolge) {
      t += ' Bölgeye göre: 1. altı ay sonunda fark ' + sgn(o.bolgeH1.relEvo) + ' puan, son ayda ' + sgn(o.bolge.relEvo) + ' puan → 2. altı ayda bölgeye göre ' + (o.h2Yon === 'guclendi' ? 'güçlendi' : (o.h2Yon === 'zayifladi' ? 'zayıfladı' : 'sabit kaldı')) + '.';
      var c6 = o.bolgeH1.ctrlEvo, cL = o.bolge.ctrlEvo;
      if (c6 != null && cL != null && cL - c6 <= -5) t += ' Kontrol grubunun EVO medyanı da ' + fmt(c6) + ' → ' + fmt(cL) + ' geriledi: mutlak EVO düşüşü kısmen bölge geneli bir eğilimdir.';
    }
    return t;
  }

  // Aynı bricten aynı ürün için birden fazla hekim gönderildiğinde ek değerlendirme
  function cokluYorum(u, o) {
    var t = [], br = {}, nb = 0;
    o.hekimListe.forEach(function (h) { var b = h.brans || 'Branş belirtilmemiş'; if (!br[b]) { br[b] = 1; nb++; } });
    t.push(nb === 1 ? 'Hekimlerin tamamı aynı branştan (' + Object.keys(br)[0] + '): yatırım tek hasta grubuna yoğunlaşmış.' : 'Hekimler ' + nb + ' farklı branştan: ürün birden çok hasta grubuna taşınmış.');
    var nh = o.netHekim == null ? '' : ' (hekim başına ortalama ' + sgn(o.netHekim, Math.abs(o.netHekim) < 10 ? 1 : 0) + ' kutu)';
    switch (o.durum) {
      case 'ivme': case 'pozitif':
        t.push('Çoklu hekim katılımı ile brickte artış birlikte görülüyor' + nh + '; yatırımın karşılık bulduğuna işaret ediyor. Ancak artışın hangi hekimden geldiği bu verilerle ayrıştırılamaz; hekim bazında reçete/ziyaret takibiyle doğrulanmalı.'); break;
      case 'notr':
        t.push('Aynı ürün için birden fazla hekim gönderilmesine rağmen brickte belirgin artış yok' + nh + '. Yatırım yoğunluğu sonuca yansımamış: hekim seçimi (potansiyel ve branş uyumu) ile kongre sonrası takip gözden geçirilmeli.'); break;
      case 'zayif': case 'dusus':
        t.push('Birden fazla hekim gönderilmesine rağmen brickte geriye gidiş var' + nh + '. Yatırım yoğun olduğu için hekim seçimi, kongre sonrası takip ve rakip aktivitesi öncelikle incelenmeli; sonraki kongrede hekim sayısı brickin potansiyeline göre ayarlanmalı ve her hekimden ayrı geri bildirim alınmalı.'); break;
    }
    if (o.brickKongre >= 2 || o.brickHekim > o.hekimN) {
      t.push('Aynı brick–ürün için toplam ' + o.brickKongre + ' kongrede ' + o.brickHekim + ' farklı hekim gönderildi; brick sonucu bu kongrelerin birleşik etkisidir, tek bir kongreye atfedilemez.');
    }
    return t.join(' ');
  }

  function yorum(u, o, att) {
    var t = [], p = [];
    if (o.kutuD != null) p.push('YTD kutu ' + fmt(o.k25) + ' → ' + fmt(o.k26) + ' (' + sgn(o.kutuD) + '%)');
    else if (o.k26 != null) p.push('YTD kutu ' + fmt(o.k26) + ' (geçen yıl kutu verisi yok)');
    if (o.ms25 != null) p.push('pazar payı %' + fmt(o.ms25, 1) + ' → %' + fmt(o.ms26, 1) + ' (' + sgn(o.ppD, 1) + ' puan)');
    if (o.evo != null) p.push('pazara göre gelişim (EVO) ' + fmt(o.evo));
    t.push(u.brick + ' bricki ' + u.urun + ' için geçen yılın aynı dönemine göre: ' + p.join('; ') + '.');
    if (o.bolge) t.push(bolgeCumle(u, o));
    if (o.aylik.length) {
      var s = 'Aylık bazda ' + o.aylik.length + ' ayın ' + o.nUst + ' tanesinde pazar payı geçen yılın üzerinde';
      if (o.mom != null) s += '; son 3 ay EVO ortalaması ' + fmt(o.evoL3) + (o.mom >= ESIK.momFark ? ' (YTD\'nin üzerinde: ivme artıyor).' : (o.mom <= -ESIK.momFark ? ' (YTD\'nin altında: ivme yavaşlıyor).' : ' (YTD ile benzer).'));
      else s += '.';
      t.push(s);
    }
    if (o.donem && o.donem.h1 && o.donem.h2) t.push(donemCumle(o));
    if (o.ks) {
      var k = o.ks, s2 = 'Aylık kutu çıkışı: ' + k.L.length + ' ayda toplam ' + fmt(k.toplam) + ', aylık ortalama ' + fmt(k.ort) + '; en yüksek ' + AY_ADI[k.mx.m - 1] + ' (' + fmt(k.mx.kutu) + '), en düşük ' + AY_ADI[k.mn.m - 1] + ' (' + fmt(k.mn.kutu) + ').';
      s2 += ' Son ay ' + AY_ADI[k.son.m - 1] + ' ' + fmt(k.son.kutu) + (k.son.mom != null ? ' (önceki aya göre ' + sgn(k.son.mom) + '%)' : '') + '.';
      if (k.trend != null) s2 += ' Son 3 ay ortalaması ' + fmt(k.l3a) + ', önceki aylara göre ' + sgn(k.trend) + '% ' + (k.trend >= 10 ? '(yükseliş eğilimi).' : (k.trend <= -10 ? '(gerileme eğilimi).' : '(yatay).'));
      t.push(s2);
    }
    if (att && att.sayi) {
      if (o.coklu) {
        t.push('Aynı bricten ' + o.hekimN + ' hekim ' + (o.hekimEsles ? u.urun + ' için ' : '') + 'bu kongreye gönderilmiş (' + bransOzetL(o.hekimListe) + ').' +
          (o.hekimEsles ? '' : ' (Hekim satırlarında bu ürün eşleşmediği için kongreye katılan tüm hekimler sayıldı.)'));
        t.push(cokluYorum(u, o));
      } else {
        t.push('Bu bricten kongreye ' + (o.hekimN || att.sayi) + ' hekim katıldı (' + bransOzet(att) + '); sonuçlar hekim bazında değil, hekimlerin bulunduğu brickin ürün performansını yansıtır.');
      }
    }
    if (o.tumEvo != null && o.evo != null) {
      t.push('Brick genelinde (tüm ürünler) EVO ' + fmt(o.tumEvo) + '; ' + u.urun + ' ' +
        (o.evo >= o.tumEvo + 5 ? 'brick ortalamasının üzerinde' : (o.evo <= o.tumEvo - 5 ? 'brick ortalamasının altında' : 'brick ortalamasıyla benzer')) + ' seyrediyor.');
    }
    if (o.bolge) t.push(bolgeKarar(o)); else switch (o.durum) {
      case 'ivme':
        t.push('Kongreye katılan hekimlerin bulunduğu bu bricte ürün satışta ve pazar payında geçen yıla göre belirgin yükselmiş: kongre yatırımı karşılığını buluyor. Benzer hekim profiliyle sürdürülebilir; ivmeyi korumak için takip ziyaretleri planlanmalı.'); break;
      case 'pozitif':
        t.push('Geçen yıla göre olumlu bir artış var ancak güçlü değil; hedefli takip ziyaretleriyle pekiştirilebilir.'); break;
      case 'notr':
        t.push(o.karisik ? 'Kutu ve pazara göre gelişim zıt yönde olduğundan net bir kongre karşılığı görülmüyor; hekimlerle sonuç odaklı görüşme ve takip ziyareti önerilir.'
          : 'Geçen yıla göre belirgin bir değişim yok; kongre katılımı henüz satışa yansımış görünmüyor. Hekimlerle sonuç odaklı görüşme ve ürün mesajının yeniden vurgulanması önerilir.'); break;
      case 'zayif':
        t.push('Geçen yıla göre geriye gidiş var; kongre karşılığı görünmüyor. Rakip aktivitesi, eczane stok/erişimi ve hekim geri bildirimi kontrol edilmeli.'); break;
      case 'dusus':
        t.push('Satış ve pazar payı geçen yıla göre belirgin düşmüş; kongre katılımına rağmen karşılık bulunmuyor. Acil saha incelemesi önerilir: hekim görüşmesi, rakip hamleleri, stok/erişim ve brick çalışma planı gözden geçirilmeli.'); break;
    }
    if (o.karisik && o.durum !== 'notr') t.push('Kutu ve pazara göre gelişim zıt yönde — yorum temkinli yapılmalı.');
    if (o.kutuD != null && o.evo != null && o.kutuD >= ESIK.kutuPct && o.evo < 100) t.push('Kutu artışına rağmen EVO 100\'ün altında: artış pazarın genel büyümesinden kaynaklanıyor olabilir.');
    if (o.kutuD != null && o.evo != null && o.kutuD <= -ESIK.kutuPct && o.evo > 100) t.push('Kutu düşse de EVO 100\'ün üzerinde: düşüş pazar kaynaklı olabilir, pazara göre gelişim korunuyor.');
    if (o.tek) t.push('Yalnızca tek gösterge mevcut olduğundan sonuç ön değerlendirmedir.');
    t.push('Güven düzeyi: ' + GUVEN[o.guven] + (o.mod === 'mutlak' ? ' (bölge kıyası yapılamadığı için sonuç yalnızca geçen yıla göredir; pazar/bölge kaynaklı büyüme ayrıştırılamadı)' : '') + '.');
    if (o.dusukHacim) t.push('Hacim düşük (YTD < ' + ESIK.dusukHacim + ' kutu); küçük sayılar yüzdeleri abartabilir.');
    return t.join(' ');
  }

  function attOf(u) { return (D && D.att[[key(u.kongre), key(u.ttt), key(u.brick)].join('|')]) || null; }

  function buildItems() {
    return D.units.map(function (u) {
      var at = attOf(u), ctx = D.agg ? D.agg[key(u.ttt) + '|' + key(u.brick) + '|' + key(u.urun)] : null;
      return { row: u, a: analyze(u, at, ctx), att: at };
    });
  }

  // ── GÖNDERİLEN HEKİM ÖZETİ ─────────────────────────────────────────────
  // "Kongre kaydı" (= kongre × brick × ürün analiz birimi) ile "kongreye gönderilen hekim" AYNI ŞEY DEĞİLDİR:
  // bir hekim birden çok ürün için birden çok analiz birimi üretir (ör. 47 hekim → 55 analiz birimi).
  // Hekim, brick ve kongre sayıları doğrudan KONGRE_TAKIP_2'deki katılım listesinden (D.att) sayılır;
  // böylece ürün verisi/hesaplanabilirlik durumu sayıyı etkilemez.
  //   f.ttt (key), f.kongre (key), f.urun (key): filtreler;  f.items: verilirse yalnız bu kayıtların kongre/brick grupları
  function hekimOzet(f) {
    f = f || {};
    var O = { hekim: 0, brick: 0, kongre: 0, byBrick: [], byTtt: {} }, seenH = {}, seenB = {}, seenK = {}, bb = {}, gks;
    if (!D || !D.att) return O;
    if (f.items) { var m = {}; f.items.forEach(function (it) { m[[key(it.row.kongre), key(it.row.ttt), key(it.row.brick)].join('|')] = 1; }); gks = Object.keys(m); }
    else gks = Object.keys(D.att);
    gks.forEach(function (gk) {
      var a = D.att[gk]; if (!a) return;
      var p = gk.split('|'), kg = p[0], tt = p[1], br = p[2];
      if (f.ttt && tt !== f.ttt) return;
      if (f.kongre && kg !== f.kongre) return;
      a.hekimler.forEach(function (h) {
        if (f.urun && !h.urunler.some(function (pr) { return key(pr) === f.urun; })) return;
        var hk = tt + '|' + key(h.ad) + '|' + key(h.unite);
        if (!seenH[hk]) { seenH[hk] = 1; O.hekim++; O.byTtt[tt] = (O.byTtt[tt] || 0) + 1; }
        seenK[kg] = 1;
        var bk = tt + '|' + br; seenB[bk] = 1;
        var g = D.grp && D.grp[gk];     // gösterim adı (orijinal yazım)
        var B = bb[bk] || (bb[bk] = { ttt: g ? g.ttt : tt, tk: tt, brick: g ? g.brick : br, set: {} }); B.set[hk] = 1;
      });
    });
    O.brick = Object.keys(seenB).length; O.kongre = Object.keys(seenK).length;
    O.byBrick = Object.keys(bb).map(function (k) { var B = bb[k]; return { ttt: B.ttt, tk: B.tk, brick: B.brick, n: Object.keys(B.set).length }; })
      .sort(function (x, y) { return x.ttt.localeCompare(y.ttt, 'tr') || y.n - x.n || x.brick.localeCompare(y.brick, 'tr'); });
    return O;
  }
  function summarize(items) {
    var S = { kayit: items.length, olculen: 0, ivme: 0, pozitif: 0, notr: 0, zayif: 0, dusus: 0, veri: 0, net: 0, hekim: 0, oran: null };
    var seenAtt = {}, seenNet = {}, seenHb = {};
    S.tek = { kayit: 0, olculen: 0, ok: 0, hb: 0, hbN: 0 }; S.coklu = { kayit: 0, olculen: 0, ok: 0, hb: 0, hbN: 0 };
    items.forEach(function (it) {
      S[it.a.durum]++;
      var G = it.a.coklu ? S.coklu : S.tek;
      G.kayit++;
      if (OLCULEN.indexOf(it.a.durum) >= 0) {
        G.olculen++; if (it.a.durum === 'ivme' || it.a.durum === 'pozitif') G.ok++;
        var hk = (it.a.coklu ? 'c|' : 't|') + [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
        if (it.a.netHekim != null && !seenHb[hk]) { seenHb[hk] = 1; G.hb += it.a.netHekim; G.hbN++; }
      }
      if (OLCULEN.indexOf(it.a.durum) >= 0) {
        S.olculen++;
        var nk = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');   // aynı brick+ürün birden çok kongrede geçse de bir kez
        if (it.a.net != null && !seenNet[nk]) { seenNet[nk] = 1; S.net += it.a.net; }
      }
      if (it.att) {      // benzersiz hekim: aynı kişi birden çok kayıtta/üründe geçse de bir kez
        it.att.hekimler.forEach(function (h) {
          var hk2 = key(it.row.ttt) + '|' + key(h.ad) + '|' + key(h.unite);
          if (!seenAtt[hk2]) { seenAtt[hk2] = 1; S.hekim++; }
        });
      }
    });
    var seenU = {}; S.u = { n: 0, olc: 0, ok: 0, ivme: 0, pozitif: 0, notr: 0, zayif: 0, dusus: 0, veri: 0 };
    items.forEach(function (it) {
      var nk = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
      if (seenU[nk]) return; seenU[nk] = 1; S.u.n++; S.u[it.a.durum]++;
      if (it.a.ekKutu != null && it.a.net != null) { S.ek = (S.ek || 0) + it.a.ekKutu; S.ekNet = (S.ekNet || 0) + it.a.net; }
      if (OLCULEN.indexOf(it.a.durum) >= 0) { S.u.olc++; if (it.a.durum === 'ivme' || it.a.durum === 'pozitif') S.u.ok++; }
    });
    S.oran = S.u.olc ? S.u.ok / S.u.olc * 100 : null;      // aynı brick–ürün birden çok kongrede geçse de bir kez sayılır
    [S.tek, S.coklu].forEach(function (G) { G.oran = G.olculen ? G.ok / G.olculen * 100 : null; G.hbOrt = G.hbN ? G.hb / G.hbN : null; });
    return S;
  }

  function ozetYorum(S, kapsam, HS) {
    if (!S.kayit && !(HS && HS.hekim)) return 'Seçili filtrelerde kongre kaydı bulunmuyor.';
    var t = [];
    var U = S.u, reg = !!(D && D.reg);
    if (HS && HS.hekim) t.push(kapsam + ' için kongre/toplantılara ' + HS.brick + ' bricktan ' + HS.hekim + ' hekim gönderildi (' + HS.kongre + ' farklı kongre/toplantı).');
    if (!S.kayit) return t.join(' ');
    t.push('Bu katılım, hekimlerin tanıtıldığı ürünlerle çarpıldığında ' + S.kayit + ' analiz birimine (kongre × brick × ürün) karşılık gelir; ' + U.n + ' benzersiz brick–ürün var ve ' + U.olc + ' tanesi ' + (reg ? 'bölge (kontrol grubu) kıyasıyla' : 'geçen yıl karşılaştırmasıyla') + ' değerlendirilebildi.');
    if (U.olc) {
      t.push('Değerlendirilenlerin ' + U.ok + ' tanesinde (%' + fmt(S.oran) + ') ' + (reg ? 'bölge ortalamasının üzerinde performans' : 'geçen yıla göre artış') + ' görüldü' +
        (U.ivme ? ' (' + U.ivme + ' tanesi güçlü)' : '') + '; ' + (U.zayif + U.dusus) + ' tanesi ' + (reg ? 'bölgenin altında' : 'geriledi') + ', ' + U.notr + ' tanesi ' + (reg ? 'bölgeyle aynı' : 'nötr') + '.');
      t.push('İlgili brick–ürünlerde geçen yıla göre yıllık (YTD) toplam kutu farkı ' + sgn(S.net) + ' kutu.' +
        (reg && S.ek != null && S.ekNet > 0 ? ' Aynı brick–ürünler bölge büyüme hızında ilerleseydi beklenen kutuya göre fark ' + sgn(S.ek) + ' kutu; ' + (S.ek <= 0 ? 'yani artışın tamamı bölge genelinde de görülen büyümeyle açıklanıyor, kongre brickleri bölge hızının ' + (S.ek < 0 ? 'bir miktar altında kalmış' : 'üzerine çıkamamış') + '.' : 'yani artışın yaklaşık %' + fmt(Math.max(0, Math.min(100, (1 - S.ek / S.ekNet) * 100))) + '\'i bölge genelinde de görülen büyümeyle açıklanıyor.') : ''));
      if (S.oran >= 60) t.push('Genel tablo olumlu: kongre brickleri ağırlıklı olarak referansın üzerinde.');
      else if (S.oran >= 35) t.push('Genel tablo karışık: bazı kongreler karşılık buluyor, bazıları için takip gerekiyor.');
      else t.push('Genel tablo zayıf: kongre sonrası takip ziyaretleri ve hekim seçimi gözden geçirilmeli.');
    }
    if (S.coklu.kayit) {
      var c = S.coklu, k = S.tek, s4 = 'Aynı bricten aynı ürün için birden fazla hekim gönderilen ' + c.kayit + ' kayıtta karşılık oranı ' + (c.oran == null ? '—' : '%' + fmt(c.oran));
      if (k.kayit) s4 += ', tek hekim gönderilen ' + k.kayit + ' kayıtta ' + (k.oran == null ? '—' : '%' + fmt(k.oran));
      s4 += '.';
      if (c.oran != null && k.oran != null) s4 += c.oran - k.oran >= 10 ? ' Çoklu hekim katılımı karşılığı artırıyor görünüyor (küçük örnek; kesin sonuç sayılmamalı, brickler baştan farklı olabilir).' : (c.oran - k.oran <= -10 ? ' Hekim sayısını artırmak tek başına karşılık getirmemiş görünüyor (küçük örnek; kesin sonuç sayılmamalı).' : ' Hekim sayısı karşılık oranını belirgin değiştirmiyor (küçük örnek).');
      t.push(s4);
    }
    t.push(D && D.reg ? 'Değerlendirme, kongreye hekim gönderilmeyen bölge bricklerine göre yapıldı; oran benzersiz brick–ürün üzerinden hesaplandı.' : 'Bölge kıyası yapılamadı; değerlendirme yalnızca geçen yıla göredir.');
    if (S.veri) t.push(S.veri + ' kayıtta karşılaştırma verisi yetersiz.');
    return t.join(' ');
  }

  // ───────────────────────── yükleme ─────────────────────────
  function fetchText(u) {
    return fetch(u + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(u + ' HTTP ' + r.status);
      return r.text();
    });
  }
  function ensure() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetchText(SRC1).then(function (t) { RAW.k1 = t; return parse1(t); }),
      fetchText(SRC2).then(function (t) { RAW.k2 = t; return parse2(t); }),
      fetchText(SRC_MI).then(parseMi).catch(function () { return null; })      // yoksa mutlak (geçen yıl) moduna düşer
    ]).then(function (res) {
      var kongreAd = {};
      Object.keys(res[1].kongreAd || {}).forEach(function (k) { kongreAd[k] = res[1].kongreAd[k]; });
      res[0].forEach(function (r) { kongreAd[key(r.kongre)] = r.kongre; });
      D = { units: buildUnits(res[0], res[1]), att: res[1].att || {}, grp: res[1].grp || {}, agg: buildAgg(res[1].att || {}), kongreler: kongreAd, err: null, reg: null };
      try { if (res[2]) D.reg = buildRegion(res[2], D.att, D.units); } catch (e) { D.reg = null; }
    }).catch(function (e) {
      D = { units: [], att: {}, kongreler: {}, err: (e && e.message) || String(e) };
    });
    return loadPromise;
  }

  // ───────────────────────── görsel yardımcılar ─────────────────────────
  var CSS_DONE = false;
  function injectCss() {
    if (CSS_DONE || document.getElementById('pvKongreCss')) { CSS_DONE = true; return; }
    CSS_DONE = true;
    var st = document.createElement('style');
    st.id = 'pvKongreCss';
    st.textContent =
      '.kg-wrap{font-size:12px;color:var(--text)}' +
      '.kg-filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}' +
      '.kg-filters label{display:flex;flex-direction:column;gap:3px;font-size:9.5px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.3px}' +
      '.kg-filters select{min-width:140px;max-width:220px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surf);color:var(--text);font-size:11.5px;font-weight:600}' +
      '.kg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;margin:0 0 14px}' +
      '.kg-kpi{background:var(--surf2);border:1px solid var(--border);border-radius:12px;padding:9px 11px}' +
      '.kg-kpi b{display:block;font-size:19px;font-weight:800;line-height:1.15}' +
      '.kg-kpi span{font-size:9.5px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.3px}' +
      '.kg-sec{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px}' +
      '.kg-sec i{flex:1;height:1px;background:var(--border)}' +
      '.kg-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--dim);margin:0 0 10px}' +
      '.kg-legend em{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px;font-style:normal}' +
      '.kg-card{border:1px solid var(--border);border-radius:14px;background:var(--surf);padding:12px 13px;margin:0 0 10px}' +
      '.kg-card-hd{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between;margin:0 0 8px}' +
      '.kg-title{font-size:12.5px;font-weight:800}' +
      '.kg-sub{font-size:10.5px;color:var(--dim);margin-top:2px}' +
      '.kg-badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:9.5px;font-weight:800;letter-spacing:.3px;white-space:nowrap}' +
      '.kg-body{display:grid;grid-template-columns:minmax(260px,330px) 1fr;gap:12px;align-items:start}' +
      '@media(max-width:720px){.kg-body{grid-template-columns:1fr}}' +
      '.kg-cap{font-size:9.5px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.3px;margin:8px 0 2px}' +
      '.kg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}' +
      '.kg-chip{border-radius:10px;padding:5px 9px;font-size:10.5px;font-weight:700;border:1px solid var(--border);background:var(--surf2)}' +
      '.kg-chip small{display:block;font-size:8.5px;font-weight:700;color:var(--dim);text-transform:uppercase}' +
      '.kg-up{color:#15803D}.kg-dn{color:#DC2626}.kg-nt{color:#64748B}' +
      '.kg-txt{font-size:11.5px;line-height:1.55}' +
      '.kg-card details{margin-top:8px;font-size:11px}' +
      '.kg-card summary{cursor:pointer;font-weight:700;color:var(--c1)}' +
      '.kg-tbl{width:100%;border-collapse:collapse;margin-top:6px}' +
      '.kg-tbl th{font-size:9.5px;color:var(--dim);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)}' +
      '.kg-tbl th:first-child,.kg-tbl td:first-child{text-align:left}' +
      '.kg-tbl td{font-size:11px;padding:4px 6px;border-bottom:1px solid var(--border);text-align:right}' +
      '.kg-scroll{overflow-x:auto}' +
      '.kg-tbl.kg-left th,.kg-tbl.kg-left td{text-align:left}' +
      '.kg-heat{border-collapse:separate;border-spacing:2px;min-width:560px}' +
      '.kg-heat th{font-size:9.5px;color:var(--dim);padding:2px 4px;text-align:center}' +
      '.kg-heat td.kg-lbl{font-size:10.5px;font-weight:700;padding:2px 6px 2px 0;white-space:nowrap}' +
      '.kg-hc{min-width:50px;border-radius:7px;padding:3px 4px;text-align:center;font-size:10.5px;font-weight:800;line-height:1.15}' +
      '.kg-hc small{display:block;font-size:8.5px;font-weight:600;opacity:.8}' +
      '.kg-bar{height:7px;border-radius:4px;background:var(--border);overflow:hidden;min-width:70px}' +
      '.kg-bar i{display:block;height:100%;border-radius:4px}' +
      '.kg-note{font-size:10.5px;color:var(--dim);line-height:1.5}' +
      '.kg-btn{padding:5px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surf);color:var(--c1);font-size:10.5px;font-weight:700;cursor:pointer}';
    document.head.appendChild(st);
  }

  function evoColor(e) {          // EVO şeridi (aylık)
    if (e == null) return { bg: '#E2E8F0', fg: '#475569' };
    if (e >= 120) return { bg: '#16A34A', fg: '#fff' };
    if (e >= 100) return { bg: '#86EFAC', fg: '#14532D' };
    if (e >= 80) return { bg: '#FCD34D', fg: '#78350F' };
    return { bg: '#F87171', fg: '#7F1D1D' };
  }
  function divColor(p) {          // ısı haritası: yüzde değişim (±) ölçeği
    if (p == null) return { bg: 'var(--surf2)', fg: 'var(--dim)' };
    if (p >= 25) return { bg: '#16A34A', fg: '#fff' };
    if (p >= 5) return { bg: '#BBF7D0', fg: '#14532D' };
    if (p > -5) return { bg: 'var(--surf2)', fg: 'var(--text)' };
    if (p > -25) return { bg: '#FECACA', fg: '#7F1D1D' };
    return { bg: '#DC2626', fg: '#fff' };
  }
  function deltaCls(v, thr) { return v == null ? 'kg-nt' : (v >= thr ? 'kg-up' : (v <= -thr ? 'kg-dn' : 'kg-nt')); }
  function arrow(v, thr) { return v == null ? '' : (v >= thr ? '▲ ' : (v <= -thr ? '▼ ' : '● ')); }
  function col3(d, thr) { return d == null ? '#94A3B8' : (d >= thr ? '#16A34A' : (d <= -thr ? '#DC2626' : '#94A3B8')); }

  // Geçen yıl ↔ bu yıl yatay çubuklar (kutu YTD, pazar payı)
  function yoyBars(o) {
    var items = [];
    if (o.k26 != null) items.push({ t: 'Kutu (YTD)', a: o.k25, b: o.k26, d: o.kutuD, dt: o.kutuD == null ? '—' : sgn(o.kutuD) + '%', thr: ESIK.kutuPct, f: function (v) { return fmt(v); } });
    if (o.ms26 != null) items.push({ t: 'Pazar payı (YTD)', a: o.ms25, b: o.ms26, d: o.ppD, dt: sgn(o.ppD, 1) + ' puan', thr: 0.5, f: function (v) { return '%' + fmt(v, 1); } });
    if (!items.length) return '';
    var W = 330, H = items.length * 46 + 4, p = [], TX = 'style="fill:var(--text)"', DX = 'style="fill:var(--dim)"';
    items.forEach(function (it, i) {
      var y0 = 4 + i * 46, mx = Math.max(it.a || 0, it.b || 0, 1e-9), bw = 150, x0 = 54;
      var wa = (it.a || 0) / mx * bw, wb = (it.b || 0) / mx * bw, c = col3(it.d, it.thr);
      p.push('<text x="0" y="' + (y0 + 8) + '" font-size="9.5" font-weight="700" ' + DX + '>' + esc(it.t) + '</text>');
      p.push('<text x="0" y="' + (y0 + 22) + '" font-size="8.5" ' + DX + '>Geçen yıl</text>');
      p.push('<rect x="' + x0 + '" y="' + (y0 + 14) + '" width="' + Math.max(wa, 1.5).toFixed(1) + '" height="10" rx="3" fill="#CBD5E1"/>');
      p.push('<text x="' + (x0 + wa + 4).toFixed(1) + '" y="' + (y0 + 22.5) + '" font-size="9" ' + TX + '>' + (it.a == null ? '—' : it.f(it.a)) + '</text>');
      p.push('<text x="0" y="' + (y0 + 36) + '" font-size="8.5" ' + DX + '>Bu yıl</text>');
      p.push('<rect x="' + x0 + '" y="' + (y0 + 28) + '" width="' + Math.max(wb, 1.5).toFixed(1) + '" height="10" rx="3" fill="' + c + '"/>');
      p.push('<text x="' + (x0 + wb + 4).toFixed(1) + '" y="' + (y0 + 36.5) + '" font-size="9" font-weight="700" ' + TX + '>' + it.f(it.b) + '</text>');
      p.push('<text x="' + (W - 2) + '" y="' + (y0 + 28) + '" font-size="13" font-weight="800" text-anchor="end" fill="' + c + '">' + (it.d == null ? '' : (it.d >= it.thr ? '▲ ' : (it.d <= -it.thr ? '▼ ' : '● '))) + esc(it.dt) + '</text>');
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Geçen yıl ve bu yıl karşılaştırması" style="max-width:' + W + 'px">' + p.join('') + '</svg>';
  }

  // Aylık kutu çıkışı: çubuk = o ayın kutusu, renk = bir önceki aya göre artış/düşüş, kesik çizgi = aylık ortalama, altında aya göre %
  function kutuSvg(o) {
    var k = o.ks; if (!k) return '';
    var first = k.L[0].m, last = k.L[k.L.length - 1].m, n = last - first + 1;
    var W = 330, H = 132, pl = 4, pr = 4, pt = 16, pb = 30, ch = H - pt - pb, bw = (W - pl - pr) / n, maxV = 1, p = [], i;
    k.L.forEach(function (x) { if (x.kutu > maxV) maxV = x.kutu; });
    var TX = 'style="fill:var(--text)"', DX = 'style="fill:var(--dim)"';
    k.L.forEach(function (x) {
      var idx = x.m - first, bx = pl + idx * bw + bw * 0.14, w = bw * 0.72, cx = bx + w / 2, h = Math.max(1.5, x.kutu / maxV * ch), y = pt + ch - h;
      var c = x.mom == null ? '#94A3B8' : (x.mom >= 5 ? '#16A34A' : (x.mom <= -5 ? '#DC2626' : '#94A3B8'));
      p.push('<rect x="' + bx.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2.5" fill="' + c + '"/>');
      p.push('<text x="' + cx.toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" font-size="8" text-anchor="middle" ' + TX + '>' + fmt(x.kutu) + '</text>');
      p.push('<text x="' + cx.toFixed(1) + '" y="' + (pt + ch + 10) + '" font-size="8.5" text-anchor="middle" ' + DX + '>' + AY_KISA[x.m - 1] + '</text>');
      if (x.mom != null) p.push('<text x="' + cx.toFixed(1) + '" y="' + (pt + ch + 21) + '" font-size="7.5" font-weight="700" text-anchor="middle" fill="' + c + '">' + sgn(x.mom) + '%</text>');
    });
    var ly = pt + ch - k.ort / maxV * ch;
    p.push('<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + ly.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="#8B5CF6" stroke-width="1.2" stroke-dasharray="4 3"/>');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Aylık kutu çıkışı" style="max-width:' + W + 'px">' + p.join('') + '</svg>';
  }

  // Aylık: bu yıl − geçen yıl pazar payı farkı (puan), ± ayrışan çubuklar + alt şeritte EVO
  function aylikSvg(u, o) {
    var n = Math.min(12, Math.max(o.last, 6));
    var W = 330, H = 134, pl = 4, pr = 4, pt = 14, pb = 36, ph = H - pt - pb, bw = (W - pl - pr) / n, zy = pt + ph / 2, half = ph / 2 - 9;
    var maxA = 0.5, m, d, p = [], TX = 'style="fill:var(--text)"', DX = 'style="fill:var(--dim)"';
    for (m = 1; m <= n; m++) { d = u.ay[m]; if (d.has && d.ms25 != null && d.ms26 != null) maxA = Math.max(maxA, Math.abs(d.ms26 - d.ms25)); }
    p.push('<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + zy.toFixed(1) + '" y2="' + zy.toFixed(1) + '" stroke="#94A3B8" stroke-width="1"/>');
    for (m = 1; m <= n; m++) {
      d = u.ay[m];
      var x = pl + (m - 1) * bw, bx = x + bw * 0.16, w = bw * 0.68, cx = bx + w / 2;
      if (d.has && d.ms25 != null && d.ms26 != null) {
        var pp = d.ms26 - d.ms25, h = Math.max(1.5, Math.abs(pp) / maxA * half), up = pp >= 0;
        p.push('<rect x="' + bx.toFixed(1) + '" y="' + (up ? zy - h : zy).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2.5" fill="' + (up ? '#16A34A' : '#DC2626') + '"/>');
        p.push('<text x="' + cx.toFixed(1) + '" y="' + (up ? zy - h - 3 : zy + h + 9).toFixed(1) + '" font-size="8" text-anchor="middle" ' + TX + '>' + sgn(pp, 1) + '</text>');
      }
      p.push('<text x="' + cx.toFixed(1) + '" y="' + (pt + ph + 11) + '" font-size="8.5" text-anchor="middle" ' + DX + '>' + AY_KISA[m - 1] + '</text>');
      var ec = evoColor(d.has ? d.evo : null);
      p.push('<rect x="' + bx.toFixed(1) + '" y="' + (pt + ph + 15) + '" width="' + w.toFixed(1) + '" height="13" rx="3" fill="' + ec.bg + '"/>');
      p.push('<text x="' + cx.toFixed(1) + '" y="' + (pt + ph + 25) + '" font-size="8" font-weight="700" text-anchor="middle" fill="' + ec.fg + '">' + (d.has && d.evo != null ? Math.round(d.evo) : '–') + '</text>');
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Aylık pazar payı farkı ve EVO" style="max-width:' + W + 'px">' + p.join('') + '</svg>';
  }

  function legendHtml() {
    return '<div class="kg-legend">' +
      '<span><em style="background:#CBD5E1"></em>Geçen yıl</span>' +
      '<span><em style="background:#16A34A"></em>Bu yıl: artış</span>' +
      '<span><em style="background:#94A3B8"></em>Bu yıl: değişim küçük</span>' +
      '<span><em style="background:#DC2626"></em>Bu yıl: düşüş</span>' +
      '<span>Aylık grafik: çubuk = pazar payı farkı (bu yıl − geçen yıl, puan) · alt şerit = EVO (≥120 <em style="background:#16A34A"></em> · 100–120 <em style="background:#86EFAC"></em> · 80–100 <em style="background:#FCD34D"></em> · &lt;80 <em style="background:#F87171"></em>)</span>' +
      '</div>';
  }

  function chip(label, val, cls) { return '<div class="kg-chip"><small>' + label + '</small><span class="' + (cls || '') + '">' + val + '</span></div>'; }

  function detailHtml(it) {
    var u = it.row, o = it.a, m, r = [];
    if (u.ay) {
      for (m = 1; m <= 12; m++) {
        var d = u.ay[m]; if (!d.has) continue;
        var pp = (d.ms25 != null && d.ms26 != null) ? d.ms26 - d.ms25 : null;
        var kx = o.ks ? o.ks.L.filter(function (z) { return z.m === m; })[0] : null, mom = kx ? kx.mom : null;
        r.push('<tr><td>' + AY_ADI[m - 1] + '</td><td>' + fmt(d.kutu) + '</td><td class="' + deltaCls(mom, 5) + '">' + (mom == null ? '—' : sgn(mom) + '%') + '</td><td>' + (d.ms25 == null ? '—' : '%' + fmt(d.ms25, 1)) + '</td><td>' +
          (d.ms26 == null ? '—' : '%' + fmt(d.ms26, 1)) + '</td><td class="' + deltaCls(pp, 0.5) + '">' + (pp == null ? '—' : sgn(pp, 1)) + '</td><td>' + (d.evo == null ? '—' : fmt(d.evo)) + '</td></tr>');
      }
    }
    var html = '<details><summary>Aylık detay tablosu</summary>';
    if (r.length) html += '<div class="kg-scroll"><table class="kg-tbl"><thead><tr><th>Ay (bu yıl)</th><th>Kutu</th><th>Aya göre</th><th>Pay geçen yıl</th><th>Pay bu yıl</th><th>Fark (puan)</th><th>EVO</th></tr></thead><tbody>' + r.join('') + '</tbody></table></div>';
    if (o.tl != null) html += '<div class="kg-note" style="margin-top:6px">YTD ciro (bu yıl): ' + fmt(o.tl) + ' TL</div>';
    return html + '</details>';
  }

  function badge(d, sm) {
    var v = VERDICT[d];
    return '<span class="kg-badge" style="color:' + v.c + ';background:' + v.bg + (sm ? ';font-size:9px;padding:2px 7px' : '') + '">' + v.ic + ' ' + v.lbl + '</span>';
  }
  // 6 aylık dönemler: 1. altı ay · 2. altı ay · toplam (YTD) — durum = o dönemin EVO'suna göre derece
  function donemTablo(it) {
    var o = it.a, u = it.row, rows = [];
    if (!o.donem || !(o.donem.h1 || o.donem.h2)) {
      return '<div class="kg-note" style="margin:6px 0">Bu kayıt için aylık veri yok; yalnızca toplam (YTD) durum değerlendirildi.</div>';
    }
    function bd(m) { return m ? '<span class="' + deltaCls(m.relEvo, ESIK.bolgeEvo) + '">' + sgn(m.relEvo) + '</span>' : '—'; }
    DONEM.forEach(function (D0) {
      var P = o.donem[D0.k];
      if (!P) { rows.push('<tr><td>' + D0.ad + '</td><td colspan="6" style="text-align:left;color:var(--dim)">veri yok</td></tr>'); return; }
      var kisa = P.n < (D0.b - D0.a + 1);
      rows.push('<tr><td style="font-weight:700">' + D0.ad + '<div class="kg-note">' + donemAd(P) + (kisa ? ' · kısmi (' + P.n + ' ay)' : '') + '</div></td><td>' + fmt(P.kutu) + '<div class="kg-note">ay ort. ' + fmt(P.ortKutu) + '</div></td><td>' +
        (P.ms25 == null ? '—' : '%' + fmt(P.ms25, 1) + ' → %' + fmt(P.ms26, 1)) + '<div class="kg-note ' + deltaCls(P.pp, 0.5) + '">' + (P.pp == null ? '' : sgn(P.pp, 1) + ' puan') + '</div></td><td class="' + deltaCls(P.evo == null ? null : P.evo - 100, 10) + '"><b>' + fmt(P.evo) + '</b></td><td>' +
        (D0.k === 'h1' ? bd(o.bolgeH1) : (o.h2Delta != null ? '<span class="' + (o.h2Yon === 'guclendi' ? 'kg-up' : (o.h2Yon === 'zayifladi' ? 'kg-dn' : 'kg-nt')) + '" title="H1 sonundan son aya bölgeye göre fark değişimi">Δ ' + sgn(o.h2Delta) + '</span>' : '—')) +
        '</td><td>' + (D0.k === 'h1' ? (o.durumH1B ? badge(o.durumH1B, true) : '—') : (o.h2Yon ? '<span class="kg-badge" style="color:' + (o.h2Yon === 'guclendi' ? '#15803D' : (o.h2Yon === 'zayifladi' ? '#DC2626' : '#64748B')) + ';background:rgba(100,116,139,.12);font-size:9px;padding:2px 7px">' + (o.h2Yon === 'guclendi' ? '▲ bölgeye göre güçlendi' : (o.h2Yon === 'zayifladi' ? '▼ bölgeye göre zayıfladı' : '● bölgeye göre sabit')) + '</span>' : '—')) + '</td><td>' + badge(P.durum, true) + '</td></tr>');
    });
    var T = o.donem.tam, tk = o.k26 != null ? o.k26 : (T ? T.kutu : null), tms25 = o.ms25 != null ? o.ms25 : (T ? T.ms25 : null), tms26 = o.ms26 != null ? o.ms26 : (T ? T.ms26 : null), te = o.evo != null ? o.evo : (T ? T.evo : null);
    rows.push('<tr style="background:var(--surf2)"><td style="font-weight:800">Toplam (YTD)<div class="kg-note">' + (T ? donemAd(T) : '') + '</div></td><td>' + fmt(tk) + (o.kutuD != null ? '<div class="kg-note ' + deltaCls(o.kutuD, ESIK.kutuPct) + '">' + sgn(o.kutuD) + '% geçen yıla göre</div>' : '') + '</td><td>' +
      (tms25 == null ? '—' : '%' + fmt(tms25, 1) + ' → %' + fmt(tms26, 1)) + '<div class="kg-note ' + deltaCls(tms26 != null && tms25 != null ? tms26 - tms25 : null, 0.5) + '">' + (tms25 == null ? '' : sgn(tms26 - tms25, 1) + ' puan') + '</div></td><td class="' + deltaCls(te == null ? null : te - 100, 10) + '"><b>' + fmt(te) + '</b></td><td>' + bd(o.bolge) + '</td><td>' + (o.mod === 'bolge' ? badge(o.durum, true) : '—') + '</td><td>' + badge(gradeEvo(te), true) + '</td></tr>');
    return '<div class="kg-cap">6 aylık dönemler — 1. altı ay · 2. altı ay · toplam</div><div class="kg-scroll"><table class="kg-tbl" style="min-width:420px"><thead><tr><th>Dönem</th><th>Kutu</th><th>Pazar payı (geçen yıl → bu yıl)</th><th>EVO</th><th>Bölgeye göre EVO farkı</th><th>Bölgeye göre durum</th><th>Mutlak durum (EVO)</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<div class="kg-note"><b>Bölgeye göre durum</b> asıl değerlendirmedir: kongreye hekim gönderilmeyen bricklerin medyanına kıyaslanır. 1. altı ay = Haziran kümülatifi, toplam = en güncel kümülatif; 2. altı ay tek başına ayrılamadığı için H1 sonundan son aya bölgeye göre fark değişimi (Δ) gösterilir. <b>Mutlak durum</b> yalnızca dönemin kendi EVO\'suna göredir (≥125 İvme · 110–125 Pozitif · 90–110 Nötr · 75–90 Zayıflama · &lt;75 Düşüş) ve bölge geneli eğilimleri (ör. yıl içinde düşen EVO) de yansıtır.</div>';
  }

  function hekimBlock(it) {
    var at = it.att; if (!at || !at.hekimler.length) return '';
    var own = key(it.row.urun);
    var rows = at.hekimler.map(function (h) {
      var tag = h.urunler.map(function (pr) { return '<span style="' + (key(pr) === own ? 'font-weight:800;color:var(--c1)' : 'opacity:.75') + '">' + esc(pr) + '</span>'; }).join(' · ');
      return '<div style="padding:4px 0;border-bottom:1px dashed var(--border)"><b>' + esc(h.ad) + '</b>' + (h.unvan ? ' <span style="opacity:.75">· ' + esc(h.unvan) + '</span>' : '') +
        '<div class="kg-note">' + esc([h.brans, h.unite, h.il].filter(Boolean).join(' · ')) + (tag ? ' — Tanıtılan: ' + tag : '') + '</div></div>';
    }).join('');
    return '<div class="kg-cap" style="margin-top:10px">👨‍⚕️ Katılan hekimler (' + at.sayi + ')</div><div style="font-size:11px">' + rows + '</div>' +
      '<div class="kg-note" style="margin-top:3px">Satış rakamları hekim bazında değil, hekimlerin bulunduğu brickin ürün performansıdır; aynı brickteki hekimler aynı sonucu paylaşır.</div>';
  }

  function cardHtml(it, showTtt) {
    var u = it.row, o = it.a, v = VERDICT[o.durum], sub = [];
    if (showTtt) sub.push(esc(u.ttt));
    sub.push(esc(u.brick));
    if (it.att) sub.push(o.coklu ? '<b style="color:#2563EB">👥 Çoklu hekim: ' + o.hekimN + (o.hekimEsles ? ' (bu ürün)' : '') + '</b>' : (o.hekimN || it.att.sayi) + ' hekim katıldı');
    var html = '<div class="kg-card" style="border-left:4px solid ' + v.c + '"><div class="kg-card-hd"><div><div class="kg-title">🎪 ' + esc(u.kongre) +
      ' <span style="font-weight:600;color:var(--c1)">· ' + esc(u.urun) + '</span></div><div class="kg-sub">' + sub.join(' · ') + '</div></div>' +
      '<span class="kg-badge" style="color:' + v.c + ';background:' + v.bg + '" title="' + (o.mod === 'bolge' ? 'Karar: kongreye hekim gönderilmeyen bricklere (bölge) göre' : 'Karar: yalnızca geçen yıla göre (bölge kıyası yok)') + '">' + v.ic + ' ' + v.lbl + (o.mod === 'bolge' ? ' · bölgeye göre' : '') + '</span></div>';
    html += '<div class="kg-body"><div>' + yoyBars(o);
    if (o.ks) html += '<div class="kg-cap">Aylık kutu çıkışı (renk: önceki aya göre · kesik çizgi: aylık ortalama)</div>' + kutuSvg(o);
    if (u.ay && o.aylik.length) html += '<div class="kg-cap">Aylık pazar payı farkı (bu yıl − geçen yıl, puan)</div>' + aylikSvg(u, o);
    if (!o.ks && !(u.ay && o.aylik.length)) html += '<div class="kg-note" style="margin-top:6px">Bu ürün için aylık veri yok; YTD karşılaştırma gösteriliyor.</div>';
    html += '</div><div>';
    html += donemTablo(it);
    if (OLCULEN.indexOf(o.durum) >= 0) {
      html += '<div class="kg-chips">' +
        (o.kutuD != null ? chip('Kutu (geçen yıla göre)', fmt(o.k25) + ' → ' + fmt(o.k26) + ' <span class="' + deltaCls(o.kutuD, ESIK.kutuPct) + '">' + arrow(o.kutuD, ESIK.kutuPct) + sgn(o.kutuD) + '%</span>') : '') +
        (o.ms25 != null ? chip('Pazar payı', '%' + fmt(o.ms25, 1) + ' → %' + fmt(o.ms26, 1) + ' <span class="' + deltaCls(o.ppD, 0.5) + '">' + arrow(o.ppD, 0.5) + sgn(o.ppD, 1) + ' puan</span>') : '') +
        (o.evo != null ? chip('EVO (pazara göre gelişim)', '<span class="' + deltaCls(o.evo - 100, 10) + '">' + arrow(o.evo - 100, 10) + fmt(o.evo) + '</span>') : '') +
        (o.net != null ? chip('Yıllık ek kutu (YTD)', '<span class="' + deltaCls(o.net, 1) + '">' + sgn(o.net) + ' kutu</span>') : '') +
        (o.bolge ? chip('Bölgeye göre EVO', '<span class="' + deltaCls(o.bolge.relEvo, ESIK.bolgeEvo) + '">' + arrow(o.bolge.relEvo, ESIK.bolgeEvo) + sgn(o.bolge.relEvo) + ' puan</span> <span class="kg-nt">· %' + o.bolge.pct + ' dilim</span>') : '') +
        (o.ekKutu != null ? chip('Bölge hızına göre ek kutu', '<span class="' + deltaCls(o.ekKutu, 1) + '">' + sgn(o.ekKutu) + ' kutu</span>') : '') +
        chip('Güven', '<span class="' + (o.guven >= 2 ? 'kg-up' : (o.guven === 0 ? 'kg-dn' : 'kg-nt')) + '">' + GUVEN[o.guven] + '</span>') +
        (o.netHekim != null ? chip('Hekim başı ek kutu', '<span class="' + deltaCls(o.netHekim, 1) + '">' + sgn(o.netHekim, Math.abs(o.netHekim) < 10 ? 1 : 0) + '</span> <span class="kg-nt">· ' + o.brickHekim + ' hekim</span>') : '') +
        (o.tumEvo != null ? chip('Brick geneli EVO', fmt(o.tumEvo)) : '') +
        (o.aylik.length ? chip('Pay > geçen yıl', o.nUst + ' / ' + o.aylik.length + ' ay', o.nUst / o.aylik.length >= 0.6 ? 'kg-up' : (o.nUst / o.aylik.length <= 0.4 ? 'kg-dn' : 'kg-nt')) : '') +
        (o.ks ? chip('Aylık kutu (ort.)', fmt(o.ks.ort) + ' <span class="kg-nt">· toplam ' + fmt(o.ks.toplam) + '</span>') : '') +
        (o.ks ? chip('Son ay kutu', fmt(o.ks.son.kutu) + (o.ks.son.mom != null ? ' <span class="' + deltaCls(o.ks.son.mom, 5) + '">' + arrow(o.ks.son.mom, 5) + sgn(o.ks.son.mom) + '%</span>' : '')) : '') +
        (o.ks && o.ks.trend != null ? chip('Son 3 ay kutu', fmt(o.ks.l3a) + ' <span class="' + deltaCls(o.ks.trend, 10) + '">' + arrow(o.ks.trend, 10) + sgn(o.ks.trend) + '%</span>') : '') +
        (o.mom != null ? chip('Son 3 ay EVO', fmt(o.evoL3) + ' <span class="' + deltaCls(o.mom, ESIK.momFark) + '">' + arrow(o.mom, ESIK.momFark) + (o.mom >= ESIK.momFark ? 'ivme artıyor' : (o.mom <= -ESIK.momFark ? 'yavaşlıyor' : 'sabit')) + '</span>') : '') +
        '</div>';
    }
    html += '<div class="kg-txt">' + esc(o.yorum) + '</div>' + hekimBlock(it) + detailHtml(it) + '</div></div></div>';
    return html;
  }

  // ───────────────────────── tablolar ─────────────────────────
  function teamTable(items, hsFn) {
    var by = {}, order = [];
    items.forEach(function (it) { var k = key(it.row.ttt); if (!by[k]) { by[k] = { ad: it.row.ttt, items: [] }; order.push(k); } by[k].items.push(it); });
    if (order.length < 2) return '';
    var rows = order.map(function (k) {
      var S = summarize(by[k].items); S.ad = by[k].ad;
      var H = hsFn ? hsFn(k) : null;
      if (H) { S.hekim = H.hekim; S.brickN = H.brick; S.bricks = H.byBrick; }
      return S;
    })
      .sort(function (x, y) { return (y.oran == null ? -1 : y.oran) - (x.oran == null ? -1 : x.oran); });
    var tr = rows.map(function (S) {
      var o = S.oran, bc = o == null ? '#CBD5E1' : (o >= 60 ? '#16A34A' : (o >= 35 ? '#F59E0B' : '#DC2626'));
      return '<tr><td style="font-weight:700">' + esc(S.ad) + '</td><td>' + S.kayit + '</td><td>' + S.olculen + '</td>' +
        '<td class="kg-up">' + S.ivme + '</td><td class="kg-up">' + S.pozitif + '</td><td class="kg-nt">' + S.notr + '</td><td class="kg-dn">' + (S.zayif + S.dusus) + '</td>' +
        '<td style="min-width:110px"><div style="display:flex;align-items:center;gap:6px"><div class="kg-bar" style="flex:1"><i style="width:' + (o == null ? 0 : Math.min(100, o)) + '%;background:' + bc + '"></i></div>' +
        '<b style="min-width:34px;text-align:right">' + (o == null ? '—' : '%' + fmt(o)) + '</b></div></td>' +
        '<td class="' + deltaCls(S.net, 1) + '">' + (S.olculen ? sgn(S.net) : '—') + '</td><td><b>' + S.hekim + '</b></td>' +
        '<td style="text-align:left;font-size:11px;min-width:190px">' + (S.bricks && S.bricks.length ? S.bricks.map(function (b) { return esc(b.brick) + ' <b>(' + b.n + ')</b>'; }).join('<br>') : '—') + '</td></tr>';
    }).join('');
    return '<div class="kg-sec">👥 Temsilci Karşılaştırması<i></i></div><div class="kg-scroll"><table class="kg-tbl" style="min-width:560px"><thead><tr><th>Temsilci</th><th title="Kongre × brick × ürün analiz birimi">Analiz kaydı</th><th>Ölçülebilen</th><th>İvme</th><th>Pozitif</th><th>Nötr</th><th>Zayıf/Düşüş</th><th>Karşılık oranı</th><th>Yıllık ek kutu</th><th>Gönderilen hekim</th><th>Brick (hekim sayısı)</th></tr></thead><tbody>' + tr + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">Kayıt = kongre × brick × ürün analiz birimi (hekim sayısı değildir). Karşılık oranı = (İvme + Pozitif) ÷ ölçülebilen kayıt. Yıllık ek kutu = ilgili brick–ürünlerde bu yılın YTD kutusu − geçen yılın YTD kutusu.</div>';
  }

  // Hekim bazlı değerlendirme: her hekim için kongre/brick'teki ürün sonuçları + branş bazında karşılık özeti
  function hekimBolumu(items, S, showTtt) {
    var groups = {}, order = [];
    items.forEach(function (it) {
      var gk = [key(it.row.kongre), key(it.row.ttt), key(it.row.brick)].join('|');
      if (!groups[gk]) { groups[gk] = { first: it, units: [], att: it.att }; order.push(gk); }
      groups[gk].units.push(it);
    });
    var rows = [], bransAgg = {};
    order.forEach(function (gk) {
      var G = groups[gk]; if (!G.att) return;
      G.att.hekimler.forEach(function (h) {
        var badges = G.units.map(function (u) { return { it: u, own: h.urunler.some(function (pr) { return key(pr) === key(u.row.urun); }) }; });
        if (!S.urun && !S.sonuc) {      // filtre yokken: ölçülemeyen ürünler (ör. FAMTREC) de görünsün
          h.urunler.forEach(function (pr) { if (PROD_BLOCKS.indexOf(key(pr)) < 0) badges.push({ it: null, name: pr, own: true }); });
        }
        if (!badges.length) return;
        rows.push({ h: h, g: G.first, badges: badges });
        var b = h.brans || 'Branş belirtilmemiş', A = bransAgg[b] || (bransAgg[b] = { hek: {}, pair: 0, ok: 0 });
        A.hek[key(h.ad) + '|' + key(h.unite)] = 1;
        badges.forEach(function (x) { if (x.it && OLCULEN.indexOf(x.it.a.durum) >= 0) { A.pair++; if (x.it.a.durum === 'ivme' || x.it.a.durum === 'pozitif') A.ok++; } });
      });
    });
    if (!rows.length) return '';
    rows.sort(function (x, y) { return x.g.row.ttt.localeCompare(y.g.row.ttt, 'tr') || x.g.row.kongre.localeCompare(y.g.row.kongre, 'tr') || x.h.ad.localeCompare(y.h.ad, 'tr'); });
    var bl = Object.keys(bransAgg).map(function (b) { var A = bransAgg[b]; return { b: b, n: Object.keys(A.hek).length, pair: A.pair, ok: A.ok, oran: A.pair ? A.ok / A.pair * 100 : null }; })
      .sort(function (x, y) { return (y.oran == null ? -1 : y.oran) - (x.oran == null ? -1 : x.oran) || y.n - x.n; });
    var bt = bl.map(function (x) {
      var bc = x.oran == null ? '#CBD5E1' : (x.oran >= 60 ? '#16A34A' : (x.oran >= 35 ? '#F59E0B' : '#DC2626'));
      return '<tr><td style="font-weight:700">' + esc(x.b) + '</td><td>' + x.n + '</td><td>' + x.pair + '</td><td>' + x.ok + '</td><td style="min-width:110px"><div style="display:flex;align-items:center;gap:6px"><div class="kg-bar" style="flex:1"><i style="width:' + (x.oran == null ? 0 : Math.min(100, x.oran)) + '%;background:' + bc + '"></i></div><b style="min-width:34px;text-align:right">' + (x.oran == null ? '—' : '%' + fmt(x.oran)) + '</b></div></td></tr>';
    }).join('');
    var tr = rows.map(function (r) {
      var bd = r.badges.map(function (x) {
        if (!x.it) return '<span class="kg-badge" style="color:#64748B;background:rgba(100,116,139,.12);margin:1px 3px 1px 0">★ ' + esc(x.name) + ' · veri yok</span>';
        var v = VERDICT[x.it.a.durum], o = x.it.a;
        var val = o.kutuD != null ? sgn(o.kutuD) + '%' : (o.evo != null ? 'EVO ' + fmt(o.evo) : '');
        return '<span class="kg-badge" style="color:' + v.c + ';background:' + v.bg + ';margin:1px 3px 1px 0" title="' + esc(v.lbl) + '">' + (x.own ? '★ ' : '') + esc(x.it.row.urun) + ' ' + v.ic + ' ' + esc(val) + '</span>';
      }).join('');
      return '<tr><td style="font-weight:700">' + esc(r.h.ad) + (r.h.unvan ? '<div class="kg-note">' + esc(r.h.unvan) + '</div>' : '') + '</td><td>' + esc(r.h.brans || '—') + '</td><td>' + esc([r.h.unite, r.h.il].filter(Boolean).join(' · ') || '—') + '</td>' +
        '<td>' + esc(r.g.row.kongre) + '</td>' + (showTtt ? '<td>' + esc(r.g.row.ttt) + '</td>' : '') + '<td>' + esc(r.g.row.brick) + '</td><td style="text-align:left;min-width:190px">' + bd + '</td></tr>';
    }).join('');
    return '<div class="kg-sec">👨‍⚕️ Hekim Bazlı Değerlendirme (' + rows.length + ' hekim kaydı)<i></i></div>' +
      '<div class="kg-note" style="margin-bottom:6px">Hekim bazında satış verisi yoktur; her hekimin yanında, katıldığı kongredeki ürünlerin <b>bulunduğu brickteki</b> geçen yıla göre sonucu gösterilir (★ = hekime tanıtılan ürün). Aynı brickte birden çok hekim varsa hepsi aynı brick sonucunu paylaşır.</div>' +
      '<div class="kg-scroll"><table class="kg-tbl" style="min-width:420px"><thead><tr><th>Branş bazında karşılık</th><th>Hekim</th><th>Ölçülen hekim–ürün</th><th>İvme + Pozitif</th><th>Karşılık oranı</th></tr></thead><tbody>' + bt + '</tbody></table></div>' +
      '<div class="kg-scroll" style="margin-top:10px"><table class="kg-tbl kg-left" style="min-width:760px"><thead><tr><th>Hekim</th><th>Branş</th><th>Ünite · İl</th><th>Kongre</th>' + (showTtt ? '<th>Temsilci</th>' : '') + '<th>Brick</th><th>Ürün sonuçları (geçen yıla göre kutu)</th></tr></thead><tbody>' + tr + '</tbody></table></div>';
  }

  function yogunlukTablo(Sm) {
    if (!Sm.coklu.kayit) return '';
    function satir(ad, G) {
      var bc = G.oran == null ? '#CBD5E1' : (G.oran >= 60 ? '#16A34A' : (G.oran >= 35 ? '#F59E0B' : '#DC2626'));
      return '<tr><td style="font-weight:700">' + ad + '</td><td>' + G.kayit + '</td><td>' + G.olculen + '</td><td class="kg-up">' + G.ok + '</td>' +
        '<td style="min-width:120px"><div style="display:flex;align-items:center;gap:6px"><div class="kg-bar" style="flex:1"><i style="width:' + (G.oran == null ? 0 : Math.min(100, G.oran)) + '%;background:' + bc + '"></i></div><b style="min-width:34px;text-align:right">' + (G.oran == null ? '—' : '%' + fmt(G.oran)) + '</b></div></td>' +
        '<td class="' + deltaCls(G.hbOrt, 1) + '">' + (G.hbOrt == null ? '—' : sgn(G.hbOrt, Math.abs(G.hbOrt) < 10 ? 1 : 0)) + '</td></tr>';
    }
    return '<div class="kg-sec">👥 Hekim Yoğunluğu — aynı bricten aynı ürün için gönderilen hekim sayısı<i></i></div>' +
      '<div class="kg-scroll"><table class="kg-tbl" style="min-width:480px"><thead><tr><th>Grup</th><th>Kayıt</th><th>Ölçülebilen</th><th>İvme + Pozitif</th><th>Karşılık oranı</th><th>Hekim başı ek kutu</th></tr></thead><tbody>' +
      satir('Tek hekim', Sm.tek) + satir('Çoklu hekim (≥2)', Sm.coklu) + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">Hekim başı ek kutu = brick–ürünün yıllık (YTD) ek kutusu ÷ o brick–ürün için tüm kongrelerde gönderilen farklı hekim sayısı. Hekim bazında satış verisi olmadığından brick sonucu hekimler arasında eşit paylaştırılır.</div>';
  }

  function bolgeTablo() {
    if (!D.reg) return '<div class="kg-note" style="margin:8px 0;padding:8px 10px;border:1px dashed #D97706;border-radius:10px">⚠ <b>MI_GI-KUTU.csv</b> okunamadığı için bölge (kontrol grubu) kıyası yapılamadı; sonuçlar yalnızca geçen yıla göredir ve pazar/bölge kaynaklı büyüme ayrıştırılamaz.</div>';
    var G = D.reg.grp.slice().sort(function (a, b) { return a.pk.localeCompare(b.pk, 'tr'); });
    if (!G.length) return '';
    var tr = G.map(function (g) {
      var first = g.seri[0], last = g.seri[g.seri.length - 1], baştan = first && Math.abs(first.gap) >= 0.7 * Math.abs(g.gap) && Math.abs(g.gap) >= ESIK.bolgeEvo;
      var yor;
      if (Math.abs(g.gap) < ESIK.bolgeEvo) yor = 'Kongre bricklerinin performansı bölgeden ayrışmıyor.';
      else if (g.gap < 0) yor = 'Kongre brickleri bölgenin altında.';
      else if (baştan) yor = 'Üstünlük en baştan beri var: kongreden önce de farklıydılar (seçilim etkisi olabilir).';
      else yor = 'Üstünlük zamanla açılmış: kongre ile tutarlı, ama kanıt değil.';
      var pt = g.p == null ? '—' : (g.p < 0.05 ? 'p=' + fmt(g.p, 2) + ' (anlamlı)' : (g.p < 0.15 ? 'p=' + fmt(g.p, 2) + ' (zayıf kanıt)' : 'p=' + fmt(g.p, 2) + ' (şansa bağlı olabilir)'));
      var sr = g.seri.map(function (x) { return AY_KISA[x.m - 1] + ' ' + sgn(x.gap); }).join(' · ');
      return '<tr><td style="font-weight:700">' + esc(g.pk) + '</td><td>' + g.nA + '</td><td>' + g.nC + '</td><td>' + fmt(g.medA) + '</td><td>' + fmt(g.medC) + '</td><td class="' + deltaCls(g.gap, ESIK.bolgeEvo) + '"><b>' + sgn(g.gap) + '</b></td>' +
        '<td style="text-align:left;font-size:10px">' + esc(sr) + '</td><td>' + esc(pt) + '</td><td style="text-align:left;min-width:200px">' + esc(yor) + '</td></tr>';
    }).join('');
    return '<div class="kg-sec">🧪 Bölge Kıyası — kongre brickleri ve kongreye hekim gönderilmeyen brickler<i></i></div>' +
      '<div class="kg-scroll"><table class="kg-tbl kg-left" style="min-width:760px"><thead><tr><th>Ürün</th><th>Kongre brick</th><th>Kontrol brick</th><th>EVO medyan (kongre)</th><th>EVO medyan (kontrol)</th><th>Fark (puan)</th><th>Fark seyri (aylık kümülatif)</th><th>Şans testi</th><th>Yorum</th></tr></thead><tbody>' + tr + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">Kontrol grubu = hiçbir kongreye hekim gönderilmeyen bölge brickleri (MI_GI-KUTU). Şans testi, kongre/kontrol etiketleri rastgele karıştırıldığında bu kadar fark görülme olasılığıdır (permütasyon; küçük p = fark şansa bağlı değil). Fark seyri artıyorsa üstünlük zamanla açılmıştır; baştan varsa seçilim etkisi olabilir.</div>';
  }

  function donemOzet(items) {
    var seen = {}, C = { h1: {}, h2: {}, tam: {} }, geç = { iyi: 0, ayni: 0, kotu: 0 }, n = 0, k;
    var ks = ['ivme', 'pozitif', 'notr', 'zayif', 'dusus', 'veri'];
    ['h1', 'h2', 'tam'].forEach(function (d) { ks.forEach(function (x) { C[d][x] = 0; }); });
    items.forEach(function (it) {
      var nk = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
      if (seen[nk] || !it.a.donem || !(it.a.donem.h1 || it.a.donem.h2)) return; seen[nk] = 1; n++;
      var d = it.a.donem, g1 = d.h1 ? d.h1.durum : 'veri', g2 = d.h2 ? d.h2.durum : 'veri', gt = gradeEvo(it.a.evo != null ? it.a.evo : (d.tam ? d.tam.evo : null));
      C.h1[g1]++; C.h2[g2]++; C.tam[gt]++;
      if (g1 !== 'veri' && g2 !== 'veri') { var a = VERDICT[g2].rank - VERDICT[g1].rank; if (a > 0) geç.iyi++; else if (a < 0) geç.kotu++; else geç.ayni++; }
    });
    if (!n) return '';
    function satir(ad, X) {
      var olc = X.ivme + X.pozitif + X.notr + X.zayif + X.dusus, ok = X.ivme + X.pozitif;
      return '<tr><td style="font-weight:700">' + ad + '</td><td class="kg-up">' + X.ivme + '</td><td class="kg-up">' + X.pozitif + '</td><td class="kg-nt">' + X.notr + '</td><td class="kg-dn">' + X.zayif + '</td><td class="kg-dn">' + X.dusus + '</td><td>' + X.veri + '</td><td><b>' + (olc ? '%' + fmt(ok / olc * 100) : '—') + '</b></td></tr>';
    }
    var seenB = {}, B = { h1: {}, tam: {} }, Y = { guclendi: 0, sabit: 0, zayifladi: 0 }, nb = 0;
    ks.forEach(function (x) { B.h1[x] = 0; B.tam[x] = 0; });
    items.forEach(function (it) {
      var nk = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
      if (seenB[nk] || it.a.mod !== 'bolge') return; seenB[nk] = 1; nb++;
      B.h1[it.a.durumH1B || 'veri']++; B.tam[it.a.durum]++;
      if (it.a.h2Yon) Y[it.a.h2Yon]++;
    });
    function satirB(ad, X) {
      var olc = X.ivme + X.pozitif + X.notr + X.zayif + X.dusus, ok = X.ivme + X.pozitif;
      return '<tr><td style="font-weight:700">' + ad + '</td><td class="kg-up">' + X.ivme + '</td><td class="kg-up">' + X.pozitif + '</td><td class="kg-nt">' + X.notr + '</td><td class="kg-dn">' + X.zayif + '</td><td class="kg-dn">' + X.dusus + '</td><td>' + X.veri + '</td><td><b>' + (olc ? '%' + fmt(ok / olc * 100) : '—') + '</b></td></tr>';
    }
    var bolgeBlok = nb ? '<div class="kg-cap" style="margin-top:8px">Bölgeye göre (asıl değerlendirme) — ' + nb + ' brick–ürün</div><div class="kg-scroll"><table class="kg-tbl" style="min-width:460px"><thead><tr><th>Dönem</th><th>İvme</th><th>Pozitif</th><th>Nötr</th><th>Zayıflama</th><th>Düşüş</th><th>Veri yok</th><th>Olumlu oranı</th></tr></thead><tbody>' +
      satirB('1. Altı Ay (Haziran kümülatifi)', B.h1) + satirB('Toplam (en güncel kümülatif)', B.tam) + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">2. altı ayın yönü (H1 sonundan son aya bölgeye göre fark değişimi): <b class="kg-up">' + Y.guclendi + ' güçlenen</b> · ' + Y.sabit + ' sabit · <b class="kg-dn">' + Y.zayifladi + ' zayıflayan</b>.</div>' : '';
    return '<div class="kg-sec">🗓️ Dönemsel Durum — 1. altı ay · 2. altı ay · toplam<i></i></div>' + bolgeBlok + '<div class="kg-cap" style="margin-top:10px">Mutlak (geçen yıla göre, kontrolsüz)</div>' +
      '<div class="kg-scroll"><table class="kg-tbl" style="min-width:460px"><thead><tr><th>Dönem (dönemin kendi EVO\'su)</th><th>İvme</th><th>Pozitif</th><th>Nötr</th><th>Zayıflama</th><th>Düşüş</th><th>Veri yok</th><th>Olumlu oranı</th></tr></thead><tbody>' +
      satir('1. Altı Ay (Oca–Haz)', C.h1) + satir('2. Altı Ay (Tem–…, kısmi)', C.h2) + satir('Toplam (YTD)', C.tam) + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">' + n + ' brick–ürün (aylık verisi olanlar). 1. → 2. altı ay geçişi: <b class="kg-up">' + geç.iyi + ' iyileşen</b> · ' + geç.ayni + ' aynı · <b class="kg-dn">' + geç.kotu + ' kötüleşen</b>. Mutlak dereceler bölge geneli eğilimleri de içerir (ör. yıl içinde düşen EVO); 2. altı ay henüz tamamlanmadığı için kısmidir.</div>';
  }

  function heatTable(items, showTtt) {
    var g = {}, order = [], maxLast = 0;
    items.forEach(function (it) {
      var k = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
      if (!g[k]) { g[k] = { row: it.row, a: it.a, ay: null }; order.push(k); }
      if (it.row.ay && !g[k].ay) { g[k].ay = it.row.ay; g[k].aa = it.a; }
      if (it.a.last > maxLast) maxLast = it.a.last;
    });
    if (!order.length) return '';
    order.sort();
    var n = Math.max(maxLast, 6), m, head = '<th></th>';
    for (m = 1; m <= n; m++) head += '<th>' + AY_KISA[m - 1] + '</th>';
    head += '<th>YTD Kutu</th><th>YTD EVO</th>';
    var body = order.map(function (k) {
      var G = g[k], row = G.row, a = G.a, tds = '<td class="kg-lbl">' + (showTtt ? esc(row.ttt) + '<br>' : '') + esc(row.brick) + ' <span style="color:var(--c1)">· ' + esc(row.urun) + '</span></td>';
      for (m = 1; m <= n; m++) {
        var d = G.ay ? G.ay[m] : null;
        if (!d || !d.has || d.evo == null) { tds += '<td><div class="kg-hc" style="background:transparent;color:var(--dim)">·</div></td>'; continue; }
        var ch = d.evo - 100, c = divColor(ch);
        tds += '<td><div class="kg-hc" style="background:' + c.bg + ';color:' + c.fg + '" title="' + esc(AY_ADI[m - 1] + ': pay %' + fmt(d.ms25, 1) + ' → %' + fmt(d.ms26, 1) + ' · ' + fmt(d.kutu) + ' kutu') + '">' +
          sgn(ch) + '%<small>' + fmt(d.kutu) + '</small></div></td>';
      }
      var ck = divColor(a.kutuD), ce = divColor(a.evo == null ? null : a.evo - 100);
      tds += '<td><div class="kg-hc" style="background:' + ck.bg + ';color:' + ck.fg + '">' + (a.kutuD == null ? '—' : sgn(a.kutuD) + '%') + '<small>' + (a.k26 == null ? '' : fmt(a.k26)) + '</small></div></td>';
      tds += '<td><div class="kg-hc" style="background:' + ce.bg + ';color:' + ce.fg + '">' + (a.evo == null ? '—' : fmt(a.evo)) + '</div></td>';
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<div class="kg-sec">🗺️ Brick–Ürün İvme Haritası (geçen yıla göre)<i></i></div>' +
      '<div class="kg-legend"><span><em style="background:#16A34A"></em>≥ +%25</span><span><em style="background:#BBF7D0"></em>+%5…+%25</span><span><em style="background:var(--surf2);border:1px solid var(--border)"></em>±%5</span><span><em style="background:#FECACA"></em>−%5…−%25</span><span><em style="background:#DC2626"></em>≤ −%25</span><span>Aylık hücre = pazar payının geçen yılın aynı ayına göre değişimi (EVO − 100), altında o ayın kutusu · YTD Kutu = geçen yıla göre kutu değişimi</span></div>' +
      '<div class="kg-scroll"><table class="kg-heat"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

    // ───────────────────────── Excel indirme (yönetici) ─────────────────────────
  // Hücre dönüştürme: '6,86%' → 0,0686 (%) · '1.234' / ' 7.833 ' / '12,5' → sayı · diğerleri metin
  function xlCell(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return null;
    var m;
    if ((m = /^(-?\d+(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?)%$/.exec(t))) return { t: 'n', v: parseFloat(m[1].replace(/\./g, '').replace(',', '.')) / 100, z: '0.00%' };
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+(,\d+)?$/.test(t)) return { t: 'n', v: parseFloat(t.replace(/\./g, '').replace(',', '.')) };
    return { t: 's', v: t };
  }
  function xlSheetFromCsv(text) {
    var g = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').map(function (l) { return l.split(';'); });
    while (g.length && g[g.length - 1].join('').trim() === '') g.pop();
    var ws = {}, maxC = 0, wid = [];
    g.forEach(function (row, r) {
      row.forEach(function (c, ci) {
        var x = xlCell(c); if (!x) return;
        ws[XLSX.utils.encode_cell({ r: r, c: ci })] = x;
        if (ci + 1 > maxC) maxC = ci + 1;
        var len = String(x.t === 'n' ? x.v : x.v).length;
        wid[ci] = Math.max(wid[ci] || 8, Math.min(34, len + 2));
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(g.length - 1, 0), c: Math.max(maxC - 1, 0) } });
    ws['!cols'] = wid.map(function (w) { return { wch: w || 8 }; });
    return ws;
  }
  // Öncelik: otomasyonun repoya attığı BİÇİMLİ dosya (YENI IMS .xlsm'deki KONGRE_TAKIP_1 / KONGRE_TAKIP_2 sayfalarıyla
  // aynı renk/birleştirme/genişlik). Henüz yoksa CSV'den düz (biçimsiz) bir Excel üretilir.
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function downloadXlsxFallback(which) {
    var go = function () {
      var text = which === 2 ? RAW.k2 : RAW.k1;
      if (!text) { alert('Kongre verisi henüz yüklenmedi.'); return; }
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, xlSheetFromCsv(text), which === 2 ? 'KONGRE_TAKIP_2' : 'KONGRE_TAKIP_1');
      XLSX.writeFile(wb, 'KONGRE_TAKIP_' + which + '.xlsx');
    };
    if (typeof XLSX !== 'undefined') { go(); return; }
    if (typeof pvEnsureXlsx === 'function') pvEnsureXlsx().then(go, function () { alert('Excel kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.'); });
    else alert('Excel kütüphanesi bulunamadı.');
  }
  function downloadXlsx(which, btn) {
    var name = 'KONGRE_TAKIP_' + which + '.xlsx', old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor…'; }
    function fin(msg) { if (btn) { btn.disabled = false; btn.textContent = msg || old; if (msg) setTimeout(function () { btn.textContent = old; }, 2500); } }
    fetch('./' + name + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      if (!blob || blob.size < 1000) throw new Error('boş dosya');
      saveBlob(blob, name); fin('✓ İndirildi');
    }).catch(function () {
      downloadXlsxFallback(which);   // biçimli dosya henüz repoda yok → düz sürüm
      fin('⚠ Düz sürüm indirildi');
    });
  }

  // ───────────────────────── PDF indirme ─────────────────────────
  // Ekrandaki analiz (filtreler dahil) açık temada, bölümler sayfa sınırında bölünmeden A4 PDF olarak indirilir.
  // html2canvas + jsPDF (vendor/, tembel yüklenir) — yazı tipi gömme gerekmez, Türkçe karakterler tarayıcıdan çizilir.
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = function () { rej(new Error(src + ' yüklenemedi')); };
      document.head.appendChild(sc);
    });
  }
  function ensurePdf() {
    if (window.jspdf && window.html2canvas) return Promise.resolve();
    return loadScript('./vendor/html2canvas.min.js?v=1.4.1').then(function () { return loadScript('./vendor/jspdf.umd.min.js?v=2.5.2'); });
  }
  function pdfBlocks(clone) {
    var groups = [], cur = null;
    Array.prototype.slice.call(clone.children).forEach(function (k) {
      if (k.classList.contains('kg-sec')) { cur = { nodes: [k], hasCard: false }; groups.push(cur); return; }
      if (k.classList.contains('kg-card')) {
        if (cur && !cur.hasCard) { cur.nodes.push(k); cur.hasCard = true; } else groups.push({ nodes: [k], hasCard: true });
        return;
      }
      if (!cur || cur.hasCard) { cur = { nodes: [k], hasCard: false }; groups.push(cur); } else cur.nodes.push(k);
    });
    return groups;
  }
  function buildPdf(mount, btn) {
    var el = document.getElementById(mount === 'rep' ? 'perfKongreEtkisi' : 'mgrKongreEtkisi'), wrap = el && el.querySelector('.kg-wrap');
    if (!wrap) return;
    var old = btn ? btn.textContent : '';
    function fin(msg) { if (btn) { btn.disabled = false; btn.textContent = msg || old; if (msg) setTimeout(function () { btn.textContent = old; }, 2500); } }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ PDF hazırlanıyor…'; }
    var ifr = null;
    // kapsam: açık filtreler
    var kapsam = [];
    Array.prototype.forEach.call(wrap.querySelectorAll('.kg-filters label'), function (lb) {
      var sl = lb.querySelector('select'); if (!sl || !sl.value) return;
      kapsam.push(lb.firstChild.textContent.trim() + ': ' + sl.options[sl.selectedIndex].text);
    });
    var now = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var ds = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear() + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    ensurePdf().then(function () {
      // Her bölüm küçük, izole bir iframe'de çizilir (html2canvas tüm sayfayı kopyaladığı için ana sayfada çok yavaş kalır).
      ifr = document.createElement('iframe');
      ifr.style.cssText = 'position:fixed;left:-20000px;top:0;width:1040px;height:1400px;border:0;visibility:hidden';
      document.body.appendChild(ifr);
      var idoc = ifr.contentDocument;
      idoc.open(); idoc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); idoc.close();
      var waits = [];
      Array.prototype.forEach.call(document.querySelectorAll('link[rel=stylesheet],style'), function (n) {
        var c = idoc.importNode(n, true);
        if (c.tagName === 'LINK') waits.push(new Promise(function (r) { c.onload = r; c.onerror = r; }));
        idoc.head.appendChild(c);
      });
      idoc.documentElement.style.cssText = '--text:#1e293b;--dim:#64748b;--border:#e2e8f0;--surf:#ffffff;--surf2:#f8fafc;--c1:#6d28d9;--bg:#ffffff';
      idoc.body.style.cssText = 'margin:0;background:#fff;color:#1e293b;font-size:12px';
      return Promise.all(waits).then(function () { return idoc.fonts && idoc.fonts.ready ? idoc.fonts.ready : null; }).then(function () { return idoc; });
    }).then(function (idoc) {
      var clone = wrap.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.kg-filters, .kg-noprint'), function (n) { n.parentNode && n.parentNode.removeChild(n); });
      // kart içindeki aylık detay tabloları PDF'e girmez (grafikte zaten var); yöntem notu açık gelir
      Array.prototype.forEach.call(clone.querySelectorAll('.kg-card details'), function (d) { d.parentNode && d.parentNode.removeChild(d); });
      Array.prototype.forEach.call(clone.querySelectorAll('details'), function (d) { d.setAttribute('open', ''); });
      Array.prototype.forEach.call(clone.querySelectorAll('.kg-scroll'), function (d) { d.style.overflow = 'visible'; });
      var head = document.createElement('div');
      head.innerHTML = '<div style="padding:6px 0 10px;border-bottom:3px solid #6d28d9;margin-bottom:12px"><div style="font-size:22px;font-weight:800;color:#1e293b">🎪 Kongre Etkisi Analizi</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:3px">PHARMA VISION · ' + esc(ds) + (window.LOGGED_IN_USER ? ' · ' + esc(window.LOGGED_IN_USER) : '') + '</div>' +
        '<div style="font-size:11px;color:#64748b">Kapsam: ' + (kapsam.length ? esc(kapsam.join(' · ')) : 'Tüm kayıtlar') + '</div></div>';
      clone.insertBefore(head, clone.firstChild);
      var groups = pdfBlocks(clone), PW = 210, PH = 297, MX = 10, MT = 10, MB = 14, CW = PW - 2 * MX, usable = PH - MT - MB;
      var JsPDF = window.jspdf.jsPDF, doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }), y = MT, idx = 0;
      function addCanvas(cv) {
        var mmH = cv.height * CW / cv.width;
        if (mmH > PH - MB - y + 0.01) {
          if (mmH <= usable || y > MT + 40) { doc.addPage(); y = MT; }   // blok sığmıyorsa yeni sayfa (çok uzunsa boş sayfa başından)
        }
        if (mmH <= PH - MB - y + 0.01) { doc.addImage(cv.toDataURL('image/jpeg', 0.74), 'JPEG', MX, y, CW, mmH); y += mmH + 2; return; }
        var pxPer = cv.width / CW, off = 0;
        while (off < cv.height - 1) {                                   // sayfaya sığmayan uzun tablo: parçalara böl
          var slicePx = Math.min(cv.height - off, Math.floor((PH - MB - y) * pxPer));
          var sc = document.createElement('canvas'); sc.width = cv.width; sc.height = slicePx;
          var cx = sc.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, sc.width, sc.height); cx.drawImage(cv, 0, off, cv.width, slicePx, 0, 0, cv.width, slicePx);
          doc.addImage(sc.toDataURL('image/jpeg', 0.74), 'JPEG', MX, y, CW, slicePx / pxPer);
          off += slicePx; y += slicePx / pxPer + 2;
          if (off < cv.height - 1) { doc.addPage(); y = MT; }
        }
      }
      function next() {
        if (idx >= groups.length) return Promise.resolve();
        var g = groups[idx++], body = idoc.body, w = idoc.createElement('div');
        w.style.cssText = 'width:1040px;box-sizing:border-box;padding:0 0 6px;background:#fff';
        g.nodes.forEach(function (n) { w.appendChild(idoc.importNode(n, true)); });
        body.innerHTML = ''; body.appendChild(w);
        // SVG içindeki CSS değişkenleri tek başına çizildiğinde çözülmez → hesaplanmış renge çevir
        Array.prototype.forEach.call(w.querySelectorAll('svg [style*="var("]'), function (n) {
          var f = idoc.defaultView.getComputedStyle(n).fill; n.removeAttribute('style'); if (f) n.setAttribute('fill', f);
        });
        if (btn) btn.textContent = '⏳ PDF hazırlanıyor… ' + idx + '/' + groups.length;
        return window.html2canvas(w, { scale: 1.2, backgroundColor: '#ffffff', logging: false, useCORS: false, windowWidth: 1040, windowHeight: Math.max(w.scrollHeight, 200) }).then(function (cv) {
          addCanvas(cv);
          return new Promise(function (r) { setTimeout(r, 0); }).then(next);        // arayüzü donmadan sıradaki bölüm
        });
      }
      return next().then(function () {
        var n = doc.getNumberOfPages(), i;
        for (i = 1; i <= n; i++) {
          doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
          doc.text('PHARMA VISION - Kongre Etkisi Analizi', MX, PH - 6);
          doc.text('Sayfa ' + i + ' / ' + n, PW - MX, PH - 6, { align: 'right' });
        }
        doc.save('Kongre_Etkisi_Analizi_' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '.pdf');
      });
    }).then(function () { fin('✓ PDF indirildi'); }).catch(function (e) {
      console.error('[kongre-etkisi] PDF hatası:', e); fin('⚠ PDF oluşturulamadı');
    }).then(function () { if (ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr); });
  }

  function downloadArea() {
    return '<div class="kg-noprint"><div class="kg-sec">📥 Excel İndir<i></i></div>' +
      '<div class="kg-card" style="padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<button class="kg-btn" data-kgact="xlsx1">📊 KONGRE_TAKIP_1 (aylık kutu / pazar payı / EVO)</button>' +
      '<button class="kg-btn" data-kgact="xlsx2">👥 KONGRE_TAKIP_2 (katılımcı hekimler + YTD)</button>' +
      '<span class="kg-note">YENI IMS .xlsm\'deki KONGRE_TAKIP_1 / KONGRE_TAKIP_2 sayfalarıyla aynı biçimde (renk, birleştirme, genişlik) iner; dosyalar otomasyonla güncellenir.</span></div></div>';
  }

  function methodNote() {
    return '<details class="kg-card" style="padding:10px 12px"><summary style="cursor:pointer;font-weight:700;color:var(--c1)">Yöntem, varsayımlar ve sınırlar</summary>' +
      '<div class="kg-note" style="margin-top:8px">' +
      '<b>1) Bölge (kontrol grubu) kıyası — asıl karar.</b> Bir brick–ürünün başarısı yalnızca geçen yıla göre değil, <b>kongreye hiç hekim gönderilmeyen bölge bricklerinin medyanına</b> göre ölçülür (MI_GI-KUTU). Böylece pazarın/bölgenin genel büyümesi kongreye yazılmaz. Karar: (EVO farkı ≥ +10 puan: +1 / ≤ −10: −1) + (kutu büyüme indeksi farkı ≥ +10 puan: +1 / ≤ −10: −1); toplam ≥2 İvme, 1 Pozitif, 0 Nötr, −1 Zayıflama, ≤−2 Düşüş. Bölge verisi yoksa karar yalnızca geçen yıla göre verilir ve bu açıkça belirtilir.<br>' +
      '<b>2) 6 aylık dönemler.</b> 1. altı ay (Oca–Haz), 2. altı ay (Tem–…, şu an kısmi) ve toplam. Dönem EVO\'su, aylık kutu ve pazar payından (pazar büyüklüğüyle ağırlıklı) hesaplanır. Bölge kıyası kümülatif olduğundan 1. altı ay = Haziran kümülatifi, toplam = en güncel kümülatif; 2. altı ay için H1 sonundan son aya bölgeye göre fark değişimi (Δ) verilir.<br>' +
      '<b>3) Şans testi.</b> Grup düzeyinde, kongre ve kontrol etiketleri 2.000 kez rastgele karıştırılıp medyan farkın bu kadar büyük çıkma olasılığı (p) hesaplanır. Küçük örneklerde p yüksekse fark şansa bağlı olabilir.<br>' +
      '<b>4) Fark seyri.</b> Kongre–kontrol farkı aylar içinde açılıyorsa kongre ile tutarlı; baştan beri varsa hekim gönderilen bricklerin zaten farklı olması (seçilim) muhtemeldir.<br>' +
      '<b>5) Güven.</b> Hacim (YTD kutu), kontrol grubu büyüklüğü ve sinyallerin uyumuna göre düşük/orta/yüksek. <b>Benzersiz brick–ürün:</b> aynı brick–ürün birden çok kongrede geçse de oranlarda bir kez sayılır.<br>' +
      '<b>6) Aylık kutu ve hekim.</b> Aylık kutu KONGRE_TAKIP_1\'den (geçen yılın aylık kutusu dosyada yok). Hekim bazında satış verisi yoktur; hekimlerin sonucu bulundukları brickin ürün performansıdır, çoklu hekim durumunda hekim başı değer brick sonucunun eşit paylaştırılmasıdır.<br>' +
      '<b>Sınırlar.</b> Kongre tarihi bilinmediği için “kongreden önce/sonra” ayrımı yapılamaz; hekim gönderilen brickler rastgele seçilmediği için sonuçlar <b>nedensellik kanıtı değil, kongre ile tutarlı sinyaldir</b>. Aylık EVO/pazar payı küçük hacimlerde çok oynaktır. Yıllık veri PANOCER, ACIDPASS, GRIPORT COLD için vardır; FAMTREC için yalnızca katılım bilgisi mevcuttur.</div></details>';
  }

  // ───────────────────────── ana render ─────────────────────────
  function sel(label, dataKey, mount, value, options) {
    return '<label>' + label + '<select data-kg="' + dataKey + '" data-m="' + mount + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function uniq(items, f) {
    var s = {}, out = [];
    items.forEach(function (it) { var v = f(it); if (v && !s[key(v)]) { s[key(v)] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  function renderMount(mount) {
    var el = document.getElementById(mount === 'rep' ? 'perfKongreEtkisi' : 'mgrKongreEtkisi');
    if (!el) return;
    injectCss();
    if (!D) {
      el.innerHTML = '<div style="padding:16px;color:var(--dim);font-size:12px">Kongre verileri yükleniyor…</div>';
      ensure().then(function () { renderMount(mount); });
      return;
    }
    if (D.err) {
      el.innerHTML = '<div style="padding:14px;color:var(--dim);font-size:12px">Kongre verisi yüklenemedi (' + esc(D.err) + '). <code>KONGRE_TAKIP_1.csv</code> ve <code>KONGRE_TAKIP_2.csv</code> dosyalarının repo kökünde olduğundan emin olun.</div>';
      return;
    }
    var S = ST[mount], locked = false, me = key(window.LOGGED_IN_USER || '');
    if (!me) { el.innerHTML = ''; return; }          // giriş yapılmadan hiçbir kayıt çizilmez
    try { locked = (mount === 'rep') && typeof isTttLocked === 'function' && isTttLocked(); } catch (e) { /* sessiz */ }
    if (S._u !== me) { S._u = me; if (mount === 'rep') S.ttt = null; }   // kullanıcı değişince varsayılan filtre yenilensin
    var all = buildItems();
    if (locked) all = all.filter(function (it) { return key(it.row.ttt) === me; });
    if (S.ttt === null) {   // temsilci sayfasında ilk açılış: kendi adı (varsa), yoksa tümü
      S.ttt = (!locked && all.some(function (it) { return key(it.row.ttt) === me; })) ? me : '';
    }
    var items = all.filter(function (it) {
      if (!locked && S.ttt && key(it.row.ttt) !== S.ttt) return false;
      if (S.urun && key(it.row.urun) !== S.urun) return false;
      if (S.kongre && key(it.row.kongre) !== S.kongre) return false;
      if (S.sonuc) {
        var d = it.a.durum;
        if (S.sonuc === 'olumlu' && !(d === 'ivme' || d === 'pozitif')) return false;
        if (S.sonuc === 'olumsuz' && !(d === 'zayif' || d === 'dusus')) return false;
        if (S.sonuc === 'notr' && d !== 'notr') return false;
        if (S.sonuc === 'veri' && d !== 'veri') return false;
      }
      if (S.hekim === 'coklu' && !it.a.coklu) return false;
      if (S.hekim === 'tek' && it.a.coklu) return false;
      return true;
    });
    items.sort(function (x, y) {
      if (S.sirala === 'kongre') return x.row.kongre.localeCompare(y.row.kongre, 'tr') || x.row.ttt.localeCompare(y.row.ttt, 'tr');
      var rx = VERDICT[x.a.durum].rank, ry = VERDICT[y.a.durum].rank, sg = S.sirala === 'kotu' ? -1 : 1;
      if (rx !== ry) return (ry - rx) * sg;
      return ((y.a.kutuD == null ? -1e9 : y.a.kutuD) - (x.a.kutuD == null ? -1e9 : x.a.kutuD)) * sg;
    });

    var tOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.ttt; }).map(function (t) { return [key(t), t]; }));
    var uOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.urun; }).map(function (t) { return [key(t), t]; }));
    var kOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.kongre; }).map(function (t) { return [key(t), t]; }));
    var filt = '<div class="kg-filters">' +
      (locked ? '' : sel('Temsilci', 'ttt', mount, S.ttt, tOpts)) +
      sel('Ürün', 'urun', mount, S.urun, uOpts) + sel('Kongre / Toplantı', 'kongre', mount, S.kongre, kOpts) +
      sel('Sonuç', 'sonuc', mount, S.sonuc, [['', 'Tümü'], ['olumlu', '🚀 İvme + Pozitif'], ['notr', '➖ Nötr'], ['olumsuz', '📉 Zayıflama + Düşüş'], ['veri', '❔ Veri yetersiz']]) +
      sel('Hekim sayısı', 'hekim', mount, S.hekim, [['', 'Tümü'], ['coklu', '👥 Çoklu hekim (≥2)'], ['tek', 'Tek hekim']]) +
      sel('Sırala', 'sirala', mount, S.sirala, [['iyi', 'Sonuç: iyiden kötüye'], ['kotu', 'Sonuç: kötüden iyiye'], ['kongre', 'Kongre adı']]) + '</div>';

    var Sm = summarize(items);
    var scope = locked ? 'Sizin' : (S.ttt ? (items[0] ? items[0].row.ttt : 'Seçili temsilci') : 'Ekip');
    // Gönderilen hekim / brick / kongre: KONGRE_TAKIP_2 katılım listesinden (analiz kaydı sayısından bağımsız)
    var hsDerived = !!(S.sonuc || S.hekim);          // sonuç / hekim-sayısı filtresi analiz kayıtlarına bağlıdır → o durumda kayıt gruplarından türet
    var hsBase = { kongre: S.kongre, urun: S.urun, items: hsDerived ? items : null };
    var HS = hekimOzet({ ttt: locked ? me : S.ttt, kongre: hsBase.kongre, urun: hsBase.urun, items: hsBase.items });
    var hsFn = function (tk) { return hekimOzet({ ttt: tk, kongre: hsBase.kongre, urun: hsBase.urun, items: hsBase.items }); };
    var bbTxt = '';
    if (HS.byBrick.length && (locked || S.ttt)) {
      bbTxt = '<div class="kg-note" style="margin:-6px 0 12px"><b>Brick bazında gönderilen hekim:</b> ' + HS.byBrick.map(function (b) { return esc(b.brick) + ' <b>(' + b.n + ')</b>'; }).join(' · ') + '</div>';
    }
    var kpi = '<div class="kg-kpis">' +
      '<div class="kg-kpi"><span>Gönderilen hekim</span><b>' + HS.hekim + '</b></div>' +
      '<div class="kg-kpi"><span>Hekim gönderilen brick</span><b>' + HS.brick + '</b></div>' +
      '<div class="kg-kpi"><span>Kongre / toplantı</span><b>' + HS.kongre + '</b></div>' +
      '<div class="kg-kpi" title="Kongre × brick × ürün kombinasyonu. Hekim sayısı değildir: bir hekim birden çok ürün için birden çok kayıt üretir."><span>Analiz kaydı (kongre×brick×ürün)</span><b>' + Sm.kayit + '</b></div>' +
      '<div class="kg-kpi"><span>Benzersiz brick–ürün</span><b>' + Sm.u.n + '</b></div>' +
      '<div class="kg-kpi"><span>Ölçülebilen</span><b>' + Sm.olculen + '</b></div>' +
      '<div class="kg-kpi"><span>İvme yakalayan</span><b class="kg-up">' + (Sm.ivme + Sm.pozitif) + '</b></div>' +
      '<div class="kg-kpi"><span>Zayıflama / düşüş</span><b class="kg-dn">' + (Sm.zayif + Sm.dusus) + '</b></div>' +
      '<div class="kg-kpi"><span>Karşılık oranı</span><b>' + (Sm.oran == null ? '—' : '%' + fmt(Sm.oran)) + '</b></div>' +
      '<div class="kg-kpi"><span>Yıllık ek kutu (YTD)</span><b class="' + deltaCls(Sm.net, 1) + '">' + (Sm.olculen ? sgn(Sm.net) : '—') + '</b></div></div>' + bbTxt;

    var showTtt = !locked && !S.ttt;
    el.innerHTML = '<div class="kg-wrap">' +
      '<div class="kg-noprint" style="display:flex;justify-content:flex-end;margin:0 0 8px"><button class="kg-btn" data-kgact="pdf" data-m="' + mount + '">📄 Analizi PDF indir</button></div>' +
      '<div class="insight mb16"><div class="insight-title">🧠 Kongre Etkisi Analizi — geçen yıla göre</div><div class="insight-body">' + esc(ozetYorum(Sm, scope, HS)) + '</div></div>' +
      filt + kpi + bolgeTablo() + donemOzet(items) + yogunlukTablo(Sm) + (showTtt ? teamTable(items, hsFn) : '') + heatTable(items, showTtt) +
      '<div class="kg-sec">🎪 Kongre × Brick × Ürün Sonuçları (' + items.length + ' analiz kaydı)<i></i></div>' + legendHtml() +
      (items.length ? items.map(function (it) { return cardHtml(it, showTtt); }).join('') : '<div class="kg-note" style="padding:12px">Seçili filtrelerde kayıt yok.</div>') +
      hekimBolumu(items, S, showTtt) +
      (mount === 'mgr' ? downloadArea() : '') + methodNote() + '</div>';
  }

  function renderAll() { renderMount('rep'); renderMount('mgr'); }
  window.renderKongreEtkisi = function (mount) { if (mount) renderMount(mount); else renderAll(); };
  window.renderKongreEtkisiManager = function () { renderMount('mgr'); };

  // ───────────────────────── olaylar (delegasyon) ─────────────────────────
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.getAttribute) return;
    var dk = t.getAttribute('data-kg');
    if (dk) { var m = t.getAttribute('data-m'); ST[m][dk] = t.value; renderMount(m); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-kgact]') : null;
    if (!b || !D) return;
    var act = b.getAttribute('data-kgact');
    if (act === 'pdf') buildPdf(b.getAttribute('data-m') || 'mgr', b);
    else if (act === 'xlsx1') downloadXlsx(1, b);
    else if (act === 'xlsx2') downloadXlsx(2, b);
  });

  // Test/diagnostik için (motor DOM'dan bağımsız çalışır)
  window.PVKongre = {
    parse1: parse1, parse2: parse2, buildUnits: buildUnits, analyze: analyze, summarize: summarize, key: key, buildItems: buildItems, hekimOzet: hekimOzet,
    _setData: function (d) { D = d; }, ESIK: ESIK
  };

  function init() {
    if (window.__KONGRE_NO_AUTOINIT) return;
    ensure();   // CSV'leri önceden çek; çizim sekme/sayfa açılınca yapılır (giriş öncesi hiçbir şey çizilmez)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  console.debug('[kongre-etkisi] yüklendi.');
})();
