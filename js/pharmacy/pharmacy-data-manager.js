// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/pharmacy-data-manager.js — PHASE 5.2
//  Monthly Pharmacy Data Architecture (Enterprise Scale)
//
//  Sorumluluk:
//    • discoverPharmacyFiles()        → ECZANE/ klasöründeki tüm aylık dosyaları keşfet
//    • loadPharmacyMonth(year, month) → lazy load + smart cache
//    • loadPharmacyMultiMonth(year)   → tüm ay birleşik yükleme
//    • getActivePharmacyData()        → aktif filtre sonucuna göre veri döndür
//    • renderPharmacyYearFilter()     → yıl filtresi DOM güncelleme
//    • renderPharmacyMonthFilter()    → ay filtresi DOM güncelleme
//    • buildReorderPredictionScores() → 0-100 reorder skoru hesapla
//    • buildMonthlyTrendAnalysis()    → sipariş örüntüsü tespiti
//    • buildTop30VisitPriority()      → çok-boyutlu skor ile Top 30
//    • buildRouteOptimizer()          → brick bazlı haftalık rota
//
//  Global State:
//    window.pharmacyFileRegistry     → keşfedilen dosya meta listesi
//    window.pharmacyCache            → "YYYY_MM" → parsed rows
//    window.pharmacyActiveFilter     → { year, month } (month=null → tümü)
//    window.pharmacyActiveData       → aktif filtreye göre ECZANE_RAW benzeri array
//
//  Bağımlılıklar:
//    constants.js  → GITHUB_RAW_BASE (veya türetilir)
//    data-state.js → getBrickTTTMap() (index.html'den)
//
//  Geriye Dönük Uyumluluk:
//    ECZANE_RAW ve eczaneLoaded global değişkenleri güncellenir
//    parseEczaneCSV() hâlâ kullanılır (index.html'den)
//
//  GitHub Pages compatible: classic script, IIFE, no ES modules
//  Hiçbir yerde hardcoded yıl/ay karşılaştırması YOKTUR.
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────────
  if (window._PDM52_LOADED) {
    console.warn('[PharmacyDataManager] Zaten yüklü — atlandı');
    return;
  }
  window._PDM52_LOADED = true;

  // ── GitHub Raw Base ───────────────────────────────────────────────────
  // constants.js'den türetilir; fallback olarak repo URL'yi tespit eder
  var REPO_RAW_BASE = (function () {
    if (typeof GITHUB_IMG_BASE !== 'undefined') {
      // "https://raw.githubusercontent.com/.../main/images/" → "https://raw.githubusercontent.com/.../main/"
      return GITHUB_IMG_BASE.replace(/images\/?$/, '');
    }
    // Fallback
    return 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/';
  })();

  var ECZANE_DIR = 'ECZANE/';

  // Türkçe ay isimleri — sıralı, index = ay numarası - 1
  var AY_ISIMLERI = [
    'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
    'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'
  ];

  // ── Global State Tanımları ────────────────────────────────────────────
  window.pharmacyFileRegistry = window.pharmacyFileRegistry || [];
  window.pharmacyCache        = window.pharmacyCache        || {};
  window.pharmacyActiveFilter = window.pharmacyActiveFilter || { year: null, month: null };
  window.pharmacyActiveData   = window.pharmacyActiveData   || [];

  // Yıl+ay bazlı yükleme durumu
  var _loadingKeys = {};   // "YYYY_MM" → true (in-progress)
  var _discoveryDone = false;
  var _discoveryPromise = null;

  // ── Dosya İsimlendirme Yardımcıları ──────────────────────────────────

  /**
   * Yıl + ay'dan dosya adı üret
   * @param {number} year
   * @param {number} month  1-12
   * @returns {string}  "2026_04_Eczane.csv"
   */
  function _fileName(year, month) {
    var mm = String(month).padStart(2, '0');
    return year + '_' + mm + '_Eczane.csv';
  }

  /**
   * Dosya adından meta nesnesi üret
   * @param {string} name  "2026_04_Eczane.csv"
   * @returns {{year, month, file, key}|null}
   */
  function _parseName(name) {
    var m = /^(\d{4})_(\d{2})_Eczane\.csv$/i.exec(name.trim());
    if (!m) return null;
    var year  = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return null;
    return { year: year, month: month, file: name.trim(), key: year + '_' + m[2] };
  }

  /**
   * Dosyanın GitHub raw URL'ini döndür
   */
  function _fileUrl(file) {
    return REPO_RAW_BASE + ECZANE_DIR + file + '?v=' + Date.now();
  }

  // ── 1. AUTO FILE DISCOVERY ───────────────────────────────────────────

  /**
   * ECZANE/ klasöründeki tüm YYYY_MM_Eczane.csv dosyalarını keşfeder.
   *
   * GitHub Pages'te dizin listeleme API'si yoktur. Bu nedenle strateji:
   *   1. Bugünden geriye 36 ay taranır (HEAD isteği ile varlık kontrolü)
   *   2. Başarılı olanlar registry'e eklenir
   *   3. Sonuç window.pharmacyFileRegistry'de saklanır
   *
   * Performans: Promise.allSettled ile paralel HEAD istekleri kullanılır.
   * @returns {Promise<Array>}
   */
  async function discoverPharmacyFiles() {
    if (_discoveryDone) return window.pharmacyFileRegistry;
    if (_discoveryPromise) return _discoveryPromise;

    _discoveryPromise = (async function () {
      console.log('[PDM52] Dosya keşfi başlıyor…');

      // Taranacak tarih aralığı: bugünden 36 ay geriye, 12 ay ileriye
      var now    = new Date();
      var dates  = [];
      for (var delta = -36; delta <= 12; delta++) {
        var d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        dates.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }

      // Paralel HEAD istekleri (rate-limit dostu: 48 ms arayla batch)
      var BATCH_SIZE = 8;
      var found = [];

      for (var i = 0; i < dates.length; i += BATCH_SIZE) {
        var batch = dates.slice(i, i + BATCH_SIZE);
        var results = await Promise.allSettled(batch.map(function (d) {
          var file = _fileName(d.year, d.month);
          var url  = REPO_RAW_BASE + ECZANE_DIR + file;
          return fetch(url, { method: 'HEAD', cache: 'no-store' })
            .then(function (r) {
              return { d: d, file: file, ok: r.ok && r.status === 200 };
            })
            .catch(function () {
              return { d: d, file: file, ok: false };
            });
        }));

        results.forEach(function (res) {
          if (res.status === 'fulfilled' && res.value.ok) {
            var meta = _parseName(res.value.file);
            if (meta) found.push(meta);
          }
        });

        // Küçük duraklama (429 önlemi)
        if (i + BATCH_SIZE < dates.length) {
          await new Promise(function (r) { setTimeout(r, 80); });
        }
      }

      // Tarih sırasına göre sırala
      found.sort(function (a, b) {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });

      window.pharmacyFileRegistry = found;
      _discoveryDone = true;

      console.log('[PDM52] Keşif tamamlandı:', found.length, 'dosya bulundu',
        found.map(function (f) { return f.key; }));

      // Filtre state'ini otomatik başlat (en güncel ay)
      if (found.length && !window.pharmacyActiveFilter.year) {
        var latest = found[found.length - 1];
        window.pharmacyActiveFilter.year  = latest.year;
        window.pharmacyActiveFilter.month = latest.month;
      }

      return found;
    })();

    return _discoveryPromise;
  }

  // ── 2. LAZY LOADING + 3. SMART CACHE ─────────────────────────────────

  /**
   * Tek ay yükler. Cache'te varsa diskten okumaz.
   * @param {number} year
   * @param {number} month
   * @returns {Promise<Array>}  parseEczaneCSV() çıktısı
   */
  async function loadPharmacyMonth(year, month) {
    var mm   = String(month).padStart(2, '0');
    var key  = year + '_' + mm;
    var file = _fileName(year, month);

    // ── Cache HIT ──────────────────────────────────────────────────────
    if (window.pharmacyCache[key]) {
      console.log('[PDM52] Cache hit:', key, window.pharmacyCache[key].length, 'rows');
      return window.pharmacyCache[key];
    }

    // ── Already loading (debounce) ─────────────────────────────────────
    if (_loadingKeys[key]) {
      console.log('[PDM52] Zaten yükleniyor:', key);
      return new Promise(function (resolve) {
        var poll = setInterval(function () {
          if (!_loadingKeys[key]) {
            clearInterval(poll);
            resolve(window.pharmacyCache[key] || []);
          }
        }, 100);
      });
    }

    _loadingKeys[key] = true;
    var url = _fileUrl(file);
    console.log('[PDM52] Yükleniyor:', key, url);

    try {
      var resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        console.warn('[PDM52] HTTP', resp.status, '→', file);
        window.pharmacyCache[key] = [];
        return [];
      }

      var csv = await resp.text();
      if (!csv || csv.trim().startsWith('<')) {
        console.warn('[PDM52] CSV değil (HTML geldi):', file);
        window.pharmacyCache[key] = [];
        return [];
      }

      // parseEczaneCSV() index.html'de tanımlı — global scope
      var rows = [];
      if (typeof parseEczaneCSV === 'function') {
        rows = parseEczaneCSV(csv);
      } else {
        console.error('[PDM52] parseEczaneCSV bulunamadı! index.html doğru yüklendi mi?');
        rows = [];
      }

      // TTT ataması (brick üzerinden)
      if (typeof getBrickTTTMap === 'function') {
        var brickTTT = getBrickTTTMap();
        rows.forEach(function (r) {
          if (!r.ttt && r.brick) {
            r.ttt = brickTTT[r.brick.toUpperCase()] || null;
          }
        });
      }

      // Cache'e kaydet
      window.pharmacyCache[key] = rows;
      console.log('[PDM52] Yüklendi:', key, rows.length, 'satır');
      return rows;

    } catch (err) {
      console.error('[PDM52] Yükleme hatası:', key, err.message);
      window.pharmacyCache[key] = [];
      return [];
    } finally {
      _loadingKeys[key] = false;
    }
  }

  /**
   * Bir yılın tüm aylarını birleştirerek yükler (Multi-Month Mode).
   * @param {number} year
   * @returns {Promise<Array>}  birleşik rows
   */
  async function loadPharmacyMultiMonth(year) {
    var registry = window.pharmacyFileRegistry;
    var yearFiles = registry.filter(function (f) { return f.year === year; });

    if (!yearFiles.length) {
      console.warn('[PDM52] Multi-month:', year, 'için dosya bulunamadı');
      return [];
    }

    var allRows = [];
    for (var i = 0; i < yearFiles.length; i++) {
      var rows = await loadPharmacyMonth(yearFiles[i].year, yearFiles[i].month);
      allRows = allRows.concat(rows);
    }

    console.log('[PDM52] Multi-month', year, '→', allRows.length, 'satır');
    return allRows;
  }

  /**
   * Aktif filtreye göre veri yükler ve window.pharmacyActiveData + ECZANE_RAW günceller.
   * @returns {Promise<Array>}
   */
  async function getActivePharmacyData() {
    var filter = window.pharmacyActiveFilter;
    var rows   = [];

    if (!filter.year) {
      console.warn('[PDM52] Aktif filtre yok');
      return [];
    }

    if (!filter.month) {
      // Tümü modu
      rows = await loadPharmacyMultiMonth(filter.year);
    } else {
      rows = await loadPharmacyMonth(filter.year, filter.month);
    }

    window.pharmacyActiveData = rows;

    // Geriye dönük uyumluluk: ECZANE_RAW ve eczaneLoaded güncelle
    if (typeof ECZANE_RAW !== 'undefined') {
      window.ECZANE_RAW   = rows;
      window.eczaneLoaded = rows.length > 0;
    }

    return rows;
  }

  // ── 4-5. YIL / AY FİLTRELERİ ─────────────────────────────────────────

  /**
   * Registry'den benzersiz yılları döndürür.
   * @returns {number[]}
   */
  function getAvailableYears() {
    var years = [];
    window.pharmacyFileRegistry.forEach(function (f) {
      if (years.indexOf(f.year) === -1) years.push(f.year);
    });
    years.sort(function (a, b) { return a - b; });
    return years;
  }

  /**
   * Belirli bir yılın mevcut aylarını döndürür.
   * @param {number} year
   * @returns {number[]}  1-12 arasında
   */
  function getAvailableMonths(year) {
    var months = window.pharmacyFileRegistry
      .filter(function (f) { return f.year === year; })
      .map(function (f) { return f.month; });
    months.sort(function (a, b) { return a - b; });
    return months;
  }

  /**
   * Yıl filtresi DOM elemanını günceller.
   * @param {string} containerId  hedef container element id
   * @param {Function} onSelect   seçim callback(year)
   */
  function renderPharmacyYearFilter(containerId, onSelect) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var years = getAvailableYears();
    var active = window.pharmacyActiveFilter.year;

    el.innerHTML = years.map(function (y) {
      var cls = y === active ? 'tfb-sp active' : 'tfb-sp';
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectYear(' + y + ')">' + y + '</button>';
    }).join('');
  }

  /**
   * Ay filtresi DOM elemanını günceller.
   * Yalnızca seçili yılda mevcut olan ayları gösterir.
   * @param {string} containerId
   * @param {Function} onSelect
   */
  function renderPharmacyMonthFilter(containerId, onSelect) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var filter = window.pharmacyActiveFilter;
    if (!filter.year) { el.innerHTML = ''; return; }

    var months  = getAvailableMonths(filter.year);
    var active  = filter.month;

    var html = '<button class="tfb-sp' + (active === null ? ' active' : '') + '" onclick="PharmacyDataManager.selectMonth(null)">Tümü</button>';
    html += months.map(function (m) {
      var label = AY_ISIMLERI[m - 1];
      var cls   = m === active ? 'tfb-sp active' : 'tfb-sp';
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectMonth(' + m + ')">' + label + '</button>';
    }).join('');

    el.innerHTML = html;
  }

  // ── 7-9. AI SALES INTELLIGENCE ENGINE ───────────────────────────────

  /**
   * Bir eczane GLN'i için tüm aylardaki sipariş geçmişini birleştirir.
   * window.pharmacyCache tüm yüklenmiş ayları kapsar.
   * @param {string} gln
   * @returns {Array<{key, month, year, adet}>}  sıralı kronolojik
   */
  function _getOrderHistory(gln) {
    var history = [];
    Object.keys(window.pharmacyCache).forEach(function (key) {
      var rows = window.pharmacyCache[key];
      var m = /^(\d{4})_(\d{2})$/.exec(key);
      if (!m) return;
      var year  = parseInt(m[1], 10);
      var month = parseInt(m[2], 10);
      var total = 0;
      rows.forEach(function (r) { if (r.gln === gln) total += (r.adet || 0); });
      history.push({ key: key, year: year, month: month, adet: total });
    });
    history.sort(function (a, b) {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
    return history;
  }

  /**
   * Doğrusal regresyon eğimi (trend slope) hesaplar.
   * @param {number[]} values
   * @returns {number}
   */
  function _trendSlope(values) {
    var n = values.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX  += i;
      sumY  += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  /**
   * Sipariş örüntüsünü tespit eder.
   * @param {number[]} values  kronolojik sipariş adetleri
   * @returns {string}
   */
  function _detectPattern(values) {
    if (!values || values.length === 0) return 'UNKNOWN';

    var nonZero = values.filter(function (v) { return v > 0; });
    var total   = values.reduce(function (s, v) { return s + v; }, 0);
    var n       = values.length;
    var slope   = _trendSlope(values);

    // Tek seferlik büyük alım (Kampanya): nonZero 1 ve ilk ay büyük
    if (nonZero.length === 1 && values[0] > 50) return 'CAMPAIGN_BUYER';

    // Son ay aktif, öncesi hep sıfır: Yeni aktif müşteri
    if (values[values.length - 1] > 0 && nonZero.length === 1) return 'NEW_ACTIVE';

    // Düzenli müşteri: her ay sipariş var, düşük varyasyon
    if (nonZero.length === n && n >= 3) {
      var mean = total / n;
      var variance = values.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / n;
      var cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      if (cv < 0.25) return 'REGULAR_BUYER';
    }

    // Güçlü büyüme: pozitif slope
    if (slope > 3 && nonZero.length >= 3) return 'GROWING';

    // Kayıp müşteri riski: son 3 ay sıfır
    var lastThree = values.slice(-3);
    if (lastThree.every(function (v) { return v === 0; }) && total > 0) return 'AT_RISK';

    // Yeniden aktive edilebilir
    if (nonZero.length > 0 && nonZero.length < n * 0.5) return 'REACTIVATION';

    return 'OTHER';
  }

  // ── 8. REORDER PREDICTION SCORE ──────────────────────────────────────

  /**
   * Her eczane için 0-100 reorder skoru hesaplar.
   * Veri: window.pharmacyActiveData + cache'teki geçmiş aylar.
   * @param {string} ttt  temsilci filtresi (null = tümü)
   * @returns {Array<{gln, ad, brick, ttt, reorderScore, pattern, ...}>}
   */
  function buildReorderPredictionScores(ttt) {
    var activeData = window.pharmacyActiveData || [];
    if (!activeData.length) return [];

    // Benzersiz eczaneler
    var eczaneMap = {};
    activeData.forEach(function (r) {
      if (!r.gln) return;
      if (ttt && r.ttt !== ttt) return;
      if (!eczaneMap[r.gln]) {
        eczaneMap[r.gln] = { gln: r.gln, ad: r.ad, brick: r.brick, ttt: r.ttt };
      }
    });

    var results = [];

    Object.keys(eczaneMap).forEach(function (gln) {
      var meta    = eczaneMap[gln];
      var history = _getOrderHistory(gln);
      var values  = history.map(function (h) { return h.adet; });

      if (!values.length) return;

      var nonZero    = values.filter(function (v) { return v > 0; });
      var total      = values.reduce(function (s, v) { return s + v; }, 0);
      var activeMonths = nonZero.length;
      var lastVal    = values[values.length - 1] || 0;
      var slope      = _trendSlope(values);
      var pattern    = _detectPattern(values);

      // Son sipariş ayı index
      var lastActiveIdx = -1;
      for (var i = values.length - 1; i >= 0; i--) {
        if (values[i] > 0) { lastActiveIdx = i; break; }
      }
      var monthsSinceLastOrder = lastActiveIdx >= 0
        ? values.length - 1 - lastActiveIdx
        : values.length;

      // Ortalama sipariş döngüsü (ay)
      var avgCycle = activeMonths > 1
        ? (values.length - 1) / (activeMonths - 1)
        : 2;

      // ── Skor bileşenleri (toplam 100 puan) ────────────────────────
      var score = 0;

      // 1. Sipariş döngüsüne yakınlık (30 puan)
      //    avgCycle ay aralıklarla sipariş veriyor
      //    monthsSinceLastOrder ≈ avgCycle ise yakın
      if (avgCycle > 0 && monthsSinceLastOrder > 0) {
        var cycleRatio = monthsSinceLastOrder / avgCycle;
        var cyclePts   = Math.min(30, Math.round(cycleRatio * 30));
        score += cyclePts;
      }

      // 2. Büyüme momentum (20 puan)
      if (slope > 0) score += Math.min(20, Math.round(slope * 4));

      // 3. Aktif ay yoğunluğu (15 puan)
      if (values.length > 0) {
        score += Math.round((activeMonths / values.length) * 15);
      }

      // 4. Örüntü bonus (20 puan)
      var patternBonus = {
        'GROWING':       20,
        'REGULAR_BUYER': 18,
        'NEW_ACTIVE':    12,
        'REACTIVATION':  10,
        'CAMPAIGN_BUYER': 5,
        'AT_RISK':        2,
        'OTHER':          5
      };
      score += (patternBonus[pattern] || 5);

      // 5. Son ay aktivitesi (15 puan)
      if (lastVal > 0) score += Math.min(15, Math.round((lastVal / Math.max(1, total / activeMonths)) * 10));

      // Skor sınırları
      score = Math.max(0, Math.min(100, score));

      results.push({
        gln:                gln,
        ad:                 meta.ad,
        brick:              meta.brick,
        ttt:                meta.ttt,
        reorderScore:       score,
        pattern:            pattern,
        totalBoxes:         total,
        activeMonths:       activeMonths,
        monthsSinceLastOrder: monthsSinceLastOrder,
        avgOrderCycle:      Math.round(avgCycle * 10) / 10,
        trendSlope:         Math.round(slope * 100) / 100,
        lastMonthBoxes:     lastVal,
        historyLength:      values.length
      });
    });

    // Skora göre sırala
    results.sort(function (a, b) { return b.reorderScore - a.reorderScore; });
    return results;
  }

  // ── 9. MONTHLY TREND ANALYSIS ────────────────────────────────────────

  /**
   * Tüm eczaneler için trend analizi üretir.
   * @param {string} ttt
   * @returns {Array}
   */
  function buildMonthlyTrendAnalysis(ttt) {
    var scores = buildReorderPredictionScores(ttt);
    return scores.map(function (s) {
      var history = _getOrderHistory(s.gln);
      var values  = history.map(function (h) { return h.adet; });
      return Object.assign({}, s, {
        monthlyHistory: values,
        patternLabel:   _patternLabel(s.pattern)
      });
    });
  }

  function _patternLabel(pattern) {
    var labels = {
      'GROWING':       '📈 Güçlü Büyüme',
      'REGULAR_BUYER': '🔄 Düzenli Müşteri',
      'NEW_ACTIVE':    '🆕 Yeni Aktif',
      'REACTIVATION':  '♻️ Yeniden Aktive',
      'CAMPAIGN_BUYER':'🎯 Kampanya Alımı',
      'AT_RISK':       '⚠️ Kayıp Riski',
      'OTHER':         '📊 Diğer'
    };
    return labels[pattern] || '📊 Diğer';
  }

  // ── 10. TOP 30 VISIT PRIORITY ─────────────────────────────────────────

  /**
   * Çok-boyutlu skor ile Top 30 eczane listesi döndürür.
   * Skor = reorderScore × brickPriority × growthPotential × targetGapContribution
   * @param {string} ttt
   * @param {Array}  genelData  GENEL array (hedef verileri için, opsiyonel)
   * @returns {Array}  ilk 30
   */
  function buildTop30VisitPriority(ttt, genelData) {
    var scores = buildReorderPredictionScores(ttt);

    // Brick öncelik haritası — TR_SIRA_MAP'ten türetilir
    var brickPriorityMap = {};
    if (typeof TR_SIRA_MAP !== 'undefined') {
      // Brick bazlı sıralama yok, temsilci sırası kullanılır (proxy)
      // Gelecekte brick özel öncelik tablosu eklenebilir
    }

    // Hedef açığı katkısı (GENEL verisi varsa)
    var targetGapMap = {};
    if (genelData && genelData.length && ttt) {
      var tttRows = genelData.filter(function (r) { return r.ttt === ttt; });
      tttRows.forEach(function (r) {
        if (r.brick && r.hedef && r.satis) {
          var gap = Math.max(0, (r.hedef - r.satis) / Math.max(1, r.hedef));
          targetGapMap[r.brick] = Math.min(1.5, 1 + gap);
        }
      });
    }

    var ranked = scores.map(function (s) {
      var brickPriority = targetGapMap[s.brick] || 1.0;

      // Büyüme potansiyeli: slope pozitifse bonus
      var growthPotential = s.trendSlope > 0
        ? Math.min(1.5, 1 + s.trendSlope / 20)
        : Math.max(0.5, 1 + s.trendSlope / 40);

      // Composite skor
      var composite = s.reorderScore * brickPriority * growthPotential;

      return Object.assign({}, s, {
        brickPriority:        Math.round(brickPriority * 100) / 100,
        growthPotential:      Math.round(growthPotential * 100) / 100,
        targetGapContribution: Math.round(brickPriority * 100) / 100,
        visitPriorityScore:   Math.round(composite * 10) / 10
      });
    });

    ranked.sort(function (a, b) { return b.visitPriorityScore - a.visitPriorityScore; });
    return ranked.slice(0, 30);
  }

  // ── 11. ROUTE OPTIMIZER ───────────────────────────────────────────────

  /**
   * Top 30 eczaneyi brick bazında günlere dağıtır.
   * @param {string} ttt
   * @param {Array}  top30  buildTop30VisitPriority() çıktısı (opsiyonel)
   * @returns {Array<{day, dayLabel, bricks, pharmacies}>}
   */
  function buildRouteOptimizer(ttt, top30) {
    var DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
    if (!top30) top30 = buildTop30VisitPriority(ttt);

    // Brick'e göre grupla
    var brickGroups = {};
    top30.forEach(function (p) {
      var b = p.brick || 'DİĞER';
      if (!brickGroups[b]) brickGroups[b] = [];
      brickGroups[b].push(p);
    });

    // Brick listesi (en yüksek ortalama visitPriorityScore önce)
    var bricks = Object.keys(brickGroups).sort(function (a, b) {
      var avgA = brickGroups[a].reduce(function (s, p) { return s + p.visitPriorityScore; }, 0) / brickGroups[a].length;
      var avgB = brickGroups[b].reduce(function (s, p) { return s + p.visitPriorityScore; }, 0) / brickGroups[b].length;
      return avgB - avgA;
    });

    // Günlere sırayla ata
    var route = DAYS.map(function (day, i) {
      return { day: day, dayIndex: i + 1, bricks: [], pharmacies: [] };
    });

    bricks.forEach(function (brick, idx) {
      var dayIdx = idx % DAYS.length;
      route[dayIdx].bricks.push(brick);
      brickGroups[brick].forEach(function (p) {
        route[dayIdx].pharmacies.push(p);
      });
    });

    // Boş günleri filtrele
    var activeRoute = route.filter(function (d) { return d.pharmacies.length > 0; });

    console.log('[PDM52] Rota:', activeRoute.map(function (d) {
      return d.day + ':' + d.bricks.join(',');
    }).join(' | '));

    return activeRoute;
  }

  // ── Yıl Seçim Aksiyonu ────────────────────────────────────────────────

  async function selectYear(year) {
    window.pharmacyActiveFilter.year  = year;
    window.pharmacyActiveFilter.month = null; // ay sıfırla

    // Yeni yılın ilk ayını önceden yükle (UX için)
    var months = getAvailableMonths(year);
    if (months.length) {
      window.pharmacyActiveFilter.month = months[months.length - 1]; // en son ay
    }

    await getActivePharmacyData();

    // UI güncelle (sayfa render fonksiyonu varsa çağır)
    if (typeof renderEczane === 'function') renderEczane();
    else if (typeof buildEczaneFilters === 'function') {
      buildEczaneFilters();
      if (typeof renderEczaneContent === 'function') renderEczaneContent();
    }
  }

  async function selectMonth(month) {
    window.pharmacyActiveFilter.month = month; // null = tümü
    await getActivePharmacyData();

    if (typeof renderEczane === 'function') renderEczane();
    else if (typeof buildEczaneFilters === 'function') {
      buildEczaneFilters();
      if (typeof renderEczaneContent === 'function') renderEczaneContent();
    }
  }

  // ── İlk Yükleme: syncData tamamlandıktan sonra çağır ─────────────────

  /**
   * Phase 5.2 başlatma noktası.
   * syncData() tamamlandıktan sonra çağrılmalı.
   * Eczane sayfası açıldığında da çağrılabilir.
   */
  async function initPharmacyDataManager() {
    console.log('[PDM52] Başlatılıyor…');

    // Dosya keşfi
    await discoverPharmacyFiles();

    // Aktif filtre için veri yükle
    var filter = window.pharmacyActiveFilter;
    if (filter.year) {
      await getActivePharmacyData();
      console.log('[PDM52] Aktif data yüklendi:',
        window.pharmacyActiveData.length, 'satır',
        '| Filtre:', filter.year, filter.month ? AY_ISIMLERI[filter.month - 1] : 'Tümü'
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  window.PharmacyDataManager = {
    // Core
    discoverPharmacyFiles:       discoverPharmacyFiles,
    loadPharmacyMonth:           loadPharmacyMonth,
    loadPharmacyMultiMonth:      loadPharmacyMultiMonth,
    getActivePharmacyData:       getActivePharmacyData,
    initPharmacyDataManager:     initPharmacyDataManager,

    // Filtreler
    getAvailableYears:           getAvailableYears,
    getAvailableMonths:          getAvailableMonths,
    selectYear:                  selectYear,
    selectMonth:                 selectMonth,
    renderPharmacyYearFilter:    renderPharmacyYearFilter,
    renderPharmacyMonthFilter:   renderPharmacyMonthFilter,

    // AI Intelligence
    buildReorderPredictionScores: buildReorderPredictionScores,
    buildMonthlyTrendAnalysis:   buildMonthlyTrendAnalysis,
    buildTop30VisitPriority:     buildTop30VisitPriority,
    buildRouteOptimizer:         buildRouteOptimizer,

    // Yardımcılar
    getOrderHistory:             _getOrderHistory,
    detectPattern:               _detectPattern,
    patternLabel:                _patternLabel,
    ayIsimleri:                  AY_ISIMLERI,
  };

  // ── Otomatik Init Tetikleyici ─────────────────────────────────────────
  // syncData() tamamlandıktan sonra çalışır
  // Eğer syncData zaten bitti (late script load), hemen çalıştır
  var _autoInitDelay = 500;
  if (document.readyState === 'complete') {
    setTimeout(initPharmacyDataManager, _autoInitDelay);
  } else {
    window.addEventListener('load', function () {
      setTimeout(initPharmacyDataManager, _autoInitDelay);
    });
  }

  console.log('[PDM52] pharmacy-data-manager.js Phase 5.2 yüklendi ✅');

})();
