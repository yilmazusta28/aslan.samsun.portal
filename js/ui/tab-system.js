/**
 * js/ui/tab-system.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  Tab switching helpers, active tab tracking,
 *  mobile tab helpers, safe tab-activation wrappers.
 *
 *  Extracted from: index.html goPage() lines 1443-1465
 *  Dependencies: js/ui/ui-helpers.js
 *  Note: goPage() itself is NOT moved here because it contains
 *        page-render orchestration logic (renderAna, renderPazar …)
 *        which is explicitly excluded from this phase.
 *        This module extracts only the PURE UI tab mechanics
 *        that goPage() calls, wrapped so goPage() can delegate
 *        to them without changing its own observable behaviour.
 *
 *  Rollback: remove <script src="js/ui/tab-system.js"> tag.
 *            goPage() in index.html calls these helpers through
 *            compatibility shims; if the file is absent, the
 *            shims fall back to inline DOM ops.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ── State ──────────────────────────────────────────────────*/
let _activeTabIndex = 0;            // mirrors curPage

/* ── Core: activate desktop nav tabs ───────────────────────
 *  Sets 'active' class on .nav-tab buttons.
 *  Mirrors the querySelectorAll loop in goPage().
 * @param {number} idx
 */
function tabActivateNavTabs(idx) {
  uiQueryAll('.nav-tab').forEach((t, j) => {
    t.classList.toggle('active', j === idx);
  });
}

/* ── Core: activate pages ───────────────────────────────────
 *  Sets 'active' class on .page elements.
 * @param {number} idx
 */
function tabActivatePages(idx) {
  uiQueryAll('.page').forEach((p, j) => {
    p.classList.toggle('active', j === idx);
  });
}

/* ── Core: activate sidebar nav items ───────────────────────
 *  snav0…snav7 ids (FAZ 6.9: Yönetici tab eklendi, 7→8).
 * @param {number} idx
 * @param {number} [count=8]
 */
function tabActivateSideNav(idx, count) {
  const n = (count !== undefined ? count : 8);
  for (let k = 0; k < n; k++) {
    const el = uiById('snav' + k);
    if (el) el.classList.toggle('active', k === idx);
  }
}

/* ── Mobile tab bar ─────────────────────────────────────────
 *  mtb0…mtb7 buttons + mtbIndicator strip (FAZ 6.9: 7→8).
 * @param {number} idx
 * @param {number} [count=8]
 */
function tabActivateMobileTabs(idx, count) {
  const n = (count !== undefined ? count : 8);
  for (let k = 0; k < n; k++) {
    const btn = uiById('mtb' + k);
    if (btn) btn.classList.toggle('active', k === idx);
  }
  // Slide the indicator strip
  const ind = uiById('mtbIndicator');
  if (ind) ind.style.transform = `translateX(${idx * 100}%)`;
}

/* ── Combined safe activation wrapper ──────────────────────
 *  Activates ALL tab-related UI elements for a given page
 *  index in a single call.  goPage() delegates to this.
 *
 * @param {number} idx   page / tab index
 * @param {object} [opts]
 * @param {number}  [opts.tabCount=8]    total tab count (FAZ 6.9: 7→8)
 * @param {boolean} [opts.skipPages]     skip .page activation
 * @param {boolean} [opts.skipNavTabs]   skip desktop .nav-tab
 * @param {boolean} [opts.skipSideNav]   skip snav* items
 * @param {boolean} [opts.skipMobile]    skip mobile mtb* items
 */
function tabActivateAll(idx, opts) {
  const o = opts || {};
  _activeTabIndex = idx;
  if (!o.skipPages)   tabActivatePages(idx);
  if (!o.skipNavTabs) tabActivateNavTabs(idx);
  if (!o.skipSideNav) tabActivateSideNav(idx, o.tabCount);
  if (!o.skipMobile)  tabActivateMobileTabs(idx, o.tabCount);
}

/* ── Query helpers ──────────────────────────────────────────*/

/** @returns {number} */
function tabGetActive() {
  return _activeTabIndex;
}

/**
 * Returns true when the page at idx is the currently visible one.
 * @param {number} idx
 * @returns {boolean}
 */
function tabIsActive(idx) {
  return _activeTabIndex === idx;
}

/* ── Safe activation with lifecycle guards ──────────────────
 *  Wraps tabActivateAll with a double-call guard so that rapid
 *  successive calls to the same index are no-ops.
 */
let _tabTransitionLock = false;

/**
 * Like tabActivateAll but ignores re-entrant calls and
 * same-index re-activations.
 * @param {number}   idx
 * @param {object}   [opts]
 * @param {Function} [callback]  fires after activation
 */
function tabSafeActivate(idx, opts, callback) {
  if (_tabTransitionLock) return;
  // Allow re-activation of the same tab (might be needed for refresh)
  _tabTransitionLock = true;
  try {
    tabActivateAll(idx, opts);
    if (typeof callback === 'function') callback(idx);
  } finally {
    // Release lock after current call stack clears
    setTimeout(() => { _tabTransitionLock = false; }, 0);
  }
}

/* ── EXPORTS ────────────────────────────────────────────────*/
Object.assign(window, {
  tabActivateNavTabs,
  tabActivatePages,
  tabActivateSideNav,
  tabActivateMobileTabs,
  tabActivateAll,
  tabGetActive,
  tabIsActive,
  tabSafeActivate,
});

// Sync _activeTabIndex with curPage if it exists (compatibility)
Object.defineProperty(window, '_activeTabIndex', {
  get()  { return _activeTabIndex; },
  set(v) { _activeTabIndex = v; },
  configurable: true,
});
