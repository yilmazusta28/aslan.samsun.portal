// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/recommendation-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Risk ve fırsatları somut eyleme dönüştür
//    • generateRecommendations(ttt, risks, opportunities, insights)
//      → recommendation[]
//
//  DEĞİŞİKLİK: r.bizim_pay → YOK. Pazar payı risk.title üzerinden
//    IMS adapter cache'inden okunuyor.
//    IMS global'a doğrudan erişim YOK.
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL, ECZANE_RAW, eczaneLoaded */
/* global IMS_TL_MAP, PERIODS */
/* global workDays */

(function() {
  'use strict';

  // ── _todayStr ───────────────────────────────────────────────
  function _todayStr() {
    var d = new Date();
    var pad = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }

  // ── generateRecommendations ──────────────────────────────────
  // @param {string}   ttt
  // @param {Array}    risks          — detectRisks() çıktısı
  // @param {Array}    opportunities  — findOpportunities() çıktısı
  // @param {Array}    insights       — generateInsights() çıktısı
  // @returns {Array<{ priority: number, action: string, detail: string, urgency: 'NOW'|'THIS_WEEK'|'THIS_PERIOD' }>}
  function generateRecommendations(ttt, risks, opportunities, insights) {
    if (!ttt) return [];
    var recs = [];
    var priority = 1;

    try {
      var today   = _todayStr();
      var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
      var curPeriod = periods.find(function(p){ return today >= p.start && today <= p.end; });
      var remDays = curPeriod && typeof workDays === 'function' ? workDays(today, curPeriod.end) : 0;

      var genelTotal = (GENEL || []).find(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var genelRows  = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });

      // Brick pazar payı bilgisi (risk title içinden brick adı çıkarmak için)
      // eskiden: r.bizim_pay — IMS'te YOK; adapter cache üzerinden okunuyor.
      var imsCache = IMSAdapter.getIMSCache().filter(function(r){
        return r.representative === ttt;
      });

      // ── R1: HIGH risk → acil aksiyon ─────────────────────
      (risks || []).filter(function(r){ return r.severity === 'HIGH'; })
        .slice(0, 3)
        .forEach(function(risk) {
          var detail = risk.detail;
          // Pazar payı riski varsa adapter cache'inden düşük paylı brickler bulunur
          if (risk.title.indexOf('Pazar Payı') !== -1) {
            var lowShareBricks = imsCache.filter(function(r){
              return r.isOwn && r.total > 0;
            }).filter(function(r){
              return risk.title.indexOf(r.ilac_grubu) !== -1;
            }).slice(0, 2).map(function(r){ return r.brick; });

            if (lowShareBricks.length) {
              detail += ' En kritik: ' + lowShareBricks.join(', ') + '.';
            }
          }
          recs.push({ priority: priority++,
            action: risk.title + ' için acil ziyaret planı',
            detail: detail,
            urgency: 'NOW' });
        });

      // ── R2: Düşük realizasyon → günlük hedef hesabı ──────
      if (genelTotal && (genelTotal.tl_pct || 0) < 91) {
        var _csvKalan     = genelTotal.kalan_tl || 0;
        var _recomputed91 = Math.max(0, (genelTotal.hedef_tl || 0) * 0.91 - (genelTotal.satis_tl || 0));
        var kalanTL  = _csvKalan > 0 ? Math.min(_csvKalan, _recomputed91) : 0;
        var gunlukTL = (remDays > 0 && kalanTL > 0) ? Math.round(kalanTL / remDays) : 0;

        if (gunlukTL > 0) {
          var worstProd = genelRows.filter(function(r){ return (r.tl_pct||0) < 91; })
            .sort(function(a,b){ return (a.tl_pct||0) - (b.tl_pct||0); })[0];

          var kutuHedef = '';
          if (worstProd && IMS_TL_MAP && IMS_TL_MAP[worstProd.urun]) {
            var kutuSayi = Math.ceil(gunlukTL / IMS_TL_MAP[worstProd.urun]);
            kutuHedef = ' (' + worstProd.urun + ' için günlük ~' + kutuSayi + ' kutu)';
          }

          recs.push({ priority: priority++,
            action: 'Günlük ' + gunlukTL.toLocaleString('tr-TR') + '₺ satış hedefi' + kutuHedef,
            detail: '%91 için ' + remDays + ' iş günü kaldı. Kalan gap: ' +
              Math.round(kalanTL).toLocaleString('tr-TR') + '₺' +
              (worstProd ? ' — ' + worstProd.urun + ' öncelikli.' : '.'),
            urgency: remDays < 5 ? 'NOW' : 'THIS_WEEK' });
        }
      }

      // ── R3: Fırsatlar → somut ziyaret önerisi ─────────────
      (opportunities || []).slice(0, 3).forEach(function(opp) {
        var brickName = opp.title.split(' ')[0];
        var eczaneHint = '';

        if (typeof eczaneLoaded !== 'undefined' && eczaneLoaded && ECZANE_RAW) {
          var brickEczaneler = (ECZANE_RAW || []).filter(function(e){
            return e.ttt === ttt && e.brick && e.brick.indexOf(brickName) !== -1;
          }).slice(0, 3);
          if (brickEczaneler.length) {
            eczaneHint = ' Öncelikli eczaneler: ' + brickEczaneler.map(function(e){ return e.ad; }).join(', ') + '.';
          }
        }

        recs.push({ priority: priority++,
          action: opp.title + ' ziyareti',
          detail: opp.reason + ' ' + opp.detail + eczaneHint,
          urgency: opp.priority <= 2 ? 'THIS_WEEK' : 'THIS_PERIOD' });
      });

      // ── R4: Güçlü ürün → koruma stratejisi ──────────────
      var strongProds = genelRows.filter(function(r){ return (r.tl_pct||0) >= 95; });
      if (strongProds.length) {
        recs.push({ priority: priority++,
          action: strongProds.map(function(r){ return r.urun; }).join(', ') + ' için tempo koru',
          detail: 'Bu ürünlerde %' + Math.min.apply(null, strongProds.map(function(r){ return r.tl_pct||0; })).toFixed(1) +
            ' üzeri realizasyon mevcut — portföy primini destekliyor. Düşüşe izin verme.',
          urgency: 'THIS_PERIOD' });
      }

      // ── R5: MI&GI düzeltme önerisi ───────────────────────
      var mgRisk = (risks || []).find(function(r){ return r.title.indexOf('Brick MI') !== -1; });
      if (mgRisk) {
        recs.push({ priority: priority++,
          action: 'MI&GI iyileştirme — kritik brick ziyareti',
          detail: mgRisk.detail + ' MI prim matrisini iyileştirmek için bu bricklerdeki hekim ziyaretlerini yoğunlaştır.',
          urgency: 'THIS_WEEK' });
      }

      var urgencyOrder = { NOW: 0, THIS_WEEK: 1, THIS_PERIOD: 2 };
      recs.sort(function(a,b){
        var uDiff = (urgencyOrder[a.urgency]||1) - (urgencyOrder[b.urgency]||1);
        return uDiff !== 0 ? uDiff : a.priority - b.priority;
      });

      recs.forEach(function(r, i){ r.priority = i + 1; });

    } catch (e) {
      console.warn('[recommendation-engine] generateRecommendations hata:', e.message);
    }

    return recs;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.generateRecommendations = generateRecommendations;
  console.debug('[recommendation-engine] Phase 3.0 + Phase 1 Refactor yüklendi.');

})();
