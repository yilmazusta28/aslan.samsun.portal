// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/pharmacy-data-manager.js — PHASE 5.2 (v2)
//  Monthly Pharmacy Data Architecture (Enterprise Scale)
//
//  Global State:
//    window.pharmacyFileRegistry  → keşfedilen dosya meta listesi
//    window.pharmacyCache         → "YYYY_MM" → parsed rows
//    window.pharmacyActiveFilter  → { year, month }  month=null → tümü
//    window.pharmacyActiveData    → aktif filtreye göre ECZANE_RAW benzeri array
//
//  Public API: window.PharmacyDataManager
//
//  GitHub Pages compatible: classic script, IIFE, no ES modules
//  Hiçbir yerde hardcoded yıl/ay karşılaştırması YOKTUR.
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────────
  if (window._PDM52_LOADED) {
    console.warn('[PDM52] Zaten yüklü — atlandı');
    return;
  }
  window._PDM52_LOADED = true;

  // ── GitHub Raw Base ───────────────────────────────────────────────────
  var REPO_RAW_BASE = (function () {
    if (typeof GITHUB_IMG_BASE !== 'undefined') {
      return GITHUB_IMG_BASE.replace(/images\/?$/, '');
    }
    return './';
  })();

  var ECZANE_DIR = 'eczane/';

  var AY_ISIMLERI = [
    'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
    'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'
  ];

  // ── Global State ──────────────────────────────────────────────────────
  window.pharmacyFileRegistry = [];
  window.pharmacyCache        = window.pharmacyCache || {};
  window.pharmacyActiveFilter = window.pharmacyActiveFilter || { years: [], months: [] };
  window.pharmacyActiveData   = window.pharmacyActiveData   || [];

  var _discoveryDone    = false;
  var _discoveryPromise = null;

  // ── Yardımcılar ───────────────────────────────────────────────────────
  function _fileName(year, month) {
    return year + '_' + String(month).padStart(2,'0') + '_Eczane.csv';
  }

  function _cacheKey(year, month) {
    return year + '_' + String(month).padStart(2,'0');
  }

  function _fileUrl(file) {
    return REPO_RAW_BASE + ECZANE_DIR + file;
  }

  // ── Ağ katmanı (PERF) ─────────────────────────────────────────────────
  // • Eşzamanlı istek sayısı sınırlı (21 paralel indirme bant genişliğini
  //   bölüp zaman aşımına düşürüyordu).
  // • Zaman aşımı gövde okumayı da kapsar ve 30 sn'dir; başarısız istek
  //   bir kez tekrar denenir. Başarısızlık ASLA cache'e "boş ay" olarak yazılmaz.
  // • no-store / Date.now() yok: geçmiş aylar HTTP cache'ten gelir.
  var NET = { maxParallel: 4, timeoutMs: 30000, retry: 1 };
  var _manifest   = null;   // { byKey:{}, latest:'YYYY_MM' } — manifest.json okunabildiyse
  var _inflight   = {};     // key → Promise (aynı ay iki kez indirilmez)
  var _missing    = {};     // key → true (404: dosya yok)
  var _active     = 0;
  var _queue      = [];
  var _allLoaded  = false;
  var _bgPromise  = null;

  function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function _limit(task) {
    return new Promise(function (resolve, reject) {
      function run() {
        _active++;
        task().then(resolve, reject).then(function () {
          _active--;
          if (_queue.length) _queue.shift()();
        });
      }
      if (_active < NET.maxParallel) run(); else _queue.push(run);
    });
  }

  function _fetchText(url, opts, timeoutMs) {
    var ctrl  = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || NET.timeoutMs);
    opts = Object.assign({}, opts || {}, { signal: ctrl.signal });
    return fetch(url, opts).then(function (r) {
      if (!r.ok) { clearTimeout(timer); return { status: r.status, text: null }; }
      return r.text().then(function (t) { clearTimeout(timer); return { status: 200, text: t }; });
    }).catch(function (e) {
      clearTimeout(timer);
      return { status: 0, text: null, err: e };
    });
  }

  // Manifest varsa sürüm anahtarı (içerik hash'i / boyut) URL'ye eklenir:
  // dosya değişmedikçe URL aynı kalır → tarayıcı cache'i devreye girer.
  function _monthRequest(key, file) {
    var url = _fileUrl(file);
    var e   = _manifest && _manifest.byKey[key];
    var v   = e && (e.v || e.size);
    if (v) return { url: url + '?v=' + encodeURIComponent(v), opts: {} };
    // Manifest yok: koşullu istek (ETag) — değişmediyse 304, gövde inmez
    return { url: url, opts: { cache: 'no-cache' } };
  }

  // Bir ayı indir + ayrıştır. → {status:'ok'|'missing'|'error', rows}
  async function _fetchMonth(year, month) {
    var key  = _cacheKey(year, month);
    var file = _fileName(year, month);
    var req  = _monthRequest(key, file);
    var res;
    for (var attempt = 0; attempt <= NET.retry; attempt++) {
      res = await _limit(function () { return _fetchText(req.url, req.opts); });
      if (res.status === 200 && res.text) break;
      if (res.status === 404) return { status: 'missing', rows: [] };
      if (attempt < NET.retry) await _sleep(700 * (attempt + 1));
    }
    if (!res || res.status !== 200 || !res.text) {
      console.warn('[PDM52] İndirilemedi (cache\'e yazılmadı):', key, 'HTTP', res && res.status);
      return { status: 'error', rows: [] };
    }
    var csv = res.text;
    if (csv.length <= 50 || csv.trim().charAt(0) === '<') return { status: 'missing', rows: [] };

    var rows = _parseCsvWithPapaParse(csv);
    if (typeof getBrickTTTMap === 'function') {
      var bm = getBrickTTTMap();
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.ttt && r.brick) r.ttt = bm[r.brick.toUpperCase()] || null;
      }
    }
    return { status: 'ok', rows: rows };
  }

  // ── 1. FILE DISCOVERY ─────────────────────────────────────────────────
  // Birincil yol: eczane/manifest.json (tek küçük istek; CI üretir).
  // Yedek yol   : manifest yoksa/okunamazsa eski "ay ay yokla" taraması
  //               (artık sınırlı eşzamanlılıkla, hata ay silmez).
  async function _loadManifest() {
    var r = await _fetchText(_fileUrl('manifest.json'), { cache: 'no-cache' }, 8000);
    if (r.status !== 200 || !r.text) return null;
    try {
      var m = JSON.parse(r.text);
      if (!m || !Array.isArray(m.files) || !m.files.length) return null;
      var byKey = {}, list = [];
      m.files.forEach(function (e) {
        if (!e || !e.year || !e.month) return;
        var mm  = String(e.month).padStart(2, '0');
        var key = e.year + '_' + mm;
        var ent = { year: e.year, month: e.month, file: e.file || _fileName(e.year, e.month),
                    key: key, legacy: false, size: e.size, v: e.v, modified: e.modified };
        byKey[key] = ent;
        list.push(ent);
      });
      if (!list.length) return null;
      list.sort(function (a, b) { return a.year !== b.year ? a.year - b.year : a.month - b.month; });
      _manifest = { byKey: byKey, latest: list[list.length - 1].key };
      return list;
    } catch (e) {
      console.warn('[PDM52] manifest.json ayrıştırılamadı:', e.message);
      return null;
    }
  }

  async function _probeMonths(dates) {
    await Promise.all(dates.map(function (d) { return loadPharmacyMonth(d.year, d.month); }));
    var out = [];
    dates.forEach(function (d) {
      var key = _cacheKey(d.year, d.month);
      if (window.pharmacyCache[key]) {
        out.push({ year: d.year, month: d.month, file: _fileName(d.year, d.month), key: key, legacy: false });
      }
    });
    return out;
  }

  async function discoverPharmacyFiles() {
    if (_discoveryDone) return window.pharmacyFileRegistry;
    if (_discoveryPromise) return _discoveryPromise;

    _discoveryPromise = (async function () {
      console.log('[PDM52] Dosya keşfi başlıyor…');

      var now = new Date();
      var found = await _loadManifest();

      if (found) {
        console.log('[PDM52] manifest.json okundu:', found.length, 'ay');
        // Manifest bot'u henüz çalışmadıysa yeni ay eksik olabilir:
        // manifestteki son aydan sonraki (en fazla gelecek ay) dosyaları yokla (404 ücretsiz).
        var last = found[found.length - 1];
        var extra = [];
        var d = new Date(last.year, last.month, 1); // last.month 1-tabanlı → bir sonraki ay
        var endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        for (; d <= endDate; d.setMonth(d.getMonth() + 1)) {
          extra.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        }
        if (extra.length) {
          var more = await _probeMonths(extra);
          more.forEach(function (e) { found.push(e); });
        }
      } else {
        console.warn('[PDM52] manifest.json yok — ay ay yoklama moduna düşüldü');
        var dates = [];
        var endD = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        for (var dd = new Date(2025, 0, 1); dd <= endD; dd.setMonth(dd.getMonth() + 1)) {
          dates.push({ year: dd.getFullYear(), month: dd.getMonth() + 1 });
        }
        found = await _probeMonths(dates);
      }

      found.sort(function (a, b) {
        return a.year !== b.year ? a.year - b.year : a.month - b.month;
      });

      // ── FALLBACK: ECZANE/ klasörü henüz yok → legacy ECZANE_RAW ───────
      if (found.length === 0) {
        console.log('[PDM52] ECZANE/ klasörü boş — legacy ECZANE_RAW modu');
        var raw = window.ECZANE_RAW || [];
        var aySet = {};
        raw.forEach(function (r) {
          if (!r.ay) return;
          var p = String(r.ay).split('/');
          if (p.length < 2) return;
          var mo = parseInt(p[0], 10);
          var yr = parseInt(p[1], 10);
          if (isNaN(mo) || isNaN(yr) || mo < 1 || mo > 12) return;
          var key = yr + '_' + String(mo).padStart(2, '0');
          if (!aySet[key]) {
            aySet[key] = { year: yr, month: mo, file: _fileName(yr, mo), key: key, legacy: true };
          }
        });
        Object.keys(aySet).forEach(function (k) { found.push(aySet[k]); });
        found.sort(function (a, b) {
          return a.year !== b.year ? a.year - b.year : a.month - b.month;
        });
        found.forEach(function (f) {
          if (window.pharmacyCache[f.key]) return;
          var mm    = String(f.month).padStart(2, '0');
          var ayStr = mm + '/' + f.year;
          var rows  = raw.filter(function (r) {
            return r.ay === ayStr || r.ay === String(f.month) + '/' + f.year;
          });
          window.pharmacyCache[f.key] = rows;
          console.log('[PDM52] Legacy cache:', f.key, '→', rows.length, 'satır');
        });
      }

      window.pharmacyFileRegistry = found;
      _discoveryDone = true;

      if (found.length) {
        console.log('[PDM52] Keşif tamamlandı:', found.length, 'kayıt →',
          found.map(function (f) { return f.key + (f.legacy ? '(L)' : ''); }).join(', '));
        if (!window.pharmacyActiveFilter.years || !window.pharmacyActiveFilter.years.length) {
          var latest = found[found.length - 1];
          window.pharmacyActiveFilter.years  = [latest.year];
          window.pharmacyActiveFilter.months = [];
        }
        _refreshFilterUI();
      } else {
        console.warn('[PDM52] Hiç dosya/ay bulunamadı');
        var yilEl = document.getElementById('eczaneYilBar');
        if (yilEl) yilEl.innerHTML = '<span style="color:var(--dim);font-size:11px">Veri yok</span>';
        var ayEl52 = document.getElementById('eczaneAyBar52');
        if (ayEl52) ayEl52.innerHTML = '';
      }

      return found;
    })();

    return _discoveryPromise;
  }

  // Filtre UI'ı güvenli şekilde güncelle
  function _refreshFilterUI() {
    var yilEl  = document.getElementById('eczaneYilBar');
    var ayEl   = document.getElementById('eczaneAyBar52');
    if (yilEl) _renderYearFilter('eczaneYilBar');
    if (ayEl)  _renderMonthFilter('eczaneAyBar52');
  }

  // ── 2-3. LAZY LOADING + SMART CACHE ──────────────────────────────────
  function loadPharmacyMonth(year, month) {
    var key = _cacheKey(year, month);

    if (window.pharmacyCache[key]) return Promise.resolve(window.pharmacyCache[key]);
    // Aynı ay zaten iniyorsa AYNI promise döner (eski 100 ms'lik polling kalktı)
    if (_inflight[key]) return _inflight[key];

    var p = (async function () {
      console.log('[PDM52] Yükleniyor:', key);
      var res = await _fetchMonth(year, month);
      if (res.status !== 'ok') {
        if (res.status === 'missing') _missing[key] = true;
        return [];            // cache'e yazılmaz → sonraki istekte yeniden denenir
      }
      var rows = res.rows;
      window.pharmacyCache[key] = rows;
      _updatePharmacyStore(year, month, rows);
      console.log('[PDM52]', key, '→', rows.length, 'satır');

      var exists = window.pharmacyFileRegistry.some(function (f) { return f.key === key; });
      if (!exists && rows.length > 0) {
        window.pharmacyFileRegistry.push({ year: year, month: month, file: _fileName(year, month), key: key });
        window.pharmacyFileRegistry.sort(function (a, b) {
          return a.year !== b.year ? a.year - b.year : a.month - b.month;
        });
      }
      return rows;
    })().then(function (rows) {
      delete _inflight[key];
      return rows;
    }, function (err) {
      delete _inflight[key];
      console.error('[PDM52] Yükleme hatası:', key, err && err.message);
      return [];
    });

    _inflight[key] = p;
    return p;
  }

  async function loadPharmacyMultiMonth(year) {
    var files = window.pharmacyFileRegistry.filter(function (f) { return f.year === year; });
    if (!files.length) return [];
    var parts = await Promise.all(files.map(function (f) { return loadPharmacyMonth(f.year, f.month); }));
    var all = [];
    parts.forEach(function (rows) { all = all.concat(rows); });
    return all;
  }

  // ── Arka plan yükleme ────────────────────────────────────────────────
  // Giriş sonrası kritik yolu tutmaz: en yeni ay hemen, kalanlar tarayıcı
  // boştayken (en yeniden eskiye, 2 işçi) yüklenir. Çok aylı veri bekleyen
  // AI motorları (reorder / behavior / temporal) bittiğinde cache'lerini
  // temizler ve tam veriyle yeniden hesaplar.
  // window.PV_PHARMACY_PRELOAD = 'all' | 'recent' | 'none'  ile zorlanabilir.
  function _preloadMode() {
    if (window.PV_PHARMACY_PRELOAD) return window.PV_PHARMACY_PRELOAD;
    var c = navigator.connection || {};
    if (c.saveData || /2g/.test(c.effectiveType || '')) return 'recent';
    return 'all';
  }

  function _idle() {
    return new Promise(function (resolve) {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(function () { resolve(); }, { timeout: 2000 });
      else setTimeout(resolve, 50);
    });
  }

  function _backgroundLoadRest(found) {
    if (_bgPromise) return _bgPromise;
    var mode = _preloadMode();
    var todo = found.slice().reverse().filter(function (f) { return !window.pharmacyCache[f.key]; });
    if (mode === 'recent') todo = todo.slice(0, 3);
    if (mode === 'none')   todo = [];
    console.log('[PDM52] Arka plan yükleme modu:', mode, '→', todo.length, 'ay');

    var idx = 0;
    async function worker() {
      while (idx < todo.length) {
        var f = todo[idx++];
        await _idle();
        await loadPharmacyMonth(f.year, f.month);
        await _sleep(0);   // ana thread'e nefes aldır
      }
    }
    _bgPromise = (async function () {
      await _sleep(1500);
      await Promise.all([worker(), worker()]);
      _allLoaded = true;
      _onBackgroundDone();
    })();
    return _bgPromise;
  }

  function _onBackgroundDone() {
    getActivePharmacyData().then(function () {
      if (typeof reresolveTTT === 'function') reresolveTTT();
      if (window.PharmacyAdapter && typeof window.PharmacyAdapter.clearCache === 'function') window.PharmacyAdapter.clearCache();
      if (window.PharmacyBehaviorEngine && typeof window.PharmacyBehaviorEngine.clearCache === 'function') window.PharmacyBehaviorEngine.clearCache();
      if (window.PharmacyRanking && typeof window.PharmacyRanking.clearCache === 'function') window.PharmacyRanking.clearCache();
      try { window.dispatchEvent(new CustomEvent('pharmacy:allMonthsLoaded')); } catch (_e) {}
      if (typeof curPage !== 'undefined' && curPage === 5) {
        if (typeof buildEczaneFilters   === 'function') buildEczaneFilters();
        if (typeof renderEczaneContent  === 'function') renderEczaneContent();
      }
      console.log('[PDM52] Arka plan yükleme tamam:', Object.keys(window.pharmacyCache).length, 'ay hafızada');
    });
  }

  // Çok aylı veri isteyen herhangi bir motor bunu await edebilir.
  async function ensureAllMonths() {
    var files = window.pharmacyFileRegistry.length ? window.pharmacyFileRegistry : await discoverPharmacyFiles();
    await Promise.all(files.map(function (f) { return loadPharmacyMonth(f.year, f.month); }));
    return window.pharmacyStore.normalized;
  }

  async function getActivePharmacyData() {
    var f = window.pharmacyActiveFilter;
    if (!f.years || !f.years.length) {
      window.pharmacyActiveData = window.ECZANE_RAW || [];
      return window.pharmacyActiveData;
    }

    // Tüm seçili yıl+ay kombinasyonlarını yükle
    var all = [];
    var loaded = {};
    var jobs = [];   // PERF: aylar paralel indirilir, sıra korunur
    for (var yi = 0; yi < f.years.length; yi++) {
      var yr = f.years[yi];
      var ayList = (f.months && f.months.length)
        ? f.months
        : getAvailableMonths(yr);
      for (var mi = 0; mi < ayList.length; mi++) {
        var mo = ayList[mi];
        var key = yr + '_' + mo;
        if (loaded[key]) continue;
        loaded[key] = true;
        // Sadece bu yıl için geçerli aylar
        var available = getAvailableMonths(yr);
        if (available.indexOf(mo) === -1) continue;
        jobs.push(loadPharmacyMonth(yr, mo));
      }
    }
    var parts = await Promise.all(jobs);
    parts.forEach(function (rows) { all = all.concat(rows); });

    window.pharmacyActiveData = all;
    // ECZANE_RAW'ı EZME — sadece pharmacyActiveData güncellenir
    // renderEczane/getFilteredEczanePDM her zaman pharmacyActiveData'yı öncelikli kullanır
    if (all.length > 0) {
      window.eczaneLoaded = true;
    }
    return all;
  }

  // ── 4-5. YIL / AY FİLTRE RENDER ──────────────────────────────────────
  function getAvailableYears() {
    var years = [];
    window.pharmacyFileRegistry.forEach(function (f) {
      if (years.indexOf(f.year) === -1) years.push(f.year);
    });
    return years.sort(function (a, b) { return a - b; });
  }

  function getAvailableMonths(year) {
    return window.pharmacyFileRegistry
      .filter(function (f) { return f.year === year; })
      .map(function (f) { return f.month; })
      .sort(function (a, b) { return a - b; });
  }

  function _renderYearFilter(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    var years  = getAvailableYears();
    var active = window.pharmacyActiveFilter.years || [];
    if (!years.length) { el.innerHTML = '<span style="color:var(--dim);font-size:11px">Taranıyor…</span>'; return; }
    el.innerHTML = years.map(function (y) {
      var isActive = active.indexOf(y) !== -1;
      var cls = isActive ? 'tfb-sp active' : 'tfb-sp';
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectYear(' + y + ')" title="Ctrl+tık: tek seç">' + y + '</button>';
    }).join('');
  }

  function _renderMonthFilter(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    var f = window.pharmacyActiveFilter;
    if (!f.years || !f.years.length) {
      el.innerHTML = '<span style="color:var(--dim);font-size:11px">Yıl seçin</span>';
      return;
    }
    // Seçili tüm yıllardaki mevcut ayların birleşimi
    var monthSet = {};
    f.years.forEach(function(yr) {
      getAvailableMonths(yr).forEach(function(m) { monthSet[m] = true; });
    });
    var months = Object.keys(monthSet).map(Number).sort(function(a,b){return a-b;});
    var activeMonths = f.months || [];
    var allSelected  = activeMonths.length === 0;

    if (!months.length) { el.innerHTML = '<span style="color:var(--dim);font-size:11px">Veri yok</span>'; return; }

    var html = '<button class="tfb-sp' + (allSelected ? ' active' : '') + '" onclick="PharmacyDataManager.selectMonth(null)">Tümü</button>';
    html += months.map(function (m) {
      var isActive = activeMonths.indexOf(m) !== -1;
      var cls   = isActive ? 'tfb-sp active' : 'tfb-sp';
      var label = AY_ISIMLERI[m - 1];
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectMonth(' + m + ')">' + label + '</button>';
    }).join('');
    el.innerHTML = html;
  }

  function renderPharmacyYearFilter(elId)  { _renderYearFilter(elId || 'eczaneYilBar'); }
  function renderPharmacyMonthFilter(elId) { _renderMonthFilter(elId || 'eczaneAyBar52'); }

  // ── Filtre seçim aksiyonları ──────────────────────────────────────────
  async function selectYear(year) {
    var f = window.pharmacyActiveFilter;
    var idx = f.years.indexOf(year);
    if (idx === -1) {
      f.years.push(year);
      f.years.sort(function(a,b){return a-b;});
    } else if (f.years.length > 1) {
      f.years.splice(idx, 1);
    }
    // Ay seçimini ve aktif veriyi sıfırla
    f.months = [];
    window.pharmacyActiveData = [];
    _refreshFilterUI();
    await getActivePharmacyData();
    _triggerEczaneRender();
  }

  async function selectOnlyYear(year) {
    var f = window.pharmacyActiveFilter;
    f.years  = [year];
    f.months = [];
    _refreshFilterUI();
    await getActivePharmacyData();
    _triggerEczaneRender();
  }

  async function selectMonth(month) {
    var f = window.pharmacyActiveFilter;
    window.pharmacyActiveData = []; // taze yükle
    if (month === null) {
      // "Tümü" seçildi — ay filtresini temizle
      f.months = [];
    } else {
      var idx = f.months.indexOf(month);
      if (idx === -1) {
        f.months.push(month);
        f.months.sort(function(a,b){return a-b;});
      } else if (f.months.length > 1) {
        f.months.splice(idx, 1);
      } else {
        // Tek kalan seçim, tekrar tıklanınca tümünü seç
        f.months = [];
      }
    }
    _refreshFilterUI();
    await getActivePharmacyData();
    _triggerEczaneRender();
  }

  function _triggerEczaneRender() {
    // DOM hazır değilse (sayfa henüz açılmamış) sadece buildEczaneFilters çağır
    // renderEczaneContent kendi içinde DOM guard'ı var
    if (typeof buildEczaneFilters  === 'function') buildEczaneFilters();
    if (typeof renderEczaneContent === 'function') renderEczaneContent();
  }

  // ── 8. REORDER PREDICTION SCORE ──────────────────────────────────────
  function _getOrderHistory(gln) {
    var history = [];
    Object.keys(window.pharmacyCache).forEach(function (key) {
      var m = /^(\d{4})_(\d{2})$/.exec(key);
      if (!m) return;
      var year  = parseInt(m[1], 10);
      var month = parseInt(m[2], 10);
      var total = 0;
      (window.pharmacyCache[key] || []).forEach(function (r) {
        if (r.gln === gln) total += (r.adet || 0);
      });
      history.push({ key: key, year: year, month: month, adet: total });
    });
    history.sort(function (a, b) {
      return a.year !== b.year ? a.year - b.year : a.month - b.month;
    });
    return history;
  }

  function _trendSlope(values) {
    var n = values.length;
    if (n < 2) return 0;
    var sx=0, sy=0, sxy=0, sx2=0;
    for (var i=0;i<n;i++){sx+=i;sy+=values[i];sxy+=i*values[i];sx2+=i*i;}
    var d = n*sx2 - sx*sx;
    return d ? (n*sxy - sx*sy) / d : 0;
  }

  function _detectPattern(values) {
    if (!values || !values.length) return 'UNKNOWN';
    var nonZero = values.filter(function(v){return v>0;});
    var total   = values.reduce(function(s,v){return s+v;},0);
    var n       = values.length;
    var slope   = _trendSlope(values);

    if (nonZero.length===1 && values[0]>50) return 'CAMPAIGN_BUYER';
    if (values[values.length-1]>0 && nonZero.length===1) return 'NEW_ACTIVE';
    if (nonZero.length===n && n>=3) {
      var mean = total/n;
      var cv   = mean>0 ? Math.sqrt(values.reduce(function(s,v){return s+Math.pow(v-mean,2);},0)/n)/mean : 1;
      if (cv<0.25) return 'REGULAR_BUYER';
    }
    if (slope>3 && nonZero.length>=3) return 'GROWING';
    if (values.slice(-3).every(function(v){return v===0;}) && total>0) return 'AT_RISK';
    if (nonZero.length>0 && nonZero.length<n*0.5) return 'REACTIVATION';
    return 'OTHER';
  }

  function _patternLabel(p) {
    return ({'GROWING':'📈 Güçlü Büyüme','REGULAR_BUYER':'🔄 Düzenli Müşteri',
      'NEW_ACTIVE':'🆕 Yeni Aktif','REACTIVATION':'♻️ Yeniden Aktive',
      'CAMPAIGN_BUYER':'🎯 Kampanya Alımı','AT_RISK':'⚠️ Kayıp Riski','OTHER':'📊 Diğer'})[p]||'📊 Diğer';
  }

  function buildReorderPredictionScores(ttt) {
    var data = window.pharmacyActiveData || [];
    if (!data.length) return [];
    var map = {};
    data.forEach(function(r){
      if (!r.gln) return;
      if (ttt && r.ttt!==ttt) return;
      if (!map[r.gln]) map[r.gln]={gln:r.gln,ad:r.ad,brick:r.brick,ttt:r.ttt};
    });
    var results = [];
    Object.keys(map).forEach(function(gln){
      var meta    = map[gln];
      var history = _getOrderHistory(gln);
      var values  = history.map(function(h){return h.adet;});
      if (!values.length) return;
      var nonZero = values.filter(function(v){return v>0;});
      var total   = values.reduce(function(s,v){return s+v;},0);
      var active  = nonZero.length;
      var lastVal = values[values.length-1]||0;
      var slope   = _trendSlope(values);
      var pattern = _detectPattern(values);

      var lastActiveIdx = -1;
      for (var i=values.length-1;i>=0;i--) { if(values[i]>0){lastActiveIdx=i;break;} }
      var monthsSince = lastActiveIdx>=0 ? values.length-1-lastActiveIdx : values.length;
      var avgCycle    = active>1 ? (values.length-1)/(active-1) : 2;

      var score = 0;
      if (avgCycle>0&&monthsSince>0) score += Math.min(30, Math.round((monthsSince/avgCycle)*30));
      if (slope>0) score += Math.min(20, Math.round(slope*4));
      if (values.length>0) score += Math.round((active/values.length)*15);
      score += ({GROWING:20,REGULAR_BUYER:18,NEW_ACTIVE:12,REACTIVATION:10,CAMPAIGN_BUYER:5,AT_RISK:2,OTHER:5})[pattern]||5;
      if (lastVal>0) score += Math.min(15, Math.round((lastVal/Math.max(1,total/active))*10));
      score = Math.max(0, Math.min(100, score));

      results.push({gln,ad:meta.ad,brick:meta.brick,ttt:meta.ttt,
        reorderScore:score,pattern,totalBoxes:total,activeMonths:active,
        monthsSinceLastOrder:monthsSince,avgOrderCycle:Math.round(avgCycle*10)/10,
        trendSlope:Math.round(slope*100)/100,lastMonthBoxes:lastVal,historyLength:values.length});
    });
    results.sort(function(a,b){return b.reorderScore-a.reorderScore;});
    return results;
  }

  function buildMonthlyTrendAnalysis(ttt) {
    return buildReorderPredictionScores(ttt).map(function(s){
      var vals = _getOrderHistory(s.gln).map(function(h){return h.adet;});
      return Object.assign({},s,{monthlyHistory:vals,patternLabel:_patternLabel(s.pattern)});
    });
  }

  // ── 10. TOP 30 VISIT PRIORITY ─────────────────────────────────────────
  // FAZ 8.1 — PharmacyRanking kanonik sıralamaya delege eder (yüklüyse)
  function buildTop30VisitPriority(ttt, genelData) {
    if (window.PharmacyRanking && typeof window.PharmacyRanking.rankPharmacies === 'function') {
      try {
        var ranked81 = window.PharmacyRanking.rankPharmacies(ttt);
        var cands81  = ranked81.filter(function (r) { return r.classification !== 'CAMPAIGN_BUYER'; });
        // genelData brick önceliği bileşeni: kanonik score'a ekstra brick ağırlığı
        var gapMap = {};
        if (genelData && genelData.length && ttt) {
          genelData.filter(function (r) { return r.ttt === ttt; }).forEach(function (r) {
            if (r.brick && r.hedef && r.satis) {
              gapMap[r.brick] = Math.min(1.5, 1 + Math.max(0, (r.hedef - r.satis) / Math.max(1, r.hedef)));
            }
          });
        }
        return cands81.slice(0, 30).map(function (r) {
          var bp  = gapMap[r.brick] || 1.0;
          var vps = Math.round(r.canonicalScore * bp * 10) / 10;
          return Object.assign({}, r, {
            ttt: r.representative,
            brickPriority:     bp,
            growthPotential:   1.0,
            visitPriorityScore: vps,
            reorderScore:      r.canonicalScore,
            trendSlope:        r.trendSlope || 0
          });
        });
      } catch (_e) {
        console.warn('[PDM] PharmacyRanking delege hata, legacy hesaba düşülüyor:', _e.message);
        (window._PV_FALLBACK_LOG = window._PV_FALLBACK_LOG || []).push({
          module: 'PharmacyDataManager', dependency: 'PharmacyRanking',
          error: _e.message, ts: Date.now()
        });
      }
    }
    var scores = buildReorderPredictionScores(ttt);
    var gapMap = {};
    if (genelData && genelData.length && ttt) {
      genelData.filter(function(r){return r.ttt===ttt;}).forEach(function(r){
        if (r.brick&&r.hedef&&r.satis) {
          gapMap[r.brick] = Math.min(1.5, 1+Math.max(0,(r.hedef-r.satis)/Math.max(1,r.hedef)));
        }
      });
    }
    var ranked = scores.map(function(s){
      var bp  = gapMap[s.brick]||1.0;
      var gp  = s.trendSlope>0 ? Math.min(1.5,1+s.trendSlope/20) : Math.max(0.5,1+s.trendSlope/40);
      var vps = Math.round(s.reorderScore*bp*gp*10)/10;
      return Object.assign({},s,{brickPriority:bp,growthPotential:gp,visitPriorityScore:vps});
    });
    ranked.sort(function(a,b){return b.visitPriorityScore-a.visitPriorityScore;});
    return ranked.slice(0,30);
  }

  // ── 11. ROUTE OPTIMIZER ───────────────────────────────────────────────
  function buildRouteOptimizer(ttt, top30) {
    var DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma'];
    if (!top30) top30 = buildTop30VisitPriority(ttt);
    var groups = {};
    top30.forEach(function(p){
      var b = p.brick||'DİĞER';
      if (!groups[b]) groups[b]=[];
      groups[b].push(p);
    });
    var bricks = Object.keys(groups).sort(function(a,b){
      var aa=groups[a].reduce(function(s,p){return s+p.visitPriorityScore;},0)/groups[a].length;
      var bb=groups[b].reduce(function(s,p){return s+p.visitPriorityScore;},0)/groups[b].length;
      return bb-aa;
    });
    var route = DAYS.map(function(d,i){return{day:d,dayIndex:i+1,bricks:[],pharmacies:[]};});
    bricks.forEach(function(b,i){
      route[i%DAYS.length].bricks.push(b);
      groups[b].forEach(function(p){route[i%DAYS.length].pharmacies.push(p);});
    });
    return route.filter(function(d){return d.pharmacies.length>0;});
  }

  // ── İlk Init ──────────────────────────────────────────────────────────
  // 1) manifest ile keşif  2) EN YENİ ay hemen  3) kalanlar boşta, arka planda
  async function initPharmacyDataManager() {
    console.log('[PDM52] Init başlıyor…');

    var found = await discoverPharmacyFiles();
    if (!found.length) {
      console.warn('[PDM52] Hiç dosya bulunamadı — eski ECZANE.csv modunda devam');
      return;
    }
    _refreshFilterUI();

    var latest = found[found.length - 1];
    await loadPharmacyMonth(latest.year, latest.month);
    if (typeof curPage !== 'undefined' && curPage === 5) {
      if (typeof buildEczaneFilters  === 'function') buildEczaneFilters();
    }
    if (typeof reresolveTTT === 'function') reresolveTTT();

    _backgroundLoadRest(found);
  }

// ═══════════════════════════════════════════════════════════════════════
// PHASE 5.2 TAMAMLAMA BLOĞU — pharmacy-data-manager.js'e eklenir
// Bu blok mevcut IIFE'nin içine, Public API bölümünden ÖNCE yerleşir
// ═══════════════════════════════════════════════════════════════════════

// ── PHASE 5.2: pharmacyStore Global Yapısı ────────────────────────────
// Spec: window.pharmacyStore = { registry, cache, normalized, byPharmacy, byBrick, byProduct, metadata }
// Mevcut window.pharmacyFileRegistry ve window.pharmacyCache ile SENKRONIZE çalışır.
// Eski kodlar bozulmadan yeni motorlar pharmacyStore üzerinden çalışır.

window.pharmacyStore = window.pharmacyStore || {
  registry:   {},           // key:"2026_04" → {year,month,file,key,loaded}
  cache:      {},           // key:"2026_04" → raw rows (== window.pharmacyCache)
  normalized: [],           // tüm normalize edilmiş kayıtlar
  byPharmacy: {},           // gln/ad → [{...}]
  byBrick:    {},           // brick → [{...}]
  byProduct:  {},           // urun → [{...}]
  metadata:   { years: [], months: {} }
};

// ── Normalize Fonksiyonu ──────────────────────────────────────────────
// Spec: {year, month, temsilci, brick, eczane, urun, adet, tutar, aktif:true}
function _normalizeRow(r, year, month) {
  return {
    year:      year,
    month:     month,
    temsilci:  r.ttt   || r.temsilci || '',
    brick:     r.brick || '',
    eczane:    r.ad    || r.eczane   || '',
    gln:       r.gln   || '',
    urun:      r.urun  || '',
    adet:      parseInt(r.adet, 10)   || 0,
    tutar:     parseFloat(r.tutar)    || 0,
    ay:        r.ay    || (String(month).padStart(2,'0') + '/' + year),
    aktif:     true
  };
}

// ── pharmacyStore'u güncelle (loadPharmacyMonth sonrası çağrılır) ─────
// Tek geçişte indeksler kurulur. Aynı ay yeniden yüklenirse eski kayıtlar
// normalized'dan VE üç indeksten de çıkarılır (eskiden indeksler çoğalıyordu).
function _indexRows(S, list) {
  for (var i = 0; i < list.length; i++) {
    var n = list[i];
    var id = n.gln || n.eczane;
    if (id) (S.byPharmacy[id] || (S.byPharmacy[id] = [])).push(n);
    if (n.brick) (S.byBrick[n.brick] || (S.byBrick[n.brick] = [])).push(n);
    if (n.urun)  (S.byProduct[n.urun] || (S.byProduct[n.urun] = [])).push(n);
  }
}

function _updatePharmacyStore(year, month, rows) {
  var S   = window.pharmacyStore;
  var key = year + '_' + String(month).padStart(2,'0');
  var wasLoaded = !!(S.registry[key] && S.registry[key].loaded);

  S.registry[key] = {
    year: year, month: month,
    file: key + '_Eczane.csv',
    key:  key, loaded: true,
    rowCount: rows.length
  };
  S.cache[key] = rows;

  var normed = new Array(rows.length);
  for (var i = 0; i < rows.length; i++) normed[i] = _normalizeRow(rows[i], year, month);

  if (wasLoaded) {
    S.normalized = S.normalized.filter(function (n) { return !(n.year === year && n.month === month); });
    S.byPharmacy = {}; S.byBrick = {}; S.byProduct = {};
    _indexRows(S, S.normalized);
  }
  S.normalized = S.normalized.concat(normed);
  _indexRows(S, normed);

  if (S.metadata.years.indexOf(year) === -1) {
    S.metadata.years.push(year);
    S.metadata.years.sort(function(a,b){return a-b;});
  }
  if (!S.metadata.months[year]) S.metadata.months[year] = [];
  if (S.metadata.months[year].indexOf(month) === -1) {
    S.metadata.months[year].push(month);
    S.metadata.months[year].sort(function(a,b){return a-b;});
  }
}

// ── CSV Parse — parseEczaneCSV öncelikli ─────────────────────────────
// CSV formatı: BOM+UTF8, noktalı virgül delimiter, Türkçe sayılar
// Sütunlar: Tarih;Ana Depo;Depo;GLN;Kontak Adı;Kontak Brick;Ürün;Form;Satış Adet;Satış MF;Toplam Satış;Toplam Tutar
function _parseCsvWithPapaParse(csvText) {
  // 1. parseEczaneCSV (index.html'de tanımlı) — tüm formatı bilir
  if (typeof parseEczaneCSV === 'function') {
    try {
      var _r = parseEczaneCSV(csvText);
      if (_r && _r.length > 0) return _r;
    } catch(e) {
      console.warn('[PDM52] parseEczaneCSV hata:', e.message);
    }
  }

  // 2. Fallback: manuel parse
  try {
    var brickTTT = (typeof getBrickTTTMap === 'function') ? getBrickTTTMap() : {};
    var _clean   = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var _lines   = _clean.split('\n');
    var _result  = [];
    var _pn      = function(s){ return parseFloat((s||'0').replace(/[.]/g,'').replace(',','.')) || 0; };
    for (var i = 1; i < _lines.length; i++) {
      var ln = _lines[i].trim();
      if (!ln) continue;
      var c = ln.split(';');
      if (c.length < 10) continue;
      var gln   = (c[3]||'').trim();
      var ad    = (c[4]||'').trim();
      var brick = (c[5]||'').trim();
      var urun  = (c[6]||'').trim();
      if (!gln && !ad) continue;
      var tarih   = (c[0]||'').trim();
      var ap      = tarih.split('.');
      var ay      = (ap.length >= 3) ? ap[1].padStart(2,'0')+'/'+ap[2] : '';
      var ttt     = brickTTT[(brick||'').toUpperCase()] || null;
      _result.push({ tarih:tarih, gln:gln, ad:ad, brick:brick,
                     urun:urun, adet:_pn(c[10]||c[8]), tutar:_pn(c[11]),
                     iade:0, ay:ay, ttt:ttt });
    }
    return _result;
  } catch(e2) {
    console.error('[PDM52] Fallback parse hatası:', e2.message);
    return [];
  }
}

// ── loadAll() — tüm registry'deki ayları yükle ───────────────────────
async function loadAll() {
  var files = window.pharmacyFileRegistry;
  if (!files || !files.length) {
    await discoverPharmacyFiles();
    files = window.pharmacyFileRegistry;
  }
  var parts = await Promise.all(files.map(function (f) { return loadPharmacyMonth(f.year, f.month); }));
  var all = [];
  parts.forEach(function (rows) { all = all.concat(rows); });
  console.log('[PDM52] loadAll() tamamlandı:', all.length, 'satır,', files.length, 'ay');
  return all;
}

// ── clearCache() ─────────────────────────────────────────────────────
function clearCache() {
  window.pharmacyCache        = {};
  window.pharmacyStore.cache  = {};
  window.pharmacyStore.normalized  = [];
  window.pharmacyStore.byPharmacy  = {};
  window.pharmacyStore.byBrick     = {};
  window.pharmacyStore.byProduct   = {};
  window.pharmacyActiveData        = [];
  _discoveryDone    = false;
  _discoveryPromise = null;
  _inflight = {}; _missing = {}; _allLoaded = false; _bgPromise = null;
  console.log('[PDM52] Cache temizlendi');
}

// ── getPharmacyStore() ───────────────────────────────────────────────
function getPharmacyStore() {
  return window.pharmacyStore;
}

// ── getFilteredData(filters) ─────────────────────────────────────────
// filters: { years:[], months:[], ttt:string, brick:string, urun:string }
function getFilteredData(filters) {
  filters = filters || {};
  var base = window.pharmacyStore.normalized;
  if (!base || !base.length) {
    // Fallback: pharmacyActiveData normalize et
    base = (window.pharmacyActiveData || []).map(function(r) {
      var p = (r.ay||'').split('/');
      var mo = parseInt(p[0],10)||0;
      var yr = parseInt(p[1],10)||0;
      return _normalizeRow(r, yr, mo);
    });
  }

  return base.filter(function(n) {
    if (filters.years && filters.years.length && filters.years.indexOf(n.year) === -1)   return false;
    if (filters.months && filters.months.length && filters.months.indexOf(n.month) === -1) return false;
    if (filters.ttt   && filters.ttt !== 'TÜMÜ' && n.temsilci !== filters.ttt)           return false;
    if (filters.brick && filters.brick !== 'TÜMÜ' && n.brick !== filters.brick)           return false;
    if (filters.urun  && filters.urun !== 'TÜMÜ' && n.urun !== filters.urun)             return false;
    return true;
  });
}


  // ── Public API ────────────────────────────────────────────────────────
  // ── reresolveTTT — FAZ 12.3/12.4 BUG DÜZELTMESİ ────────────────────
  //
  // FAZ 12.3'te bulunan sorunun AYNISI, İKİNCİ bir bağımsız yerde daha
  // tespit edildi ("Bugünkü Akıllı Rota" / route-optimizer.js boş
  // dönüyordu): loadPharmacyMonth() (bu dosyada, aylık lazy-loader) VE
  // index.html/ai-context.js/ai-engine.js'deki parseEczaneCSV() çağrıları
  // da AYNI şekilde getBrickTTTMap()'i erken (IMS/MIGI_TL_RAW boşken)
  // çağırıp `ttt`'yi satıra KALICI olarak "pişiriyordu" — ama bu sefer
  // pharmacyStore.normalized DEĞİL, window.pharmacyCache[ay] ve
  // window.ECZANE_RAW dizilerinde. Bu ikisi de route-optimizer.js'in
  // dayandığı pharmacy-intelligence.js::buildPharmacyProfiles()'ın
  // ham veri kaynağı — dolayısıyla "Bugünkü Akıllı Rota" ve "Haftalık
  // Rota" (AI önerisi) de boş/eksik çıkıyordu.
  //
  // Ayrıca route-optimizer.js/pharmacy-intelligence.js kendi sonuçlarını
  // (window.ROUTE_OPTIMIZER / window.PHARMACY_INTELLIGENCE) bir CACHE
  // olarak değil, "bir kez üretilip saklanan SNAPSHOT" olarak tutuyor —
  // ttt alanları düzelse bile bu snapshot'lar kendiliğinden yenilenmez.
  // Bu yüzden düzeltmeden sonra ikisini de (varsa) yeniden çalıştırıyoruz.
  function reresolveTTT() {
    if (typeof getBrickTTTMap !== 'function') return 0;
    var map = getBrickTTTMap();
    if (!map || !Object.keys(map).length) return 0; // IMS/MIGI henüz hazır değil — sessizce çık, sonra tekrar denenir

    var fixed = 0;

    // 1) pharmacyStore.normalized (temsilci alanı)
    if (window.pharmacyStore && window.pharmacyStore.normalized) {
      window.pharmacyStore.normalized.forEach(function (r) {
        if (!r.temsilci && r.brick) {
          var t = map[r.brick.toUpperCase()];
          if (t) { r.temsilci = t; fixed++; }
        }
      });
    }

    // 2) pharmacyCache (her ay için ayrı ayrı, ttt alanı) — pharmacyActiveData
    //    bu dizilerle AYNI satır nesnelerini referans aldığı için (concat
    //    sadece diziyi kopyalar, nesneleri değil) otomatik düzelir.
    if (window.pharmacyCache) {
      Object.keys(window.pharmacyCache).forEach(function (key) {
        (window.pharmacyCache[key] || []).forEach(function (r) {
          if (!r.ttt && r.brick) {
            var t = map[r.brick.toUpperCase()];
            if (t) { r.ttt = t; fixed++; }
          }
        });
      });
    }

    // 3) ECZANE_RAW — bazı yollarda (ai-context.js, ai-engine.js) kendi
    //    BAĞIMSIZ parseEczaneCSV() çağrısıyla oluşuyor, pharmacyCache'ten
    //    farklı nesneler — ayrıca düzeltilmesi gerekiyor.
    if (typeof ECZANE_RAW !== 'undefined' && ECZANE_RAW && ECZANE_RAW.length) {
      ECZANE_RAW.forEach(function (r) {
        if (!r.ttt && r.brick) {
          var t = map[r.brick.toUpperCase()];
          if (t) { r.ttt = t; fixed++; }
        }
      });
    }

    if (fixed > 0) {
      console.log('[PDM52] reresolveTTT: ' + fixed + ' kayıtta temsilci/ttt alanı geriye dolduruldu (brick→ttt haritası artık hazır).');
      if (window.PharmacyAdapter && typeof window.PharmacyAdapter.clearCache === 'function') window.PharmacyAdapter.clearCache();
      if (window.PharmacyBehaviorEngine && typeof window.PharmacyBehaviorEngine.clearCache === 'function') window.PharmacyBehaviorEngine.clearCache();
      if (window.PharmacyRanking && typeof window.PharmacyRanking.clearCache === 'function') window.PharmacyRanking.clearCache();

      // FAZ 12.4: route-optimizer.js / pharmacy-intelligence.js kendi
      // snapshot'larını (ROUTE_OPTIMIZER / PHARMACY_INTELLIGENCE) yeniden
      // üretsin — ttt alanları artık doğru.
      var _ttt = (typeof engineSelTTT !== 'undefined' && engineSelTTT) ||
                 (typeof selTTT !== 'undefined' && selTTT) || undefined;
      if (typeof window.runPharmacyIntelligence === 'function') {
        try { window.runPharmacyIntelligence(_ttt); } catch (e) { console.warn('[PDM52] runPharmacyIntelligence yeniden çalıştırma hatası:', e.message); }
      }
      if (typeof window.runRouteOptimizer === 'function') {
        try { window.runRouteOptimizer(_ttt); } catch (e) { console.warn('[PDM52] runRouteOptimizer yeniden çalıştırma hatası:', e.message); }
      }

      // Eczane sayfası açıksa ekranı güncelle
      if (typeof curPage !== 'undefined' && curPage === 5 && typeof renderEczaneContent === 'function') {
        renderEczaneContent();
      }
    }
    return fixed;
  }

  window.PharmacyDataManager = {
    discoverPharmacyFiles:        discoverPharmacyFiles,
    loadPharmacyMonth:            loadPharmacyMonth,
    loadPharmacyMultiMonth:       loadPharmacyMultiMonth,
    getActivePharmacyData:        getActivePharmacyData,
    initPharmacyDataManager:      initPharmacyDataManager,
    getAvailableYears:            getAvailableYears,
    getAvailableMonths:           getAvailableMonths,
    selectYear:                   selectYear,
    selectOnlyYear:               selectOnlyYear,
    selectMonth:                  selectMonth,
    renderPharmacyYearFilter:     renderPharmacyYearFilter,
    renderPharmacyMonthFilter:    renderPharmacyMonthFilter,
    buildReorderPredictionScores: buildReorderPredictionScores,
    buildMonthlyTrendAnalysis:    buildMonthlyTrendAnalysis,
    buildTop30VisitPriority:      buildTop30VisitPriority,
    buildRouteOptimizer:          buildRouteOptimizer,
    getOrderHistory:              _getOrderHistory,
    detectPattern:                _detectPattern,
    patternLabel:                 _patternLabel,
    refreshFilterUI:              _refreshFilterUI,
    ayIsimleri:                   AY_ISIMLERI,
    // PHASE 5.2: pharmacyStore API
    loadAll:                      loadAll,
    clearCache:                   clearCache,
    getPharmacyStore:             getPharmacyStore,
    getFilteredData:              getFilteredData,
    updatePharmacyStore:          _updatePharmacyStore,
    normalizeRow:                 _normalizeRow,
    reresolveTTT:                 reresolveTTT,
    ensureAllMonths:              ensureAllMonths,
    whenAllLoaded:                function () { return _bgPromise || Promise.resolve(); },
    isAllLoaded:                  function () { return _allLoaded; },
  };

  // Sayfa yüklenince arka planda başlat
  if (document.readyState === 'complete') {
    setTimeout(initPharmacyDataManager, 800);
  } else {
    window.addEventListener('load', function(){
      setTimeout(initPharmacyDataManager, 800);
    });
  }

  console.log('[PDM52] pharmacy-data-manager.js v3 (Phase 5.2 complete) yüklendi ✅');

})();
