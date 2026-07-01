// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/market-share-engine.js
//  FAZ 6.3.5 — Market Share Engine
//  FAZ 8.0 — Kırık referans düzeltmesi: dosya yoktu, oluşturuldu (iskelet)
//  HOTFIX — index.html (renderMarketShareCard) ve competitive-impact-engine.js
//           BEKLEDİĞİ gerçek alan şemasıyla (dataQuality, bizimPay, shareTrend,
//           shareChangePct) ve getOverallShareSummary() ile YENİDEN YAZILDI.
//
//  Sorumluluk: IMS verisinden (ttt, brick, ilac_grubu, ilac, is_mkt, toplam,
//  h1..h9) brick/ürünGrubu bazında "bizim pay" hesaplar. is_mkt:true satırları
//  PAZAR TOPLAMI, OWN_IMS[ilacGrubu] ile eşleşen is_mkt:false satır KENDİ
//  ÜRÜNÜMÜZdür (bkz. js/core/constants.js OWN_IMS).
//
//  Public API:
//    analyzeMarketShare(ttt, brick) → MarketShareResult[]
//    getOverallShareSummary(ttt)    → { avgBizimPay, risingShareBricks[], decliningShareBricks[] }
//    shareTrend(ttt, brick)         → 'up'|'down'|'stable'   (ilk kaydın trendi)
//    shareChangePct(ttt, brick)     → number                  (ilk kaydın değişimi)
//
//  MarketShareResult:
//    { brick, ilacGrubu, product, bizimPay, rakipPay,
//      shareTrend: 'up'|'down'|'stable', shareChangePct: number,
//      dataQuality: 'OK'|'NO_MARKET_DATA'|'NO_OWN_DATA' }
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._MARKET_SHARE_ENGINE_LOADED) {
    console.warn('[market-share-engine] Zaten yüklü — atlandı');
    return;
  }
  window._MARKET_SHARE_ENGINE_LOADED = true;

  var WEEK_FIELDS = ['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  var TREND_STABLE_THRESHOLD_PP = 2; // puan (yüzde puanı) — bu eşiğin altı 'stable'

  var _cache = {};

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  function _sum(rows, field) {
    return rows.reduce(function (s, r) { return s + (r[field] || 0); }, 0);
  }

  // ── _getImsRows — ham IMS satırları (ttt'ye göre), ims-adapter YOK çünkü
  //     burada is_mkt:true satırlarına da ihtiyaç var (adapter sadece
  //     is_mkt:false döner) ─────────────────────────────────────────────
  function _getImsRows(ttt) {
    return _safe(function () {
      if (typeof IMS === 'undefined' || !IMS) return [];
      return IMS.filter(function (r) { return r.ttt === ttt; });
    }, []);
  }

  // ── _weekShareSeries — haftalık bizimPay serisi (h1..h9), pazar verisi
  //     olmayan haftalar null (hesaba katılmaz) ─────────────────────────
  function _weekShareSeries(ownRows, mktRows) {
    return WEEK_FIELDS.map(function (wk) {
      var own = _sum(ownRows, wk);
      var mkt = _sum(mktRows, wk);
      return mkt > 0 ? (own / mkt * 100) : null;
    });
  }

  function _trendFromSeries(series) {
    var valid = series.filter(function (v) { return v !== null; });
    if (valid.length < 2) return { trend: 'stable', changePct: 0 };
    var mid = Math.floor(valid.length / 2);
    var early = valid.slice(0, mid);
    var late  = valid.slice(mid);
    var earlyAvg = early.reduce(function (s, v) { return s + v; }, 0) / early.length;
    var lateAvg  = late.reduce(function (s, v) { return s + v; }, 0) / late.length;
    var diff = Math.round((lateAvg - earlyAvg) * 10) / 10;
    var trend = diff > TREND_STABLE_THRESHOLD_PP ? 'up'
              : diff < -TREND_STABLE_THRESHOLD_PP ? 'down'
              : 'stable';
    return { trend: trend, changePct: diff };
  }

  // ── analyzeMarketShare — brick × ilaç grubu bazında bizim pay ─────────
  function analyzeMarketShare(ttt, brickFilter) {
    if (!ttt) return [];
    var cacheKey = ttt + '|' + (brickFilter || '__all__');
    if (_cache[cacheKey]) return _cache[cacheKey];

    var rows = _getImsRows(ttt);
    if (!rows.length) {
      _cache[cacheKey] = [];
      return [];
    }

    var ownImsMap = (typeof OWN_IMS !== 'undefined') ? OWN_IMS : {};

    // brick × ilac_grubu bazlı gruplama
    var brickMap = {};
    rows.forEach(function (r) {
      if (brickFilter && r.brick !== brickFilter) return;
      var key = (r.brick || '') + '|' + (r.ilac_grubu || '');
      if (!brickMap[key]) {
        brickMap[key] = { brick: r.brick, ilacGrubu: r.ilac_grubu, rows: [] };
      }
      brickMap[key].rows.push(r);
    });

    var results = Object.keys(brickMap).map(function (k) {
      var e = brickMap[k];
      var ownKey  = ownImsMap[e.ilacGrubu];
      var mktRows = e.rows.filter(function (r) { return r.is_mkt === true; });
      var ownRows = e.rows.filter(function (r) { return r.is_mkt === false && r.ilac === ownKey; });

      var mktTotal = _sum(mktRows, 'toplam');
      var ownTotal = _sum(ownRows, 'toplam');

      var dataQuality = !mktRows.length ? 'NO_MARKET_DATA'
                       : !ownRows.length ? 'NO_OWN_DATA'
                       : 'OK';

      var bizimPay = mktTotal > 0 ? (ownTotal / mktTotal * 100) : 0;
      var rakipPay = mktTotal > 0 ? Math.max(0, 100 - bizimPay) : 0;

      var trendInfo = _trendFromSeries(_weekShareSeries(ownRows, mktRows));

      return {
        brick:          e.brick,
        ilacGrubu:      e.ilacGrubu,
        product:        e.ilacGrubu,
        bizimPay:       Math.round(bizimPay * 10) / 10,
        rakipPay:       Math.round(rakipPay * 10) / 10,
        shareTrend:     trendInfo.trend,
        shareChangePct: trendInfo.changePct,
        dataQuality:    dataQuality
      };
    });

    _cache[cacheKey] = results;
    return results;
  }

  // ── getOverallShareSummary — renderMarketShareCard (index.html) için ──
  function getOverallShareSummary(ttt) {
    var records = analyzeMarketShare(ttt).filter(function (r) { return r.dataQuality === 'OK'; });
    var avgBizimPay = records.length
      ? Math.round((_sum(records, 'bizimPay') / records.length) * 10) / 10
      : null;
    return {
      avgBizimPay:          avgBizimPay,
      risingShareBricks:    records.filter(function (r) { return r.shareTrend === 'up'; }),
      decliningShareBricks: records.filter(function (r) { return r.shareTrend === 'down'; })
    };
  }

  // ── shareTrend / shareChangePct — competitive-impact-engine eski arayüz ──
  function shareTrend(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 'stable';
    return results[0].shareTrend;
  }

  function shareChangePct(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 0;
    return results[0].shareChangePct;
  }

  function clearCache() { _cache = {}; }

  window.MarketShareEngine = {
    analyzeMarketShare:     analyzeMarketShare,
    getOverallShareSummary: getOverallShareSummary,
    shareTrend:             shareTrend,
    shareChangePct:         shareChangePct,
    clearCache:             clearCache,
    version: '8.1-hotfix'
  };

  console.debug('[market-share-engine] v8.1-hotfix yüklendi.');

})();
