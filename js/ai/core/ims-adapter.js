// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ims-adapter.js
//  Phase 1 — IMS Data Model Unification (Refactor/Stabilization)
//
//  Sorumluluk: Tüm AI engine'leri için TEK ORTAK IMS normalize katmanı.
//
//    • normalizeIMS(rawRows)  → IMSRecord[]
//    • getIMSCache()          → IMSRecord[] (singleton; parser → bir kez)
//    • invalidateIMSCache()   → void (yeni CSV yüklendiğinde çağrılır)
//
//  IMSRecord yapısı:
//    {
//      ttt, brick, product, ilac_grubu, ilac, isOwn, isMkt,
//      total,
//      weeks: { w1..w9 },
//      calculated: { growth, average, trend, volatility }
//    }
//
//  Kural: Hiçbir AI engine IMS global'ını veya parser çıktısını DOĞRUDAN
//  okumaz. Yalnızca bu adaptörden geçer.
//
//  Geriye dönük uyumluluk:
//    window.IMSAdapter.normalizeIMS()
//    window.IMSAdapter.getIMSCache()
//    window.IMSAdapter.invalidateIMSCache()
//    window.IMSAdapter.buildWeeks()
//    window.IMSAdapter.calculateGrowth()
//    window.IMSAdapter.calculateAverage()
//    window.IMSAdapter.calculateTrend()
//    window.IMSAdapter.calculateVolatility()
//    window.IMSAdapter.getOwnRecords()
//    window.IMSAdapter.getMktRecords()
//    window.IMSAdapter.getMarketShare()
//    window.IMSAdapter.getWeeklySeries()
//    window.IMSAdapter.getOwnWeeklySeries()
//    window.IMSAdapter.linearSlope()         ← ortak yardımcı
//    window.IMSAdapter.trendConfidence()     ← ortak yardımcı
//
//  Bağımlılık (opsiyonel — typeof ile kontrol):
//    window.IMS          — ham parser çıktısı
//    window.OWN_IMS      — ilac_grubu → own ilac adı haritası
//    window.IMS_TL_MAP   — ürün → birim TL fiyatı
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.IMSAdapter) {
    console.warn('[ims-adapter] Zaten yüklü — atlandı.');
    return;
  }

  // ── Sabitler ────────────────────────────────────────────────────────
  var WEEK_KEYS   = ['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  var WEEK_COUNT  = WEEK_KEYS.length;

  // ── Singleton cache ──────────────────────────────────────────────────
  var _cache = null;   // IMSRecord[] | null
  var _rawSignature = null;  // son normalize edilen raw array referansı

  // ── _safe: global okuma hatası yutan yardımcı ────────────────────────
  function _safe(fn, fallback) {
    try {
      var v = fn();
      return (v === undefined || v === null) ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  // ── _isOwnIlac: IMS satırının kendi ürünümüz olup olmadığını belirler ─
  // OWN_IMS haritası: ilac_grubu → kendi ilac adı
  function _isOwnIlac(row) {
    var ownMap = _safe(function () { return OWN_IMS; }, null);
    if (!ownMap) return false;
    var expectedIlac = ownMap[row.ilac_grubu];
    if (!expectedIlac) return false;
    return row.ilac.trim().toUpperCase() === expectedIlac.trim().toUpperCase();
  }

  // ── buildWeeks: h1..h9 → { w1..w9 } dönüşümü ───────────────────────
  function buildWeeks(row) {
    var weeks = {};
    for (var i = 0; i < WEEK_COUNT; i++) {
      weeks['w' + (i + 1)] = row[WEEK_KEYS[i]] || 0;
    }
    return weeks;
  }

  // ── calculateAverage: haftalık ortalama ─────────────────────────────
  function calculateAverage(weeks) {
    var vals = _weekValues(weeks);
    if (!vals.length) return 0;
    var sum = 0;
    for (var i = 0; i < vals.length; i++) sum += vals[i];
    return sum / vals.length;
  }

  // ── linearSlope: doğrusal eğim (trend-engine ve forecast-engine paylaşır)
  function linearSlope(values) {
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
    return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  }

  // ── trendConfidence: eğim yönüyle tutarlı hafta sayısı (0-100) ──────
  function trendConfidence(values, slope) {
    if (values.length < 2) return 50;
    var match = 0;
    for (var i = 1; i < values.length; i++) {
      var delta = values[i] - values[i - 1];
      if ((slope >= 0 && delta >= 0) || (slope < 0 && delta < 0)) match++;
    }
    return Math.round((match / (values.length - 1)) * 100);
  }

  // ── calculateGrowth: son hafta / ilk hafta büyümesi ─────────────────
  function calculateGrowth(weeks) {
    var vals = _weekValues(weeks);
    if (vals.length < 2) return 0;
    var first = vals[0], last = vals[vals.length - 1];
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }

  // ── calculateTrend: lineer eğim skoru (normalize edilmiş) ───────────
  function calculateTrend(weeks) {
    var vals = _weekValues(weeks);
    return +linearSlope(vals).toFixed(2);
  }

  // ── calculateVolatility: standart sapma / ortalama (CV%) ────────────
  function calculateVolatility(weeks) {
    var vals = _weekValues(weeks);
    if (vals.length < 2) return 0;
    var avg = 0;
    for (var i = 0; i < vals.length; i++) avg += vals[i];
    avg = avg / vals.length;
    if (avg === 0) return 0;
    var variance = 0;
    for (var j = 0; j < vals.length; j++) {
      variance += Math.pow(vals[j] - avg, 2);
    }
    return Math.round((Math.sqrt(variance / vals.length) / avg) * 100);
  }

  // ── _weekValues: weeks nesnesinden değer dizisi ──────────────────────
  function _weekValues(weeks) {
    var out = [];
    for (var i = 1; i <= WEEK_COUNT; i++) {
      var v = weeks['w' + i];
      if (v !== undefined && v !== null) out.push(v);
    }
    return out;
  }

  // ── normalizeIMS: ham parser çıktısı → IMSRecord[] ──────────────────
  // Parser'ı DEĞİŞTİRMEZ. CSV'yi DEĞİŞTİRMEZ.
  // Bu dönüşüm yalnızca AI katmanı içinde yaşar.
  function normalizeIMS(rawRows) {
    if (!Array.isArray(rawRows) || !rawRows.length) return [];

    return rawRows.map(function (row) {
      var isOwn = _isOwnIlac(row);
      var weeks = buildWeeks(row);

      return {
        // ─ Kimlik ─
        representative: row.ttt      || '',
        brick:          row.brick    || '',
        product:        row.ilac     || '',
        ilac_grubu:     row.ilac_grubu || '',
        ilac:           row.ilac     || '',

        // ─ Sınıflandırma ─
        isOwn: isOwn,
        isMkt: row.is_mkt || false,

        // ─ Toplam kutu ─
        total: row.toplam || 0,

        // ─ Haftalık kutu ─
        weeks: weeks,

        // ─ Hesaplanan metrikler (adapter içinde, engine tekrarı yok) ─
        calculated: {
          growth:     calculateGrowth(weeks),
          average:    calculateAverage(weeks),
          trend:      calculateTrend(weeks),
          volatility: calculateVolatility(weeks)
        }
      };
    });
  }

  // ── getIMSCache: singleton IMSRecord[] ──────────────────────────────
  // Birinci çağrıda normalize eder, sonraki çağrılarda cache'i döner.
  function getIMSCache() {
    var raw = _safe(function () { return IMS; }, []);
    // Aynı array referansıysa cache geçerlidir
    if (_cache && _rawSignature === raw) return _cache;
    _cache = normalizeIMS(raw);
    _rawSignature = raw;
    return _cache;
  }

  // ── invalidateIMSCache: yeni CSV yüklendiğinde cache'i sıfırlar ─────
  // data-loader.js içinde IMS.length = 0; IMS.push(...) yapıldıktan
  // SONRA bu fonksiyon çağrılır (ileride entegre edilebilir).
  function invalidateIMSCache() {
    _cache = null;
    _rawSignature = null;
  }

  // ── getOwnRecords: bir TTT için kendi ürün kayıtları ────────────────
  function getOwnRecords(ttt) {
    return getIMSCache().filter(function (r) {
      return r.representative === ttt && r.isOwn;
    });
  }

  // ── getMktRecords: bir TTT için pazar TOPLAM kayıtları ───────────────
  function getMktRecords(ttt) {
    return getIMSCache().filter(function (r) {
      return r.representative === ttt && r.isMkt;
    });
  }

  // ── getWeeklySeries: bir TTT için tüm kayıtların toplam haftalık dizisi
  // Döner: number[] (w1..w9 toplamı, non-own dahil)
  function getWeeklySeries(ttt) {
    var records = getIMSCache().filter(function (r) {
      return r.representative === ttt;
    });
    return _aggregateWeeks(records);
  }

  // ── getOwnWeeklySeries: bir TTT'nin kendi ürünleri haftalık toplamı ──
  // own_tl hesabı: own_kutu × IMS_TL_MAP → hafta başına TL
  function getOwnWeeklySeries(ttt, asTL) {
    var records = getOwnRecords(ttt);
    var tlMap = _safe(function () { return IMS_TL_MAP; }, {});

    var sums = {};
    for (var i = 1; i <= WEEK_COUNT; i++) sums['w' + i] = 0;

    records.forEach(function (r) {
      for (var i = 1; i <= WEEK_COUNT; i++) {
        var key = 'w' + i;
        var kutu = r.weeks[key] || 0;
        if (asTL) {
          var birimFiyat = tlMap[r.product] || tlMap[r.ilac] || 0;
          sums[key] += kutu * birimFiyat;
        } else {
          sums[key] += kutu;
        }
      }
    });

    var out = [];
    for (var j = 1; j <= WEEK_COUNT; j++) out.push(sums['w' + j]);
    return out;
  }

  // ── getMarketShare: bir TTT × ilac_grubu için pazar payı bilgisi ─────
  // Gerçek IMS şemasında bizim_pay/rakip_pay sütunları YOK.
  // Kendi ürünümüz: is_mkt=false + isOwn=true
  // Pazar TOPLAM: is_mkt=true
  // Pay = kendi toplam / pazar toplam × 100
  function getMarketShare(ttt) {
    var cache = getIMSCache();
    var result = {}; // { ilac_grubu: { bizimPay, pazarToplam, bizimToplam } }

    // Pazar toplam satırları (is_mkt = true, ttt bazında)
    cache.filter(function (r) {
      return r.representative === ttt && r.isMkt;
    }).forEach(function (r) {
      if (!result[r.ilac_grubu]) {
        result[r.ilac_grubu] = { bizimToplam: 0, pazarToplam: 0, bizimPay: 0 };
      }
      result[r.ilac_grubu].pazarToplam += r.total;
    });

    // Kendi ürünlerimiz (is_mkt = false + isOwn = true)
    cache.filter(function (r) {
      return r.representative === ttt && r.isOwn;
    }).forEach(function (r) {
      if (!result[r.ilac_grubu]) {
        result[r.ilac_grubu] = { bizimToplam: 0, pazarToplam: 0, bizimPay: 0 };
      }
      result[r.ilac_grubu].bizimToplam += r.total;
    });

    // Pay hesabı
    Object.keys(result).forEach(function (grp) {
      var s = result[grp];
      s.bizimPay = s.pazarToplam > 0
        ? Math.round((s.bizimToplam / s.pazarToplam) * 1000) / 10
        : 0;
    });

    return result;
  }

  // ── _aggregateWeeks: kayıtlar listesinden haftalık toplam dizisi ─────
  function _aggregateWeeks(records) {
    var sums = {};
    for (var i = 1; i <= WEEK_COUNT; i++) sums['w' + i] = 0;
    records.forEach(function (r) {
      for (var i = 1; i <= WEEK_COUNT; i++) {
        sums['w' + i] += r.weeks['w' + i] || 0;
      }
    });
    var out = [];
    for (var j = 1; j <= WEEK_COUNT; j++) out.push(sums['w' + j]);
    return out;
  }

  // ── EXPORT ──────────────────────────────────────────────────────────
  window.IMSAdapter = {
    normalizeIMS:         normalizeIMS,
    getIMSCache:          getIMSCache,
    invalidateIMSCache:   invalidateIMSCache,
    buildWeeks:           buildWeeks,
    calculateGrowth:      calculateGrowth,
    calculateAverage:     calculateAverage,
    calculateTrend:       calculateTrend,
    calculateVolatility:  calculateVolatility,
    linearSlope:          linearSlope,
    trendConfidence:      trendConfidence,
    getOwnRecords:        getOwnRecords,
    getMktRecords:        getMktRecords,
    getWeeklySeries:      getWeeklySeries,
    getOwnWeeklySeries:   getOwnWeeklySeries,
    getMarketShare:       getMarketShare
  };

  console.debug('[ims-adapter] Phase 1 — IMS Unification yüklendi.');

})();
