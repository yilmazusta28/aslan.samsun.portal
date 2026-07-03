/**
 * js/ui/drawer-system.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  Drawer open/close logic, overlay creation & cleanup,
 *  drawer animation helpers, active drawer tracking.
 *
 *  Extracted from: index.html lines ~3732-3760 plus
 *                  _buildEczaneDrawerRefresh (line ~3789)
 *  Dependencies: js/ui/ui-helpers.js, js/utils/audio-utils.js (SoundFX)
 *  Rollback:
 *    1. Remove <script src="js/ui/drawer-system.js"> from index.html.
 *    2. Un-comment the PHASE23-STUB block labeled DRAWER-SYSTEM in
 *       index.html (original code is preserved verbatim there).
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ── Active drawer tracking ─────────────────────────────────*/
let _activeMfDrawer = null;

/* ── Core: toggle ───────────────────────────────────────────
 *  Originally defined inline at index.html ~3735.
 *  Behavior preserved exactly:
 *    • If another drawer is open, close it first.
 *    • Toggle open/closed.
 *    • Play SoundFX.success() on open.
 *    • Show/hide the shared mfOverlay backdrop.
 */
function toggleMfDrawer(id) {
  // Close any other open drawer first
  if (_activeMfDrawer && _activeMfDrawer !== id) closeMfDrawer();

  const d  = uiById(id);
  const ov = uiById('mfOverlay');
  if (!d) return;

  const isOpen = d.classList.contains('open');
  if (isOpen) {
    // — close —
    d.classList.remove('open');
    if (ov) ov.classList.remove('show');
    _activeMfDrawer = null;
  } else {
    // — open —
    // SoundFX is defined in audio-utils.js; guard for safety
    if (typeof SoundFX !== 'undefined') SoundFX.success();
    d.classList.add('open');
    if (ov) ov.classList.add('show');
    _activeMfDrawer = id;
  }
}

/* ── Core: close ────────────────────────────────────────────
 *  Originally defined inline at index.html ~3753.
 *  Accepts optional id; falls back to _activeMfDrawer.
 */
function closeMfDrawer(id) {
  const target = id || _activeMfDrawer;
  if (target) {
    uiById(target)?.classList.remove('open');
    _activeMfDrawer = null;
  }
  uiById('mfOverlay')?.classList.remove('show');
}

/* ── Overlay lifecycle helpers ──────────────────────────────
 *  These wrap the shared backdrop so callers don't reference
 *  the DOM id directly.
 */

/**
 * Ensure the drawer overlay exists and is shown.
 * Creates it on-the-fly if it has been accidentally removed
 * (defensive: in normal operation it's always in the HTML).
 */
function drawerEnsureOverlay() {
  let ov = uiById('mfOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'drawer-overlay';
    ov.id        = 'mfOverlay';
    ov.onclick   = () => closeMfDrawer();
    document.body.appendChild(ov);
  }
  ov.classList.add('show');
}

/**
 * Immediately hide and stop all open drawers.
 * Called on page transitions to prevent stale overlays.
 */
function drawerCloseAll() {
  uiQueryAll('.filter-drawer.open').forEach(d => d.classList.remove('open'));
  uiById('mfOverlay')?.classList.remove('show');
  _activeMfDrawer = null;
}

/**
 * Returns the id of the currently open drawer, or null.
 * @returns {string|null}
 */
function drawerGetActive() {
  return _activeMfDrawer;
}

/**
 * Inject new HTML into a drawer by id, then optionally open it.
 * Provides a safe update pathway for drawer content builders
 * (_buildPazarDrawer, _buildMg1Drawer, etc.) — they call this
 * instead of setting innerHTML directly.
 *
 * @param {string}  drawerId  e.g. 'pazarDrawer'
 * @param {string}  html      new inner HTML for the drawer
 * @param {boolean} [open]    if true, also open the drawer
 */
function drawerSetContent(drawerId, html, open) {
  const d = uiById(drawerId);
  if (!d) return;
  d.innerHTML = html;
  if (open) toggleMfDrawer(drawerId);
}

/* ── Animation helpers ──────────────────────────────────────
 *  CSS handles the actual transition (transform + opacity),
 *  but these helpers let JS code hook into the animation
 *  lifecycle without coupling to CSS internals.
 */

/**
 * Returns true when the drawer's CSS transition is still running.
 * Useful to guard re-entrant open/close calls.
 * @param {string} id
 * @returns {boolean}
 */
function drawerIsAnimating(id) {
  const d = uiById(id);
  if (!d) return false;
  // getAnimations() not available in all target browsers, use flag approach
  return d.classList.contains('drawer-animating');
}

/**
 * Momentarily add 'drawer-animating' class during open/close.
 * Duration matches the CSS transition duration (280ms default).
 * @param {string} id
 * @param {number} [ms=280]
 */
function drawerMarkAnimating(id, ms) {
  const d = uiById(id);
  if (!d) return;
  d.classList.add('drawer-animating');
  setTimeout(() => d.classList.remove('drawer-animating'), ms || 280);
}

/* ── EXPORTS ────────────────────────────────────────────────*/
Object.assign(window, {
  _activeMfDrawer,          // legacy read access (some inline code reads it)
  toggleMfDrawer,
  closeMfDrawer,
  drawerEnsureOverlay,
  drawerCloseAll,
  drawerGetActive,
  drawerSetContent,
  drawerIsAnimating,
  drawerMarkAnimating,
});

// Keep _activeMfDrawer in sync when external code assigns it directly
// (compatibility shim for any inline code that does _activeMfDrawer = ...)
Object.defineProperty(window, '_activeMfDrawer', {
  get()  { return _activeMfDrawer; },
  set(v) { _activeMfDrawer = v; },
  configurable: true,
});
