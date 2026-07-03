// ══════════════════════════════════════════════════════════════════════
//  js/ai/decision/decision-engine.js
//  FAZ 6.7 — Decision Intelligence Engine
//
//  Sorumluluk:
//    Mevcut hiçbir motoru yeniden yazmadan, hepsini GİRDİ olarak kullanarak
//    5-adımlı bir pipeline ile "en iyi aksiyon" önerisini üretir:
//      decide(context, problemType) →
//        { recommendation, confidence, expectedTL, risk, alternatives[] }
//
//  PIPELINE:
//    1. generateAlternatives(ttt)   ← OpportunityScoreEngine.rankBricks8()
//                                      + coverage-engine (territory)
//    2. scoreSuccess(alt, ttt)      ← LearningHub.getLearningContext().successRate
//                                      + ForecastEngine'in confidence alanı
//    3. scoreRisk(alt, ttt)         ← detectRisks() + CompetitiveImpactEngine
//    4. estimateTLImpact(alt, ttt)  ← analyzeBrickImpact() / analyzeProductImpact()
//    5. selectBest(alternatives)    ← ağırlıklı skor (Master Prompt'un
//                                      brick-ranking ağırlık deseniyle tutarlı)
//
//  ÇIKTI (rapor §9 şemasıyla BİREBİR AYNI):
//    {
//      recommendation: {
//        type: 'BRICK_FOCUS'|'PRODUCT_PUSH'|'RESCUE'|'REACTIVATION'|'LAUNCH_PREP',
//        target: string,      // brick adı veya ürün adı
//        action: string,      // "Bu brick'te agresif büyüme — ..." insan-okur cümle
//        priority: 'HIGH'|'MEDIUM'|'LOW'
//      },
//      confidence: number,    // 0-100 (karar güveni — tavan: 80, §Kısıtlar)
//      expectedTL: number,    // tahmini TL etkisi (scenario-builder'dan)
//      risk: {
//        level: 'LOW'|'MEDIUM'|'HIGH',
//        topRisks: []         // detectRisks() çıktısından ilk 3
//      },
//      alternatives: [],      // [{...öneri şeması, rank: N}] — sıralı alternatifler
//      decisionBasis: {       // şeffaflık — kararın dayandığı sinyaller
//        opportunityTop: null|{brick, score8},
//        learningSignal: null|number,
//        outcomeSignal: null|number,
//        competitiveFlag: boolean,
//        temporalContext: null|{cycleWeek, remainingWeeks}
//      }
//    }
//
//  ⚠️ GÜVEN SKORU TAVANI: %80 (§Kısıtlar) — "en iyi aksiyon" kararı birden
//    fazla motoru zincirliyor, her adımda belirsizlik birikir. %80 üzeri
//    "sistem kesin" izlenimi verir ki bu güncel granülaritede doğru değil.
//
//  ⚠️ PROBLEM TİPLERİ — this version:
//    'AUTO'          → tüm sinyalleri okuyup en kritik sorunu kendisi tespit eder
//    'BRICK_FOCUS'   → hangi brick'e yoğunlaşalım?
//    'PRODUCT_PUSH'  → hangi ürünü itelim?
//    'RESCUE'        → RESCUE sınıfındaki brick'leri kurtarmak
//    'LAUNCH_PREP'   → ON_LANSMAN pazarları için (LaunchReadinessEngine ile)
//
//  Kurallar:
//    • Hiçbir downstream motor DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • recommendation-memory.js'e YAZMAk bu motorun işi DEĞİL — karar
//      sahibi (ai-orchestrator.js veya UI) bunu yapar; bu motor sadece
//      yapılandırılmış karar nesnesi üretir.
//
//  Bağımlılık (hepsi opsiyonel — typeof kontrolü):
//    OpportunityScoreEngine, LearningHub, detectRisks,
//    CompetitiveImpactEngine, analyzeBrickImpact, analyzeProductImpact,
//    TemporalContextEngine, LaunchReadinessEngine
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DECISION_ENGINE_LOADED) {
    console.warn('[decision-engine] Zaten yüklü — atlandı');
    return;
  }
  window._DECISION_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.1'; // FAZ 10.1: PHARMACY_VISIT eklendi
  var CONFIDENCE_CEILING = 80; // §Kısıtlar — asla aşılmaz

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  ADIM 1 — generateAlternatives(ttt)
  //  OpportunityScoreEngine'in 8-bileşenli sıralamasından alternatifler üretir.
  //  Her alternatif bir "aksiyon adayı" — brick bazlı fırsat veya ürün bazlı baskı.
  // ──────────────────────────────────────────────────────────────────
  function _generateAlternatives(ttt) {
    var alternatives = [];

    // 8-bileşenli brick sıralaması
    var ranked = _safe(function () {
      return window.OpportunityScoreEngine ? window.OpportunityScoreEngine.rankBricks8(ttt) : [];
    }, []);

    ranked.forEach(function (b, i) {
      var type;
      if (b.classification === 'RESCUE')      type = 'RESCUE';
      else if (b.classification === 'OPPORTUNITY') type = 'BRICK_FOCUS';
      else                                         type = 'BRICK_FOCUS';

      alternatives.push({
        type:     type,
        target:   b.brick,
        score8:   b.score8,
        score5:   b.score5,
        classification: b.classification,
        reason:   b.reason,
        detail:   b.detail,
        scores:   b.scores,
        orderCycleSignal: b.orderCycleSignal,
        _rank:    i + 1
      });
    });

    // ON_LANSMAN pazarı varsa LAUNCH_PREP alternatifi ekle
    _safe(function () {
      if (!window.LaunchReadinessEngine) return;
      var onLansman = window.LaunchReadinessEngine.listOnLansmanPazarlar();
      onLansman.forEach(function (pazar) {
        var summary = window.LaunchReadinessEngine.getLaunchReadinessSummary(pazar);
        if (summary) {
          alternatives.unshift({ // öne al — lansman kritik öncelik
            type:     'LAUNCH_PREP',
            target:   pazar,
            score8:   90, // lansman her zaman yüksek öncelik
            score5:   null,
            classification: 'ON_LANSMAN',
            reason:   summary.oneri,
            detail:   summary.rakipSayisi + ' rakip aktif, en agresif: ' +
                      (summary.enAgresifRakip ? summary.enAgresifRakip.firma : '?'),
            scores:   null,
            orderCycleSignal: null,
            _rank:    0
          });
        }
      });
    });

    return alternatives;
  }

  // ──────────────────────────────────────────────────────────────────
  //  ADIM 2 — scoreSuccess(alt, ttt)
  //  Bir alternatifin başarı olasılığını LearningHub + forecast'tan tahmin eder.
  // ──────────────────────────────────────────────────────────────────
  function _scoreSuccess(alt, ttt) {
    var base = 50; // nötr taban

    // LearningHub'dan genel sistem başarı oranı
    var learningSignal = _safe(function () {
      if (!window.LearningHub) return null;
      return window.LearningHub.getLearningContext(ttt).successRate;
    }, null);
    if (learningSignal != null) base = base * 0.4 + learningSignal * 0.6;

    // Brick'in kendi learning/outcome skorları (OpportunityScoreEngine'den)
    if (alt.scores) {
      if (alt.scores.learning) base = base * 0.7 + alt.scores.learning * 0.3;
      if (alt.scores.outcome)  base = base * 0.8 + alt.scores.outcome * 0.2;
    }

    // ON_LANSMAN durumunda başarı daha belirsiz
    if (alt.type === 'LAUNCH_PREP') base *= 0.85;

    return Math.min(CONFIDENCE_CEILING, Math.round(base));
  }

  // ──────────────────────────────────────────────────────────────────
  //  ADIM 3 — scoreRisk(alt, ttt)
  //  detectRisks() + CompetitiveImpactEngine'den risk profili çıkarır.
  // ──────────────────────────────────────────────────────────────────
  function _scoreRisk(alt, ttt) {
    var risks = _safe(function () {
      return window.detectRisks ? window.detectRisks(ttt) : [];
    }, []);

    // Bu alternatife ait brick için rakip kampanya riski var mı?
    var competitiveFlag = false;
    if (alt.target && alt.type !== 'LAUNCH_PREP') {
      _safe(function () {
        if (!window.CompetitiveImpactEngine) return;
        var allEvidence = window.CompetitiveImpactEngine.analyzeImpact(ttt, alt.target);
        competitiveFlag = allEvidence.some(function (e) { return e.zamansalCakisma && e.guvenSkoru > 20; });
      });
    }

    var highRisks = risks.filter(function (r) { return r.severity === 'HIGH'; });
    var level = highRisks.length >= 2 ? 'HIGH'
      : (highRisks.length === 1 || risks.filter(function (r) { return r.severity === 'MEDIUM'; }).length >= 2) ? 'MEDIUM'
      : 'LOW';

    if (competitiveFlag && level === 'LOW') level = 'MEDIUM';

    return {
      level: level,
      topRisks: risks.slice(0, 3),
      competitiveFlag: competitiveFlag
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  ADIM 4 — estimateTLImpact(alt, ttt)
  //  scenario-builder'dan TL potansiyeli tahmini alır.
  // ──────────────────────────────────────────────────────────────────
  function _estimateTLImpact(alt, ttt) {
    return _safe(function () {
      if (alt.type === 'BRICK_FOCUS' || alt.type === 'RESCUE') {
        if (!window.analyzeBrickImpact) return null;
        var brickResults = window.analyzeBrickImpact(ttt);
        var match = brickResults.filter(function (r) { return r.brick === alt.target; })[0];
        return match ? (match.potentialTL || match.potential_tl || null) : null;
      }
      if (alt.type === 'PRODUCT_PUSH') {
        if (!window.analyzeProductImpact) return null;
        var productResults = window.analyzeProductImpact(ttt, 10);
        var pMatch = productResults.filter(function (r) { return r.product === alt.target; })[0];
        return pMatch ? (pMatch.expectedTL || pMatch.expected_tl || null) : null;
      }
      return null;
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  ADIM 5 — selectBest(alternatives)
  //  Tüm skorları ağırlıklı birleştirerek en iyi alternatifi seçer.
  // ──────────────────────────────────────────────────────────────────
  function _selectBest(scoredAlts) {
    if (!scoredAlts.length) return null;

    var W_OPPORTUNITY = 0.45;
    var W_SUCCESS     = 0.30;
    var W_RISK        = 0.15;
    var W_TL          = 0.10;

    var maxTL = scoredAlts.reduce(function (m, a) {
      return Math.max(m, a.expectedTL || 0);
    }, 1);

    scoredAlts.forEach(function (a) {
      var riskScore = a.risk.level === 'LOW' ? 100 : a.risk.level === 'MEDIUM' ? 60 : 20;
      var tlScore   = maxTL > 0 ? Math.min(100, Math.round(((a.expectedTL || 0) / maxTL) * 100)) : 50;
      var oppScore  = a.score8 || 50;

      a._finalScore = +(
        oppScore       * W_OPPORTUNITY +
        a.successScore * W_SUCCESS     +
        riskScore      * W_RISK        +
        tlScore        * W_TL
      ).toFixed(1);
    });

    scoredAlts.sort(function (a, b) { return b._finalScore - a._finalScore; });
    return scoredAlts[0];
  }

  // ──────────────────────────────────────────────────────────────────
  //  FAZ 10.1 — PHARMACY_VISIT dal: _generatePharmacyAlternatives
  //  DigitalTwin listesinden eczane-seviyesi alternatifler üretir.
  //  Mevcut _generateAlternatives() DOKUNULMADI — sadece PHARMACY_VISIT
  //  decide() çağrısında bu fonksiyon kullanılır.
  // ──────────────────────────────────────────────────────────────────
  function _generatePharmacyAlternatives(twins) {
    if (!twins || !twins.length) return [];
    return twins.map(function (t, i) {
      // Tip: stok uyarısı → sipariş yakını → bekle
      var type;
      if (t.lastKnownStock != null && t.lastKnownStock === 0) {
        type = 'STOCK_ALERT';
      } else if (t.orderDiscipline != null && t.orderDiscipline >= 0.65 &&
                 t.estimatedOrderDate && t.estimatedOrderDate <= _dateStr30Days()) {
        type = 'VISIT_NOW';
      } else {
        type = 'WAIT';
      }
      var score8 = t.confidenceScore || 50;
      return {
        type:     type,
        target:   t.eczane || t.gln || ('Eczane-' + i),
        score8:   score8,
        score5:   null,
        classification: t.behaviorType || null,
        reason:   _pharmacyReason(t, type),
        detail:   t.behaviorType ? ('Davranış: ' + t.behaviorType) : '',
        scores:   null,
        orderCycleSignal: t.estimatedOrderDate || null,
        _rank:    i + 1,
        _twin:    t  // referans (decisionBasis için)
      };
    });
  }

  function _dateStr30Days() {
    var d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }

  function _pharmacyReason(t, type) {
    if (type === 'STOCK_ALERT') return 'Stok bitti — acil ziyaret';
    if (type === 'VISIT_NOW') {
      return 'Sipariş zamanı yaklaşıyor' +
        (t.estimatedOrderDate ? ' (' + t.estimatedOrderDate + ')' : '');
    }
    return 'Bekle — sipariş döngüsüne göre erken';
  }

  // ──────────────────────────────────────────────────────────────────
  //  ANA API — decide(ttt, problemType?, extContext?)
  //  extContext: { twins?: DigitalTwin[] }  ← FAZ 10.1 PHARMACY_VISIT için
  // ──────────────────────────────────────────────────────────────────
  function _buildActionSentence(alt, temporalCtx) {
    var base = '';
    var cyclePart = temporalCtx && temporalCtx.remainingWeeks != null
      ? ' (cycle\'da ' + (temporalCtx.cycleWeek || '?') + '. hafta, ' +
        (temporalCtx.remainingWeeks !== null ? temporalCtx.remainingWeeks + ' hafta kaldı' : 'hafta bilinmiyor') + ')'
      : '';

    switch (alt.type) {
      case 'RESCUE':       base = alt.target + ' brick\'inde acil müdahale gerekiyor — ' + (alt.reason || 'yüksek risk'); break;
      case 'BRICK_FOCUS':  base = alt.target + ' brick\'ine odaklan — ' + (alt.reason || 'fırsat tespit edildi'); break;
      case 'LAUNCH_PREP':  base = alt.target + ' lansmanına hazırlık — ' + (alt.reason || 'rakip analizi yapıldı'); break;
      case 'PRODUCT_PUSH': base = alt.target + ' ürününü öne çıkar — ' + (alt.reason || 'büyüme potansiyeli yüksek'); break;
      case 'VISIT_NOW':    base = alt.target + ' eczanesini ziyaret et — ' + (alt.reason || 'sipariş döngüsü'); break;
      case 'STOCK_ALERT':  base = alt.target + ' eczanesinde stok kritik — ' + (alt.reason || 'acil'); break;
      case 'WAIT':         base = alt.target + ' eczanesi — ' + (alt.reason || 'ziyaret için bekle'); break;
      default:             base = (alt.reason || 'Öncelikli aksiyon');
    }
    return base + cyclePart;
  }

  var _cache = {};
  var CACHE_TTL_MS = 60000;

  function decide(ttt, problemType, extContext) {
    if (!ttt) return null;

    var cacheKey = ttt + '|' + (problemType || 'AUTO');
    var now = Date.now();
    if (_cache[cacheKey] && (now - _cache[cacheKey].timestamp) < CACHE_TTL_MS) {
      return _cache[cacheKey].result;
    }

    var temporalCtx = _safe(function () {
      return window.TemporalContextEngine ? window.TemporalContextEngine.getTemporalContext() : null;
    }, null);

    // Adım 1 — alternatifler
    // FAZ 10.1: PHARMACY_VISIT → eczane-seviyesi dal (mevcut 5 tip değişmedi)
    var alternatives;
    if (problemType === 'PHARMACY_VISIT') {
      var twins = (extContext && extContext.twins) || _safe(function () {
        if (!window.PharmacyRanking || !window.DigitalTwinBuilder) return [];
        return (window.PharmacyRanking.rankPharmacies(ttt) || []).slice(0, 15).map(function (r) {
          return window.DigitalTwinBuilder.getDigitalTwin(r.eczane || r.gln, ttt);
        }).filter(Boolean);
      }, []);
      alternatives = _generatePharmacyAlternatives(twins);
    } else {
      alternatives = _generateAlternatives(ttt);

      // problemType filtresi (mevcut 5 tip)
      if (problemType && problemType !== 'AUTO') {
        var filtered = alternatives.filter(function (a) { return a.type === problemType; });
        if (filtered.length) alternatives = filtered;
      }
    }

    if (!alternatives.length) {
      return { recommendation: null, confidence: 0, expectedTL: null, risk: { level: 'LOW', topRisks: [] }, alternatives: [], decisionBasis: {} };
    }

    // Adım 2-4 — her alternatif için skor
    var scored = alternatives.map(function (alt) {
      var successScore = _scoreSuccess(alt, ttt);
      var risk         = _scoreRisk(alt, ttt);
      var expectedTL   = _estimateTLImpact(alt, ttt);
      return Object.assign({}, alt, { successScore: successScore, risk: risk, expectedTL: expectedTL });
    });

    // Adım 5 — en iyi seç
    var best = _selectBest(scored);

    // Güven skoru: başarı skoru + fırsat skoru ortalaması, tavana göre kırpılır
    var confidence = Math.min(CONFIDENCE_CEILING,
      Math.round((best.successScore * 0.6 + (best.score8 || 50) * 0.4)));

    var result = {
      recommendation: {
        type:     best.type,
        target:   best.target,
        action:   _buildActionSentence(best, temporalCtx),
        priority: best.risk.level === 'HIGH' ? 'HIGH' : best._finalScore >= 70 ? 'HIGH' : best._finalScore >= 50 ? 'MEDIUM' : 'LOW'
      },
      confidence: confidence,
      expectedTL: best.expectedTL,
      risk: best.risk,
      alternatives: scored.map(function (a, i) {
        return {
          rank: i + 1, type: a.type, target: a.target,
          score8: a.score8, successScore: a.successScore,
          finalScore: a._finalScore, reason: a.reason
        };
      }),
      decisionBasis: {
        opportunityTop: { brick: best.target, score8: best.score8 },
        learningSignal: _safe(function () {
          return window.LearningHub ? window.LearningHub.getLearningContext(ttt).successRate : null;
        }, null),
        outcomeSignal: _safe(function () {
          return window.OutcomeTracker ? window.OutcomeTracker.getCachedSummary().successRate : null;
        }, null),
        competitiveFlag: best.risk.competitiveFlag || false,
        temporalContext: temporalCtx ? {
          cycleWeek: temporalCtx.cycleWeek,
          remainingWeeks: temporalCtx.remainingWeeks,
          imsDataWeekRange: temporalCtx.imsDataWeekRange
        } : null
      }
    };

    _cache[cacheKey] = { result: result, timestamp: now };
    return result;
  }

  function clearCache() { _cache = {}; }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.DecisionEngine = {
    decide:      decide,
    clearCache:  clearCache,
    version:     ENGINE_VERSION
  };

  console.debug('[decision-engine] yüklendi. Versiyon:', ENGINE_VERSION,
    '| Güven tavanı: %' + CONFIDENCE_CEILING);

})();
