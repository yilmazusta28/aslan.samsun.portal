// ══════════════════════════════════════════════════════════════
//  js/core/formatters.js — Sayı & Renk Formatlayıcıları
//  Phase 3.0 extraction
//  Globals: fTL, fK, fPct, pCls, barCls,
//           getIndeksColor, getIndeksLabel, getPriorityLabel
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Renk & Etiket Yardımcıları ───────────────────────────────
function getIndeksColor(v) {
  if (v >= 120) return '#16A34A';
  if (v >= 100) return '#0891B2';
  if (v >= 80)  return '#D97706';
  return '#DC2626';
}
function getIndeksLabel(v) {
  if (v >= 120) return '🟢 Güçlü';
  if (v >= 100) return '🔵 İyi';
  if (v >= 80)  return '🟡 Orta';
  return '🔴 Zayıf';
}
function getPriorityLabel(sira, mi, gi) {
  const inTop333 = sira <= 333;
  const strong = mi >= 110 && gi >= 100;
  const risk   = mi < 90 || gi < 90;
  if (inTop333 && strong) return '<span style="background:#16A34A;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">🔑 ÖNCELİKLİ</span>';
  if (inTop333 && risk)   return '<span style="background:#DC2626;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">⚠️ RİSK</span>';
  if (inTop333)           return '<span style="background:#D97706;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">⭐ İZLE</span>';
  return '<span style="background:#94A3B8;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">2. GRP</span>';
}

// ── Para / Sayı Formatları ───────────────────────────────────
function fTL(n){
  if(n==null||isNaN(n))return'—';
  const abs=Math.abs(n);const sign=n<0?'-':'';
  return sign+Math.round(abs).toLocaleString('tr-TR')+'₺';
}
function fK(n){if(n==null||isNaN(n))return'—';return Math.round(n).toLocaleString('tr-TR')}
function fPct(n){if(n==null)return'—';return n.toFixed(1)+'%'}
function pCls(p){return p>=70?'bdg-good':p>=50?'bdg-mid':'bdg-bad'}
function barCls(p){return p>=70?'p-good':p>=50?'p-mid':'p-bad'}
