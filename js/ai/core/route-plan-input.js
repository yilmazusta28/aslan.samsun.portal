// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/route-plan-input.js
//  FAZ 10.2 — Haftalık Rota Planı (Manuel Giriş)
//
//  Sorumluluk: Temsilcinin haftalık brick planını KENDİSİNİN girdiği
//  (AI-hesaplı rota DEĞİL) veri modelini ve UI yardımcılarını yönetir.
//
//  MİMARİ KARAR:
//    Mevcut `route-optimizer.js::buildWeeklyRoutes()` (AI önerisi)
//    SİLİNMEDİ/DEĞİŞTİRİLMEDİ — "AI önerisi" kartı olarak kalmaya
//    devam eder. Bu modül AYRIYDI; birbirini ezmezler.
//    Öncelik kuralı (FAZ 10.3 buildTodayRoute'da uygulanır):
//      Manuel plan VARSA → önce o okunur
//      Manuel plan YOKSA → buildWeeklyRoutes() fallback
//
//  Depolama: IndexedDB → pharma-db.js (PharmaDB paylaşımlı DB v2)
//    Store: route_plans
//    Model: {
//      id: representative+'|'+weekday,  // composite key
//      representative: string,          // ttt kodu
//      weekday: 1|2|3|4|5,             // 1=Pazartesi ... 5=Cuma
//      bricks: string[],               // seçili brick adları listesi
//      updatedAt: ISO string
//    }
//
//  Public API:
//    setDayPlan(weekday, bricks, representative?)  → Promise<void>
//    getDayPlan(weekday, representative?)           → Promise<RoutePlan|null>
//    getWeekPlan(representative?)                   → Promise<RoutePlan[]>
//    getTodayPlan(representative?)                  → Promise<RoutePlan|null>
//    clearWeekPlan(representative?)                 → Promise<void>
//
//  UI Yardımcıları:
//    renderRoutePlanForm(containerId, options?)
//      → Pazartesi-Cuma grid + brick seçim checkboxları, kaydet butonu
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._ROUTE_PLAN_INPUT_LOADED) {
    console.warn('[route-plan-input] Zaten yüklü — atlandı');
    return;
  }
  window._ROUTE_PLAN_INPUT_LOADED = true;

  var STORE = 'route_plans';
  var WEEKDAY_NAMES = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

  var _fallback = {}; // id → RoutePlan (PharmaDB yoksa)

  // Sync cache: route-optimizer.js gibi senkron tüketiciler için
  // setDayPlan çağrıldığında güncellenir, getWeekPlanSync() ile okunur.
  var _syncCache = {}; // rep → { weekday → bricks[] }

  function _currentRep() {
    try { return window.engineSelTTT || window.selTTT || null; } catch (e) { return null; }
  }

  function _makeId(rep, weekday) {
    return (rep || 'default') + '|' + weekday;
  }

  // Bugünün ISO weekday'i (1=Pzt...5=Cum, 0=Cts/Paz → 5)
  function _todayWeekday() {
    var d = new Date().getDay(); // 0=Sun...6=Sat
    if (d === 0 || d === 6) return 5; // hafta sonu → Cuma fallback
    return d; // 1-5
  }

  // ── setDayPlan ────────────────────────────────────────────────────────
  function setDayPlan(weekday, bricks, representative) {
    var rep = representative || _currentRep();
    var plan = {
      id:             _makeId(rep, weekday),
      representative: rep,
      weekday:        weekday,
      bricks:         bricks || [],
      updatedAt:      new Date().toISOString()
    };

    // Sync cache'i güncelle
    if (!_syncCache[rep]) _syncCache[rep] = {};
    _syncCache[rep][weekday] = bricks || [];

    if (!window.PharmaDB) {
      _fallback[plan.id] = plan;
      return Promise.resolve();
    }

    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) { _fallback[plan.id] = plan; return Promise.resolve(); }
      return new Promise(function (resolve, reject) {
        var req = store.put(plan);
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getDayPlan ────────────────────────────────────────────────────────
  function getDayPlan(weekday, representative) {
    var rep = representative || _currentRep();
    var id = _makeId(rep, weekday);

    if (!window.PharmaDB) return Promise.resolve(_fallback[id] || null);

    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve(_fallback[id] || null);
      return new Promise(function (resolve, reject) {
        var req = store.get(id);
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getWeekPlan — tüm haftanın planı ─────────────────────────────────
  function getWeekPlan(representative) {
    var rep = representative || _currentRep();
    if (!window.PharmaDB) {
      return Promise.resolve(
        Object.values(_fallback).filter(function (p) { return p.representative === rep; })
      );
    }
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) {
        return Promise.resolve(
          Object.values(_fallback).filter(function (p) { return p.representative === rep; })
        );
      }
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('representative');
        var req = idx.openCursor(IDBKeyRange.only(rep));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else resolve(results);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getTodayPlan — bugünkü plan ───────────────────────────────────────
  function getTodayPlan(representative) {
    return getDayPlan(_todayWeekday(), representative);
  }

  // ── getTodayPlanSync — SENKRON erişim (route-optimizer.js için) ───────
  // Sadece sync cache'den okur (setDayPlan sonrası doldurulmuş olmalı).
  // IndexedDB'yi DEĞİL, sadece bellek-içi cache'i okur.
  function getTodayPlanSync(representative) {
    var rep = representative || _currentRep();
    var wd = _todayWeekday();
    if (_syncCache[rep] && _syncCache[rep][wd]) {
      return { representative: rep, weekday: wd, bricks: _syncCache[rep][wd] };
    }
    // fallback'ten de bak
    var id = _makeId(rep, wd);
    return _fallback[id] || null;
  }

  // ── clearWeekPlan — haftanın planını sil ──────────────────────────────
  function clearWeekPlan(representative) {
    var rep = representative || _currentRep();
    if (!window.PharmaDB) {
      Object.keys(_fallback).forEach(function (k) {
        if (_fallback[k].representative === rep) delete _fallback[k];
      });
      return Promise.resolve();
    }
    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) { return Promise.resolve(); }
      return new Promise(function (resolve, reject) {
        var idx = store.index('representative');
        var req = idx.openKeyCursor(IDBKeyRange.only(rep));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
          else resolve();
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── renderRoutePlanForm — UI yardımcısı ──────────────────────────────
  // containerId: DOM element id'si
  // options: { representative?, onSave? }
  function renderRoutePlanForm(containerId, options) {
    var container = document.getElementById(containerId);
    if (!container) return;
    options = options || {};
    var rep = options.representative || _currentRep();

    // Brick listesini al (mevcut global'den)
    var brickList = [];
    try {
      if (window.IMS && Array.isArray(window.IMS)) {
        window.IMS.forEach(function (r) {
          if (r.brick && brickList.indexOf(r.brick) < 0) brickList.push(r.brick);
        });
      }
    } catch (e) {}
    brickList.sort();

    // Haftalık planı yükle ve formu göster
    getWeekPlan(rep).then(function (weekPlans) {
      var planByDay = {};
      weekPlans.forEach(function (p) { planByDay[p.weekday] = p.bricks || []; });

      var html = '<div class="route-plan-form" style="font-size:13px;">';
      html += '<div style="font-weight:600;margin-bottom:8px;">Haftalık Rota Planı</div>';

      if (!brickList.length) {
        html += '<div style="color:#888;font-size:12px;">Brick verisi yüklenemedi. Önce IMS verisini yükleyin.</div>';
      } else {
        for (var d = 1; d <= 5; d++) {
          var dayBricks = planByDay[d] || [];
          html += '<div style="margin-bottom:8px;">';
          html += '<div style="font-weight:500;margin-bottom:4px;">' + WEEKDAY_NAMES[d] + '</div>';
          html += '<div class="route-bricks-day" data-day="' + d + '" style="display:flex;flex-wrap:wrap;gap:4px;">';
          brickList.forEach(function (brick) {
            var checked = dayBricks.indexOf(brick) >= 0 ? 'checked' : '';
            html += '<label style="font-size:11px;display:flex;align-items:center;gap:3px;padding:2px 6px;background:#f5f5f5;border-radius:4px;cursor:pointer;">';
            html += '<input type="checkbox" value="' + brick + '" ' + checked + ' style="margin:0;"> ' + brick;
            html += '</label>';
          });
          html += '</div></div>';
        }
        html += '<button id="routePlanSaveBtn" style="margin-top:8px;padding:6px 16px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Kaydet</button>';
        html += ' <button id="routePlanClearBtn" style="margin-top:8px;padding:6px 16px;background:#f44336;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Temizle</button>';
      }
      html += '</div>';
      container.innerHTML = html;

      // Save handler
      var saveBtn = document.getElementById('routePlanSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var promises = [];
          for (var d2 = 1; d2 <= 5; d2++) {
            var dayEl = container.querySelector('[data-day="' + d2 + '"]');
            if (!dayEl) continue;
            var checked2 = Array.from(dayEl.querySelectorAll('input:checked')).map(function (cb) { return cb.value; });
            promises.push(setDayPlan(d2, checked2, rep));
          }
          Promise.all(promises).then(function () {
            saveBtn.textContent = 'Kaydedildi ✓';
            setTimeout(function () { saveBtn.textContent = 'Kaydet'; }, 2000);
            if (typeof options.onSave === 'function') options.onSave();
          }).catch(function (e) {
            console.warn('[route-plan-input] Kayıt hatası:', e);
          });
        });
      }

      // Clear handler
      var clearBtn = document.getElementById('routePlanClearBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          clearWeekPlan(rep).then(function () { renderRoutePlanForm(containerId, options); });
        });
      }
    });
  }

  window.RoutePlanInput = {
    setDayPlan:          setDayPlan,
    getDayPlan:          getDayPlan,
    getWeekPlan:         getWeekPlan,
    getTodayPlan:        getTodayPlan,
    getTodayPlanSync:    getTodayPlanSync,
    clearWeekPlan:       clearWeekPlan,
    renderRoutePlanForm: renderRoutePlanForm,
    version:             '10.2'
  };

  console.debug('[route-plan-input] FAZ 10.2 yüklendi.');

})();
