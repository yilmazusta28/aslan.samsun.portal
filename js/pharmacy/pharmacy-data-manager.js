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

  var ECZANE_DIR = 'ECZANE/';

  var AY_ISIMLERI = [
    'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
    'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'
  ];

  // ── Global State ──────────────────────────────────────────────────────
  window.pharmacyFileRegistry = [];
  window.pharmacyCache        = window.pharmacyCache || {};
  window.pharmacyActiveFilter = window.pharmacyActiveFilter || { year: null, month: null };
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
      // Geriye 36 ay, ileriye 6 ay
      for (var delta = -36; delta <= 6; delta++) {
        var d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        dates.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }

      var found = [];

      // 8'li batch — her batch arasında 60ms bekleme
      var BATCH = 8;
      for (var i = 0; i < dates.length; i += BATCH) {
        var batch  = dates.slice(i, i + BATCH);
        var checks = batch.map(function (d) {
          var file = _fileName(d.year, d.month);
          var url  = _fileUrl(file);
          var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 4000) : null;
          var opts = ctrl ? { method: 'HEAD', cache: 'no-store', signal: ctrl.signal } : { method: 'HEAD', cache: 'no-store' };
          return fetch(url, opts)
            .then(function (r) {
              if (timer) clearTimeout(timer);
              return { d: d, file: file, ok: r.ok };
            })
            .catch(function () {
              if (timer) clearTimeout(timer);
              return { d: d, file: file, ok: false };
            });
        });

        var results = await Promise.all(checks);
        results.forEach(function (res) {
          if (res.ok) {
            var mm   = String(res.d.month).padStart(2,'0');
            found.push({
              year:  res.d.year,
              month: res.d.month,
              file:  res.file,
              key:   res.d.year + '_' + mm
            });
          }
        });

        if (i + BATCH < dates.length) {
          await new Promise(function (r) { setTimeout(r, 60); });
        }
      }

      // Kronolojik sıra
      found.sort(function (a, b) {
        return a.year !== b.year ? a.year - b.year : a.month - b.month;
      });

      window.pharmacyFileRegistry = found;
      _discoveryDone = true;
      console.log('[PDM52] Keşif tamamlandı:', found.length, 'dosya →',
        found.map(function (f) { return f.key; }).join(', '));

      // Aktif filtre başlat — en güncel ay
      if (found.length) {
        var latest = found[found.length - 1];
        if (!window.pharmacyActiveFilter.year) {
          window.pharmacyActiveFilter.year  = latest.year;
          window.pharmacyActiveFilter.month = latest.month;
        }
        // Filtre DOM'unu güncelle (eczane sayfası açıksa)
        _refreshFilterUI();
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

      var rows = [];
      if (typeof parseEczaneCSV === 'function') {
        try { rows = parseEczaneCSV(csv); } catch(e) { console.error('[PDM52] parseEczaneCSV:', e); }
      }

      // TTT ataması
      if (typeof getBrickTTTMap === 'function') {
        var bm = getBrickTTTMap();
        rows.forEach(function (r) {
          if (!r.ttt && r.brick) r.ttt = bm[r.brick.toUpperCase()] || null;
        });
      }

      window.pharmacyCache[key] = rows;
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
    if (!f.year) return [];
    var rows = f.month
      ? await loadPharmacyMonth(f.year, f.month)
      : await loadPharmacyMultiMonth(f.year);

    window.pharmacyActiveData = rows;
    // Geriye dönük uyumluluk
    window.ECZANE_RAW   = rows;
    window.eczaneLoaded = rows.length > 0;
    return rows;
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
    var active = window.pharmacyActiveFilter.year;
    if (!years.length) { el.innerHTML = '<span style="color:var(--dim);font-size:11px">Taranıyor…</span>'; return; }
    el.innerHTML = years.map(function (y) {
      var cls = y === active ? 'tfb-sp active' : 'tfb-sp';
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectYear(' + y + ')">' + y + '</button>';
    }).join('');
  }

  function _renderMonthFilter(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    var f       = window.pharmacyActiveFilter;
    var months  = f.year ? getAvailableMonths(f.year) : [];
    var active  = f.month;
    if (!months.length) { el.innerHTML = '<span style="color:var(--dim);font-size:11px">Yıl seçin</span>'; return; }
    var html = '<button class="tfb-sp' + (active === null ? ' active' : '') + '" onclick="PharmacyDataManager.selectMonth(null)">Tümü</button>';
    html += months.map(function (m) {
      var cls   = m === active ? 'tfb-sp active' : 'tfb-sp';
      var label = AY_ISIMLERI[m - 1];
      return '<button class="' + cls + '" onclick="PharmacyDataManager.selectMonth(' + m + ')">' + label + '</button>';
    }).join('');
    el.innerHTML = html;
  }

  function renderPharmacyYearFilter(elId)  { _renderYearFilter(elId || 'eczaneYilBar'); }
  function renderPharmacyMonthFilter(elId) { _renderMonthFilter(elId || 'eczaneAyBar52'); }

  // ── Filtre seçim aksiyonları ──────────────────────────────────────────
  async function selectYear(year) {
    window.pharmacyActiveFilter.year  = year;
    // En son mevcut ayı seç
    var months = getAvailableMonths(year);
    window.pharmacyActiveFilter.month = months.length ? months[months.length - 1] : null;
    _refreshFilterUI();
    await getActivePharmacyData();
    _triggerEczaneRender();
  }

  async function selectMonth(month) {
    window.pharmacyActiveFilter.month = month;
    _refreshFilterUI();
    await getActivePharmacyData();
    _triggerEczaneRender();
  }

  function _triggerEczaneRender() {
    if (typeof buildEczaneFilters === 'function')   buildEczaneFilters();
    if (typeof renderEczaneContent === 'function')  renderEczaneContent();
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
  function buildTop30VisitPriority(ttt, genelData) {
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
      // Eczane sayfası açıksa: aktif veriyi güncelle
      if (typeof curPage !== 'undefined' && curPage === 6) {
        getActivePharmacyData().then(function(){
          if (typeof buildEczaneFilters==='function')  buildEczaneFilters();
          if (typeof renderEczaneContent==='function') renderEczaneContent();
        });
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.PharmacyDataManager = {
    discoverPharmacyFiles:        discoverPharmacyFiles,
    loadPharmacyMonth:            loadPharmacyMonth,
    loadPharmacyMultiMonth:       loadPharmacyMultiMonth,
    getActivePharmacyData:        getActivePharmacyData,
    initPharmacyDataManager:      initPharmacyDataManager,
    getAvailableYears:            getAvailableYears,
    getAvailableMonths:           getAvailableMonths,
    selectYear:                   selectYear,
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
  };

  // Sayfa yüklenince arka planda başlat
  if (document.readyState === 'complete') {
    setTimeout(initPharmacyDataManager, 800);
  } else {
    window.addEventListener('load', function(){
      setTimeout(initPharmacyDataManager, 800);
    });
  }

  console.log('[PDM52] pharmacy-data-manager.js v2 yüklendi ✅');

})();
