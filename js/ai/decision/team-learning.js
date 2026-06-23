// ══════════════════════════════════════════════════════════════════════
//  js/ai/decision/team-learning.js
//  FAZ 6.8 — Team Learning
//
//  Sorumluluk:
//    En başarılı temsilci davranışını (brick, ürün, aksiyon tipi bazında)
//    sistematik olarak öğrenir ve yöneticiye + diğer temsilcilere
//    "ne işe yarıyor?" bilgisini sunar.
//
//  Roadmap §8 ve §16 FAZ 6.8 (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md):
//    > "Team Learning (en başarılı temsilci davranışını öğren → öner)"
//    > "executive-engine.js seviyesinde bir agregasyon"
//    > "PatternLearningEngine.getBestPatterns() zaten brick/ürün bazlı
//       pattern döndürüyor — yani 'en başarılı temsilci davranışını
//       öğren, diğerlerine öner' özelliği MEVCUT pattern modelinden EK
//       MOTOR YAZMADAN, sadece executive-engine.js seviyesinde bir
//       agregasyon ile mümkün."
//
//  TASARIM KARARI — hiçbir mevcut dosya değiştirilmez:
//    LearningHub.getTeamBestPractices() (FAZ 6.2, mevcut) zaten
//    brick/ürün bazlı başarı patternlerini topluyor. Bu motor onun
//    çıktısını:
//      (a) ExecutiveDashboard'a "Team Learning" kartı olarak sunar
//      (b) Her temsilci (ttt) için KİŞİSELLEŞTİRİLMİŞ bir
//          "senin için en uygun en iyi uygulama" önerisi üretir
//      (c) AIContextBuilder.context.decision.teamLearning alanını doldurur
//
//  ÖNEMLİ KISITLAMA (§8 notu, kod incelemesiyle doğrulandı):
//    PatternLearningEngine'in IndexedDB index'leri SADECE product/brick/
//    recommendationType üzerinde — temsilci (ttt) bazlı index YOK.
//    Bu yüzden "en başarılı temsilci" kavramı DOĞRUDAN PatternLearning'den
//    gelemiyor. Bunun yerine şu hibrit yaklaşım kullanılır:
//      1) Hangi brick/ürün kombinasyonu en yüksek başarı oranına sahip?
//         (PatternLearningEngine — mevcut)
//      2) Hangi temsilci o brick/üründe şu an iyi performans gösteriyor?
//         (team-ranking-engine.buildTeamRanking() × brick/ürün eşlemesi
//          — bu motor bunu bağlar)
//    Bu ikisi ÇAKIŞTIĞINDA "bu temsilcinin bu brick'teki davranışı
//    öğrenilmiş başarılı bir pattern'la örtüşüyor" çıkarımı yapılır.
//    Kesin "bu temsilci başarılı çünkü X yapıyor" iddiası YAPILMAZ —
//    her zaman güven skoru ve veri kalitesi notu eşliğinde sunulur.
//
//  STANDART TeamLearningInsight MODELİ:
//    {
//      type: 'BEST_PRACTICE'|'PERSONAL_COACHING'|'TEAM_SUMMARY',
//      targetTTT: string|null,  // null = tüm ekip için
//      brick: string|null,
//      product: string|null,
//      recommendationType: string|null,
//      insight: string,         // insan-okur, actionable cümle
//      successRate: number,     // 0-100
//      sampleSize: number,
//      confidence: 'HIGH'|'MEDIUM'|'LOW',
//      source: string           // hangi motordan geldi
//    }
//
//  Public API:
//    getTeamLearningInsights(ttts)      → TeamLearningInsight[] (ekip geneli)
//    getPersonalCoachingHints(ttt)      → TeamLearningInsight[] (bir temsilciye özel)
//    getTeamLearningContext()           → AIContextBuilder / ExecutiveDashboard için özet
//    enrichExecutiveDashboard(dashboard) → buildExecutiveDashboard() çıktısına
//                                          teamLearning alanı ekler (mevcut
//                                          executive-engine.js'i DEĞIŞTIRMEDEN)
//    clearCache()
//
//  Kurallar:
//    • executive-engine.js, team-ranking-engine.js, learning-hub.js
//      HİÇBİRİ DEĞİŞTİRİLMEDİ — sadece okunur / çıktısı zenginleştirilir.
//    • DOM erişimi YOK.
//    • Tüm bağımlılıklar opsiyonel — typeof guard.
//
//  Bağımlılık:
//    js/ai/core/learning-hub.js           (FAZ 6.2, opsiyonel)
//    js/ai/executive/team-ranking-engine.js (mevcut, opsiyonel)
//    js/ai/decision/decision-engine.js    (FAZ 6.7, opsiyonel — BRICK_PRIORITY kararlarını besler)
//  Yükleme sırası: learning-hub.js + team-ranking-engine.js SONRASI;
//                  executive-engine.js ile AYNI SIRADA veya SONRASI olabilir
//                  (enrichExecutiveDashboard() çalışma-zamanında çağrılır)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._TEAM_LEARNING_LOADED) {
    console.warn('[team-learning] Zaten yüklü — atlandı');
    return;
  }
  window._TEAM_LEARNING_LOADED = true;

  var ENGINE_VERSION = '1.0';

  var CACHE_TTL_MS = 60000;
  var _cache = {};

  function _safe(fn, fallback) {
    try {
      var v = fn();
      return (v === undefined || v === null) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // ── Güven seviyesi — sample size + successRate birlikte değerlendirilir ──
  function _confidence(sampleSize, successRate) {
    if (sampleSize >= 10 && successRate >= 70) return 'HIGH';
    if (sampleSize >= 5  && successRate >= 50) return 'MEDIUM';
    return 'LOW';
  }

  // ══════════════════════════════════════════════════════════════════
  //  1) TAKIM GENELİ EN İYİ UYGULAMALAR
  //     LearningHub.getTeamBestPractices() → insan-okur insight'lara çevir
  // ══════════════════════════════════════════════════════════════════

  function _buildTeamInsights(limit) {
    limit = limit || 8;

    var practices = _safe(function () {
      if (!window.LearningHub ||
          typeof window.LearningHub.getTeamBestPractices !== 'function') return [];
      return window.LearningHub.getTeamBestPractices(limit) || [];
    }, []);

    if (!practices.length) return [];

    return practices.map(function (p) {
      var conf = _confidence(p.sampleSize, p.successRate);

      var insightText;
      if (p.brick && p.product) {
        insightText = p.brick + ' bölgesinde ' + p.product +
          ' için ' + (p.recommendationType || 'yapılan aksiyon') +
          ' %' + p.successRate + ' başarı oranıyla öne çıkıyor (' +
          p.sampleSize + ' veri noktası). ' +
          (conf === 'HIGH' ? 'Bu pattern tüm ekibe önerilebilir.' :
           conf === 'MEDIUM' ? 'Yeterli veri birikmekte — izlenmeye devam.' :
           'Henüz sınırlı veri; dikkatli değerlendirin.');
      } else if (p.brick) {
        insightText = p.brick + ' bölgesinde ' +
          (p.recommendationType || 'uygulanan aksiyon tipi') +
          ' %' + p.successRate + ' başarılı (' + p.sampleSize + ' örnek).';
      } else if (p.product) {
        insightText = p.product + ' ürününde ' +
          (p.recommendationType || 'uygulanan aksiyon tipi') +
          ' %' + p.successRate + ' başarılı (' + p.sampleSize + ' örnek).';
      } else {
        insightText = (p.recommendationType || 'Bu aksiyon tipi') +
          ' %' + p.successRate + ' başarı oranına sahip (' + p.sampleSize + ' örnek).';
      }

      return {
        type:               'BEST_PRACTICE',
        targetTTT:          null,
        brick:              p.brick || null,
        product:            p.product || null,
        recommendationType: p.recommendationType || null,
        insight:            insightText,
        successRate:        p.successRate,
        sampleSize:         p.sampleSize,
        confidence:         conf,
        source:             'LearningHub.getTeamBestPractices'
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  2) KİŞİSELLEŞTİRİLMİŞ KOÇLUK İPUÇLARI — getPersonalCoachingHints(ttt)
  //
  //  Hibrit yaklaşım (§ Önemli Kısıtlama):
  //    (a) O temsilcinin düşük realizasyonlu / RESCUE brick'lerini bul
  //        (team-ranking-engine veya OpportunityScoreEngine'den)
  //    (b) O brick'te/ürünlerde yüksek başarılı bir pattern var mı?
  //        (LearningHub.getTeamBestPractices())
  //    (c) Çakışma bulunursa kişisel coaching ipucu üret.
  // ══════════════════════════════════════════════════════════════════

  function getPersonalCoachingHints(ttt) {
    if (!ttt) return [];

    var cacheKey = 'personal_' + ttt;
    var now = Date.now();
    if (_cache[cacheKey] && (now - _cache[cacheKey].ts) < CACHE_TTL_MS) {
      return _cache[cacheKey].data;
    }

    var hints = [];

    // (a) Bu temsilcinin zayıf brick'leri
    var weakBricks = _safe(function () {
      if (window.OpportunityScoreEngine &&
          typeof window.OpportunityScoreEngine.rankBricks8 === 'function') {
        var ranked = window.OpportunityScoreEngine.rankBricks8(ttt) || [];
        // RESCUE veya düşük skoru olanlar (alt %40)
        return ranked.filter(function (b) {
          return b.classification === 'RESCUE' || b.score8 < 40;
        }).map(function (b) { return b.brick; });
      }
      return [];
    }, []);

    // (b) Tüm başarılı pattern'ları al
    var practices = _safe(function () {
      if (!window.LearningHub ||
          typeof window.LearningHub.getTeamBestPractices !== 'function') return [];
      return window.LearningHub.getTeamBestPractices(20) || [];
    }, []);

    // (c) Zayıf brick × başarılı pattern çakışması
    weakBricks.forEach(function (brick) {
      var brickPractices = practices.filter(function (p) {
        return p.brick === brick && p.successRate >= 60;
      });

      brickPractices.forEach(function (p) {
        var conf = _confidence(p.sampleSize, p.successRate);
        hints.push({
          type:               'PERSONAL_COACHING',
          targetTTT:          ttt,
          brick:              brick,
          product:            p.product || null,
          recommendationType: p.recommendationType || null,
          insight:            brick + ' bölgenizde ' +
            (p.product ? p.product + ' için ' : '') +
            (p.recommendationType || 'benzer aksiyon') +
            ' sistemde %' + p.successRate + ' başarıyla sonuçlanmış (' +
            p.sampleSize + ' örnek). Bu bölgede aynı yaklaşımı denemeniz önerilebilir.',
          successRate:        p.successRate,
          sampleSize:         p.sampleSize,
          confidence:         conf,
          source:             'TeamLearning-PersonalCoach'
        });
      });
    });

    // Eğer zayıf brick × pattern çakışması bulunamadıysa
    // genel en yüksek başarılı pattern'ı öner
    if (!hints.length && practices.length) {
      var top = practices[0];
      hints.push({
        type:               'PERSONAL_COACHING',
        targetTTT:          ttt,
        brick:              top.brick || null,
        product:            top.product || null,
        recommendationType: top.recommendationType || null,
        insight:            'Ekipte en yüksek başarı oranı: ' +
          (top.product ? top.product + ' / ' : '') +
          (top.brick ? top.brick + ' — ' : '') +
          '%' + top.successRate + ' başarı (' + top.sampleSize + ' örnek). ' +
          'Bu aksiyon tipini uygulamak değerlendirilebilir.',
        successRate:        top.successRate,
        sampleSize:         top.sampleSize,
        confidence:         _confidence(top.sampleSize, top.successRate),
        source:             'TeamLearning-PersonalCoach-Fallback'
      });
    }

    _cache[cacheKey] = { data: hints, ts: now };
    return hints;
  }

  // ══════════════════════════════════════════════════════════════════
  //  3) TAKIM ÖĞRENMESİ ÖZET — getTeamLearningContext()
  //     AIContextBuilder.context.decision.teamLearning ve
  //     ExecutiveDashboard için hazır yapısal özet.
  // ══════════════════════════════════════════════════════════════════

  function getTeamLearningContext() {
    var cacheKey = 'team_context';
    var now = Date.now();
    if (_cache[cacheKey] && (now - _cache[cacheKey].ts) < CACHE_TTL_MS) {
      return _cache[cacheKey].data;
    }

    var practices = _safe(function () {
      if (!window.LearningHub ||
          typeof window.LearningHub.getTeamBestPractices !== 'function') return [];
      return window.LearningHub.getTeamBestPractices(20) || [];
    }, []);

    // Özet metrikleri
    var totalSamples  = 0;
    var weightedRate  = 0;
    var topBricks     = {};
    var topProducts   = {};
    var topActions    = {};

    practices.forEach(function (p) {
      totalSamples += p.sampleSize;
      weightedRate += p.successRate * p.sampleSize;

      if (p.brick) {
        topBricks[p.brick] = (topBricks[p.brick] || 0) + p.sampleSize;
      }
      if (p.product) {
        topProducts[p.product] = (topProducts[p.product] || { n: 0, rate: 0 });
        topProducts[p.product].n    += p.sampleSize;
        topProducts[p.product].rate += p.successRate * p.sampleSize;
      }
      if (p.recommendationType) {
        topActions[p.recommendationType] = (topActions[p.recommendationType] || { n: 0, rate: 0 });
        topActions[p.recommendationType].n    += p.sampleSize;
        topActions[p.recommendationType].rate += p.successRate * p.sampleSize;
      }
    });

    var avgSuccessRate = totalSamples > 0
      ? Math.round((weightedRate / totalSamples) * 10) / 10
      : null;

    // En başarılı ürün (en yüksek ağırlıklı başarı oranı)
    var bestProduct = null, bestProductRate = 0;
    Object.keys(topProducts).forEach(function (prod) {
      var rate = topProducts[prod].n > 0
        ? Math.round(topProducts[prod].rate / topProducts[prod].n)
        : 0;
      if (rate > bestProductRate) { bestProductRate = rate; bestProduct = prod; }
    });

    // En çok örnekli brick
    var bestBrick = null, bestBrickN = 0;
    Object.keys(topBricks).forEach(function (brick) {
      if (topBricks[brick] > bestBrickN) { bestBrickN = topBricks[brick]; bestBrick = brick; }
    });

    // En başarılı aksiyon tipi
    var bestAction = null, bestActionRate = 0;
    Object.keys(topActions).forEach(function (act) {
      var rate = topActions[act].n > 0
        ? Math.round(topActions[act].rate / topActions[act].n)
        : 0;
      if (rate > bestActionRate) { bestActionRate = rate; bestAction = act; }
    });

    var ctx = {
      totalSamples:      totalSamples,
      avgSuccessRate:    avgSuccessRate,
      practiceCount:     practices.length,
      bestProduct:       bestProduct ? { name: bestProduct, successRate: bestProductRate } : null,
      bestBrick:         bestBrick   ? { name: bestBrick,   sampleCount: bestBrickN      } : null,
      bestActionType:    bestAction  ? { name: bestAction,  successRate: bestActionRate  } : null,
      topInsights:       _buildTeamInsights(5),        // en önemli 5 insight
      dataAvailable:     practices.length > 0,
      generatedAt:       new Date().toISOString()
    };

    _cache[cacheKey] = { data: ctx, ts: now };
    return ctx;
  }

  // ══════════════════════════════════════════════════════════════════
  //  4) getTeamLearningInsights(ttts) — ExecutiveDashboard'a hazır liste
  // ══════════════════════════════════════════════════════════════════

  function getTeamLearningInsights(ttts) {
    var teamInsights = _buildTeamInsights(8);

    // Eğer STAR/WATCHLIST kategorisindeki temsilciler biliniyorsa
    // ekip karşılaştırmalı insight üret
    var ranking = _safe(function () {
      return typeof buildTeamRanking === 'function' ? buildTeamRanking(ttts || []) : [];
    }, []);

    if (ranking.length >= 2) {
      var stars     = ranking.filter(function (r) { return r.category === 'STAR'; });
      var watchlist = ranking.filter(function (r) { return r.category === 'WATCHLIST' || r.category === 'RISK'; });

      if (stars.length && watchlist.length) {
        var ctx = getTeamLearningContext();
        if (ctx.dataAvailable && ctx.avgSuccessRate != null) {
          teamInsights.unshift({
            type:               'TEAM_SUMMARY',
            targetTTT:          null,
            brick:              null,
            product:            ctx.bestProduct ? ctx.bestProduct.name : null,
            recommendationType: ctx.bestActionType ? ctx.bestActionType.name : null,
            insight:            stars.length + ' STAR temsilci var — en başarılı aksiyon tipi: ' +
              (ctx.bestActionType ? '"' + ctx.bestActionType.name + '" (%' + ctx.bestActionType.successRate + ')' : 'belirsiz') +
              '. ' + watchlist.length + ' izleme/risk temsilcisi için bu yaklaşım koçluk önerisi olarak sunulabilir. ' +
              'Sistem geneli öneri başarı oranı: %' + ctx.avgSuccessRate + ' (' + ctx.totalSamples + ' örnek).',
            successRate:        ctx.avgSuccessRate,
            sampleSize:         ctx.totalSamples,
            confidence:         ctx.totalSamples >= 20 ? 'HIGH' : ctx.totalSamples >= 8 ? 'MEDIUM' : 'LOW',
            source:             'TeamLearning-Summary'
          });
        }
      }
    }

    return teamInsights;
  }

  // ══════════════════════════════════════════════════════════════════
  //  5) enrichExecutiveDashboard(dashboard) — mevcut executive-engine.js
  //     çıktısına teamLearning alanı EKLER (engine değiştirilmeden)
  //
  //  Kullanım (executive-engine.js çalıştıktan sonra):
  //    var dash = buildExecutiveDashboard();
  //    window.TeamLearning.enrichExecutiveDashboard(dash);
  //    // dash.teamLearning artık dolu
  // ══════════════════════════════════════════════════════════════════

  function enrichExecutiveDashboard(dashboard) {
    if (!dashboard) return dashboard;

    var ttts = _safe(function () {
      return dashboard.ranking
        ? dashboard.ranking.map(function (r) { return r.ttt; })
        : [];
    }, []);

    dashboard.teamLearning = {
      context:  getTeamLearningContext(),
      insights: getTeamLearningInsights(ttts)
    };

    return dashboard;
  }

  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.TeamLearning = {
    getTeamLearningInsights:  getTeamLearningInsights,
    getPersonalCoachingHints: getPersonalCoachingHints,
    getTeamLearningContext:   getTeamLearningContext,
    enrichExecutiveDashboard: enrichExecutiveDashboard,
    clearCache:               clearCache,
    version:                  ENGINE_VERSION
  };

  console.debug('[team-learning] FAZ 6.8 yüklendi. Versiyon:', ENGINE_VERSION);

})();
