// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/competitor-conditions.js — FAZ 6.4
//  Rakip Satış Şartları Yöneticisi
//
//  Sorumluluk:
//    • RakipSartlariManager → competitive-adapter.js çıktısını localStorage'a
//      aktarır, sorgulanabilir hale getirir (sales-conditions.js'in
//      SatisKosullariManager'ının DOĞRUDAN KARDEŞİ — §9.1)
//
//  ⚠️ NEDEN BU DOSYA VAR (bkz. AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §9.1, §16):
//    js/pharmacy/sales-conditions.js (Phase 4.7) zaten {min,bonus} şemasıyla
//    kendi ürünlerimizin şartlarını localStorage'da CRUD yapıyordu
//    (VARSAYILAN_SARTLAR, SatisKosullariManager, STORAGE_KEY 'pv_satis_
//    sartlari_v1'). Bu dosya AYNI deseni, AYNI şemayı RAKİP firmalar için
//    uygular — sales-conditions.js DEĞİŞTİRİLMEDİ, sadece kardeş modül
//    eklendi. İki modülün ortak {min,bonus} şeması sayesinde ileride
//    "Bizim Şartımız vs Pazar Ortalaması vs En Agresif Rakip" karşılaştırması
//    tek bir bileşenle gösterilebilir (henüz yapılmadı — bu FAZ'ın kapsamı
//    dışında, sadece veri katmanı hazırlanıyor).
//
//  Public API:
//    importFromAdapter(competitorActions) → competitive-adapter.js çıktısını
//                                            localStorage'a yazar (üzerine yazar)
//    getSartlar(firma, urun)              → tek rakibin EN GÜNCEL ay şartı
//                                            (CompetitiveRecord | null)
//    getPazarSartlari(ilacGrubu, ay)      → bir pazardaki TÜM rakiplerin
//                                            o ayki şartı (dashboard için)
//    getTrend(firma, urun)                → 6 aylık {min,bonus} serisi →
//                                            { seri: CompetitiveRecord[],
//                                              ozet: 'TIRMANMA'|'GEVSEME'|'SABIT'|'KARISIK' }
//    getEnAgresifRakip(ilacGrubu, ay)     → en yüksek indirimPct'e sahip
//                                            rakip — risk motoruna girdi
//                                            (CompetitiveRecord | null)
//    clearAll()                           → localStorage temizle (test/reset)
//
//  Global bağımlılıklar:
//    localStorage (rakip şart kalıcılığı — sales-conditions.js ile AYNI desen)
//    competitive-adapter.js (içe aktarma kaynağı — importFromAdapter çağrılmadan
//      önce normalizeCompetitive() çalıştırılmış olmalı; bu dosya kendi
//      başına CSV/parser ÇAĞIRMAZ, sadece adapter'ın ÇIKTISINI alır)
//
//  Kurallar:
//    • sales-conditions.js DEĞİŞTİRİLMEDİ.
//    • competitive-adapter.js DEĞİŞTİRİLMEDİ — bu dosya onun ÇIKTISINI tüketir.
//    • İLKO'nun kendi şartları (CompetitiveRecord.isOwn===true) BU DOSYAYA
//      YAZILMAZ — importFromAdapter() SADECE rakip kayıtlarını
//      (isOwn===false) localStorage'a alır. SatisKosullariManager'a OTOMATİK,
//      SESSİZ ÜZERİNE YAZMA YAPILMAZ (§9.2 — kasıtlı tasarım kararı, veri
//      kaybı riski). Diff/uyarı mekanizması bu FAZ'ın kapsamı DIŞINDA
//      (ayrı, düşük öncelikli bir adım — §9.2 notu).
//    • DOM erişimi YOK (render fonksiyonu bu FAZ'da YOK — sales-conditions.js'in
//      render*Panel desenini taklit etmek SONRAKİ bir adım, henüz UI'a
//      bağlanmadı).
//
//  Yükleme sırası: sales-conditions.js'in HEMEN ARDINDAN (aynı katman,
//                  §9.1 notu), competitive-adapter.js SONRASI (opsiyonel —
//                  importFromAdapter() çağrı-zamanlı kullanılır, dosya
//                  yükleme sırası şart değil)
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard (sales-conditions.js ile AYNI desen) ──────────────────────
  if (window._RAKIP_SARTLARI_LOADED) {
    console.warn('[RakipSartlari] Zaten yüklü — atlandı');
    return;
  }

  var STORAGE_KEY = 'pv_rakip_sartlari_v1'; // 'pv_satis_sartlari_v1' ile AYNI isimlendirme konvansiyonu (§9.1)

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Yardımcı: indirimPct türetme (competitive-adapter.js ile AYNI
  //  formül — saklanan bir alan değil, ihtiyaç anında hesaplanır, §5.1)
  // ══════════════════════════════════════════════════════════════════
  function _indirimPct(tier) {
    if (!tier || (tier.min + tier.bonus) === 0) return 0;
    return Math.round((tier.bonus / (tier.min + tier.bonus)) * 1000) / 10;
  }

  function _mostGenerousTier(tiers) {
    if (!tiers || !tiers.length) return null;
    var best = tiers[0], bestPct = _indirimPct(tiers[0]);
    for (var i = 1; i < tiers.length; i++) {
      var pct = _indirimPct(tiers[i]);
      if (pct > bestPct) { best = tiers[i]; bestPct = pct; }
    }
    return best;
  }

  var AY_SIRASI = ['OCAK','ŞUBAT','MART','NİSAN','MAYIS','HAZİRAN'];
  function _ayIndex(ay) {
    var i = AY_SIRASI.indexOf(ay);
    return i === -1 ? 999 : i;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Rakip Şartları Yöneticisi
  // ══════════════════════════════════════════════════════════════════
  var RakipSartlariManager = {

    // competitive-adapter.js çıktısını localStorage'a yazar (üzerine yazar).
    // SADECE rakip kayıtları (isOwn:false) alınır — İLKO satırları
    // SatisKosullariManager'ın alanına müdahale ETMEZ (§9.2 kuralı).
    importFromAdapter: function (competitorActions) {
      try {
        var rakipler = (competitorActions || []).filter(function (r) { return r.isOwn === false; });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rakipler));
        console.log('[RakipSartlari] ✅', rakipler.length, 'rakip kaydı içe aktarıldı');
        return true;
      } catch (e) {
        console.error('[RakipSartlari] İçe aktarma hatası:', e);
        return false;
      }
    },

    // localStorage'dan tüm rakip kayıtlarını okur (yoksa boş dizi).
    _getAll: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    },

    // Tek bir rakibin EN GÜNCEL (son ay) şartını döner.
    // @param {string} firma
    // @param {string} urun
    // @returns {CompetitiveRecord|null}
    getSartlar: function (firma, urun) {
      var all = this._getAll().filter(function (r) { return r.firma === firma && r.urun === urun; });
      if (!all.length) return null;
      all.sort(function (a, b) { return _ayIndex(b.ay) - _ayIndex(a.ay); });
      return all[0];
    },

    // Bir pazardaki TÜM rakiplerin o ayki şartı (dashboard için).
    // @param {string} ilacGrubu — ALL_GROUPS değerlerinden biri
    // @param {string} [ay] — verilmezse her rakibin en güncel ayı kullanılır
    // @returns {Array<CompetitiveRecord>}
    getPazarSartlari: function (ilacGrubu, ay) {
      var all = this._getAll().filter(function (r) { return r.ilacGrubu === ilacGrubu; });
      if (ay) return all.filter(function (r) { return r.ay === ay; });

      // ay verilmemişse: her (firma,urun) için en güncel ayı seç
      var byKey = {};
      all.forEach(function (r) {
        var key = r.firma + '|' + r.urun;
        if (!byKey[key] || _ayIndex(r.ay) > _ayIndex(byKey[key].ay)) byKey[key] = r;
      });
      return Object.keys(byKey).map(function (k) { return byKey[k]; });
    },

    // 6 aylık {min,bonus} serisi → genel trend özeti.
    // @returns {{ seri: Array<CompetitiveRecord>, ozet: 'TIRMANMA'|'GEVSEME'|'SABIT'|'KARISIK' }}
    getTrend: function (firma, urun) {
      var seri = this._getAll()
        .filter(function (r) { return r.firma === firma && r.urun === urun; })
        .sort(function (a, b) { return _ayIndex(a.ay) - _ayIndex(b.ay); });

      if (!seri.length) return { seri: [], ozet: 'SABIT' };

      var degisimler = seri.map(function (r) { return r.degisimOncekiAya; })
        .filter(function (d) { return d === 'TIRMANMA' || d === 'GEVSEME'; });

      var ozet;
      if (!degisimler.length) {
        ozet = 'SABIT';
      } else {
        var hasTirmanma = degisimler.indexOf('TIRMANMA') !== -1;
        var hasGevseme = degisimler.indexOf('GEVSEME') !== -1;
        if (hasTirmanma && hasGevseme) ozet = 'KARISIK';
        else if (hasTirmanma) ozet = 'TIRMANMA';
        else ozet = 'GEVSEME';
      }

      return { seri: seri, ozet: ozet };
    },

    // En yüksek indirimPct'e sahip rakip — risk motoruna girdi olarak
    // tasarlandı (henüz hiçbir risk motoruna BAĞLANMADI — bu FAZ'ın kapsamı
    // dışında, competitive-impact-engine.js FAZ 6.6'nın işi).
    // @returns {CompetitiveRecord|null}
    getEnAgresifRakip: function (ilacGrubu, ay) {
      var pazar = this.getPazarSartlari(ilacGrubu, ay);
      if (!pazar.length) return null;

      var best = null, bestPct = -1;
      pazar.forEach(function (r) {
        var tier = _mostGenerousTier(r.standart) || (r.kampanya ? _mostGenerousTier(r.kampanya.tiers) : null);
        if (!tier) return;
        var pct = _indirimPct(tier);
        if (pct > bestPct) { bestPct = pct; best = r; }
      });
      return best;
    },

    // localStorage'ı temizler (test/reset amaçlı).
    clearAll: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
        return true;
      } catch (e) { return false; }
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  Global API Yayınla
  // ══════════════════════════════════════════════════════════════════
  window.RakipSartlariManager = RakipSartlariManager;
  window._RAKIP_SARTLARI_LOADED = true;

  console.log('[RakipSartlari] ✅ FAZ 6.4 yüklendi — rakip şart yönetimi');

})();
