/**
 * js/ui/card-renderers.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  Shared stat cards, KPI card builders, compact metric cards,
 *  reusable info cards.
 *
 *  These are PURE HTML-string factory functions.
 *  They do NOT perform DOM writes themselves — callers set
 *  innerHTML with the returned strings.  This keeps them
 *  side-effect-free and easy to test.
 *
 *  Dependencies:
 *    js/core/formatters.js  (fTL, fK, fPct, pCls, barCls)
 *    js/core/constants.js   (URUN_CLR, TTT_COLORS)
 *  Rollback: remove <script src="js/ui/card-renderers.js">.
 *            All callers in index.html use their own inline
 *            template literals that remain unchanged —
 *            this file only ADDS factory helpers; nothing
 *            is removed from index.html in this phase.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ══════════════════════════════════════════════════════════
 *  1. TSB STAT CELL  (used inside renderTTTDetail)
 *     Produces a single <div class="tsb-cell"> block.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a single stat cell for the TTT summary box.
 * @param {string} label      e.g. 'Toplam Hedef'
 * @param {string} value      formatted string e.g. '₺1.234.567'
 * @param {string} [color]    optional CSS color for the value
 * @returns {string} HTML string
 */
function cardStatCell(label, value, color) {
  const style = color ? ` style="color:${color}"` : '';
  return `<div class="tsb-cell">
    <div class="tsb-lbl">${label}</div>
    <div class="tsb-val"${style}>${value}</div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
 *  2. RANK BADGE  (used inside renderTTTDetail)
 * ══════════════════════════════════════════════════════════*/

/**
 * Build the TR Sırası rank badge column.
 * @param {number} trSira   0 = no ranking
 * @returns {string} HTML string for the .tsb-rank-col element
 */
function cardRankBadge(trSira) {
  const col = trSira <= 30 ? '#16A34A' : trSira <= 60 ? '#D97706' : '#DC2626';
  const tag = trSira
    ? (trSira <= 30 ? '🏆 İlk 30' : trSira <= 60 ? '🥈 İlk 60' : '📊 Sıralamada')
    : '—';
  const num  = trSira ? '#' + trSira : '—';
  return `<div class="tsb-rank-col">
    <div class="tsb-rank-badge">
      <div class="tsb-rank-lbl">TR Sırası</div>
      <div class="tsb-rank-num" style="color:${col}">${num}</div>
      <div class="tsb-rank-tag" style="color:${col}">${tag}</div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
 *  3. PERFORMANCE BADGE  (bdg + colour logic)
 *     Wraps the pCls / barCls helpers in a consistent <span>.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a percentage badge <span>.
 * @param {number} pct    percentage value (0-130)
 * @param {string} [extraClass]  additional CSS class
 * @returns {string} HTML string
 */
function cardPctBadge(pct, extraClass) {
  // pCls is defined in formatters.js
  const cls = (typeof pCls === 'function' ? pCls(pct) : '') + (extraClass ? ' ' + extraClass : '');
  return `<span class="bdg ${cls}">${typeof fPct === 'function' ? fPct(pct) : pct.toFixed(1) + '%'}</span>`;
}

/**
 * Build a progress bar <div>.
 * @param {number} pct       percentage value
 * @param {number} [width=80] bar track width in px
 * @param {string} [color]   optional fill color override
 * @returns {string} HTML string
 */
function cardProgressBar(pct, width, color) {
  const cls   = typeof barCls === 'function' ? barCls(pct) : '';
  const w     = width || 80;
  const fill  = Math.min(pct, 100);
  const style = color ? `background:${color};` : '';
  return `<div class="prog" style="width:${w}px">
    <div class="prog-fill ${cls}" style="${style}width:${fill}%"></div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
 *  4. EKIP RANKING ROW  (used inside renderGenelTablo)
 *     Returns a <tr> string for the team ranking table.
 * ══════════════════════════════════════════════════════════*/

/**
 * @param {object} r       GENEL row (urun === 'GENEL TOPLAM')
 * @param {number} idx     0-based rank index
 * @param {number} [trSira] TR national rank, 0 = none
 * @returns {string} <tr> HTML string
 */
function cardEkipRankRow(r, idx, trSira) {
  const rankClass = idx === 0 ? 'rk-1' : idx === 1 ? 'rk-2' : idx === 2 ? 'rk-3' : 'rk-n';
  const trS   = trSira || 0;
  const trCol = trS <= 30 ? '#0BA87E' : trS <= 60 ? '#D97706' : '#DC2626';
  const pp    = r.prim_pct || 0;
  const ppStyle = pp >= 91
    ? 'background:#16A34A;color:#fff'
    : pp >= 70 ? 'background:#D97706;color:#fff' : '';
  return `<tr>
    <td><span class="rk ${rankClass}">${idx + 1}</span></td>
    <td style="font-weight:600;cursor:pointer;color:var(--c1)" onclick="selectTTT('${r.ttt}')">${r.ttt}</td>
    <td class="mono">${fTL(r.hedef_tl)}</td>
    <td class="mono" style="font-weight:700">${fTL(r.satis_tl)}</td>
    <td class="mono ${r.kalan_tl < 0 ? 'negative' : 'positive'}">${fTL(r.kalan_tl)}</td>
    <td>${cardPctBadge(r.tl_pct)}</td>
    <td><span class="bdg bdg-blue" style="${ppStyle}">${fPct(pp)}</span></td>
    <td>${cardProgressBar(r.tl_pct, 80)}</td>
    <td style="color:${trCol};font-weight:700">${trS ? '#' + trS : '—'}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
 *  5. KPI SUMMARY CARD  (compact banner card)
 *     Used for period/target summary banners.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a compact inline KPI card.
 * @param {object} cfg
 * @param {string}  cfg.icon       FontAwesome class e.g. 'fa-bullseye'
 * @param {string}  cfg.label      card label text
 * @param {string}  cfg.value      formatted value string
 * @param {string}  [cfg.sub]      optional sub-value / trend text
 * @param {string}  [cfg.color]    accent color
 * @param {string}  [cfg.cls]      extra CSS classes for the card div
 * @returns {string} HTML string
 */
function cardKpi(cfg) {
  const color  = cfg.color || 'var(--c1)';
  const icon   = cfg.icon  ? `<i class="fas ${cfg.icon}" style="color:${color};margin-right:6px"></i>` : '';
  const sub    = cfg.sub   ? `<div class="kpi-sub" style="font-size:10px;color:var(--dim);margin-top:2px">${cfg.sub}</div>` : '';
  const extra  = cfg.cls   ? ' ' + cfg.cls : '';
  return `<div class="kpi-card${extra}">
    <div class="kpi-label">${icon}${cfg.label}</div>
    <div class="kpi-value" style="color:${color}">${cfg.value}</div>
    ${sub}
  </div>`;
}

/* ══════════════════════════════════════════════════════════
 *  6. URUN CHIP / BADGE  (product colour pill)
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a small coloured product label badge.
 * @param {string} urun  product name (key into URUN_CLR)
 * @returns {string} HTML string
 */
function cardUrunBadge(urun) {
  const clr = (typeof URUN_CLR !== 'undefined' && URUN_CLR[urun]) || '#64748B';
  return `<span style="background:${clr}22;color:${clr};border-radius:3px;padding:1px 5px;font-size:8px;font-weight:700">${urun}</span>`;
}

/* ══════════════════════════════════════════════════════════
 *  7. ALERT BOX HELPER  (competition / iade alert cards)
 * ══════════════════════════════════════════════════════════*/

/**
 * Show or hide the alertBox with provided HTML lines.
 * @param {string[]} alerts  array of HTML strings (one per alert)
 */
function cardRenderAlertBox(alerts) {
  const box  = typeof uiById === 'function' ? uiById('alertBox')  : document.getElementById('alertBox');
  const body = typeof uiById === 'function' ? uiById('alertBoxBody') : document.getElementById('alertBoxBody');
  if (!box) return;
  if (alerts && alerts.length) {
    box.style.display = 'block';
    if (body) body.innerHTML = alerts.join('<br>');
  } else {
    box.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════════════════
 *  8. INSIGHT BODY HELPER
 * ══════════════════════════════════════════════════════════*/

/**
 * Write HTML into the anaInsightBody element.
 * @param {string} html
 */
function cardSetInsight(html) {
  const el = typeof uiById === 'function' ? uiById('anaInsightBody') : document.getElementById('anaInsightBody');
  if (el) el.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════
 *  9. EMPTY STATE HELPER
 *     Returns a generic empty-state <tr> or <div> message.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build an empty-state table row.
 * @param {string} [message]  optional message; defaults to 'Veri bulunamadı'
 * @param {number} [colSpan=8]
 * @returns {string} <tr> HTML string
 */
function cardEmptyTableRow(message, colSpan) {
  const msg  = message  || 'Veri bulunamadı';
  const cols = colSpan  || 8;
  return `<tr><td colspan="${cols}" style="text-align:center;color:var(--dim);padding:24px 0;font-size:13px">${msg}</td></tr>`;
}

/**
 * Build an empty-state div block.
 * @param {string} [message]
 * @param {string} [icon]  emoji or FA html
 * @returns {string} div HTML string
 */
function cardEmptyState(message, icon) {
  const msg  = message || 'Veri bulunamadı';
  const ico  = icon    || '📭';
  return `<div style="text-align:center;padding:40px 20px;color:var(--dim)">
    <div style="font-size:32px;margin-bottom:10px">${ico}</div>
    <div style="font-size:13px">${msg}</div>
  </div>`;
}

/* ── EXPORTS ────────────────────────────────────────────────*/
Object.assign(window, {
  cardStatCell,
  cardRankBadge,
  cardPctBadge,
  cardProgressBar,
  cardEkipRankRow,
  cardKpi,
  cardUrunBadge,
  cardRenderAlertBox,
  cardSetInsight,
  cardEmptyTableRow,
  cardEmptyState,
});
