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

    // ── Dedupe: aynı gün + tip + eczane + ürün + ttt için tekrar kayıt açma ──
    // (Render her tetiklendiğinde aynı tahmin tekrar oluşmasın)
    var bucket0 = _bucket(pred.type);
    var today0  = _today();
    var _dupeMatches = (window.predictionStore[bucket0] || []).filter(function(p) {
      return p.createdAt === today0
        && p.type === pred.type
        && p.pharmacy === (pred.pharmacy || null)
        && p.product  === (pred.product  || null)
        && p.ttt      === (pred.ttt      || null);
    });
    var dupe = _dupeMatches.length ? _dupeMatches[0] : null;
    if (dupe) {
      // Mevcut kaydı güncelle (en güncel tahmin değeriyle)
      dupe.predictedQty = pred.predictedQty != null ? pred.predictedQty : dupe.predictedQty;
      dupe.confidence    = pred.confidence   != null ? pred.confidence   : dupe.confidence;
      dupe.meta          = pred.meta || dupe.meta;
      return dupe.id;
    }

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

    // TTT bazlı toplam (forecast tipi için — eczane/ürün ayrımı yok)
    var tttTotals = {};
    base.forEach(function(r) {
      var ttt = r.ttt || 'BILINMEYEN';
      var ay  = r.ay || '';
      var tk  = ttt + '::' + ay;
      if (!tttTotals[tk]) tttTotals[tk] = { qty: 0, tl: 0 };
      tttTotals[tk].qty += parseFloat(r.adet  || 0);
      tttTotals[tk].tl  += parseFloat(r.tutar || 0);
    });

    var updated = 0;
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(bucket) {
      (window.predictionStore[bucket] || []).forEach(function(p) {
        if (p.evaluatedAt) return; // zaten değerlendirildi

        // ── Forecast tipi: ttt + ay bazlı toplam kutu/TL ──────────────
        if (p.type === 'forecast') {
          if (!p.ttt) return;
          var tKeys = Object.keys(tttTotals).filter(function(k){ return k.indexOf(p.ttt + '::') === 0; });
          if (!tKeys.length) return;
          // En güncel ayı al
          var tAct = tttTotals[tKeys[tKeys.length-1]];
          if (tAct && tAct.qty > 0) {
            var fErr = tAct.qty - (p.predictedQty || 0);
            var fApe = Math.abs(fErr) / tAct.qty * 100;
            p.actualQty   = tAct.qty;
            p.actualTL    = tAct.tl;
            p.evaluatedAt = _today();
            p.error       = Math.round(fErr * 10) / 10;
            p.ape         = Math.round(fApe * 10) / 10;
            p.hit         = fApe <= 20;
            updated++;
          }
          return;
        }

        // ── Diğer tipler: eczane + ürün bazlı ─────────────────────────
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

        // Tahmin ayı bilinmiyorsa son veriden al
        if (!actual) {
          var allKeys2 = Object.keys(actuals);
          if (allKeys2.length && p.pharmacy) {
            var pfx2 = p.pharmacy + '::' + (p.product||'');
            var matched2 = allKeys2.filter(function(k){ return k.indexOf(pfx2)===0; });
            if (matched2.length) actual = actuals[matched2[matched2.length-1]];
          }
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

    // Tüm tahminleri say (evaluate edilmemiş dahil)
    var store = window.predictionStore;
    var totalPending  = 0;
    var totalRecorded = 0;
    var byEngineCount = {};
    ['forecasts','reorderPredictions','visitPredictions','routePredictions'].forEach(function(b) {
      (store[b]||[]).forEach(function(p) {
        totalRecorded++;
        if (!p.evaluatedAt) totalPending++;
        var eid = p.engine || p.type || 'other';
        byEngineCount[eid] = (byEngineCount[eid]||0) + 1;
      });
    });

    var html = '<div style="padding:12px">';

    // Özet kartlar
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:14px">';
    var cards = [
      { label:'Toplam Kayıt',     val:totalRecorded,    unit:'',      color:'var(--c2)',    icon:'🧠' },
      { label:'Değerlendirilen',  val:ov.n||0,          unit:'',      color:'#0891B2',      icon:'✅' },
      { label:'Bekleyen',         val:totalPending,     unit:'',      color:'#D97706',      icon:'⏳' },
      { label:'Hit Rate',         val:ov.hitRate||'—',  unit: ov.n?'%':'', color:'#16A34A', icon:'🎯' },
      { label:'MAPE',             val:ov.mape||'—',     unit: ov.n?'%':'', color:(ov.mape||0)>15?'#DC2626':'#D97706', icon:'📉' },
    ];
    cards.forEach(function(c) {
      html += '<div style="background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">'
            + '<div style="font-size:16px;margin-bottom:4px">' + c.icon + '</div>'
            + '<div style="font-size:15px;font-weight:800;color:' + c.color + '">' + c.val + c.unit + '</div>'
            + '<div style="font-size:9px;color:var(--dim);margin-top:2px">' + c.label + '</div>'
            + '</div>';
    });
    html += '</div>';

    // Motor bazlı — evaluate edilmiş varsa accuracy, yoksa kayıt sayısı
    html += '<div style="font-size:10px;font-weight:700;color:var(--dim);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase">Motor Durumu</div>';
    html += '<div style="display:flex;flex-direction:column;gap:5px">';

    ENGINES.forEach(function(eng_def) {
      var em  = eng[eng_def.id];
      var cnt = byEngineCount[eng_def.id] || 0;
      var wt  = eng_def.weight;

      var acc = em ? em.accuracy : null;
      var barColor = acc!=null ? (acc>=85?'#16A34A':acc>=70?'#D97706':'#DC2626') : '#94A3B8';
      var barW     = acc!=null ? acc : 0;

      html += '<div style="background:var(--surf);border:1px solid var(--border);border-radius:8px;padding:7px 11px">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
            + '<span style="font-size:10px;font-weight:600">' + eng_def.label + '</span>'
            + '<span style="font-size:9px;color:var(--dim)">'
            + cnt + ' kayıt'
            + (em ? ' | n=' + em.n : '')
            + ' | ağırlık:' + wt.toFixed(1)
            + '</span>'
            + '</div>';

      if (acc != null) {
        html += '<div style="display:flex;align-items:center;gap:8px">'
              + '<div style="flex:1;height:5px;background:var(--border);border-radius:3px">'
              + '<div style="width:' + barW + '%;height:100%;background:' + barColor + ';border-radius:3px;transition:width .4s"></div>'
              + '</div>'
              + '<span style="font-size:11px;font-weight:800;color:' + barColor + ';min-width:36px;text-align:right">%' + acc + '</span>'
              + '</div>'
              + '<div style="display:flex;gap:10px;margin-top:3px">'
              + '<span style="font-size:9px;color:var(--dim)">MAPE: ' + (em.mape||'?') + '%</span>'
              + '<span style="font-size:9px;color:var(--dim)">Hit: %' + (em.hitRate||0) + '</span>'
              + '</div>';
      } else if (cnt > 0) {
        html += '<div style="font-size:9px;color:#D97706;margin-top:2px">'
              + '⏳ ' + cnt + ' tahmin gerçekleşme bekleniyor (sonraki ay verisi gelince hesaplanır)'
              + '</div>';
      } else {
        html += '<div style="font-size:9px;color:var(--dim);margin-top:2px">─ Henüz tahmin üretilmedi</div>';
      }

      html += '</div>';
    });

    html += '</div>';

    // Bilgi notu
    html += '<div style="margin-top:12px;padding:8px 12px;background:var(--surf);border:1px solid var(--border);'
          + 'border-radius:8px;font-size:9px;color:var(--dim);line-height:1.5">'
          + '💡 <b>Nasıl çalışır?</b> AI motorları tahmin ürettikçe otomatik kaydedilir. '
          + 'Sonraki ay eczane verisi yüklendiğinde gerçekleşmeler eşleştirilir ve doğruluk hesaplanır. '
          + 'Motor ağırlıkları başarı oranına göre dinamik güncellenir.'
          + '</div>';

    // Eylem butonları
    html += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
          + '<button class="tfb-sp" style="font-size:9px;padding:4px 10px" '
          + 'onclick="if(window.LearningEngine){LearningEngine.evaluatePredictions();LearningEngine.renderAIPerformanceDashboard('' + containerId + '')}">'
          + '🔄 Şimdi Değerlendir</button>'
          + '<button class="tfb-sp" style="font-size:9px;padding:4px 10px" '
          + 'onclick="if(window.LearningEngine){LearningEngine.updateConfidenceWeights();LearningEngine.renderAIPerformanceDashboard('' + containerId + '')}">'
          + '⚖️ Ağırlıkları Güncelle</button>'
          + '<button class="tfb-sp" style="font-size:9px;padding:4px 10px;color:#DC2626" '
          + 'onclick="if(confirm('Tüm tahmin geçmişi silinecek. Emin misiniz?')&&window.LearningEngine){'
          + 'localStorage.removeItem('AI_PREDICTIONS_V1');'
          + 'window.predictionStore={forecasts:[],reorderPredictions:[],visitPredictions:[],routePredictions:[],metrics:{}};'
          + 'LearningEngine.renderAIPerformanceDashboard('' + containerId + '')}">🗑️ Sıfırla</button>'
          + '</div>';

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
