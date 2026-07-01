// ══════════════════════════════════════════════════════════════
//  js/core/math-utils.js — Genel Matematiksel Yardımcılar
//  Phase 3.0 extraction
//  Globals: parseN (csv-parser.js'de de tanımlı — bu kopyası standalone)
//  Note: prim hesaplama fonksiyonları → js/core/prim-calc.js'de
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Güvenli Sayı Çözümleyici ─────────────────────────────────
// Türkçe virgül/nokta decimal ayraçlarını handle eder
// Kaynak: index.html (csv-parser bloğundan bağımsız kopya)
// ROLLBACK: v1 (% handling yoktu — "56,34%" → 5634 hatası)
// FIX: % işareti strip edilmeden önce regex'e giriyordu, artık başta temizleniyor
function parseN(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s || s === '-' || s === '--') return 0;
  // % işaretini kaldır — regex'e girmeden önce (BUG FIX: "56,34%" → "56,34")
  s = s.replace('%', '').trim();
  if (!s || s === '-') return 0;
  // Excel parantez-negatif format: (972.456) veya (1.234,56)
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  let r = 0;
  // Türkçe format: 1.234,56 → 1234.56
  if (/^-?[\d.]+,[\d]+$/.test(s)) r = parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
  // İngilizce format: 1,234.56 → 1234.56
  else if (/^-?[\d,]+\.[\d]+$/.test(s)) r = parseFloat(s.replace(/,/g,'')) || 0;
  else r = parseFloat(s.replace(/,/g,'')) || 0;
  return negative ? -r : r;
}

// ── Yüzde Hesabı ─────────────────────────────────────────────
function safePct(numerator, denominator) {
  if (!denominator || denominator === 0) return 0;
  return (numerator / denominator) * 100;
}

// ── Değer Sıkıştırma ─────────────────────────────────────────
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
