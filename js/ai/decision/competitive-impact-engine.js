// ══════════════════════════════════════════════════════════════════════
//  js/ai/decision/competitive-impact-engine.js
//  FAZ 6.6 — Competitive Impact Engine
//
//  Sorumluluk:
//    "Rakip kampanyası gerçekten etkili oldu mu? Hangi brick etkilendi?"
//    sorusuna RCA motoruna kanıt olarak beslenecek, OLASILIKSAL (kesin
//    değil) bir cevap üretir.
//
//  ⚠️ KRİTİK GRANÜLARİTE SINIRLAMASI (bkz. AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md
//    §6, §16 FAZ 6.6 — kod incelemesiyle DOĞRULANMIŞ, roadmap'in orijinal
//    planını DÜZELTEN bir bulgu):
//
//    Roadmap'in ilk tasarımı "kampanya penceresini IMS'in h1..h9 haftalık
//    bucket'larına haritalar" diyordu. KOD İNCELEMESİ SONUCU: sistemde
//    h1..h9'u GERÇEK TAKVİM TARİHİNE bağlayan HİÇBİR mekanizma yok —
//    ne ims-adapter.js'de, ne runrate-engine.js'de, ne PERIODS'ta
//    (date-utils.js — o sadece 2 aylık satış dönemleri, haftalık değil).
//    h1..h9 muhtemelen IMS pazar araştırma dosyasının "son 9 hafta"
//    kayan penceresi, ama HANGİ 9 hafta olduğu (hangi takvim tarihleri)
//    parse edilen veride YOK. Bu yüzden bu motor HAFTALIK DEĞİL, AY
//    BAZLI bir eşleme yapar:
//      "Bu pazarda bu ay (veya geçen ay) bir rakip kampanyası oldu mu?"
//      +
//      "Bu pazarın brick'lerinde bizim payımız ŞU AN düşüyor mu?
//       (MarketShareEngine.shareTrend — 9 haftalık ilk-yarı/ikinci-yarı
//       karşılaştırması, KENDİSİ DE haftalık değil aylık kesinlikte
//       yorumlanmalı, çünkü hangi takvim haftaları olduğu bilinmiyor)"
//    İki sinyal ÇAKIŞIYORSA "muhtemelen etkilendi" diye düşük-orta güven
//    skoruyla işaretlenir — KESİN NEDEN-SONUÇ İDDİA EDİLMEZ. Bu motorun
//    ürettiği "kanıt" her zaman güven skoruyla birlikte sunulur, RCA
//    motoru bunu DİĞER kanıtlarla (coverage, trend, vb.) karşılaştırarak
//    nihai kararı verir — bu motor TEK BAŞINA "rakip suçlu" demez.
//
//  NEDEN BRICK ATFI DAHA KESİN OLAMAZ (dürüstlük notu, §6.5):
//    RAKIP_AKSİYON.csv brick seviyesinde değil, PAZAR GENELİ (ulusal) bir
//    kampanya takvimi. "Hangi brick'te kampanya yapıldı" sorusunun cevabı
//    bu dosyadan DİREKT gelmiyor — biz sadece "kampanya VARDI" + "bizim
//    payımız bu brick'te düştü" iki ayrı, bağımsız sinyali ZAMANSAL
//    YAKINLIK üzerinden ilişkilendiriyoruz. Aynı pencerede başka nedenler
//    de (mevsimsellik, stok, kendi saha uygulaması, coverage düşüklüğü)
//    payı düşürmüş olabilir — bu motor bunları ELEMEZ, sadece "rakip de
//    bir aday neden" diye işaretler.
//
//  STANDART CompetitiveImpactEvidence MODELİ:
//    {
//      brick, ilacGrubu, ay,
//      rakipKampanyaVarMi: boolean,
//      kampanyaDetay: { firma, urun, baslangic, bitis, indirimPct } | null,
//      bizimPayTrend: 'up'|'down'|'stable',
//      bizimPayDegisimPct: number,             // MarketShareEngine.shareChangePct
//      zamansalCakisma: boolean,               // kampanya ayı === pay düşüş dönemi mi (yaklaşık)
//      guvenSkoru: number,                     // 0-100 — KASITLI DÜŞÜK tavanlı (bkz. _GUVEN_TAVANI)
//      aciklama: string                        // insan-okur, güven seviyesini DE içeren cümle
//    }
//
//  GÜVEN SKORU TAVANI: bu motorun ürettiği hiçbir kanıt %65'in üzerine
//  ÇIKMAZ (_GUVEN_TAVANI) — çünkü brick-seviyesi kampanya verisi yok,
//  hafta-seviyesi tarih eşlemesi yok; %65 üzeri "kesin" izlenimi verir,
//  bu motorun granülaritesi buna izin vermiyor (dürüstlük kuralı, kod
//  seviyesinde uygulanmış).
//
//  Public API:
//    analyzeImpact(ttt, brick)        → CompetitiveImpactEvidence[]
//                                        (verilen ttt'nin brick'leri için;
//                                        brick verilirse tek brick)
//    getEvidenceForRCA(ttt, ilacGrubu, ay) → CompetitiveImpactEvidence | null
//                                        (RCA motorunun "Rakip" nedeni için
//                                        TEK bir kanıt sorgusu — §10 RCA
//                                        tasarımının beklediği arayüz)
//    clearCache()
//
//  Kurallar:
//    • competitive-adapter.js / market-share-engine.js DEĞİŞTİRİLMEDİ —
//      sadece okunur.
//    • DOM erişimi YOK.
//    • Bu motor RCA motoruna (henüz YAZILMAMIŞ — js/ai/decision/rca-engine.js,
//      ayrı bir FAZ) KANIT ÜRETİR, kendisi KARAR VERMEZ. "Rakip suçlu"
//      gibi kesin bir sonuç asla döndürmez — her zaman guvenSkoru ile
//      birlikte, olasılıksal dille.
//
//  Bağımlılık: js/ai/territory/market-share-engine.js (FAZ 6.3.5),
//              js/ai/core/competitive-adapter.js (FAZ 6.4) — ikisi de
//              opsiyonel (typeof kontrolü, eksikse boş kanıt listesi döner)
//  Yükleme sırası: market-share-engine.js SONRASI, competitive-adapter.js
//                  SONRASI; rca-engine.js (henüz yok) ÖNCESİ olmalı
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._COMPETITIVE_IMPACT_ENGINE_LOADED) {
    console.warn('[competitive-impact-engine] Zaten yüklü — atlandı');
    return;
  }
  window._COMPETITIVE_IMPACT_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';
  var _GUVEN_TAVANI = 65; // bkz. dosya başı "Güven Skoru Tavanı" notu — asla aşılmaz

  var AY_SIRASI = ['OCAK','ŞUBAT','MART','NİSAN','MAYIS','HAZİRAN'];
  function _ayIndex(ay) {
    var i = AY_SIRASI.indexOf(ay);
    return i === -1 ? -1 : i;
  }

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) Yardımcılar — competitive-adapter.js'in formülleriyle AYNI
  //     (çapraz bağımlılık yaratmamak için burada küçük bir tekrar —
  //     pharmacy-adapter.js / launch-readiness-engine.js'de de izlenen
  //     desen)
  // ──────────────────────────────────────────────────────────────────
  function _indirimPct(tier) {
    if (!tier || (tier.min + tier.bonus) === 0) return 0;
    return Math.round((tier.bonus / (tier.min + tier.bonus)) * 1000) / 10;
  }
  function _mostGenerousTier(tiers) {
    if (!tiers || !tiers.length) return null;
    var best = tiers[0], bestPct = _indirimPct(tiers[0]);
    for (var i = 1; i < tiers.length; i++) {
      var pct = _indirimPct(tiers[i]);
      if (pct > bestPct) { best = tiers[i]; bestPct = pct; }
    }
    return best;
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) Bir pazarda, belirli bir ay (veya bir önceki ay) için rakip
  //     kampanyası var mıydı? — competitive-adapter.js'in
  //     CompetitiveRecord'larından okunur (kampanya alanı dolu olanlar).
  // ──────────────────────────────────────────────────────────────────
  function _findKampanya(ilacGrubu, ay) {
    if (!window.CompetitiveAdapter) return null;

    var competitorActions = _safe(function () {
      return window.CompetitiveAdapter.normalizeCompetitive().competitorActions;
    }, []);

    var ayIdx = _ayIndex(ay);
    // "bu ay VEYA bir önceki ay" — zamansal yakınlık penceresi (§ açıklama:
    // pay düşüşü kampanyadan hemen sonra değil, birkaç hafta gecikmeyle de
    // gözlemlenebilir; bu yüzden tek aya değil iki aya bakılır).
    var candidates = competitorActions.filter(function (r) {
      if (r.ilacGrubu !== ilacGrubu || !r.kampanya) return false;
      var rIdx = _ayIndex(r.ay);
      return rIdx === ayIdx || rIdx === ayIdx - 1;
    });

    if (!candidates.length) return null;

    // En agresif (en yüksek indirimPct) kampanyayı öne çıkar.
    var best = null, bestPct = -1;
    candidates.forEach(function (r) {
      var tier = _mostGenerousTier(r.kampanya.tiers);
      var pct = tier ? _indirimPct(tier) : 0;
      if (pct > bestPct) { bestPct = pct; best = r; }
    });

    return best ? {
      firma: best.firma, urun: best.urun,
      baslangic: best.kampanya.baslangic, bitis: best.kampanya.bitis,
      indirimPct: bestPct
    } : null;
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) ANA ANALİZ — analyzeImpact(ttt, brick)
  // ──────────────────────────────────────────────────────────────────
  function _buildEvidence(ttt, shareRecord, ay) {
    var kampanyaDetay = _findKampanya(shareRecord.ilacGrubu, ay);
    var rakipKampanyaVarMi = !!kampanyaDetay;
    var bizimPayTrend = shareRecord.shareTrend;
    var payDusuyor = bizimPayTrend === 'down';

    var zamansalCakisma = rakipKampanyaVarMi && payDusuyor;

    // Güven skoru — KASITLI mütevazı, _GUVEN_TAVANI'nı asla aşmaz.
    // Bileşenler: kampanya varlığı (temel sinyal) + pay düşüş şiddeti
    // (ne kadar dik düşüyor) + kampanyanın kendi agresifliği (indirimPct).
    var guvenSkoru = 0;
    if (zamansalCakisma) {
      var dususSiddeti = Math.min(30, Math.abs(shareRecord.shareChangePct || 0) * 0.6);
      var kampanyaSiddeti = Math.min(20, (kampanyaDetay.indirimPct || 0) * 0.4);
      guvenSkoru = Math.round(15 + dususSiddeti + kampanyaSiddeti); // taban 15 + iki bileşen
      guvenSkoru = Math.min(_GUVEN_TAVANI, guvenSkoru);
    } else if (rakipKampanyaVarMi && !payDusuyor) {
      guvenSkoru = 5; // kampanya var ama pay düşmüyor — zayıf, ihmal edilebilir sinyal
    }

    var aciklama;
    if (zamansalCakisma) {
      aciklama = shareRecord.brick + ' brick\'inde ' + shareRecord.ilacGrubu + ' payımız düşüyor (' +
        (shareRecord.shareChangePct > 0 ? '+' : '') + shareRecord.shareChangePct + '%), ' +
        'aynı dönemde ' + kampanyaDetay.firma + ' (' + kampanyaDetay.urun + ') %' + kampanyaDetay.indirimPct +
        ' indirimli kampanya yürütmüş. Zamansal çakışma var ama KESİN NEDEN-SONUÇ İLİŞKİSİ İDDİA EDİLEMEZ ' +
        '(brick-seviyesi kampanya verisi yok, başka nedenler de olabilir). Güven: %' + guvenSkoru + ' (düşük-orta).';
    } else if (rakipKampanyaVarMi) {
      aciklama = shareRecord.brick + ' brick\'inde rakip kampanyası var ama bizim payımız düşmüyor — ' +
        'zayıf sinyal, muhtemelen önemsiz.';
    } else if (payDusuyor) {
      aciklama = shareRecord.brick + ' brick\'inde payımız düşüyor ama bu pazarda yakın zamanda ' +
        'kayıtlı bir rakip kampanyası bulunamadı — düşüşün başka bir nedeni olabilir (coverage, trend, stok vb.).';
    } else {
      aciklama = shareRecord.brick + ' brick\'inde rakip kampanyası veya pay düşüşü tespit edilmedi.';
    }

    return {
      brick: shareRecord.brick,
      ilacGrubu: shareRecord.ilacGrubu,
      ay: ay,
      rakipKampanyaVarMi: rakipKampanyaVarMi,
      kampanyaDetay: kampanyaDetay,
      bizimPayTrend: bizimPayTrend,
      bizimPayDegisimPct: shareRecord.shareChangePct,
      zamansalCakisma: zamansalCakisma,
      guvenSkoru: guvenSkoru,
      aciklama: aciklama
    };
  }

  var _cache = {}; // ttt+brick → { evidence, timestamp }
  var CACHE_TTL_MS = 60000;

  function analyzeImpact(ttt, brick) {
    if (!ttt) return [];
    if (!window.MarketShareEngine) {
      console.warn('[competitive-impact-engine] MarketShareEngine yüklü değil — boş dönüyor');
      return [];
    }

    var cacheKey = ttt + '|' + (brick || '__ALL__');
    var now = Date.now();
    var cached = _cache[cacheKey];
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) return cached.evidence;

    var shareRecords = _safe(function () {
      return window.MarketShareEngine.analyzeMarketShare(ttt, brick) || [];
    }, []);

    // Bu fonksiyon "şu an" için bir analiz üretir — ay parametresi olmadan
    // çağrıldığında en güncel ayı (AY_SIRASI'nın son elemanı, dosyada veri
    // varsa) kullanır. getEvidenceForRCA() spesifik ay sorgusu sağlar.
    var guncelAy = AY_SIRASI[AY_SIRASI.length - 1];

    var evidence = shareRecords
      .filter(function (r) { return r.dataQuality === 'OK'; }) // NO_OWN_DATA/NO_MARKET_DATA için anlamlı değil
      .map(function (r) { return _buildEvidence(ttt, r, guncelAy); });

    _cache[cacheKey] = { evidence: evidence, timestamp: now };
    return evidence;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) getEvidenceForRCA(ttt, ilacGrubu, ay) — RCA motorunun beklediği
  //     TEK kanıt sorgusu arayüzü (§10 RCA tasarımı: "her biri için bir
  //     kanıt skoru üretir" — bu motor "Rakip" nedeni için BU fonksiyonu
  //     sağlar, henüz rca-engine.js tarafından ÇAĞRILMIYOR).
  // ──────────────────────────────────────────────────────────────────
  function getEvidenceForRCA(ttt, ilacGrubu, ay) {
    if (!ttt || !ilacGrubu) return null;
    if (!window.MarketShareEngine) return null;

    var shareRecords = _safe(function () {
      return (window.MarketShareEngine.analyzeMarketShare(ttt) || [])
        .filter(function (r) { return r.ilacGrubu === ilacGrubu && r.dataQuality === 'OK'; });
    }, []);

    if (!shareRecords.length) return null;

    var targetAy = ay || AY_SIRASI[AY_SIRASI.length - 1];

    // Bu ilaç grubundaki TÜM brick'lerin kanıtlarını üretip en yüksek
    // güven skorlusunu döndürür (RCA için "en güçlü kanıt" mantığı).
    var allEvidence = shareRecords.map(function (r) { return _buildEvidence(ttt, r, targetAy); });
    allEvidence.sort(function (a, b) { return b.guvenSkoru - a.guvenSkoru; });

    return allEvidence[0] || null;
  }

  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.CompetitiveImpactEngine = {
    analyzeImpact: analyzeImpact,
    getEvidenceForRCA: getEvidenceForRCA,
    clearCache: clearCache,
    version: ENGINE_VERSION
  };

  console.debug('[competitive-impact-engine] yüklendi. Versiyon:', ENGINE_VERSION,
    '| Güven skoru tavanı: %' + _GUVEN_TAVANI + ' (granülarite kısıtlaması nedeniyle)');

})();
