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
//    fetchTeamPlans()                               → Promise<{TTT:{gün:bricks[]}}|null>
//
//  FAZ 14.0 — Worker Senkronu (opsiyonel, worker.js kaynağına göre):
//    window.ROTA_SYNC_WORKER_URL tanımlıysa, setDayPlan() sonrası SADECE
//    değişen gün { representative, weekday, bricks } formatında worker'a
//    POST edilir (fire-and-forget) — worker.js GET desteklemediği ve
//    sadece tek-gün body kabul ettiği için "tüm hafta" gönderilmez.
//    Worker bunu GitHub'daki data/rota_planlari.json'a yazar. fetchTeamPlans()
//    ise o dosyayı raw.githubusercontent.com üzerinden DOĞRUDAN okur (worker
//    üzerinden değil) — manager-panel-engine.js bunu ekip-geneli (çoklu
//    cihaz) görünüm için kullanır, okuma başarısızsa sessizce yerel
//    IndexedDB'ye (per-rep) döner.
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

  // ── FAZ 14.0 — Worker Senkronu (DÜZELTME: worker.js kaynağına göre) ────
  // worker.js'in /rota-sync endpoint'i SADECE POST kabul ediyor ve body'de
  // TEK GÜN bekliyor: { representative, weekday, bricks } — "tüm hafta"
  // gönderimi worker'ın `representative, weekday, bricks zorunlu` doğrulamasını
  // geçemez. Worker'da GET handler'ı da YOK (405 döner) — bu yüzden ekip
  // verisi worker'dan değil, worker'ın GitHub'a yazdığı dosyadan doğrudan
  // (raw.githubusercontent.com) okunuyor (bkz. fetchTeamPlans).
  // window.ROTA_SYNC_WORKER_URL tanımlıysa, her setDayPlan() sonrası SADECE
  // o gün worker'a POST edilir (fire-and-forget): ağ hatası/timeout olsa da
  // setDayPlan'in kendi Promise'ini REDDETMEZ — sadece console.warn ile
  // sessizce loglanır, IndexedDB'ye yazım (asıl kayıt) her zaman kesin kalır.
  function _syncDayToWorker(rep, weekday, bricks) {
    if (!window.ROTA_SYNC_WORKER_URL || !rep) return;
    var payload = { representative: rep, weekday: weekday, bricks: bricks || [] };
    fetch(window.ROTA_SYNC_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    }).then(function (res) {
      if (res && !res.ok) {
        console.warn('[route-plan-input] worker senkron HTTP hatası:', res.status);
      }
    }).catch(function (e) {
      console.warn('[route-plan-input] worker senkron hatası (yoksayıldı, yerel kayıt geçerli):', e && e.message);
    });
  }

  // ── fetchTeamPlans — GitHub'daki data/rota_planlari.json'ı doğrudan oku ─
  // worker.js'te /rota-sync GET desteklemediği için (405), ekip-geneli veri
  // worker'ın YAZDIĞI dosyadan raw.githubusercontent.com üzerinden okunur
  // (worker.js içindeki OWNER/REPO/BRANCH/PATH sabitleriyle birebir aynı).
  // Dönen format: { "TTT_KODU": { "1": ["brick",...], "2": [...] }, ... }
  // Ağ hatası/404'te null döner — çağıran (manager-panel-engine.js) bu
  // durumda yerel IndexedDB'ye (per-rep) fallback yapar.
  var _ROTA_RAW_URL = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/data/rota_planlari.json';
  function fetchTeamPlans() {
    return fetch(_ROTA_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { return (data && data.plans) ? data.plans : null; })
      .catch(function (e) {
        console.warn('[route-plan-input] GitHub\'dan ekip planı okunamadı (yerel fallback kullanılacak):', e && e.message);
        return null;
      });
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

    var writePromise;
    if (!window.PharmaDB) {
      _fallback[plan.id] = plan;
      writePromise = Promise.resolve();
    } else {
      writePromise = window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
        if (!store) { _fallback[plan.id] = plan; return Promise.resolve(); }
        return new Promise(function (resolve, reject) {
          var req = store.put(plan);
          req.onsuccess = function () { resolve(); };
          req.onerror   = function (e) { reject(e.target.error); };
        });
      });
    }

    // IndexedDB yazımı KESİNLEŞTİKTEN sonra worker'a gönder — worker sadece
    // TEK GÜN kabul ediyor (representative, weekday, bricks), bu yüzden
    // tüm haftayı yeniden okumaya gerek yok, elimizdeki weekday/bricks
    // doğrudan gönderilir. Çağırana dönen Promise'i bekletmez/etkilemez.
    writePromise.then(function () { _syncDayToWorker(rep, weekday, bricks); }).catch(function () {});

    return writePromise;
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
  // Sadece sync cache'den okur (setDayPlan sonrası veya _hydrateSyncCache()
  // sonrası doldurulmuş olmalı).
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

  // ── getWeekPlanSync — SENKRON haftalık erişim (route-optimizer.js için) ─
  // BUG DÜZELTMESİ: buildWeeklyRoutes() (route-optimizer.js) temsilcinin
  // manuel haftalık planını hiç okumuyordu — bu fonksiyon o bağlantıyı
  // kurmak için eklendi. { 1: [...bricks], 2: [...], ... 5: [...] } döner,
  // hiç plan yoksa null.
  function getWeekPlanSync(representative) {
    var rep = representative || _currentRep();
    var out = null;
    for (var wd = 1; wd <= 5; wd++) {
      var bricks = (_syncCache[rep] && _syncCache[rep][wd]) ? _syncCache[rep][wd] : null;
      if (!bricks) {
        var id = _makeId(rep, wd);
        if (_fallback[id] && _fallback[id].bricks) bricks = _fallback[id].bricks;
      }
      if (bricks && bricks.length) {
        if (!out) out = {};
        out[wd] = bricks;
      }
    }
    return out;
  }

  // ── _hydrateSyncCache — IndexedDB'deki mevcut planları bellek-içi
  // sync cache'e yükler ────────────────────────────────────────────────
  // BUG DÜZELTMESİ: _syncCache SADECE setDayPlan() çağrıldığında
  // dolduruluyordu (aynı oturumda kaydedildiyse). Sayfa yeniden
  // yüklendiğinde (yeni oturum) IndexedDB'de kayıtlı plan hâlâ dursa
  // bile _syncCache boş kalıyor, bu yüzden getTodayPlanSync/
  // getWeekPlanSync hep null dönüyor ve temsilcinin daha önce girip
  // KAYDETTİĞİ plan sanki hiç girilmemiş gibi yok sayılıyordu (hem
  // günlük hem haftalık rota AI'nın salt algoritmik önerisine dönüyordu).
  // Modül yüklenir yüklenmez TÜM route_plans store'unu okuyup cache'i
  // ısıtıyoruz (representative bazında ayrım index gerekmeden cursor'la).
  function _hydrateSyncCache() {
    if (!window.PharmaDB) return;
    window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve();
      return new Promise(function (resolve) {
        var req = store.openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) {
            var plan = cursor.value;
            if (plan && plan.representative && plan.weekday) {
              if (!_syncCache[plan.representative]) _syncCache[plan.representative] = {};
              _syncCache[plan.representative][plan.weekday] = plan.bricks || [];
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = function () { resolve(); };
      });
    }).catch(function (e) {
      console.warn('[route-plan-input] sync cache ısıtma hatası:', e && e.message);
    });
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
    // BUG DÜZELTMESİ: IMS, data-state.js'de `let IMS = []` ile classic
    // script top-level scope'unda tanımlı — `window.IMS` DEĞİL (let/const
    // window nesnesine yazılmaz). Diğer motorlar (route-optimizer.js,
    // brick-ranking-engine.js vb.) bu yüzden hep bare `IMS` okur; burada da
    // aynı desen kullanılmalı, yoksa brick listesi IMS yüklü olsa bile hep
    // boş kalır ve "Brick verisi yüklenemedi" hatası kalıcı olarak görünür.
    var brickList = [];
    var _imsAvailable = (typeof IMS !== 'undefined') && Array.isArray(IMS);
    var _imsLen = _imsAvailable ? IMS.length : -1;
    try {
      if (_imsAvailable) {
        // 1. geçiş: sadece bu temsilcinin KENDİ (pazar/rakip değil) brickleri
        IMS.forEach(function (r) {
          if (r.is_mkt) return;
          if (rep && r.ttt && r.ttt !== rep) return;
          if (r.brick && brickList.indexOf(r.brick) < 0) brickList.push(r.brick);
        });
        // Rep filtresiyle hiçbir şey bulunamadıysa (örn. rep adı IMS'teki
        // normalize edilmiş isimle birebir eşleşmiyor) — en azından TÜM
        // (pazar hariç) brickleri göster; hiç göstermemekten iyidir.
        if (!brickList.length && rep) {
          IMS.forEach(function (r) {
            if (r.is_mkt) return;
            if (r.brick && brickList.indexOf(r.brick) < 0) brickList.push(r.brick);
          });
        }
      }
    } catch (e) {
      console.warn('[route-plan-input] brick listesi okuma hatası:', e.message);
    }
    brickList.sort();

    if (!brickList.length) {
      console.warn('[route-plan-input] Brick listesi boş — teşhis:',
        'IMS tanımlı mı?', _imsAvailable, '| IMS uzunluğu:', _imsLen,
        '| rep:', rep, '| örnek IMS satırı:', _imsAvailable && IMS[0] ? IMS[0] : 'yok');
    }

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
    getWeekPlanSync:     getWeekPlanSync,
    getTodayPlan:        getTodayPlan,
    getTodayPlanSync:    getTodayPlanSync,
    clearWeekPlan:       clearWeekPlan,
    renderRoutePlanForm: renderRoutePlanForm,
    fetchTeamPlans:      fetchTeamPlans,
    version:             '14.0'
  };

  // BUG DÜZELTMESİ: bkz. _hydrateSyncCache() yorumu — sayfa açılışında
  // IndexedDB'deki mevcut planları senkron cache'e yükle. PharmaDB henüz
  // hazır olmayabilir; withStore kendi içinde open() bekliyor, o yüzden
  // burada ekstra bir gecikmeye gerek yok.
  _hydrateSyncCache();

  console.debug('[route-plan-input] FAZ 14.0 yüklendi (worker senkron: ' + (window.ROTA_SYNC_WORKER_URL ? 'aktif' : 'pasif') + ').');

})();
