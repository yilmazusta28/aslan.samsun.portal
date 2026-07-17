// ══════════════════════════════════════════════════════════════════════
//  js/ai/memory/ai-memory.js
//  Phase 4.2 — AI Memory Layer
//
//  Sorumluluk:
//    • AI_MEMORY global state — snapshot, behavior, strategy geçmişi
//    • saveMemorySnapshot(ttt)    — mevcut performansı kayde
//    • buildMemoryContext(ttt)    — AI prompt için hafıza özeti
//    • detectBehaviorPatterns(ttt)— ziyaret/ürün davranış analizi
//    • recordStrategyCall(type, ttt) — AI kullanım geçmişi
//    • calculateLearningScore(ttt)— 0-100 öğrenme skoru
//    • renderMemoryCard([id])     — dashboard kartı
//
//  Persistence: localStorage key "AI_MEMORY_V1"
//  Max snapshot: 200 (LRU — en eski silinir)
//  Max strategy history: 100
//
//  Null-safe: tüm fonksiyonlar try/catch ile sarılı
//  Bağımlılık:
//    js/data/data-state.js  (GENEL, IMS, MIGI_TL_RAW)
//    js/core/prim-calc.js   (calcPrimForTTT)
//    js/ai/predictive/runrate-engine.js (calculateRunRate)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, MIGI_TL_RAW, calcPrimForTTT, calculateRunRate */

(function () {
  'use strict';

  var STORAGE_KEY   = 'AI_MEMORY_V1';
  var MAX_SNAPSHOTS = 200;
  var MAX_STRATEGY  = 100;

  // ══════════════════════════════════════════════════════════
  //  1. STATE
  // ══════════════════════════════════════════════════════════

  window.AI_MEMORY = {
    sessions:        [],   // saveMemorySnapshot çıktıları
    insights:        {},   // { ttt → { trends, topProducts, … } }
    behavior:        {},   // { ttt → { topBricks, neglectedBricks, topProducts, … } }
    strategyHistory: []    // recordStrategyCall çıktıları
  };

  // ── _persist ──────────────────────────────────────────────
  function _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessions:        window.AI_MEMORY.sessions,
        insights:        window.AI_MEMORY.insights,
        behavior:        window.AI_MEMORY.behavior,
        strategyHistory: window.AI_MEMORY.strategyHistory
      }));
    } catch (e) {
      // localStorage dolu olabilir — sessizce geç
      console.warn('[ai-memory] localStorage yazma hatası:', e.message);
    }
  }

  // ── _restore ──────────────────────────────────────────────
  function _restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.sessions))        window.AI_MEMORY.sessions        = parsed.sessions;
        if (parsed.insights && typeof parsed.insights === 'object')  window.AI_MEMORY.insights  = parsed.insights;
        if (parsed.behavior && typeof parsed.behavior === 'object')  window.AI_MEMORY.behavior  = parsed.behavior;
        if (Array.isArray(parsed.strategyHistory)) window.AI_MEMORY.strategyHistory = parsed.strategyHistory;
        console.debug('[ai-memory] localStorage\'dan yüklendi.',
          window.AI_MEMORY.sessions.length, 'snapshot,',
          window.AI_MEMORY.strategyHistory.length, 'strateji kaydı.');
      }
    } catch (e) {
      console.warn('[ai-memory] localStorage okuma hatası:', e.message);
    }
  }

  // Sayfa yüklendiğinde geri yükle
  _restore();

  // ══════════════════════════════════════════════════════════
  //  2. saveMemorySnapshot(ttt)
  // ══════════════════════════════════════════════════════════

  /**
   * Mevcut TTT durumunu hafızaya kaydeder.
   * runEngine() veya AI yanıtı sonrasında otomatik tetiklenir.
   * @param {string} ttt
   */
  function saveMemorySnapshot(ttt) {
    try {
      if (!ttt) return;

      var today = new Date().toISOString().slice(0, 10);

      // GENEL TOPLAM
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var tlReal    = gt ? (gt.tl_pct   || 0) : 0;
      var primPuani = gt ? (gt.prim_pct  || 0) : 0;
      var hedefTL   = gt ? (gt.hedef_tl  || 0) : 0;
      var satisTL   = gt ? (gt.satis_tl  || 0) : 0;
      // Back-calc hedef (Phase 3.0.3 fix)
      if (hedefTL === 0 && tlReal > 0 && satisTL > 0) {
        hedefTL = Math.round(satisTL / (tlReal / 100));
      }

      // MI / GI (en güncel döneme ait kayıtlardan ortalama)
      // BUG DÜZELTMESİ: r.ttt → r.person, r.gi → r.bi + sadece EN GÜNCEL
      // döneme ait satırlar kullanılıyor (bkz. prim-calc.js düzeltme notu).
      var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
      var migiRowsAll = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : [])
        .filter(function (r) { return r.person === ttt; });
      var migiLatest = migiRowsAll.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
      var migiRows = migiRowsAll.filter(function (r) { return _migiDonemNum(r.donem) === migiLatest; });
      var mi = 100, gi = 100;
      if (migiRows.length) {
        mi = Math.round(migiRows.reduce(function (s, r) { return s + (r.mi || 100); }, 0) / migiRows.length);
        gi = Math.round(migiRows.reduce(function (s, r) { return s + (r.bi || 100); }, 0) / migiRows.length);
      }

      // Prim tahmini
      var prim = 0;
      try {
        if (typeof calcPrimForTTT === 'function') prim = calcPrimForTTT(ttt);
      } catch (pe) { /* silent */ }

      // Forecast
      var forecastReal = tlReal;
      try {
        if (typeof calculateRunRate === 'function') {
          var rr = calculateRunRate(ttt);
          if (rr && rr.projectedRealization > 0) forecastReal = rr.projectedRealization;
        }
      } catch (fe) { /* silent */ }

      // Ürün bazlı snapshot
      var urunReals = {};
      (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; })
        .forEach(function (r) { urunReals[r.urun] = Math.round((r.tl_pct || 0) * 10) / 10; });

      // IMS brick coverage (haftalık kutu sayısı per brick)
      var brickCoverage = {};
      (typeof IMS !== 'undefined' ? IMS : [])
        .filter(function (r) { return r.ttt === ttt && !r.is_mkt; })
        .forEach(function (r) {
          var b = r.brick || '?';
          brickCoverage[b] = (brickCoverage[b] || 0) + (r.toplam || r.own_kutu || 0);
        });

      var snapshot = {
        date:         today,
        ttt:          ttt,
        tlReal:       Math.round(tlReal   * 10) / 10,
        primPuani:    Math.round(primPuani * 10) / 10,
        mi:           mi,
        gi:           gi,
        prim:         Math.round(prim),
        hedefTL:      Math.round(hedefTL),
        satisTL:      Math.round(satisTL),
        forecastReal: Math.round(forecastReal * 10) / 10,
        urunReals:    urunReals,
        brickCoverage: brickCoverage,
        ts:           Date.now()
      };

      // LRU: maksimum 200 snapshot
      window.AI_MEMORY.sessions.push(snapshot);
      if (window.AI_MEMORY.sessions.length > MAX_SNAPSHOTS) {
        window.AI_MEMORY.sessions.splice(0, window.AI_MEMORY.sessions.length - MAX_SNAPSHOTS);
      }

      _persist();
      console.debug('[ai-memory] Snapshot kaydedildi:', ttt, today, 'tlReal=%' + snapshot.tlReal);

    } catch (e) {
      console.warn('[ai-memory] saveMemorySnapshot hata:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  3. buildMemoryContext(ttt)
  // ══════════════════════════════════════════════════════════

  /**
   * Son 7 snapshot + 30 günlük trendi AI prompt metnine çevirir.
   * @param {string} ttt
   * @returns {string}
   */
  function buildMemoryContext(ttt) {
    try {
      if (!ttt) return '';

      var sessions = window.AI_MEMORY.sessions
        .filter(function (s) { return s.ttt === ttt; })
        .sort(function (a, b) { return b.ts - a.ts }); // yeniden eskiye

      if (!sessions.length) return '';

      var last7 = sessions.slice(0, 7);

      // 30 günlük pencere
      var cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
      var last30   = sessions.filter(function (s) { return s.ts >= cutoff30; });

      var lines = [
        '',
        '--- AI HAFIZASI (Phase 4.2) ---',
        'Son kayıt tarihi : ' + (last7[0] ? last7[0].date : '—'),
        'Toplam snapshot  : ' + sessions.length,
        '30 günlük kayıt : ' + last30.length
      ];

      // TL Real trendi (son 7)
      if (last7.length >= 2) {
        var realOld  = last7[last7.length - 1].tlReal;
        var realNew  = last7[0].tlReal;
        var realDiff = Math.round((realNew - realOld) * 10) / 10;
        var realSign = realDiff >= 0 ? '+' : '';
        lines.push('TL Real trendi   : %' + realOld + ' → %' + realNew +
          ' (' + realSign + realDiff + ')');
      }

      // Ürün trendleri (son vs en eski snapshot)
      if (last7.length >= 2) {
        var newestU = last7[0].urunReals       || {};
        var oldestU = last7[last7.length - 1].urunReals || {};
        var risingU  = [], fallingU  = [];
        Object.keys(newestU).forEach(function (urun) {
          if (typeof oldestU[urun] === 'undefined') return;
          var diff = Math.round((newestU[urun] - oldestU[urun]) * 10) / 10;
          if (diff >= 3)  risingU.push(urun + ' +' + diff + '%');
          if (diff <= -3) fallingU.push(urun + ' ' + diff + '%');
        });
        if (risingU.length)  lines.push('Yükselen ürünler : ' + risingU.join(', '));
        if (fallingU.length) lines.push('Düşen ürünler    : ' + fallingU.join(', '));
      }

      // Brick trendleri
      if (last7.length >= 2) {
        var newestB = last7[0].brickCoverage       || {};
        var oldestB = last7[last7.length - 1].brickCoverage || {};
        var risingB  = [], fallingB = [];
        var allBricks = Array.from(new Set(Object.keys(newestB).concat(Object.keys(oldestB))));
        allBricks.forEach(function (b) {
          var nv = newestB[b] || 0;
          var ov = oldestB[b] || 0;
          if (ov === 0) return;
          var pctDiff = Math.round(((nv - ov) / ov) * 100);
          if (pctDiff >= 15)  risingB.push(b + ' +' + pctDiff + '%');
          if (pctDiff <= -15) fallingB.push(b + ' ' + pctDiff + '%');
        });
        if (risingB.length)  lines.push('Yükselen brickler: ' + risingB.slice(0, 4).join(', '));
        if (fallingB.length) lines.push('Düşen brickler   : ' + fallingB.slice(0, 4).join(', '));
      }

      // Son 7 snapshot özet tablosu
      lines.push('Son 7 kayıt (yeniden eskiye):');
      last7.forEach(function (s) {
        lines.push('  ' + s.date + ' → Real:%' + s.tlReal +
          ' Forecast:%' + s.forecastReal +
          ' MI:' + s.mi + ' GI:' + s.gi +
          (s.prim > 0 ? ' Prim:₺' + s.prim.toLocaleString('tr-TR') : ''));
      });

      // Öğrenme skoru
      var lScore = calculateLearningScore(ttt);
      lines.push('Öğrenme Skoru    : ' + lScore + '/100');

      return lines.join('\n');

    } catch (e) {
      console.warn('[ai-memory] buildMemoryContext hata:', e.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  4. detectBehaviorPatterns(ttt)
  // ══════════════════════════════════════════════════════════

  /**
   * Son 30 günlük snapshot'lardan davranış kalıplarını çıkarır.
   * Sonucu window.AI_MEMORY.behavior[ttt] olarak da kaydeder.
   * @param {string} ttt
   * @returns {{
   *   topBricks:       Array<{brick, score}>,
   *   neglectedBricks: Array<{brick, lastSeen, gapDays}>,
   *   topProducts:     Array<{product, avgReal}>,
   *   lowFocusProducts:Array<{product, avgReal}>,
   *   visitFrequency:  object
   * }}
   */
  function detectBehaviorPatterns(ttt) {
    var empty = {
      topBricks: [], neglectedBricks: [], topProducts: [],
      lowFocusProducts: [], visitFrequency: {}
    };
    try {
      if (!ttt) return empty;

      var cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
      var recent   = window.AI_MEMORY.sessions
        .filter(function (s) { return s.ttt === ttt && s.ts >= cutoff30; })
        .sort(function (a, b) { return b.ts - a.ts; });

      if (!recent.length) return empty;

      // Brick skoru: tüm snapshotların brickCoverage toplamı
      var brickScore = {};
      var brickLast  = {};  // son görülme tarihi
      recent.forEach(function (s) {
        var bc = s.brickCoverage || {};
        Object.keys(bc).forEach(function (b) {
          brickScore[b] = (brickScore[b] || 0) + bc[b];
          if (!brickLast[b] || s.ts > brickLast[b].ts) {
            brickLast[b] = { date: s.date, ts: s.ts };
          }
        });
      });

      // Top bricks
      var topBricks = Object.keys(brickScore)
        .map(function (b) { return { brick: b, score: brickScore[b] }; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 5);

      // Neglected bricks: var ama son 10 günde görülmemiş
      var cutoff10 = Date.now() - 10 * 24 * 60 * 60 * 1000;
      var neglectedBricks = Object.keys(brickLast)
        .filter(function (b) { return brickLast[b].ts < cutoff10; })
        .map(function (b) {
          var gapDays = Math.round((Date.now() - brickLast[b].ts) / 86400000);
          return { brick: b, lastSeen: brickLast[b].date, gapDays: gapDays };
        })
        .sort(function (a, b) { return b.gapDays - a.gapDays; })
        .slice(0, 5);

      // Ürün bazlı ortalama realizasyon
      var urunSum   = {};
      var urunCount = {};
      recent.forEach(function (s) {
        var ur = s.urunReals || {};
        Object.keys(ur).forEach(function (u) {
          urunSum[u]   = (urunSum[u]   || 0) + ur[u];
          urunCount[u] = (urunCount[u] || 0) + 1;
        });
      });

      var urunAvg = Object.keys(urunSum).map(function (u) {
        return { product: u, avgReal: Math.round((urunSum[u] / urunCount[u]) * 10) / 10 };
      });
      urunAvg.sort(function (a, b) { return b.avgReal - a.avgReal; });

      var topProducts      = urunAvg.filter(function (p) { return p.avgReal >= 85; }).slice(0, 3);
      var lowFocusProducts = urunAvg.filter(function (p) { return p.avgReal <  70; }).slice(0, 3);

      // Ziyaret sıklığı (snapshot başına kaç brick kapsandı)
      var visitFrequency = {};
      recent.slice(0, 7).forEach(function (s) {
        var bKeys = Object.keys(s.brickCoverage || {});
        visitFrequency[s.date] = bKeys.length;
      });

      var result = {
        topBricks:        topBricks,
        neglectedBricks:  neglectedBricks,
        topProducts:      topProducts,
        lowFocusProducts: lowFocusProducts,
        visitFrequency:   visitFrequency
      };

      // Hafızaya yaz
      window.AI_MEMORY.behavior[ttt] = result;
      _persist();

      return result;

    } catch (e) {
      console.warn('[ai-memory] detectBehaviorPatterns hata:', e.message);
      return empty;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  5. recordStrategyCall(type, ttt, [result])
  // ══════════════════════════════════════════════════════════

  /**
   * Her AI kullanımını kaydeder (aiQuick, sendAiMsg, runEngine, engineAiAnalysis).
   * @param {string} strategyType   e.g. 'genel', 'prim', 'brick', 'engine'
   * @param {string} ttt
   * @param {string} [result]       opsiyonel sonuç notu
   */
  function recordStrategyCall(strategyType, ttt, result) {
    try {
      var entry = {
        strategyType: strategyType || 'unknown',
        date:         new Date().toISOString().slice(0, 10),
        ts:           Date.now(),
        ttt:          ttt   || '—',
        result:       result || ''
      };

      window.AI_MEMORY.strategyHistory.push(entry);

      // LRU: maksimum 100
      if (window.AI_MEMORY.strategyHistory.length > MAX_STRATEGY) {
        window.AI_MEMORY.strategyHistory.splice(0,
          window.AI_MEMORY.strategyHistory.length - MAX_STRATEGY);
      }

      _persist();

    } catch (e) {
      console.warn('[ai-memory] recordStrategyCall hata:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  6. calculateLearningScore(ttt)
  // ══════════════════════════════════════════════════════════

  /**
   * AI öğrenme skoru (0-100).
   * Kriterler:
   *   25 puan — veri giriş sıklığı   (son 30 günde snapshot sayısı)
   *   25 puan — simülasyon kullanımı (buildFullSimulation kaç kez çağrıldı)
   *   25 puan — AI kullanım sıklığı  (recordStrategyCall kaydı)
   *   25 puan — hedef takibi         (snapshotlarda tlReal trendi tutarlı mı)
   * @param {string} ttt
   * @returns {number} 0-100
   */
  function calculateLearningScore(ttt) {
    try {
      var cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;

      // 1. Veri giriş sıklığı (max 25)
      var snapCount = window.AI_MEMORY.sessions
        .filter(function (s) { return s.ttt === ttt && s.ts >= cutoff30; }).length;
      var dataScore = Math.min(25, Math.round(snapCount * 2.5)); // 10+ snapshot → 25 puan

      // 2. Simülasyon kullanımı (max 25)
      var simCalls = window.AI_MEMORY.strategyHistory
        .filter(function (s) {
          return (s.ttt === ttt || s.ttt === '—') &&
                 s.ts >= cutoff30 &&
                 ['engine', 'simulator', 'prim', 'strateji'].indexOf(s.strategyType) >= 0;
        }).length;
      var simScore = Math.min(25, Math.round(simCalls * 5)); // 5+ kullanım → 25 puan

      // 3. AI kullanım sıklığı (max 25)
      var aiCalls = window.AI_MEMORY.strategyHistory
        .filter(function (s) { return (s.ttt === ttt || s.ttt === '—') && s.ts >= cutoff30; }).length;
      var aiScore = Math.min(25, Math.round(aiCalls * 2.5)); // 10+ kullanım → 25 puan

      // 4. Hedef takibi — snapshotlarda trend tutarlılığı (max 25)
      var tttSnaps = window.AI_MEMORY.sessions
        .filter(function (s) { return s.ttt === ttt; })
        .sort(function (a, b) { return a.ts - b.ts; });
      var trackScore = 0;
      if (tttSnaps.length >= 3) {
        // Tutarlı kayıt varsa (her gün değil ama düzenli)
        trackScore = Math.min(25, Math.round(tttSnaps.length * 1.5));
      } else if (tttSnaps.length >= 1) {
        trackScore = 5;
      }

      return Math.min(100, dataScore + simScore + aiScore + trackScore);

    } catch (e) {
      console.warn('[ai-memory] calculateLearningScore hata:', e.message);
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  7. renderMemoryCard([containerId], ttt)
  // ══════════════════════════════════════════════════════════

  /**
   * Executive Dashboard hafıza kartını render eder.
   * Container yoksa sessizce çıkar.
   * @param {string} [containerId]  varsayılan 'aiMemoryCardContainer'
   * @param {string} [ttt]          opsiyonel TTT filtresi
   */
  function renderMemoryCard(containerId, ttt) {
    var container = document.getElementById(containerId || 'aiMemoryCardContainer');
    if (!container) return;

    try {
      var activeTTT = ttt ||
        (typeof engineSelTTT !== 'undefined' ? engineSelTTT : '') ||
        (typeof selAiTTT     !== 'undefined' ? selAiTTT     : '');

      var lScore = activeTTT ? calculateLearningScore(activeTTT) : 0;
      var behavior = activeTTT ? detectBehaviorPatterns(activeTTT) : {};

      var cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
      var snapCount = window.AI_MEMORY.sessions
        .filter(function (s) { return (!activeTTT || s.ttt === activeTTT) && s.ts >= cutoff30; }).length;

      // Son snapshot'tan trend bilgisi
      var lastSnaps = window.AI_MEMORY.sessions
        .filter(function (s) { return !activeTTT || s.ttt === activeTTT; })
        .sort(function (a, b) { return b.ts - a.ts; });
      var lastSnap = lastSnaps[0];
      var prevSnap = lastSnaps[1];

      var trendVal  = lastSnap && prevSnap
        ? Math.round((lastSnap.tlReal - prevSnap.tlReal) * 10) / 10 : 0;
      var trendIcon = trendVal > 0 ? '📈' : trendVal < 0 ? '📉' : '➡️';
      var trendCol  = trendVal > 0 ? '#16A34A' : trendVal < 0 ? '#DC2626' : '#6B7280';

      var lColor = lScore >= 70 ? '#16A34A' : lScore >= 40 ? '#D97706' : '#6B7280';

      var topProd = behavior.topProducts && behavior.topProducts[0]
        ? behavior.topProducts[0].product + ' (%' + behavior.topProducts[0].avgReal + ')' : '—';
      var riskBrick = behavior.neglectedBricks && behavior.neglectedBricks[0]
        ? behavior.neglectedBricks[0].brick + ' (' + behavior.neglectedBricks[0].gapDays + ' gün)' : '—';

      function _card(label, value, color, sub) {
        return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
          'border-radius:10px;padding:12px 14px">' +
          '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;' +
          'letter-spacing:.8px;margin-bottom:4px">' + label + '</div>' +
          '<div style="font-size:18px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
          (sub ? '<div style="font-size:10px;color:var(--dim,#6b7280);margin-top:3px">' + sub + '</div>' : '') +
          '</div>';
      }

      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;padding:8px 0">';

      html += _card('AI Öğrenme Skoru',
        lScore + '/100',
        lColor,
        '30 günde ' + snapCount + ' kayıt'
      );

      html += _card('Son Trend',
        trendIcon + ' ' + (trendVal >= 0 ? '+' : '') + trendVal + '%',
        trendCol,
        lastSnap ? lastSnap.date + ' tarihli' : 'Kayıt yok'
      );

      html += _card('En Güçlü Ürün',
        behavior.topProducts && behavior.topProducts[0]
          ? behavior.topProducts[0].product : '—',
        '#4F008C',
        behavior.topProducts && behavior.topProducts[0]
          ? 'Ort. %' + behavior.topProducts[0].avgReal : '30 günlük veri yok'
      );

      html += _card('İhmal Edilen Brick',
        behavior.neglectedBricks && behavior.neglectedBricks[0]
          ? behavior.neglectedBricks[0].brick.split(' ')[0] : '—',
        '#DC2626',
        behavior.neglectedBricks && behavior.neglectedBricks[0]
          ? behavior.neglectedBricks[0].gapDays + ' gündür ziyaret yok' : 'Tümü aktif'
      );

      html += '</div>';

      // Son strateji geçmişi
      var stratList = window.AI_MEMORY.strategyHistory
        .filter(function (s) { return !activeTTT || s.ttt === activeTTT; })
        .sort(function (a, b) { return b.ts - a.ts; })
        .slice(0, 5);

      if (stratList.length) {
        html += '<div style="margin-top:6px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
          'border-radius:8px;padding:10px 12px">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;' +
          'color:var(--dim,#6b7280);margin-bottom:6px">Son AI Kullanımları</div>';
        stratList.forEach(function (s) {
          html += '<div style="display:flex;justify-content:space-between;font-size:11px;' +
            'padding:2px 0;color:var(--fg,#111)">' +
            '<span><strong>' + s.strategyType + '</strong>' +
            (s.ttt && s.ttt !== '—' ? ' · ' + s.ttt.split(' ')[0] : '') + '</span>' +
            '<span style="color:var(--dim,#6b7280)">' + s.date + '</span></div>';
        });
        html += '</div>';
      }

      container.innerHTML = html;

    } catch (e) {
      console.warn('[ai-memory] renderMemoryCard hata:', e.message);
      if (container) container.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:12px">Hafıza verisi yok.</div>';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  8. clearMemory([ttt])
  // ══════════════════════════════════════════════════════════

  /**
   * Hafızayı temizler.
   * @param {string} [ttt]  belirtilirse sadece bu TTT'nin verisi silinir
   */
  function clearMemory(ttt) {
    try {
      if (ttt) {
        window.AI_MEMORY.sessions        = window.AI_MEMORY.sessions.filter(function (s) { return s.ttt !== ttt; });
        window.AI_MEMORY.strategyHistory = window.AI_MEMORY.strategyHistory.filter(function (s) { return s.ttt !== ttt; });
        delete window.AI_MEMORY.insights[ttt];
        delete window.AI_MEMORY.behavior[ttt];
        console.debug('[ai-memory] TTT hafızası temizlendi:', ttt);
      } else {
        window.AI_MEMORY.sessions        = [];
        window.AI_MEMORY.insights        = {};
        window.AI_MEMORY.behavior        = {};
        window.AI_MEMORY.strategyHistory = [];
        console.debug('[ai-memory] Tüm hafıza temizlendi.');
      }
      _persist();
    } catch (e) {
      console.warn('[ai-memory] clearMemory hata:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  EXPORT
  // ══════════════════════════════════════════════════════════
  window.saveMemorySnapshot     = saveMemorySnapshot;
  window.buildMemoryContext     = buildMemoryContext;
  window.detectBehaviorPatterns = detectBehaviorPatterns;
  window.recordStrategyCall     = recordStrategyCall;
  window.calculateLearningScore = calculateLearningScore;
  window.renderMemoryCard       = renderMemoryCard;
  window.clearMemory            = clearMemory;

  console.debug('[ai-memory] Phase 4.2 yüklendi. Mevcut snapshot:',
    window.AI_MEMORY.sessions.length);

})();
