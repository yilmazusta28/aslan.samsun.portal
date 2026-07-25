// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/launch-readiness-engine.js
//  FAZ 6.4.5 — Lansman Hazırlık Modülü (İskelet)
//  FAZ 8.0  — Kırık referans düzeltmesi: dosya yoktu, oluşturuldu
//  FAZ 19.0 — TAM REVİZYON: satış verisi + rakip verisi BİRLİKTE
//             değerlendiriliyor, kırık alan-adı sözleşmesi düzeltildi
//
//  NEDEN REVİZE EDİLDİ:
//    1) Eski mantık bir pazarı SADECE IMS toplam satışı tam sıfırsa
//       "lansman öncesi" sayıyordu. FAMTREC artık aktif satan, gerçek
//       satış verisi olan bir lansman ürünü — eski mantıkla bu pazar
//       listOnLansmanPazarlar()'dan SESSİZCE düşer ve takip durur.
//    2) listOnLansmanPazarlar() aslında hiç ÇALIŞMIYORDU: IMSAdapter.
//       normalizeIMS() bir `ttt` PARAMETRESİ ister (yoksa boş dizi
//       döner) — eski kod bunu argümansız çağırıyordu, yani fonksiyon
//       HER ZAMAN [] döndürüyordu ve decision-engine.js'teki LAUNCH_PREP
//       dalı ölü koddu. Artık ALL_TTTS üzerinden gerçekten toplanıyor.
//    3) Çıktı alan adları decision-engine.js'in VE index.html'in
//       (renderLaunchReadinessCard) beklediği adlarla HİÇ eşleşmiyordu
//       (recommendation/competitorCount/strongestCompetitor üretiliyordu,
//       oneri/rakipSayisi/enAgresifRakip.firma/ortalamaIndirimPct
//       BEKLENİYORDU) — LAUNCH_PREP kartı hep "undefined" gösteriyordu.
//       Bu revizyonda tüketicilerin GERÇEKTEN okuduğu alan adları
//       kullanıldı (bkz. decision-engine.js:134-136, index.html
//       renderLaunchReadinessCard).
//
//  YENİ MANTIK:
//    a) LAUNCH_URUNLER — iş kararıyla "şu an lansman/ramp-up aşamasında"
//       sayılan ürünlerin AÇIK LİSTESİ (bugün: FAMTREC). Satış verisi
//       gelse de gelmese de bu liste sabit kalır; ürün olgunlaşınca
//       buradan elle çıkarılır.
//    b) Ek olarak IMS'de toplam satışı HÂLÂ tam sıfır olan ürünler de
//       otomatik yakalanır (config'e girmemiş yepyeni ürünler için
//       yedek/fallback — eski davranışın devamı, artık ÇALIŞAN hali).
//    c) getLaunchReadinessSummary(pazar) artık SADECE rakip verisine
//       değil kendi satış performansına da bakar: aktif hafta sayısı,
//       hedef karşılama %, haftalık trend. İkisi TEK hazırlık skoru +
//       TEK öneri metninde birleştirilir.
//
//  Public API (imzalar DEĞİŞMEDİ):
//    listOnLansmanPazarlar()            → string[] (ilac_grubu adı listesi)
//    getLaunchReadinessSummary(pazar)   → LaunchReadinessSummary
//
//  LaunchReadinessSummary:
//    { pazar, urun, aktifHaftaSayisi, hedefTL, satisTL, kalanTL,
//      hedefKarsilamaPct, satisTrendi, fazEtiketi,
//      rakipSayisi, enAgresifRakip:{firma,seviye}|null,
//      ortalamaIndirimPct, hazirlikSkoru, oneri }
//
//  decision-engine.js'in LAUNCH_PREP problemType'ı ve index.html'deki
//  renderLaunchReadinessCard() tarafından tüketilir (ikisi de opsiyonel
//  — motor/veri yoksa ilgili dal sessizce atlanır).
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._LAUNCH_READINESS_ENGINE_LOADED) {
    console.warn('[launch-readiness-engine] Zaten yüklü — atlandı');
    return;
  }
  window._LAUNCH_READINESS_ENGINE_LOADED = true;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // Bölge müdürü satırı — GENEL_TABLO.csv'de takım/bölge toplamları bu isim
  // altında tutulur (manager-panel-engine.js'deki MANAGER_NAME ile AYNI
  // literal — dosyalar arası paylaşılan bir global olmadığı için burada
  // da tekrarlanır, kod tabanındaki mevcut desen budur).
  var MANAGER_NAME = 'ŞENOL YILMAZ';

  // ── İş kararıyla "şu an lansman/ramp-up aşamasında" sayılan ürünler ──
  // NOT: Buraya elle eklenip çıkarılır — satış verisi gelmesi/gelmemesi
  // bu listeyi ETKİLEMEZ. Ürün olgunlaşıp normal takip akışına dönünce
  // buradan çıkarılması yeterlidir.
  var LAUNCH_URUNLER = ['FAMTREC'];

  // Hazırlık skoru ve öneri metni için isimli eşikler (magic number yok).
  var HEDEF_KARSILAMA_IYI_PCT   = 91; // CARPAN_TABLE prim eşiğiyle TUTARLI
  var HEDEF_KARSILAMA_ZAYIF_PCT = 50;
  var RAKIP_YOGUN_ESIK          = 3;  // rakip sayısı bunun üzerindeyse "yoğun pazar"
  var AKTIF_HAFTA_YENI_ESIK     = 3;  // bu haftadan az aktif hafta = "ilk haftalar"

  // ── OWN_DRUG_BY_GRP'tan ürün adına göre ilac_grubu (pazar) bulur ─────
  function _grpByUrun(urun) {
    var map = (typeof OWN_DRUG_BY_GRP !== 'undefined') ? OWN_DRUG_BY_GRP : {};
    var found = null;
    Object.keys(map).forEach(function (grp) {
      if (map[grp] && map[grp].urun === urun) found = grp;
    });
    return found;
  }

  // ── listOnLansmanPazarlar ─────────────────────────────────────────────
  //  (a) LAUNCH_URUNLER'de elle işaretlenenler + (b) IMS toplamı hâlâ tam
  //  sıfır olan ürünler (otomatik yedek yakalama), tekilleştirilip döner.
  function listOnLansmanPazarlar() {
    return _safe(function () {
      var result = [];

      // (a) Elle işaretlenmiş lansman ürünleri — satışı olsa da listede kalır
      LAUNCH_URUNLER.forEach(function (urun) {
        var grp = _grpByUrun(urun);
        if (grp && result.indexOf(grp) === -1) result.push(grp);
      });

      // (b) Otomatik yakalama — IMS'de toplam satışı tam sıfır olan pazarlar.
      // ESKİ HATA: normalizeIMS() argümansız çağrılıyordu ve HER ZAMAN []
      // dönüyordu; artık ALL_TTTS üzerinden gerçek toplam hesaplanıyor.
      if (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function') {
        var allTtts = _safe(function () { return ALL_TTTS || []; }, []);
        var pazarTotals = {};
        allTtts.forEach(function (ttt) {
          var recs = window.IMSAdapter.normalizeIMS(ttt) || [];
          recs.forEach(function (r) {
            var grp = _grpByUrun(r.product);
            if (!grp) return;
            pazarTotals[grp] = (pazarTotals[grp] || 0) + (r.total || 0);
          });
        });
        Object.keys(pazarTotals).forEach(function (grp) {
          if (pazarTotals[grp] === 0 && result.indexOf(grp) === -1) result.push(grp);
        });
      }

      return result;
    }, []);
  }

  // ── Kendi satış performansı (bölge/takım geneli) ─────────────────────
  function _buildSatisDurumu(urun) {
    var sg = _safe(function () {
      return (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === urun; });
    }, null);

    var hedefTL = (sg && sg.hedef_tl) || 0;
    var satisTL = (sg && sg.satis_tl) || 0;
    var kalanTL = (sg && sg.kalan_tl != null) ? sg.kalan_tl : (hedefTL - satisTL);
    var hedefKarsilamaPct = (sg && sg.tl_pct != null) ? sg.tl_pct
      : (hedefTL > 0 ? Math.round((satisTL / hedefTL) * 1000) / 10 : 0);

    return { hedefTL: hedefTL, satisTL: satisTL, kalanTL: kalanTL, hedefKarsilamaPct: hedefKarsilamaPct };
  }

  // ── Kendi haftalık IMS performansı (bölge geneli, tüm TTT'ler toplanır)
  function _buildHaftalikDurum(ownIlac) {
    if (!window.IMSAdapter || typeof window.IMSAdapter.normalizeIMS !== 'function') {
      return { aktifHaftaSayisi: 0, satisTrendi: 'stable' };
    }
    var allTtts = _safe(function () { return ALL_TTTS || []; }, []);
    var allRecs = [];
    allTtts.forEach(function (ttt) {
      var recs = window.IMSAdapter.normalizeIMS(ttt) || [];
      recs.forEach(function (r) { if (r.product === ownIlac) allRecs.push(r); });
    });
    if (!allRecs.length) return { aktifHaftaSayisi: 0, satisTrendi: 'stable' };

    var agg = window.IMSAdapter.aggregateRecords(allRecs);
    if (!agg) return { aktifHaftaSayisi: 0, satisTrendi: 'stable' };

    var weekVals = window.IMSAdapter.weekValuesArray(agg.weeks);
    return {
      aktifHaftaSayisi: window.IMSAdapter.activeWeekCount(weekVals),
      satisTrendi: (agg.calculated && agg.calculated.trend) || 'stable'
    };
  }

  // ── Rakip ortamı (mevcut mantık — alan adları tüketicilerle hizalandı)
  function _buildRakipDurumu(pazar) {
    var competitors = [];
    var veriVarMi = false;
    if (window.CompetitiveAdapter && typeof window.CompetitiveAdapter.normalizeCompetitive === 'function') {
      var compData = window.CompetitiveAdapter.normalizeCompetitive();
      var actions  = (compData && compData.competitorActions) || [];
      var owns     = (compData && compData.ownActions) || [];
      competitors  = actions.filter(function (a) { return a.ilacGrubu === pazar && !a.isOwn; });
      // Bu pazar için RAKIP_AKSİYON.csv'de HİÇ satır var mı (rakip VEYA
      // kendi İLKO satırı)? FAMTREC gibi henüz competitive-intelligence
      // takibine girmemiş pazarlarda ne rakip ne de İLKO satırı bulunur —
      // bu durumda "0 rakip aktif" (rakip yok, pazar temiz) demek YANLIŞ;
      // doğrusu "rakip verisi henüz toplanmadı" (bilinmiyor) demektir.
      var ownRowsBuPazar = owns.filter(function (a) { return a.ilacGrubu === pazar; });
      veriVarMi = (competitors.length > 0) || (ownRowsBuPazar.length > 0);
    }

    var getTier = (window.CompetitiveAdapter && window.CompetitiveAdapter.getMostGenerousTier) || function (tiers) { return (tiers && tiers[0]) || null; };
    var getPct  = (window.CompetitiveAdapter && window.CompetitiveAdapter.getIndirimPct) || function () { return 0; };

    var enAgresifRakip = null;
    var enYuksekPct = -1;
    var pctToplam = 0, pctSayisi = 0;

    competitors.forEach(function (a) {
      var tier = getTier(a.standart);
      if (!tier) return;
      var pct = getPct(tier);
      pctToplam += pct; pctSayisi++;
      if (pct > enYuksekPct) { enYuksekPct = pct; enAgresifRakip = { firma: a.firma, seviye: pct }; }
    });

    return {
      rakipSayisi: competitors.length,
      enAgresifRakip: enAgresifRakip,
      ortalamaIndirimPct: pctSayisi > 0 ? Math.round((pctToplam / pctSayisi) * 10) / 10 : null,
      veriVarMi: veriVarMi
    };
  }

  function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ── getLaunchReadinessSummary — pazar başına BİRLEŞİK hazırlık özeti ──
  function getLaunchReadinessSummary(pazar) {
    return _safe(function () {
      var meta = _safe(function () { return (typeof OWN_DRUG_BY_GRP !== 'undefined') ? OWN_DRUG_BY_GRP[pazar] : null; }, null);
      var urun    = meta ? meta.urun    : pazar;
      var ownIlac = meta ? meta.ownIlac : pazar;

      var satis   = _buildSatisDurumu(urun);
      var haftalik = _buildHaftalikDurum(ownIlac);
      var rakip   = _buildRakipDurumu(pazar);

      var fazEtiketi = haftalik.aktifHaftaSayisi === 0
        ? 'LANSMAN ÖNCESİ'
        : (haftalik.aktifHaftaSayisi < AKTIF_HAFTA_YENI_ESIK ? 'LANSMANIN İLK HAFTALARI' : 'RAMP-UP DEVAM EDİYOR');

      // Hazırlık skoru: %50 satış performansı + %40 rekabet ortamı + trend/haftalık bonus.
      // NOT: rakip verisi hiç toplanmamışsa (veriVarMi:false) 100 puan verip
      // "rekabetsiz pazar" izlenimi YARATMIYORUZ — nötr (50) puan veriyoruz,
      // çünkü "rakip yok" ile "rakip verisi yok" AYNI ŞEY DEĞİL.
      var satisSkoru   = _clamp(satis.hedefKarsilamaPct, 0, 100);
      var rekabetSkoru = rakip.veriVarMi ? _clamp(100 - rakip.rakipSayisi * 8, 0, 100) : 50;
      var trendBonus   = haftalik.satisTrendi === 'up' ? 8 : (haftalik.satisTrendi === 'down' ? -8 : 0);
      var yeniPazarCezasi = haftalik.aktifHaftaSayisi === 0 ? -10 : 0;
      var hazirlikSkoru = Math.round(_clamp(satisSkoru * 0.5 + rekabetSkoru * 0.4 + trendBonus + yeniPazarCezasi, 0, 100));

      // Öneri metni — satış + rakip sinyalleri TEK cümlede birleştirilir.
      var parts = [];
      parts.push(fazEtiketi.charAt(0) + fazEtiketi.slice(1).toLowerCase() + ' (' + haftalik.aktifHaftaSayisi + ' hafta aktif satış)');

      if (satis.hedefTL > 0) {
        if (satis.hedefKarsilamaPct >= HEDEF_KARSILAMA_IYI_PCT) {
          parts.push('hedef karşılama güçlü (%' + satis.hedefKarsilamaPct + ') — momentum korunmalı');
        } else if (satis.hedefKarsilamaPct < HEDEF_KARSILAMA_ZAYIF_PCT) {
          parts.push('hedefin belirgin altında (%' + satis.hedefKarsilamaPct + ') — saha desteği artırılmalı');
        } else {
          parts.push('hedef karşılama orta seviyede (%' + satis.hedefKarsilamaPct + ')');
        }
      }

      if (!rakip.veriVarMi) {
        parts.push('rakip şartları verisi henüz toplanmadı — bu pazar için rekabet gözlemi eksik, "rakip yok" anlamına gelmez');
      } else if (rakip.rakipSayisi > RAKIP_YOGUN_ESIK) {
        parts.push(rakip.rakipSayisi + ' rakip aktif, pazar yoğun' + (rakip.enAgresifRakip ? (' (en agresif: ' + rakip.enAgresifRakip.firma + ')') : '') + ' — farklılaştırıcı mesaj gerekli');
      } else if (rakip.rakipSayisi > 0) {
        parts.push(rakip.rakipSayisi + ' rakip izleniyor');
      } else {
        parts.push('aktif rakip hareketi görülmüyor');
      }

      if (haftalik.satisTrendi === 'down') parts.push('haftalık trend düşüşte — dikkat');
      else if (haftalik.satisTrendi === 'up') parts.push('haftalık trend yükselişte');

      return {
        pazar:  pazar,
        urun:   urun,
        fazEtiketi: fazEtiketi,

        aktifHaftaSayisi:  haftalik.aktifHaftaSayisi,
        satisTrendi:       haftalik.satisTrendi,
        hedefTL:           satis.hedefTL,
        satisTL:           satis.satisTL,
        kalanTL:           satis.kalanTL,
        hedefKarsilamaPct: satis.hedefKarsilamaPct,

        rakipSayisi:        rakip.rakipSayisi,
        rakipVeriVarMi:      rakip.veriVarMi,
        enAgresifRakip:      rakip.enAgresifRakip,
        ortalamaIndirimPct:  rakip.ortalamaIndirimPct,

        hazirlikSkoru: hazirlikSkoru,
        oneri:         parts.join('; ') + '.'
      };
    }, {
      pazar: pazar, urun: pazar, fazEtiketi: 'BİLİNMİYOR',
      aktifHaftaSayisi: 0, satisTrendi: 'stable',
      hedefTL: 0, satisTL: 0, kalanTL: 0, hedefKarsilamaPct: 0,
      rakipSayisi: 0, rakipVeriVarMi: false, enAgresifRakip: null, ortalamaIndirimPct: null,
      hazirlikSkoru: 50, oneri: 'Veri yetersiz.'
    });
  }

  window.LaunchReadinessEngine = {
    listOnLansmanPazarlar:     listOnLansmanPazarlar,
    getLaunchReadinessSummary: getLaunchReadinessSummary,
    version: '19.1-rakip-veri-yok-ayrimi'
  };

  console.debug('[launch-readiness-engine] FAZ 19.0 (satış+rakip birleşik) yüklendi.');

})();
