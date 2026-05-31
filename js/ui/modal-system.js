/**
 * js/ui/modal-system.js
 * ═══════════════════════════════════════════════════════════
 *  PHASE23 — UI Component Extraction
 *  Modal open/close helpers, orphan-modal prevention,
 *  backdrop handling, lifecycle-safe cleanup.
 *
 *  Status: The current codebase uses NO <dialog>/overlay modal
 *  pattern — only the filter-drawer system is present.
 *  This module provides the reusable modal infrastructure
 *  so future pages can adopt it without ad-hoc patterns.
 *
 *  Dependencies: js/ui/ui-helpers.js
 *  Rollback: remove <script src="js/ui/modal-system.js"> tag.
 *            No existing index.html code calls these functions
 *            yet — zero regression risk.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ── State ──────────────────────────────────────────────────*/
const _openModals = new Set();            // ids of currently open modals
let   _modalBackdrop = null;              // shared backdrop element

/* ── Backdrop management ────────────────────────────────────*/

function _ensureModalBackdrop() {
  if (_modalBackdrop && document.contains(_modalBackdrop)) return _modalBackdrop;
  // Look for an existing backdrop first
  _modalBackdrop = uiQuery('.modal-backdrop');
  if (_modalBackdrop) return _modalBackdrop;
  // Create one dynamically
  _modalBackdrop = document.createElement('div');
  _modalBackdrop.className = 'modal-backdrop';
  _modalBackdrop.setAttribute('data-ui-modal-backdrop', '1');
  _modalBackdrop.onclick = () => modalCloseTop();
  document.body.appendChild(_modalBackdrop);
  return _modalBackdrop;
}

function _updateBackdropVisibility() {
  if (_openModals.size > 0) {
    _ensureModalBackdrop().classList.add('show');
  } else {
    _modalBackdrop?.classList.remove('show');
  }
}

/* ── Orphan prevention ──────────────────────────────────────
 *  Scans the DOM for any modal elements that have the 'open'
 *  or 'active' class but are NOT tracked in _openModals and
 *  closes them. Run on page-transition and initApp.
 */
function modalCleanupOrphans() {
  uiQueryAll('.modal.open, .modal.active, .ui-modal.open').forEach(el => {
    if (el.id && !_openModals.has(el.id)) {
      el.classList.remove('open', 'active');
    }
  });
  _updateBackdropVisibility();
}

/* ── Open ───────────────────────────────────────────────────*/

/**
 * Open a modal by element id.
 * Adds 'open' class; shows backdrop; tracks the modal.
 * @param {string}   id
 * @param {Function} [onClose]  optional callback when modal is closed
 */
function modalOpen(id, onClose) {
  const el = uiById(id);
  if (!el) return;
  // Prevent duplicate opens
  if (_openModals.has(id)) return;

  el.classList.add('open');
  _openModals.add(id);

  // Store optional close callback
  if (typeof onClose === 'function') {
    el.dataset._uiModalOnClose = '__cb__';
    el._uiModalOnClose = onClose;
  }

  _updateBackdropVisibility();
}

/* ── Close ──────────────────────────────────────────────────*/

/**
 * Close a modal by id.
 * @param {string} id
 */
function modalClose(id) {
  const el = uiById(id);
  if (el) {
    el.classList.remove('open', 'active');
    // Fire optional callback
    if (typeof el._uiModalOnClose === 'function') {
      try { el._uiModalOnClose(); } catch (e) { /* swallow */ }
      el._uiModalOnClose = null;
    }
  }
  _openModals.delete(id);
  _updateBackdropVisibility();
}

/**
 * Close the topmost (most-recently-opened) modal.
 */
function modalCloseTop() {
  if (_openModals.size === 0) return;
  const last = [..._openModals].at(-1);
  if (last) modalClose(last);
}

/**
 * Close ALL open modals.
 */
function modalCloseAll() {
  [..._openModals].forEach(id => modalClose(id));
  // Belt-and-suspenders: also remove open class from any stragglers
  uiQueryAll('.modal.open, .ui-modal.open').forEach(el => {
    el.classList.remove('open', 'active');
  });
  _openModals.clear();
  _modalBackdrop?.classList.remove('show');
}

/* ── Query helpers ──────────────────────────────────────────*/

/** @returns {boolean} */
function modalIsOpen(id) {
  return _openModals.has(id);
}

/** @returns {string[]} ids of all open modals */
function modalGetOpen() {
  return [..._openModals];
}

/* ── Lifecycle-safe cleanup ─────────────────────────────────
 *  Call on page navigation / app re-init to ensure no stale
 *  modals remain visible.
 */
function modalFullReset() {
  modalCloseAll();
  modalCleanupOrphans();
  if (_modalBackdrop && document.contains(_modalBackdrop)) {
    _modalBackdrop.remove();
    _modalBackdrop = null;
  }
}

/* ── EXPORTS ────────────────────────────────────────────────*/
Object.assign(window, {
  modalOpen,
  modalClose,
  modalCloseTop,
  modalCloseAll,
  modalCleanupOrphans,
  modalIsOpen,
  modalGetOpen,
  modalFullReset,
});
