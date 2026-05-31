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
function parseN(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '');
  // Türkçe format: 1.234,56 → 1234.56
  if (/^-?[\d.]+,[\d]+$/.test(s)) return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
  // İngilizce format: 1,234.56 → 1234.56
  if (/^-?[\d,]+\.[\d]+$/.test(s)) return parseFloat(s.replace(/,/g,'')) || 0;
  return parseFloat(s.replace(/,/g,'')) || 0;
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
