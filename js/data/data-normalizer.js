// ══════════════════════════════════════════════════════════════
//  js/data/data-normalizer.js — Veri Normalizasyon Katmanı
//  Phase 3.0 extraction (split from csv-parser.js)
//  Globals: stripTR, normTTT, normUrun, normGrp, isMktRow
//  Bağımlılık: js/core/constants.js (ALL_TTTS)
//  Yükleme sırası: constants → data-normalizer → csv-parser
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

function stripTR(s) {
  return s
    .replace(/Ğ/g,'G').replace(/ğ/g,'g')
    .replace(/Ü/g,'U').replace(/ü/g,'u')
    .replace(/Ş/g,'S').replace(/ş/g,'s')
    .replace(/İ/g,'I').replace(/ı/g,'i')
    .replace(/Ö/g,'O').replace(/ö/g,'o')
    .replace(/Ç/g,'C').replace(/ç/g,'c');
}

// Known canonical names for reverse-lookup
const CANONICAL_TTTS = [
  'KÜRŞAD KARADAĞ','AYKUT DİNLER','MURAT KANDİŞ','HAKAN YUMAK',
  'YILMAZ USTA','EMRAH YILDIZ','MEHMET AKİF ÖZGEÇEN','SAMET ÇETİN','ŞENOL YILMAZ'
];

function normTTT(raw) {
  if (!raw || !raw.trim()) return null;
  const up = raw.trim().toUpperCase();
  // 1. Direct lookup
  if (TTT_NORM_MAP[up]) return TTT_NORM_MAP[up];
  // 2. ASCII-stripped lookup
  const stripped = stripTR(up);
  if (TTT_NORM_MAP[stripped]) return TTT_NORM_MAP[stripped];
  // 3. Fuzzy: compare ASCII-stripped against canonical list
  for (const canon of CANONICAL_TTTS) {
    if (stripTR(canon) === stripped) return canon;
  }
  return null;
}

// ─── ÜRÜN NORMALIZER ────────────────────────────────────────
function normUrun(raw) {
  if (!raw) return null;
  const u = raw.trim().toUpperCase();
  if (u === 'FAMTREK') return 'FAMTREC'; // eski isim uyumu
  return u;
}

// ─── VALID İLAÇ GRUPLARI ────────────────────────────────────
// normGrp: grup adını canonical forma çevirir (ASCII/Türkçe variant toleranslı)
function normGrp(raw) {
  if (!raw) return null;
  const u = stripTR(raw.trim().toUpperCase());
  if (u.includes('PANTA') || u.includes('PANTOP') || u.includes('PANTAPRO')) return 'PANTAPROZOL PAZARI';
  if (u.includes('ACIDPASS') || u.includes('ACIDPAS') || u.includes('ACIPAS')) return 'ACIDPASS PAZARI';
  if (u.includes('MOKSIF') || u.includes('MOKSIFLO') || u.includes('LEVOFLOK')) return 'MOKSİFLOKSASİN PAZARI';
  if (u.includes('GRIPORT') || u.includes('GRIPO') || u.includes('COLD')) return 'GRİPORT COLD PAZARI';
  if (u.includes('FAMTR') || u.includes('FAMOT') || u.includes('FAMTREK')) return 'FAMTREC PAZARI';
  return null;
}

// is_mkt: Sadece PAZAR geneli TOPLAM satırlarını tanı
// "PANTOPRAZOLE PAZARI TOPLAM", "ACIDPASS PAZARI TOPLAM" gibi
// "PANOCER TOPLAM" veya "ACIDPASS TOPLAM" → kendi ürün, is_mkt=false
function isMktRow(ilac) {
  if (!ilac) return false;
  const u = stripTR(ilac.trim().toUpperCase());
  // "PAZAR TOPLAM" veya "PAZARI TOPLAM" içeriyorsa → pazar toplamı
  return u.includes('PAZAR') && u.includes('TOPLAM');
}
