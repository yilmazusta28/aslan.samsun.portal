// ══════════════════════════════════════════════════════════════════════
//  js/ai/decision/decision-engine.js
//  FAZ 6.7 — Decision Engine
//
//  Sorumluluk:
//    Sistem artık sadece ANALİZ değil, KARAR üretir.
//    Alternatif aksiyon seçenekleri oluşturur, her birini başarı
//    olasılığı / risk / beklenen TL etkisi üzerinden puanlar ve
//    en uygun alternatifi seçer.
//
//  Roadmap §9 tasarımı (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md):
//    DecisionEngine.decide(context, problemType)
//      1. generateAlternatives()   ← opportunity-score-engine + territory-engine + route-optimizer
//      2. scoreSuccess(alt)        ← learning-hub successRate + forecast confidence
//      3. scoreRisk(alt)           ← risk-engine + competitive-impact-engine
//      4. estimateTLImpact(alt)    ← scenario-builder.analyzeBrickImpact / analyzeProductImpact
//      5. selectBest(alternatives) ← ağırlıklı skor
//      → { recommendation, confidence, expectedTL, risk, alternatives[] }
//
//  Bu nesne recommendation-memory.js'e kaydedilir (mevcut akış DEĞİŞMEZ).
//  Decision Engine sadece "öneriyi nasıl ürettiğini" zenginleştirir.
//
//  PROBLEM TİPLERİ:
//    'BRICK_PRIORITY'  — Hangi brick'e öncelik verilmeli? (en yaygın)
//    'PRODUCT_FOCUS'   — Hangi ürüne odaklanılmalı?
//    'DEFENSE'         — Rakip saldırısına karşı ne yapılmalı?
//    'RECOVERY'        — Düşen bölgede nasıl toparlanılır?
//    'GROWTH'          — Büyüme fırsatı nerede?
//
//  STANDART DecisionRecord MODELİ:
//    {
//      problemType: string,
//      ttt: string,
//      generatedAt: string,
//      recommendation: {        // seçilen EN İYİ alternatif
//        alternativeId: string,
//        title: string,
//        detail: string,
//        rationale: string,     // neden seçildi (insan-okur)
//        urgency: 'BUGÜN'|'BU HAFTA'|'BU DÖNEM'
//      },
//      confidence: number,      // 0-100, sistemin bu karara olan güveni
//      expectedTL: number|null, // tahmini TL etkisi (null = hesaplanamadı)
//      risk: {
//        level: 'LOW'|'MEDIUM'|'HIGH',
//        topRisk: string|null
//      },
//      alternatives: DecisionAlternative[]  // TÜM değerlendirilen seçenekler
//    }
//
//  STANDART DecisionAlternative MODELİ:
//    {
//      alternativeId: string,
//      title: string,
//      detail: string,
//      scores: {
//        success: number,       // 0-100 başarı olasılığı
//        risk: number,          // 0-100 risk (düşük = iyi)
//        tlImpact: number       // 0-100 TL etki büyüklüğü
//      },
//      finalScore: number,      // 0-100 ağırlıklı final skor
//      expectedTL: number|null,
//      source: string           // hangi motordan geldi
//    }
//
//  Public API:
//    decide(context, problemType)  → DecisionRecord
//    decideBatch(context)          → { [problemType]: DecisionRecord }
//                                    (tüm problem tiplerini tek geçişte çözer)
//    getDecisionContext(context)   → AIContextBuilder.context.decision alanı için özet
//    clearCache()
//
//  Kurallar:
//    • Hiçbir mevcut motor değiştirilmedi — sadece okunur.
//    • DOM erişimi YOK.
//    • Bir motor eksikse sessizce atlanır, boş/nötr değer kullanılır.
//    • Her karar güven skoru ve "neden" açıklamasıyla birlikte gelir.
//    • Kesin neden-sonuç iddiası yapılmaz; olasılıksal dil kullanılır.
//
//  Bağımlılık:
//    js/ai/decision/opportunity-score-engine.js     (FAZ 6.5, opsiyonel)
//    js/ai/decision/competitive-impact-engine.js    (FAZ 6.6, opsiyonel)
//    js/ai/core/learning-hub.js                     (FAZ 6.2, opsiyonel)
//    js/ai/intelligence/risk-engine.js              (mevcut, opsiyonel)
//    js/ai/simulator/action-planner.js              (mevcut, opsiyonel)
//    js/ai/simulator/scenario-builder.js            (mevcut, opsiyonel)
//    js/ai/predictive/forecast-engine.js            (mevcut, opsiyonel)
//  Yükleme sırası: opportunity-score-engine.js ve competitive-impact-engine.js
//                  SONRASI; rca-engine.js (FAZ 6.8 — henüz yok) ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DECISION_ENGINE_LOADED) {
    console.warn('[decision-engine] Zaten yüklü — atlandı');
    return;
  }
  window._DECISION_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';

  // ── Ağırlıklar — final skor hesabı ──────────────────────────────
  // Başarı olasılığı en önemli, TL etkisi ikinci, risk (ters) üçüncü.
  var SCORE_WEIGHTS = {
    success:  0.45,
    tlImpact: 0.35,
    riskPenalty: 0.20   // risk yükseldikçe skor DÜŞER (ters etki)
  };

  // Aciliyet eşikleri (kalan iş günü)
  var URGENCY_TODAY    = 3;
  var URGENCY_WEEK     = 10;

  // ── Yardımcılar ─────────────────────────────────────────────────
  function _safe(fn, fallback) {
    try {
      var v = fn();
      return (v === undefined || v === null) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function _uid(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  }

  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function _urgency(remainingDays) {
    if (remainingDays <= URGENCY_TODAY) return 'BUGÜN';
    if (remainingDays <= URGENCY_WEEK)  return 'BU HAFTA';
    return 'BU DÖNEM';
  }

  // ── 1) Kalan iş günü ─────────────────────────────────────────────
  function _getRemainingDays() {
    return _safe(function () {
      if (typeof calculateRunRate === 'function') {
        return (calculateRunRate(null) || {}).remainingDays || 30;
      }
      return 30;
    }, 30);
  }

  // ── 2) Forecast confidence — ForecastEngine'den ──────────────────
  function _getForecastConfidence(ttt) {
    return _safe(function () {
      if (typeof buildForecast !== 'function') return 50;
      var f = buildForecast(ttt);
      // ForecastEngine confidence alanı: genelde 'confidence' veya
      // güven belirtmediğinde runrate'den türetilir.
      if (f && typeof f.confidence === 'number') return _clamp(f.confidence, 0, 100);
      // Güven alanı yoksa: realizasyon oranını proxy kullan
      if (f && f.realizationPct != null) {
        return _clamp(f.realizationPct, 0, 100);
      }
      return 50;
    }, 50);
  }

  // ── 3) Learning success rate ─────────────────────────────────────
  function _getLearningSuccessRate(ttt) {
    return _safe(function () {
      if (window.LearningHub &&
          typeof window.LearningHub.getLearningContext === 'function') {
        var lc = window.LearningHub.getLearningContext(ttt);
        if (lc && lc.successRate != null) return _clamp(lc.successRate, 0, 100);
      }
      if (window.OutcomeTracker &&
          typeof window.OutcomeTracker.getCachedSummary === 'function') {
        var s = window.OutcomeTracker.getCachedSummary();
        if (s && s.successRate != null) return _clamp(s.successRate, 0, 100);
      }
      return 50; // veri yoksa nötr
    }, 50);
  }

  // ── 4) Risk skoru — RiskEngine'den ──────────────────────────────
  function _getRiskScoreForBrick(ttt, brick) {
    return _safe(function () {
      if (typeof detectRisks !== 'function') return 50;
      var risks = detectRisks(ttt) || [];
      if (!risks.length) return 20; // risk yok = düşük risk
      // İlgili brick'e ait riskleri filtrele; yoksa genel risk ortalaması
      var related = risks.filter(function (r) {
        return !brick || (r.brick && r.brick === brick) ||
               (r.detail && r.detail.indexOf(brick) !== -1);
      });
      var pool = related.length ? related : risks;
      // Severity: HIGH=80, MEDIUM=50, LOW=25 (risk skoru DÜŞÜK = iyi)
      var total = pool.reduce(function (sum, r) {
        var s = r.severity === 'HIGH' ? 80 : r.severity === 'MEDIUM' ? 50 : 25;
        return sum + s;
      }, 0);
      return _clamp(Math.round(total / pool.length), 0, 100);
    }, 50);
  }

  // ── 5) Competitive risk signal ───────────────────────────────────
  function _getCompetitiveRiskForGroup(ttt, ilacGrubu) {
    return _safe(function () {
      if (!window.CompetitiveImpactEngine ||
          typeof window.CompetitiveImpactEngine.getEvidenceForRCA !== 'function') return 0;
      var ev = window.CompetitiveImpactEngine.getEvidenceForRCA(ttt, ilacGrubu, null);
      // zamansalCakisma varsa ve guvenSkoru yüksekse ek risk
      if (ev && ev.zamansalCakisma) return Math.round(ev.guvenSkoru * 0.5);
      return 0;
    }, 0);
  }

  // ── 6) TL etkisi tahmini — ScenarioBuilder / ActionPlanner'dan ────
  function _estimateTLForBrick(ttt, brick) {
    return _safe(function () {
      if (typeof analyzeBrickImpact !== 'function') return null;
      var impact = analyzeBrickImpact(ttt, brick);
      if (impact && impact.potentialTL != null) return impact.potentialTL;
      if (impact && impact.expectedTL   != null) return impact.expectedTL;
      return null;
    }, null);
  }

  function _estimateTLForProduct(ttt, product) {
    return _safe(function () {
      if (typeof analyzeProductImpact !== 'function') return null;
      var impact = analyzeProductImpact(ttt, product);
      if (impact && impact.potentialTL != null) return impact.potentialTL;
      return null;
    }, null);
  }

  // ── 7) Final skor hesabı ──────────────────────────────────────────
  // risk skoru TERS etki: yüksek risk → skoru düşürür.
  function _finalScore(successScore, riskScore, tlImpactScore) {
    var s = successScore  * SCORE_WEIGHTS.success
          + tlImpactScore * SCORE_WEIGHTS.tlImpact
          - riskScore     * SCORE_WEIGHTS.riskPenalty;
    return _clamp(Math.round(s), 0, 100);
  }

  // ── 8) TL normalizer — en yüksek TL = 100 puan (rölatif skor) ────
  function _normalizeTLImpact(alts) {
    var maxTL = 0;
    alts.forEach(function (a) {
      if (a.expectedTL != null && a.expectedTL > maxTL) maxTL = a.expectedTL;
    });
    if (maxTL === 0) return; // normalizasyon gerek yok
    alts.forEach(function (a) {
      a.scores.tlImpact = a.expectedTL != null
        ? _clamp(Math.round((a.expectedTL / maxTL) * 100), 0, 100)
        : 50; // bilinmiyor = nötr
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  ALTERNATİF ÜRETİCİLER — problem tipine göre
  // ══════════════════════════════════════════════════════════════════

  // ── BRICK_PRIORITY — En yüksek fırsat skorlu brick'leri alternatif olarak sun
  function _generateBrickAlternatives(context) {
    var ttt = context.ttt;
    var alts = [];

    // OpportunityScoreEngine (FAZ 6.5) varsa 8-bileşenli sıralı listeyi kullan
    var ranked = _safe(function () {
      if (window.OpportunityScoreEngine &&
          typeof window.OpportunityScoreEngine.rankBricks8 === 'function') {
        return window.OpportunityScoreEngine.rankBricks8(ttt) || [];
      }
      if (typeof window.rankBricks === 'function') {
        return window.rankBricks(ttt) || [];
      }
      return [];
    }, []);

    // Sadece ilk 5 brick'i değerlendir (makul süre için)
    var topBricks = ranked.slice(0, 5);

    topBricks.forEach(function (b) {
      var brick = b.brick;
      if (!brick) return;

      var riskScore = _getRiskScoreForBrick(ttt, brick);
      // Rekabetçi risk: brick'in ilaç grubunu bul (opportunity score'un ilacGrubu alanından)
      var ilacGrubu = b.ilacGrubu || null;
      if (ilacGrubu) {
        var compRisk = _getCompetitiveRiskForGroup(ttt, ilacGrubu);
        riskScore = _clamp(riskScore + compRisk, 0, 100);
      }

      var expectedTL = _estimateTLForBrick(ttt, brick);
      var score8 = b.score8 || b.score || 50;
      var successScore = _clamp(Math.round(score8), 0, 100);

      alts.push({
        alternativeId: _uid('BRICK_' + brick.replace(/\s+/g, '_')),
        title: brick + ' brick\'ine öncelik ver',
        detail: (b.reason || '') + (b.detail ? ' — ' + b.detail : ''),
        scores: {
          success:  successScore,
          risk:     riskScore,
          tlImpact: 50  // normalizasyon sonrası dolar
        },
        finalScore: 0,   // _normalizeTLImpact + _finalScore sonrası dolar
        expectedTL: expectedTL,
        source: window.OpportunityScoreEngine ? 'OpportunityScoreEngine-8' : 'brick-ranking-engine'
      });
    });

    return alts;
  }

  // ── PRODUCT_FOCUS — ActionPlanner'ın ürün etkisi çıktısını al
  function _generateProductAlternatives(context) {
    var ttt = context.ttt;
    var alts = [];

    var productImpacts = _safe(function () {
      if (typeof analyzeProductImpact !== 'function') return [];
      // analyzeProductImpact(ttt) tüm ürünleri döndürüyorsa dizide ver
      var r = analyzeProductImpact(ttt);
      return Array.isArray(r) ? r : (r && r.products ? r.products : []);
    }, []);

    // İlk 5 ürünü değerlendir
    productImpacts.slice(0, 5).forEach(function (pi) {
      var urun = pi.urun || pi.product || pi.name;
      if (!urun) return;

      var riskScore = _getRiskScoreForBrick(ttt, null); // ürün bazlı risk = genel
      var expectedTL = pi.potentialTL || pi.expectedTL || null;
      var successScore = _clamp(Math.round((pi.gapScore || pi.realizationGap || 50)), 0, 100);

      alts.push({
        alternativeId: _uid('PROD_' + urun.replace(/\s+/g, '_')),
        title: urun + ' ürününe odaklan',
        detail: pi.detail || pi.reason || ('Gerçekleşme açığı: ' + (pi.realizationGap || '?') + '%'),
        scores: {
          success:  successScore,
          risk:     riskScore,
          tlImpact: 50
        },
        finalScore: 0,
        expectedTL: expectedTL,
        source: 'analyzeProductImpact'
      });
    });

    return alts;
  }

  // ── DEFENSE — Rakip saldırısı tespit edilmiş brick'leri için savunma alternatifleri
  function _generateDefenseAlternatives(context) {
    var ttt = context.ttt;
    var alts = [];

    if (!window.CompetitiveImpactEngine) return alts;

    var impacts = _safe(function () {
      return window.CompetitiveImpactEngine.analyzeImpact(ttt, null) || [];
    }, []);

    // Sadece zamansalCakisma = true olanları al (gerçek saldırı sinyali)
    impacts
      .filter(function (ev) { return ev.zamansalCakisma && ev.guvenSkoru >= 20; })
      .slice(0, 3)
      .forEach(function (ev) {
        var riskScore = _clamp(100 - ev.guvenSkoru, 35, 80); // kampanya riski
        alts.push({
          alternativeId: _uid('DEF_' + (ev.brick || '').replace(/\s+/g, '_')),
          title: ev.brick + ' bölgesinde savunma aksiyonu',
          detail: 'Rakip kampanyası tespit edildi (' +
            (ev.kampanyaDetay ? ev.kampanyaDetay.firma + ' %' + ev.kampanyaDetay.indirimPct + ' indirim' : 'bilinmiyor') +
            '). Pay düşüşü durdurulabilir.',
          scores: {
            success:  _clamp(100 - riskScore, 30, 75), // savunma başarı tahmini ölçülü
            risk:     riskScore,
            tlImpact: 50
          },
          finalScore: 0,
          expectedTL: _estimateTLForBrick(ttt, ev.brick),
          source: 'CompetitiveImpactEngine'
        });
      });

    return alts;
  }

  // ── RECOVERY — Düşen realizasyonlu brick'ler
  function _generateRecoveryAlternatives(context) {
    var ttt = context.ttt;
    var alts = [];

    var ranked = _safe(function () {
      if (window.OpportunityScoreEngine &&
          typeof window.OpportunityScoreEngine.rankBricks8 === 'function') {
        return window.OpportunityScoreEngine.rankBricks8(ttt) || [];
      }
      return [];
    }, []);

    // RESCUE sınıfındaki brick'ler = toparlanma gereken yerler
    ranked
      .filter(function (b) { return b.classification === 'RESCUE'; })
      .slice(0, 3)
      .forEach(function (b) {
        var riskScore = _clamp(_getRiskScoreForBrick(ttt, b.brick) + 15, 0, 100); // recovery daha riskli
        alts.push({
          alternativeId: _uid('REC_' + (b.brick || '').replace(/\s+/g, '_')),
          title: b.brick + ' bölgesinde toparlanma planı',
          detail: b.reason || 'Gerçekleşme kritik düzeyde düşük — acil ziyaret gerekli.',
          scores: {
            success:  _clamp(Math.round(b.score8 || b.score || 30), 0, 100),
            risk:     riskScore,
            tlImpact: 50
          },
          finalScore: 0,
          expectedTL: _estimateTLForBrick(ttt, b.brick),
          source: 'OpportunityScoreEngine-RESCUE'
        });
      });

    return alts;
  }

  // ── GROWTH — Büyüme fırsatı: yüksek potansiyel, düşük risk
  function _generateGrowthAlternatives(context) {
    var ttt = context.ttt;
    var alts = [];

    var ranked = _safe(function () {
      if (window.OpportunityScoreEngine &&
          typeof window.OpportunityScoreEngine.rankBricks8 === 'function') {
        return window.OpportunityScoreEngine.rankBricks8(ttt) || [];
      }
      return [];
    }, []);

    // OPPORTUNITY sınıfındaki, risk skoru düşük olanlar
    ranked
      .filter(function (b) { return b.classification === 'OPPORTUNITY'; })
      .slice(0, 4)
      .forEach(function (b) {
        var riskScore = _getRiskScoreForBrick(ttt, b.brick);
        alts.push({
          alternativeId: _uid('GRW_' + (b.brick || '').replace(/\s+/g, '_')),
          title: b.brick + ' büyüme fırsatı',
          detail: b.detail || b.reason || 'Pazar büyüme potansiyeli yüksek.',
          scores: {
            success:  _clamp(Math.round(b.score8 || b.score || 50), 0, 100),
            risk:     riskScore,
            tlImpact: 50
          },
          finalScore: 0,
          expectedTL: _estimateTLForBrick(ttt, b.brick),
          source: 'OpportunityScoreEngine-OPPORTUNITY'
        });
      });

    return alts;
  }

  // ── Alternatif üretici yönlendirici ─────────────────────────────
  var _ALT_GENERATORS = {
    'BRICK_PRIORITY': _generateBrickAlternatives,
    'PRODUCT_FOCUS':  _generateProductAlternatives,
    'DEFENSE':        _generateDefenseAlternatives,
    'RECOVERY':       _generateRecoveryAlternatives,
    'GROWTH':         _generateGrowthAlternatives
  };

  // ══════════════════════════════════════════════════════════════════
  //  KARAR MANT IĞI
  // ══════════════════════════════════════════════════════════════════

  function _scoreAndRank(alts, successBaseScore, riskAdjustment) {
    // TL etki skorunu normalize et (en yüksek TL = 100 puan)
    _normalizeTLImpact(alts);

    // Her alternatifin final skorunu hesapla
    alts.forEach(function (a) {
      // Başarı skoru: base (learning/forecast) + alternatifin kendi başarı skoru
      var blendedSuccess = _clamp(
        Math.round((a.scores.success * 0.6) + (successBaseScore * 0.4)),
        0, 100
      );
      // Risk skoru: alternatifin riski + genel dönemsel risk ayarı
      var blendedRisk = _clamp(a.scores.risk + riskAdjustment, 0, 100);

      a.scores.success  = blendedSuccess;
      a.scores.risk     = blendedRisk;
      a.finalScore = _finalScore(blendedSuccess, blendedRisk, a.scores.tlImpact);
    });

    // Final skora göre sırala (yüksek → düşük)
    alts.sort(function (a, b) { return b.finalScore - a.finalScore; });
    return alts;
  }

  function _buildRecommendation(best, remainingDays) {
    if (!best) return null;
    return {
      alternativeId: best.alternativeId,
      title:         best.title,
      detail:        best.detail,
      rationale:     'Başarı olasılığı: %' + best.scores.success +
        ' | Risk seviyesi: ' + (best.scores.risk >= 65 ? 'Yüksek' : best.scores.risk >= 35 ? 'Orta' : 'Düşük') +
        ' | TL etkisi: ' + (best.expectedTL != null ? '₺' + best.expectedTL.toLocaleString('tr-TR') : 'hesaplanamadı') +
        ' | Kaynak: ' + best.source,
      urgency: _urgency(remainingDays)
    };
  }

  function _buildRisk(alts) {
    if (!alts.length) return { level: 'LOW', topRisk: null };
    var avgRisk = alts.reduce(function (s, a) { return s + a.scores.risk; }, 0) / alts.length;
    var level = avgRisk >= 65 ? 'HIGH' : avgRisk >= 40 ? 'MEDIUM' : 'LOW';
    // En yüksek riskli alternatifin başlığı ipucu olarak
    var topRiskAlt = alts.slice().sort(function (a, b) { return b.scores.risk - a.scores.risk; })[0];
    return {
      level: level,
      topRisk: topRiskAlt ? topRiskAlt.title + ' (%' + topRiskAlt.scores.risk + ' risk)' : null
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  ANA KARAR FONKSİYONU
  // ══════════════════════════════════════════════════════════════════

  var _cache = {};  // ttt+problemType → { record, timestamp }
  var CACHE_TTL_MS = 60000;

  /**
   * decide(context, problemType) → DecisionRecord
   *
   * @param {Object} context  — AIContextBuilder.buildContext() çıktısı
   *                            (en az { ttt } yeterlidir)
   * @param {string} problemType — 'BRICK_PRIORITY'|'PRODUCT_FOCUS'|
   *                               'DEFENSE'|'RECOVERY'|'GROWTH'
   */
  function decide(context, problemType) {
    context     = context     || {};
    problemType = problemType || 'BRICK_PRIORITY';
    var ttt = context.ttt;

    if (!ttt) {
      return _emptyDecision(problemType, 'TTT belirtilmedi');
    }

    var cacheKey = ttt + '|' + problemType;
    var now = Date.now();
    var cached = _cache[cacheKey];
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return cached.record;
    }

    // ── Sistem-geneli sinyal toplama ────────────────────────────
    var remainingDays    = _getRemainingDays();
    var forecastConf     = _getForecastConfidence(ttt);
    var learningSuccess  = _getLearningSuccessRate(ttt);
    // Sistem güven bazı: forecast + learning ortalaması
    var successBase = Math.round((forecastConf * 0.5) + (learningSuccess * 0.5));
    // Dönem sonuna yaklaşıldıkça risk artar (zaman baskısı)
    var timeRiskAdj = remainingDays <= URGENCY_TODAY ? 15 :
                      remainingDays <= URGENCY_WEEK  ? 8  : 0;

    // ── Alternatif üretimi ───────────────────────────────────────
    var generator = _ALT_GENERATORS[problemType] || _ALT_GENERATORS['BRICK_PRIORITY'];
    var alts = _safe(function () { return generator(context) || []; }, []);

    if (!alts.length) {
      var emptyRec = _emptyDecision(problemType, 'Bu problem tipi için alternatif üretilemedi');
      _cache[cacheKey] = { record: emptyRec, timestamp: now };
      return emptyRec;
    }

    // ── Skorlama ve sıralama ────────────────────────────────────
    alts = _scoreAndRank(alts, successBase, timeRiskAdj);

    var best = alts[0];

    // ── Sistem güveni: en iyi alternatifin skoru + veri kalitesi
    //    (veri eksikse confidence düşer — null sinyaller ceza alır)
    var dataCompleteness = 100;
    if (best.expectedTL == null)          dataCompleteness -= 15;
    if (learningSuccess === 50)           dataCompleteness -= 10; // nötr = veri yok
    if (forecastConf    === 50)           dataCompleteness -= 10;
    var confidence = _clamp(
      Math.round(best.finalScore * 0.6 + dataCompleteness * 0.4),
      0, 95 // %95 tavan — sistem hiçbir zaman tam kesinlik iddia etmez
    );

    var record = {
      problemType:    problemType,
      ttt:            ttt,
      generatedAt:    new Date().toISOString(),
      recommendation: _buildRecommendation(best, remainingDays),
      confidence:     confidence,
      expectedTL:     best.expectedTL,
      risk:           _buildRisk(alts),
      alternatives:   alts
    };

    _cache[cacheKey] = { record: record, timestamp: now };
    return record;
  }

  // ── decideBatch — tüm problem tiplerini tek geçişte çözer ────────
  var ALL_PROBLEM_TYPES = ['BRICK_PRIORITY', 'PRODUCT_FOCUS', 'DEFENSE', 'RECOVERY', 'GROWTH'];

  function decideBatch(context) {
    var results = {};
    ALL_PROBLEM_TYPES.forEach(function (pt) {
      results[pt] = decide(context, pt);
    });
    return results;
  }

  // ── getDecisionContext — AIContextBuilder.context.decision alanı ──
  // FAZ 6.3'te bu alan null bırakılmıştı; bu motor artık onu doldurur.
  // AIContextBuilder tarafından çağrılmak üzere tasarlandı.
  function getDecisionContext(context) {
    var ttt = (context && context.ttt) || null;
    if (!ttt) return null;

    // En önemli 2 karar tipini çalıştır (tüm batch çok ağır olabilir)
    var primary  = decide(context, 'BRICK_PRIORITY');
    var defense  = decide(context, 'DEFENSE');

    return {
      primaryDecision: {
        title:       primary.recommendation ? primary.recommendation.title : null,
        confidence:  primary.confidence,
        expectedTL:  primary.expectedTL,
        risk:        primary.risk,
        urgency:     primary.recommendation ? primary.recommendation.urgency : null
      },
      defenseAlert: defense.alternatives && defense.alternatives.length > 0 ? {
        count:    defense.alternatives.filter(function (a) { return a.scores.risk >= 50; }).length,
        topThreat: defense.recommendation ? defense.recommendation.title : null
      } : null,
      availableDecisions: ALL_PROBLEM_TYPES,
      generatedAt: new Date().toISOString()
    };
  }

  // ── Boş karar kaydı (hata/eksik veri durumları için) ─────────────
  function _emptyDecision(problemType, reason) {
    return {
      problemType:    problemType,
      ttt:            null,
      generatedAt:    new Date().toISOString(),
      recommendation: null,
      confidence:     0,
      expectedTL:     null,
      risk:           { level: 'LOW', topRisk: null },
      alternatives:   [],
      _empty:         true,
      _reason:        reason || 'Veri yetersiz'
    };
  }

  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.DecisionEngine = {
    decide:             decide,
    decideBatch:        decideBatch,
    getDecisionContext: getDecisionContext,
    clearCache:         clearCache,
    version:            ENGINE_VERSION,
    problemTypes:       ALL_PROBLEM_TYPES,
    weights:            SCORE_WEIGHTS   // dışa açık — test/debug için
  };

  console.debug('[decision-engine] FAZ 6.7 yüklendi. Versiyon:', ENGINE_VERSION,
    '| Problem tipleri:', ALL_PROBLEM_TYPES.join(', '));

})();
