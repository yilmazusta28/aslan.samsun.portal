// ══════════════════════════════════════════════════════════════
//  js/data/brick-tl-loader.js — Brick bazlı GERÇEK Hedef/Satış TL
//  Kaynak CSV: ./Brick_TL_Hedef.csv (repo kökü) — YENI IMS .xlsm içindeki
//  "BRICK TL HEDEF" sayfasının haftalık otomasyonla üretilen çıktısı.
//
//  CSV YAPISI (';' ayraçlı, Türkçe sayı biçimi):
//    Satır 1 : ürün blok başlıkları  (; PANOCER [TL] ;;;;;;; FAMTREC [TL] ...)
//    Satır 2 : dönem etiketi          (; 2026/5D ;;;;;; SON HAFTA ; ...)
//    Satır 3 : BRİCK; HEDEF; SATIŞ; REAL; PRİM P.; PAZAR P.; PAZAR; SATIŞ; (× 5 ürün)
//    Satır 4+: brick başına 1 satır
//  Her ürün bloğu 7 kolon: HEDEF, SATIŞ, REAL, PRİM P., PAZAR P., PAZAR, SON HAFTA SATIŞ.
//
//  Brick'in Hedef TL = 5 ürünün HEDEF toplamı, Satış TL = 5 ürünün SATIŞ toplamı.
//  Performans% = Satış / Hedef (brick bazlı) — manager-panel-engine.js kullanır.
//
//  Bağımlılık: js/data/csv-parser.js → parseN()
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// GitHub Pages büyük/küçük harfe duyarlı: repodaki gerçek ad önce denenir.
const GS_BRICK_TL_URLS = ["./Brick_TL_Hedef.csv", "./BRICK_TL_HEDEF.csv"];

// { BRICK_ANAHTARI: { brick, hedef, satis, real, urunler:[{urun,hedef,satis}] } }
window.BRICK_TL_HEDEF     = null;
window.BRICK_TL_LOAD_ERROR = null;
window.BRICK_TL_TRIED     = false;
window.BRICK_TL_LOADING   = false;

// Brick adı eşleştirme anahtarı: büyük harf + Türkçe karakterleri ASCII'ye çevir + boşluk sadeleştir
function brickTlKey(s) {
  return String(s == null ? '' : s)
    .replace(/İ/g, 'I').replace(/ı/g, 'I')
    .toUpperCase()
    .replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/\s+/g, ' ').trim();
}
window.brickTlKey = brickTlKey;

function parseBrickTlCSV(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const grid = clean.split('\n').filter(l => l.trim().length).map(l => l.split(';').map(s => s.trim()));

  // Etiket satırı: ilk hücresi "BRİCK" olan satır (üstündeki 2 satır başlık)
  const hi = grid.findIndex(r => brickTlKey(r[0]) === 'BRICK');
  if (hi < 2) throw new Error('Başlık satırı (BRİCK) bulunamadı');
  const titleRow = grid[hi - 2];
  const labelRow = grid[hi];

  // Ürün blokları: başlık satırında dolu hücre = blok başı, sonraki dolu hücreye kadar sürer
  const starts = [];
  titleRow.forEach((c, i) => { if (i > 0 && c) starts.push(i); });
  const blocks = [];
  starts.forEach((st, bi) => {
    const end = bi + 1 < starts.length ? starts[bi + 1] : labelRow.length;
    let hedefCol = -1, satisCol = -1, pazarCol = -1;
    for (let j = st; j < end; j++) {
      const k = brickTlKey(labelRow[j]);
      if (hedefCol < 0 && k === 'HEDEF') hedefCol = j;
      else if (satisCol < 0 && k === 'SATIS') satisCol = j;   // ilk SATIŞ = dönem satışı (SON HAFTA SATIŞ değil)
      else if (pazarCol < 0 && k === 'PAZAR') pazarCol = j;   // PAZAR (TL) — 'PAZAR P.' değil
    }
    if (hedefCol >= 0 && satisCol >= 0) {
      blocks.push({ urun: titleRow[st].replace(/\[.*?\]/g, '').trim(), hedefCol, satisCol, pazarCol });
    }
  });
  if (!blocks.length) throw new Error('Ürün blokları (HEDEF/SATIŞ) bulunamadı');

  const map = {};
  grid.slice(hi + 1).forEach(r => {
    const name = r[0];
    if (!name) return;
    const key = brickTlKey(name);
    if (!key || /^(GENEL )?TOPLAM$/.test(key)) return;
    let rec = map[key];
    if (!rec) rec = map[key] = { brick: name, hedef: 0, satis: 0, real: null, urunler: [] };
    blocks.forEach(b => {
      const h = parseN(r[b.hedefCol]);
      const s = parseN(r[b.satisCol]);
      rec.hedef += h;
      rec.satis += s;
      const pz = b.pazarCol >= 0 ? parseN(r[b.pazarCol]) : 0;
      rec.urunler.push({ urun: b.urun, hedef: h, satis: s, pazar: pz });
    });
    rec.real = rec.hedef > 0 ? (rec.satis / rec.hedef * 100) : null;
  });
  return map;
}

// Yüklenince açık olan Temsilci Brick Detayı & AI Pazar Analizi alanlarını yeniden çiz
function _brickTlRefreshUI() {
  try {
    const sel = document.getElementById('mgrTttSelect');
    const ttt = sel ? sel.value : '';
    if (typeof renderManagerBrickDetail === 'function') renderManagerBrickDetail(ttt, 'mgrBrickDetailBody');
    if (typeof renderManagerAiAnaliz === 'function')    renderManagerAiAnaliz(ttt, 'mgrAiAnalizBody');
  } catch (e) {
    console.warn('[brick-tl-loader] UI yenileme hatası:', e.message);
  }
}

async function loadBrickTlHedef(forceFresh) {
  if (window.BRICK_TL_HEDEF && !forceFresh) return window.BRICK_TL_HEDEF;
  if (window.BRICK_TL_LOADING) return null;
  window.BRICK_TL_LOADING = true;
  window.BRICK_TL_TRIED = true;
  window.BRICK_TL_LOAD_ERROR = null;

  let lastErr = null;
  for (const url of GS_BRICK_TL_URLS) {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
      const text = await res.text();
      if (text.trim().startsWith('<')) throw new Error(url + ' yerine HTML döndü');
      const map = parseBrickTlCSV(text);
      if (!Object.keys(map).length) throw new Error(url + ' içinde geçerli brick satırı yok');
      window.BRICK_TL_HEDEF = map;
      window.BRICK_TL_LOADING = false;
      console.debug('[brick-tl-loader] ' + Object.keys(map).length + ' brick yüklendi (' + url + ')');
      _brickTlRefreshUI();
      return map;
    } catch (e) {
      lastErr = e;
    }
  }
  window.BRICK_TL_LOADING = false;
  window.BRICK_TL_LOAD_ERROR = lastErr ? lastErr.message : 'bilinmeyen hata';
  console.warn('[brick-tl-loader] Brick_TL_Hedef.csv yüklenemedi — tahmini dağıtıma düşülüyor:', window.BRICK_TL_LOAD_ERROR);
  return null;
}
window.loadBrickTlHedef = loadBrickTlHedef;
window.parseBrickTlCSV  = parseBrickTlCSV;

// Sayfa açılır açılmaz arka planda yükle (manager paneli ayrıca tembel tetikleme yapar)
if (window.location.protocol !== 'file:') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { loadBrickTlHedef(false); });
  else loadBrickTlHedef(false);
}
