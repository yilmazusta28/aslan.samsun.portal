// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/forecast-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//  AI MİMARİ STABİLİZASYONU GÜNCELLEMESİ — artık js/ai/core/ims-adapter.js
//  kullanır, parser'a (IMS) DOĞRUDAN ERİŞMEZ.
//
//  Sorumluluk: Dönem sonu TL / kutu satış tahmini
//    • generateForecast(ttt) → { projectedTL, projectedBox, confidence, methodology }
//
//  ⚠️ ÖNEMLİ DÜZELTME NOTU 1 (bkz. AI_MIMARI_STABILIZASYON_RAPORU.md):
//    Bu dosya ÖNCEDEN r.hafta / r.own_kutu / r.own_tl alanlarını okuyordu —
//    GERÇEK parseIMSCSV() çıktısında bu alanlar HİÇBİR ZAMAN var olmadı.
//    Bu motor artık ims-adapter.js üzerinden GERÇEK h1..h9 haftalık hacim
//    verisini (× IMS_TL_MAP birim fiyatı) kullanıyor.
//
//  ⚠️ ÖNEMLİ DÜZELTME NOTU 2 (kullanıcı bildirimi — "PANOCER 2 haftada
//  260.868₺, dönem sonu tahmini de aynı"): İKİ AYRI KÖK NEDEN vardı:
//    a) _productForecasts() ürünü IMS ham etiketiyle (r.product) DEĞİL,
//       URUN_ORDER isimle karşılaştırıyordu. PANOCER/ACİDPASS'in ham IMS
//       etiketi ("PANOCER TOPLAM"/"ACIDPASS TOPLAM") isimden farklı olduğu
//       için o ürünlerin haftalık verisi HİÇ bulunamıyor, eklenen tahmin
//       her zaman 0 çıkıyordu → düzeltme: bkz. _ownIlacForUrun().
//    b) Kalan süre "remainingWeeks" olarak totalDays/5'ten türetilip ayrıca
//       IMS gecikmesi (dataLagWeeks) kadar bir daha düşürülüyordu — gecikme
//       ÇİFT SAYILIYOR, hafta↔gün çevrimi yuvarlama hatası taşıyordu.
//       Düzeltme: kalan süre artık doğrudan calculateRunRate()'in ZATEN
//       doğru hesapladığı rr.remainingDays (takvim/iş günü) kullanılarak
//       alınıyor; hız için de dönem başından bugüne kümülatif ortalama
//       yerine SADECE son gerçekten gelen ~14 günlük (en fazla 2 hafta)
//       IMS verisinin günlük ortalaması kullanılıyor (bkz. _recentDailyRate).
//
//  Yöntem: Son 14 günlük (≤2 hafta) gerçek IMS hızı × kalan gün sayısı,
//          mevcut satışa eklenir.
//
//  Bağımlılık:
//    js/ai/core/ims-adapter.js           (normalizeIMS, aggregateRecords, weekValuesArray)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate → remainingDays)
//    js/data/data-state.js               (GENEL, KUTU)
//    js/core/constants.js                (IMS_TL_MAP, URUN_ORDER, OWN_DRUG_BY_GRP)
//  Yükleme sırası: ims-adapter.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, KUTU, IMS_TL_MAP, URUN_ORDER, OWN_DRUG_BY_GRP, calculateRunRate */

(function () {
  'use strict';

  // ── _trimTrailingZeroWeeks — KRİTİK düzeltme ─────────────────────────
  // weekValuesArray() / aggregateRecords().weeks HER ZAMAN 9 elemanlı
  // bir dizi döner (w1..w9 sabit slot) — dönemin henüz YAŞANMAMIŞ
  // haftaları için bu slotlar 0 değeriyle doludur. Bu 0'ları "satış
  // sıfırdı" diye yorumlayıp _recentDailyRate() gibi hız hesaplarına
  // OLDUĞU GİBİ vermek, günlük hızı YAPAY OLARAK SIFIRA ÇEKER —
  // özellikle dönemin başındayken (örn. sadece
  // 5/9 hafta geçmişken) çarpıcı bir hata oluşturur. Bu fonksiyon,
  // haftalar SIRALI doldurulduğu (w1 önce, sonra w2, ...) gerçek CSV
  // semantiğine dayanarak, dizinin SONUNDAKİ ardışık sıfırları (henüz
  // gelmemiş haftalar) keser — sadece GERÇEKTEN YAŞANMIŞ haftalar
  // projeksiyon hesaplarına girer. (Eski hafta-map tabanlı kod bu
  // sorunu YAPISAL OLARAK yaşamıyordu çünkü map'te hiç var olmayan
  // hafta anahtarı yoktu; weekValuesArray()'in sabit-9-eleman sözleşmesi
  // bu garantiyi bozduğu için bu adım eklendi.)
  function _trimTrailingZeroWeeks(vals) {
    var arr = vals.slice();
    while (arr.length && arr[arr.length - 1] === 0) arr.pop();
    return arr;
  }

  // ── _weeklyBoxSeries — ttt'nin TÜM ürünleri için haftalık TOPLAM kutu
  //    hacmi serisi (ims-adapter.js üzerinden, gerçek h1..h9 toplamı,
  //    henüz yaşanmamış haftalar trim edilmiş).
  function _weeklyBoxSeries(ttt) {
    var records = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
      ? window.IMSAdapter.normalizeIMS(ttt) : [];
    var aggregate = (window.IMSAdapter && typeof window.IMSAdapter.aggregateRecords === 'function')
      ? window.IMSAdapter.aggregateRecords(records) : null;
    if (!aggregate) return [];
    return _trimTrailingZeroWeeks(window.IMSAdapter.weekValuesArray(aggregate.weeks));
  }

  // ── _weeklyTLSeries — haftalık TOPLAM TL serisi ──────────────────────
  // IMS'te gerçek bir TL alanı YOK (bkz. FAZ1.3 raporu) — her (brick,ürün)
  // kaydının GERÇEK haftalık kutu hacmi, O ÜRÜNÜN GERÇEK birim fiyatıyla
  // (IMS_TL_MAP) çarpılıp haftalık olarak toplanır. Bu, orijinal kodun
  // ZATEN öngördüğü "own_tl yoksa own_kutu × birim fiyat" fallback'inin
  // TEK GERÇEKTEN ÇALIŞAN yoludur (own_tl hiçbir zaman var olmadığından
  // o dal her zaman ölüydü). Henüz yaşanmamış haftalar trim edilmiştir.
  function _weeklyTLSeries(ttt) {
    var tlMap = (typeof IMS_TL_MAP !== 'undefined') ? IMS_TL_MAP : {};
    var records = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
      ? window.IMSAdapter.normalizeIMS(ttt) : [];
    if (!records.length) return [];

    var weekSums = { w1:0, w2:0, w3:0, w4:0, w5:0, w6:0, w7:0, w8:0, w9:0 };
    records.forEach(function (r) {
      var price = tlMap[r.product] || 0;
      Object.keys(weekSums).forEach(function (k) {
        weekSums[k] += (r.weeks[k] || 0) * price;
      });
    });
    var raw = window.IMSAdapter ? window.IMSAdapter.weekValuesArray(weekSums)
      : ['w1','w2','w3','w4','w5','w6','w7','w8','w9'].map(function(k){ return weekSums[k]; });
    return _trimTrailingZeroWeeks(raw);
  }

  // ── _ownIlacForUrun ─────────────────────────────────────────
  // KÖK NEDEN DÜZELTMESİ (kullanıcı bildirimi): IMSAdapter kayıtlarındaki
  // HAM ilaç etiketi (record.product = parseIMSCSV çıktısındaki row.ilac),
  // bazı ürünlerde URUN_ORDER'daki isimle BİREBİR AYNI DEĞİL:
  //   PANOCER  → ham etiket "PANOCER TOPLAM"
  //   ACİDPASS → ham etiket "ACIDPASS TOPLAM" (ayrıca düz I / noktalı İ farkı)
  //   MOKSEFEN / GRİPORT COLD / FAMTREC → ham etiket zaten birebir aynı
  // Eskiden _productForecasts() doğrudan `r.product === urun` karşılaştırıyordu;
  // PANOCER ve ACİDPASS için bu HİÇBİR ZAMAN eşleşmiyordu → o ürünlerin
  // productRecords'u HER ZAMAN boş kalıyor → wVals boş → eklenecek tahmin
  // her zaman 0 → "dönem sonu tahmini" == "mevcut satış" (bildirilen hata).
  // Artık OWN_DRUG_BY_GRP'teki gerçek eşleme kullanılıyor.
  function _ownIlacForUrun(urun) {
    var map = (typeof OWN_DRUG_BY_GRP !== 'undefined') ? OWN_DRUG_BY_GRP : {};
    for (var grp in map) {
      if (map[grp] && map[grp].urun === urun) return map[grp].ownIlac;
    }
    return urun; // eşleşme bulunamazsa (beklenmedik ürün) isim aynı kabul edilir
  }

  // ── _recentDailyRate ─────────────────────────────────────────
  // KULLANICI İSTEĞİ — basit/şeffaf yöntem: son GERÇEKTEN gelen IMS
  // haftalarının (en fazla son 2 tam hafta ≈ 14 gün — IMS, sistemde bir
  // hafta geriden geldiği için dönemin başından bugüne kümülatif ortalama
  // yerine SADECE en güncel gerçek veri kullanılır) toplamını, o kadar
  // günün (hafta sayısı × 7) gerçek gün sayısına bölerek günlük hız elde
  // eder. remainingDays ile çarpılınca dönem sonu tahmini ortaya çıkar.
  function _recentDailyRate(vals) {
    var recent = vals.slice(-2); // en fazla son 2 hafta (~14 gün)
    var days   = recent.length * 7;
    if (days <= 0) return 0;
    var total = recent.reduce(function (s, v) { return s + v; }, 0);
    return total / days;
  }

  // ── _productForecasts ─────────────────────────────────────
  // Ürün bazlı TL tahminleri. remainingDays: dönem sonuna kalan takvim/iş
  // günü (calculateRunRate() → rr.remainingDays; dönem sınırlarını ve
  // "veri hâlâ önceki döneme ait" durumunu zaten doğru şekilde hesaplıyor).
  function _productForecasts(ttt, remainingDays) {
    var urunOrder  = (typeof URUN_ORDER !== 'undefined') ? URUN_ORDER : [];
    var tlMap      = (typeof IMS_TL_MAP !== 'undefined') ? IMS_TL_MAP : {};
    var genelRows  = (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
    var imsRecords = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
      ? window.IMSAdapter.normalizeIMS(ttt) : [];

    return urunOrder.map(function (urun) {
      var gr = genelRows.find(function (r) { return r.urun === urun; });
      if (!gr) return { urun: urun, currentTL: 0, projectedTL: 0, hedefTL: 0, projectedReal: 0 };

      // Bu ürüne ait TÜM brick kayıtlarını (adapter üzerinden) topla —
      // ham etiket eşlemesi ile (bkz. _ownIlacForUrun yorumu).
      var ownIlac = _ownIlacForUrun(urun);
      var productRecords = imsRecords.filter(function (r) { return r.product === ownIlac; });
      var productAgg = (window.IMSAdapter && typeof window.IMSAdapter.aggregateRecords === 'function')
        ? window.IMSAdapter.aggregateRecords(productRecords) : null;
      var price = tlMap[urun] || 0;
      var wVals = productAgg
        ? _trimTrailingZeroWeeks(window.IMSAdapter.weekValuesArray(productAgg.weeks).map(function (boxQty) { return boxQty * price; }))
        : [];

      var currentTL = gr.satis_tl  || 0;
      var hedefTL   = gr.hedef_tl  || 0;
      var dailyRate = _recentDailyRate(wVals);
      var addedTL   = dailyRate * Math.max(0, remainingDays);
      var projTL    = currentTL + addedTL;
      var projReal  = hedefTL > 0 ? (projTL / hedefTL) * 100 : 0;

      return {
        urun:         urun,
        currentTL:    Math.round(currentTL),
        projectedTL:  Math.round(projTL),
        hedefTL:      Math.round(hedefTL),
        projectedReal: Math.round(projReal * 10) / 10
      };
    });
  }

  // ── generateForecast ─────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   projectedTL:      number,
  //   projectedBox:     number,
  //   projectedReal:    number,
  //   currentTL:        number,
  //   hedefTL:          number,
  //   confidence:       number,
  //   methodology:      string,
  //   productForecasts: Array,
  //   runRate:          object,
  //   insights:         string[]
  // }}
  function generateForecast(ttt) {
    var result = {
      projectedTL:      0,
      projectedBox:     0,
      projectedReal:    0,
      currentTL:        0,
      hedefTL:          0,
      confidence:       0,
      methodology:      'Veri yetersiz',
      productForecasts: [],
      runRate:          {},
      insights:         []
    };

    try {
      // ── Run rate hesapla ──────────────────────────────────
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { projectedMonthEnd: 0, dailyRunRate: 0, remainingDays: 0, confidence: 0 };
      result.runRate = rr;

      // ── GENEL veri ────────────────────────────────────────
      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var currentTL = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var hedefTL   = genelTotal ? (genelTotal.hedef_tl  || 0) : 0;
      result.currentTL = currentTL;
      result.hedefTL   = hedefTL;

      // ── Haftalık seriler ──────────────────────────────────
      var tlVals  = _weeklyTLSeries(ttt);
      var boxVals = _weeklyBoxSeries(ttt);
      var elapsedWeeks = boxVals.length; // sadece metodoloji metni için

      // ── KULLANICI DÜZELTMESİ — kalan gün + son 14 günlük IMS hızı ──────
      // ESKİ YÖNTEM (kaldırıldı): remainingWeeks'i totalDays/5 ile hesaplayıp
      // ayrıca dataLagWeeks kadar daha düşürüyordu — hem hafta↔gün çevrimi
      // yuvarlama hatası taşıyordu hem de gecikmeyi ÇİFT SAYIYORDU (IMS'in
      // zaten SADECE gerçekleşmiş haftaları içermesi + ayrıca lag düşmek).
      // Sonuç: remainingWeeks çoğu zaman gerçekte olması gerekenden düşük
      // çıkıyor, bazı ürünlerde (PANOCER/ACİDPASS, bkz. _ownIlacForUrun
      // yorumu) isim uyuşmazlığıyla birleşince tahmin==mevcut satış oluyordu.
      //
      // YENİ YÖNTEM: rr.remainingDays ZATEN doğru hesaplanıyor (calculateRunRate
      // dönem takvimini, "veri hâlâ önceki döneme ait mi" durumunu vs. dikkate
      // alıyor) — kalan hafta sayısını YENİDEN TÜRETMEK yerine doğrudan bu
      // değer kullanılır. Hız için de dönem başından bugüne kümülatif ortalama
      // değil, SADECE son gerçekten gelen ~14 günlük (en fazla 2 hafta) IMS
      // verisinin günlük ortalaması alınır (bkz. _recentDailyRate) — böylece
      // "sistem bir hafta geriden geliyor" gerçeği otomatik olarak yansır:
      // henüz gelmemiş haftalar zaten wVals'te YOK, ekstra bir lag düzeltmesi
      // gerekmez.
      var remainingDays = Math.max(0, rr.remainingDays || 0);

      var dailyTLRate = _recentDailyRate(tlVals);
      var addedTL     = dailyTLRate * remainingDays;
      var projectedTL = currentTL + addedTL;

      // ── Box: aynı yöntemle ────────────────────────────────
      var dailyBoxRate = _recentDailyRate(boxVals);
      var boxAdded     = dailyBoxRate * remainingDays;
      var projectedBox = Math.round((typeof KUTU !== 'undefined'
        ? (KUTU.filter(function(r){return r.ttt===ttt;}).reduce(function(s,r){return s+(r.cikan_kutu||0);},0))
        : 0) + boxAdded);

      // ── Realizasyon tahmini ──────────────────────────────
      var projReal = hedefTL > 0 ? (projectedTL / hedefTL) * 100 : 0;

      result.projectedTL   = Math.round(projectedTL);
      result.projectedBox  = Math.round(Math.max(0, projectedBox));
      result.projectedReal = Math.round(projReal * 10) / 10;
      result.confidence    = rr.confidence;
      result.methodology   = elapsedWeeks >= 2
        ? 'Son 14 günlük IMS hızı × kalan gün sayısı'
        : elapsedWeeks >= 1
          ? 'Son 7 günlük IMS hızı × kalan gün sayısı (tek hafta veri)'
          : 'Sadece run rate (haftalık IMS verisi yok)';

      // ── Ürün bazlı tahminler ──────────────────────────────
      result.productForecasts = _productForecasts(ttt, remainingDays);

      // ── Akıllı insight'lar ────────────────────────────────
      var insights = [];
      if (projReal >= 100) {
        insights.push('📈 Mevcut hız %100 hedefi aşmaya yetiyor.');
      } else if (projReal >= 91) {
        insights.push('✅ Run rate %91 prim eşiğini karşılıyor (tahmini %' + result.projectedReal + ').');
      } else if (projReal >= 75) {
        insights.push('⚠️ Mevcut hız %91 eşiğinin altında — kalan günlerde ivme gerekli (tahmini %' + result.projectedReal + ').');
      } else {
        insights.push('🔴 Mevcut run rate dönem sonunda %' + result.projectedReal + ' realizasyona işaret ediyor — acil aksiyon şart.');
      }

      result.productForecasts.forEach(function (pf) {
        if (pf.projectedReal >= 105) {
          insights.push('🏆 ' + pf.urun + ' planı aşacak (tahmin: %' + pf.projectedReal + ').');
        } else if (pf.projectedReal < 70) {
          insights.push('⚠️ ' + pf.urun + ' hedefin çok altında kalmaya devam edecek (tahmin: %' + pf.projectedReal + ').');
        }
      });

      result.insights = insights;

    } catch (e) {
      console.warn('[forecast-engine] generateForecast hata:', e.message);
      result.methodology = 'Hesaplama hatası: ' + e.message;
    }

    // PHASE 5.4: Forecast tahminini kaydet
    if (window.LearningEngine && result.projectedBox > 0) {
      window.LearningEngine.recordPrediction({
        type:'forecast', engine:'forecast', ttt:ttt,
        predictedQty:result.projectedBox, predictedTL:result.projectedTL,
        confidence:result.confidence||70,
        meta:{ methodology:result.methodology, projectedReal:result.projectedReal }
      });
    }
    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateForecast = generateForecast;
  console.debug('[forecast-engine] Phase 3.1 yüklendi (ims-adapter.js üzerinden).');

})();
