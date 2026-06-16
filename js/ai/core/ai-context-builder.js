// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-context-builder.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//
//  Sorumluluk: Tüm AI Core modüllerinin (orchestrator, coach, intelligence)
//    kullandığı TEK ORTAK context nesnesini üretmek.
//
//    • buildContext(overrides) → {
//        ttt, brick, product, period, dateRange,
//        filters, userPrefs, data: { ims, genel, migi, eczane },
//        learning, generatedAt
//      }
//
//  ÖNEMLİ — bu dosya buildTTTContext()'in (ai-context.js) YERİNİ ALMAZ.
//  buildTTTContext() hâlâ AI sohbet asistanı için METİN tabanlı prompt
//  üretir ve değiştirilmedi (geriye dönük uyumluluk). ai-context-builder.js
//  ise yapısal (object) context üretir — ai-orchestrator.js ve gelecekteki
//  tüketiciler için.
//
//  Kurallar:
//    • Eksik veri / global değişken durumunda HATA VERMEZ.
//    • Her alan için güvenli varsayılan değer kullanılır.
//    • DOM erişimi YOK.
//
//  Bağımlılık: js/data/data-state.js, js/core/date-utils.js,
//              js/core/constants.js (hepsi opsiyonel — typeof ile kontrol edilir)
//  Yükleme sırası: data-state.js, date-utils.js SONRASI
//                  ai-orchestrator.js, ai-core.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_CONTEXT_BUILDER_LOADED) {
    console.warn('[ai-context-builder] Zaten yüklü — atlandı');
    return;
  }
  window._AI_CONTEXT_BUILDER_LOADED = true;

  // ── _safe — global okuma sırasında hata yutan yardımcı ─────────────
  function _safe(fn, fallback) {
    try {
      var v = fn();
      return (v === undefined || v === null) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // ── _resolveTTT — context.ttt için olası kaynaklardan ilk geçerliyi al
  function _resolveTTT(overrides) {
    if (overrides && overrides.ttt) return overrides.ttt;
    return _safe(function () { return engineSelTTT; }, null) ||
           _safe(function () { return selAiTTT; }, null) ||
           _safe(function () { return selTTT; }, null) ||
           null;
  }

  // ── _resolvePeriod — bugünün tarihine göre aktif dönemi bulur ───────
  function _resolvePeriod() {
    var today = _safe(function () { return new Date().toISOString().slice(0, 10); }, null);
    var periods = _safe(function () { return PERIODS; }, []);
    var cur = (periods || []).find(function (p) { return today >= p.start && today <= p.end; });
    if (!cur) return { key: null, label: '—', start: null, end: null, remainingWorkDays: 0 };
    var remaining = _safe(function () { return workDays(today, cur.end); }, 0);
    return {
      key: cur.key,
      label: cur.label,
      start: cur.start,
      end: cur.end,
      remainingWorkDays: remaining
    };
  }

  // ── _resolveFilters — ekranlarda kullanılan ortak filtre state'i ───
  // Mevcut global filtre değişkenleri varsa enstantane (snapshot) olarak
  // okunur. Hiçbiri yoksa boş obje döner — hata vermez.
  function _resolveFilters(overrides) {
    var snapshot = {
      group:        _safe(function () { return selGroup; }, null),
      week:         _safe(function () { return selHafta; }, null),
      kutuUruns:    _safe(function () { return selKutuUruns; }, null),
      eczaneTTT:    _safe(function () { return selEczaneTTT; }, null),
      eczaneBrick:  _safe(function () { return selEczaneBrick; }, null),
      eczaneUrun:   _safe(function () { return selEczaneUrun; }, null),
      eczaneAy:     _safe(function () { return selEczaneAy; }, null)
    };
    return Object.assign(snapshot, (overrides && overrides.filters) || {});
  }

  // ── _resolveUserPrefs — kullanıcı tercihleri (varsa storage'dan) ───
  function _resolveUserPrefs() {
    return _safe(function () {
      if (typeof loadProxyUrl === 'function') {
        return { proxyConfigured: !!(window.AI_PROXY_URL) };
      }
      return {};
    }, {});
  }

  // ── _resolveLearning — Phase 4.2 AI Memory / öğrenme katmanı ────────
  // Gelecekte eklenecek learning bilgileri buraya bağlanır. Şu an için
  // mevcut ai-memory.js varsa snapshot alınır, yoksa boş obje döner.
  function _resolveLearning(ttt) {
    return _safe(function () {
      if (typeof buildMemoryContext === 'function' && ttt) {
        // buildMemoryContext metin döndürür (AI prompt'u için) — burada
        // yapısal context'e dahil etmiyoruz, sadece varlığını işaretliyoruz.
        return { available: true };
      }
      return { available: false };
    }, { available: false });
  }

  // ── buildContext — ana giriş noktası ────────────────────────────────
  // @param {Object} [overrides] — { ttt, brick, product, filters, dateRange }
  // @returns {Object} yapısal AI context'i
  function buildContext(overrides) {
    overrides = overrides || {};

    var ttt = _resolveTTT(overrides);

    var context = {
      ttt:     ttt,
      brick:   overrides.brick   || _safe(function () { return selEczaneBrick; }, null),
      product: overrides.product || _safe(function () { return selKutuUruns; }, null),

      period:    _resolvePeriod(),
      dateRange: overrides.dateRange || null,

      filters:   _resolveFilters(overrides),
      userPrefs: _resolveUserPrefs(),

      data: {
        ims:    _safe(function () { return IMS    || []; }, []),
        genel:  _safe(function () { return GENEL  || []; }, []),
        migi:   _safe(function () { return MIGI_BRICK_TL_RAW || []; }, []),
        eczane: _safe(function () {
          return (eczaneLoaded && ECZANE_RAW) ? ECZANE_RAW : [];
        }, [])
      },

      learning: _resolveLearning(ttt),

      generatedAt: new Date().toISOString()
    };

    return context;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AIContextBuilder = {
    buildContext: buildContext
  };

  console.debug('[ai-context-builder] FAZ 0 yüklendi.');

})();
