// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/sales-conditions.js — PHASE 4.7
//  Satış Şartları & Haber Takibi Modülü
//
//  Sorumluluk:
//    • SATIS_SARTLARI            → ürün bazlı standart + kampanya şartları
//    • SatisKosullariManager     → localStorage CRUD, şart yönetimi
//    • HaberTakibiManager        → fiyat artışı / piyasa haberleri CRUD
//    • getSiparisOnerisi(urun,avg,context) → şarta uygun optimal kutu önerisi
//    • renderSatisKosullariPanel(id) → satış şartı yönetim paneli
//    • renderHaberTakibiPanel(id)   → haber takibi yönetim paneli
//    • buildSalesConditionsContext() → AI context metni
//
//  Global bağımlılıklar:
//    localStorage (şart ve haber kalıcılığı)
//
//  Yükleme sırası: constants.js SONRASI, reorder-engine.js ÖNCE
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────
  if (window._SATIS_KOSULLARI_LOADED) {
    console.warn('[SatisKosullari] Zaten yüklü — atlandı');
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  //  1. VERİTABANI: Standart Satış Şartları
  //     Her ürün: { standart: [ {min, bonus} ], kampanya: [ {min, bonus} ] }
  //     Satış şartı: "10+1" → min:10 alım için +1 bonus kutu
  // ══════════════════════════════════════════════════════════════════
  var VARSAYILAN_SARTLAR = {
    'ACİDPASS': {
      standart: [
        { min: 10,  bonus: 1  },
        { min: 20,  bonus: 3  },
        { min: 50,  bonus: 10 }
      ],
      kampanya: [
        { min: 50,  bonus: 15 },
        { min: 100, bonus: 35 },
        { min: 150, bonus: 60 }
      ]
    },
    'PANOCER': {
      standart: [
        { min: 10,  bonus: 3   },
        { min: 30,  bonus: 12  },
        { min: 50,  bonus: 25  },
        { min: 100, bonus: 60  }
      ],
      kampanya: [
        { min: 165, bonus: 135 }
      ]
    },
    'GRİPORT COLD': {
      standart: [
        { min: 6,  bonus: 1  },
        { min: 12, bonus: 4  },
        { min: 30, bonus: 15 }
      ],
      kampanya: [
        { min: 60, bonus: 40 }
      ]
    },
    'MOKSEFEN': {
      standart: [
        { min: 5,  bonus: 1 },
        { min: 10, bonus: 3 }
      ],
      kampanya: [
        { min: 20, bonus: 10 }
      ]
    },
    'FAMTREC': {
      standart: [],
      kampanya: []
    }
  };

  var STORAGE_KEY_SARTLAR = 'pv_satis_sartlari_v1';
  var STORAGE_KEY_HABERLER = 'pv_haber_takibi_v1';
  var STORAGE_KEY_KAMPANYA_MODE = 'pv_kampanya_mode_v1';

  // ══════════════════════════════════════════════════════════════════
  //  2. Satış Şartları Yöneticisi
  // ══════════════════════════════════════════════════════════════════
  var SatisKosullariManager = {

    // localStorage'dan yükle, yoksa varsayılanı kullan
    getSartlar: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY_SARTLAR);
        if (raw) {
          var parsed = JSON.parse(raw);
          // Eksik ürünleri varsayılan ile tamamla
          Object.keys(VARSAYILAN_SARTLAR).forEach(function (urun) {
            if (!parsed[urun]) parsed[urun] = VARSAYILAN_SARTLAR[urun];
          });
          return parsed;
        }
      } catch (e) { /* silent */ }
      return JSON.parse(JSON.stringify(VARSAYILAN_SARTLAR)); // deep copy
    },

    // Kaydet
    setSartlar: function (sartlar) {
      try {
        localStorage.setItem(STORAGE_KEY_SARTLAR, JSON.stringify(sartlar));
        window.SATIS_SARTLARI = sartlar;
        console.log('[SatisKosullari] ✅ Şartlar kaydedildi');
        return true;
      } catch (e) {
        console.error('[SatisKosullari] Kayıt hatası:', e);
        return false;
      }
    },

    // Tek ürün şartını güncelle
    updateUrunSart: function (urun, tip, satirlar) {
      // satirlar: [{min: 10, bonus: 1}, ...]
      var sartlar = this.getSartlar();
      if (!sartlar[urun]) sartlar[urun] = { standart: [], kampanya: [] };
      sartlar[urun][tip] = satirlar;
      return this.setSartlar(sartlar);
    },

    // Kampanya modu aktif mi?
    isKampanyaModu: function (urun) {
      try {
        var modes = JSON.parse(localStorage.getItem(STORAGE_KEY_KAMPANYA_MODE) || '{}');
        return !!modes[urun];
      } catch (e) { return false; }
    },

    setKampanyaModu: function (urun, aktif) {
      try {
        var modes = JSON.parse(localStorage.getItem(STORAGE_KEY_KAMPANYA_MODE) || '{}');
        modes[urun] = aktif;
        localStorage.setItem(STORAGE_KEY_KAMPANYA_MODE, JSON.stringify(modes));
        return true;
      } catch (e) { return false; }
    },

    // Şartları sıfırla
    resetToDefault: function () {
      return this.setSartlar(JSON.parse(JSON.stringify(VARSAYILAN_SARTLAR)));
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  3. Haber Takibi Yöneticisi
  // ══════════════════════════════════════════════════════════════════
  var HaberTakibiManager = {

    getHaberler: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY_HABERLER);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    },

    addHaber: function (haber) {
      // haber: { baslik, tur, etki, tarih, aciklama }
      var haberler = this.getHaberler();
      haber.id     = Date.now();
      haber.tarih  = haber.tarih || new Date().toISOString().slice(0, 10);
      haber.aktif  = true;
      haberler.unshift(haber);
      try {
        localStorage.setItem(STORAGE_KEY_HABERLER, JSON.stringify(haberler));
        console.log('[HaberTakibi] ✅ Haber eklendi:', haber.baslik);
        return true;
      } catch (e) { return false; }
    },

    toggleHaber: function (id) {
      var haberler = this.getHaberler();
      haberler = haberler.map(function (h) {
        if (h.id === id) h.aktif = !h.aktif;
        return h;
      });
      try {
        localStorage.setItem(STORAGE_KEY_HABERLER, JSON.stringify(haberler));
        return true;
      } catch (e) { return false; }
    },

    deleteHaber: function (id) {
      var haberler = this.getHaberler().filter(function (h) { return h.id !== id; });
      try {
        localStorage.setItem(STORAGE_KEY_HABERLER, JSON.stringify(haberler));
        return true;
      } catch (e) { return false; }
    },

    // Aktif etki çarpanı: fiyat artışı haberi varsa +koefisyent döndür
    getEtkiCarpani: function () {
      var haberler = this.getHaberler().filter(function (h) { return h.aktif; });
      if (!haberler.length) return 1.0;

      // Etki türlerine göre en yüksek çarpanı bul
      var max = 1.0;
      haberler.forEach(function (h) {
        var c = 1.0;
        switch (h.etki) {
          case 'FIYAT_ARTISI':    c = 1.40; break; // Fiyat artışı → %40 ekstra stok talebi
          case 'DEPO_KAMPANYA':   c = 1.25; break; // Depo kampanyası → %25 ekstra
          case 'CIRO_KAMPANYA':   c = 1.20; break; // Ciro kampanyası → %20 ekstra
          case 'TEDARIK_SIKINTI': c = 1.30; break; // Tedarik sorunu → %30 ekstra
          case 'DIGER':           c = 1.10; break;
          default:                c = 1.10;
        }
        if (c > max) max = c;
      });
      return max;
    },

    // AI için aktif haber özeti
    getAktifHaberOzeti: function () {
      var haberler = this.getHaberler().filter(function (h) { return h.aktif; });
      if (!haberler.length) return '';
      var lines = ['⚡ AKTİF PİYASA HABERLERİ:'];
      haberler.forEach(function (h) {
        var etiket = {
          'FIYAT_ARTISI':    '💰 FİYAT ARTIŞI',
          'DEPO_KAMPANYA':   '🏪 DEPO KAMPANYA',
          'CIRO_KAMPANYA':   '📊 CİRO KAMPANYA',
          'TEDARIK_SIKINTI': '⚠ TEDARİK SIKINTI',
          'DIGER':           'ℹ DİĞER'
        }[h.etki] || 'ℹ HABER';
        lines.push('  ' + etiket + ' — ' + h.baslik + ' (' + h.tarih + ')');
        if (h.aciklama) lines.push('    ' + h.aciklama);
      });
      return lines.join('\n');
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  4. Sipariş Önerisi Motoru
  //     Aylık ortalama tüketim → şarta uygun en optimal kutu miktarı
  // ══════════════════════════════════════════════════════════════════

  /**
   * getSiparisOnerisi(urun, avgAylik, context)
   *
   * @param {string} urun        — Ürün adı (PANOCER, ACİDPASS, ...)
   * @param {number} avgAylik    — Aylık ortalama tüketim (kutu)
   * @param {object} context     — { kampanyaModu, etkiCarpani, classification }
   * @returns {object}           — { miktar, bonusKutu, toplam, sart, aciklama }
   */
  function getSiparisOnerisi(urun, avgAylik, context) {
    context = context || {};
    var sartlar       = SatisKosullariManager.getSartlar();
    var urunSart      = sartlar[urun] || { standart: [], kampanya: [] };
    var kampanyaModu  = context.kampanyaModu || SatisKosullariManager.isKampanyaModu(urun);
    var etkiCarpani   = context.etkiCarpani || HaberTakibiManager.getEtkiCarpani();

    // Hiç şart yoksa (FAMTREC gibi) direkt tüketim miktarını öner
    var aktifSartlar = kampanyaModu && urunSart.kampanya.length
      ? urunSart.kampanya
      : urunSart.standart;

    if (!aktifSartlar || !aktifSartlar.length) {
      var serbest = Math.round(avgAylik * etkiCarpani);
      return {
        miktar:     serbest,
        bonusKutu:  0,
        toplam:     serbest,
        sart:       null,
        aciklama:   'Satış şartı tanımsız — aylık tüketim bazlı öneri',
        kampanya:   false
      };
    }

    // Hedef: 4 haftalık stok (aylık tüketim × etki çarpanı)
    var hedef = avgAylik * etkiCarpani;

    // Şartları küçükten büyüğe sırala
    var siralı = aktifSartlar.slice().sort(function (a, b) { return a.min - b.min; });

    // En iyi şartı bul:
    // - Hedef miktarı karşılayan en düşük min basamağını seç
    // - Bir üst basamak < hedef × 1.5 ise onu seç (bonus daha iyi)
    var secilenSart = null;

    for (var i = 0; i < siralı.length; i++) {
      if (siralı[i].min >= hedef * 0.7) {
        secilenSart = siralı[i];
        break;
      }
    }

    // Hedefin üzerindeki ilk basamak yoksa en büyük basamağı kullan
    if (!secilenSart) {
      secilenSart = siralı[siralı.length - 1];
    }

    // Bir üst basamak <= hedef × 1.6 ise daha fazla bonus için onu tercih et
    var idx = siralı.indexOf(secilenSart);
    if (idx < siralı.length - 1) {
      var ustSart = siralı[idx + 1];
      if (ustSart.min <= hedef * 1.6) {
        // Üst basamakta bonus oranı daha iyi mi?
        var bonusOranMevcut = secilenSart.bonus / secilenSart.min;
        var bonusOranUst    = ustSart.bonus / ustSart.min;
        if (bonusOranUst > bonusOranMevcut * 1.1) {
          secilenSart = ustSart;
        }
      }
    }

    var bonusOranPct = secilenSart.min > 0
      ? Math.round((secilenSart.bonus / secilenSart.min) * 100)
      : 0;

    return {
      miktar:     secilenSart.min,
      bonusKutu:  secilenSart.bonus,
      toplam:     secilenSart.min + secilenSart.bonus,
      sart:       secilenSart.min + '+' + secilenSart.bonus,
      aciklama:   secilenSart.min + ' alım → ' + secilenSart.bonus + ' bonus (+%' + bonusOranPct + ')',
      kampanya:   kampanyaModu && urunSart.kampanya.length > 0,
      etkiUygulandi: etkiCarpani > 1.0 ? Math.round((etkiCarpani - 1) * 100) + '% piyasa etkisi uygulandı' : null
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  5. Ürün Bazlı Eczane Analizi
  //     ECZANE_RAW → eczane × ürün × ay matrisi
  // ══════════════════════════════════════════════════════════════════

  var PRODUCTS = ['PANOCER', 'ACİDPASS', 'GRİPORT COLD', 'MOKSEFEN', 'FAMTREC'];

  function _monthToNum(ayStr) {
    if (!ayStr) return 0;
    var p = String(ayStr).split('/');
    if (p.length < 2) return 0;
    return parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
  }

  function _monthLabel(ayStr) {
    if (!ayStr) return '?';
    var p = ayStr.split('/');
    var months = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    var m = parseInt(p[0], 10);
    var y = p[1] || '';
    return (months[m] || p[0]) + ' ' + y;
  }

  function _nextOrderMonth(lastAyStr) {
    if (!lastAyStr) return '?';
    try {
      var p = lastAyStr.split('/');
      var m = parseInt(p[0], 10);
      var y = parseInt(p[1], 10);
      m++;
      if (m > 12) { m = 1; y++; }
      var months = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
      return months[m] + ' ' + y;
    } catch (e) { return '?'; }
  }

  /**
   * analyzeEczaneByProduct(tttFilter)
   * Her eczane için ürün bazlı:
   *   { toplam, aylıkOrtalama, sonSipariş, öngörülenSipariş, siparisOnerisi }
   */
  function analyzeEczaneByProduct(tttFilter) {
    // pharmacyActiveData öncelikli (PDM multi-select filtrelenmiş), yoksa ECZANE_RAW
    var _base = (window.pharmacyActiveData && window.pharmacyActiveData.length > 0)
      ? window.pharmacyActiveData
      : (window.ECZANE_RAW || []);

    if (!_base || !Array.isArray(_base) || !_base.length) {
      console.warn('[SatisKosullari] analyzeEczaneByProduct: veri yok');
      return [];
    }

    var source = tttFilter
      ? _base.filter(function (r) { return r.ttt === tttFilter; })
      : _base;

    if (!source.length) return [];

    // eczane × ürün × ay matrisi oluştur
    var eczMap = {};

    source.forEach(function (r) {
      var key = r.gln || r.ad;
      if (!key) return;

      if (!eczMap[key]) {
        eczMap[key] = {
          gln:     r.gln  || '',
          eczane:  r.ad   || '',
          brick:   r.brick || '',
          ttt:     r.ttt  || '',
          urunler: {} // urun → { ay → kutu }
        };
      }

      var e    = eczMap[key];
      var urun = r.urun || '';
      var adet = parseInt(r.adet, 10) || 0;
      var ay   = r.ay || '';

      if (urun && ay && adet > 0) {
        if (!e.urunler[urun]) e.urunler[urun] = {};
        e.urunler[urun][ay] = (e.urunler[urun][ay] || 0) + adet;
      }
    });

    var etkiCarpani = HaberTakibiManager.getEtkiCarpani();
    var results     = [];

    Object.values(eczMap).forEach(function (e) {
      var urunAnaliz = {};

      PRODUCTS.forEach(function (urun) {
        var ayMap   = e.urunler[urun] || {};
        var ayKeys  = Object.keys(ayMap).sort(function (a, b) {
          return _monthToNum(a) - _monthToNum(b);
        });

        if (!ayKeys.length) {
          urunAnaliz[urun] = null; // Hiç alış yok
          return;
        }

        var monthlySales = ayKeys.map(function (k) { return ayMap[k] || 0; });
        var toplam       = monthlySales.reduce(function (s, v) { return s + v; }, 0);
        var ayliKOrtalama= monthlySales.filter(function(v){return v>0;}).length > 0
          ? toplam / monthlySales.filter(function(v){return v>0;}).length
          : 0;
        var lastAy       = ayKeys[ayKeys.length - 1];
        var lastKutu     = monthlySales[monthlySales.length - 1];

        // Kampanya modu kontrolü
        var kampanyaModu = SatisKosullariManager.isKampanyaModu(urun);

        // Sipariş önerisi
        var oneri = getSiparisOnerisi(urun, ayliKOrtalama, {
          kampanyaModu: kampanyaModu,
          etkiCarpani:  etkiCarpani
        });

        urunAnaliz[urun] = {
          toplamKutu:        toplam,
          aylikOrtalama:     Math.round(ayliKOrtalama * 10) / 10,
          ayCount:           monthlySales.filter(function(v){return v>0;}).length,
          sonSiparis:        _monthLabel(lastAy),
          sonSiparisAy:      lastAy,
          sonKutu:           lastKutu,
          ongorilenSiparis:  _nextOrderMonth(lastAy),
          siparisOnerisi:    oneri,
          kampanyaModu:      kampanyaModu
        };
      });

      results.push({
        gln:        e.gln,
        eczane:     e.eczane,
        brick:      e.brick,
        ttt:        e.ttt,
        urunAnaliz: urunAnaliz
      });
    });

    // En çok toplam alışa göre sırala
    results.sort(function (a, b) {
      var totA = PRODUCTS.reduce(function (s, u) {
        return s + (a.urunAnaliz[u] ? a.urunAnaliz[u].toplamKutu : 0);
      }, 0);
      var totB = PRODUCTS.reduce(function (s, u) {
        return s + (b.urunAnaliz[u] ? b.urunAnaliz[u].toplamKutu : 0);
      }, 0);
      return totB - totA;
    });

    return results;
  }

  // ══════════════════════════════════════════════════════════════════
  //  6. AI Context Metni
  // ══════════════════════════════════════════════════════════════════

  function buildSalesConditionsContext(tttFilter) {
    try {
      var lines = ['', '--- SATIŞ ŞARTLARI & SİPARİŞ ANALİZİ (Phase 4.7) ---'];

      // Haber etkisi
      var haberOzeti = HaberTakibiManager.getAktifHaberOzeti();
      if (haberOzeti) {
        lines.push(haberOzeti);
        lines.push('ETKİ ÇARPANI: x' + HaberTakibiManager.getEtkiCarpani().toFixed(2));
        lines.push('');
      }

      // Satış şartları özeti
      lines.push('MEVCUT SATIŞ ŞARTLARI:');
      var sartlar = SatisKosullariManager.getSartlar();
      PRODUCTS.forEach(function (urun) {
        var s = sartlar[urun] || { standart: [], kampanya: [] };
        var kampM = SatisKosullariManager.isKampanyaModu(urun);
        var standartStr = s.standart.map(function (x) { return x.min + '+' + x.bonus; }).join('  ') || 'Yok';
        var kampStr     = s.kampanya.map(function (x) { return x.min + '+' + x.bonus; }).join('  ') || 'Yok';
        lines.push('  ' + urun + (kampM ? ' [KAMPANYA MODU ✓]' : '') +
          ' | Standart: ' + standartStr +
          (s.kampanya.length ? ' | Kampanya: ' + kampStr : ''));
      });

      // Eczane × ürün analizi
      var analiz = analyzeEczaneByProduct(tttFilter);
      if (analiz.length) {
        lines.push('');
        lines.push('ECZANE BAZLI ÜRÜN ANALİZİ (' + analiz.length + ' eczane):');
        lines.push('');

        analiz.slice(0, 20).forEach(function (e) {
          lines.push(e.eczane + ':');
          PRODUCTS.forEach(function (urun) {
            var u = e.urunAnaliz[urun];
            if (!u) return; // Hiç alış yoksa atla
            var oneriStr = u.siparisOnerisi.sart
              ? u.siparisOnerisi.sart + ' şartı (' + u.siparisOnerisi.toplam + ' net kutu)'
              : u.siparisOnerisi.miktar + ' kutu (şartsız)';
            lines.push(
              '  ' + urun +
              '\n    Alış: '                  + u.toplamKutu + ' kutu' +
              '\n    Aylık ort. tüketim: '    + u.aylikOrtalama + ' kutu' +
              '\n    Son sipariş: '           + u.sonSiparis +
              '\n    Öngörülen sipariş: '     + u.ongorilenSiparis +
              '\n    Sipariş önerisi: '       + oneriStr +
              (u.siparisOnerisi.etkiUygulandi ? '\n    ⚡ ' + u.siparisOnerisi.etkiUygulandi : '')
            );
          });
          lines.push('');
        });
      }

      return lines.join('\n');
    } catch (err) {
      console.warn('[SatisKosullari] buildSalesConditionsContext hata:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  7. Satış Şartları Panel Renderer
  // ══════════════════════════════════════════════════════════════════

  function renderSatisKosullariPanel(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var sartlar = SatisKosullariManager.getSartlar();

    function _parseSatirlar(text) {
      // "10+1 20+3 50+10" → [{min:10,bonus:1},{min:20,bonus:3},{min:50,bonus:10}]
      if (!text || !text.trim()) return [];
      return text.trim().split(/\s+/).map(function (s) {
        var p = s.split('+');
        return p.length === 2
          ? { min: parseInt(p[0], 10) || 0, bonus: parseInt(p[1], 10) || 0 }
          : null;
      }).filter(Boolean);
    }

    function _satirlarToStr(arr) {
      if (!arr || !arr.length) return '';
      return arr.map(function (x) { return x.min + '+' + x.bonus; }).join(' ');
    }

    var panelHtml = '<div class="card">' +
      '<div class="card-hd">' +
        '<button onclick="window._pvSartlariSifirla()" style="margin-left:auto;font-size:11px;' +
          'padding:3px 10px;border-radius:6px;border:1px solid var(--border);' +
          'background:var(--bg2);color:var(--text);cursor:pointer">↺ Varsayılana Dön</button>' +
      '</div>' +
      '<div class="card-body-0" style="padding:12px 16px">';

    PRODUCTS.forEach(function (urun) {
      var s = sartlar[urun] || { standart: [], kampanya: [] };
      var kampM = SatisKosullariManager.isKampanyaModu(urun);
      var urunId = urun.replace(/\s+/g, '_').replace(/İ/g, 'I').toLowerCase();

      panelHtml += '<div style="border:1px solid var(--border);border-radius:8px;' +
        'padding:12px;margin-bottom:12px;background:var(--bg2)">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<span style="font-weight:700;font-size:13px">' + urun + '</span>' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;margin-left:auto">' +
            '<input type="checkbox" id="kamp_' + urunId + '" ' + (kampM ? 'checked' : '') +
              ' onchange="window._pvToggleKampanya(\'' + urun + '\',this.checked)">' +
            ' Kampanya Modu Aktif' +
          '</label>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div>' +
            '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">' +
              'Standart MF (örn: 10+1 20+3 50+10)' +
            '</label>' +
            '<input id="st_' + urunId + '" type="text" value="' + _satirlarToStr(s.standart) + '"' +
              ' style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid var(--border);' +
              'background:var(--bg);color:var(--text);font-size:12px;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">' +
              'Kampanya Şartı (örn: 50+15 100+35)' +
            '</label>' +
            '<input id="kp_' + urunId + '" type="text" value="' + _satirlarToStr(s.kampanya) + '"' +
              ' style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid var(--border);' +
              'background:var(--bg);color:var(--text);font-size:12px;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<button onclick="window._pvKaydetUrun(\'' + urun + '\',\'' + urunId + '\')" ' +
          'style="margin-top:8px;font-size:11px;padding:4px 14px;border-radius:6px;' +
          'border:none;background:var(--c1);color:#fff;cursor:pointer">💾 Kaydet</button>' +
      '</div>';
    });

    panelHtml += '</div></div>';
    container.innerHTML = panelHtml;

    // Helper fonksiyonları window'a ata
    window._pvParseSatirlar = _parseSatirlar;
    window._pvKaydetUrun = function (urun, urunId) {
      var standartStr = document.getElementById('st_' + urunId).value;
      var kampStr     = document.getElementById('kp_' + urunId).value;
      var ok = SatisKosullariManager.updateUrunSart(urun, 'standart', _parseSatirlar(standartStr));
      if (ok) SatisKosullariManager.updateUrunSart(urun, 'kampanya', _parseSatirlar(kampStr));
      if (ok) {
        var btn = event.target;
        btn.textContent = '✅ Kaydedildi';
        setTimeout(function () { btn.textContent = '💾 Kaydet'; }, 1500);
      }
    };
    window._pvToggleKampanya = function (urun, aktif) {
      SatisKosullariManager.setKampanyaModu(urun, aktif);
    };
    window._pvSartlariSifirla = function () {
      if (confirm('Tüm satış şartları varsayılana dönecek. Onaylıyor musunuz?')) {
        SatisKosullariManager.resetToDefault();
        renderSatisKosullariPanel(containerId);
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  8. Haber Takibi Panel Renderer
  // ══════════════════════════════════════════════════════════════════

  function renderHaberTakibiPanel(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var haberler = HaberTakibiManager.getHaberler();
    var etkiCarpani = HaberTakibiManager.getEtkiCarpani();

    var etiketler = {
      'FIYAT_ARTISI':    { icon: '💰', label: 'Fiyat Artışı',    color: '#DC2626', bg: '#FEE2E2' },
      'DEPO_KAMPANYA':   { icon: '🏪', label: 'Depo Kampanya',   color: '#D97706', bg: '#FEF3C7' },
      'CIRO_KAMPANYA':   { icon: '📊', label: 'Ciro Kampanya',   color: '#2563EB', bg: '#EFF6FF' },
      'TEDARIK_SIKINTI': { icon: '⚠',  label: 'Tedarik Sorunu', color: '#7C3AED', bg: '#F3E8FF' },
      'DIGER':           { icon: 'ℹ',  label: 'Diğer',          color: '#475569', bg: '#F1F5F9' }
    };

    var haberRows = haberler.length
      ? haberler.map(function (h) {
          var e = etiketler[h.etki] || etiketler['DIGER'];
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;' +
            'border-radius:8px;margin-bottom:8px;border:1px solid var(--border);' +
            'background:' + (h.aktif ? e.bg : 'var(--bg2)') + ';' +
            'opacity:' + (h.aktif ? '1' : '0.55') + '">' +
            '<span style="font-size:18px;line-height:1">' + e.icon + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:700;font-size:13px;color:' + e.color + '">' +
                h.baslik + '</div>' +
              '<div style="font-size:11px;color:var(--dim);margin-top:2px">' +
                e.label + ' • ' + h.tarih +
                (h.aciklama ? ' • ' + h.aciklama : '') +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0">' +
              '<button onclick="window._pvToggleHaber(' + h.id + ')" ' +
                'style="font-size:10px;padding:3px 8px;border-radius:5px;' +
                'border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer">' +
                (h.aktif ? '⏸ Duraklat' : '▶ Aktifleştir') +
              '</button>' +
              '<button onclick="window._pvSilHaber(' + h.id + ')" ' +
                'style="font-size:10px;padding:3px 8px;border-radius:5px;' +
                'border:none;background:#FEE2E2;color:#DC2626;cursor:pointer">🗑 Sil</button>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div style="text-align:center;color:var(--dim);padding:20px;font-size:13px">' +
          'Henüz haber girilmemiş.<br><small>Fiyat artışı, depo kampanyası gibi piyasa koşullarını ekleyin.</small>' +
        '</div>';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd">' +
          (etkiCarpani > 1.0
            ? '<span class="card-badge" style="background:#FEE2E2;color:#DC2626">⚡ Etki: ×' +
              etkiCarpani.toFixed(2) + ' aktif</span>'
            : '<span class="card-badge" style="background:#F0FDF4;color:#15803D">✓ Standart mod</span>') +
        '</div>' +
        '<div class="card-body-0" style="padding:12px 16px">' +

          // Yeni haber ekleme formu
          '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;' +
            'margin-bottom:14px;background:var(--bg2)">' +
            '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--dim)">+ YENİ DURUM EKLE</div>' +
            '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-bottom:8px">' +
              '<input id="haber_baslik" type="text" placeholder="Başlık (örn: KDV artışı açıklandı)"' +
                ' style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);' +
                'background:var(--bg);color:var(--text);font-size:12px">' +
              '<select id="haber_etki" style="padding:5px 8px;border-radius:6px;' +
                'border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px">' +
                '<option value="FIYAT_ARTISI">💰 Fiyat Artışı</option>' +
                '<option value="DEPO_KAMPANYA">🏪 Depo Kampanya</option>' +
                '<option value="CIRO_KAMPANYA">📊 Ciro Kampanya</option>' +
                '<option value="TEDARIK_SIKINTI">⚠ Tedarik Sorunu</option>' +
                '<option value="DIGER">ℹ Diğer</option>' +
              '</select>' +
              '<input id="haber_tarih" type="date" value="' +
                new Date().toISOString().slice(0, 10) + '"' +
                ' style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);' +
                'background:var(--bg);color:var(--text);font-size:12px">' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr auto;gap:8px">' +
              '<input id="haber_aciklama" type="text" placeholder="Açıklama (isteğe bağlı)"' +
                ' style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);' +
                'background:var(--bg);color:var(--text);font-size:12px">' +
              '<button onclick="window._pvHaberEkle()" ' +
                'style="padding:5px 16px;border-radius:6px;border:none;' +
                'background:var(--c1);color:#fff;font-size:12px;cursor:pointer">+ Ekle</button>' +
            '</div>' +
          '</div>' +

          // Haber listesi
          haberRows +
        '</div>' +
      '</div>';

    // Event handlers
    window._pvHaberEkle = function () {
      var baslik    = (document.getElementById('haber_baslik').value || '').trim();
      var etki      = document.getElementById('haber_etki').value;
      var tarih     = document.getElementById('haber_tarih').value;
      var aciklama  = (document.getElementById('haber_aciklama').value || '').trim();
      if (!baslik) {
        document.getElementById('haber_baslik').style.borderColor = '#DC2626';
        return;
      }
      HaberTakibiManager.addHaber({ baslik: baslik, etki: etki, tarih: tarih, aciklama: aciklama });
      renderHaberTakibiPanel(containerId);
    };

    window._pvToggleHaber = function (id) {
      HaberTakibiManager.toggleHaber(id);
      renderHaberTakibiPanel(containerId);
    };

    window._pvSilHaber = function (id) {
      HaberTakibiManager.deleteHaber(id);
      renderHaberTakibiPanel(containerId);
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  9. Eczane Bazlı Ürün Analiz Kartı Renderer
  // ══════════════════════════════════════════════════════════════════

  function renderEczaneUrunAnalizKarti(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var analiz = analyzeEczaneByProduct(tttFilter);
    if (!analiz.length) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">' +
        '⏳ Veri yükleniyor veya eczane verisi mevcut değil.</div>';
      return;
    }

    var etkiCarpani = HaberTakibiManager.getEtkiCarpani();

    // Sıralama/filtreleme/sayfalama — Eczane Detay Listesi (index.html) ile
    // AYNI desen: tıklanabilir sütun başlıkları (▾), arama, ve sayfa
    // numarası şeridi. Burada eczane sayısı çok daha yüksek olabileceğinden
    // sayfa başına 10 eczane gösterilir (ana listede 20).
    var URUN_ANALIZ_PAGE_SIZE = 10;

    // Her eczane için sıralanabilir "toplam öngörülen sipariş" alanı ekle
    // (ürün bazlı hücrelerin toplamı) — ana listedeki "Toplam" sütunuyla
    // aynı mantık: en öncelikli eczaneleri üste getirebilmek için.
    analiz.forEach(function (e) {
      var toplamOngoru = 0;
      PRODUCTS.forEach(function (urun) {
        var u = e.urunAnaliz[urun];
        if (u && typeof u.ongorilenSiparis === 'number') toplamOngoru += u.ongorilenSiparis;
      });
      e._toplamOngoru = toplamOngoru;
    });

    // Benzersiz brick listesi
    var brickListesi = ['TÜMÜ'].concat(
      analiz.map(function(e){ return e.brick; })
        .filter(function(b, i, arr){ return b && arr.indexOf(b) === i; })
        .sort()
    );

    var headerCells = PRODUCTS.map(function (urun) {
      var kampM = SatisKosullariManager.isKampanyaModu(urun);
      return '<th style="text-align:center;font-size:11px">' + urun +
        (kampM ? '<br><span style="color:#D97706;font-size:9px">⚡kampanya</span>' : '') +
        '</th>';
    }).join('');

    var brickOptions = brickListesi.map(function(b){
      return '<option value="' + b + '">' + b + '</option>';
    }).join('');

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-badge" id="urunAnalizBadge">' + analiz.length + ' eczane</span>' +
          (etkiCarpani > 1.0
            ? '<span class="card-badge" style="background:#FEF3C7;color:#D97706">' +
              '⚡ Piyasa etkisi ×' + etkiCarpani.toFixed(2) + ' aktif</span>'
            : '') +
          '<div style="margin-left:auto;display:flex;gap:6px;align-items:center">' +
            '<input type="text" id="urunAnalizSearch" class="inp" placeholder="🔍 Eczane ara..."' +
              ' style="padding:5px 10px;font-size:11px;width:150px"' +
              ' oninput="window._filterUrunAnalizTable()">' +
            '<select id="urunAnalizBrick" class="inp"' +
              ' style="padding:5px 8px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)"' +
              ' onchange="window._filterUrunAnalizTable()">' +
              brickOptions +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="card-body-0 scroll-x">' +
          '<table class="tbl" id="urunAnalizTable" style="min-width:900px">' +
            '<thead><tr>' +
              '<th onclick="window._sortUrunAnaliz(\'eczane\')" style="cursor:pointer">Eczane ▾</th>' +
              '<th onclick="window._sortUrunAnaliz(\'brick\')" style="cursor:pointer">Brick ▾</th>' +
              '<th onclick="window._sortUrunAnaliz(\'_toplamOngoru\')" style="cursor:pointer;text-align:center">Toplam Öngörü ▾</th>' +
              headerCells +
            '</tr></thead>' +
            '<tbody id="urunAnalizTbody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div id="urunAnalizPagination" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;padding:12px 10px;border-top:1px solid var(--border)"></div>' +
      '</div>';

    // Sıralama/sayfalama state — bu karta özel, global eczane listesini etkilemez
    window._urunAnalizData      = analiz;
    window._urunAnalizSortKey   = window._urunAnalizSortKey   || '_toplamOngoru';
    window._urunAnalizSortAsc   = (window._urunAnalizSortAsc === undefined) ? false : window._urunAnalizSortAsc;
    window._urunAnalizPage      = 1;

    window._sortUrunAnaliz = function (key) {
      if (window._urunAnalizSortKey === key) window._urunAnalizSortAsc = !window._urunAnalizSortAsc;
      else { window._urunAnalizSortKey = key; window._urunAnalizSortAsc = (key === 'eczane' || key === 'brick'); }
      window._urunAnalizPage = 1; // sıralama değişince baştan başla
      window._filterUrunAnalizTable();
    };

    window._goToUrunAnalizPage = function (n) {
      window._urunAnalizPage = n;
      window._filterUrunAnalizTable();
      var tbl = document.getElementById('urunAnalizTable');
      if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    window._renderUrunAnalizPagination = function (totalPages) {
      var el = document.getElementById('urunAnalizPagination');
      if (!el) return;
      if (totalPages <= 1) { el.innerHTML = ''; return; }
      var cur = window._urunAnalizPage;
      var mkBtn = function (n, label, active) {
        return '<button onclick="window._goToUrunAnalizPage(' + n + ')" style="min-width:28px;padding:5px 8px;' +
          'font-size:11px;border-radius:6px;cursor:pointer;border:1px solid ' + (active ? 'var(--c1)' : 'var(--border)') +
          ';background:' + (active ? 'var(--c1)' : 'var(--surf)') + ';color:' + (active ? '#fff' : 'var(--fg)') +
          ';font-weight:' + (active ? '700' : '500') + '">' + label + '</button>';
      };
      var pages = [];
      var WINDOW = 1;
      for (var i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= cur - WINDOW && i <= cur + WINDOW)) pages.push(i);
        else if (pages[pages.length - 1] !== '…') pages.push('…');
      }
      var html = '<button onclick="window._goToUrunAnalizPage(' + Math.max(1, cur - 1) + ')" ' + (cur === 1 ? 'disabled' : '') +
        ' style="min-width:28px;padding:5px 8px;font-size:11px;border-radius:6px;cursor:' + (cur === 1 ? 'default' : 'pointer') +
        ';border:1px solid var(--border);background:var(--surf);color:' + (cur === 1 ? 'var(--dim)' : 'var(--fg)') + '">‹</button>';
      pages.forEach(function (p) {
        html += (p === '…')
          ? '<span style="padding:5px 4px;font-size:11px;color:var(--dim)">…</span>'
          : mkBtn(p, p, p === cur);
      });
      html += '<button onclick="window._goToUrunAnalizPage(' + Math.min(totalPages, cur + 1) + ')" ' + (cur === totalPages ? 'disabled' : '') +
        ' style="min-width:28px;padding:5px 8px;font-size:11px;border-radius:6px;cursor:' + (cur === totalPages ? 'default' : 'pointer') +
        ';border:1px solid var(--border);background:var(--surf);color:' + (cur === totalPages ? 'var(--dim)' : 'var(--fg)') + '">›</button>';
      el.innerHTML = html;
    };

    // Filtre + sıralama + sayfalama + render fonksiyonu
    window._filterUrunAnalizTable = function() {
      var searchVal = (document.getElementById('urunAnalizSearch')&&document.getElementById('urunAnalizSearch').value||'').toLowerCase();
      var brickVal  = document.getElementById('urunAnalizBrick') ? document.getElementById('urunAnalizBrick').value : 'TÜMÜ';
      var filtered = window._urunAnalizData.filter(function(e){
        var brickOk = brickVal === 'TÜMÜ' || e.brick === brickVal;
        var searchOk = !searchVal || e.eczane.toLowerCase().includes(searchVal) || (e.brick||'').toLowerCase().includes(searchVal);
        return brickOk && searchOk;
      });

      // Sıralama — Eczane Detay Listesi'ndeki sortEczane() ile aynı mantık
      var sKey = window._urunAnalizSortKey, sAsc = window._urunAnalizSortAsc;
      filtered.sort(function (a, b) {
        var av = a[sKey], bv = b[sKey];
        if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
        else { av = av || 0; bv = bv || 0; }
        return sAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });

      var badgeEl = document.getElementById('urunAnalizBadge');

      // Sayfalama — en fazla 10 eczane/sayfa
      var totalPages = Math.max(1, Math.ceil(filtered.length / URUN_ANALIZ_PAGE_SIZE));
      if (window._urunAnalizPage > totalPages) window._urunAnalizPage = totalPages;
      if (window._urunAnalizPage < 1) window._urunAnalizPage = 1;
      var pageStart = (window._urunAnalizPage - 1) * URUN_ANALIZ_PAGE_SIZE;
      var pageItems = filtered.slice(pageStart, pageStart + URUN_ANALIZ_PAGE_SIZE);

      if (badgeEl) badgeEl.textContent = filtered.length + ' eczane — sayfa ' + window._urunAnalizPage + '/' + totalPages;
      window._renderUrunAnalizPagination(totalPages);

      var tbody = document.getElementById('urunAnalizTbody');
      if (!tbody) return;
      tbody.innerHTML = pageItems.map(function(e){
        var urunCells = PRODUCTS.map(function (urun) {
          var u = e.urunAnaliz[urun];
          if (!u) return '<td style="text-align:center;color:var(--dim);font-size:10px">—</td>';
          var oneriColor = u.kampanyaModu ? '#D97706' : 'var(--c1)';
          var oneriText  = u.siparisOnerisi.sart ? u.siparisOnerisi.sart : u.siparisOnerisi.miktar + ' kutu';
          return '<td style="text-align:center">' +
            '<div style="font-weight:700;font-size:12px;color:' + oneriColor + '">' + oneriText + '</div>' +
            '<div style="font-size:9px;color:var(--dim)">ort:' + u.aylikOrtalama + ' | son:' + u.sonSiparis + '</div>' +
            '<div style="font-size:9px;color:#15803D">→ ' + u.ongorilenSiparis + '</div>' +
          '</td>';
        }).join('');
        return '<tr>' +
          '<td style="font-weight:600;font-size:12px">' + e.eczane + '</td>' +
          '<td style="font-size:10px;color:var(--dim)">' + e.brick + '</td>' +
          '<td style="text-align:center;font-weight:700;font-size:12px;color:var(--c1)">' + e._toplamOngoru + '</td>' +
          urunCells +
        '</tr>';
      }).join('');
    };

    // İlk render
    window._filterUrunAnalizTable();
  }

  // ══════════════════════════════════════════════════════════════════
  //  10. Global API Yayınla
  // ══════════════════════════════════════════════════════════════════

  // İlk yükleme
  window.SATIS_SARTLARI = SatisKosullariManager.getSartlar();

  window.SatisKosullariManager       = SatisKosullariManager;
  window.HaberTakibiManager          = HaberTakibiManager;
  window.getSiparisOnerisi           = getSiparisOnerisi;
  window.analyzeEczaneByProduct      = analyzeEczaneByProduct;
  window.buildSalesConditionsContext = buildSalesConditionsContext;
  window.renderSatisKosullariPanel   = renderSatisKosullariPanel;
  window.renderHaberTakibiPanel      = renderHaberTakibiPanel;
  window.renderEczaneUrunAnalizKarti = renderEczaneUrunAnalizKarti;

  window._SATIS_KOSULLARI_LOADED = true;
  console.log('[SatisKosullari] ✅ Phase 4.7 yüklendi — satış şartları, haber takibi, sipariş analizi');

})();
