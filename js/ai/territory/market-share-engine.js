// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/market-share-engine.js
//  FAZ 6.3.5 — Market Share Engine (İskelet)
//  FAZ 8.0 — Kırık referans düzeltmesi: dosya yoktu, oluşturuldu
//  FAZ 8.1 — BUG DÜZELTMESİ (kod incelemesiyle tespit edildi):
//
//    Eski _getImsRecords() SADECE IMSAdapter.normalizeIMS() kullanıyordu —
//    ama o fonksiyon TASARIM GEREĞİ is_mkt:true (pazar toplamı) satırlarını
//    HARİÇ TUTAR (bkz. ims-adapter.js normalizeIMS: "Sadece KENDİ ÜRÜN
//    satırları"). Sonuç: compTotal hiçbir zaman doldurulamıyordu, "total"
//    her zaman sadece ourTotal'dan ibaretti → ourShare HER ZAMAN %100
//    çıkıyordu. Üstüne üstlük dönen sonuç objesinde hiç "dataQuality"
//    alanı yoktu; competitive-impact-engine.js ise kanıtları SADECE
//    r.dataQuality === 'OK' olanlarla filtreliyor — bu alan hiç var
//    olmadığından filtre HER ZAMAN her şeyi eledi ve analyzeImpact() HER
//    ZAMAN boş dizi döndü (decision-engine.js'deki "rakip kampanyası"
//    risk bayrağı da bu yüzden hiçbir zaman true olamıyordu).
//
//    Düzeltme: bu motor artık adapter'ı değil HAM IMS'i (window.IMS) okur
//    — hem kendi ürün satırlarını (is_mkt:false) hem pazar toplamı
//    satırlarını (is_mkt:true) brick + ilac_grubu bazında gruplar, gerçek
//    ourShare/competitorShare ve dataQuality üretir. Trend/changePct de
//    artık sabit 'stable'/0 değil — competitive-impact-engine.js'in
//    dosya başlığında zaten tarif ettiği "9 haftalık ilk-yarı/ikinci-yarı
//    karşılaştırması" yöntemiyle haftalık own/market oranından hesaplanır
//    (hem kendi hem pazar toplamı satırlarında h1..h9 kolonları mevcut).
//
//  Sorumluluk: IMS verisinden brick/temsilci bazında pazar payı hesaplar.
//  competitive-impact-engine.js tarafından tüketilir (opsiyonel — yoksa
//  boş döner).
//
//  Public API:
//    analyzeMarketShare(ttt, brick) → MarketShareResult[]
//    shareTrend(ttt, brick)        → 'up'|'down'|'stable'
//    shareChangePct(ttt, brick)    → number
//
//  MarketShareResult:
//    { brick, ilacGrubu, ourShare, competitorShare, trend, changePct,
//      dataQuality: 'OK'|'NO_MARKET_DATA'|'NO_OWN_DATA'|'ANOMALY_OWN_EXCEEDS_MARKET' }
//      (ANOMALY_* — kaynak veride tutarsızlık: kendi satış > pazar toplamı;
//       bkz. analyzeMarketShare() içindeki teşhis notu. Bu satırlar 'OK'
//       filtrelerinde otomatik elenir; ayrıntı için konsol uyarısına bakın.)
//
//  Bağımlılık: js/data/data-state.js (IMS)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS */

(function () {
  'use strict';

  if (window._MARKET_SHARE_ENGINE_LOADED) {
    console.warn('[market-share-engine] Zaten yüklü — atlandı');
    return;
  }
  window._MARKET_SHARE_ENGINE_LOADED = true;

  var WEEK_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];
  // ims-adapter.js'deki TREND_STABLE_THRESHOLD_PCT ile aynı konvansiyon —
  // ölçekten bağımsız, göreli (%) bir "belirgin değişim" eşiği.
  var TREND_STABLE_THRESHOLD_PCT = 5;

  var _cache = {}; // cacheKey → { results, signature }

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── _dataSignature — ims-adapter.js'deki AYNI ucuz imza yöntemi:
  //    satır sayısı + toplam hacim. IMS senkronize olunca değişir →
  //    cache otomatik geçersizleşir (manuel clearCache() gerekmez).
  function _dataSignature(ttt) {
    var rows = _getRawImsRows(ttt);
    var totalSum = rows.reduce(function (s, r) { return s + (r.toplam || 0); }, 0);
    return rows.length + ':' + totalSum;
  }

  // ── _getRawImsRows — HAM IMS satırlarını okur (own + market, adapter'ı
  //    bypass eder çünkü adapter is_mkt:true satırları filtreler) ────────
  function _getRawImsRows(ttt) {
    return _safe(function () {
      return (typeof IMS !== 'undefined' ? IMS : []).filter(function (r) { return r.ttt === ttt; });
    }, []);
  }

  // ── _weeklyShareTrend — own/market haftalık oranından ilk-yarı/ikinci-
  //    yarı karşılaştırması. Hem own hem market satırı gerekiyorsa da,
  //    market tarafında birden çok satır olabileceğinden (nadiren) her
  //    hafta için own ve market toplamları AYRI AYRI toplanır, sonra
  //    oran hesaplanır (haftalık oranların ortalamasını almak yerine —
  //    böylece küçük haftalarda oran sapması abartılmaz).
  function _weeklyShareTrend(ownRows, mktRows) {
    var shareByWeek = WEEK_KEYS.map(function (k) {
      var ownSum = ownRows.reduce(function (s, r) { return s + (r[k] || 0); }, 0);
      var mktSum = mktRows.reduce(function (s, r) { return s + (r[k] || 0); }, 0);
      return mktSum > 0 ? (ownSum / mktSum) * 100 : null; // o hafta veri yoksa null
    }).filter(function (v) { return v !== null; });

    if (shareByWeek.length < 2) return { trend: 'stable', changePct: 0 };

    var mid      = Math.floor(shareByWeek.length / 2);
    var earlyAvg = shareByWeek.slice(0, mid).reduce(function (s, v) { return s + v; }, 0) / mid;
    var lateVals = shareByWeek.slice(mid);
    var lateAvg  = lateVals.reduce(function (s, v) { return s + v; }, 0) / lateVals.length;

    var changePct = Math.round((lateAvg - earlyAvg) * 10) / 10;
    var trend;
    if (earlyAvg === 0) {
      trend = lateAvg > 0 ? 'up' : 'stable';
    } else {
      var relPct = (changePct / earlyAvg) * 100;
      trend = relPct > TREND_STABLE_THRESHOLD_PCT ? 'up'
        : relPct < -TREND_STABLE_THRESHOLD_PCT ? 'down' : 'stable';
    }
    return { trend: trend, changePct: changePct };
  }

  // ── analyzeMarketShare — brick × ilac_grubu bazında pazar payı ────────
  function analyzeMarketShare(ttt, brickFilter) {
    var cacheKey = (ttt || '__all__') + '|' + (brickFilter || '__all__');
    var sig    = _dataSignature(ttt);
    var cached = _cache[cacheKey];
    if (cached && cached.signature === sig) return cached.results;

    var rows = _getRawImsRows(ttt);
    if (!rows.length) {
      _cache[cacheKey] = { results: [], signature: sig };
      return [];
    }

    // brick × ilac_grubu (molekül/pazar ailesi) bazında grupla — bir
    // "X PAZARI TOPLAM" satırı o brick'teki o molekülün TÜM pazarını
    // (bizim dahil) temsil eder; kendi ürün satırları aynı brick+grup
    // altında ayrı satırlar olarak durur.
    var groups = {};
    rows.forEach(function (r) {
      if (brickFilter && r.brick !== brickFilter) return;
      var key = (r.brick || '') + '|' + (r.ilac_grubu || '');
      if (!groups[key]) groups[key] = { brick: r.brick, ilacGrubu: r.ilac_grubu, own: [], mkt: [] };
      (r.is_mkt ? groups[key].mkt : groups[key].own).push(r);
    });

    var results = Object.keys(groups).map(function (k) {
      var g = groups[k];
      var ownTotal = g.own.reduce(function (s, r) { return s + (r.toplam || 0); }, 0);
      var mktTotal = g.mkt.reduce(function (s, r) { return s + (r.toplam || 0); }, 0);

      var dataQuality = mktTotal <= 0 ? 'NO_MARKET_DATA' : (ownTotal <= 0 ? 'NO_OWN_DATA' : 'OK');

      // TEŞHİS: ownTotal mantıken mktTotal'ı (TÜM pazarı) aşamaz — aşıyorsa
      // bu, kaynak veride bir tutarsızlık olduğunu gösterir (ör. aynı
      // molekül için birden fazla "kendi ürün" satırı yanlışlıkla
      // toplanıyor, ya da PAZARI TOPLAM satırı yanlış kolon/hafta'dan
      // okunuyor). Eskiden bu durum Math.min(100,...) ile SESSİZCE tam
      // "100.0%" gösterilip gizleniyordu. Artık ayrı bir kalite etiketiyle
      // işaretleniyor ve ham sayılar konsola yazdırılıyor.
      var rawRatio = mktTotal > 0 ? (ownTotal / mktTotal) * 100 : 0;
      if (dataQuality === 'OK' && rawRatio > 100.5) {
        dataQuality = 'ANOMALY_OWN_EXCEEDS_MARKET';
        console.warn('[market-share-engine] VERİ TUTARSIZLIĞI: ' + g.brick + ' / ' + g.ilacGrubu +
          ' — kendi satışımız (' + Math.round(ownTotal) + ') "pazar toplamı"ndan (' + Math.round(mktTotal) +
          ') büyük çıktı (ham oran: %' + Math.round(rawRatio) + '). IMS_TABLO.csv\'de bu brick+ürün için ' +
          'birden fazla "kendi ürün" satırı olup olmadığını veya PAZARI TOPLAM satırının doğru hafta/kolondan ' +
          'okunduğunu kontrol edin.');
      }
      var ourShare  = mktTotal > 0 ? Math.round(Math.min(100, rawRatio)) : 0;
      var compShare = Math.max(0, 100 - ourShare);

      var trendInfo = dataQuality === 'OK' ? _weeklyShareTrend(g.own, g.mkt) : { trend: 'stable', changePct: 0 };

      return {
        brick:           g.brick,
        ilacGrubu:       g.ilacGrubu,
        ourShare:        ourShare,
        competitorShare: compShare,
        trend:           trendInfo.trend,
        changePct:       trendInfo.changePct,
        dataQuality:     dataQuality,
        // TEŞHİS: ham sayılar — kullanıcı arayüzde doğrudan görebilsin diye
        // (konsol açmaya gerek kalmadan). ownTotal/mktTotal kutu cinsinden.
        ownTotal:        Math.round(ownTotal),
        mktTotal:         Math.round(mktTotal)
      };
    });

    _cache[cacheKey] = { results: results, signature: sig };
    return results;
  }

  // ── getOverallShareSummary — index.html renderMarketShareCard() bunu
  //    çağırıyor ama fonksiyon hiç var olmamıştı (eksik export) — bu
  //    yüzden çağrı anında TypeError fırlatıyor ve kart kalıcı olarak boş
  //    kalıyordu ("Pazar Payı Analizi veri üretmiyor"). Artık
  //    analyzeMarketShare() sonuçlarından türetiliyor.
  function getOverallShareSummary(ttt) {
    var records = analyzeMarketShare(ttt).filter(function (r) { return r.dataQuality === 'OK'; });
    if (!records.length) {
      return { avgBizimPay: null, risingShareBricks: [], decliningShareBricks: [] };
    }
    var avg = records.reduce(function (s, r) { return s + r.ourShare; }, 0) / records.length;
    var rising = records.filter(function (r) { return r.trend === 'up'; }).map(function (r) { return r.brick; });
    var declining = records.filter(function (r) { return r.trend === 'down'; }).map(function (r) { return r.brick; });
    return { avgBizimPay: avg, risingShareBricks: rising, decliningShareBricks: declining };
  }

  // ── shareTrend / shareChangePct — competitive-impact-engine şeması ────
  function shareTrend(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 'stable';
    return results[0].trend;
  }

  function shareChangePct(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 0;
    return results[0].changePct;
  }

  function clearCache() { _cache = {}; }

  window.MarketShareEngine = {
    analyzeMarketShare:     analyzeMarketShare,
    getOverallShareSummary: getOverallShareSummary,
    shareTrend:             shareTrend,
    shareChangePct:         shareChangePct,
    clearCache:             clearCache,
    version: '8.2-fixed'
  };

  console.debug('[market-share-engine] FAZ 8.1 yüklendi (bug düzeltmesi ile).');

})();
