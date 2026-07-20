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
    return 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/';
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
  var _loadingKeys      = {};

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

  // ── 1. AUTO FILE DISCOVERY ────────────────────────────────────────────
  // Strateji: HEAD istekleri yerine, bugünden ±24 ay aralığını
  // PARALEL fetch (içerik yok, sadece 200/404 kontrolü) ile tarar.
  // Başarılı olanlar registry'e eklenir.
  // HEAD istekleri GitHub raw'da güvenilmez olduğundan
  // fetch(..., {method:'HEAD'}) yerine GET + abort kullanılır.
  async function discoverPharmacyFiles() {
    if (_discoveryDone) return window.pharmacyFileRegistry;
    if (_discoveryPromise) return _discoveryPromise;

    _discoveryPromise = (async function () {
      console.log('[PDM52] Dosya keşfi başlıyor…');

      var now   = new Date();
      var dates = [];
      // 2025-01'den başla (ilk CSV o tarihe ait), bugünden 3 ay ileriye kadar tara
      var startDate = new Date(2025, 0, 1); // Ocak 2025
      var endDate   = new Date(now.getFullYear(), now.getMonth() + 1, 1); // maks: bir sonraki ay
      for (var d = new Date(startDate); d <= endDate; d.setMonth(d.getMonth() + 1)) {
        dates.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }

      // Paralel GET probe — HEAD GitHub raw'da güvenilmez (CORS)
      // AbortController ile ilk byte alır almaz kesilir: varlık teyidi + minimum trafik
      var found = [];
      var checks = dates.map(function (d) {
        var file = _fileName(d.year, d.month);
        var url  = _fileUrl(file);
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 8000);
        return fetch(url, { cache: 'no-store', signal: ctrl.signal })
          .then(async function (r) {
            clearTimeout(timer);
            if (!r.ok || r.status !== 200) return { d: d, file: file, ok: false };
            // İçeriği oku + hemen cache'e al (loadPharmacyMonth tekrar fetch yapmaz)
            try {
              var csvText = await r.text();
              if (csvText && !csvText.trim().startsWith('<') && csvText.length > 50) {
                var parsed = _parseCsvWithPapaParse(csvText);
                // TTT ataması
                if (typeof getBrickTTTMap === 'function') {
                  var bm = getBrickTTTMap();
                  parsed.forEach(function(row) {
                    if (!row.ttt && row.brick) row.ttt = bm[row.brick.toUpperCase()] || null;
                  });
                }
                var mm  = String(d.month).padStart(2,'0');
                var key = d.year + '_' + mm;
                window.pharmacyCache[key] = parsed;
                _updatePharmacyStore(d.year, d.month, parsed);
                return { d: d, file: file, ok: true };
              }
              return { d: d, file: file, ok: false };
            } catch(parseErr) {
              return { d: d, file: file, ok: false };
            }
          })
          .catch(function () {
            clearTimeout(timer);
            return { d: d, file: file, ok: false };
          });
      });

      // Paralel çalıştır — tamamını bekle
      var results = await Promise.all(checks);
      results.forEach(function (res) {
        if (res.ok) {
          var mm = String(res.d.month).padStart(2, '0');
          found.push({ year: res.d.year, month: res.d.month, file: res.file,
                       key: res.d.year + '_' + mm, legacy: false });
        }
      });

      found.sort(function (a, b) {
        return a.year !== b.year ? a.year - b.year : a.month - b.month;
      });

      // ── FALLBACK: ECZANE/ klasörü henüz yok ──────────────────────────
      // ECZANE_RAW içindeki ay bilgisinden registry üret +
      // ay bazında cache'e böl — hiçbir şey bozulmadan filtreler çalışır.
      if (found.length === 0) {
        console.log('[PDM52] ECZANE/ klasörü boş — legacy ECZANE_RAW modu');
        var raw = window.ECZANE_RAW || [];
        var aySet = {};
        raw.forEach(function (r) {
          if (!r.ay) return;
          // ay formatı beklenen: "MM/YYYY" veya "M/YYYY"
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

        // Cache: ECZANE_RAW'ı ay bazında böl
        found.forEach(function (f) {
          if (window.pharmacyCache[f.key]) return; // zaten var
          var mm    = String(f.month).padStart(2, '0');
          var ayStr = mm + '/' + f.year;
          // Farklı format denemeleri
          var rows  = raw.filter(function (r) {
            if (r.ay === ayStr) return true;
            if (r.ay === String(f.month) + '/' + f.year) return true;
            return false;
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
  async function loadPharmacyMonth(year, month) {
    var key  = _cacheKey(year, month);
    var file = _fileName(year, month);

    if (window.pharmacyCache[key]) {
      return window.pharmacyCache[key];
    }

    if (_loadingKeys[key]) {
      return new Promise(function (resolve) {
        var t = setInterval(function () {
          if (!_loadingKeys[key]) {
            clearInterval(t);
            resolve(window.pharmacyCache[key] || []);
          }
        }, 100);
      });
    }

    _loadingKeys[key] = true;
    var url = _fileUrl(file) + '?v=' + Date.now();
    console.log('[PDM52] Yükleniyor:', key);

    try {
      var resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        console.warn('[PDM52] HTTP', resp.status, file);
        window.pharmacyCache[key] = [];
        return [];
      }
      var csv = await resp.text();
      if (!csv || csv.trim().startsWith('<')) {
        window.pharmacyCache[key] = [];
        return [];
      }

      var rows = _parseCsvWithPapaParse(csv);

      // TTT ataması
      if (typeof getBrickTTTMap === 'function') {
        var bm = getBrickTTTMap();
        rows.forEach(function (r) {
          if (!r.ttt && r.brick) r.ttt = bm[r.brick.toUpperCase()] || null;
        });
      }

      window.pharmacyCache[key] = rows;
      // pharmacyStore güncelle (normalize + index)
      _updatePharmacyStore(year, month, rows);
      console.log('[PDM52]', key, '→', rows.length, 'satır');

      // Bu ay registry'de yoksa ekle
      var exists = window.pharmacyFileRegistry.some(function (f) { return f.key === key; });
      if (!exists && rows.length > 0) {
        var mm = String(month).padStart(2,'0');
        window.pharmacyFileRegistry.push({ year: year, month: month, file: file, key: key });
        window.pharmacyFileRegistry.sort(function (a, b) {
          return a.year !== b.year ? a.year - b.year : a.month - b.month;
        });
        _discoveryDone = true;
      }

      return rows;
    } catch (err) {
      console.error('[PDM52] Yükleme hatası:', key, err.message);
      window.pharmacyCache[key] = [];
      return [];
    } finally {
      _loadingKeys[key] = false;
    }
  }

  async function loadPharmacyMultiMonth(year) {
    var files = window.pharmacyFileRegistry.filter(function (f) { return f.year === year; });
    if (!files.length) return [];
    var all = [];
    for (var i = 0; i < files.length; i++) {
      var rows = await loadPharmacyMonth(files[i].year, files[i].month);
      all = all.concat(rows);
    }
    return all;
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
        var rows = await loadPharmacyMonth(yr, mo);
        all = all.concat(rows);
      }
    }

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
  // Strateji: Eczane sayfasına ilk girildiğinde (renderEczane çağrısı)
  // discoverPharmacyFiles() tetiklenir; tamamlanınca filtreler doldurulur.
  // Sayfa zaten açıksa (curPage===6) anında renderEczane tekrar çağrılır.
  async function initPharmacyDataManager() {
    console.log('[PDM52] Init başlıyor…');

    // Mevcut ECZANE_RAW varsa (eski ECZANE.csv yüklüydü):
    // Discovery'yi arka planda çalıştır, tamamlanınca filtreler gözükür.
    discoverPharmacyFiles().then(function(found){
      if (!found.length) {
        console.warn('[PDM52] Hiç dosya bulunamadı — eski ECZANE.csv modunda devam');
        return;
      }
      _refreshFilterUI();
      // Aktif veriyi yükle (hem filtreler hem pharmacyActiveData dolsun)
      getActivePharmacyData().then(function(rows){
        if (rows.length > 0) {
          console.log('[PDM52] Aktif data hazır:', rows.length, 'satır');
        }
        // Eczane sayfası açıksa ekranı güncelle
        if (typeof curPage !== 'undefined' && curPage === 6) {
          if (typeof buildEczaneFilters==='function')  buildEczaneFilters();
          if (typeof renderEczaneContent==='function') renderEczaneContent();
        }
        // FAZ 12.3: IMS/MIGI bu ana kadar zaten hazırsa (nadiren — normalde
        // PDM52 IMS'ten önce biter, bkz. reresolveTTT() yorumu) hemen dene;
        // hazır değilse data-loader.js::syncData() bunu IMS dolunca çağırır.
        if (typeof reresolveTTT === 'function') reresolveTTT();
      });
    });
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
function _updatePharmacyStore(year, month, rows) {
  var key = year + '_' + String(month).padStart(2,'0');

  // registry güncelle
  window.pharmacyStore.registry[key] = {
    year: year, month: month,
    file: year + '_' + String(month).padStart(2,'0') + '_Eczane.csv',
    key:  key, loaded: true,
    rowCount: rows.length
  };

  // cache senkronize
  window.pharmacyStore.cache[key] = rows;

  // normalize & index
  var normed = rows.map(function(r) { return _normalizeRow(r, year, month); });

  // Mevcut normalize'dan bu ayı çıkar (yenile)
  window.pharmacyStore.normalized = window.pharmacyStore.normalized.filter(function(n) {
    return !(n.year === year && n.month === month);
  });
  window.pharmacyStore.normalized = window.pharmacyStore.normalized.concat(normed);

  // byPharmacy index
  normed.forEach(function(n) {
    var id = n.gln || n.eczane;
    if (!id) return;
    if (!window.pharmacyStore.byPharmacy[id]) window.pharmacyStore.byPharmacy[id] = [];
    window.pharmacyStore.byPharmacy[id].push(n);
  });

  // byBrick index
  normed.forEach(function(n) {
    if (!n.brick) return;
    if (!window.pharmacyStore.byBrick[n.brick]) window.pharmacyStore.byBrick[n.brick] = [];
    window.pharmacyStore.byBrick[n.brick].push(n);
  });

  // byProduct index
  normed.forEach(function(n) {
    if (!n.urun) return;
    if (!window.pharmacyStore.byProduct[n.urun]) window.pharmacyStore.byProduct[n.urun] = [];
    window.pharmacyStore.byProduct[n.urun].push(n);
  });

  // metadata
  if (window.pharmacyStore.metadata.years.indexOf(year) === -1) {
    window.pharmacyStore.metadata.years.push(year);
    window.pharmacyStore.metadata.years.sort(function(a,b){return a-b;});
  }
  if (!window.pharmacyStore.metadata.months[year]) {
    window.pharmacyStore.metadata.months[year] = [];
  }
  if (window.pharmacyStore.metadata.months[year].indexOf(month) === -1) {
    window.pharmacyStore.metadata.months[year].push(month);
    window.pharmacyStore.metadata.months[year].sort(function(a,b){return a-b;});
  }

  console.log('[PDM52] pharmacyStore güncellendi:', key, normed.length, 'normalize kayıt');
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
  var all = [];
  for (var i = 0; i < files.length; i++) {
    var rows = await loadPharmacyMonth(files[i].year, files[i].month);
    all = all.concat(rows);
  }
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
  // ── reresolveTTT — FAZ 12.3 BUG DÜZELTMESİ ─────────────────────────
  //
  // Kanıt (canlı ortam konsolu): [PDM52] "Aktif data hazır: 24118 satır"
  // satırı, [LOGIN] satırından ÖNCE geliyordu — yani PDM52 eczane/
  // klasöründeki 18 CSV'yi TAMAMEN işleyip pharmacyStore.normalized'ı
  // dolduruyordu, ama bu sırada IMS/MIGI_TL_RAW (index.html) henüz
  // TAMAMEN BOŞTU (syncData() login'den SONRA çalışıyor). parseEczaneCSV()
  // her satırın TTT'sini CSV'den DEĞİL, brick → temsilci haritasından
  // (getBrickTTTMap(), IMS/MIGI_TL_RAW'a bakar) türetiyor — harita boşken
  // TÜM 24118 satır `temsilci: null` ile kayıt oluyordu. Bu, tarayıcı/
  // kullanıcı FARK ETMEKSİZİN HER girişte, HER ZAMAN oluyordu (zamanlama
  // sorunu — PDM52'nin init sırası IMS'ten hep önce). Sonuç: normalizePharmacy
  // (pharmacy-adapter.js) hiçbir tttFilter için satır bulamıyor,
  // PharmacyBehaviorEngine boş dönüyor, AI Profil / pharmacy-ranking.js
  // vb. HER ŞEY boş kalıyordu.
  //
  // Çözüm: IMS/MIGI_TL_RAW DOLDUKTAN SONRA (data-loader.js::syncData()
  // içinden çağrılır) bu fonksiyon pharmacyStore.normalized'taki EKSİK
  // temsilci alanlarını, artık dolu olan getBrickTTTMap() ile GERİYE
  // DOLDURUR (network isteği YOK — sadece bellek-içi, ucuz bir geçiş).
  // Herhangi bir satır düzeltildiyse, üstteki katmanların (PharmacyAdapter,
  // PharmacyBehaviorEngine, PharmacyRanking) cache'lerini de temizler ki
  // bir sonraki okuma GÜNCEL veriyle yeniden hesaplansın.
  function reresolveTTT() {
    if (!window.pharmacyStore || !window.pharmacyStore.normalized || !window.pharmacyStore.normalized.length) return 0;
    if (typeof getBrickTTTMap !== 'function') return 0;

    var map = getBrickTTTMap();
    if (!map || !Object.keys(map).length) return 0; // IMS/MIGI henüz hazır değil — sessizce çık, sonra tekrar denenir

    var fixed = 0;
    window.pharmacyStore.normalized.forEach(function (r) {
      if (!r.temsilci && r.brick) {
        var t = map[r.brick.toUpperCase()];
        if (t) { r.temsilci = t; fixed++; }
      }
    });

    if (fixed > 0) {
      console.log('[PDM52] reresolveTTT: ' + fixed + ' kayıtta temsilci alanı geriye dolduruldu (brick→ttt haritası artık hazır).');
      if (window.PharmacyAdapter && typeof window.PharmacyAdapter.clearCache === 'function') window.PharmacyAdapter.clearCache();
      if (window.PharmacyBehaviorEngine && typeof window.PharmacyBehaviorEngine.clearCache === 'function') window.PharmacyBehaviorEngine.clearCache();
      if (window.PharmacyRanking && typeof window.PharmacyRanking.clearCache === 'function') window.PharmacyRanking.clearCache();
      // Eczane sayfası açıksa ekranı güncelle (rota planı/manager panel'deki
      // aynı desenle — bkz. initPharmacyDataManager).
      if (typeof curPage !== 'undefined' && curPage === 6 && typeof renderEczaneContent === 'function') {
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
