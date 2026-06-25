// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/team-learning-engine.js
//  FAZ 6.8 — Team Learning Engine
//
//  Sorumluluk:
//    "En başarılı temsilci davranışını öğren → diğerlerine öner."
//    Executive katmanının öğrenmeyi takıma yaymasını sağlar.
//
//    3 çıktı üretir:
//    1. PEER BENCHMARK     — "Ortalama temsilci X yaparken, en iyi Y yapıyor"
//    2. BEST PRACTICE PAKETİ — en iyi temsilcinin brick/ürün davranışını
//                              tekrar üretilebilir pattern'a dönüştürür
//    3. KİŞİSELLEŞTİRİLMİŞ ÖNERİ — her temsilciye "şu arkadaşından
//                              öğrenebilirsin" spesifik mesajı
//
//  KAYNAK MOTORLAR (hepsi DEĞİŞTİRİLMEDİ — sadece okunur):
//    • buildTeamRanking()       (executive/team-ranking-engine.js)
//      → kim en yüksek realizasyon/büyüme/pazar payı skorunda?
//    • PharmacyBehaviorEngine.buildBehaviorProfiles(ttt)  (FAZ 6.1)
//      → o temsilcinin brick bazlı eczane davranışı (GROWING/REGULAR/
//        AT_RISK oranları, avgOrderCycle, reorderProbability)
//    • LearningHub.getTeamBestPractices()  (FAZ 6.2)
//      → sistem genelinde en başarılı öneri pattern'ları (brick/ürün bazlı)
//    • OpportunityScoreEngine.rankBricks8(ttt)  (FAZ 6.5, opsiyonel)
//      → brick bazlı fırsat skoru karşılaştırması
//
//  STANDART TeamLearningPackage MODELİ:
//    {
//      generatedAt,
//      topPerformer: { ttt, score, realization, category },
//      peerBenchmark: [{
//        metric, topValue, avgValue, bottomValue, unit, interpretation
//      }],
//      bestPractices: [{
//        source: ttt,    // kim yapıyor
//        behavior,       // ne yapıyor (insan-okur)
//        metric,         // ölçülebilir gösterge
//        value,          // değeri
//        brick?,         // hangi brick'te (varsa)
//        product?        // hangi üründe (varsa)
//      }],
//      recommendations: {   // ttt → kişiselleştirilmiş öneri
//        [ttt]: {
//          learnFrom: string,   // kimin davranışını öğrenmeli
//          focus: string,       // neye odaklanmalı
//          gap: string,         // şu an neden geride?
//          action: string       // spesifik aksiyon cümlesi
//        }
//      }
//    }
//
//  Public API:
//    buildTeamLearningPackage()      → TeamLearningPackage (cache'li)
//    getRecommendationFor(ttt)       → tek temsilci için kişisel öneri
//    clearCache()
//
//  Kurallar:
//    • Hiçbir downstream motor DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • Yeterli veri yoksa (ranking boş, PharmacyBehaviorEngine yok vb.)
//      güvenli boş yapı döner.
//
//  Bağımlılık: buildTeamRanking (zorunlu), PharmacyBehaviorEngine (opsiyonel),
//              LearningHub (opsiyonel), OpportunityScoreEngine (opsiyonel)
//  Yükleme sırası: team-ranking-engine.js SONRASI, learning-hub.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._TEAM_LEARNING_ENGINE_LOADED) {
    console.warn('[team-learning-engine] Zaten yüklü — atlandı');
    return;
  }
  window._TEAM_LEARNING_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) PEER BENCHMARK — takım genelinde metrik karşılaştırması
  // ──────────────────────────────────────────────────────────────────
  function _buildPeerBenchmark(ranking) {
    if (!ranking || ranking.length < 2) return [];

    function _stats(arr) {
      var sorted = arr.slice().sort(function (a, b) { return a - b; });
      var avg = arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
      return {
        top:    sorted[sorted.length - 1],
        avg:    Math.round(avg * 10) / 10,
        bottom: sorted[0]
      };
    }

    var metrics = [
      {
        metric: 'Realizasyon',
        values: ranking.map(function (r) { return r.realization || 0; }),
        unit: '%',
        interpretation: function (top, avg) {
          return top > avg * 1.15
            ? 'En iyi temsilci ortalamadan belirgin yüksek — yaklaşım analiz edilmeli'
            : 'Takım performansı homojen';
        }
      },
      {
        metric: 'Büyüme Skoru',
        values: ranking.map(function (r) { return r.growthScore || 0; }),
        unit: 'puan',
        interpretation: function (top, avg) {
          return top > avg + 15
            ? 'Büyüme stratejisinde belirgin fark var — en iyi temsilcinin brick seçimi incelenmeli'
            : 'Büyüme stratejisi takım genelinde benzer';
        }
      },
      {
        metric: 'Pazar Payı Skoru',
        values: ranking.map(function (r) { return r.marketShareScore || 0; }),
        unit: 'puan',
        interpretation: function (top, avg) {
          return top > avg + 10
            ? 'Pazar payı yönetiminde lider var — rakip takibi farklılığı olabilir'
            : 'Pazar payı yönetimi takım genelinde dengeli';
        }
      }
    ];

    return metrics.map(function (m) {
      var s = _stats(m.values);
      return {
        metric: m.metric,
        topValue: s.top,
        avgValue: s.avg,
        bottomValue: s.bottom,
        unit: m.unit,
        gap: +(s.top - s.avg).toFixed(1),
        interpretation: m.interpretation(s.top, s.avg)
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) BEST PRACTICE PAKETİ — en iyi temsilcinin davranışından çıkarılır
  // ──────────────────────────────────────────────────────────────────
  function _buildBestPractices(topPerformer, ranking) {
    var practices = [];
    var ttt = topPerformer.ttt;

    // PharmacyBehaviorEngine'den brick bazlı davranış analizi
    _safe(function () {
      if (!window.PharmacyBehaviorEngine) return;
      var profiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(ttt);
      if (!profiles.length) return;

      // GROWING eczane oranı
      var growing = profiles.filter(function (p) { return p.classification === 'GROWING'; });
      var growingPct = Math.round((growing.length / profiles.length) * 100);
      if (growingPct > 30) {
        practices.push({
          source: ttt,
          behavior: 'Eczane portföyünün %' + growingPct + '\'i büyüme trendinde — düzenli ve proaktif ziyaret',
          metric: 'GROWING eczane oranı',
          value: growingPct + '%'
        });
      }

      // Ortalama sipariş döngüsü
      var cycles = profiles.map(function (p) { return p.avgOrderCycle || 0; }).filter(function (v) { return v > 0; });
      if (cycles.length) {
        var avgCycle = Math.round(cycles.reduce(function (s, v) { return s + v; }, 0) / cycles.length);
        practices.push({
          source: ttt,
          behavior: 'Ortalama sipariş döngüsü ' + avgCycle + ' gün — zamanında takip sistemi',
          metric: 'Ort. sipariş döngüsü',
          value: avgCycle + ' gün'
        });
      }

      // AT_RISK eczane oranı (düşük olması iyi)
      var atRisk = profiles.filter(function (p) { return p.classification === 'AT_RISK'; });
      var atRiskPct = Math.round((atRisk.length / profiles.length) * 100);
      if (atRiskPct < 15) {
        practices.push({
          source: ttt,
          behavior: 'AT_RISK eczane oranı düşük (%' + atRiskPct + ') — erken müdahale kültürü',
          metric: 'AT_RISK eczane oranı',
          value: atRiskPct + '%'
        });
      }
    });

    // LearningHub'dan genel sistem best practice'leri (brick/ürün bazlı)
    _safe(function () {
      if (!window.LearningHub) return;
      var teamPractices = window.LearningHub.getTeamBestPractices(3);
      teamPractices.forEach(function (p) {
        practices.push({
          source: 'Takım Öğrenmesi',
          behavior: p.practiceNote,
          metric: 'Geçmiş başarı oranı',
          value: '%' + p.successRate + ' (' + p.sampleSize + ' örnek)',
          brick: p.brick,
          product: p.product
        });
      });
    });

    // OpportunityScoreEngine'den en yüksek brick fırsatı
    _safe(function () {
      if (!window.OpportunityScoreEngine) return;
      var ranked = window.OpportunityScoreEngine.rankBricks8(ttt);
      if (ranked.length) {
        var topBrick = ranked[0];
        practices.push({
          source: ttt,
          behavior: topBrick.brick + ' brick\'inde en yüksek fırsat skoru (' + topBrick.score8 + ') — ' + (topBrick.reason || 'bölge seçimi'),
          metric: '8-bileşen fırsat skoru',
          value: topBrick.score8 + ' puan',
          brick: topBrick.brick
        });
      }
    });

    return practices;
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) KİŞİSELLEŞTİRİLMİŞ ÖNERİLER — her temsilciye özel
  // ──────────────────────────────────────────────────────────────────
  function _buildRecommendations(ranking, topPerformer, peerBenchmark) {
    var recommendations = {};
    var topTtt = topPerformer.ttt;

    ranking.forEach(function (rep) {
      if (rep.ttt === topTtt) {
        // En iyi temsilciye de bir öneri: liderliği koru
        recommendations[rep.ttt] = {
          learnFrom: null,
          focus: 'Liderliği koru',
          gap: 'Takım liderisin, performansın model alınıyor',
          action: 'Mevcut davranışını belgele — takım çalışmalarında mentor rol üstlen'
        };
        return;
      }

      var realizGap = Math.round((topPerformer.realization || 0) - (rep.realization || 0));
      var growthGap = Math.round((topPerformer.growthScore || 0) - (rep.growthScore || 0));

      var focus, gap, action;

      if (realizGap > 15) {
        focus  = 'Realizasyon kapama';
        gap    = 'Realizasyon açığın %' + realizGap + ' — ' + topTtt + '\'den %' + Math.round(topPerformer.realization) + ' realizasyon';
        action = 'RESCUE sınıfındaki brick\'lere bu hafta öncelik ver — küçük ivmeler realizasyonu hızlı kapatır';
      } else if (growthGap > 12) {
        focus  = 'Büyüme stratejisi';
        gap    = 'Büyüme skoru ' + growthGap + ' puan geride — ' + topTtt + '\'nın brick seçim yaklaşımı farklı';
        action = 'OPPORTUNITY sınıfındaki brick\'lerde ziyaret sıklığını artır, CAMPAIGN_BUYER eczanelere ek temas planla';
      } else if ((rep.marketShareScore || 0) < (topPerformer.marketShareScore || 0) - 10) {
        focus  = 'Pazar payı yönetimi';
        gap    = 'Pazar payı skoru geride — rakip takibi güçlendirilmeli';
        action = 'Pazar payı düşen brick\'leri CompetitiveImpactEngine ile incele, rakip kampanya dönemlerinde karşı önlem al';
      } else {
        focus  = 'Dengeli performans iyileştirme';
        gap    = 'Genel performans iyi, ince ayar fırsatları mevcut';
        action = 'Sipariş döngüsü yaklaşan eczanelere odaklan — ' + topTtt + '\'nın proaktif takip modelini benimse';
      }

      recommendations[rep.ttt] = {
        learnFrom: topTtt,
        focus: focus,
        gap: gap,
        action: action
      };
    });

    return recommendations;
  }

  // ──────────────────────────────────────────────────────────────────
  //  ANA API — buildTeamLearningPackage()
  // ──────────────────────────────────────────────────────────────────
  var _cache = null;
  var CACHE_TTL_MS = 120000; // 2 dakika (takım verisi yavaş değişir)

  function buildTeamLearningPackage() {
    var now = Date.now();
    if (_cache && (now - _cache.timestamp) < CACHE_TTL_MS) return _cache.result;

    if (!window.buildTeamRanking) {
      console.warn('[team-learning-engine] buildTeamRanking yüklü değil — boş dönüyor');
      return { generatedAt: new Date().toISOString(), topPerformer: null, peerBenchmark: [], bestPractices: [], recommendations: {} };
    }

    var ranking = _safe(function () {
      return window.buildTeamRanking(
        typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []
      );
    }, []);

    if (!ranking.length) {
      return { generatedAt: new Date().toISOString(), topPerformer: null, peerBenchmark: [], bestPractices: [], recommendations: {} };
    }

    var topPerformer = ranking[0]; // buildTeamRanking zaten score'a göre sıralıyor
    var peerBenchmark = _buildPeerBenchmark(ranking);
    var bestPractices = _buildBestPractices(topPerformer, ranking);
    var recommendations = _buildRecommendations(ranking, topPerformer, peerBenchmark);

    var result = {
      generatedAt: new Date().toISOString(),
      topPerformer: {
        ttt: topPerformer.ttt,
        score: topPerformer.score,
        realization: topPerformer.realization,
        category: topPerformer.category
      },
      peerBenchmark: peerBenchmark,
      bestPractices: bestPractices,
      recommendations: recommendations
    };

    _cache = { result: result, timestamp: now };
    return result;
  }

  function getRecommendationFor(ttt) {
    if (!ttt) return null;
    var pkg = buildTeamLearningPackage();
    return pkg.recommendations[ttt] || null;
  }

  function clearCache() { _cache = null; }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.TeamLearningEngine = {
    buildTeamLearningPackage: buildTeamLearningPackage,
    getRecommendationFor:     getRecommendationFor,
    clearCache:               clearCache,
    version:                  ENGINE_VERSION
  };

  console.debug('[team-learning-engine] yüklendi. Versiyon:', ENGINE_VERSION);

})();
