// ══════════════════════════════════════════════════════════════════════
//  js/ai/coach/habit-engine.js
//  Phase 3.4 — AI Sales Coach
//
//  Sorumluluk: Veriye dayalı satış alışkanlıkları önerisi
//    • generateSalesHabits(ttt) → { daily[], weekly[], contextual[] }
//
//  Alışkanlıklar sabit listeler DEĞİLdir.
//  Her TTT'nin gerçek durumuna göre dinamik olarak üretilir:
//    - Prim eşiği riskindeyse → sabah kontrol alışkanlığı
//    - Güçlü brickler varsa   → ziyaret ritmi alışkanlığı
//    - Zayıf ürün varsa       → ürün odak alışkanlığı
//
//  Bağımlılık:
//    js/data/data-state.js               (GENEL, IMS)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/ai/territory/territory-engine.js (buildTerritoryStrategy)
//    js/ai/intelligence/risk-engine.js   (detectRisks)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, calculateRunRate, buildTerritoryStrategy, detectRisks */

(function () {
  'use strict';

  // ── generateSalesHabits ───────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   daily:       Array<{habit, why, frequency}>,
  //   weekly:      Array<{habit, why, day}>,
  //   contextual:  Array<{habit, why, trigger, urgency}>
  // }}
  function generateSalesHabits(ttt) {
    var result = { daily: [], weekly: [], contextual: [] };

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var realPct     = gt ? (gt.tl_pct || 0) : 0;
      var hedefTL     = gt ? (gt.hedef_tl  || 0) : 0;

      var rr          = (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : {};
      var remaining   = rr.remainingDays || 0;
      var dailyRate   = rr.dailyRunRate  || 0;

      var risks       = (typeof detectRisks === 'function') ? detectRisks(ttt) : [];
      var hasHighRisk = risks.some(function (r) { return r.severity === 'HIGH'; });

      var terr        = (typeof buildTerritoryStrategy === 'function')
        ? buildTerritoryStrategy(ttt) : {};
      var topBrick    = terr.topBricks && terr.topBricks[0] ? terr.topBricks[0].brick : null;
      var rescueBrick = terr.rescueBricks && terr.rescueBricks[0] ? terr.rescueBricks[0].brick : null;

      var urunRows    = (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var weakUruns   = urunRows.filter(function (r) { return (r.tl_pct || 0) < 80; })
        .sort(function (a, b) { return (a.tl_pct || 0) - (b.tl_pct || 0); });
      var weakUrun    = weakUruns[0] ? weakUruns[0].urun : null;

      // ────────────────────────────────────────────────────
      //  GÜNLÜK ALIŞKANLIKLAR
      // ────────────────────────────────────────────────────

      // Sabah kontrol — her durumda
      result.daily.push({
        habit:     'Her sabah hedef açığını kontrol et',
        why:       remaining > 0
          ? remaining + ' iş günü kaldı, günlük ₺' + dailyRate.toLocaleString('tr-TR') + ' hız takibi kritik.'
          : 'Dönem kapandı — bir sonraki dönem için hazırlık yap.',
        frequency: 'Her gün sabah'
      });

      // Prim eşiği riskiyse ekstra kontrol
      if (realPct < 91) {
        result.daily.push({
          habit:     '%91 prim eşiğini günlük takip et',
          why:       '%' + realPct.toFixed(1) + ' realizasyonla prim riski var. ' +
            'Günlük satış tablosunu güncelle.',
          frequency: 'Her gün sabah + akşam'
        });
      }

      // Zayıf ürün varsa günlük hatırlatma
      if (weakUrun) {
        result.daily.push({
          habit:     weakUrun + ' için hekim/eczane ziyareti yap',
          why:       weakUrun + ' %' + (weakUruns[0].tl_pct || 0).toFixed(1) +
            ' realizasyonda — her ziyarette bu ürüne özel mesaj ilet.',
          frequency: 'Her gün en az 1 eczane'
        });
      }

      // ────────────────────────────────────────────────────
      //  HAFTALIK ALIŞKANLIKLAR
      // ────────────────────────────────────────────────────

      // Öncelikli brick ziyareti
      if (topBrick) {
        result.weekly.push({
          habit: topBrick + ' brickini her hafta ziyaret et',
          why:   'En yüksek puanlı brick — düzenli ziyaret tempoya katkı sağlar.',
          day:   'Pazartesi (hafta başı tempo kur)'
        });
      }

      // Kurtarılması gereken brick
      if (rescueBrick) {
        result.weekly.push({
          habit: rescueBrick + ' RESCUE brickini bu hafta içinde ziyaret et',
          why:   'RESCUE sınıflandırması — uzun süre ziyaret edilmemiş, ivedi müdahale gerekiyor.',
          day:   'Salı veya Çarşamba'
        });
      }

      // Haftalık hedef gözden geçirme
      result.weekly.push({
        habit: 'Her Cuma haftalık satış özetini gözden geçir',
        why:   'Haftayı kapatmadan önce bir sonraki hafta planını yap ve açığı hesapla.',
        day:   'Cuma öğleden sonra'
      });

      // Eczane takip
      result.weekly.push({
        habit: 'Kilit eczanelere haftada 2 kez uğra',
        why:   'Düzenli ziyaret bağlılık ve satış sürekliliği sağlar.',
        day:   'Salı + Perşembe'
      });

      // IMS veri takibi
      var imsRows = (typeof IMS !== 'undefined' ? IMS : []).filter(function (r) { return r.ttt === ttt; });
      if (imsRows.length > 0) {
        result.weekly.push({
          habit: 'Haftalık IMS pazar payını kontrol et',
          why:   'Haftalık trendleri erken gör; rakip hareketine hızlı tepki ver.',
          day:   'Pazartesi (yeni hafta verisi yayınlandığında)'
        });
      }

      // ────────────────────────────────────────────────────
      //  BAĞLAMSAL (DURUMA ÖZEL) ALIŞKANLIKLAR
      // ────────────────────────────────────────────────────

      // Risk varsa
      if (hasHighRisk) {
        result.contextual.push({
          habit:   'Yüksek riskli ürünler için acil hekim görüşmesi planla',
          why:     'Yüksek risk sinyali tespit edildi. Sahada reçete kaybını durdurmak için hekim ziyaretini öne al.',
          trigger: 'Risk motoru YÜKSEK uyarısı verdiğinde',
          urgency: 'BUGÜN'
        });
      }

      // Dönem bitmeden 2 hafta kala
      if (remaining > 0 && remaining <= 10) {
        result.contextual.push({
          habit:   'Son 10 iş günü — günlük TL hedefini %20 artır',
          why:     'Sadece ' + remaining + ' iş günü kaldı. Kalan açık: ₺' +
            (hedefTL > 0 ? Math.max(0, hedefTL * (91/100) - (gt ? gt.satis_tl : 0)).toLocaleString('tr-TR') : '?'),
          trigger: 'Dönem sonuna 10 iş günü kaldığında',
          urgency: 'BUGÜN'
        });
      } else if (remaining > 0 && remaining <= 15) {
        result.contextual.push({
          habit:   'Sprint modu: bu haftadan itibaren günlük satış hedefini artır',
          why:     remaining + ' iş günü kaldı — prim eşiğini garantilemek için şimdi harekete geç.',
          trigger: 'Dönem sonuna 15 iş günü kaldığında',
          urgency: 'BU HAFTA'
        });
      }

      // Yeni dönem başında
      // BUG DÜZELTMESİ: eskiden 'remaining > 60' kontrol ediliyordu, ama
      // projedeki HİÇBİR dönem 60 iş gününü geçmiyor (tüm dönemler ~2 ay,
      // maksimum ~46 iş günü — bkz. js/core/date-utils.js PERIODS). Bu
      // yüzden bu alışkanlık ASLA tetiklenemiyordu. "Dönem başı" artık
      // doğru şekilde elapsedDays (dönemin kaç iş günü geçmiş) ile
      // tespit ediliyor — dönem uzunluğundan bağımsız çalışır.
      var elapsedDays = rr.elapsedDays || 0;
      if (elapsedDays > 0 && elapsedDays <= 5) {
        result.contextual.push({
          habit:   'Dönem başında tüm brickleri ziyaret et ve ilişkileri tazele',
          why:     'Dönem başı ziyareti tüm dönem boyunca pozitif satış zemini oluşturur.',
          trigger: 'Yeni dönem başladığında (ilk 5 iş günü)',
          urgency: 'BU HAFTA'
        });
      }

      // Fırsat brick varsa
      if (terr.opportunities && terr.opportunities.length) {
        result.contextual.push({
          habit:   terr.opportunities[0].brick + ' fırsat brickini bu hafta kapat',
          why:     'Yüksek pazar potansiyeli — rakip payı düşük, hızlı hareket et.',
          trigger: 'Fırsat brick listesinde bu brick göründüğünde',
          urgency: 'BU HAFTA'
        });
      }

    } catch (e) {
      console.warn('[habit-engine] generateSalesHabits hata:', e.message);
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateSalesHabits = generateSalesHabits;
  console.debug('[habit-engine] Phase 3.4 yüklendi.');

})();
