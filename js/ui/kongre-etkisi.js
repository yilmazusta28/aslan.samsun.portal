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
//  YÖNTEM — KONGRE TARİHİNDEN BAĞIMSIZ, "geçen yıla göre artış / düşüş"
//    Kongreye katılan hekimin bricti ve kongrede tanıtılan ürün için bu yılın YTD'si, geçen yılın aynı
//    dönemiyle kıyaslanır:
//      Kutu YoY %  = YTD-1 kutu ÷ YTD-2 kutu − 1                      (KONGRE_TAKIP_2)
//      Pazar payı  = YTD-1 − YTD-2 (puan)                              (bilgi)
//      EVO         = pazara göre gelişim (bu yıl pay ÷ geçen yıl pay ×100) (KONGRE_TAKIP_1 YTD, yoksa _2)
//    Skor = (Kutu YoY ≥ +%10: +1 / ≤ −%10: −1) + (EVO ≥ 110: +1 / ≤ 90: −1)
//    ≥2 İVME · 1 POZİTİF · 0 NÖTR · −1 ZAYIFLAMA · ≤−2 DÜŞÜŞ   (tek gösterge varsa: + POZİTİF / 0 NÖTR / − ZAYIFLAMA)
//    Aylık katman (yalnız KONGRE_TAKIP_1'de olan kayıtlar): her ayın pazar payı geçen yılın aynı ayına göre ±,
//    "kaç ayda geçen yılın üzerinde" ve "son 3 ay EVO'su YTD'ye göre ivme kazanıyor mu?".
//  Not: Analiz zamansal birlikteliği gösterir; tek başına nedensellik kanıtı değildir.
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
  var ESIK = { kutuPct: 10, evoUst: 110, evoAlt: 90, momFark: 5, dusukHacim: 200 };

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
    rep: { ttt: null, urun: '', kongre: '', sonuc: '', sirala: 'iyi' },
    mgr: { ttt: '', urun: '', kongre: '', sonuc: '', sirala: 'iyi' }
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
  function analyze(u, att) {
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
    if (sK == null && sE == null) { o.yorum = 'Bu kayıt için geçen yıl karşılaştırması yapılabilecek veri (kutu / pazar payı) bulunmuyor.'; return o; }
    if (sK != null && sE != null) {
      var s = sK + sE;
      o.durum = s >= 2 ? 'ivme' : s === 1 ? 'pozitif' : s === 0 ? 'notr' : s === -1 ? 'zayif' : 'dusus';
      o.karisik = (sK * sE === -1);
    } else {
      var one = sK != null ? sK : sE;
      o.durum = one > 0 ? 'pozitif' : (one < 0 ? 'zayif' : 'notr');
      o.tek = true;
    }
    o.dusukHacim = (o.k26 != null && o.k26 < ESIK.dusukHacim);
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

  function bransOzet(att) {
    var c = {}, o = [];
    att.hekimler.forEach(function (h) { var b = h.brans || 'Branş belirtilmemiş'; c[b] = (c[b] || 0) + 1; });
    Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).forEach(function (b) { o.push(b + ': ' + c[b]); });
    return o.slice(0, 4).join(', ');
  }

  function yorum(u, o, att) {
    var t = [], p = [];
    if (o.kutuD != null) p.push('YTD kutu ' + fmt(o.k25) + ' → ' + fmt(o.k26) + ' (' + sgn(o.kutuD) + '%)');
    else if (o.k26 != null) p.push('YTD kutu ' + fmt(o.k26) + ' (geçen yıl kutu verisi yok)');
    if (o.ms25 != null) p.push('pazar payı %' + fmt(o.ms25, 1) + ' → %' + fmt(o.ms26, 1) + ' (' + sgn(o.ppD, 1) + ' puan)');
    if (o.evo != null) p.push('pazara göre gelişim (EVO) ' + fmt(o.evo));
    t.push(u.brick + ' bricki ' + u.urun + ' için geçen yılın aynı dönemine göre: ' + p.join('; ') + '.');
    if (o.aylik.length) {
      var s = 'Aylık bazda ' + o.aylik.length + ' ayın ' + o.nUst + ' tanesinde pazar payı geçen yılın üzerinde';
      if (o.mom != null) s += '; son 3 ay EVO ortalaması ' + fmt(o.evoL3) + (o.mom >= ESIK.momFark ? ' (YTD\'nin üzerinde: ivme artıyor).' : (o.mom <= -ESIK.momFark ? ' (YTD\'nin altında: ivme yavaşlıyor).' : ' (YTD ile benzer).'));
      else s += '.';
      t.push(s);
    }
    if (o.ks) {
      var k = o.ks, s2 = 'Aylık kutu çıkışı: ' + k.L.length + ' ayda toplam ' + fmt(k.toplam) + ', aylık ortalama ' + fmt(k.ort) + '; en yüksek ' + AY_ADI[k.mx.m - 1] + ' (' + fmt(k.mx.kutu) + '), en düşük ' + AY_ADI[k.mn.m - 1] + ' (' + fmt(k.mn.kutu) + ').';
      s2 += ' Son ay ' + AY_ADI[k.son.m - 1] + ' ' + fmt(k.son.kutu) + (k.son.mom != null ? ' (önceki aya göre ' + sgn(k.son.mom) + '%)' : '') + '.';
      if (k.trend != null) s2 += ' Son 3 ay ortalaması ' + fmt(k.l3a) + ', önceki aylara göre ' + sgn(k.trend) + '% ' + (k.trend >= 10 ? '(yükseliş eğilimi).' : (k.trend <= -10 ? '(gerileme eğilimi).' : '(yatay).'));
      t.push(s2);
    }
    if (att && att.sayi) {
      t.push('Bu bricten kongreye ' + att.sayi + ' hekim katıldı (' + bransOzet(att) + '); sonuçlar hekim bazında değil, hekimlerin bulunduğu brickin ürün performansını yansıtır.');
    }
    if (o.tumEvo != null && o.evo != null) {
      t.push('Brick genelinde (tüm ürünler) EVO ' + fmt(o.tumEvo) + '; ' + u.urun + ' ' +
        (o.evo >= o.tumEvo + 5 ? 'brick ortalamasının üzerinde' : (o.evo <= o.tumEvo - 5 ? 'brick ortalamasının altında' : 'brick ortalamasıyla benzer')) + ' seyrediyor.');
    }
    switch (o.durum) {
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
    if (o.tek) t.push('Yalnızca tek gösterge (' + (o.kutuD != null ? 'kutu' : 'EVO') + ') mevcut olduğundan sonuç ön değerlendirmedir.');
    if (o.dusukHacim) t.push('Hacim düşük (YTD < ' + ESIK.dusukHacim + ' kutu); küçük sayılar yüzdeleri abartabilir.');
    return t.join(' ');
  }

  function attOf(u) { return (D && D.att[[key(u.kongre), key(u.ttt), key(u.brick)].join('|')]) || null; }

  function buildItems() { return D.units.map(function (u) { var at = attOf(u); return { row: u, a: analyze(u, at), att: at }; }); }

  function summarize(items) {
    var S = { kayit: items.length, olculen: 0, ivme: 0, pozitif: 0, notr: 0, zayif: 0, dusus: 0, veri: 0, net: 0, hekim: 0, oran: null };
    var seenAtt = {}, seenNet = {};
    items.forEach(function (it) {
      S[it.a.durum]++;
      if (OLCULEN.indexOf(it.a.durum) >= 0) {
        S.olculen++;
        var nk = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');   // aynı brick+ürün birden çok kongrede geçse de bir kez
        if (it.a.net != null && !seenNet[nk]) { seenNet[nk] = 1; S.net += it.a.net; }
      }
      if (it.att) {
        var k = [key(it.row.kongre), key(it.row.ttt), key(it.row.brick)].join('|');
        if (!seenAtt[k]) { seenAtt[k] = 1; S.hekim += it.att.sayi; }
      }
    });
    S.oran = S.olculen ? (S.ivme + S.pozitif) / S.olculen * 100 : null;
    return S;
  }

  function ozetYorum(S, kapsam) {
    if (!S.kayit) return 'Seçili filtrelerde kongre kaydı bulunmuyor.';
    var t = [];
    t.push(kapsam + ' için ' + S.kayit + ' kongre–brick–ürün kaydı var; ' + S.olculen + ' tanesi geçen yıl karşılaştırmasıyla ölçülebildi.');
    if (S.olculen) {
      t.push('Ölçülebilenlerin ' + (S.ivme + S.pozitif) + ' tanesinde (%' + fmt(S.oran) + ') geçen yıla göre artış görüldü' +
        (S.ivme ? ' (' + S.ivme + ' tanesi güçlü ivme)' : '') + '; ' + (S.zayif + S.dusus) + ' tanesinde zayıflama/düşüş var, ' + S.notr + ' tanesi nötr.');
      t.push('İlgili brick–ürünlerde yıllık (YTD) toplam kutu farkı ' + sgn(S.net) + ' kutu.');
      if (S.oran >= 60) t.push('Genel tablo olumlu: kongre yatırımları ağırlıklı olarak satışa dönüşüyor.');
      else if (S.oran >= 35) t.push('Genel tablo karışık: bazı kongreler karşılık buluyor, bazıları için takip gerekiyor.');
      else t.push('Genel tablo zayıf: kongre sonrası takip ziyaretleri ve hekim seçimi gözden geçirilmeli.');
    }
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
      fetchText(SRC2).then(function (t) { RAW.k2 = t; return parse2(t); })
    ]).then(function (res) {
      var kongreAd = {};
      Object.keys(res[1].kongreAd || {}).forEach(function (k) { kongreAd[k] = res[1].kongreAd[k]; });
      res[0].forEach(function (r) { kongreAd[key(r.kongre)] = r.kongre; });
      D = { units: buildUnits(res[0], res[1]), att: res[1].att || {}, kongreler: kongreAd, err: null };
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
    if (it.att) sub.push(it.att.sayi + ' hekim katıldı');
    var html = '<div class="kg-card" style="border-left:4px solid ' + v.c + '"><div class="kg-card-hd"><div><div class="kg-title">🎪 ' + esc(u.kongre) +
      ' <span style="font-weight:600;color:var(--c1)">· ' + esc(u.urun) + '</span></div><div class="kg-sub">' + sub.join(' · ') + '</div></div>' +
      '<span class="kg-badge" style="color:' + v.c + ';background:' + v.bg + '">' + v.ic + ' ' + v.lbl + '</span></div>';
    html += '<div class="kg-body"><div>' + yoyBars(o);
    if (o.ks) html += '<div class="kg-cap">Aylık kutu çıkışı (renk: önceki aya göre · kesik çizgi: aylık ortalama)</div>' + kutuSvg(o);
    if (u.ay && o.aylik.length) html += '<div class="kg-cap">Aylık pazar payı farkı (bu yıl − geçen yıl, puan)</div>' + aylikSvg(u, o);
    if (!o.ks && !(u.ay && o.aylik.length)) html += '<div class="kg-note" style="margin-top:6px">Bu ürün için aylık veri yok; YTD karşılaştırma gösteriliyor.</div>';
    html += '</div><div>';
    if (OLCULEN.indexOf(o.durum) >= 0) {
      html += '<div class="kg-chips">' +
        (o.kutuD != null ? chip('Kutu (geçen yıla göre)', fmt(o.k25) + ' → ' + fmt(o.k26) + ' <span class="' + deltaCls(o.kutuD, ESIK.kutuPct) + '">' + arrow(o.kutuD, ESIK.kutuPct) + sgn(o.kutuD) + '%</span>') : '') +
        (o.ms25 != null ? chip('Pazar payı', '%' + fmt(o.ms25, 1) + ' → %' + fmt(o.ms26, 1) + ' <span class="' + deltaCls(o.ppD, 0.5) + '">' + arrow(o.ppD, 0.5) + sgn(o.ppD, 1) + ' puan</span>') : '') +
        (o.evo != null ? chip('EVO (pazara göre gelişim)', '<span class="' + deltaCls(o.evo - 100, 10) + '">' + arrow(o.evo - 100, 10) + fmt(o.evo) + '</span>') : '') +
        (o.net != null ? chip('Yıllık ek kutu (YTD)', '<span class="' + deltaCls(o.net, 1) + '">' + sgn(o.net) + ' kutu</span>') : '') +
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
  function teamTable(items) {
    var by = {}, order = [];
    items.forEach(function (it) { var k = key(it.row.ttt); if (!by[k]) { by[k] = { ad: it.row.ttt, items: [] }; order.push(k); } by[k].items.push(it); });
    if (order.length < 2) return '';
    var rows = order.map(function (k) { var S = summarize(by[k].items); S.ad = by[k].ad; return S; })
      .sort(function (x, y) { return (y.oran == null ? -1 : y.oran) - (x.oran == null ? -1 : x.oran); });
    var tr = rows.map(function (S) {
      var o = S.oran, bc = o == null ? '#CBD5E1' : (o >= 60 ? '#16A34A' : (o >= 35 ? '#F59E0B' : '#DC2626'));
      return '<tr><td style="font-weight:700">' + esc(S.ad) + '</td><td>' + S.kayit + '</td><td>' + S.olculen + '</td>' +
        '<td class="kg-up">' + S.ivme + '</td><td class="kg-up">' + S.pozitif + '</td><td class="kg-nt">' + S.notr + '</td><td class="kg-dn">' + (S.zayif + S.dusus) + '</td>' +
        '<td style="min-width:110px"><div style="display:flex;align-items:center;gap:6px"><div class="kg-bar" style="flex:1"><i style="width:' + (o == null ? 0 : Math.min(100, o)) + '%;background:' + bc + '"></i></div>' +
        '<b style="min-width:34px;text-align:right">' + (o == null ? '—' : '%' + fmt(o)) + '</b></div></td>' +
        '<td class="' + deltaCls(S.net, 1) + '">' + (S.olculen ? sgn(S.net) : '—') + '</td><td>' + S.hekim + '</td></tr>';
    }).join('');
    return '<div class="kg-sec">👥 Temsilci Karşılaştırması<i></i></div><div class="kg-scroll"><table class="kg-tbl" style="min-width:560px"><thead><tr><th>Temsilci</th><th>Kayıt</th><th>Ölçülebilen</th><th>İvme</th><th>Pozitif</th><th>Nötr</th><th>Zayıf/Düşüş</th><th>Karşılık oranı</th><th>Yıllık ek kutu</th><th>Hekim</th></tr></thead><tbody>' + tr + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">Karşılık oranı = (İvme + Pozitif) ÷ ölçülebilen kayıt. Yıllık ek kutu = ilgili brick–ürünlerde bu yılın YTD kutusu − geçen yılın YTD kutusu.</div>';
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

  function downloadArea() {
    return '<div class="kg-sec">📥 Excel İndir<i></i></div>' +
      '<div class="kg-card" style="padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<button class="kg-btn" data-kgact="xlsx1">📊 KONGRE_TAKIP_1 (aylık kutu / pazar payı / EVO)</button>' +
      '<button class="kg-btn" data-kgact="xlsx2">👥 KONGRE_TAKIP_2 (katılımcı hekimler + YTD)</button>' +
      '<span class="kg-note">YENI IMS .xlsm\'deki KONGRE_TAKIP_1 / KONGRE_TAKIP_2 sayfalarıyla aynı biçimde (renk, birleştirme, genişlik) iner; dosyalar otomasyonla güncellenir.</span></div>';
  }

  function methodNote() {
    return '<details class="kg-card" style="padding:10px 12px"><summary style="cursor:pointer;font-weight:700;color:var(--c1)">Yöntem ve sonuç tanımları</summary>' +
      '<div class="kg-note" style="margin-top:8px">Analiz <b>kongre tarihinden bağımsızdır</b>: kongreye katılan hekimin bricti ve kongrede tanıtılan ürün için <b>bu yılın YTD\'si geçen yılın aynı dönemiyle</b> kıyaslanır.<br>' +
      '<b>Kutu YoY %</b> = YTD-1 kutu ÷ YTD-2 kutu − 1 (KONGRE_TAKIP_2) · <b>Pazar payı</b> farkı = YTD-1 − YTD-2 (puan) · <b>EVO</b> = pazara göre gelişim (bu yıl payı ÷ geçen yıl payı × 100; 100 üstü = pazardan hızlı büyüme).<br>' +
      'Skor: Kutu YoY ≥ +%10 (+1) / ≤ −%10 (−1); EVO ≥ 110 (+1) / ≤ 90 (−1). Toplam ≥2 <b>İvme</b>, 1 <b>Pozitif</b>, 0 <b>Nötr</b>, −1 <b>Zayıflama</b>, ≤−2 <b>Düşüş</b>. Tek gösterge varsa: + Pozitif, 0 Nötr, − Zayıflama.<br>' +
      'Aylık grafik yalnızca KONGRE_TAKIP_1\'de bulunan kayıtlar içindir: her ayın pazar payı geçen yılın aynı ayıyla kıyaslanır; "Son 3 ay EVO" YTD EVO\'dan ≥5 puan yüksekse ivme artıyor, ≥5 puan düşükse yavaşlıyor sayılır.<br>' +
      '<b>Aylık kutu</b>: KONGRE_TAKIP_1 dosyasındaki aylık kutu satışı ay ay çizilir (çubuk rengi = önceki aya göre ±%5), ortalama/en yüksek/en düşük ay ve son 3 ay eğilimi hesaplanır; geçen yılın aylık kutusu dosyada olmadığı için geçen yıl kıyası yalnızca YTD kutu ve aylık pazar payı üzerinden yapılır.<br><b>Hekim</b>: hekim bazında satış verisi yoktur; hekimlerin sonucu bulundukları brickin ürün performansıdır.<br>Bu analiz kongre katılımı ile aynı bricteki yıllık değişimi birlikte gösterir; tek başına nedensellik kanıtı değildir (rakip hamleleri, stok, mevsim gibi etkenler de olabilir). Yıllık YTD verisi PANOCER, ACIDPASS ve GRIPORT COLD için vardır; diğer ürünler (ör. FAMTREC) için yalnızca katılım bilgisi mevcuttur.</div></details>';
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
      sel('Sırala', 'sirala', mount, S.sirala, [['iyi', 'Sonuç: iyiden kötüye'], ['kotu', 'Sonuç: kötüden iyiye'], ['kongre', 'Kongre adı']]) + '</div>';

    var Sm = summarize(items);
    var scope = locked ? 'Sizin' : (S.ttt ? (items[0] ? items[0].row.ttt : 'Seçili temsilci') : 'Ekip');
    var kpi = '<div class="kg-kpis">' +
      '<div class="kg-kpi"><span>Kongre kaydı</span><b>' + Sm.kayit + '</b></div>' +
      '<div class="kg-kpi"><span>Ölçülebilen</span><b>' + Sm.olculen + '</b></div>' +
      '<div class="kg-kpi"><span>İvme yakalayan</span><b class="kg-up">' + (Sm.ivme + Sm.pozitif) + '</b></div>' +
      '<div class="kg-kpi"><span>Zayıflama / düşüş</span><b class="kg-dn">' + (Sm.zayif + Sm.dusus) + '</b></div>' +
      '<div class="kg-kpi"><span>Karşılık oranı</span><b>' + (Sm.oran == null ? '—' : '%' + fmt(Sm.oran)) + '</b></div>' +
      '<div class="kg-kpi"><span>Yıllık ek kutu (YTD)</span><b class="' + deltaCls(Sm.net, 1) + '">' + (Sm.olculen ? sgn(Sm.net) : '—') + '</b></div>' +
      '<div class="kg-kpi"><span>Katılan hekim</span><b>' + Sm.hekim + '</b></div></div>';

    var showTtt = !locked && !S.ttt;
    el.innerHTML = '<div class="kg-wrap">' +
      '<div class="insight mb16"><div class="insight-title">🧠 Kongre Etkisi Analizi — geçen yıla göre</div><div class="insight-body">' + esc(ozetYorum(Sm, scope)) + '</div></div>' +
      filt + kpi + (showTtt ? teamTable(items) : '') + heatTable(items, showTtt) +
      '<div class="kg-sec">🎪 Kongre Bazlı Sonuçlar (' + items.length + ')<i></i></div>' + legendHtml() +
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
    if (act === 'xlsx1') downloadXlsx(1, b);
    else if (act === 'xlsx2') downloadXlsx(2, b);
  });

  // Test/diagnostik için (motor DOM'dan bağımsız çalışır)
  window.PVKongre = {
    parse1: parse1, parse2: parse2, buildUnits: buildUnits, analyze: analyze, summarize: summarize, key: key,
    _setData: function (d) { D = d; }, ESIK: ESIK
  };

  function init() {
    if (window.__KONGRE_NO_AUTOINIT) return;
    ensure();   // CSV'leri önceden çek; çizim sekme/sayfa açılınca yapılır (giriş öncesi hiçbir şey çizilmez)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  console.debug('[kongre-etkisi] yüklendi.');
})();
