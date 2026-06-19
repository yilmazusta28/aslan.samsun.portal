// ══════════════════════════════════════════════════════════════════════
//  js/ai/recommendation-memory.js
//  PHARMA VISION — Recommendation Memory System
//
//  Sorumluluk:
//    AI tarafından oluşturulan tüm önerileri localStorage'da saklar.
//
//  Public API (window.RecommendationMemory):
//    saveRecommendation(rec)                              → savedRec | null
//    getRecommendations()                                 → rec[]
//    getRecommendationById(id)                            → rec | null
//    updateRecommendationOutcome(id, outcome, outcomeValue) → rec | null
//    markRecommendationEvaluated(id, outcomeId)           → rec | null
//    deleteOldRecommendations(maxItems)                   → deletedCount
//    getRecommendationsByRepresentative(rep)              → rec[]
//    getRecommendationsByPeriod(period)                   → rec[]
//    clearAllRecommendations()                            → boolean
//    getRecommendationStats()                             → stats{}
//
//  Depolama anahtarı : pharma_recommendation_memory_v1
//  Max kayıt        : 500 (en eski silinir)
//  Bozuk veri       : otomatik sıfırla
//
//  FAZ 1.45 DEĞİŞİKLİK: type="module" → classic IIFE
//    Sebep: type="module" olarak yüklendiğinde window.RecommendationMemory
//    classic script'lere (autonomous-planning-engine, outcome-tracker vb.)
//    geç/belirsiz zamanda düşüyordu. IIFE dönüşümü ile synchronous
//    yükleme garantilendi. ES export'lar kaldırıldı (proje classic script).
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var STORAGE_KEY = 'pharma_recommendation_memory_v1';
  var DEFAULT_MAX = 500;

  // ── İç yardımcılar ───────────────────────────────────────────────────

  function _generateId() {
    var ts  = Date.now().toString(36);
    var rnd = Math.random().toString(16).slice(2, 6);
    return 'rec_' + ts + '_' + rnd;
  }

  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[recommendation-memory] Bozuk veri — sıfırlanıyor.');
        localStorage.removeItem(STORAGE_KEY);
        return [];
      }
      return parsed;
    } catch (e) {
      console.warn('[recommendation-memory] localStorage okuma hatası:', e.message, '— sıfırlanıyor.');
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return [];
    }
  }

  function _save(records) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      console.warn('[recommendation-memory] localStorage yazma hatası:', e.message);
    }
  }

  function _sameDay(isoA, isoB) {
    return typeof isoA === 'string' && typeof isoB === 'string' &&
           isoA.length >= 10 && isoB.length >= 10 &&
           isoA.slice(0, 10) === isoB.slice(0, 10);
  }

  function _findDuplicate(records, record) {
    return records.find(function (r) {
      return r.representative === record.representative &&
             r.recommendation && record.recommendation &&
             r.recommendation.action   === record.recommendation.action &&
             r.recommendation.brick    === record.recommendation.brick &&
             r.recommendation.pharmacy === record.recommendation.pharmacy &&
             _sameDay(r.createdAt, record.createdAt);
    }) || null;
  }

  function _validate(rec) {
    if (!rec || typeof rec !== 'object') {
      return { valid: false, reason: 'rec bir nesne olmalı' };
    }
    if (typeof rec.representative !== 'string' || !rec.representative.trim()) {
      return { valid: false, reason: '"representative" zorunlu string alan' };
    }
    if (typeof rec.period !== 'string' || !rec.period.trim()) {
      return { valid: false, reason: '"period" zorunlu string alan' };
    }
    if (!rec.recommendation || typeof rec.recommendation !== 'object') {
      return { valid: false, reason: '"recommendation" nesne olmalı' };
    }
    if (typeof rec.recommendation.action !== 'string' || !rec.recommendation.action.trim()) {
      return { valid: false, reason: '"recommendation.action" zorunlu string alan' };
    }
    return { valid: true };
  }

  function _buildRecord(rec) {
    var rDetail = rec.recommendation || {};
    var ctx     = rec.contextSnapshot  || {};

    return {
      id            : (typeof rec.id === 'string' && rec.id.trim()) ? rec.id.trim() : _generateId(),
      createdAt     : new Date().toISOString(),
      representative: rec.representative.trim(),
      period        : rec.period.trim(),

      recommendation: {
        action           : rDetail.action.trim(),
        product          : (rDetail.product          !== undefined) ? rDetail.product          : null,
        brick            : (rDetail.brick            !== undefined) ? rDetail.brick            : null,
        pharmacy         : (rDetail.pharmacy         !== undefined) ? rDetail.pharmacy         : null,
        expectedImpactTL : (typeof rDetail.expectedImpactTL === 'number') ? rDetail.expectedImpactTL : null,
        confidence       : (typeof rDetail.confidence        === 'number') ? rDetail.confidence        : null
      },

      contextSnapshot: {
        tlPct        : (typeof ctx.tlPct         === 'number') ? ctx.tlPct         : 0,
        primPct      : (typeof ctx.primPct       === 'number') ? ctx.primPct       : 0,
        remainingDays: (typeof ctx.remainingDays === 'number') ? ctx.remainingDays : 0,
        riskLevel    : (typeof ctx.riskLevel     === 'string') ? ctx.riskLevel     : 'UNKNOWN'
      },

      outcome     : 'pending',
      outcomeValue: null,

      // FAZ 1.3: Outcome Tracker entegrasyonu
      evaluated         : false,
      outcomeId         : null,
      lastEvaluationDate: null
    };
  }

  // ── Public API ────────────────────────────────────────────────────────

  function saveRecommendation(rec) {
    try {
      var validation = _validate(rec);
      if (!validation.valid) {
        console.warn('[recommendation-memory] Geçersiz kayıt:', validation.reason);
        return null;
      }

      var record  = _buildRecord(rec);
      var records = _load();

      var existingIdx = records.findIndex(function (r) { return r.id === record.id; });
      if (existingIdx !== -1) {
        records[existingIdx] = record;
      } else {
        var duplicate = _findDuplicate(records, record);
        if (duplicate) {
          console.debug('[recommendation-memory] Duplicate öneri (bugün zaten kayıtlı) — atlandı:', duplicate.id);
          return duplicate;
        }
        records.push(record);
      }

      deleteOldRecommendations(DEFAULT_MAX, records);
      _save(records);
      return (existingIdx !== -1) ? records[existingIdx] : record;
    } catch (e) {
      console.error('[recommendation-memory] saveRecommendation hatası:', e.message);
      return null;
    }
  }

  function getRecommendations() {
    try {
      var records = _load();
      return records.slice().sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
    } catch (e) {
      console.error('[recommendation-memory] getRecommendations hatası:', e.message);
      return [];
    }
  }

  function getRecommendationById(id) {
    try {
      if (typeof id !== 'string' || !id.trim()) return null;
      var records = _load();
      return records.find(function (r) { return r.id === id; }) || null;
    } catch (e) {
      console.error('[recommendation-memory] getRecommendationById hatası:', e.message);
      return null;
    }
  }

  function updateRecommendationOutcome(id, outcome, outcomeValue) {
    try {
      if (typeof id !== 'string' || !id.trim()) return null;
      var VALID = ['pending', 'achieved', 'partial', 'missed', 'cancelled'];
      if (typeof outcome !== 'string' || !VALID.includes(outcome)) {
        console.warn('[recommendation-memory] updateRecommendationOutcome: geçersiz outcome —', outcome);
        return null;
      }
      var records = _load();
      var idx = records.findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      records[idx].outcome      = outcome;
      records[idx].outcomeValue = (outcomeValue !== undefined) ? outcomeValue : null;
      records[idx].updatedAt    = new Date().toISOString();
      _save(records);
      return records[idx];
    } catch (e) {
      console.error('[recommendation-memory] updateRecommendationOutcome hatası:', e.message);
      return null;
    }
  }

  // FAZ 1.3 — Outcome Tracker entegrasyonu
  function markRecommendationEvaluated(id, outcomeId) {
    try {
      if (typeof id !== 'string' || !id.trim()) return null;
      var records = _load();
      var idx = records.findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      records[idx].evaluated          = true;
      records[idx].outcomeId          = (typeof outcomeId === 'string' && outcomeId.trim()) ? outcomeId.trim() : null;
      records[idx].lastEvaluationDate = new Date().toISOString();
      _save(records);
      return records[idx];
    } catch (e) {
      console.error('[recommendation-memory] markRecommendationEvaluated hatası:', e.message);
      return null;
    }
  }

  function deleteOldRecommendations(maxItems, _records) {
    try {
      var limit = (typeof maxItems === 'number' && maxItems > 0) ? Math.floor(maxItems) : DEFAULT_MAX;
      var usingExternal = Array.isArray(_records);
      var records = usingExternal ? _records : _load();
      if (records.length <= limit) return 0;
      records.sort(function (a, b) {
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      var deleteCount = records.length - limit;
      records.splice(0, deleteCount);
      if (!usingExternal) _save(records);
      console.debug('[recommendation-memory]', deleteCount, 'eski kayıt silindi. Kalan:', records.length);
      return deleteCount;
    } catch (e) {
      console.error('[recommendation-memory] deleteOldRecommendations hatası:', e.message);
      return 0;
    }
  }

  function getRecommendationsByRepresentative(representative) {
    try {
      if (typeof representative !== 'string' || !representative.trim()) return [];
      return getRecommendations().filter(function (r) {
        return r.representative === representative.trim();
      });
    } catch (e) {
      console.error('[recommendation-memory] getRecommendationsByRepresentative hatası:', e.message);
      return [];
    }
  }

  function getRecommendationsByPeriod(period) {
    try {
      if (typeof period !== 'string' || !period.trim()) return [];
      return getRecommendations().filter(function (r) { return r.period === period.trim(); });
    } catch (e) {
      console.error('[recommendation-memory] getRecommendationsByPeriod hatası:', e.message);
      return [];
    }
  }

  function clearAllRecommendations() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.info('[recommendation-memory] Tüm öneri hafızası temizlendi.');
      return true;
    } catch (e) {
      console.error('[recommendation-memory] clearAllRecommendations hatası:', e.message);
      return false;
    }
  }

  function getRecommendationStats() {
    try {
      var records = _load();
      var stats = { total: records.length, pending: 0, achieved: 0, partial: 0, missed: 0, cancelled: 0 };
      records.forEach(function (r) {
        if (Object.prototype.hasOwnProperty.call(stats, r.outcome)) stats[r.outcome]++;
      });
      return stats;
    } catch (e) {
      console.error('[recommendation-memory] getRecommendationStats hatası:', e.message);
      return { total: 0, pending: 0, achieved: 0, partial: 0, missed: 0, cancelled: 0 };
    }
  }

  // ── window.RecommendationMemory köprüsü ──────────────────────────────
  window.RecommendationMemory = {
    saveRecommendation              : saveRecommendation,
    getRecommendations              : getRecommendations,
    getRecommendationById           : getRecommendationById,
    updateRecommendationOutcome     : updateRecommendationOutcome,
    markRecommendationEvaluated     : markRecommendationEvaluated,
    deleteOldRecommendations        : deleteOldRecommendations,
    getRecommendationsByRepresentative: getRecommendationsByRepresentative,
    getRecommendationsByPeriod      : getRecommendationsByPeriod,
    clearAllRecommendations         : clearAllRecommendations,
    getRecommendationStats          : getRecommendationStats
  };

  console.debug('[recommendation-memory] window.RecommendationMemory hazır (classic IIFE).');

})();
