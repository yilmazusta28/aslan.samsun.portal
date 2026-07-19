// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/route-plan-input.js
//  FAZ 15.0 — Haftalık Rota Planı (Manuel Giriş) — 2 HAFTALIK (A/B) MODEL
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
//  FAZ 15.0 — 2 HAFTALIK (A/B) DÖNÜŞÜMLÜ MODEL (kullanıcı isteğiyle,
//  önceki FAZ 10.2-14.1'in TEK haftalık modelinin yerine geçti):
//    Temsilci artık İKİ AYRI hafta deseni giriyor — "A Haftası" ve
//    "B Haftası" (her biri Pzt-Cum, kendi brick seçimleriyle). Gerçek
//    takvimde hangi haftanın "A" hangisinin "B" olduğu OTOMATİK ve
//    HERKESTE AYNI şekilde hesaplanır — kullanıcı ayarı/anchor GEREKMEZ:
//      ISO 8601 hafta numarası TEK  → A Haftası (weekGroup=1)
//      ISO 8601 hafta numarası ÇİFT → B Haftası (weekGroup=2)
//    Böylece "bu hafta" / "gelecek hafta" her zaman doğru A/B'ye denk
//    gelir ve haftadan haftaya otomatik döner (A, B, A, B, ...).
//    bkz. getCurrentWeekGroup().
//
//  Depolama: IndexedDB → pharma-db.js (PharmaDB paylaşımlı DB v2)
//    Store: route_plans (DB_VERSION/şema DEĞİŞMEDİ — weekGroup alanı
//    yeni kayıtlara EKLENDİ, index gerektirmiyor, client-side filtrelenir)
//    Model: {
//      id: representative+'|'+weekGroup+'|'+weekday,  // composite key
//      representative: string,          // ttt kodu
//      weekGroup:      1|2,             // 1=A Haftası, 2=B Haftası
//      weekday:        1|2|3|4|5,       // 1=Pazartesi ... 5=Cuma
//      bricks:         string[],        // seçili brick adları listesi
//      updatedAt:      ISO string
//    }
//    GERİYE UYUMLULUK: FAZ 15.0 ÖNCESİ kayıtlarda weekGroup alanı YOK —
//    böyle kayıtlar okunurken/senkronda otomatik A Haftası (1) sayılır
//    (bkz. _hydrateSyncCache, fetchTeamPlans).
//
//  Public API:
//    setDayPlan(weekGroup, weekday, bricks, representative?) → Promise<void>
//    getDayPlan(weekGroup, weekday, representative?)          → Promise<RoutePlan|null>
//    getWeekPlan(weekGroup, representative?)                  → Promise<RoutePlan[]>
//    getBothWeeksPlan(representative?)                        → Promise<{1:RoutePlan[],2:RoutePlan[]}>
//    getTodayPlan(representative?)                            → Promise<RoutePlan|null> (o anki aktif A/B)
//    clearWeekPlan(weekGroup, representative?)                → Promise<void>
//    fetchTeamPlans()                                         → Promise<{TTT:{weekGroup:{gün:bricks[]}}}|null>
//    getCurrentWeekGroup(refDate?)                            → 1|2
//
//  FAZ 14.0/15.0 — Worker Senkronu (opsiyonel, worker.js kaynağına göre):
//    window.ROTA_SYNC_WORKER_URL tanımlıysa, setDayPlan() sonrası SADECE
//    değişen gün { representative, weekGroup, weekday, bricks } formatında
//    worker'a POST edilir — worker.js GET desteklemediği ve sadece tek-gün
//    body kabul ettiği için "tüm hafta" gönderilmez. Worker bunu GitHub'daki
//    data/rota_planlari.json'a yazar (NESTED: plans[rep][weekGroup][weekday]
//    — worker.js AYRICA GÜNCELLENMELİ, ayrı dosya olarak verildi).
//    fetchTeamPlans() o dosyayı raw.githubusercontent.com üzerinden
//    DOĞRUDAN okur (worker üzerinden değil) — manager-panel-engine.js bunu
//    ekip-geneli (çoklu cihaz) görünüm için kullanır, okuma başarısızsa
//    sessizce yerel IndexedDB'ye (per-rep) döner.
//
//  FAZ 14.1 BUG DÜZELTMESİ (KORUNDU): worker'a giden POST'lar bu sekme
//  içinde SIRAYA alınır (_workerSyncQueue) — paralel "Kaydet" (5+5=10 gün)
//  GitHub Contents API'nin read-modify-write yarış durumuna girip önceki
//  günlerin kaydını SİLMESİN diye.
//
//  UI Yardımcıları:
//    renderRoutePlanForm(containerId, options?)
//      → A/B hafta sekmeleri + Pazartesi-Cuma grid + brick seçim
//        checkboxları + kaydet/temizle butonu (options.activeGroup ile
//        hangi sekmenin açık geleceği seçilebilir, varsayılan: o anki
//        aktif hafta)
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
  var GROUP_LABELS = { 1: 'A Haftası', 2: 'B Haftası' };

  var _fallback = {}; // id → RoutePlan (PharmaDB yoksa)

  // Sync cache: route-optimizer.js gibi senkron tüketiciler için
  // setDayPlan çağrıldığında güncellenir, getWeekPlanSync() ile okunur.
  var _syncCache = {}; // rep → { weekGroup → { weekday → bricks[] } }

  function _currentRep() {
    try { return window.engineSelTTT || window.selTTT || null; } catch (e) { return null; }
  }

  function _makeId(rep, weekGroup, weekday) {
    return (rep || 'default') + '|' + weekGroup + '|' + weekday;
  }

  function _extend(a, b) {
    var out = {};
    var k;
    for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k]; }
    for (k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k]; }
    return out;
  }

  // Bugünün ISO weekday'i (1=Pzt...5=Cum, 0=Cts/Paz → 5)
  function _todayWeekday() {
    var d = new Date().getDay(); // 0=Sun...6=Sat
    if (d === 0 || d === 6) return 5; // hafta sonu → Cuma fallback
    return d; // 1-5
  }

  // ── getCurrentWeekGroup — ISO 8601 hafta paritesiyle A/B belirle ──────
  // TEK ISO hafta → A(1), ÇİFT ISO hafta → B(2). Referans noktası
  // GEREKMEZ — ISO hafta numarası zaten mutlak ve herkeste aynıdır, bu
  // yüzden hangi cihazda/tarayıcıda hesaplanırsa hesaplansın SONUÇ AYNI
  // olur (temsilci ve yönetici farklı cihazlarda bile aynı A/B'yi görür).
  function _isoWeekNumber(d) {
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function getCurrentWeekGroup(refDate) {
    var iso = _isoWeekNumber(refDate || new Date());
    return (iso % 2 === 1) ? 1 : 2;
  }

  // ── FAZ 14.0/15.0 — Worker Senkronu ─────────────────────────────────
  // worker.js'in /rota-sync endpoint'i SADECE POST kabul ediyor ve body'de
  // TEK GÜN bekliyor: { representative, weekGroup, weekday, bricks }.
  // Worker'da GET handler'ı YOK (405 döner) — ekip verisi worker'dan değil,
  // worker'ın GitHub'a yazdığı dosyadan doğrudan (raw.githubusercontent.com)
  // okunuyor (bkz. fetchTeamPlans). Fire-and-forget: ağ hatası/timeout olsa
  // da setDayPlan'in kendi Promise'ini REDDETMEZ — sadece console.warn ile
  // sessizce loglanır, IndexedDB'ye yazım (asıl kayıt) her zaman kesin kalır.
  //
  // FAZ 14.1 BUG DÜZELTMESİ — VERİ KAYBI: "Kaydet" butonu bir haftanın 5
  // gününü Promise.all ile PARALEL kaydediyor. Her gün ayrı ayrı worker'a
  // POST atılınca, worker'ın GitHub Contents API yazma döngüsü (önce
  // dosyayı OKU/SHA al → o günü ekle → geri YAZ) YARIŞ DURUMUNA giriyordu:
  // istekler nerdeyse aynı anda dosyanın AYNI ESKİ halini okuyor, geç
  // biten istekler önceki günlerin güncellemesini GÖRMEDEN üstüne yazıp
  // SİLİYORDU. Çözüm: worker'a giden istekleri BU SEKME içinde SIRAYA
  // sokuyoruz — bir istek bitmeden bir sonraki başlamıyor.
  var _workerSyncQueue = Promise.resolve();

  function _syncDayToWorker(rep, weekGroup, weekday, bricks) {
    if (!window.ROTA_SYNC_WORKER_URL || !rep) return;
    var payload = { representative: rep, weekGroup: weekGroup, weekday: weekday, bricks: bricks || [] };
    _workerSyncQueue = _workerSyncQueue.then(function () {
      return fetch(window.ROTA_SYNC_WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }).then(function (res) {
        if (res && !res.ok) {
          console.warn('[route-plan-input] worker senkron HTTP hatası (' + GROUP_LABELS[weekGroup] + ', gün ' + weekday + '):', res.status);
        }
      }).catch(function (e) {
        console.warn('[route-plan-input] worker senkron hatası (' + GROUP_LABELS[weekGroup] + ', gün ' + weekday + ', yoksayıldı, yerel kayıt geçerli):', e && e.message);
      });
    });
  }

  // ── fetchTeamPlans — GitHub'daki data/rota_planlari.json'ı doğrudan oku ─
  // Dönen format (normalize edilmiş): { "TTT": { "1": {"gün":[bricks]}, "2": {...} } }
  // GERİYE UYUMLULUK: worker.js henüz güncellenmeden ÖNCE yazılmış eski
  // (tek haftalık, DÜZ) kayıtlar { "TTT": {"gün":[bricks]} } şeklindedir —
  // bunlar otomatik olarak A Haftası (1) altına migrate edilerek normalize
  // edilir, çağıran (manager-panel-engine.js) HER ZAMAN nested formatı görür.
  // Ağ hatası/404'te null döner → çağıran yerel IndexedDB'ye (per-rep) döner.
  var _ROTA_RAW_URL = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/data/rota_planlari.json';
  function fetchTeamPlans() {
    return fetch(_ROTA_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.plans) return null;
        var normalized = {};
        Object.keys(data.plans).forEach(function (rep) {
          var repData = data.plans[rep] || {};
          var isLegacyFlat = Object.keys(repData).some(function (k) { return Array.isArray(repData[k]); });
          if (isLegacyFlat) {
            // FAZ 15.0 ÖNCESİ (tek haftalık) format: {gün: bricks[]} → A(1)'e migrate
            normalized[rep] = { '1': repData };
          } else {
            normalized[rep] = repData; // zaten {weekGroup: {gün: bricks[]}}
          }
        });
        return normalized;
      })
      .catch(function (e) {
        console.warn('[route-plan-input] GitHub\'dan ekip planı okunamadı (yerel fallback kullanılacak):', e && e.message);
        return null;
      });
  }

  // ── setDayPlan ────────────────────────────────────────────────────────
  function setDayPlan(weekGroup, weekday, bricks, representative) {
    var rep = representative || _currentRep();
    var plan = {
      id:             _makeId(rep, weekGroup, weekday),
      representative: rep,
      weekGroup:      weekGroup,
      weekday:        weekday,
      bricks:         bricks || [],
      updatedAt:      new Date().toISOString()
    };

    // Sync cache'i güncelle
    if (!_syncCache[rep]) _syncCache[rep] = {};
    if (!_syncCache[rep][weekGroup]) _syncCache[rep][weekGroup] = {};
    _syncCache[rep][weekGroup][weekday] = bricks || [];

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
    // TEK GÜN kabul ediyor, bu yüzden elimizdeki weekGroup/weekday/bricks
    // doğrudan gönderilir. Çağırana dönen Promise'i bekletmez/etkilemez.
    writePromise.then(function () { _syncDayToWorker(rep, weekGroup, weekday, bricks); }).catch(function () {});

    return writePromise;
  }

  // ── getDayPlan ────────────────────────────────────────────────────────
  function getDayPlan(weekGroup, weekday, representative) {
    var rep = representative || _currentRep();
    var id = _makeId(rep, weekGroup, weekday);

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

  // ── getWeekPlan — TEK bir hafta grubunun (A veya B) planı ─────────────
  function getWeekPlan(weekGroup, representative) {
    var rep = representative || _currentRep();
    if (!window.PharmaDB) {
      return Promise.resolve(
        Object.values(_fallback).filter(function (p) { return p.representative === rep && (p.weekGroup || 1) === weekGroup; })
      );
    }
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) {
        return Promise.resolve(
          Object.values(_fallback).filter(function (p) { return p.representative === rep && (p.weekGroup || 1) === weekGroup; })
        );
      }
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('representative');
        var req = idx.openCursor(IDBKeyRange.only(rep));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) {
            if ((cursor.value.weekGroup || 1) === weekGroup) results.push(cursor.value);
            cursor.continue();
          } else resolve(results);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getBothWeeksPlan — A ve B haftalarının ikisini birden getirir ─────
  function getBothWeeksPlan(representative) {
    var rep = representative || _currentRep();
    return Promise.all([getWeekPlan(1, rep), getWeekPlan(2, rep)]).then(function (res) {
      return { 1: res[0], 2: res[1] };
    });
  }

  // ── getTodayPlan — bugünkü (o anki aktif A/B haftasındaki) plan ───────
  function getTodayPlan(representative) {
    return getDayPlan(getCurrentWeekGroup(), _todayWeekday(), representative);
  }

  // ── getTodayPlanSync — SENKRON erişim (route-optimizer.js için) ───────
  // Sadece sync cache'den okur (setDayPlan sonrası veya _hydrateSyncCache()
  // sonrası doldurulmuş olmalı). Her zaman O ANKİ AKTİF (A/B) haftayı okur.
  function getTodayPlanSync(representative) {
    var rep = representative || _currentRep();
    var wd = _todayWeekday();
    var wg = getCurrentWeekGroup();
    if (_syncCache[rep] && _syncCache[rep][wg] && _syncCache[rep][wg][wd]) {
      return { representative: rep, weekGroup: wg, weekday: wd, bricks: _syncCache[rep][wg][wd] };
    }
    // fallback'ten de bak
    var id = _makeId(rep, wg, wd);
    return _fallback[id] || null;
  }

  // ── getWeekPlanSync — SENKRON haftalık erişim (route-optimizer.js için) ─
  // BUG DÜZELTMESİ (FAZ 10.3, KORUNDU): buildWeeklyRoutes() (route-optimizer.js)
  // temsilcinin manuel haftalık planını hiç okumuyordu — bu fonksiyon o
  // bağlantıyı kurmak için eklendi. { 1: [...bricks], 2: [...], ... 5: [...] }
  // döner, hiç plan yoksa null. FAZ 15.0: her zaman O ANKİ AKTİF (A/B)
  // haftayı döner — route-optimizer.js'in imzası/çağırma şekli DEĞİŞMEDİ.
  function getWeekPlanSync(representative) {
    var rep = representative || _currentRep();
    var wg = getCurrentWeekGroup();
    var out = null;
    for (var wd = 1; wd <= 5; wd++) {
      var bricks = (_syncCache[rep] && _syncCache[rep][wg] && _syncCache[rep][wg][wd]) ? _syncCache[rep][wg][wd] : null;
      if (!bricks) {
        var id = _makeId(rep, wg, wd);
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
  // BUG DÜZELTMESİ (FAZ 10.3, KORUNDU): _syncCache SADECE setDayPlan()
  // çağrıldığında dolduruluyordu (aynı oturumda kaydedildiyse). Sayfa
  // yeniden yüklendiğinde (yeni oturum) IndexedDB'de kayıtlı plan hâlâ
  // dursa bile _syncCache boş kalıyordu. Modül yüklenir yüklenmez TÜM
  // route_plans store'unu okuyup cache'i ısıtıyoruz.
  // FAZ 15.0: weekGroup alanı olmayan (eski, tek haftalık) kayıtlar
  // otomatik A Haftası (1) altına migrate edilir.
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
              var wg = plan.weekGroup || 1; // geriye uyum: eski kayıt → A(1)
              if (!_syncCache[plan.representative]) _syncCache[plan.representative] = {};
              if (!_syncCache[plan.representative][wg]) _syncCache[plan.representative][wg] = {};
              _syncCache[plan.representative][wg][plan.weekday] = plan.bricks || [];
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

  // ── clearWeekPlan — SADECE belirtilen hafta grubunun (A veya B) planını sil ──
  function clearWeekPlan(weekGroup, representative) {
    var rep = representative || _currentRep();
    if (!window.PharmaDB) {
      Object.keys(_fallback).forEach(function (k) {
        var p = _fallback[k];
        if (p.representative === rep && (p.weekGroup || 1) === weekGroup) delete _fallback[k];
      });
      if (_syncCache[rep]) delete _syncCache[rep][weekGroup];
      return Promise.resolve();
    }
    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) { return Promise.resolve(); }
      return new Promise(function (resolve, reject) {
        var idx = store.index('representative');
        // openKeyCursor DEĞİL openCursor — weekGroup'u okuyup filtrelemek
        // için tam kayda (cursor.value) ihtiyaç var.
        var req = idx.openCursor(IDBKeyRange.only(rep));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) {
            if ((cursor.value.weekGroup || 1) === weekGroup) store.delete(cursor.primaryKey);
            cursor.continue();
          } else resolve();
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).then(function () {
      if (_syncCache[rep]) delete _syncCache[rep][weekGroup];
    });
  }

  // ── renderRoutePlanForm — UI yardımcısı ──────────────────────────────
  // containerId: DOM element id'si
  // options: { representative?, onSave?, activeGroup? } — activeGroup
  // verilmezse o anki aktif (A/B) hafta sekmesi açık gelir.
  function renderRoutePlanForm(containerId, options) {
    var container = document.getElementById(containerId);
    if (!container) return;
    options = options || {};
    var rep = options.representative || _currentRep();
    var currentGroup = getCurrentWeekGroup();
    var activeGroup = options.activeGroup || currentGroup;

    var brickList = [];
    var _imsAvailable = (typeof IMS !== 'undefined') && Array.isArray(IMS);
    var _imsLen = _imsAvailable ? IMS.length : -1;
    try {
      if (_imsAvailable) {
        IMS.forEach(function (r) {
          if (r.is_mkt) return;
          if (rep && r.ttt && r.ttt !== rep) return;
          if (r.brick && brickList.indexOf(r.brick) < 0) brickList.push(r.brick);
        });
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

    getWeekPlan(activeGroup, rep).then(function (weekPlans) {
      var planByDay = {};
      weekPlans.forEach(function (p) { planByDay[p.weekday] = p.bricks || []; });

      var html = '<div class="route-plan-form" style="font-size:13px;">';
      html += '<div style="font-weight:600;margin-bottom:8px;">Rota Planı — 2 Haftalık Dönüşümlü (A/B)</div>';

      html += '<div style="display:flex;gap:6px;margin-bottom:10px;">';
      [1, 2].forEach(function (g) {
        var isActive = (g === activeGroup);
        var isCurrent = (g === currentGroup);
        var label = GROUP_LABELS[g] + (isCurrent ? ' (bu hafta)' : '');
        html += '<button type="button" class="rp-tab-btn" data-group="' + g + '" style="font-size:11px;font-weight:700;padding:6px 14px;border-radius:8px;cursor:pointer;border:1.5px solid ' +
          (isActive ? '#1976d2' : '#ddd') + ';background:' + (isActive ? '#1976d2' : '#f5f5f5') + ';color:' + (isActive ? '#fff' : '#333') + ';">' + label + '</button>';
      });
      html += '</div>';

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
        html += '<button id="routePlanSaveBtn" style="margin-top:8px;padding:6px 16px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Kaydet (' + GROUP_LABELS[activeGroup] + ')</button>';
        html += ' <button id="routePlanClearBtn" style="margin-top:8px;padding:6px 16px;background:#f44336;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Temizle (' + GROUP_LABELS[activeGroup] + ')</button>';
      }
      html += '</div>';
      container.innerHTML = html;

      var tabBtns = container.querySelectorAll('.rp-tab-btn');
      for (var t = 0; t < tabBtns.length; t++) {
        tabBtns[t].addEventListener('click', function (ev) {
          var g = parseInt(ev.currentTarget.getAttribute('data-group'), 10);
          renderRoutePlanForm(containerId, _extend(options, { activeGroup: g }));
        });
      }

      var saveBtn = document.getElementById('routePlanSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var promises = [];
          for (var d2 = 1; d2 <= 5; d2++) {
            var dayEl = container.querySelector('[data-day="' + d2 + '"]');
            if (!dayEl) continue;
            var checked2 = Array.from(dayEl.querySelectorAll('input:checked')).map(function (cb) { return cb.value; });
            promises.push(setDayPlan(activeGroup, d2, checked2, rep));
          }
          Promise.all(promises).then(function () {
            saveBtn.textContent = 'Kaydedildi ✓';
            setTimeout(function () { saveBtn.textContent = 'Kaydet (' + GROUP_LABELS[activeGroup] + ')'; }, 2000);
            if (typeof options.onSave === 'function') options.onSave(activeGroup);
          }).catch(function (e) {
            console.warn('[route-plan-input] Kayıt hatası:', e);
          });
        });
      }

      var clearBtn = document.getElementById('routePlanClearBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          clearWeekPlan(activeGroup, rep).then(function () { renderRoutePlanForm(containerId, options); });
        });
      }
    });
  }

  window.RoutePlanInput = {
    setDayPlan:          setDayPlan,
    getDayPlan:           getDayPlan,
    getWeekPlan:          getWeekPlan,
    getBothWeeksPlan:     getBothWeeksPlan,
    getWeekPlanSync:      getWeekPlanSync,
    getTodayPlan:         getTodayPlan,
    getTodayPlanSync:     getTodayPlanSync,
    getCurrentWeekGroup:  getCurrentWeekGroup,
    clearWeekPlan:        clearWeekPlan,
    renderRoutePlanForm:  renderRoutePlanForm,
    fetchTeamPlans:       fetchTeamPlans,
    version:              '15.0'
  };

  _hydrateSyncCache();

  console.debug('[route-plan-input] FAZ 15.0 yüklendi (2 haftalık A/B model, o anki aktif: ' +
    GROUP_LABELS[getCurrentWeekGroup()] + ', worker senkron: ' + (window.ROTA_SYNC_WORKER_URL ? 'aktif' : 'pasif') + ').');

})();
