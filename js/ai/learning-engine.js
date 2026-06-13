// ═══════════════════════════════════════════════════════════════════════
// js/ai/learning-engine.js — PHASE 5.4
// Prediction Accuracy & Learning Tracker
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var STORE_KEY     = 'AI_PREDICTIONS_V1';
  var MAX_AGE_DAYS  = 730; // 24 ay

  // ── Motor tanımları — future-proof, hardcoded değil ─────────────────
  var ENGINES = [
    { id: 'forecast',  label: 'Forecast Engine',   weight: 1.0 },
    { id: 'reorder',   label: 'Reorder Engine',    weight: 1.0 },
    { id: 'visit',     label: 'Visit Planner',     weight: 1.0 },
    { id: 'route',     label: 'Route Engine',      weight: 1.0 },
    { id: 'risk',      label: 'Risk Engine',       weight: 1.0 },
    { id: 'executive', label: 'Executive Engine',  weight: 1.0 },
    { id: 'opportunity',label:'Opportunity Engine',weight: 1.0 },
  ];

  // ── predictionStore ──────────────────────────────────────────────────
  window.predictionStore = window.predictionStore || {
    forecasts:          [],
    reorderPredictions: [],
    visitPredictions:   [],
    routePredictions:   [],
    metrics:            {}
  };

  // ── localStorage persist ─────────────────────────────────────────────
  function _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(window.predictionStore));
    } catch (e) { console.warn('[LearningEngine] save hata:', e.message); }
  }

  function _load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      // Merge — mevcut store'u geçersiz kılma
      ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(k) {
        if (parsed[k] && parsed[k].length) {
          window.predictionStore[k] = parsed[k];
        }
      });
      if (parsed.metrics) window.predictionStore.metrics = parsed.metrics;
      console.log('[LearningEngine] Restore:', _totalCount(), 'tahmin yüklendi');
    } catch (e) { console.warn('[LearningEngine] load hata:', e.message); }
  }

  function _totalCount() {
    var s = window.predictionStore;
    return (s.forecasts||[]).length + (s.reorderPredictions||[]).length
         + (s.visitPredictions||[]).length + (s.routePredictions||[]).length;
  }

  // ── Tip → store bucket map ───────────────────────────────────────────
  function _bucket(type) {
    var map = {
      forecast: 'forecasts',
      reorder:  'reorderPredictions',
      visit:    'visitPredictions',
      route:    'routePredictions'
    };
    return map[type] || 'forecasts';
  }

  // ── recordPrediction(pred) ───────────────────────────────────────────
  // pred: { type, pharmacy, product, predictedQty, confidence, engine, reasons, meta }
  function recordPrediction(pred) {
    if (!pred || !pred.type) return null;
    var record = {
      id:           _uid(),
      type:         pred.type,
      engine:       pred.engine || pred.type,
      createdAt:    _today(),
      pharmacy:     pred.pharmacy  || null,
      product:      pred.product   || null,
      brick:        pred.brick     || null,
      ttt:          pred.ttt       || null,
      predictedQty: pred.predictedQty != null ? pred.predictedQty : null,
      predictedTL:  pred.predictedTL  != null ? pred.predictedTL  : null,
      confidence:   pred.confidence   != null ? pred.confidence   : 75,
      reasons:      pred.reasons      || [],
      meta:         pred.meta         || {},
      // Gerçekleşme — evaluatePredictions() doldurur
      actualQty:    null,
      actualTL:     null,
      evaluatedAt:  null,
      error:        null,
      ape:          null,
      hit:          null,
    };
    var bucket = _bucket(pred.type);
    window.predictionStore[bucket].push(record);
    _prune();
    _save();
    return record.id;
  }

  // ── evaluatePredictions() ────────────────────────────────────────────
  // Yeni CSV verisi gelince çağrılır — gerçekleşmeleri eşleştirir
  function evaluatePredictions() {
    var base = (window.pharmacyActiveData && window.pharmacyActiveData.length)
      ? window.pharmacyActiveData
      : (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);

    if (!base || !base.length) {
      console.warn('[LearningEngine] evaluatePredictions: veri yok');
      return;
    }

    // Gerçekleşme agregasyonu: pharmacy+product+ay → gerçek adet/tutar
    var actuals = {};
    base.forEach(function(r) {
      var key = (r.ad||r.eczane||'') + '::' + (r.urun||'') + '::' + (r.ay||'');
      if (!actuals[key]) actuals[key] = { qty: 0, tl: 0 };
      actuals[key].qty += parseFloat(r.adet  || 0);
      actuals[key].tl  += parseFloat(r.tutar || 0);
    });

    var updated = 0;
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(bucket) {
      (window.predictionStore[bucket] || []).forEach(function(p) {
        if (p.evaluatedAt) return; // zaten değerlendirildi
        if (!p.pharmacy || !p.product) return;

        // Tahmin ayına denk gelen gerçekleşmeyi bul
        var predMonth = p.meta && p.meta.targetMonth ? p.meta.targetMonth : null;
        var key = p.pharmacy + '::' + p.product + '::' + (predMonth || '');
        var actual = actuals[key];

        if (!actual) {
          // Ay bilinmiyorsa, herhangi bir eşleşme ara
          var prefix = p.pharmacy + '::' + p.product + '::';
          var keys   = Object.keys(actuals).filter(function(k) { return k.indexOf(prefix) === 0; });
          if (keys.length) actual = actuals[keys[0]];
        }

        if (actual && actual.qty > 0) {
          var err    = actual.qty - (p.predictedQty || 0);
          var ape    = Math.abs(err) / actual.qty * 100;
          p.actualQty   = actual.qty;
          p.actualTL    = actual.tl;
          p.evaluatedAt = _today();
          p.error       = Math.round(err * 10) / 10;
          p.ape         = Math.round(ape * 10) / 10;
          p.hit         = ape <= 20; // %20 tolerans içindeyse başarılı
          updated++;
        }
      });
    });

    if (updated > 0) {
      _save();
      console.log('[LearningEngine] evaluatePredictions:', updated, 'tahmin değerlendirildi');
    }
    return updated;
  }

  // ── getAccuracyMetrics() ─────────────────────────────────────────────
  function getAccuracyMetrics() {
    var metrics = {
      byEngine:   {},
      byPharmacy: {},
      overall:    { mape: 0, mae: 0, rmse: 0, n: 0, hitRate: 0 },
    };

    // Tüm değerlendirilmiş tahminler
    var allEval = [];
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(b) {
      (window.predictionStore[b] || []).forEach(function(p) {
        if (p.evaluatedAt && p.ape != null) allEval.push(p);
      });
    });

    if (!allEval.length) return metrics;

    // Overall
    var sumApe = 0, sumAbs = 0, sumSq = 0, hits = 0;
    allEval.forEach(function(p) {
      sumApe += p.ape;
      sumAbs += Math.abs(p.error || 0);
      sumSq  += Math.pow(p.error || 0, 2);
      if (p.hit) hits++;
    });
    var n = allEval.length;
    metrics.overall = {
      mape:    Math.round(sumApe / n * 10) / 10,
      mae:     Math.round(sumAbs / n * 10) / 10,
      rmse:    Math.round(Math.sqrt(sumSq / n) * 10) / 10,
      n:       n,
      hitRate: Math.round(hits / n * 100),
    };

    // Motor bazlı
    ENGINES.forEach(function(eng) {
      var ep = allEval.filter(function(p) { return p.engine === eng.id; });
      if (!ep.length) return;
      var eApe = ep.reduce(function(s,p){ return s+p.ape; }, 0) / ep.length;
      var eHit = ep.filter(function(p){ return p.hit; }).length;
      metrics.byEngine[eng.id] = {
        label:    eng.label,
        mape:     Math.round(eApe * 10) / 10,
        accuracy: Math.round((1 - eApe/100) * 100),
        hitRate:  Math.round(eHit / ep.length * 100),
        n:        ep.length,
        weight:   eng.weight,
      };
    });

    // Eczane bazlı
    var pharMap = {};
    allEval.forEach(function(p) {
      if (!p.pharmacy) return;
      if (!pharMap[p.pharmacy]) pharMap[p.pharmacy] = {
        forecastApe: [], reorderApe: [], visitApe: [], n: 0
      };
      var pm = pharMap[p.pharmacy];
      pm.n++;
      if (p.type === 'forecast') pm.forecastApe.push(p.ape);
      if (p.type === 'reorder')  pm.reorderApe.push(p.ape);
      if (p.type === 'visit')    pm.visitApe.push(p.ape);
    });
    Object.keys(pharMap).forEach(function(ph) {
      var pm = pharMap[ph];
      var _avg = function(arr) {
        return arr.length ? Math.round((1 - arr.reduce(function(s,v){return s+v;},0)/arr.length/100)*100) : null;
      };
      metrics.byPharmacy[ph] = {
        forecastAccuracy: _avg(pm.forecastApe),
        reorderAccuracy:  _avg(pm.reorderApe),
        visitAccuracy:    _avg(pm.visitApe),
        totalPredictions: pm.n,
      };
    });

    window.predictionStore.metrics = metrics;
    return metrics;
  }

  // ── updateConfidenceWeights() ─────────────────────────────────────────
  // Motor başarısına göre dinamik ağırlık güncelle
  function updateConfidenceWeights() {
    var metrics = getAccuracyMetrics();
    ENGINES.forEach(function(eng) {
      var em = metrics.byEngine[eng.id];
      if (!em || em.n < 5) return; // yeterli veri yoksa dokunma
      var acc = em.accuracy / 100; // 0–1
      // Ağırlık: başarı %90+ → 1.2, %75+ → 1.0, %60+ → 0.85, altı → 0.7
      eng.weight = acc >= 0.90 ? 1.2
                 : acc >= 0.75 ? 1.0
                 : acc >= 0.60 ? 0.85
                 : 0.70;
    });
    console.log('[LearningEngine] Ağırlıklar güncellendi:', 
      ENGINES.map(function(e){ return e.id+':'+e.weight; }).join(', '));
    return ENGINES;
  }

  // ── getEngineWeight(engineId) ─────────────────────────────────────────
  function getEngineWeight(engineId) {
    var eng = ENGINES.filter(function(e){ return e.id === engineId; })[0];
    return eng ? eng.weight : 1.0;
  }

  // ── getExplainability(prediction) ────────────────────────────────────
  // "Güven neden bu kadar?" cevabı
  function getExplainability(engineId, pharmacy, product) {
    var metrics  = getAccuracyMetrics();
    var reasons  = [];
    var engMet   = metrics.byEngine[engineId];
    var pharMet  = pharmacy ? metrics.byPharmacy[pharmacy] : null;
    var engWt    = getEngineWeight(engineId);

    if (engMet && engMet.n >= 3) {
      reasons.push({
        icon: engMet.accuracy >= 85 ? '✓' : '⚠',
        text: 'Son ' + engMet.n + ' tahmin doğruluğu %' + engMet.accuracy
      });
    }
    if (pharMet && pharmacy) {
      var phAcc = pharMet.forecastAccuracy || pharMet.reorderAccuracy || pharMet.visitAccuracy;
      if (phAcc != null) {
        reasons.push({
          icon: phAcc >= 85 ? '✓' : '⚠',
          text: 'Aynı eczanede başarı %' + phAcc
        });
      }
    }
    if (engWt >= 1.1) {
      reasons.push({ icon: '✓', text: 'Motor ağırlığı yüksek (' + engWt.toFixed(1) + 'x)' });
    } else if (engWt < 0.9) {
      reasons.push({ icon: '⚠', text: 'Motor ağırlığı düşük (' + engWt.toFixed(1) + 'x) — az veri' });
    }
    if (!reasons.length) {
      reasons.push({ icon: '─', text: 'Yeterli değerlendirme verisi yok (ilk tahminler)' });
    }
    return reasons;
  }

  // ── archivePredictionHistory() ────────────────────────────────────────
  function archivePredictionHistory() {
    var cutoff   = _daysAgo(MAX_AGE_DAYS);
    var archived = 0;
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(b) {
      var before = (window.predictionStore[b] || []).length;
      window.predictionStore[b] = (window.predictionStore[b] || []).filter(function(p) {
        return p.createdAt >= cutoff;
      });
      archived += before - window.predictionStore[b].length;
    });
    if (archived > 0) {
      _save();
      console.log('[LearningEngine] Arşivlendi:', archived, 'eski tahmin kaldırıldı (>' + MAX_AGE_DAYS + ' gün)');
    }
    return archived;
  }

  // ── renderAIPerformanceDashboard(containerId) ─────────────────────────
  function renderAIPerformanceDashboard(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var m   = getAccuracyMetrics();
    var ov  = m.overall;
    var eng = m.byEngine;
    var _em = ENGINES.map(function(e) { return eng[e.id]; }).filter(Boolean);

    var html = '<div style="padding:12px">';

    // Özet kartlar
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:14px">';
    var cards = [
      { label:'Tahmin Sayısı', val: ov.n || 0, unit:'', color:'var(--c2)', icon:'🧠' },
      { label:'Hit Rate',      val: ov.hitRate || 0, unit:'%', color:'#16A34A', icon:'🎯' },
      { label:'MAPE',          val: ov.mape || 0, unit:'%', color: (ov.mape||0)>15?'#DC2626':'#D97706', icon:'📉' },
      { label:'MAE',           val: ov.mae  || 0, unit:' kutu', color:'var(--dim)', icon:'📊' },
      { label:'RMSE',          val: ov.rmse || 0, unit:'', color:'var(--dim)', icon:'📐' },
    ];
    cards.forEach(function(c) {
      html += '<div style="background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">'
            + '<div style="font-size:18px;margin-bottom:4px">' + c.icon + '</div>'
            + '<div style="font-size:16px;font-weight:800;color:' + c.color + '">' + c.val + c.unit + '</div>'
            + '<div style="font-size:9px;color:var(--dim);margin-top:2px">' + c.label + '</div>'
            + '</div>';
    });
    html += '</div>';

    // Motor bazlı performans
    if (_em.length) {
      html += '<div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:8px;letter-spacing:.5px">MOTOR PERFORMANSI</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px">';
      _em.forEach(function(e) {
        var acc = e.accuracy || 0;
        var barColor = acc>=85?'#16A34A':acc>=70?'#D97706':'#DC2626';
        var wt  = getEngineWeight(e.id || '');
        html += '<div style="background:var(--surf);border:1px solid var(--border);border-radius:8px;padding:8px 12px">'
              + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
              + '<span style="font-size:11px;font-weight:600">' + e.label + '</span>'
              + '<span style="font-size:10px;color:var(--dim)">n=' + e.n + ' | ağırlık:' + (wt||1).toFixed(1) + '</span>'
              + '</div>'
              + '<div style="display:flex;align-items:center;gap:8px">'
              + '<div style="flex:1;height:6px;background:var(--border);border-radius:3px">'
              + '<div style="width:' + Math.min(acc,100) + '%;height:100%;background:' + barColor + ';border-radius:3px"></div>'
              + '</div>'
              + '<span style="font-size:12px;font-weight:800;color:' + barColor + ';min-width:35px;text-align:right">%' + acc + '</span>'
              + '</div>'
              + '<div style="display:flex;gap:12px;margin-top:4px">'
              + '<span style="font-size:9px;color:var(--dim)">MAPE: ' + e.mape + '%</span>'
              + '<span style="font-size:9px;color:var(--dim)">Hit: %' + e.hitRate + '</span>'
              + '</div>'
              + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:24px;color:var(--dim);font-size:11px">'
            + '🧠 Henüz değerlendirilmiş tahmin yok.<br>'
            + '<span style="font-size:10px">AI tahminler üretirken otomatik kayıt başlar.</span>'
            + '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // ── _prune() — eski kayıtları temizle ────────────────────────────────
  function _prune() {
    var cutoff = _daysAgo(MAX_AGE_DAYS);
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(b) {
      window.predictionStore[b] = (window.predictionStore[b]||[]).filter(function(p) {
        return !p.createdAt || p.createdAt >= cutoff;
      });
    });
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────
  var _uidCtr = 0;
  function _uid() {
    return 'pred_' + Date.now() + '_' + (++_uidCtr);
  }
  function _today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function _daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // ── Başlangıç ─────────────────────────────────────────────────────────
  _load();
  archivePredictionHistory();

  // ── Global API ────────────────────────────────────────────────────────
  window.LearningEngine = {
    // Core API (spec)
    recordPrediction:         recordPrediction,
    evaluatePredictions:      evaluatePredictions,
    getAccuracyMetrics:       getAccuracyMetrics,
    updateConfidenceWeights:  updateConfidenceWeights,
    // Extended
    getEngineWeight:          getEngineWeight,
    getExplainability:        getExplainability,
    archivePredictionHistory: archivePredictionHistory,
    renderAIPerformanceDashboard: renderAIPerformanceDashboard,
    // Store erişimi
    getStore: function() { return window.predictionStore; },
    getEngines: function() { return ENGINES; },
  };

  console.log('[LearningEngine] Phase 5.4 yüklendi ✅ — ' + _totalCount() + ' tahmin restore edildi');

})();
