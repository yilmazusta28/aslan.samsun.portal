// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/competitive-outcome-linker.js
//  FAZ 10.4 — Rakip Intelligence ↔ Outcome İlişkilendirme
//
//  Sorumluluk:
//    competitive-adapter.js (CSV-bazlı kampanya verisi) ile
//    outcome-tracker.js (öneri sonuçları) arasındaki köprü.
//    "Bu rakip kampanyası döneminde gerçek satış etkisi neydi?"
//    sorusuna yanıt verir ve sonucu PatternLearningEngine'e besler.
//
//    competitive-impact-engine.js (IMS-bazlı pazar payı analizi) ile
//    FARKLI bir görev: o motor "rakip mi etkili oldu?" (istatistiksel
//    tespit), bu modül "rakip kampanyası sırasında outcome ne oldu?"
//    (gözlemsel bağlantı).
//
//  Public API:
//    linkCampaignToOutcomes(campaign) → Promise<CampaignOutcomeLink>
//    buildAllCampaignLinks(tttFilter?) → Promise<CampaignOutcomeLink[]>
//
//  CampaignOutcomeLink şeması:
//    { campaign: {firma, ilacGrubu, kampanya, baslangic?},
//      outcomes: [],         // kampanya sırasındaki/sonrasındaki outcome'lar
//      successCount: number, // başarılı (success/partial) sonuç sayısı
//      failCount:    number,
//      impactScore:  number, // 0-100: başarı oranı × outcome sayısı bileşimi
//      note:         string  // insan-okur özet
//    }
//
//  learning-engine.js (PatternLearningEngine) entegrasyonu:
//    buildAllCampaignLinks() çağrısı sonunda her link için
//    PatternLearningEngine.updateLearningPatterns() çağrılır — mevcut
//    Pattern öğrenme mekanizması DEĞİŞTİRİLMEDİ, sadece yeni girdi.
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._COMPETITIVE_OUTCOME_LINKER_LOADED) {
    console.warn('[competitive-outcome-linker] Zaten yüklü — atlandı');
    return;
  }
  window._COMPETITIVE_OUTCOME_LINKER_LOADED = true;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; } catch (e) { return fallback; }
  }

  // Ay string → ISO tarih başlangıcı ("2026-05" → "2026-05-01")
  function _ayToDateStr(ay) {
    if (!ay) return null;
    // Olası format: "OCAK-2026", "2026-01", "Ocak 2026"
    var m = ay.match(/(\d{4})[-\/](\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-01';
    // TR ay adı formatı
    var TR_MONTHS = { 'OCAK':1,'ŞUBAT':2,'MART':3,'NİSAN':4,'MAYIS':5,'HAZİRAN':6,
                      'TEMMUZ':7,'AĞUSTOS':8,'EYLÜL':9,'EKİM':10,'KASIM':11,'ARALIK':12 };
    var parts = ay.toUpperCase().replace(/[-\/\s]+/g, '-').split('-');
    for (var i = 0; i < parts.length; i++) {
      if (TR_MONTHS[parts[i]]) {
        var year = parts.find(function (p) { return /^\d{4}$/.test(p); });
        return (year || new Date().getFullYear()) + '-' + String(TR_MONTHS[parts[i]]).padStart(2, '0') + '-01';
      }
    }
    return null;
  }

  // ── linkCampaignToOutcomes ───────────────────────────────────────────
  function linkCampaignToOutcomes(campaign) {
    if (!campaign) return Promise.resolve(null);
    if (!window.OutcomeTracker || typeof window.OutcomeTracker.getOutcomes !== 'function') {
      return Promise.resolve({ campaign: campaign, outcomes: [], successCount: 0, failCount: 0, impactScore: 0, note: 'OutcomeTracker mevcut değil' });
    }

    var campaignStartDate = _ayToDateStr(campaign.baslangic);

    return window.OutcomeTracker.getOutcomes().then(function (allOutcomes) {
      // Kampanya başlangıç tarihinden SONRA değerlendirilen outcome'lar
      var relevant = allOutcomes.filter(function (o) {
        // İlgili ürün veya brick ile eşleşen
        var productMatch = !campaign.ilacGrubu ||
          (o.product && o.product.toUpperCase().indexOf((campaign.ilacGrubu || '').toUpperCase()) >= 0) ||
          (o.brick && o.brick.toUpperCase().indexOf((campaign.ilacGrubu || '').toUpperCase()) >= 0);

        // Kampanya başlangıcından SONRA değerlendirilmiş
        var dateMatch = !campaignStartDate ||
          (o.evaluatedAt && o.evaluatedAt >= campaignStartDate) ||
          (o.recommendedAt && o.recommendedAt >= campaignStartDate);

        return productMatch && dateMatch;
      });

      var successCount = relevant.filter(function (o) {
        return o.status === 'success' || o.status === 'partial';
      }).length;
      var failCount = relevant.filter(function (o) {
        return o.status === 'failure' || o.status === 'not_evaluable';
      }).length;
      var total = successCount + failCount;

      // Impact score: başarı oranı × log(outcome sayısı+1) normalize
      var successRate = total > 0 ? successCount / total : 0;
      var impactScore = total > 0
        ? Math.min(100, Math.round(successRate * 70 + Math.log(total + 1) / Math.log(10) * 30))
        : 0;

      var note = total === 0
        ? campaign.firma + ' kampanyası döneminde ilgili outcome kaydı bulunamadı.'
        : campaign.firma + ' kampanyası: ' + total + ' outcome, ' +
          successCount + ' başarılı, ' + failCount + ' başarısız. ' +
          'Etki skoru: ' + impactScore + '/100.';

      return {
        campaign:     campaign,
        outcomes:     relevant,
        successCount: successCount,
        failCount:    failCount,
        impactScore:  impactScore,
        note:         note
      };
    });
  }

  // ── buildAllCampaignLinks — tüm rakip kampanyaları için link ─────────
  function buildAllCampaignLinks(tttFilter) {
    var campaigns = _safe(function () {
      if (!window.CompetitiveAdapter || typeof window.CompetitiveAdapter.normalizeCompetitive !== 'function') return [];
      var data = window.CompetitiveAdapter.normalizeCompetitive();
      return (data && data.competitorActions) || [];
    }, []);

    // Sadece rakip kampanyaları (isOwn:false ve kampanya var)
    var rakipKampanyalar = campaigns.filter(function (a) { return !a.isOwn && a.kampanya; });

    if (!rakipKampanyalar.length) return Promise.resolve([]);

    return Promise.all(rakipKampanyalar.map(linkCampaignToOutcomes)).then(function (links) {
      // PatternLearningEngine'e besle
      links.forEach(function (link) {
        if (!link || !link.outcomes.length) return;
        _safe(function () {
          if (!window.PatternLearningEngine || typeof window.PatternLearningEngine.updateLearningPatterns !== 'function') return;
          // Her outcome'a competitiveContext ekle ve PatternLearning'e gönder
          link.outcomes.forEach(function (o) {
            var enriched = Object.assign({}, o, {
              competitiveContext: {
                firma:       link.campaign.firma,
                ilacGrubu:   link.campaign.ilacGrubu,
                impactScore: link.impactScore
              }
            });
            window.PatternLearningEngine.updateLearningPatterns(enriched).catch(function () {});
          });
        });
      });
      return links;
    });
  }

  window.CompetitiveOutcomeLinker = {
    linkCampaignToOutcomes:  linkCampaignToOutcomes,
    buildAllCampaignLinks:   buildAllCampaignLinks,
    version:                 '10.4'
  };

  console.debug('[competitive-outcome-linker] FAZ 10.4 yüklendi.');

})();
