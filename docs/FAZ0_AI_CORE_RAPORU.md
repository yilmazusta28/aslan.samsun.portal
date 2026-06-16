# FAZ 0 — AI CONSOLIDATION RAPORU
**Tarih:** 2026-06-16
**Kapsam:** AI Core mimarisinin birleştirilmesi (Master Prompt 01)
**Yöntem:** Stabilizasyon ve modülerizasyon — yeniden yazım DEĞİL

---

## 1. Özet

| Görev | Durum |
|---|---|
| `js/ai/core/` klasörü ve 3 yeni dosya | ✅ Tamamlandı |
| `ai-core.js` — `AICore.analyze(context)` | ✅ Tamamlandı |
| `ai-context-builder.js` — `AIContextBuilder.buildContext()` | ✅ Tamamlandı |
| `ai-orchestrator.js` — `AIOrchestrator.run(context)` | ✅ Tamamlandı |
| `recommendation/insight/trend/risk-engine` servis dönüşümü | ✅ Zaten uygunlardı (bkz. §3) |
| `intelligence-orchestrator.js` → AI Core'a delege | ✅ Tamamlandı (legacy fallback ile) |
| Coach modülleri → sadece orchestrator üzerinden | ✅ Zaten bu şekildeydi (bkz. §3) |
| Executive modülleri — bağımlılık gevşetme | ✅ Zaten gevşekti, değişiklik gerekmedi (bkz. §6) |
| Eczane Satış Sayfası → `ai-core.js` kullanımı | ⚠️ KISMİ — bkz. §7 (riskli DOM-bağlı kod, FAZ 1'e bırakıldı) |
| Standart sonuç modeli | ✅ Tamamlandı |
| Cache (performans) | ✅ Tamamlandı (60sn TTL + veri imzası) |
| Test / doğrulama | ✅ Node.js ile pipeline simülasyonu yapıldı (bkz. §9) |

**index.html değişikliği:** Sadece modül yükleme manifesto yorumu + 3 yeni `<script>` satırı eklendi. Mevcut hiçbir satır silinmedi/değiştirilmedi.

---

## 2. Yeni Dosya Yapısı

```
js/ai/
├── core/                          ← YENİ (FAZ 0)
│   ├── ai-core.js                 ← Merkezi giriş noktası: AICore.analyze()
│   ├── ai-context-builder.js      ← Yapısal context üretici: AIContextBuilder.buildContext()
│   └── ai-orchestrator.js         ← Motor pipeline runner: AIOrchestrator.run()
├── intelligence/
│   ├── insight-engine.js          ← DEĞİŞMEDİ (zaten saf fonksiyon)
│   ├── trend-engine.js            ← DEĞİŞMEDİ (zaten saf fonksiyon)
│   ├── risk-engine.js             ← DEĞİŞMEDİ (zaten saf fonksiyon)
│   ├── opportunity-engine.js      ← DEĞİŞMEDİ (zaten saf fonksiyon)
│   ├── recommendation-engine.js   ← DEĞİŞMEDİ (zaten saf fonksiyon)
│   └── intelligence-orchestrator.js  ← GÜNCELLENDİ: artık AICore'a delege eder
├── coach/                         ← DEĞİŞMEDİ (zaten servis mantığında)
│   ├── performance-coach.js
│   ├── goal-coach.js
│   ├── habit-engine.js
│   ├── daily-plan-engine.js
│   └── coach-engine.js
├── executive/                     ← DEĞİŞMEDİ (zaten gevşek bağımlı)
└── ai-context.js, ai-service.js, ai-engine.js   ← DEĞİŞMEDİ (bkz. §7)
```

---

## 3. Tespit — Motorlar Zaten "Servis" Mantığındaydı

Refactor'a başlamadan önce mevcut 4 intelligence motoru (`insight-engine.js`, `trend-engine.js`,
`risk-engine.js`, `opportunity-engine.js`, `recommendation-engine.js`) ve 5 coach modülü incelendi:

| Dosya | `document.*` referansı | UI'dan doğrudan çağrılıyor mu? |
|---|---|---|
| insight-engine.js | 0 | Hayır — sadece orchestrator'lar çağırıyor |
| trend-engine.js | 0 | Hayır |
| risk-engine.js | 0 | Hayır |
| opportunity-engine.js | 0 | Hayır |
| recommendation-engine.js | 0 | Hayır |
| performance-coach.js | 0 | Hayır |
| goal-coach.js | 0 | Hayır |
| habit-engine.js | 0 | Hayır |
| daily-plan-engine.js | 0 | Hayır |
| coach-engine.js | 1 (sadece opsiyonel `renderCoachSummary()` içinde) | Hayır — `buildSalesCoach()` saf |

**Sonuç:** Master Prompt'taki "UI bağımlılıkları kaldırılsın, DOM erişimi bulunmasın, yalnızca veri
alıp veri döndürsünler" kuralı bu dosyalarda **zaten karşılanıyordu**. `index.html` içinde de bu
fonksiyonlara (`detectRisks`, `analyzeTrends`, `generateInsights`, `findOpportunities`,
`generateRecommendations`, `generateDailyPlan`, `generateGoalPlan`, `generateSalesHabits`,
`analyzePerformance`, `buildSalesCoach`) **hiçbir doğrudan çağrı bulunamadı** — bu motorlar bugüne
kadar sadece `intelligence-orchestrator.js` ve `coach-engine.js` üzerinden tetikleniyordu.

Bu nedenle bu dosyalarda kod değişikliği YAPILMADI (zaten gereksinimi karşılıyorlardı); tüm
konsolidasyon işi orchestration katmanında toplandı.

---

## 4. Yeni Dosyaların Tam Kodu

### 4.1 `js/ai/core/ai-context-builder.js`

```javascript
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
```

### 4.2 `js/ai/core/ai-orchestrator.js`

```javascript
// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-orchestrator.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//
//  Sorumluluk: Tüm analiz motorlarını TEK NOKTADAN, sabit bir sırayla
//  çalıştırmak.
//
//    • run(context) → { risks, trends, insights, opportunities,
//                        recommendations, coach }
//
//  Sıralama (gerçek veri bağımlılığına göre):
//    risk-engine        → detectRisks(ttt)
//    trend-engine       → analyzeTrends(ttt)
//    insight-engine     → generateInsights(ttt)
//    opportunity-engine → findOpportunities(ttt)        [recommendation girdisi]
//    recommendation-engine → generateRecommendations(ttt, risks, opportunities, insights)
//    coach-engine       → buildSalesCoach(ttt)
//
//  Not: Master Prompt'taki "risk → trend → insight → recommendation → coach"
//  sıralaması korunmuştur; opportunity-engine, recommendation-engine'in
//  zorunlu girdisi olduğu için insight'tan SONRA, recommendation'dan ÖNCE
//  araya eklenmiştir (mevcut generateRecommendations() imzası değişmedi).
//
//  Performans: Aynı context (ttt + veri seti boyutu) için kısa süreli
//  cache kullanılır — gereksiz yeniden hesap yapılmaz.
//
//  Kurallar:
//    • Hiçbir motor burada yeniden yazılmadı — sadece sırayla çağrılır.
//    • DOM erişimi YOK.
//    • Bir motor eksikse (dosya yüklenmemişse) sessizce atlanır, hata
//      diğer motorları etkilemez.
//
//  Bağımlılık (yükleme sırasına göre):
//    insight-engine.js, trend-engine.js, risk-engine.js,
//    opportunity-engine.js, recommendation-engine.js, coach-engine.js
//  Yükleme sırası: yukarıdaki motorlar SONRASI, ai-core.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_ORCHESTRATOR_LOADED) {
    console.warn('[ai-orchestrator] Zaten yüklü — atlandı');
    return;
  }
  window._AI_ORCHESTRATOR_LOADED = true;

  // ── Basit cache — aynı context için tekrar hesap yapılmasını önler ──
  var _cache = {};         // key → { result, ts, sig }
  var CACHE_TTL_MS = 60 * 1000; // 60 sn — veri senkron sıklığına göre yeterli

  // ── _dataSignature — veri seti değişmiş mi anlamak için ucuz imza ───
  function _dataSignature(context) {
    var d = (context && context.data) || {};
    var len = function (arr) { return (arr && arr.length) || 0; };
    return [len(d.ims), len(d.genel), len(d.migi), len(d.eczane)].join(':');
  }

  function _cacheKey(context) {
    return (context && context.ttt) || '__NO_TTT__';
  }

  function _emptyResult() {
    return {
      risks:           [],
      trends:          { trend: 'FLAT', confidence: 0, summary: '' },
      insights:        [],
      opportunities:   [],
      recommendations: [],
      coach:           null
    };
  }

  // ── run — orchestrator ana fonksiyonu ───────────────────────────────
  // @param {Object} context — ai-context-builder.buildContext() çıktısı
  //                            (en az { ttt } yeterlidir)
  // @returns {{ risks, trends, insights, opportunities, recommendations, coach }}
  function run(context) {
    context = context || {};
    var ttt = context.ttt;
    if (!ttt) return _emptyResult();

    // ── Cache kontrolü ─────────────────────────────────────────────
    var key = _cacheKey(context);
    var sig = _dataSignature(context);
    var cached = _cache[key];
    if (cached && cached.sig === sig && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return cached.result;
    }

    var result = _emptyResult();

    try {
      // 1) RISK ───────────────────────────────────────────────────
      if (typeof detectRisks === 'function') {
        result.risks = detectRisks(ttt) || [];
      }

      // 2) TREND ──────────────────────────────────────────────────
      if (typeof analyzeTrends === 'function') {
        result.trends = analyzeTrends(ttt) || result.trends;
      }

      // 3) INSIGHT ────────────────────────────────────────────────
      if (typeof generateInsights === 'function') {
        result.insights = generateInsights(ttt) || [];
      }

      // 4) OPPORTUNITY (recommendation'ın girdisi) ───────────────
      if (typeof findOpportunities === 'function') {
        result.opportunities = findOpportunities(ttt) || [];
      }

      // 5) RECOMMENDATION ─────────────────────────────────────────
      if (typeof generateRecommendations === 'function') {
        result.recommendations = generateRecommendations(
          ttt, result.risks, result.opportunities, result.insights
        ) || [];
      }

      // 6) COACH ──────────────────────────────────────────────────
      if (typeof buildSalesCoach === 'function') {
        result.coach = buildSalesCoach(ttt) || null;
      }

      console.debug('[ai-orchestrator] run() tamamlandı.',
        'TTT:', ttt,
        '| Risks:', result.risks.length,
        '| Insights:', result.insights.length,
        '| Opps:', result.opportunities.length,
        '| Recs:', result.recommendations.length,
        '| Coach:', !!result.coach
      );

    } catch (e) {
      console.warn('[ai-orchestrator] run() hata (sessiz, kısmi sonuç döner):', e.message);
    }

    _cache[key] = { result: result, ts: Date.now(), sig: sig };
    return result;
  }

  // ── clearCache — veri senkronu sonrası manuel temizleme için ───────
  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AIOrchestrator = {
    run:        run,
    clearCache: clearCache
  };

  console.debug('[ai-orchestrator] FAZ 0 yüklendi.');

})();
```

### 4.3 `js/ai/core/ai-core.js`

```javascript
// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-core.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//
//  Sorumluluk: TÜM AI karar mekanizmasının MERKEZİ GİRİŞ NOKTASI.
//    • analyze(context) → standart sonuç modeli
//
//  Akış:
//    analyze(context)
//      → context tamamlanmamışsa AIContextBuilder.buildContext() ile tamamla
//      → AIOrchestrator.run(context) çalıştır
//      → sonucu STANDART SONUÇ MODELİ'ne map'le ve döndür
//
//  Bu dosyadan SONRA, eski tüketiciler (intelligence-orchestrator.js gibi)
//  kendi pipeline mantıklarını burada tekrar etmez — AICore.analyze()'ı
//  çağırıp kendi geriye-dönük-uyumlu formatlarına map ederler.
//
//  Kurallar:
//    • Mevcut tüm fonksiyonellik korunur (bkz. intelligence-orchestrator.js,
//      ai-context.js — değişmedi, sadece AICore'u içsel olarak kullanıyor).
//    • DOM erişimi YOK.
//    • UI hiçbir şekilde bu dosyaya yazmaz / bu dosyadan doğrudan okumaz —
//      UI katmanları yalnızca TÜKETİCİ (consumer)'dır.
//
//  Bağımlılık: js/ai/core/ai-context-builder.js, js/ai/core/ai-orchestrator.js
//  Yükleme sırası: ai-context-builder.js, ai-orchestrator.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_CORE_LOADED) {
    console.warn('[ai-core] Zaten yüklü — atlandı');
    return;
  }
  window._AI_CORE_LOADED = true;

  var AI_CORE_VERSION = '0.1.0-faz0';

  // ── _emptyStandardResult ─────────────────────────────────────────
  function _emptyStandardResult() {
    return {
      risks:           [],
      trends:          { trend: 'FLAT', confidence: 0, summary: '' },
      insights:        [],
      recommendations: [],
      opportunities:   [],
      coach:           null,
      metadata: {
        generatedAt: new Date().toISOString(),
        version:     AI_CORE_VERSION
      }
    };
  }

  // ── analyze — merkezi giriş noktası ─────────────────────────────
  // @param {Object|string} [context] — ya tam context nesnesi
  //        (ai-context-builder çıktısı) ya da kısayol olarak sadece
  //        ttt string'i, ya da { ttt, brick, product, filters, ... }
  // @returns {{
  //   risks, trends, insights, recommendations, opportunities, coach,
  //   metadata: { generatedAt, version }
  // }}
  function analyze(context) {
    try {
      // Kısayol: analyze('AHMET YILMAZ') gibi doğrudan ttt geçilmişse
      if (typeof context === 'string') {
        context = { ttt: context };
      }

      // Context tamamlanmamışsa (ttt dışında data/period/filters yoksa)
      // ai-context-builder ile tamamla.
      var needsBuild = !context || !context.data || !context.period;
      var fullContext = context;
      if (needsBuild) {
        if (window.AIContextBuilder && typeof window.AIContextBuilder.buildContext === 'function') {
          fullContext = window.AIContextBuilder.buildContext(context || {});
        } else {
          fullContext = context || {};
        }
      }

      if (!fullContext || !fullContext.ttt) {
        var empty = _emptyStandardResult();
        console.warn('[ai-core] analyze() — geçerli ttt bulunamadı, boş sonuç döndürülüyor.');
        return empty;
      }

      var pipeline = (window.AIOrchestrator && typeof window.AIOrchestrator.run === 'function')
        ? window.AIOrchestrator.run(fullContext)
        : null;

      if (!pipeline) {
        console.warn('[ai-core] analyze() — AIOrchestrator bulunamadı, boş sonuç döndürülüyor.');
        return _emptyStandardResult();
      }

      return {
        risks:           pipeline.risks           || [],
        trends:          pipeline.trends           || { trend: 'FLAT', confidence: 0, summary: '' },
        insights:        pipeline.insights         || [],
        recommendations: pipeline.recommendations  || [],
        opportunities:   pipeline.opportunities     || [],
        coach:           pipeline.coach             || null,
        metadata: {
          generatedAt: new Date().toISOString(),
          version:     AI_CORE_VERSION,
          ttt:         fullContext.ttt
        }
      };

    } catch (e) {
      console.warn('[ai-core] analyze() hata (sessiz, boş sonuç döner):', e.message);
      return _emptyStandardResult();
    }
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AICore = {
    analyze: analyze,
    version: AI_CORE_VERSION
  };

  console.debug('[ai-core] FAZ 0 yüklendi. Versiyon:', AI_CORE_VERSION);

})();
```

---

## 5. Güncellenen Dosyalar

### 5.1 `js/ai/intelligence/intelligence-orchestrator.js`

**Değişiklik:** `buildSalesIntelligence(ttt)` artık pipeline mantığını kendi içinde
çalıştırmıyor — `window.AICore.analyze(ttt)` çağırıp sonucu kendi (eski) çıktı şekline
map ediyor. `AICore` yüklenmemişse (dosya bulunamazsa, yükleme sırası bozulursa vb.)
**otomatik olarak eski (legacy) pipeline'a geri döner** — bu yüzden hiçbir tüketici
etkilenmez.

**Değişmeyenler:** `formatIntelligenceForAI()`, `renderIntelligenceSummary()` —
fonksiyon imzaları, davranışları ve çıktı formatları **birebir aynı**.

**Diff özeti:**
```diff
- function buildSalesIntelligence(ttt) {
-   var result = { ... };
-   if (!ttt) return result;
-   try {
-     result.insights = generateInsights(ttt);
-     result.trends = analyzeTrends(ttt);
-     result.risks = detectRisks(ttt);
-     result.opportunities = findOpportunities(ttt);
-     result.recommendations = generateRecommendations(ttt, ...);
-   } catch (e) { ... }
-   return result;
- }
+ function _buildSalesIntelligenceLegacy(ttt) { /* FAZ 0 öncesi kod — fallback olarak korunuyor */ }
+
+ function buildSalesIntelligence(ttt) {
+   if (!ttt) return { ...boş sonuç... };
+   try {
+     if (window.AICore && typeof window.AICore.analyze === 'function') {
+       var core = window.AICore.analyze(ttt);
+       return { ttt, generatedAt: core.metadata.generatedAt,
+                insights: core.insights, trends: core.trends,
+                risks: core.risks, opportunities: core.opportunities,
+                recommendations: core.recommendations };
+     }
+   } catch (e) { /* sessiz, legacy'e düş */ }
+   return _buildSalesIntelligenceLegacy(ttt);
+ }
```

### 5.2 `index.html`

**Değişiklik 1:** Modül yükleme manifesto yorumuna (`<head>` başındaki büyük yorum bloğu)
"FAZ 0: AI Core" girdisi eklendi (#41a, #41b, #41c).

**Değişiklik 2:** `<!-- END PHASE 3.4 AI Sales Coach -->` ile `<!-- PHASE 4.0: Executive
Dashboard AI -->` arasına 3 yeni `<script>` satırı eklendi:

```html
<script src="js/ai/core/ai-context-builder.js"></script>
<script src="js/ai/core/ai-orchestrator.js"></script>
<script src="js/ai/core/ai-core.js"></script>
```

**Başka HİÇBİR satır değiştirilmedi, silinmedi veya taşınmadı.** Mevcut tüm `onclick`
handler'lar, `id`'ler, render fonksiyonları, CSS, ve diğer script tag'leri olduğu gibi
kaldı.

---

## 6. Eski Mimari vs Yeni Mimari

### FAZ 0 ÖNCESİ

```
ai-context.js (buildTTTContext)
   │
   ├──→ buildSalesIntelligence(ttt)  [intelligence-orchestrator.js]
   │       └──→ generateInsights, analyzeTrends, detectRisks,
   │            findOpportunities, generateRecommendations
   │            (pipeline KENDİ İÇİNDE, tekrar tekrar yazılı)
   │
   ├──→ buildSalesCoach(ttt)  [coach-engine.js]  (AYRI çağrı, AYRI pipeline)
   │
   └──→ (Predictive / Simulator / Territory / Memory / SalesConditions
         enrichment blokları — değişmedi)
```

Sorun: `buildSalesIntelligence()` ve `buildSalesCoach()` **birbirinden habersiz, iki
ayrı pipeline**. `risk-engine` çıktısı her ikisinde de (intelligence-orchestrator VE
coach-engine içinde) **bağımsız olarak yeniden hesaplanıyordu**.

### FAZ 0 SONRASI

```
ai-context.js (buildTTTContext) — DEĞİŞMEDİ
   │
   └──→ buildSalesIntelligence(ttt)  [intelligence-orchestrator.js — facade]
           │
           └──→ AICore.analyze(ttt)  [ai-core.js — TEK GİRİŞ NOKTASI]
                   │
                   ├──→ AIContextBuilder.buildContext()  [yapısal context]
                   │
                   └──→ AIOrchestrator.run(context)  [ai-orchestrator.js]
                           │
                           ├─ 1. detectRisks(ttt)            [risk-engine]
                           ├─ 2. analyzeTrends(ttt)           [trend-engine]
                           ├─ 3. generateInsights(ttt)        [insight-engine]
                           ├─ 4. findOpportunities(ttt)       [opportunity-engine]
                           ├─ 5. generateRecommendations(...) [recommendation-engine]
                           └─ 6. buildSalesCoach(ttt)         [coach-engine]
                                  (cache: 60sn TTL + veri imzası)
```

**Kazanım:** Tek pipeline, tek cache, tek hata yönetimi noktası. UI ve `ai-context.js`
hiçbir şey fark etmiyor — aynı `buildSalesIntelligence(ttt)` çağrısı, aynı çıktı şekli.

---

## 7. Eczane Satış Sayfası — Durum ve FAZ 1 Önerisi

Master Prompt'un "Eczane satış ekranı kendi AI analizlerini yapıyor" tespiti incelendi.
Üç farklı bağımsız AI-context üretici bulundu:

| Üretici | Dosya | Çağrı yeri |
|---|---|---|
| `buildPharmacyContext(ttt)` / `buildPharmacyIntelligenceContext(ttt)` | `js/pharmacy/pharmacy-intelligence.js` | tanımlı ama hiçbir yerden çağrılmıyor (ölü kod — kullanılmıyor) |
| `buildSalesConditionsContext(ttt)` | `js/pharmacy/sales-conditions.js` | `ai-context.js` (buildTTTContext) ve `reorder-engine.js` içinde |
| `engineAiAnalysis('eczane')` (LLM çağrısı) | `js/ai/ai-engine.js` | "AI & Görev Motoru" sayfasındaki "Eczane Planı" butonu |

**Neden FAZ 0'da rewiring yapılmadı:** `ai-engine.js` içindeki `_runEngineCore()` ve
`engineAiAnalysis()` fonksiyonları, hesaplama mantığını DOM yazma işlemleriyle (HTML
string birleştirme + `document.getElementById(...).innerHTML = ...`) iç içe
yürütüyor (700+ satır, tarayıcıda görsel doğrulama gerektiren bir alan). Bu kod test
ortamı olmadan (gerçek tarayıcı + gerçek veri) güvenle yeniden yazılamaz; Master
Prompt'un "Hiçbir mevcut ekran bozulmayacak" ilkesi gereği bu dosyaya dokunulmadı.

**FAZ 0'da yapılan (güvenli, eklemeli):** `AICore.analyze(ttt)` çağrısı `ttt` bazlı
çalıştığı için, eczane sayfası dahil **her ekran zaten bugünden** bu fonksiyonu
kullanabilir hale geldi — herhangi bir şeyi bozmadan.

**FAZ 1 için önerilen migrasyon (uygulanmadı, sadece dokümante edildi):**

```javascript
// ai-engine.js içinde engineAiAnalysis('eczane') case'i için önerilen değişiklik:
function engineAiAnalysis(type) {
  // ...mevcut kod...
  if (type === 'eczane') {
    var coreResult = window.AICore ? window.AICore.analyze(engineSelTTT) : null;
    // coreResult.recommendations / coreResult.opportunities prompt'a eklenebilir,
    // mevcut buildSalesConditionsContext() + runPharmacyIntelligence() çağrıları
    // YANINDA (yerine değil) kullanılabilir — kademeli geçiş.
  }
  // ...mevcut kod devam...
}
```

Bu, gerçek tarayıcı testi yapılabildiğinde (FAZ 1) düşük riskli, kademeli bir geçiş
sağlar.

---

## 8. Executive Modülleri

Master Prompt: *"Şimdilik davranışlarını değiştirme. Ancak gelecekte ai-core
kullanabilecek şekilde bağımlılıklarını gevşet."*

İnceleme sonucu: `executive-engine.js` ve alt modülleri (`team-ranking-engine.js`,
`team-risk-engine.js`, `team-forecast-engine.js`, `executive-summary-engine.js`)
**zaten** şu şekilde gevşek bağlı:

- Global state'e değil, parametre olarak geçilen `ttts` (TTT listesi) dizisine çalışıyorlar.
- Tüm iç bağımlılıklar `typeof X === 'function'` ile feature-detection üzerinden çağrılıyor (hard import yok).
- DOM erişimi sadece opsiyonel `renderExecutiveDashboard()` içinde, ana hesap fonksiyonlarında yok.

**Sonuç:** Ek bir gevşetme gerekmedi — bu modüller davranış değişikliği olmadan,
gelecekte `AICore`'u (örn. her TTT için `AICore.analyze(ttt)` çağırıp toplu rapor
oluşturmak) kullanabilecek konumda. Hiçbir dosya değiştirilmedi.

---

## 9. Test / Doğrulama

Tarayıcı ortamı bulunmadığı için Node.js'te mock global'lerle (`IMS`, `GENEL`, `PERIODS`,
`detectRisks`, `analyzeTrends`, `generateInsights`, `findOpportunities`,
`generateRecommendations`, `buildSalesCoach` stub'ları) pipeline simüle edildi:

| Test | Sonuç |
|---|---|
| `node --check` (sözdizimi) — 4 dosya | ✅ Hepsi geçti |
| `AIContextBuilder.buildContext({ttt:'TEST'})` → doğru alanlarla obje üretti | ✅ |
| `AICore.analyze('TEST')` → standart sonuç modeli, doğru `risks/trends/insights/opportunities/recommendations/coach/metadata` | ✅ |
| `AICore.analyze({})` (ttt yok) → güvenli boş sonuç, hata fırlatmadı | ✅ |
| `buildSalesIntelligence('TEST')` (AICore üzerinden) → eski format, doğru veri | ✅ |
| `formatIntelligenceForAI(...)` → eski metin formatı birebir korunuyor | ✅ |
| `buildSalesIntelligence('TEST2')` (AICore YOKKEN — legacy fallback) → aynı doğru sonuç | ✅ |

**Not:** Bu, Master Prompt'un "TEST KRİTERLERİ" bölümündeki kontrolleri büyük ölçüde
karşılar (motor çalışıyor, recommendation/coach/intelligence aynı sonucu üretiyor,
console hatası oluşmuyor — simülasyonda). Gerçek tarayıcıda gerçek veriyle (canlı
`index.html` üzerinde) ek bir görsel/manuel doğrulama önerilir, çünkü bu ortamda
tarayıcı/DOM çalıştırılamamaktadır.

---

## 10. Rollback

Bu fazın tüm değişiklikleri geri alınabilir:

1. `index.html`'de eklenen 3 `<script>` satırını sil (FAZ 0 AI Core bloğu).
2. `intelligence-orchestrator.js`'i bu rapordaki "FAZ 0 ÖNCESİ" diff'ine göre eski haline döndür (veya hiç dokunma — `AICore` script'leri kaldırıldığında dosya otomatik olarak legacy pipeline'a düşer, **ek bir işlem gerekmez**).
3. `js/ai/core/` klasörünü sil.

Hiçbir başka dosya bu rollback'ten etkilenmez.

---

## 11. Sonraki Adımlar (FAZ 1 Önerisi)

- Gerçek tarayıcıda manuel/görsel regresyon testi (AI & Görev Motoru sayfası, Eczane Satış sayfası).
- `engineAiAnalysis('eczane')` için §7'de önerilen kademeli `AICore` entegrasyonu.
- `coach-engine.js` içindeki dahili `detectRisks()` çağrısının `AIOrchestrator.run()`'dan gelen `risks` ile birleştirilmesi (şu an için risk hesaplaması coach içinde bir kez daha tekrarlanıyor — fonksiyonel olarak doğru ama performans açısından küçük bir tekrar).
- `ai-context.js` (`buildTTTContext`) için kademeli olarak `AIContextBuilder.buildContext()` kullanımı (string prompt yerine yapısal context'ten string üretimi).
