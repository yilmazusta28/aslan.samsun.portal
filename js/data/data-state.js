// ══════════════════════════════════════════════════════════════
//  js/data/data-state.js — Uygulama Veri Durumu
//  Phase 2.1 extraction
//  Globals: IMS, GENEL, KUTU, MIGI_TL_RAW, MIGI_KUTU_RAW,
//           MIGI_BRICK_TL_RAW, MIGI_BRICK_KUTU_RAW,
//           ECZANE_RAW, eczaneLoaded, _syncLock, REGION_RANKING
//  Yükleme sırası: async-guard → constants → data-state
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Birincil Satış Verileri ───────────────────────────────────
let IMS   = [];   // IMS_TABLO.csv kaynaklı — haftalık kutu/TL
let GENEL = [];   // GENEL_TABLO.csv kaynaklı — aylık performans
let KUTU  = [];   // IMS'ten türetilmiş — rebuildKutuFromIMS() ile güncellenir

// ── Bölge/Ulusal Sıralama Verileri ───────────────────────────
// GENEL_TABLO.csv'ye kullanıcı tarafından eklenen NATIONAL / DİYARBAKIR /
// KONYA / BURSA vb. bölge satırları (bkz. csv-parser.js parseGenelCSV()
// içindeki "bölge satırı" tespiti). Kişi adı DEĞİL, doğrudan bölge/ulusal
// etiketi taşırlar: { bolge, tr_sira, tl_pct }. Yönetici sayfasındaki
// "Bölge Sıralaması" tablosunu besler (manager-panel-engine.js).
let REGION_RANKING = [];

// ── MI/GI Endeks Verileri ────────────────────────────────────
let MIGI_TL_RAW      = [];   // MI_GI_TL_TOPLAM.csv
let MIGI_KUTU_RAW    = [];   // MI_GI_KUTU_TOPLAM.csv
let MIGI_BRICK_TL_RAW   = [];   // MI_GI-TL.csv (brick bazlı)
let MIGI_BRICK_KUTU_RAW = [];   // MI_GI-KUTU.csv (brick bazlı)

// ── Eczane Verileri ──────────────────────────────────────────
let ECZANE_RAW   = null;   // parseEczaneCSV() çıktısı
let eczaneLoaded = false;  // Yükleme tamamlandı mı?

// ── Sync Kilidi ──────────────────────────────────────────────
// syncData() eş zamanlı çift çalıştırma koruması
let _syncLock = false;

// ── State Sıfırlama Yardımcıları ─────────────────────────────
function resetDataState() {
  IMS.length   = 0;
  GENEL.length = 0;
  KUTU.length  = 0;
  MIGI_TL_RAW.length      = 0;
  MIGI_KUTU_RAW.length    = 0;
  MIGI_BRICK_TL_RAW.length   = 0;
  MIGI_BRICK_KUTU_RAW.length = 0;
  REGION_RANKING.length      = 0;
  ECZANE_RAW   = null;
  eczaneLoaded = false;
  _syncLock    = false;
}

// ── Hydration Durum Kontrolü ─────────────────────────────────
function isDataReady() {
  return IMS.length > 0 && GENEL.length > 0;
}

// ── Kısmi Yükleme Tespiti ────────────────────────────────────
function isPartiallyHydrated() {
  return (IMS.length > 0) !== (GENEL.length > 0);
}
