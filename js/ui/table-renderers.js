/**
 * js/ui/table-renderers.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  Shared table builders, header generators,
 *  reusable row helpers, empty-state builders.
 *
 *  These are PURE HTML-string factories + thin DOM-write
 *  wrappers. Functions prefixed with 'tbl' are factories
 *  (return strings). Functions prefixed with 'renderTbl'
 *  perform the actual DOM write via uiSetHtml / uiById.
 *
 *  Dependencies:
 *    js/ui/ui-helpers.js    (uiById, uiSetHtml)
 *    js/ui/card-renderers.js (cardEmptyTableRow, cardPctBadge,
 *                             cardProgressBar, cardUrunBadge)
 *    js/core/formatters.js  (fTL, fK, fPct, pCls, barCls)
 *    js/core/constants.js   (URUN_CLR, URUN_ORDER)
 *    js/data/data-state.js  (GENEL, KUTU, IMS_TL_MAP — accessed
 *                             at call-time, not at parse-time)
 *
 *  Rollback: remove <script src="js/ui/table-renderers.js">.
 *            Original renderKutuTable / renderGenelTablo etc.
 *            remain in index.html as PHASE23-STUB blocks and
 *            will reactivate automatically.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ── INTERNAL SAFE HELPERS ──────────────────────────────────
 *  Thin compatibility shims so this file works whether or not
 *  ui-helpers.js has been loaded yet.
 */
function _el(id)          { return (typeof uiById !== 'undefined' ? uiById(id) : document.getElementById(id)); }
function _setHtml(id, h)  { const e = _el(id); if (e) e.innerHTML = h; }

/* ══════════════════════════════════════════════════════════
 *  1. GENERIC TABLE HEADER GENERATOR
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a <thead><tr> from a column-spec array.
 * @param {Array<{label:string, key?:string, style?:string, sortFn?:string}>} cols
 * @param {string} [theadId]  id of the <thead> element to update (optional)
 * @returns {string} <thead> HTML string
 */
function tblBuildHeader(cols, theadId) {
  const cells = cols.map(c => {
    const sortAttr = c.sortFn ? ` onclick="${c.sortFn}" style="cursor:pointer${c.style ? ';' + c.style : ''}"` : (c.style ? ` style="${c.style}"` : '');
    return `<th${sortAttr}>${c.label}</th>`;
  }).join('');
  const html = `<tr>${cells}</tr>`;
  if (theadId) _setHtml(theadId, html);
  return html;
}

/* ══════════════════════════════════════════════════════════
 *  2. WEEKLY COLUMNS HEADER  (h1…h9 + Ort.)
 * ══════════════════════════════════════════════════════════*/

/**
 * Produce weekly column <th> cells for h1…h9 plus an average cell.
 * @param {number} [count=9]   number of weekly columns
 * @param {string} [avgLabel='Ort.']
 * @returns {string} string of <th> tags (no wrapper)
 */
function tblWeeklyCols(count, avgLabel) {
  const n = count || 9;
  const cells = [];
  for (let i = 1; i <= n; i++) cells.push(`<th>${i}.H</th>`);
  cells.push(`<th>${avgLabel || 'Ort.'}</th>`);
  return cells.join('');
}

/* ══════════════════════════════════════════════════════════
 *  3. TOPLAM (FOOTER) ROW BUILDER
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a summary/footer <tr> for weekly tables.
 * @param {string}   firstCell   HTML for the first <td> (e.g. 'TOPLAM')
 * @param {number[]} vals        array of numeric weekly totals
 * @param {number}   avg         average value
 * @param {Function} fmt         formatter function (fTL or fK)
 * @returns {string} <tr> HTML string
 */
function tblTotalRow(firstCell, vals, avg, fmt) {
  const f = fmt || (v => v);
  const cells = vals.map(v =>
    `<td class="mono" style="font-weight:600;color:var(--c2)">${v > 0 ? f(v) : '—'}</td>`
  ).join('');
  const avgCell = avg > 0 ? f(avg) : '—';
  return `<tr class="toplam-row" style="border-top:2px solid var(--border);background:#F7F9FC">
    <td style="font-weight:700">${firstCell}</td>
    ${cells}
    <td class="mono" style="font-weight:700;color:var(--c1)">${avgCell}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
 *  4. URUN-COLOURED FIRST CELL
 * ══════════════════════════════════════════════════════════*/

/**
 * Build the first <td> of a product row with the product colour.
 * @param {string} urun  product name
 * @param {string} [minWidth]  e.g. '110px'
 * @returns {string} <td> HTML string
 */
function tblUrunCell(urun, minWidth) {
  const clr   = (typeof URUN_CLR !== 'undefined' && URUN_CLR[urun]) || 'var(--c1)';
  const mw    = minWidth ? `;min-width:${minWidth}` : '';
  return `<td style="font-weight:700;color:${clr}${mw}">${urun}</td>`;
}

/* ══════════════════════════════════════════════════════════
 *  5. GENEL RANKING TABLE RENDERER
 *     Reusable version of renderGenelTablo().
 *     Writes to #genelTbody.
 * ══════════════════════════════════════════════════════════*/

/**
 * Render the team ranking table.
 * @param {object[]} rows     sorted GENEL rows (GENEL TOPLAM, non-ŞENOL)
 * @param {object}   trSiraMap  { [ttt]: number }
 * @param {string}   [tbodyId='genelTbody']
 */
function renderTblEkipRanking(rows, trSiraMap, tbodyId) {
  const target = tbodyId || 'genelTbody';
  if (!rows || !rows.length) {
    _setHtml(target, typeof cardEmptyTableRow === 'function'
      ? cardEmptyTableRow('Veri bulunamadı', 9)
      : '<tr><td colspan="9" style="text-align:center;color:var(--dim)">Veri bulunamadı</td></tr>');
    return;
  }
  const map = trSiraMap || {};
  _setHtml(target, rows.map((r, i) => {
    const trSira = map[r.ttt] || 0;
    const trCol  = trSira <= 30 ? '#0BA87E' : trSira <= 60 ? '#D97706' : '#DC2626';
    const rankClass = i === 0 ? 'rk-1' : i === 1 ? 'rk-2' : i === 2 ? 'rk-3' : 'rk-n';
    const pp    = r.prim_pct || 0;
    const ppStyle = pp >= 91 ? 'background:#16A34A;color:#fff' : pp >= 70 ? 'background:#D97706;color:#fff' : '';
    const pctBdg = typeof cardPctBadge === 'function'
      ? cardPctBadge(r.tl_pct)
      : `<span class="bdg">${(r.tl_pct||0).toFixed(1)}%</span>`;
    const bar = typeof cardProgressBar === 'function'
      ? cardProgressBar(r.tl_pct, 80)
      : `<div class="prog" style="width:80px"><div style="width:${Math.min(r.tl_pct||0,100)}%"></div></div>`;
    return `<tr>
      <td><span class="rk ${rankClass}">${i + 1}</span></td>
      <td style="font-weight:600;cursor:pointer;color:var(--c1)" onclick="selectTTT('${r.ttt}')">${r.ttt}</td>
      <td class="mono">${fTL(r.hedef_tl)}</td>
      <td class="mono" style="font-weight:700">${fTL(r.satis_tl)}</td>
      <td class="mono ${r.kalan_tl < 0 ? 'negative' : 'positive'}">${fTL(r.kalan_tl)}</td>
      <td>${pctBdg}</td>
      <td><span class="bdg bdg-blue" style="${ppStyle}">${fPct(pp)}</span></td>
      <td>${bar}</td>
      <td style="color:${trCol};font-weight:700">${trSira ? '#' + trSira : '—'}</td>
    </tr>`;
  }).join(''));
}

/* ══════════════════════════════════════════════════════════
 *  6. URUN DETAIL TABLE ROW  (renderTTTDetail tbody rows)
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a single product-detail <tr> for the TTT detail table.
 * @param {object} r  GENEL row
 * @returns {string} <tr> HTML string
 */
function tblUrunDetailRow(r) {
  const clr = (typeof URUN_CLR !== 'undefined' && URUN_CLR[r.urun]) || 'var(--c1)';
  const pctBdg = typeof cardPctBadge === 'function'
    ? cardPctBadge(r.tl_pct)
    : `<span class="bdg">${(r.tl_pct||0).toFixed(1)}%</span>`;
  const bar = typeof cardProgressBar === 'function'
    ? cardProgressBar(r.tl_pct, 80, clr)
    : '';
  return `<tr>
    <td style="font-weight:700;color:${clr}">${r.urun}</td>
    <td class="mono">${fTL(r.hedef_tl)}</td>
    <td class="mono" style="font-weight:700">${fTL(r.satis_tl)}</td>
    <td class="mono ${r.kalan_tl < 0 ? 'negative' : 'positive'}">${fTL(r.kalan_tl)}</td>
    <td>${pctBdg}</td>
    <td>${bar}</td>
    <td class="mono">${fPct(r.prim_pct)}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
 *  7. WEEKLY TL / KUTU TABLE ROWS
 *     Shared row builder for renderWeeklyTable2.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a weekly value <tr>.
 * @param {string}   urun   product name
 * @param {number[]} vals   9 weekly values
 * @param {number}   avg    average (non-zero weeks)
 * @param {Function} fmt    fTL or fK
 * @returns {string} <tr> HTML string
 */
function tblWeeklyRow(urun, vals, avg, fmt) {
  const f   = fmt || (v => v);
  const clr = (typeof URUN_CLR !== 'undefined' && URUN_CLR[urun]) || 'var(--c1)';
  const cells = vals.map(v =>
    `<td class="mono" style="${v > 0 ? '' : 'color:#A0AEC0'}">${v > 0 ? f(v) : '—'}</td>`
  ).join('');
  const avgTxt = avg > 0 ? f(avg) : '—';
  return `<tr>
    <td style="font-weight:700;color:${clr}">${urun}</td>
    ${cells}
    <td class="mono" style="color:var(--c2);font-weight:700">${avgTxt}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
 *  8. KUTU TARGET TABLE ROW
 *     Reusable row for renderKutuTable.
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a kutu-target <tr>.
 * @param {object} r  GENEL row with hedef_kutu, cikan_kutu, hft_kutu, hft_tl, hedef_tl, satis_tl
 * @returns {string} <tr> HTML string
 */
function tblKutuRow(r) {
  const k70  = Math.max(0, r.hedef_kutu * 0.70 - r.cikan_kutu);
  const k91  = Math.max(0, r.hedef_kutu * 0.91 - r.cikan_kutu);
  const k100 = r.hedef_kutu - r.cikan_kutu;
  const k100Pos = k100 > 0;
  const k100TL  = Math.max(0, r.hedef_tl - r.satis_tl);
  const clr = (typeof URUN_CLR !== 'undefined' && URUN_CLR[r.urun]) || 'var(--c1)';

  const kCell = (val, exceeded) => exceeded
    ? `<td class="mono positive" style="color:#0BA87E;font-weight:700">✓ Geçildi</td>`
    : `<td class="mono negative">${fK(val)}</td>`;

  return `<tr>
    <td style="font-weight:700;color:${clr}">${r.urun}</td>
    <td class="mono">${fK(r.hedef_kutu)}</td>
    <td class="mono">${fK(r.cikan_kutu)}</td>
    ${kCell(k70, k70 <= 0)}
    ${kCell(k91, k91 <= 0)}
    ${kCell(Math.abs(k100), !k100Pos)}
    <td class="mono">${fK(r.hft_kutu)}</td>
    <td class="mono">${fTL(r.hft_tl)}</td>
    <td class="mono" style="color:var(--c2);font-weight:700">${fTL(k100TL)}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
 *  9. ECZANE TABLE HEADER UPDATER
 *     Updates the dynamic <thead> based on active months.
 * ══════════════════════════════════════════════════════════*/

const _ECZ_AY_SHORT = {
  '01/2026':'Oca','02/2026':'Şub','03/2026':'Mar','04/2026':'Nis',
  '05/2026':'May','06/2026':'Haz','07/2026':'Tem','08/2026':'Ağu',
  '09/2026':'Eyl','10/2026':'Eki','11/2026':'Kas','12/2026':'Ara'
};

/**
 * Rebuild the eczane table <thead> with dynamic month columns.
 * @param {string[]} aylar       sorted month keys e.g. ['01/2026', '02/2026']
 * @param {string}   [theadId='eczaneThead']
 */
function tblUpdateEczaneHeader(aylar, theadId) {
  const el = _el(theadId || 'eczaneThead');
  if (!el || !aylar || !aylar.length) return;
  el.innerHTML = `<th onclick="sortEczane('ad')" style="cursor:pointer">Eczane ▾</th>
    <th onclick="sortEczane('brick')" style="cursor:pointer">Brick ▾</th>
    ${aylar.map(a => `<th onclick="sortEczane('ay_${a}')" style="cursor:pointer">${_ECZ_AY_SHORT[a] || a} ▾</th>`).join('')}
    <th onclick="sortEczane('toplam')" style="cursor:pointer">Toplam ▾</th>
    <th onclick="sortEczane('tutar')" style="cursor:pointer">Tutar ▾</th>
    <th>Ürünler</th>`;
}

/* ══════════════════════════════════════════════════════════
 *  10. ECZANE TABLE ROW BUILDER
 * ══════════════════════════════════════════════════════════*/

/**
 * Build a single eczane <tr>.
 * @param {object}   e      eczane record
 * @param {string[]} aylar  sorted month keys
 * @param {string}   [sonAy] last month key
 * @returns {string} <tr> HTML string
 */
function tblEczaneRow(e, aylar, sonAy) {
  const last = sonAy || aylar[aylar.length - 1];
  const first = aylar[0];
  const ilkVal = e['ay_' + first] || 0;
  const sonVal  = e['ay_' + last]  || 0;

  const ayTds = aylar.map(a => {
    const v = e['ay_' + a] || 0;
    const isLast = (a === last);
    return `<td class="mono" style="${v > 0 ? (isLast ? 'font-weight:700' : '') : 'color:#A0AEC0'}">${v > 0 ? fK(v) : '—'}</td>`;
  }).join('');

  const badges = (e.uruns || []).map(u => typeof cardUrunBadge === 'function'
    ? cardUrunBadge(u)
    : `<span style="font-size:8px;font-weight:700">${u}</span>`
  ).join(' ');

  return `<tr>
    <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.ad}">${e.ad}</td>
    <td style="font-size:10px;color:var(--dim)">${e.brick}</td>
    ${ayTds}
    <td class="mono" style="font-weight:700;color:var(--c1)">${e.toplam > 0 ? fK(e.toplam) : '—'}</td>
    <td class="mono" style="font-size:10px">${e.tutar > 0 ? fTL(e.tutar) : '—'}</td>
    <td>${badges}</td>
  </tr>`;
}

/* ── EXPORTS ────────────────────────────────────────────────*/
Object.assign(window, {
  // Factory functions (return HTML strings)
  tblBuildHeader,
  tblWeeklyCols,
  tblTotalRow,
  tblUrunCell,
  tblUrunDetailRow,
  tblWeeklyRow,
  tblKutuRow,
  tblEczaneRow,
  tblUpdateEczaneHeader,
  // DOM-write wrappers
  renderTblEkipRanking,
});
