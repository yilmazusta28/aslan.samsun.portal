// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/team-forecast-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Ekip geneli forecast ve prim projeksiyonu
//    • buildTeamForecast([ttts]) → {
//        teamForecast, teamHedef, teamSatis, projectedTL,
//        projectedPrim, confidence, byTTT[]
//      }
//
//  Bağımlılık:
//    js/core/constants.js                (ALL_TTTS)
//    js/data/data-state.js               (GENEL)
//    js/core/prim-calc.js                (calcPrimForTTT, getCarpan)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, ALL_TTTS, calculateRunRate, calcPrimForTTT, getCarpan */

(function () {
  'use strict';

  // ── buildTeamForecast ─────────────────────────────────────
  // @param {string[]} [ttts]
  // @returns {{
  //   teamForecast:   number,   — ağırlıklı ortalama forecast %
  //   teamHedef:      number,   — toplam hedef TL
  //   teamSatis:      number,   — toplam mevcut satış TL
  //   projectedTL:    number,   — dönem sonu tahmini toplam TL
  //   projectedPrim:  number,   — toplam prim projeksiyonu
  //   confidence:     number,   — ortalama forecast güveni (0-100)
  //   repsAbove91:    number,   — %91 üzerinde forecast olanlar
  //   repsBelow91:    number,
  //   byTTT:          Array<{ ttt, realization, forecast, projectedTL, prim, confidence }>
  // }}
  function buildTeamForecast(ttts) {
    var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);

    var teamHedef    = 0;
    var teamSatis    = 0;
    var projectedTL  = 0;
    var projectedPrim = 0;
    var confSum      = 0;
    var confCount    = 0;
    var byTTT        = [];

    list.forEach(function (ttt) {
      var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return;

      var real     = gt.tl_pct   || 0;
      var hedef    = gt.hedef_tl || 0;
      var satis    = gt.satis_tl || 0;

      // Back-calculate hedef when missing (Phase 3.0.3 fix pattern)
      if (hedef === 0 && real > 0 && satis > 0) {
        hedef = Math.round(satis / (real / 100));
      }

      // ── FIX-TF-01 (BUG DÜZELTMESİ) ────────────────────────────────
      // Sorun: hedef_tl kaynak veride 0/eksik geldiğinde VE real (tl_pct)
      // de 0 olduğunda yukarıdaki geri-hesaplama çalışamıyor, hedef 0
      // kalıyor. Buna karşın run-rate motoru bu temsilci için satis_tl
      // üzerinden hâlâ pozitif bir projectedTL üretiyor (projeksiyon,
      // hedeften bağımsız hesaplanıyor). Sonuç: bu temsilcinin projeksiyonu
      // PAYA (projectedTL) ekleniyor ama PAYDAYA (teamHedef) hiç
      // eklenmiyor — ekip forecast oranı (projectedTL toplamı / teamHedef
      // toplamı) matematiksel olarak anlamsız şekilde şişiyor (örn. tek
      // bir eksik-hedef satırı yüzünden ekip forecast'i %1377 gibi
      // gerçekçi olmayan bir değere sıçrayabiliyor).
      // Düzeltme: geçerli bir hedef (>0) hesaplanamayan temsilciyi ekip
      // toplamlarından (teamHedef/teamSatis/projectedTL/confidence) HARİÇ
      // TUT — sadece byTTT listesinde "dataIssue" etiketiyle görünür kal,
      // böylece yönetici veri sorununu görebilir ama ekip oranını bozmaz.
      if (hedef <= 0) {
        byTTT.push({
          ttt:          ttt,
          realization:  Math.round(real * 10) / 10,
          forecast:     0,
          projectedTL:  0,
          prim:         0,
          confidence:   0,
          dataIssue:    'Hedef TL verisi eksik/0 — bu temsilci ekip forecast toplamına dahil edilmedi.'
        });
        console.warn('[team-forecast-engine] ' + ttt + ' için geçerli hedef_tl bulunamadı ' +
          '(hedef_tl=' + (gt.hedef_tl || 0) + ', tl_pct=' + real + ', satis_tl=' + satis + '). ' +
          'Ekip forecast toplamından hariç tutuldu (bkz. FIX-TF-01).');
        return; // teamHedef/teamSatis/projectedTL toplamlarına katılmaz
      }

      // Forecast via run-rate engine
      var forecast   = real;
      var projTL     = satis;
      var confidence = 30;
      try {
        if (typeof calculateRunRate === 'function') {
          var rr = calculateRunRate(ttt);
          if (rr) {
            forecast   = rr.projectedRealization || real;
            projTL     = rr.projectedMonthEnd    || satis;
            confidence = rr.confidence            || 30;
          }
        }
      } catch (e) { /* silent */ }

      // Prim projeksiyonu (forecast realizasyona göre)
      var prim = 0;
      try {
        if (typeof calcPrimForTTT === 'function') prim = calcPrimForTTT(ttt);
        // Eğer forecast daha yüksekse forward-looking prim hesapla
        if (typeof getCarpan === 'function' && forecast > real && forecast >= 91) {
          var carpanFC = getCarpan(forecast);
          prim = Math.round(carpanFC * 55000 * 1.2); // yaklaşık
        }
      } catch (e) { /* silent */ }

      teamHedef    += hedef;
      teamSatis    += satis;
      projectedTL  += projTL;
      projectedPrim += prim;
      confSum      += confidence;
      confCount++;

      byTTT.push({
        ttt:          ttt,
        realization:  Math.round(real * 10) / 10,
        forecast:     Math.round(forecast * 10) / 10,
        projectedTL:  Math.round(projTL),
        prim:         Math.round(prim),
        confidence:   confidence
      });
    });

    // Ekip geneli forecast % (toplam hedef üzerinden)
    var teamForecast = teamHedef > 0
      ? Math.round((projectedTL / teamHedef) * 1000) / 10
      : 0;

    var avgConf = confCount > 0 ? Math.round(confSum / confCount) : 0;

    // dataIssue satırları (geçerli hedefi olmayanlar) %91 sayımına dahil edilmez —
    // bunlar "düşük performans" değil, "veri eksik" durumudur.
    var validRows   = byTTT.filter(function (r) { return !r.dataIssue; });
    var repsAbove91 = validRows.filter(function (r) { return r.forecast >= 91; }).length;
    var repsBelow91 = validRows.length - repsAbove91;

    // Forecast sırasına göre sırala
    byTTT.sort(function (a, b) { return b.forecast - a.forecast; });

    return {
      teamForecast:  teamForecast,
      teamHedef:     teamHedef,
      teamSatis:     teamSatis,
      projectedTL:   projectedTL,
      projectedPrim: Math.round(projectedPrim),
      confidence:    avgConf,
      repsAbove91:   repsAbove91,
      repsBelow91:   repsBelow91,
      byTTT:         byTTT
    };
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildTeamForecast = buildTeamForecast;

  console.debug('[team-forecast-engine] Phase 4.0 yüklendi.');
})();
