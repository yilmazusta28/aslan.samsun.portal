// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/coverage-selection.js
//  FAZ 9.2 — Coverage Selection Sistemi
//
//  Sorumluluk: Temsilcinin hangi eczaneleri ziyaret listesine aldığını
//  takip eder. Brick-seviyesi coverage-engine.js (FAZ 3.3) DEĞİŞTİRMEZ
//  — ayrı granülerlik, ayrı dosya.
//
//  Depolama: IndexedDB → pharma-db.js (PharmaDB paylaşımlı DB)
//    Store: coverage_selections
//    Model: { pharmacy, representative, selectedForVisit, selectedDate, updatedAt }
//
//  Public API:
//    setSelection(pharmacy, selected, representative?)  → Promise<void>
//    getSelection(pharmacy)                             → Promise<{selectedForVisit, ...}|null>
//    listSelected(representative)                       → Promise<Selection[]>
//    listUnselectedHighPotential(representative)        → Promise<HighPotential[]>
//
//  listUnselectedHighPotential: seçilmemiş ama yüksek potansiyelli
//  eczaneler (PharmacyRanking / BehaviorEngine'den opportunityScore).
//  Tabloda farklı renk + "Ziyaret planına eklenmesi önerilir." uyarısı
//  bu fonksiyonun dönüşünü kullanır (UI: FAZ 9.2 eczane tablosu).
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._COVERAGE_SELECTION_LOADED) {
    console.warn('[coverage-selection] Zaten yüklü — atlandı');
    return;
  }
  window._COVERAGE_SELECTION_LOADED = true;

  var STORE = 'coverage_selections';

  // ── _currentRep — aktif temsilci ─────────────────────────────────────
  function _currentRep() {
    try { return window.engineSelTTT || window.selTTT || null; } catch (e) { return null; }
  }

  // ── Bellek-içi fallback (PharmaDB yoksa) ─────────────────────────────
  var _fallback = {};

  function _withDB(fn) {
    if (!window.PharmaDB) {
      return Promise.resolve(fn(null));
    }
    return window.PharmaDB.withStore(STORE, 'readwrite', function (store, fb) {
      if (!store) return fn(null);
      return fn(store);
    });
  }

  // ── setSelection ───────────────────────────────────────────────────────
  function setSelection(pharmacy, selected, representative) {
    var rep = representative || _currentRep();
    var record = {
      pharmacy:        pharmacy,
      representative:  rep,
      selectedForVisit: !!selected,
      selectedDate:    selected ? new Date().toISOString() : null,
      updatedAt:       new Date().toISOString()
    };

    if (!window.PharmaDB) {
      _fallback[pharmacy] = record;
      return Promise.resolve();
    }

    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) { _fallback[pharmacy] = record; return Promise.resolve(); }
      return new Promise(function (resolve, reject) {
        var req = store.put(record);
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getSelection ──────────────────────────────────────────────────────
  function getSelection(pharmacy) {
    if (!window.PharmaDB) {
      return Promise.resolve(_fallback[pharmacy] || null);
    }
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve(_fallback[pharmacy] || null);
      return new Promise(function (resolve, reject) {
        var req = store.get(pharmacy);
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── listSelected ──────────────────────────────────────────────────────
  function listSelected(representative) {
    var rep = representative || _currentRep();
    if (!window.PharmaDB) {
      return Promise.resolve(
        Object.values(_fallback).filter(function (r) { return r.selectedForVisit && (!rep || r.representative === rep); })
      );
    }
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) {
        return Promise.resolve(Object.values(_fallback).filter(function (r) {
          return r.selectedForVisit && (!rep || r.representative === rep);
        }));
      }
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('representative');
        var req = rep ? idx.openCursor(IDBKeyRange.only(rep)) : store.openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) {
            if (cursor.value.selectedForVisit) results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── listUnselectedHighPotential ────────────────────────────────────────
  // Seçilmemiş ama PharmacyRanking'e göre yüksek potansiyelli eczaneler.
  // "Ziyaret planına eklenmesi önerilir." uyarısı için kullanılır.
  function listUnselectedHighPotential(representative) {
    var rep = representative || _currentRep();
    return listSelected(rep).then(function (selected) {
      var selectedKeys = {};
      selected.forEach(function (s) { selectedKeys[s.pharmacy] = true; });

      // Tüm yüksek potansiyelli eczaneleri al
      var allRanked = [];
      if (window.PharmacyRanking && typeof window.PharmacyRanking.rankPharmacies === 'function') {
        allRanked = window.PharmacyRanking.rankPharmacies(rep) || [];
      } else if (window.PharmacyBehaviorEngine && typeof window.PharmacyBehaviorEngine.buildBehaviorProfiles === 'function') {
        var profiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(rep);
        allRanked = profiles.map(function (p) {
          return { eczane: p.eczane, gln: p.gln, brick: p.brick, canonicalScore: p.score || 0 };
        });
      }

      // Seçilmemiş + yüksek skor (üst %30 veya >60 puan)
      var threshold = 60;
      return allRanked
        .filter(function (r) {
          var key = r.eczane || r.gln || '';
          return !selectedKeys[key] && (r.canonicalScore || 0) >= threshold;
        })
        .map(function (r) {
          return Object.assign({}, r, {
            recommendation: 'Ziyaret planına eklenmesi önerilir.',
            reason: 'Yüksek potansiyel (skor: ' + (r.canonicalScore || 0) + ')'
          });
        });
    });
  }

  window.CoverageSelection = {
    setSelection:               setSelection,
    getSelection:               getSelection,
    listSelected:               listSelected,
    listUnselectedHighPotential: listUnselectedHighPotential,
    version: '9.2'
  };

  console.debug('[coverage-selection] FAZ 9.2 yüklendi.');

})();
