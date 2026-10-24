// ══════════════════════════════════════════════════════════════════════
//  js/ui/kongre-etkisi.js — Kongre Etkisi Analizi ("kongre karşılığını buldu mu?")
//
//  NEREDE GÖRÜNÜR
//    • Temsilci  : Performans › 🎪 Kongre Etkisi        (#perfKongreEtkisi)
//    • Yönetici  : "AI Eğitim Girdileri Özeti" kartından hemen sonra (#mgrKongreEtkisi)
//
//  KAYNAKLAR (repo kökü, ';' ayraçlı, Türkçe sayı biçimi — Excel'in CSV çıktısı)
//    KONGRE_TAKIP_1.csv : kongre × ürün × TTT × brick için AYLIK kutu satışı, pazar payı (geçen yıl /
//                         bu yıl) ve EVO indeksi (= pazara göre gelişim). Ay başlıklarından okunur
//                         ("OCAK 26" …) — yeni ay dolunca kod değişmez.
//    KONGRE_TAKIP_2.csv : kongreye katılan hekimler (kongre, TTT, brick, hekim, ünite, branş, ürünler).
//    data/kongre_takvim.json : kongre adı → kongre AYI (1-12) — CSV'lerde tarih olmadığı için gerekli.
//                         Yönetici kartındaki "Kongre Takvimi" bölümünden de girilebilir (o cihazda
//                         saklanır; "JSON'u kopyala" ile data/kongre_takvim.json'a yazılınca herkese yayılır).
//
//  YÖNTEM (sade ve açıklanabilir)
//    Kongre ayı K. Önce  = K-3…K-1 içindeki veri olan aylar. Sonra = K+1…K+3 içindeki veri olan aylar.
//    (Kongre ayının kendisi iki pencereye de girmez; etki genelde sonraki aylara yansır.)
//    Kutu Δ%   = sonra ort. kutu / önce ort. kutu − 1
//    Pay Δ     = sonra ort. pazar payı (bu yıl) − önce ort. pazar payı  (puan)
//    EVO Δ     = sonra ort. EVO − önce ort. EVO   (geçen yılla kıyas → mevsimselliği temizler; teyit amaçlı)
//    Skor      = (Kutu Δ ≥ +%10: +1 / ≤ −%10: −1) + (Pay Δ ≥ +0,5 puan: +1 / ≤ −0,5 puan: −1)
//    ≥2 İVME · 1 POZİTİF · 0 NÖTR · −1 ZAYIFLAMA · ≤−2 DÜŞÜŞ
//    "Sonra" ayı yoksa → SONUÇ BEKLENİYOR; kongre ayı girilmemişse → KONGRE AYI GİRİLMEDİ.
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
  var SRC_TAKVIM = './data/kongre_takvim.json';
  var LS_TAKVIM = 'pv_kongre_takvim_v1';
  var AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var AY_KEY = ['OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN', 'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'];
  var ESIK = { kutuPct: 10, payPuan: 0.5, pencere: 3, dusukHacim: 30 };

  var VERDICT = {
    ivme:       { lbl: 'İVME YAKALADI',       ic: '🚀', c: '#15803D', bg: 'rgba(22,163,74,.15)',  rank: 5 },
    pozitif:    { lbl: 'POZİTİF',             ic: '📈', c: '#16A34A', bg: 'rgba(34,197,94,.12)',  rank: 4 },
    notr:       { lbl: 'NÖTR',                ic: '➖', c: '#64748B', bg: 'rgba(100,116,139,.15)', rank: 3 },
    zayif:      { lbl: 'ZAYIFLAMA',           ic: '⚠️', c: '#D97706', bg: 'rgba(245,158,11,.17)', rank: 2 },
    dusus:      { lbl: 'DÜŞÜŞ',               ic: '📉', c: '#DC2626', bg: 'rgba(239,68,68,.15)',  rank: 1 },
    bekleniyor: { lbl: 'SONUÇ BEKLENİYOR',    ic: '⏳', c: '#2563EB', bg: 'rgba(37,99,235,.12)',  rank: 0 },
    onceki:     { lbl: 'ÖNCEKİ VERİ YOK',     ic: '❔', c: '#64748B', bg: 'rgba(100,116,139,.12)', rank: -1 },
    takvim:     { lbl: 'KONGRE AYI GİRİLMEDİ', ic: '🗓️', c: '#7C3AED', bg: 'rgba(124,58,237,.12)', rank: -2 }
  };
  var OLCULEN = ['ivme', 'pozitif', 'notr', 'zayif', 'dusus'];

  var D = null;               // { rows, att, takvim, kongreler, err }
  var RAW = { k1: '', k2: '' };   // ham CSV metinleri (Excel indirme için)
  var loadPromise = null;
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
  function mean(list, row, f) {
    var a = [], i, v;
    for (i = 0; i < list.length; i++) { v = row.ay[list[i]][f]; if (v != null) a.push(v); }
    if (!a.length) return null;
    return a.reduce(function (x, y) { return x + y; }, 0) / a.length;
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
        id: id, kongre: kg, urun: ur, ttt: tt, brick: br, sira: r[4] || '', ay: ay,
        ytd: ytd >= 0 ? { kutu: numN(r[ytd]), ms25: numN(r[ytd + 1]), ms26: numN(r[ytd + 2]), evo: numN(r[ytd + 3]) } : null
      });
    }
    return rows;
  }

  function parse2(text) {
    var g = grid(text), hi = -1, i;
    for (i = 0; i < g.length; i++) { if (key(g[i][0]) === 'TOPLANTI / KONGRE') { hi = i; break; } }
    if (hi < 0) throw new Error('KONGRE_TAKIP_2: "TOPLANTI / KONGRE" başlık satırı bulunamadı');
    var ix = {};
    g[hi].forEach(function (c, ci) { var k = key(c); if (ix[k] == null) ix[k] = ci; });
    function cell(r, name) { var c = ix[name]; return c == null ? '' : (r[c] || ''); }
    var att = {}, kongreAd = {};
    for (i = hi + 1; i < g.length; i++) {
      var r = g[i], kg = r[0];
      if (!kg || kg === '0') continue;
      kongreAd[key(kg)] = kg;
      var tt = cell(r, 'TTT ADI'), br = cell(r, 'BRICK'), ad = cell(r, 'AD-SOYAD');
      if (!tt || !ad) continue;
      var k = [key(kg), key(tt), key(br)].join('|');
      var a = att[k] || (att[k] = { sayi: 0, hekimler: [], urunler: {}, _s: {} });
      var dk = key(ad) + '|' + key(cell(r, 'UNITE'));
      if (a._s[dk]) continue;
      a._s[dk] = 1; a.sayi++;
      a.hekimler.push({ ad: ad, unvan: cell(r, 'UNVAN'), brans: cell(r, 'BRANS'), unite: cell(r, 'UNITE') });
      [cell(r, 'URUN 1'), cell(r, 'URUN 2')].forEach(function (u) { if (u) a.urunler[u] = 1; });
    }
    return { att: att, kongreAd: kongreAd };
  }

  function parseTakvim(obj) {
    var out = {};
    var list = (obj && obj.takvim) || [];
    list.forEach(function (e) {
      if (!e || !e.kongre) return;
      var ay = parseInt(e.ay, 10);
      if (!(ay >= 1 && ay <= 12) && e.tarih) { var p = String(e.tarih).split('-'); ay = parseInt(p[1], 10); }
      if (ay >= 1 && ay <= 12) out[key(e.kongre)] = ay;
    });
    return out;
  }

  // ───────────────────────── kongre takvimi ─────────────────────────
  function readLocal() { try { return JSON.parse(localStorage.getItem(LS_TAKVIM) || '{}') || {}; } catch (e) { return {}; } }
  function writeLocal(o) { try { localStorage.setItem(LS_TAKVIM, JSON.stringify(o)); } catch (e) { /* sessiz */ } }
  function ayOf(kongre) {
    var k = key(kongre), L = readLocal();
    if (L[k] >= 1 && L[k] <= 12) return { ay: +L[k], kaynak: 'yerel' };
    if (D && D.takvim && D.takvim[k]) return { ay: D.takvim[k], kaynak: 'json' };
    return { ay: null, kaynak: null };
  }

  // ───────────────────────── analiz motoru ─────────────────────────
  function lastMonth(row) { var l = 0, m; for (m = 1; m <= 12; m++) if (row.ay[m].has) l = m; return l; }

  function analyze(row, K) {
    var out = { K: K || null, durum: null, last: lastMonth(row), pre: [], post: [] };
    if (!K) { out.durum = 'takvim'; return out; }
    var m;
    for (m = K - ESIK.pencere; m < K; m++) if (m >= 1 && row.ay[m].has) out.pre.push(m);
    for (m = K + 1; m <= K + ESIK.pencere; m++) if (m <= 12 && row.ay[m].has) out.post.push(m);
    if (!out.pre.length) { out.durum = 'onceki'; return out; }
    if (!out.post.length) { out.durum = 'bekleniyor'; return out; }
    out.preK = mean(out.pre, row, 'kutu');   out.postK = mean(out.post, row, 'kutu');
    out.preP = mean(out.pre, row, 'ms26');   out.postP = mean(out.post, row, 'ms26');
    out.preE = mean(out.pre, row, 'evo');    out.postE = mean(out.post, row, 'evo');
    out.kutuD = out.preK > 0 ? (out.postK / out.preK - 1) * 100 : (out.postK > 0 ? 100 : 0);
    out.ppD = (out.preP != null && out.postP != null) ? (out.postP - out.preP) : 0;
    out.evoD = (out.preE != null && out.postE != null) ? (out.postE - out.preE) : null;
    out.net = (out.postK - out.preK) * out.post.length;     // pencere boyunca ek (±) kutu
    var sk = out.kutuD >= ESIK.kutuPct ? 1 : (out.kutuD <= -ESIK.kutuPct ? -1 : 0);
    var sp = out.ppD >= ESIK.payPuan ? 1 : (out.ppD <= -ESIK.payPuan ? -1 : 0);
    var s = sk + sp;
    out.durum = s >= 2 ? 'ivme' : s === 1 ? 'pozitif' : s === 0 ? 'notr' : s === -1 ? 'zayif' : 'dusus';
    out.karisik = (sk * sp === -1);
    out.dusukHacim = (out.preK < ESIK.dusukHacim && out.postK < ESIK.dusukHacim);
    out.kisa = (out.pre.length < 2 || out.post.length < 2);
    out.yorum = yorum(row, out);
    return out;
  }

  function monthList(list) { return list.map(function (m) { return AY_KISA[m - 1]; }).join('·'); }

  function yorum(row, a) {
    var t = [];
    t.push('Kongre öncesi (' + monthList(a.pre) + ') aylık ortalama ' + fmt(a.preK) + ' kutu iken sonrasında (' + monthList(a.post) + ') ' +
      fmt(a.postK) + ' kutu (' + sgn(a.kutuD) + '%). Pazar payı %' + fmt(a.preP, 1) + ' → %' + fmt(a.postP, 1) + ' (' + sgn(a.ppD, 1) + ' puan).' +
      (a.evoD != null ? ' EVO indeksi ' + fmt(a.preE) + ' → ' + fmt(a.postE) + '.' : ''));
    switch (a.durum) {
      case 'ivme':
        t.push('Kongre bu brick\'te karşılığını verdi: hem satış hem pazar payı belirgin yükseldi. Benzer hekim profiliyle tekrar planlanabilir; ivmeyi korumak için hekimlere kongre sonrası takip ziyareti yapılmalı.'); break;
      case 'pozitif':
        t.push('Olumlu bir hareket var ancak güçlü değil. Kongre katılımcılarına yönelik hedefli takip ziyaretleriyle ivme pekiştirilebilir.'); break;
      case 'notr':
        t.push('Kongre sonrasında belirgin bir değişim görülmüyor. Katılan hekimlerle sonuç odaklı görüşme ve ürün mesajının yeniden vurgulanması önerilir.'); break;
      case 'zayif':
        t.push('Kongre sonrası ivme yakalanamadı, hafif geriye gidiş var. Rakip aktivitesi, eczane stok/erişim durumu ve hekim geri bildirimi kontrol edilmeli.'); break;
      case 'dusus':
        t.push('Kongre sonrası satış ve pazar payı belirgin düştü. Acil saha incelemesi önerilir: hekim görüşmesi, rakip hamleleri, stok/erişim ve brick çalışma planı gözden geçirilmeli.'); break;
    }
    if (a.karisik) t.push('Sinyaller karışık (kutu ve pazar payı zıt yönde) — yorum temkinli yapılmalı.');
    if (a.evoD != null && a.kutuD >= ESIK.kutuPct && a.evoD < 0) t.push('Kutu artışına rağmen EVO düşüyor: artış pazarın genel büyümesinden kaynaklanıyor olabilir.');
    if (a.evoD != null && a.kutuD <= -ESIK.kutuPct && a.evoD > 0) t.push('Kutu düşse de EVO yükseliyor: düşüş mevsimsel/pazar kaynaklı olabilir, pazara göre gelişim korunuyor.');
    if (a.dusukHacim) t.push('Hacim düşük (aylık ortalama < ' + ESIK.dusukHacim + ' kutu); küçük sayılar yüzdeleri abartabilir.');
    if (a.kisa) t.push('Karşılaştırma penceresi kısa (≤1 ay); sonuç ön değerlendirmedir.');
    return t.join(' ');
  }

  function attOf(row) { return (D && D.att[[key(row.kongre), key(row.ttt), key(row.brick)].join('|')]) || null; }

  function buildItems() {
    return D.rows.map(function (r) {
      var k = ayOf(r.kongre), a = analyze(r, k.ay);
      a.kaynak = k.kaynak;
      return { row: r, a: a, att: attOf(r) };
    });
  }

  function summarize(items) {
    var S = { kayit: items.length, olculen: 0, ivme: 0, pozitif: 0, notr: 0, zayif: 0, dusus: 0, bekleniyor: 0, takvim: 0, onceki: 0, net: 0, hekim: 0, oran: null };
    var seenAtt = {};
    items.forEach(function (it) {
      S[it.a.durum]++;
      if (OLCULEN.indexOf(it.a.durum) >= 0) { S.olculen++; S.net += it.a.net || 0; }
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
    t.push(kapsam + ' için ' + S.kayit + ' kongre–brick–ürün kaydı var; ' + S.olculen + ' tanesi ölçülebildi.');
    if (S.olculen) {
      t.push('Ölçülebilenlerin ' + (S.ivme + S.pozitif) + ' tanesinde (%' + fmt(S.oran) + ') kongre sonrası satış/pazar payı artışı görüldü' +
        (S.ivme ? ' (' + S.ivme + ' tanesi güçlü ivme)' : '') + '; ' + (S.zayif + S.dusus) + ' tanesinde zayıflama/düşüş var.');
      t.push('Ölçülebilen kongrelerin sonraki pencerelerdeki net kutu etkisi ' + sgn(S.net) + ' kutu.');
      if (S.oran >= 60) t.push('Genel tablo olumlu: kongre yatırımları ağırlıklı olarak satışa dönüşüyor.');
      else if (S.oran >= 35) t.push('Genel tablo karışık: bazı kongreler karşılık buluyor, bazıları için kongre sonrası takip gerekiyor.');
      else t.push('Genel tablo zayıf: kongre sonrası takip ziyaretleri ve hekim seçimi gözden geçirilmeli.');
    }
    if (S.bekleniyor) t.push(S.bekleniyor + ' kaydın sonuç verisi henüz oluşmadı (kongre sonrası ay verisi bekleniyor).');
    if (S.takvim) t.push(S.takvim + ' kaydın kongre ayı girilmediği için etki hesaplanamadı.');
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
      fetchText(SRC2).then(function (t) { RAW.k2 = t; return parse2(t); }).catch(function () { return { att: {}, kongreAd: {}, _err: true }; }),
      fetch(SRC_TAKVIM + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (res) {
      var kongreAd = {};
      Object.keys(res[1].kongreAd || {}).forEach(function (k) { kongreAd[k] = res[1].kongreAd[k]; });
      res[0].forEach(function (r) { kongreAd[key(r.kongre)] = r.kongre; });
      D = { rows: res[0], att: res[1].att || {}, takvim: parseTakvim(res[2]), kongreler: kongreAd, err: null };
    }).catch(function (e) {
      D = { rows: [], att: {}, takvim: {}, kongreler: {}, err: (e && e.message) || String(e) };
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
      '.kg-heat{border-collapse:separate;border-spacing:2px;min-width:560px}' +
      '.kg-heat th{font-size:9.5px;color:var(--dim);padding:2px 4px;text-align:center}' +
      '.kg-heat td.kg-lbl{font-size:10.5px;font-weight:700;padding:2px 6px 2px 0;white-space:nowrap}' +
      '.kg-hc{min-width:50px;border-radius:7px;padding:3px 4px;text-align:center;font-size:10.5px;font-weight:800;line-height:1.15;position:relative}' +
      '.kg-hc small{display:block;font-size:8.5px;font-weight:600;opacity:.8}' +
      '.kg-hc .kg-flag{position:absolute;top:-6px;right:-3px;font-size:10px}' +
      '.kg-bar{height:7px;border-radius:4px;background:var(--border);overflow:hidden;min-width:70px}' +
      '.kg-bar i{display:block;height:100%;border-radius:4px}' +
      '.kg-note{font-size:10.5px;color:var(--dim);line-height:1.5}' +
      '.kg-btn{padding:5px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surf);color:var(--c1);font-size:10.5px;font-weight:700;cursor:pointer}';
    document.head.appendChild(st);
  }

  function evoColor(e) {
    if (e == null) return { bg: '#E2E8F0', fg: '#475569' };
    if (e >= 120) return { bg: '#16A34A', fg: '#fff' };
    if (e >= 100) return { bg: '#86EFAC', fg: '#14532D' };
    if (e >= 80) return { bg: '#FCD34D', fg: '#78350F' };
    return { bg: '#F87171', fg: '#7F1D1D' };
  }
  function momColor(p) {
    if (p == null) return { bg: 'var(--surf2)', fg: 'var(--dim)' };
    if (p >= 25) return { bg: '#16A34A', fg: '#fff' };
    if (p >= 5) return { bg: '#BBF7D0', fg: '#14532D' };
    if (p > -5) return { bg: 'var(--surf2)', fg: 'var(--text)' };
    if (p > -25) return { bg: '#FECACA', fg: '#7F1D1D' };
    return { bg: '#DC2626', fg: '#fff' };
  }
  function deltaCls(v, thr) { return v >= thr ? 'kg-up' : (v <= -thr ? 'kg-dn' : 'kg-nt'); }
  function arrow(v, thr) { return v >= thr ? '▲ ' : (v <= -thr ? '▼ ' : '● '); }

  function chartSvg(row, a) {
    var n = Math.min(12, Math.max(a.last || 0, a.K || 0, 6));
    var W = 330, H = 128, pl = 4, pr = 4, pt = 16, pb = 36, ch = H - pt - pb, bw = (W - pl - pr) / n;
    var maxV = 1, m, d, p = [];
    for (m = 1; m <= n; m++) { d = row.ay[m]; if (d.has && d.kutu > maxV) maxV = d.kutu; }
    var TX = 'style="fill:var(--text)"', DX = 'style="fill:var(--dim)"';
    for (m = 1; m <= n; m++) {
      d = row.ay[m];
      var x = pl + (m - 1) * bw, bx = x + bw * 0.16, w = bw * 0.68;
      var isK = (m === a.K), inPre = a.pre && a.pre.indexOf(m) >= 0, inPost = a.post && a.post.indexOf(m) >= 0;
      var col = '#CBD5E1';
      if (isK) col = '#F59E0B';
      else if (inPre) col = '#8B5CF6';
      else if (inPost && a.preK > 0 && d.has) { var rel = (d.kutu / a.preK - 1) * 100; col = rel >= 5 ? '#16A34A' : (rel <= -5 ? '#DC2626' : '#94A3B8'); }
      if (d.has) {
        var h = Math.max(1.5, d.kutu / maxV * ch), y = pt + ch - h;
        p.push('<rect x="' + bx.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2.5" fill="' + col + '"/>');
        p.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" font-size="8" text-anchor="middle" ' + TX + '>' + fmt(d.kutu) + '</text>');
      }
      if (isK) p.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="9" font-size="10" text-anchor="middle">🎪</text>');
      p.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (pt + ch + 11) + '" font-size="8.5" text-anchor="middle" ' + DX + '>' + AY_KISA[m - 1] + '</text>');
      var ec = evoColor(d.has ? d.evo : null);
      p.push('<rect x="' + bx.toFixed(1) + '" y="' + (pt + ch + 15) + '" width="' + w.toFixed(1) + '" height="13" rx="3" fill="' + ec.bg + '"/>');
      p.push('<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (pt + ch + 25) + '" font-size="8" font-weight="700" text-anchor="middle" fill="' + ec.fg + '">' +
        (d.has && d.evo != null ? Math.round(d.evo) : '–') + '</text>');
    }
    if (a.preK != null && a.post && a.post.length) {
      var ly = pt + ch - a.preK / maxV * ch;
      var x1 = pl + (a.post[0] - 1) * bw, x2 = pl + a.post[a.post.length - 1] * bw;
      p.push('<line x1="' + x1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y1="' + ly.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="#8B5CF6" stroke-width="1.3" stroke-dasharray="4 3"/>');
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Aylık kutu satışı ve EVO indeksi" style="max-width:' + W + 'px">' + p.join('') + '</svg>';
  }

  function legendHtml() {
    return '<div class="kg-legend">' +
      '<span><em style="background:#8B5CF6"></em>Kongre öncesi</span>' +
      '<span><em style="background:#F59E0B"></em>Kongre ayı 🎪</span>' +
      '<span><em style="background:#16A34A"></em>Sonrası ≥ +%5</span>' +
      '<span><em style="background:#94A3B8"></em>Sonrası ±%5</span>' +
      '<span><em style="background:#DC2626"></em>Sonrası ≤ −%5</span>' +
      '<span>Alt şerit = EVO (≥120 <em style="background:#16A34A"></em> · 100–120 <em style="background:#86EFAC"></em> · 80–100 <em style="background:#FCD34D"></em> · &lt;80 <em style="background:#F87171"></em>)</span>' +
      '</div>';
  }

  function chip(label, val, cls) { return '<div class="kg-chip"><small>' + label + '</small><span class="' + (cls || '') + '">' + val + '</span></div>'; }

  function detailHtml(it) {
    var row = it.row, a = it.a, m, r = [];
    for (m = 1; m <= 12; m++) {
      var d = row.ay[m]; if (!d.has) continue;
      var prev = row.ay[m - 1], mom = (m > 1 && prev && prev.has && prev.kutu > 0) ? (d.kutu / prev.kutu - 1) * 100 : null;
      var tag = m === a.K ? ' 🎪' : (a.pre.indexOf(m) >= 0 ? ' · önce' : (a.post.indexOf(m) >= 0 ? ' · sonra' : ''));
      r.push('<tr><td>' + AY_ADI[m - 1] + esc(tag) + '</td><td>' + fmt(d.kutu) + '</td><td class="' + (mom == null ? '' : deltaCls(mom, 5)) + '">' +
        (mom == null ? '—' : sgn(mom) + '%') + '</td><td>' + (d.ms25 == null ? '—' : '%' + fmt(d.ms25, 1)) + '</td><td>' +
        (d.ms26 == null ? '—' : '%' + fmt(d.ms26, 1)) + '</td><td>' + (d.evo == null ? '—' : fmt(d.evo)) + '</td></tr>');
    }
    var html = '<details><summary>Aylık detay' + (it.att ? ' ve katılımcılar (' + it.att.sayi + ' hekim)' : '') + '</summary>' +
      '<div class="kg-scroll"><table class="kg-tbl"><thead><tr><th>Ay</th><th>Kutu</th><th>Aya göre</th><th>Pay (geçen yıl)</th><th>Pay (bu yıl)</th><th>EVO</th></tr></thead><tbody>' + r.join('') + '</tbody></table></div>';
    if (it.att && it.att.hekimler.length) {
      html += '<div class="kg-note" style="margin-top:8px"><b>Katılan hekimler:</b> ' + it.att.hekimler.map(function (h) {
        return esc(h.ad) + (h.brans || h.unite ? ' <span style="opacity:.8">(' + esc([h.brans, h.unite].filter(Boolean).join(' — ')) + ')</span>' : '');
      }).join(' · ') + '</div>';
    }
    return html + '</details>';
  }

  function cardHtml(it, showTtt) {
    var row = it.row, a = it.a, v = VERDICT[a.durum];
    var sub = [];
    if (showTtt) sub.push(esc(row.ttt));
    sub.push(esc(row.brick));
    if (it.att) sub.push(it.att.sayi + ' hekim katıldı');
    var html = '<div class="kg-card" style="border-left:4px solid ' + v.c + '"><div class="kg-card-hd"><div><div class="kg-title">🎪 ' + esc(row.kongre) +
      ' <span style="font-weight:600;color:var(--c1)">· ' + esc(row.urun) + '</span></div><div class="kg-sub">' + sub.join(' · ') +
      (a.K ? ' · Kongre ayı: <b>' + AY_ADI[a.K - 1] + '</b>' : '') + '</div></div>' +
      '<span class="kg-badge" style="color:' + v.c + ';background:' + v.bg + '">' + v.ic + ' ' + v.lbl + '</span></div>';
    html += '<div class="kg-body"><div>' + chartSvg(row, a) + '</div><div>';
    if (OLCULEN.indexOf(a.durum) >= 0) {
      html += '<div class="kg-chips">' +
        chip('Kutu (aylık ort.)', fmt(a.preK) + ' → ' + fmt(a.postK) + ' <span class="' + deltaCls(a.kutuD, ESIK.kutuPct) + '">' + arrow(a.kutuD, ESIK.kutuPct) + sgn(a.kutuD) + '%</span>') +
        chip('Pazar payı', '%' + fmt(a.preP, 1) + ' → %' + fmt(a.postP, 1) + ' <span class="' + deltaCls(a.ppD, ESIK.payPuan) + '">' + arrow(a.ppD, ESIK.payPuan) + sgn(a.ppD, 1) + ' puan</span>') +
        (a.evoD != null ? chip('EVO indeksi', fmt(a.preE) + ' → ' + fmt(a.postE) + ' <span class="' + deltaCls(a.evoD, 5) + '">' + arrow(a.evoD, 5) + sgn(a.evoD) + '</span>') : '') +
        chip('Net kutu etkisi', '<span class="' + deltaCls(a.net, 1) + '">' + sgn(a.net) + ' kutu</span>') + '</div>';
      html += '<div class="kg-txt">' + esc(a.yorum) + '</div>';
    } else if (a.durum === 'bekleniyor') {
      html += '<div class="kg-txt">Kongre ayından (' + AY_ADI[a.K - 1] + ') sonraki aya ait satış verisi henüz yok. Son veri: ' + (a.last ? AY_ADI[a.last - 1] : '—') +
        '. Yeni ay verisi CSV\'ye girildiğinde etki otomatik hesaplanır.</div>';
    } else if (a.durum === 'onceki') {
      html += '<div class="kg-txt">Kongre öncesine ait (K-3…K-1) satış verisi bulunmadığı için karşılaştırma yapılamıyor.</div>';
    } else {
      html += '<div class="kg-txt">Bu kongrenin ayı girilmediği için etki hesaplanamadı. ' +
        (st_isManager() ? 'Aşağıdaki <b>Kongre Takvimi</b> bölümünden ayı seçin.' : 'Kongre ayı yönetici tarafından girildiğinde analiz otomatik görünür.') + '</div>';
    }
    html += detailHtml(it) + '</div></div></div>';
    return html;
  }

  function st_isManager() { try { return !(typeof isTttLocked === 'function' && isTttLocked()); } catch (e) { return false; } }

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
    return '<div class="kg-sec">👥 Temsilci Karşılaştırması<i></i></div><div class="kg-scroll"><table class="kg-tbl" style="min-width:560px"><thead><tr><th>Temsilci</th><th>Kayıt</th><th>Ölçülebilen</th><th>İvme</th><th>Pozitif</th><th>Nötr</th><th>Zayıf/Düşüş</th><th>Karşılık oranı</th><th>Net kutu</th><th>Hekim</th></tr></thead><tbody>' + tr + '</tbody></table></div>' +
      '<div class="kg-note" style="margin-top:4px">Karşılık oranı = (İvme + Pozitif) ÷ ölçülebilen kayıt. Net kutu = kongre sonrası pencerede önceki ortalamaya göre ek (±) kutu.</div>';
  }

  function heatTable(items, showTtt) {
    var g = {}, order = [], maxLast = 0;
    items.forEach(function (it) {
      var k = [key(it.row.ttt), key(it.row.brick), key(it.row.urun)].join('|');
      if (!g[k]) { g[k] = { row: it.row, ks: [] }; order.push(k); }
      if (it.a.K) g[k].ks.push({ K: it.a.K, ad: it.row.kongre });
      if (it.a.last > maxLast) maxLast = it.a.last;
    });
    if (!order.length) return '';
    order.sort();
    var n = Math.max(maxLast, 6), m, head = '<th></th>';
    for (m = 1; m <= n; m++) head += '<th>' + AY_KISA[m - 1] + '</th>';
    var body = order.map(function (k) {
      var G = g[k], row = G.row, tds = '<td class="kg-lbl">' + (showTtt ? esc(row.ttt) + '<br>' : '') + esc(row.brick) + ' <span style="color:var(--c1)">· ' + esc(row.urun) + '</span></td>';
      for (m = 1; m <= n; m++) {
        var d = row.ay[m], prev = row.ay[m - 1];
        if (!d.has) { tds += '<td><div class="kg-hc" style="background:transparent;color:var(--dim)">·</div></td>'; continue; }
        var mom = (m > 1 && prev && prev.has && prev.kutu > 0) ? (d.kutu / prev.kutu - 1) * 100 : null, c = momColor(mom);
        var fl = G.ks.filter(function (x) { return x.K === m; });
        tds += '<td><div class="kg-hc" style="background:' + c.bg + ';color:' + c.fg + '" title="' + esc(AY_ADI[m - 1] + ': ' + fmt(d.kutu) + ' kutu' + (fl.length ? ' — Kongre: ' + fl.map(function (x) { return x.ad; }).join(', ') : '')) + '">' +
          (mom == null ? fmt(d.kutu) : sgn(mom) + '%') + '<small>' + (mom == null ? 'kutu' : fmt(d.kutu)) + '</small>' + (fl.length ? '<span class="kg-flag">🎪</span>' : '') + '</div></td>';
      }
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<div class="kg-sec">🗺️ Brick–Ürün İvme Haritası<i></i></div>' +
      '<div class="kg-legend"><span><em style="background:#16A34A"></em>≥ +%25</span><span><em style="background:#BBF7D0"></em>+%5…+%25</span><span><em style="background:var(--surf2);border:1px solid var(--border)"></em>±%5</span><span><em style="background:#FECACA"></em>−%5…−%25</span><span><em style="background:#DC2626"></em>≤ −%25</span><span>Hücre = bir önceki aya göre kutu değişimi · 🎪 = kongre ayı</span></div>' +
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
  function downloadXlsx(which) {
    var go = function () {
      var text = which === 2 ? RAW.k2 : RAW.k1;
      if (!text) { alert('Kongre verisi henüz yüklenmedi.'); return; }
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, xlSheetFromCsv(text), which === 2 ? 'KONGRE_TAKIP_2' : 'KONGRE_TAKIP_1');
      XLSX.writeFile(wb, 'KONGRE_TAKIP_' + which + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    };
    if (typeof XLSX !== 'undefined') { go(); return; }
    if (typeof pvEnsureXlsx === 'function') pvEnsureXlsx().then(go, function () { alert('Excel kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.'); });
    else alert('Excel kütüphanesi bulunamadı.');
  }
  function downloadArea() {
    return '<div class="kg-sec">📥 Excel İndir<i></i></div>' +
      '<div class="kg-card" style="padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<button class="kg-btn" data-kgact="xlsx1">📊 KONGRE_TAKIP_1 (aylık kutu / pazar payı / EVO)</button>' +
      '<button class="kg-btn" data-kgact="xlsx2">👥 KONGRE_TAKIP_2 (katılımcı hekimler)</button>' +
      '<span class="kg-note">Dosyalar repodaki güncel CSV\'lerden, sayılar ve yüzdeler Excel\'de sayı olarak üretilir.</span></div>';
  }

  function takvimEditor() {
    var L = readLocal(), names = Object.keys(D.kongreler).map(function (k) { return { k: k, ad: D.kongreler[k] }; })
      .sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });
    var rows = names.map(function (n) {
      var eff = ayOf(n.ad), opts = '<option value="">— seçiniz —</option>';
      for (var m = 1; m <= 12; m++) opts += '<option value="' + m + '"' + (eff.ay === m ? ' selected' : '') + '>' + AY_ADI[m - 1] + '</option>';
      return '<tr><td style="font-weight:600">' + esc(n.ad) + '</td><td><select data-kgt="' + esc(n.k) + '" style="padding:4px 6px;border-radius:7px;border:1px solid var(--border);background:var(--surf);color:var(--text);font-size:11px">' + opts + '</select></td>' +
        '<td style="color:var(--dim);font-size:10px">' + (eff.kaynak === 'yerel' ? 'yerel ayar' : (eff.kaynak === 'json' ? 'kongre_takvim.json' : '—')) + '</td></tr>';
    }).join('');
    return '<div class="kg-sec">🗓️ Kongre Takvimi<i></i></div>' +
      '<details class="kg-card" style="padding:10px 12px"><summary style="cursor:pointer;font-weight:700;color:var(--c1)">Kongre aylarını gir / düzenle (' + names.length + ' kongre)</summary>' +
      '<div class="kg-note" style="margin:8px 0">CSV dosyalarında kongre tarihi olmadığı için etki hesabı bu aylara dayanır. Burada seçtiğin ay <b>bu cihazda</b> saklanır; tüm ekipte görünmesi için “JSON’u kopyala” ile çıkan içeriği <code>data/kongre_takvim.json</code> dosyasına yapıştırıp GitHub’a gönder.</div>' +
      '<div class="kg-scroll"><table class="kg-tbl"><thead><tr><th>Kongre / Toplantı</th><th>Kongre ayı</th><th>Kaynak</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="kg-btn" data-kgact="copy">📋 JSON’u kopyala</button>' +
      (Object.keys(L).length ? '<button class="kg-btn" data-kgact="reset" style="color:#DC2626">Yerel ayarları sıfırla</button>' : '') + '</div></details>';
  }

  function methodNote() {
    return '<details class="kg-card" style="padding:10px 12px"><summary style="cursor:pointer;font-weight:700;color:var(--c1)">Yöntem ve sonuç tanımları</summary>' +
      '<div class="kg-note" style="margin-top:8px">Kongre ayı = K. <b>Önce</b> = K-3…K-1, <b>Sonra</b> = K+1…K+3 aylarından veri olanlar (kongre ayının kendisi hariç).<br>' +
      'Kutu Δ% = sonra ort. ÷ önce ort. − 1 · Pay Δ = sonra ort. pazar payı − önce ort. pazar payı (puan) · EVO = pazara göre gelişim (geçen yılla kıyas; mevsimselliği temizler, teyit için gösterilir).<br>' +
      'Skor: Kutu Δ ≥ +%10 (+1) / ≤ −%10 (−1); Pay Δ ≥ +0,5 puan (+1) / ≤ −0,5 puan (−1). Toplam ≥2 <b>İvme</b>, 1 <b>Pozitif</b>, 0 <b>Nötr</b>, −1 <b>Zayıflama</b>, ≤−2 <b>Düşüş</b>.<br>' +
      'Bu analiz kongre ile satış artışı arasındaki <b>zamansal ilişkiyi</b> gösterir; tek başına nedensellik kanıtı değildir (rakip hamleleri, stok, mevsim gibi etkenler de olabilir). Aylık veride yalnızca KONGRE_TAKIP_1.csv\'deki ürünler (şu an PANOCER, GRIPORT COLD) ölçülür; diğer ürünler için yalnızca katılım bilgisi vardır.</div></details>';
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
        if (S.sonuc === 'bekleyen' && !(d === 'bekleniyor' || d === 'takvim' || d === 'onceki')) return false;
      }
      return true;
    });
    items.sort(function (x, y) {
      if (S.sirala === 'kongre') return x.row.kongre.localeCompare(y.row.kongre, 'tr') || x.row.ttt.localeCompare(y.row.ttt, 'tr');
      var rx = VERDICT[x.a.durum].rank, ry = VERDICT[y.a.durum].rank;
      if (rx !== ry) return S.sirala === 'kotu' ? rx - ry : ry - rx;
      return ((y.a.kutuD || 0) - (x.a.kutuD || 0)) * (S.sirala === 'kotu' ? -1 : 1);
    });

    var tOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.ttt; }).map(function (t) { return [key(t), t]; }));
    var uOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.urun; }).map(function (t) { return [key(t), t]; }));
    var kOpts = [['', 'Tümü']].concat(uniq(all, function (it) { return it.row.kongre; }).map(function (t) { return [key(t), t]; }));
    var filt = '<div class="kg-filters">' +
      (locked ? '' : sel('Temsilci', 'ttt', mount, S.ttt, tOpts)) +
      sel('Ürün', 'urun', mount, S.urun, uOpts) + sel('Kongre / Toplantı', 'kongre', mount, S.kongre, kOpts) +
      sel('Sonuç', 'sonuc', mount, S.sonuc, [['', 'Tümü'], ['olumlu', '🚀 İvme + Pozitif'], ['notr', '➖ Nötr'], ['olumsuz', '📉 Zayıflama + Düşüş'], ['bekleyen', '⏳ Bekleyen / takvimsiz']]) +
      sel('Sırala', 'sirala', mount, S.sirala, [['iyi', 'Sonuç: iyiden kötüye'], ['kotu', 'Sonuç: kötüden iyiye'], ['kongre', 'Kongre adı']]) + '</div>';

    var Sm = summarize(items);
    var scope = locked ? 'Sizin' : (S.ttt ? (items[0] ? items[0].row.ttt : 'Seçili temsilci') : 'Ekip');
    var kpi = '<div class="kg-kpis">' +
      '<div class="kg-kpi"><span>Kongre kaydı</span><b>' + Sm.kayit + '</b></div>' +
      '<div class="kg-kpi"><span>Ölçülebilen</span><b>' + Sm.olculen + '</b></div>' +
      '<div class="kg-kpi"><span>İvme yakalayan</span><b class="kg-up">' + (Sm.ivme + Sm.pozitif) + '</b></div>' +
      '<div class="kg-kpi"><span>Zayıflama / düşüş</span><b class="kg-dn">' + (Sm.zayif + Sm.dusus) + '</b></div>' +
      '<div class="kg-kpi"><span>Karşılık oranı</span><b>' + (Sm.oran == null ? '—' : '%' + fmt(Sm.oran)) + '</b></div>' +
      '<div class="kg-kpi"><span>Net kutu etkisi</span><b class="' + deltaCls(Sm.net, 1) + '">' + (Sm.olculen ? sgn(Sm.net) : '—') + '</b></div>' +
      '<div class="kg-kpi"><span>Katılan hekim</span><b>' + Sm.hekim + '</b></div></div>';

    var showTtt = !locked && !S.ttt;
    var html = '<div class="kg-wrap">' +
      '<div class="insight mb16"><div class="insight-title">🧠 Kongre Etkisi Analizi</div><div class="insight-body">' + esc(ozetYorum(Sm, scope)) + '</div></div>' +
      filt + kpi + (showTtt ? teamTable(items) : '') + heatTable(items, showTtt) +
      '<div class="kg-sec">🎪 Kongre Bazlı Sonuçlar (' + items.length + ')<i></i></div>' + legendHtml() +
      (items.length ? items.map(function (it) { return cardHtml(it, showTtt); }).join('') : '<div class="kg-note" style="padding:12px">Seçili filtrelerde kayıt yok.</div>') +
      (mount === 'mgr' ? downloadArea() + takvimEditor() : '') + methodNote() + '</div>';
    el.innerHTML = html;
  }

  function renderAll() { renderMount('rep'); renderMount('mgr'); }
  window.renderKongreEtkisi = function (mount) { if (mount) renderMount(mount); else renderAll(); };
  window.renderKongreEtkisiManager = function () { renderMount('mgr'); };

  // ───────────────────────── olaylar (delegasyon) ─────────────────────────
  function copyText(txt, btn) {
    function done(ok) { if (btn) { var o = btn.textContent; btn.textContent = ok ? '✓ Kopyalandı' : 'Kopyalanamadı'; setTimeout(function () { btn.textContent = o; }, 1600); } }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); }); return; }
    try { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok); } catch (e) { done(false); }
  }
  function takvimJson() {
    var list = Object.keys(D.kongreler).map(function (k) { return { k: k, ad: D.kongreler[k] }; })
      .sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); })
      .map(function (n) { var e = ayOf(n.ad); return { kongre: n.ad, ay: e.ay }; });
    return JSON.stringify({ not: 'Kongre ayı: 1=Ocak … 12=Aralık. Boş (null) bırakılan kongrelerin etkisi hesaplanmaz.', takvim: list }, null, 2);
  }
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.getAttribute) return;
    var dk = t.getAttribute('data-kg');
    if (dk) { var m = t.getAttribute('data-m'); ST[m][dk] = t.value; renderMount(m); return; }
    var tk = t.getAttribute('data-kgt');
    if (tk) { var L = readLocal(); if (t.value) L[tk] = parseInt(t.value, 10); else delete L[tk]; writeLocal(L); renderAll(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-kgact]') : null;
    if (!b || !D) return;
    var act = b.getAttribute('data-kgact');
    if (act === 'copy') copyText(takvimJson(), b);
    else if (act === 'reset') { writeLocal({}); renderAll(); }
    else if (act === 'xlsx1') downloadXlsx(1);
    else if (act === 'xlsx2') downloadXlsx(2);
  });

  // Test/diagnostik için (motor DOM'dan bağımsız çalışır)
  window.PVKongre = {
    parse1: parse1, parse2: parse2, parseTakvim: parseTakvim, analyze: analyze, summarize: summarize, key: key,
    _setData: function (d) { D = d; }, ESIK: ESIK
  };

  function init() {
    if (window.__KONGRE_NO_AUTOINIT) return;
    ensure();   // CSV'leri önceden çek; çizim sekme/sayfa açılınca yapılır (giriş öncesi hiçbir şey çizilmez)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  console.debug('[kongre-etkisi] yüklendi.');
})();
