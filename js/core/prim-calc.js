// ══════════════════════════════════════════════════════════════
//  js/core/prim-calc.js — Prim Hesaplama Modülü
//  Phase 2.2 extraction — EXACT copy from index.html
//  Globals uses: URUN_AGIRLIK (index.html), GENEL (index.html)
//  Exports: getCarpan, getMiGiKatsayi, calcPrimForTTT, calcPrimPuani
//  Exports: CARPAN_TABLE, MIGI_MATRIX, URUN_AGIRLIK
//  Exports: calcKompanzasyonEkPrimi, calcPrimFromArchivedPeriod (FAZ 31.0)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════
const CARPAN_TABLE = {
  91:75,92:78,93:81,94:84,95:87,96:90,97:93,98:96,99:99,100:100,
  101:105,102:108,103:112,104:116,105:120,106:122,107:124,108:126,109:128,110:130,
  111:132,112:134,113:136,114:138,115:140,116:142,117:144,118:146,119:148,120:150,
  121:151,122:152,123:153,124:154,125:155,126:156,127:157,128:158,129:159,130:160
};

// MI & GI MATRİS (PDF sayfa 13)
const MIGI_MATRIX = {
  // [GIGI_row][MI_col] = katsayı
  80:  {80:0,   85:0,   90:0,   95:0,    100:0.5, 110:0.5, 120:0.75,130:0.75,140:1,   150:1.1},
  85:  {80:0,   85:0,   90:0,   95:0.5,  100:0.5, 110:0.75,120:0.75,130:1,   140:1.1, 150:1.1},
  90:  {80:0,   85:0,   90:0.5, 95:0.5,  100:0.75,110:0.75,120:1,   130:1.1, 140:1.1, 150:1.25},
  95:  {80:0,   85:0.5, 90:0.5, 95:0.75, 100:0.75,110:1,   120:1.1, 130:1.1, 140:1.25,150:1.25},
  100: {80:0.5, 85:0.5, 90:0.75,95:0.75, 100:1,   110:1.1, 120:1.1, 130:1.25,140:1.25,150:1.5},
  110: {80:0.5, 85:0.75,90:0.75,95:1,    100:1.1, 110:1.1, 120:1.25,130:1.25,140:1.5, 150:1.5},
  120: {80:0.75,85:0.75,90:1,   95:1.1,  100:1.1, 110:1.25,120:1.25,130:1.5, 140:1.5, 150:1.75},
  130: {80:0.75,85:1,   90:1.1, 95:1.1,  100:1.25,110:1.25,120:1.5, 130:1.5, 140:1.75,150:1.75},
  140: {80:1,   85:1.1, 90:1.1, 95:1.25, 100:1.25,110:1.5, 120:1.5, 130:1.75,140:1.75,150:2},
  150: {80:1.1, 85:1.1, 90:1.25,95:1.25, 100:1.5, 110:1.5, 120:1.75,130:1.75,140:2,   150:2},
};

// Çarpan tablosundan değer al
function getCarpan(real_pct) {
  const r = Math.min(Math.max(Math.round(real_pct), 91), 130);
  return (CARPAN_TABLE[r] || 100) / 100;
}

// MI & GI matrisinden katsayı al
// Matris ALT DİLİME göre okunur (kullanıcı onayı): değer hangi aralıktaysa o aralığın ALT sınırı
// kullanılır — örn. MI 117 → 110, GIGI 99,9 → 95. 80'in altı → 80 sütunu/satırı, 150 ve üstü → 150.
// Ham (yuvarlanmamış) değer verin; 2 ondalıkla kesilir (yüzer-nokta gürültüsüne karşı).
function getMiGiKatsayi(mi, gi) {
  const BINS = [80,85,90,95,100,110,120,130,140,150];
  const floorBin = v => {
    const x = Math.round((+v || 0) * 100) / 100;
    let b = BINS[0];
    for (const k of BINS) if (x >= k) b = k;
    return b;
  };
  return MIGI_MATRIX[floorBin(gi)]?.[floorBin(mi)] ?? 0;
}

// Prim puanı hesapla (ürün ağırlıkları × real)
// DÜZELTME: eski değerler (MOKSEFEN .15 / FAMTREC .15) GENEL_TABLO.csv'deki resmi
// ağırlıklarla uyuşmuyordu. Güncel (5. dönem) resmi ağırlıklar: PANOCER 25 · ACİDPASS 25 ·
// GRİPORT COLD 20 · FAMTREC 20 · MOKSEFEN 10. (GENEL'de `urun_agirlik` varsa o öncelikli.)
const URUN_AGIRLIK = {
  'PANOCER': 0.25, 'ACİDPASS': 0.25,
  'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.10, 'FAMTREC': 0.20  // sıra: PANOCER·ACİDPASS·GRİPORT·MOKSEFEN·FAMTREC
};
// PDF: "Grupların ürün ağırlıkları dönemsel olarak değişebilir; dönem başında paylaşılır."
// Varsayılan dönem ağırlıkları (toplam 1,0). Sayfadaki "Geçmiş Dönem Prim Hesabı" tablosunda
// her dönem için ağırlıklar elle de değiştirilebilir (⚖️) — o kayıt bu tabloya öncelikli.
//  • 1.–3. dönem: MI_GIGI.csv'deki resmi PRİM PUANI sütununa en küçük kareler uyumuyla bulundu
//    (PANOCER 30 · ACİDPASS 30 · GRİPORT 23 · MOKSEFEN 17 · FAMTREC 0; 21 kişi-dönemde sapma ≤0,04 puan).
//  • 4. dönem ve sonrası: GENEL_TABLO.csv'deki resmi ağırlıklar (değişene kadar aynı kabul edilir).
const PERIOD_URUN_AGIRLIK = {
  '1d': { 'PANOCER': 0.30, 'ACİDPASS': 0.30, 'GRİPORT COLD': 0.23, 'MOKSEFEN': 0.17, 'FAMTREC': 0 },
  '2d': { 'PANOCER': 0.30, 'ACİDPASS': 0.30, 'GRİPORT COLD': 0.23, 'MOKSEFEN': 0.17, 'FAMTREC': 0 },
  'k1': { 'PANOCER': 0.30, 'ACİDPASS': 0.30, 'GRİPORT COLD': 0.23, 'MOKSEFEN': 0.17, 'FAMTREC': 0 },
  '4d': { 'PANOCER': 0.25, 'ACİDPASS': 0.25, 'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.10, 'FAMTREC': 0.20 },
  '5d': { 'PANOCER': 0.25, 'ACİDPASS': 0.25, 'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.10, 'FAMTREC': 0.20 },
  'k2': { 'PANOCER': 0.25, 'ACİDPASS': 0.25, 'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.10, 'FAMTREC': 0.20 }
};

// ── Portföy Primi (PDF: "TL realizasyon sonucuna göre hak edilen prim tutarına %20 ek ödenir;
//    %20 ek ödeme en fazla %100 real'e göre yapılır"; MAX tablosunda Portföy 66.000 sabit kalır) ──
// Tek merkez: TÜM modüller bunu kullanır. PORTFOY_ORANSAL=true → %20 × (dönemlik TL Real Primi,
// real %100'de sınırlı). false → eski davranış: real ne olursa olsun sabit %20 × 55.000 × 1,0.
const PORTFOY_ORANSAL = true;
function calcPortfoyPrim(effReal, primPuani) {
  if (!(effReal >= 91 && primPuani >= 91)) return 0;
  const c = PORTFOY_ORANSAL ? getCarpan(Math.min(effReal, 100)) : getCarpan(100);
  return 0.20 * 55000 * c;
}

// ══════════════════════════════════════════════════════════════
//  KOMPANZASYON EK PRİMİ (1.A) — Resmi kural (2026 İLKO TTT Prim
//  Sunumu, "Kompansasyon [TL Real] Primi Nasıl Hak Edilir?"):
//
//  ÖNEMLİ DÜZELTME (bu fonksiyon eklenmeden önceki hatalı varsayım):
//  Kompanzasyon dönemlerinde (k1/k2) o dönemin KENDİ TL Real Primi
//  DOĞRUDAN %100 sınırını AŞMAZ — normal dönemlerle AYNI şekilde
//  %100'de sınırlıdır (bkz. calcPrimForTTT). %100 üzeri kısım, SADECE
//  bu ayrı "Kompanzasyon Ek Primi" kalemiyle, 3 dönemlik (6 aylık)
//  GERİYE DÖNÜK bir mahsuplaşmayla ödenir:
//
//    KOŞUL-1: Kompanzasyon döneminin (3. veya 6.) KENDİ TL
//             realizasyonu >= %95 olmalı.
//    KOŞUL-2: Geçmiş 3 dönemin (6 aylık) KÜMÜLATİF toplam TL
//             realizasyonu >= %91 olmalı.
//    HESAPLAMA: 3 × getCarpan(kümülatif_real) × BAZ_TL_REAL tutarından,
//             3 dönemde ZATEN ÖDENMİŞ olan (her biri kendi %100
//             sınırlı normal) TL Real Primi toplamı düşülür; kalan
//             fark bu dönemin "Kompanzasyon Ek Primi"dir (negatifse 0
//             kabul edilir — bu bir telafi mekanizmasıdır, geri alım
//             değildir).
//    EK ŞART: "Kompansasyon priminden yararlanmak için en az 2 dönem
//             çalışma şartı aranmaktadır" — önceki 2 dönemin arşiv
//             verisi (period-archive-manager.js) bulunamazsa bu ek
//             prim hesaplanmaz.
//    KAPSAM: SADECE "1-TL Real Primi" için geçerlidir — Portföy ve
//             MI&GIGI primlerini ETKİLEMEZ (PDF: "Kompansasyon hesabı
//             yapılmaz" o iki kalem için).
//
//  Veri kaynağı: js/core/period-archive-manager.js (H1={1d,2d,k1},
//  H2={4d,5d,k2}) — her dönem geçişinde otomatik arşivlenir.
//
//  @param {string} ttt
//  @param {Array}  currentGenel — o anki (canlı) GENEL verisi
//  @param {string} [periodKeyOverride] — verilmezse bugünün tarihinden
//         (PeriodArchiveManager.getCurrentPeriodKey()) hesaplanır.
//  @returns {{ekPrim:number, eligible:boolean, reason:string, detail:object|null}}
// ══════════════════════════════════════════════════════════════
function calcKompanzasyonEkPrimi(ttt, currentGenel, periodKeyOverride) {
  const BAZ_TL_REAL = 55000;
  const PM = (typeof window !== 'undefined' && window.PeriodArchiveManager) ? window.PeriodArchiveManager : null;

  const curKey = periodKeyOverride || (PM && typeof PM.getCurrentPeriodKey === 'function' ? PM.getCurrentPeriodKey() : null);
  if (!curKey || (curKey !== 'k1' && curKey !== 'k2')) {
    return { ekPrim: 0, eligible: false, reason: 'Kompanzasyon dönemi değil (sadece 3. ve 6. dönemlerde uygulanır).', detail: null };
  }
  if (!PM) {
    return { ekPrim: 0, eligible: false, reason: 'Arşiv modülü (period-archive-manager.js) yüklü değil.', detail: null };
  }

  const siblingKeys = curKey === 'k1' ? ['1d', '2d'] : ['4d', '5d'];

  function _findGenelToplam(genelArr, tttName) {
    return (genelArr || []).find(r => r.ttt === tttName && r.urun === 'GENEL TOPLAM') || null;
  }

  const priorRows = siblingKeys.map(k => {
    const arch = PM.getArchivedPeriod(k);
    return { key: k, row: arch ? _findGenelToplam(arch.genel, ttt) : null };
  });

  const missing = priorRows.filter(p => !p.row);
  if (missing.length) {
    return {
      ekPrim: 0, eligible: false,
      reason: 'Kompanzasyon primi için en az 2 dönem çalışma şartı aranıyor — ' +
              missing.map(m => m.key).join(', ') + ' dönemi(nin) arşiv verisi bulunamadı.',
      detail: null
    };
  }

  const curRow = _findGenelToplam(currentGenel, ttt);
  if (!curRow) {
    return { ekPrim: 0, eligible: false, reason: 'Bu dönemin GENEL TOPLAM satırı bulunamadı.', detail: null };
  }

  // KOŞUL-1/2 + hesaplama: ortak yardımcı (calcKompEkFromRows) — Prim
  // Hesapla sayfasındaki "Geçmiş Dönem" tablosu da aynı kuralı kullanır.
  const res = calcKompEkFromRows(priorRows.map(p => p.row).concat([curRow]));
  if (res.detail) res.detail.periods = siblingKeys.concat([curKey]);
  return res;
}

// ══════════════════════════════════════════════════════════════
//  Kompanzasyon Ek Primi — SAF hesap (arşiv/ledger'dan bağımsız)
//  @param {Array} rows3 — [önceki-2, önceki-1, kompanzasyon dönemi]
//         her eleman {tl_pct, hedef_tl, satis_tl}
//  hedef_tl/satis_tl eksikse (manuel girilmiş dönem) kümülatif real,
//  tl_pct'lerin basit ortalamasına düşer (detail.approx = true).
// ══════════════════════════════════════════════════════════════
function calcKompEkFromRows(rows3, opts) {
  const BAZ_TL_REAL = 55000;
  const curRow = rows3[rows3.length - 1];
  // opts.round → eşik kontrolleri tam sayıya yuvarlanmış real ile (Geçmiş Dönem tablosu); varsayılan: ham değer
  const _rd = (opts && opts.round) ? (v => Math.floor((+v || 0) + 0.5 + 1e-9)) : (v => v);

  // KOŞUL-1: kompanzasyon döneminin kendi realizasyonu >= %95
  const kendiReal = _rd(curRow.tl_pct || 0);
  if (kendiReal < 95) {
    return {
      ekPrim: 0, eligible: false,
      reason: `Bu dönemin kendi TL realizasyonu (%${kendiReal.toFixed(1)}) %95'in altında.`,
      detail: { kendiReal }
    };
  }

  // KOŞUL-2: 3 dönemin kümülatif (6 aylık) TL real'i >= %91
  const hasTotals = rows3.every(r => r.hedef_tl > 0 && r.satis_tl >= 0 && r.satis_tl !== null);
  const sumHedef = hasTotals ? rows3.reduce((s, r) => s + (r.hedef_tl || 0), 0) : 0;
  const sumSatis = hasTotals ? rows3.reduce((s, r) => s + (r.satis_tl || 0), 0) : 0;
  const kumulatifReal = _rd(hasTotals
    ? (sumSatis / sumHedef * 100)
    : rows3.reduce((s, r) => s + (r.tl_pct || 0), 0) / rows3.length);
  const approx = !hasTotals;
  if (kumulatifReal < 91) {
    return {
      ekPrim: 0, eligible: false,
      reason: `6 aylık kümülatif TL realizasyonu (%${kumulatifReal.toFixed(1)}) %91'in altında.`,
      detail: { kendiReal, kumulatifReal, approx }
    };
  }

  // HESAPLAMA: kümülatif sonuca göre 3 dönem "yeniden kapatılmış" gibi ödeme,
  // eksi 3 dönemde zaten ödenmiş (her biri kendi %100 sınırlı) TL Real Primi.
  const carpanKumulatif = getCarpan(kumulatifReal);
  const yeniToplamOdeme = 3 * carpanKumulatif * BAZ_TL_REAL;
  const zatenOdenen = rows3.reduce((s, r) => {
    const rr = _rd(r.tl_pct || 0);
    const kendiCarpan = (rr >= 91) ? getCarpan(Math.min(rr, 100)) : 0;
    return s + kendiCarpan * BAZ_TL_REAL;
  }, 0);
  const ekPrim = Math.max(0, yeniToplamOdeme - zatenOdenen);

  return {
    ekPrim,
    eligible: true,
    reason: 'Kompanzasyon primi hak edildi.',
    detail: { kendiReal, kumulatifReal, carpanKumulatif, yeniToplamOdeme, zatenOdenen, sumHedef, sumSatis, approx }
  };
}

// ══════════════════════════════════════════════════════════════
//  Dönem prim dökümü — SAF hesap (canlı GENEL'den bağımsız)
//  calcPrimForTTT / calcPrim ile AYNI iş kuralı: TL Real %100 sınırlı,
//  Portföy sabit %100 çarpanı, MI&GI eşiği effReal>=70.
//  Kullanım: Prim Hesapla → "Geçmiş Dönem" tablosu (prim-gecmis.js).
// ══════════════════════════════════════════════════════════════
function calcPrimBreakdown(o) {
  const BAZ_TL_REAL = 55000, BAZ_MIGI = 14000;
  // Geçmiş Dönem tablosu: TL Real, Prim Puanı, MI ve GIGI tam sayıya yuvarlanır (en yakın; .5 yukarı:
  // 75,9→76 · 96,45→96 · 34,51→35). Tabloda GÖRÜNEN değer = eşik/matris hesabında KULLANILAN değer.
  const _rd = v => Math.floor((+v || 0) + 0.5 + 1e-9);
  const effReal = _rd(o.effReal), primPuani = _rd(o.primPuani);
  const mi = _rd((o.mi > 0) ? o.mi : 100), gi = _rd((o.gi > 0) ? o.gi : 100);
  const carpan = effReal >= 91 ? getCarpan(Math.min(effReal, 100)) : 0;
  const tlRealPrimDonemlik = carpan * BAZ_TL_REAL;
  const ekPrim = o.ekPrim || 0;
  const portfoyPrim = calcPortfoyPrim(effReal, primPuani);
  const migiKatsayi = effReal >= 70 ? getMiGiKatsayi(mi, gi) : 0;
  const migiPrim = migiKatsayi * BAZ_MIGI;
  return {
    carpan, tlRealPrimDonemlik, ekPrim, tlRealPrim: tlRealPrimDonemlik + ekPrim,
    portfoyPrim, migiKatsayi, migiPrim,
    toplamPrim: tlRealPrimDonemlik + ekPrim + portfoyPrim + migiPrim
  };
}

// ── TSB bar için: herhangi bir TTT'nin prim toplamını GENEL'den hesapla ──
function calcPrimForTTT(ttt) {
  // Eğer prim hesaplama sayfasında bu temsilci zaten hesaplandıysa onu kullan
  if (window._lastCalcPrim && window._lastCalcPrim.ttt === ttt) {
    return window._lastCalcPrim.toplamPrim;
  }
  const rGenel = GENEL.find(g => g.ttt === ttt && g.urun === 'GENEL TOPLAM');
  if (!rGenel) return 0;
  const effReal   = rGenel.tl_pct || 0;
  const urunRows  = GENEL.filter(g => g.ttt === ttt && g.urun !== 'GENEL TOPLAM' && g.urun !== 'DESTEVIT');
  const urunReals = Object.fromEntries(urunRows.map(r => [r.urun, r.tl_pct]));
  const primPuani = rGenel.prim_pct || calcPrimPuani(urunReals, ttt);
  // MI/GI: MIGI_TL_RAW'dan bu TTT'nin EN GÜNCEL dönemine ait ortalamasını al
  // BUG DÜZELTMESİ: gerçek alan adı 'person'dır ('ttt' değil) ve "GI"
  // değeri 'bi' alanında tutulur ('gi' değil) — bkz. data-loader.js
  // parseMiGiToplamCSV(). Eski filtre HER ZAMAN boş dönüyordu.
  // 2. DÜZELTME: MIGI_TL_RAW bir kişi için BİRDEN FAZLA AYIN satırını
  // aynı anda içerebilir (CSV'deki her satır kendi ayını taşır, dosya
  // tek bir ay ile sınırlı değildir). Kişiye göre filtrelemek tek başına
  // yetmez — farklı ayların (bazıları eski/güncel olmayan) satırlarını
  // birbirine karıştırıp ortalamak yanlış olur. Bu yüzden önce o kişi
  // için mevcut EN GÜNCEL (en yüksek yıl/ay) döneme ait satırlar seçilir.
  // Not: bu veri kaynağı doğası gereği gecikmeli olabilir (MI&GI raporu
  // güncel satış dönemiyle birebir aynı ayı yansıtmayabilir) — burada
  // sadece elde mevcut EN GÜNCEL veriyi kullanıyoruz, "bu tam olarak
  // şu anki dönem" garantisi vermiyoruz.
  const _migiDonemNum = d => { const p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
  const migiRowsAll   = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(r => r.person === ttt);
  const _migiLatest    = migiRowsAll.reduce((max, r) => Math.max(max, _migiDonemNum(r.donem)), 0);
  const migiRows       = migiRowsAll.filter(r => _migiDonemNum(r.donem) === _migiLatest);
  let miAvg     = migiRows.length ? migiRows.reduce((s, r) => s + (r.mi || 100), 0) / migiRows.length : 100;
  let giAvg     = migiRows.length ? migiRows.reduce((s, r) => s + (r.bi || 100), 0) / migiRows.length : 100;
  // MI & GIGI: kesin (MI_GIGI.csv) varsa o, yoksa sistem verisinden otomatik tahmin (bkz. migi-donem.js)
  const _migiAuto = (typeof getMiGiOtomatik === 'function') ? getMiGiOtomatik(ttt) : null;
  if (_migiAuto) { miAvg = _migiAuto.mi; giAvg = _migiAuto.gi; }
  const migiKatsayi = effReal >= 70 ? getMiGiKatsayi(miAvg, giAvg) : 0;
  const BAZ_TL_REAL = 55000;
  const BAZ_MIGI    = 14000;
  // RESMİ KURAL DÜZELTMESİ: TL Real Primi HER dönemde (normal veya
  // kompanzasyon fark etmeksizin) kendi %100 sınırıyla hesaplanır —
  // "Dönemler %100 realizasyona göre hesaplanır" (PDF). %100 üzeri kısım
  // bu dönemlik hesaba DEĞİL, ayrı "Kompanzasyon Ek Primi"ne yansır
  // (bkz. calcKompanzasyonEkPrimi — 3 dönemlik geriye dönük mahsuplaşma).
  const effRealCarpan = Math.min(effReal, 100);
  const carpan    = effReal >= 91 ? getCarpan(effRealCarpan) : 0;
  const tlRealPrimDonemlik = carpan * BAZ_TL_REAL;
  // Kompanzasyon Ek Primi (SADECE k1/k2 döneminde, koşulları sağlarsa)
  const _komp = (typeof calcKompanzasyonEkPrimi === 'function') ? calcKompanzasyonEkPrimi(ttt, GENEL) : { ekPrim: 0 };
  const tlRealPrim  = tlRealPrimDonemlik + (_komp.ekPrim || 0);
  // Portföy Primi: calcPortfoyPrim() — PDF: hak edilen TL Real primine %20 ek, en fazla %100 real'e göre (bkz. PORTFOY_ORANSAL)
  const portfoyPrim = calcPortfoyPrim(effReal, primPuani);
  const migiPrim    = migiKatsayi * BAZ_MIGI;
  return tlRealPrim + portfoyPrim + migiPrim;
}

// ══════════════════════════════════════════════════════════════
//  FORECAST BAZLI TAHMİNİ PRİM (kullanıcı isteği — "Ekip Performans
//  Sıralaması (Tümü)" tablosundaki "Tahmini Prim" sütunu, dönem henüz
//  bitmemişken o anki ANLIK realizasyona göre hesaplanıyordu — bu,
//  "Tahmini" (yani dönem SONUNU öngören) bir sütun için yanıltıcıydı,
//  çünkü kategori sütunu (bkz. team-ranking-engine.js _category — aynı
//  bug düzeltmesi) forecast'a bakarken prim sütunu hâlâ anlık real'e
//  bakıyordu — ikisi TUTARSIZ görünebiliyordu.
//
//  Bu fonksiyon calcPrimForTTT() ile BİREBİR AYNI resmi iş kuralını
//  (çarpan tablosu, MI&GI matrisi, %91 Portföy Primi eşiği) uygular —
//  TEK FARK: "effReal" olarak o anki rGenel.tl_pct yerine dönem sonu
//  FORECAST'ı (generateForecast() → projectedReal) kullanılır; Portföy
//  Primi Puanı da (varsa) forecast'ın ürün bazlı projectedReal'lerinden
//  hesaplanır.
//
//  BİLİNÇLİ OLARAK DAHİL EDİLMEYEN kalemler:
//    • Kompanzasyon Ek Primi — resmi kural gereği SADECE GERÇEKLEŞMİŞ
//      (arşivlenmiş, dönemi kapanmış) periyodların KENDİ realizasyonuna
//      bakar ("kompanzasyon döneminin KENDİ TL realizasyonu >= %95");
//      henüz kapanmamış bir dönem için bu koşul ileriye dönük bir
//      tahminle test edilemez, o yüzden forecast prim hesabına dahil
//      edilmez (calcPrimForTTT'de zaten sadece k1/k2 dönemlerinde devreye
//      giriyor).
//    • MI&GI kısmı — bu veri kaynağının (MIGI_TL_RAW) kendi bir forecast
//      yöntemi yok, bu yüzden calcPrimForTTT'deki gibi CANLI (mevcut) MI/GI
//      ortalaması kullanılır; sadece eşik kontrolü (effReal>=70) forecast
//      değerine göre yapılır.
//
//  @param {string} ttt
//  @returns {number} — forecast bazlı tahmini toplam prim (TL)
// ══════════════════════════════════════════════════════════════
function calcPrimForTTTForecast(ttt) {
  // Forecast motoru yoksa veya bu kişi için hesaplanamıyorsa (0/negatif),
  // sessizce anlık real bazlı calcPrimForTTT()'ye düş — hiç prim
  // göstermemekten iyidir.
  if (typeof generateForecast !== 'function') return calcPrimForTTT(ttt);
  let fc;
  try { fc = generateForecast(ttt); } catch (e) { return calcPrimForTTT(ttt); }
  if (!fc || !(fc.projectedReal > 0)) return calcPrimForTTT(ttt);

  const effReal = fc.projectedReal;

  // Portföy Primi Puanı — forecast'ın kendi ürün bazlı tahminlerini
  // (productForecasts[].projectedReal) kullanır; forecast ürün kırılımı
  // yoksa anlık GENEL ürün real'lerine düşülür.
  let primPuani;
  if (Array.isArray(fc.productForecasts) && fc.productForecasts.length) {
    const urunReals = {};
    fc.productForecasts.forEach(pf => { urunReals[pf.urun] = pf.projectedReal; });
    primPuani = calcPrimPuani(urunReals, ttt);
  } else {
    const urunRows  = GENEL.filter(g => g.ttt === ttt && g.urun !== 'GENEL TOPLAM' && g.urun !== 'DESTEVIT');
    const urunReals = Object.fromEntries(urunRows.map(r => [r.urun, r.tl_pct]));
    primPuani = calcPrimPuani(urunReals, ttt);
  }

  // MI/GI — calcPrimForTTT ile AYNI (canlı, en güncel dönem ortalaması)
  const _migiDonemNum = d => { const p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
  const migiRowsAll   = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(r => r.person === ttt);
  const _migiLatest    = migiRowsAll.reduce((max, r) => Math.max(max, _migiDonemNum(r.donem)), 0);
  const migiRows       = migiRowsAll.filter(r => _migiDonemNum(r.donem) === _migiLatest);
  let miAvg = migiRows.length ? migiRows.reduce((s, r) => s + (r.mi || 100), 0) / migiRows.length : 100;
  let giAvg = migiRows.length ? migiRows.reduce((s, r) => s + (r.bi || 100), 0) / migiRows.length : 100;
  const _migiAuto = (typeof getMiGiOtomatik === 'function') ? getMiGiOtomatik(ttt) : null;
  if (_migiAuto) { miAvg = _migiAuto.mi; giAvg = _migiAuto.gi; }
  const migiKatsayi = effReal >= 70 ? getMiGiKatsayi(miAvg, giAvg) : 0;

  const BAZ_TL_REAL = 55000;
  const BAZ_MIGI    = 14000;
  const effRealCarpan = Math.min(effReal, 100);
  const carpan     = effReal >= 91 ? getCarpan(effRealCarpan) : 0;
  const tlRealPrim = carpan * BAZ_TL_REAL; // Kompanzasyon Ek Primi kasıtlı olarak dahil değil (yukarıdaki not)

  // Portföy Primi: calcPortfoyPrim() — PDF: hak edilen TL Real primine %20 ek, en fazla %100 real'e göre (bkz. PORTFOY_ORANSAL)
  const portfoyPrim = calcPortfoyPrim(effReal, primPuani);
  const migiPrim    = migiKatsayi * BAZ_MIGI;

  return tlRealPrim + portfoyPrim + migiPrim;
}

function calcPrimPuani(urunReals, ttt) {
  let total = 0;
  for (const urun of Object.keys(URUN_AGIRLIK)) {
    const real = urunReals[urun] || 0;
    if (real >= 70) {
      // CSV'den temsilciye ait ağırlığı al, yoksa sabit değeri kullan
      const r = ttt ? GENEL.find(g => g.ttt === ttt && g.urun === urun) : null;
      const agirlik = (r && r.urun_agirlik > 0) ? r.urun_agirlik : (URUN_AGIRLIK[urun] || 0);
      const cappedReal = Math.min(real, 130);
      total += cappedReal * agirlik;
    }
  }
  return total;
}

// ══════════════════════════════════════════════════════════════
//  FAZ 31.0 — ÖNCEKİ DÖNEMİN NET ALINACAK PRİMİ (arşivden)
//
//  Kullanıcı bildirimi: "MI & GI Takibi" artık AYLIK değil, sistemin
//  2 aylık dönem yapısıyla uyumlu DÖNEMSEL geliyor. GENEL_TABLO.csv/
//  IMS_TABLO.csv gibi MIGI_TL_RAW da dönem kapanınca sıfırlanıp yeni
//  döneme göre dolduruluyor — bu yüzden Prim Hesaplama sayfası yeni
//  döneme geçince eski dönemin sonucunu kaybediyordu. Örnek: 5.Dönem
//  (Eylül–Ekim) aktifken 4.Dönemin (Temmuz–Ağustos) NET alınacak
//  priminin hâlâ görülebilmesi gerekiyor.
//
//  Çözüm: calcPrimForTTT ile AYNI iş kuralını uygular, ama CANLI
//  GENEL/MIGI_TL_RAW yerine PeriodArchiveManager'da saklanan o dönemin
//  FİNAL (arşivlenmiş) verisini kullanır (bkz. period-archive-manager.js
//  processNewSync — artık 3. parametre olarak MIGI_TL_RAW da arşivliyor).
//
//  @param {string} ttt
//  @param {string} periodKey — 'previous' verilirse günün etkin
//         döneminden BİR ÖNCEKİ dönem otomatik bulunur.
//  @returns {object|null} — arşiv/veri yoksa null.
// ══════════════════════════════════════════════════════════════
function calcPrimFromArchivedPeriod(ttt, periodKey) {
  const PM = (typeof window !== 'undefined' && window.PeriodArchiveManager) ? window.PeriodArchiveManager : null;
  if (!PM || !ttt) return null;

  let resolvedKey = periodKey;
  if (resolvedKey === 'previous' || !resolvedKey) {
    // NOT: getEffectivePeriod() değil, PM.getCurrentPeriodKey() (saf takvim
    // bazlı) kullanılıyor — çünkü arşivleme kararı da AYNI takvim mantığıyla
    // alınıyor (bkz. processNewSync). getEffectivePeriod()'daki 7 günlük
    // "grace" penceresi farklı bir amaca (kalan iş günü hesabı) hizmet
    // eder ve burada kullanılırsa dönem geçişinin ilk haftasında "önceki
        // dönem" yanlış (bir fazla geriye) hesaplanabilir.
    const curKey = typeof PM.getCurrentPeriodKey === 'function' ? PM.getCurrentPeriodKey() : null;
    resolvedKey = curKey && typeof PM.getPreviousPeriodKey === 'function' ? PM.getPreviousPeriodKey(curKey) : null;
  }
  if (!resolvedKey) return null;

  const arch = PM.getArchivedPeriod(resolvedKey);
  if (!arch || !arch.genel || !arch.genel.length) return null;

  const archGenel = arch.genel;
  const archMigi  = arch.migi || [];

  const rGenel = archGenel.find(g => g.ttt === ttt && g.urun === 'GENEL TOPLAM');
  if (!rGenel) return null;

  const effReal = rGenel.tl_pct || 0;
  // Prim Puanı — CSV'de hazır değer varsa onu kullan, yoksa arşivlenmiş
  // GENEL satırlarından (calcPrimPuani global GENEL'i okuduğundan burada
  // aynı ağırlıklandırma mantığı arşiv verisiyle yeniden uygulanıyor).
  let primPuani = rGenel.prim_pct;
  if (!primPuani) {
    primPuani = 0;
    Object.keys(URUN_AGIRLIK).forEach(u => {
      const r2 = archGenel.find(g => g.ttt === ttt && g.urun === u);
      const real = r2 ? (r2.tl_pct || 0) : 0;
      if (real >= 70) {
        const agirlik = (r2 && r2.urun_agirlik > 0) ? r2.urun_agirlik : (URUN_AGIRLIK[u] || 0);
        primPuani += Math.min(real, 130) * agirlik;
      }
    });
  }

  // MI/GI — arşivlenmiş MIGI_TL_RAW'dan bu kişinin en güncel dönemine ait ortalama
  const _migiDonemNum = d => { const p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
  const migiRowsAll = archMigi.filter(r => r.person === ttt);
  const _migiLatest = migiRowsAll.reduce((max, r) => Math.max(max, _migiDonemNum(r.donem)), 0);
  const migiRows    = migiRowsAll.filter(r => _migiDonemNum(r.donem) === _migiLatest);
  let hasMigi = migiRows.length > 0;
  let miAvg = hasMigi ? migiRows.reduce((s, r) => s + (r.mi || 100), 0) / migiRows.length : null;
  let giAvg = hasMigi ? migiRows.reduce((s, r) => s + (r.bi || 100), 0) / migiRows.length : null;
  // MI_GIGI.csv (düzeltilmiş IMS ile dönem sonu +2 ay gelen KESİN değer) varsa o; yoksa
  // sistem verisinden otomatik tahmin (bkz. getMiGiOtomatik — kesin gelince kendiliğinden değişir).
  if (typeof getMiGiOtomatik === 'function') {
    const _mg = getMiGiOtomatik(ttt, resolvedKey);
    if (_mg) { hasMigi = true; miAvg = _mg.mi; giAvg = _mg.gi; }
  }

  const BAZ_TL_REAL = 55000;
  const BAZ_MIGI    = 14000;
  const effRealCarpan = Math.min(effReal, 100);
  const carpan = effReal >= 91 ? getCarpan(effRealCarpan) : 0;
  const tlRealPrimDonemlik = carpan * BAZ_TL_REAL;

  // Kompanzasyon Ek Primi — sadece arşivlenen dönem k1/k2 ise devreye
  // girer; calcKompanzasyonEkPrimi zaten bunu kendi içinde kontrol eder.
  const _komp = (typeof calcKompanzasyonEkPrimi === 'function')
    ? calcKompanzasyonEkPrimi(ttt, archGenel, resolvedKey)
    : { ekPrim: 0, eligible: false, reason: '' };
  const tlRealPrim = tlRealPrimDonemlik + (_komp.ekPrim || 0);

  // Portföy Primi: calcPortfoyPrim() — PDF: hak edilen TL Real primine %20 ek, en fazla %100 real'e göre (bkz. PORTFOY_ORANSAL)
  const portfoyPrim = calcPortfoyPrim(effReal, primPuani);
  const migiKatsayi = (effReal >= 70 && hasMigi) ? getMiGiKatsayi(miAvg, giAvg) : 0;
  const migiPrim = migiKatsayi * BAZ_MIGI;

  const toplamPrim = tlRealPrim + portfoyPrim + migiPrim;

  return {
    periodKey: resolvedKey,
    periodLabel: arch.periodLabel, periodMonths: arch.periodMonths, archivedAt: arch.archivedAt,
    toplamPrim, tlRealPrim, tlRealPrimDonemlik, ekPrim: (_komp.ekPrim || 0),
    portfoyPrim, migiPrim, migiKatsayi,
    effReal, primPuani, miAvg, giAvg, hasMigi
  };
}
