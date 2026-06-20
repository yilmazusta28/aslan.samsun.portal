// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ims-adapter.js
//  AI MİMARİSİ STABİLİZASYONU — IMS Adapter Katmanı
//
//  Sorumluluk:
//    Gerçek parseIMSCSV() çıktısını AI motorlarının kullanacağı ORTAK,
//    STANDART bir veri modeline (IMSRecord) çevirmek. Parser DEĞİŞMEDİ —
//    sadece bu adapter, parser'ın çıktısını okuyup normalize ediyor.
//
//  ⚠️ NEDEN BU DOSYA VAR (bkz. AI_MIMARI_STABILIZASYON_RAPORU.md):
//    FAZ 1.3 raporunda tespit edildiği üzere trend-engine.js, risk-engine.js,
//    insight-engine.js ve forecast-engine.js gerçek parseIMSCSV() çıktısında
//    OLMAYAN alan adları kullanıyordu (own_tl, own_kutu, hafta). Bu adapter,
//    TEK GERÇEK KAYNAK olarak parseIMSCSV()'in ürettiği alanları
//    (ttt, brick, ilac_grubu, ilac, is_mkt, toplam, toplam_ppi, h1..h9)
//    esas alır ve tüm motorların bundan SONRA SADECE bu adapter üzerinden
//    veri okumasını sağlar.
//
//  GERÇEK IMS MODELİ (parseIMSCSV çıktısı — js/data/csv-parser.js):
//    { ttt, brick, ilac_grubu, ilac, is_mkt, toplam, toplam_ppi,
//      h1, h2, h3, h4, h5, h6, h7, h8, h9 }
//
//  STANDART IMSRecord MODELİ (bu adapter'ın ÜRETTİĞİ model):
//    {
//      representative,      // ttt
//      brick,
//      product,              // ilac (sadece kendi ürün satırı — is_mkt:false)
//      total,                // toplam
//      weeks: { w1..w9 },    // h1..h9'dan 1:1 eşlenir
//      calculated: { growth, average, trend, volatility }
//    }
//
//  Public API:
//    normalizeIMS(ttt)              → IMSRecord[] (cache'li, is_mkt:false satırlar)
//    buildWeeks(row)                 → { w1..w9 } (parser satırından)
//    calculateGrowth(weekVals)       → number (% — erken/geç yarı karşılaştırması)
//    calculateAverage(weekVals)      → number (haftalık ortalama hacim)
//    calculateTrend(weekVals)        → 'up'|'down'|'stable'
//    calculateVolatility(weekVals)   → number (CV%, değişim katsayısı)
//    aggregateRecords(records)       → tek birleşik IMSRecord (brick/product=null)
//    groupRecordsBy(records, key)    → { [key]: IMSRecord[] }
//    weekValuesArray(weeksObj)       → [w1..w9] sıralı dizi
//    activeWeekCount(weekVals)       → sıfırdan farklı hafta sayısı
//    clearCache()                    → cache temizle (manuel, normalde otomatik)
//
//  CACHE: ttt başına, içerik-imzası ile otomatik geçersizleşir (FAZ 0'daki
//  ai-orchestrator.js'in aynı deseni — veri değişmeden tekrar normalize
//  ETMEZ, IMS değişince otomatik yeniden hesaplar). Manuel temizleme
//  GEREKMEZ ama clearCache() yine de dışa açıldı.
//
//  Kurallar:
//    • Parser (csv-parser.js) DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • "Magic number" yok — eşik değerleri İSİMLİ SABİTLER olarak
//      tanımlanır ve RELATİF (ortalamaya göre %) hesaplanır, ölçek
//      bağımsızdır (bkz. TREND_STABLE_THRESHOLD_PCT açıklaması).
//
//  Bağımlılık: js/data/data-state.js (IMS global'i — typeof ile kontrol edilir)
//  Yükleme sırası: data-state.js SONRASI, trend/risk/insight/recommendation/
//                  forecast motorları ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._IMS_ADAPTER_LOADED) {
    console.warn('[ims-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._IMS_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';
  var WEEK_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9'];
  var RAW_WEEK_FIELDS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];

  // Trend yönü kararı için RELATİF (haftalık ortalamaya göre %) eşik.
  // NEDEN RELATİF: eski kod mutlak bir TL eşiği (500) kullanıyordu — küçük
  // bir bölgede asla aşılmayan, büyük bir bölgede her zaman aşılan, ölçeğe
  // bağımlı/anlamsız bir eşikti. %5'lik bant, temsilci/brick büyüklüğünden
  // bağımsız, tutarlı bir "belirgin değişim" tanımı sağlar.
  var TREND_STABLE_THRESHOLD_PCT = 5;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) ORTAK MATEMATİK YARDIMCILARI (tekrar edilen hesapları kaldırır)
  // ──────────────────────────────────────────────────────────────────

  function _mean(arr) {
    if (!arr || !arr.length) return 0;
    return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
  }

  // Basit doğrusal regresyon eğimi (en küçük kareler). trend-engine.js ve
  // forecast-engine.js'te AYNI FORMÜL üç kez tekrarlanıyordu — artık tek yer.
  function _linearSlope(values) {
    var n = values.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += i; sumY += values[i];
      sumXY += i * values[i]; sumX2 += i * i;
    }
    var denom = (n * sumX2 - sumX * sumX);
    return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) calculateGrowth / calculateAverage / calculateTrend / calculateVolatility
  // ──────────────────────────────────────────────────────────────────

  // ── calculateAverage(weekVals) — haftalık ortalama hacim ────────────
  function calculateAverage(weekVals) {
    return Math.round(_mean(weekVals || []) * 100) / 100;
  }

  // ── calculateGrowth(weekVals) — erken yarı vs geç yarı % değişim ────
  // 9 haftalık seriyi ikiye böler (ilk ~4-5 hafta vs son ~4-5 hafta) ve
  // aradaki yüzde değişimi döner. Veri yoksa/yetersizse 0.
  function calculateGrowth(weekVals) {
    var v = weekVals || [];
    if (v.length < 2) return 0;
    var mid = Math.floor(v.length / 2);
    var earlyAvg = _mean(v.slice(0, mid));
    var lateAvg  = _mean(v.slice(mid));
    if (earlyAvg === 0) return lateAvg > 0 ? 100 : 0;
    return Math.round(((lateAvg - earlyAvg) / earlyAvg) * 1000) / 10;
  }

  // ── calculateTrend(weekVals) — 'up'|'down'|'stable' ─────────────────
  // Doğrusal eğimi haftalık ORTALAMAYA göre normalize ederek (relatif %)
  // değerlendirir — bkz. TREND_STABLE_THRESHOLD_PCT açıklaması.
  function calculateTrend(weekVals) {
    var v = weekVals || [];
    var avg   = _mean(v);
    var slope = _linearSlope(v);
    if (avg === 0) return slope > 0 ? 'up' : slope < 0 ? 'down' : 'stable';
    var relSlopePct = (slope / avg) * 100;
    if (relSlopePct > TREND_STABLE_THRESHOLD_PCT)  return 'up';
    if (relSlopePct < -TREND_STABLE_THRESHOLD_PCT) return 'down';
    return 'stable';
  }

  // ── calculateVolatility(weekVals) — değişim katsayısı (CV%) ─────────
  // Standart sapma / ortalama × 100. Haftalar arası tutarsızlığı ölçer
  // (yüksek CV% = düzensiz/dalgalı satış, düşük CV% = istikrarlı satış).
  function calculateVolatility(weekVals) {
    var v = weekVals || [];
    var avg = _mean(v);
    if (avg === 0) return 0;
    var variance = _mean(v.map(function (x) { return (x - avg) * (x - avg); }));
    var stdDev = Math.sqrt(variance);
    return Math.round((stdDev / avg) * 1000) / 10;
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) buildWeeks / weekValuesArray / activeWeekCount
  // ──────────────────────────────────────────────────────────────────

  // ── buildWeeks(row) — gerçek h1..h9 alanlarından {w1..w9} üretir ───
  function buildWeeks(row) {
    var weeks = {};
    for (var i = 0; i < RAW_WEEK_FIELDS.length; i++) {
      weeks[WEEK_KEYS[i]] = (row && typeof row[RAW_WEEK_FIELDS[i]] === 'number') ? row[RAW_WEEK_FIELDS[i]] : 0;
    }
    return weeks;
  }

  // ── weekValuesArray(weeksObj) — {w1..w9} → sıralı [v1..v9] dizisi ───
  function weekValuesArray(weeksObj) {
    if (!weeksObj) return [];
    return WEEK_KEYS.map(function (k) { return weeksObj[k] || 0; });
  }

  // ── activeWeekCount(weekVals) — sıfırdan farklı hafta sayısı ────────
  // forecast-engine.js'te "kaç hafta gerçekten veri içeriyor" (elapsed
  // weeks) sorusuna doğru cevap vermek için gerekli — weekValuesArray()
  // HER ZAMAN 9 eleman döner (w1..w9 slotları sabit), bu nedenle dizi
  // UZUNLUĞU "geçen hafta sayısı" anlamına GELMEZ; sıfırdan farklı hafta
  // SAYISI gelir.
  function activeWeekCount(weekVals) {
    return (weekVals || []).filter(function (v) { return v > 0; }).length;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) normalizeIMS — ANA FONKSİYON (cache'li)
  // ──────────────────────────────────────────────────────────────────

  var _cache = {}; // ttt → { records, signature }

  function _dataSignature(ttt) {
    var rows = _safe(function () {
      return (IMS || []).filter(function (r) { return r.ttt === ttt && r.is_mkt === false; });
    }, []);
    // İçerik-tabanlı ucuz imza: satır sayısı + toplam hacim toplamı.
    // IMS senkronize olduğunda bu değer değişir → cache otomatik geçersizleşir.
    var totalSum = rows.reduce(function (s, r) { return s + (r.toplam || 0); }, 0);
    return rows.length + ':' + totalSum;
  }

  function _buildRecord(row) {
    var weeks    = buildWeeks(row);
    var weekVals = weekValuesArray(weeks);
    return {
      representative: row.ttt,
      brick:           row.brick,
      product:         row.ilac,
      total:           row.toplam || 0,
      weeks:           weeks,
      calculated: {
        growth:     calculateGrowth(weekVals),
        average:    calculateAverage(weekVals),
        trend:      calculateTrend(weekVals),
        volatility: calculateVolatility(weekVals)
      }
    };
  }

  // ── normalizeIMS(ttt) — gerçek parser çıktısını IMSRecord[]'e çevirir
  // Sadece KENDİ ÜRÜN satırları (is_mkt:false) — pazar toplamı satırları
  // hariç tutulur (own_tl/own_kutu'nun ORİJİNAL niyeti de buydu).
  // @param {string} ttt
  // @returns {Array<IMSRecord>}
  function normalizeIMS(ttt) {
    if (!ttt) return [];

    var sig    = _dataSignature(ttt);
    var cached = _cache[ttt];
    if (cached && cached.signature === sig) {
      return cached.records;
    }

    var rows = _safe(function () {
      return (IMS || []).filter(function (r) { return r.ttt === ttt && r.is_mkt === false; });
    }, []);

    var records = rows.map(_buildRecord);
    _cache[ttt] = { records: records, signature: sig };
    return records;
  }

  function clearCache() {
    _cache = {};
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) aggregateRecords / groupRecordsBy — ORTAK gruplama/birleştirme
  //     (trend-engine'in weekMap'i, risk/insight-engine'in grpMap'i,
  //     opportunity-engine'in brickPayMap'i — hepsi AYNI deseni
  //     tekrarlıyordu; artık tek yerden)
  // ──────────────────────────────────────────────────────────────────

  // ── aggregateRecords(records) — birden çok IMSRecord'u TEK kayda
  //    birleştirir (haftalık hacimleri toplar, calculated'ı yeniden
  //    hesaplar). brick/product null olur (birden çok değer birleşti).
  function aggregateRecords(records) {
    if (!records || !records.length) return null;

    var sumWeeks = {};
    WEEK_KEYS.forEach(function (k) { sumWeeks[k] = 0; });
    var total = 0;

    records.forEach(function (r) {
      total += r.total || 0;
      WEEK_KEYS.forEach(function (k) { sumWeeks[k] += (r.weeks && r.weeks[k]) || 0; });
    });

    var weekVals = weekValuesArray(sumWeeks);

    return {
      representative: records[0].representative,
      brick:   records.length === 1 ? records[0].brick   : null,
      product: records.length === 1 ? records[0].product : null,
      total:   total,
      weeks:   sumWeeks,
      calculated: {
        growth:     calculateGrowth(weekVals),
        average:    calculateAverage(weekVals),
        trend:      calculateTrend(weekVals),
        volatility: calculateVolatility(weekVals)
      }
    };
  }

  // ── groupRecordsBy(records, key) — basit groupBy yardımcısı ─────────
  function groupRecordsBy(records, key) {
    var map = {};
    (records || []).forEach(function (r) {
      var k = r[key];
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return map;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.IMSAdapter = {
    normalizeIMS:        normalizeIMS,
    buildWeeks:           buildWeeks,
    calculateGrowth:       calculateGrowth,
    calculateAverage:       calculateAverage,
    calculateTrend:          calculateTrend,
    calculateVolatility:      calculateVolatility,
    aggregateRecords:          aggregateRecords,
    groupRecordsBy:              groupRecordsBy,
    weekValuesArray:               weekValuesArray,
    activeWeekCount:                 activeWeekCount,
    clearCache:                       clearCache,
    version: ADAPTER_VERSION
  };

  console.debug('[ims-adapter] yüklendi. Versiyon:', ADAPTER_VERSION);

})();
