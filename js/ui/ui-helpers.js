/**
 * js/ui/ui-helpers.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  DOM utility helpers, safe query helpers, element cleanup,
 *  bindOnce helpers, overlay cleanup utilities.
 *
 *  Extracted from: index.html (inline <script>)
 *  Dependencies: none
 *  Consumed by: drawer-system.js, modal-system.js, tab-system.js,
 *               card-renderers.js, table-renderers.js, index.html
 *  Rollback: remove <script src="js/ui/ui-helpers.js"> tag;
 *            all these helpers are thin wrappers — callers
 *            (drawer / modal / tab systems) also fall back to
 *            direct DOM calls if the helpers are absent.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ── 1. SAFE DOM QUERY HELPERS ──────────────────────────────
 *  These never throw; they return null / [] when the element
 *  does not yet exist or has already been removed.
 */

/**
 * Safe getElementById wrapper.
 * @param  {string} id
 * @returns {Element|null}
 */
function uiById(id) {
  try { return document.getElementById(id) || null; }
  catch (e) { return null; }
}

/**
 * Safe querySelector wrapper.
 * @param  {string} selector
 * @param  {Element|Document} [ctx=document]
 * @returns {Element|null}
 */
function uiQuery(selector, ctx) {
  try { return (ctx || document).querySelector(selector) || null; }
  catch (e) { return null; }
}

/**
 * Safe querySelectorAll wrapper. Returns a real Array.
 * @param  {string} selector
 * @param  {Element|Document} [ctx=document]
 * @returns {Element[]}
 */
function uiQueryAll(selector, ctx) {
  try { return Array.from((ctx || document).querySelectorAll(selector)); }
  catch (e) { return []; }
}

/* ── 2. ELEMENT EXISTENCE & SAFETY ─────────────────────────*/

/**
 * Returns true when an element is still attached to the DOM.
 * @param  {Element|null} el
 * @returns {boolean}
 */
function uiExists(el) {
  return !!(el && el.isConnected !== false && document.contains(el));
}

/**
 * Safely set innerHTML — guards against null element.
 * @param {string} id
 * @param {string} html
 * @returns {boolean} true if element was found and updated
 */
function uiSetHtml(id, html) {
  const el = uiById(id);
  if (!el) return false;
  el.innerHTML = html;
  return true;
}

/**
 * Safely set textContent.
 * @param {string} id
 * @param {string} text
 * @returns {boolean}
 */
function uiSetText(id, text) {
  const el = uiById(id);
  if (!el) return false;
  el.textContent = text;
  return true;
}

/* ── 3. CSS CLASS HELPERS ───────────────────────────────────*/

/**
 * Toggle a class on an element found by id.
 * @param {string} id
 * @param {string} cls
 * @param {boolean|undefined} force
 */
function uiToggleClass(id, cls, force) {
  const el = uiById(id);
  if (!el) return;
  if (typeof force === 'boolean') el.classList.toggle(cls, force);
  else el.classList.toggle(cls);
}

/**
 * Add a class safely.
 */
function uiAddClass(id, cls) {
  uiById(id)?.classList.add(cls);
}

/**
 * Remove a class safely.
 */
function uiRemoveClass(id, cls) {
  uiById(id)?.classList.remove(cls);
}

/* ── 4. BIND-ONCE HELPERS ───────────────────────────────────
 *  Prevent duplicate event listeners on long-running pages.
 *  Usage:
 *    uiBindOnce(el, 'click', handler, 'myHandlerKey');
 */
const _uiBindRegistry = new WeakMap();

/**
 * Attach an event listener exactly once per (element, event, key) tuple.
 * If a listener with the same key is already registered it is replaced.
 *
 * @param {Element}  el
 * @param {string}   eventType  e.g. 'click'
 * @param {Function} handler
 * @param {string}   key        unique label for this listener
 */
function uiBindOnce(el, eventType, handler, key) {
  if (!el || typeof handler !== 'function') return;
  if (!_uiBindRegistry.has(el)) _uiBindRegistry.set(el, {});
  const reg = _uiBindRegistry.get(el);
  const regKey = eventType + ':' + key;
  if (reg[regKey]) {
    el.removeEventListener(eventType, reg[regKey]);
  }
  reg[regKey] = handler;
  el.addEventListener(eventType, handler);
}

/* ── 5. ELEMENT CLEANUP HELPERS ────────────────────────────*/

/**
 * Empty the innerHTML of an element by id, safely.
 * @param {string} id
 */
function uiClear(id) {
  const el = uiById(id);
  if (el) el.innerHTML = '';
}

/**
 * Remove an element from the DOM by id, safely.
 * @param {string} id
 */
function uiRemove(id) {
  uiById(id)?.remove();
}

/**
 * Remove all elements matching a CSS selector.
 * @param {string} selector
 * @param {Element|Document} [ctx=document]
 */
function uiRemoveAll(selector, ctx) {
  uiQueryAll(selector, ctx).forEach(el => el.remove());
}

/* ── 6. OVERLAY CLEANUP UTILITIES ──────────────────────────*/

/**
 * Show the shared mfOverlay backdrop.
 */
function uiShowOverlay() {
  uiById('mfOverlay')?.classList.add('show');
}

/**
 * Hide the shared mfOverlay backdrop.
 */
function uiHideOverlay() {
  uiById('mfOverlay')?.classList.remove('show');
}

/**
 * Remove ALL stale overlay / backdrop elements that might
 * have been orphaned by abrupt page transitions.
 * Clears: mfOverlay 'show' state, sideOverlay 'open' state,
 * and any dynamically-created .dynamic-overlay nodes.
 */
function uiCleanupAllOverlays() {
  // Filter drawer overlay
  uiById('mfOverlay')?.classList.remove('show');
  // Sidebar overlay
  uiById('sideOverlay')?.classList.remove('open');
  // Any dynamically-injected overlays (defensive)
  uiQueryAll('.dynamic-overlay').forEach(el => el.remove());
}

/* ── 7. DISPLAY TOGGLE HELPERS ─────────────────────────────*/

/**
 * Show an element (removes 'display:none').
 * @param {string|Element} idOrEl
 */
function uiShow(idOrEl) {
  const el = typeof idOrEl === 'string' ? uiById(idOrEl) : idOrEl;
  if (el) el.style.display = '';
}

/**
 * Hide an element (sets display:none).
 * @param {string|Element} idOrEl
 */
function uiHide(idOrEl) {
  const el = typeof idOrEl === 'string' ? uiById(idOrEl) : idOrEl;
  if (el) el.style.display = 'none';
}

/**
 * Toggle display between '' and 'none'.
 * @param {string} id
 * @param {string} [visibleDisplay='block']
 * @returns {boolean} true = now visible
 */
function uiToggleDisplay(id, visibleDisplay) {
  const el = uiById(id);
  if (!el) return false;
  const hidden = el.style.display === 'none' || el.style.display === '';
  el.style.display = hidden ? (visibleDisplay || 'block') : 'none';
  return hidden;
}

/* ── 8. SCROLL HELPERS ──────────────────────────────────────*/

/**
 * Scroll to the top of an element by id.
 * @param {string} id
 */
function uiScrollTop(id) {
  const el = uiById(id);
  if (el) el.scrollTop = 0;
}

/* ── EXPORTS ────────────────────────────────────────────────
 *  All functions are attached to window so any inline script
 *  in index.html can call them without module syntax.
 */
Object.assign(window, {
  uiById,
  uiQuery,
  uiQueryAll,
  uiExists,
  uiSetHtml,
  uiSetText,
  uiToggleClass,
  uiAddClass,
  uiRemoveClass,
  uiBindOnce,
  uiClear,
  uiRemove,
  uiRemoveAll,
  uiShowOverlay,
  uiHideOverlay,
  uiCleanupAllOverlays,
  uiShow,
  uiHide,
  uiToggleDisplay,
  uiScrollTop,
});
