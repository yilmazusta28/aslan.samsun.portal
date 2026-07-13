// ══════════════════════════════════════════════════════════════
//  js/core/prim-calc.js — Prim Hesaplama Modülü
//  Phase 2.2 extraction — EXACT copy from index.html
//  Globals uses: URUN_AGIRLIK (index.html), GENEL (index.html)
//  Exports: getCarpan, getMiGiKatsayi, calcPrimForTTT, calcPrimPuani
//  Exports: CARPAN_TABLE, MIGI_MATRIX, URUN_AGIRLIK
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
function getMiGiKatsayi(mi, gi) {
  const MI_COLS  = [80,85,90,95,100,110,120,130,140,150];
  const GI_ROWS  = [80,85,90,95,100,110,120,130,140,150];
  const snapMI   = MI_COLS.reduce((a,b) => Math.abs(b-mi)<Math.abs(a-mi)?b:a);
  const snapGI   = GI_ROWS.reduce((a,b) => Math.abs(b-gi)<Math.abs(a-gi)?b:a);
  return MIGI_MATRIX[snapGI]?.[snapMI] ?? 0;
}

// Prim puanı hesapla (ürün ağırlıkları × real)
const URUN_AGIRLIK = {
  'PANOCER': 0.25, 'ACİDPASS': 0.25,
  'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.15, 'FAMTREC': 0.15  // sıra: PANOCER·ACİDPASS·GRİPORT·MOKSEFEN·FAMTREC
};

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
  const carpan    = effReal >= 91 ? getCarpan(effReal) : 0;
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
  const miAvg     = migiRows.length ? migiRows.reduce((s, r) => s + (r.mi || 100), 0) / migiRows.length : 100;
  const giAvg     = migiRows.length ? migiRows.reduce((s, r) => s + (r.bi || 100), 0) / migiRows.length : 100;
  const migiKatsayi = effReal >= 70 ? getMiGiKatsayi(Math.round(miAvg), Math.round(giAvg)) : 0;
  const BAZ_TL_REAL = 55000;
  const BAZ_MIGI    = 14000;
  const tlRealPrim  = carpan * BAZ_TL_REAL;
  const portfoyPrim = (effReal >= 91 && primPuani >= 91) ? 0.20 * BAZ_TL_REAL * carpan : 0;
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
