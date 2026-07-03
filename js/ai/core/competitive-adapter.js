// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/competitive-adapter.js
//  FAZ 6.4 — Competitive Adapter Katmanı
//
//  Sorumluluk:
//    parseRakipAksiyonCSV() çıktısını (KATMAN 0, js/data/csv-parser.js)
//    AI motorlarının kullanacağı ORTAK, STANDART bir veri modeline
//    (CompetitiveRecord) çevirmek. Parser DEĞİŞTİRİLMEDİ — sadece bu
//    adapter, parser'ın çıktısını okuyup yorumluyor.
//
//  ⚠️ NEDEN BU DOSYA VAR (bkz. AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §5,
//    §9.1, §16 FAZ 6.4):
//    RAKIP_AKSİYON.csv yeni bir veri modeli getirmiyor — sales-conditions.js
//    (Phase 4.7)'nin VARSAYILAN_SARTLAR'ının kullandığı {min,bonus} şemasının
//    6 aylık zaman serisi + 49 rakip firma ile genişletilmiş hali (§4 netleşen
//    karar). Bu adapter, parser'ın ham satırlarını (firma×urun×ay) bu
//    {min,bonus} şemasına, mevcut ALL_GROUPS taksonomisine ve normUrun()
//    alias kurallarına göre yorumlar.
//
//  GRUP EŞLEME MANTIĞI — POZİSYONEL (statik bir map İCAT EDİLMEDİ):
//    RAKIP_AKSİYON.csv'de satırlar, dosyanın kendi yapısı gereği şu sırada:
//    [İLKO satırı] → [o pazarın rakipleri] → [sıradaki İLKO satırı] → ...
//    Bu adapter dosyayı SIRAYLA tarar; her İLKO satırı (firma === 'İLKO İLAÇ'
//    varyantları) normalde YENİ bir grup açar — URUN_ORDER[i] ↔ ALL_GROUPS[i]
//    sırayla eşlenir (constants.js'teki MEVCUT sıralama, yeni bir eşleme
//    icat edilmedi). AMA o İLKO satırının ürünü normUrun() alias tablosunda
//    HALİHAZIRDA AÇIK olan bir gruptaki ürüne eşleniyorsa (örn. "GRIPORT
//    FİLMTAB 20" → "GRİPORT COLD", aynı pazarın 2. İLKO satırı), mevcut
//    grup ID'si KORUNUR, yeni grup AÇILMAZ — bu sayede o bloktaki 10 rakip
//    de aynı GRİPORT COLD PAZARI'na düşer (§1.1 düzeltmesi, GitHub'daki
//    gerçek dosyayla doğrulandı: toplam 49 rakip satırı, 26'sı GRİPORT
//    COLD PAZARI'na ait — 16 + alias bloğundaki 10).
//
//  TIER PARSE KURALI: "50+25/100+60" → [{min:50,bonus:25},{min:100,bonus:60}]
//    sales-conditions.js'in {min,bonus} terminolojisiyle BİREBİR AYNI —
//    yeni terminoloji icat edilmedi. Parse edilemeyen hücre (örn. bilinen
//    BERAT BERAN hatası "10/1+50+6") guvenirlik:'KISMI' ile işaretlenir,
//    motor ÇÖKMEZ, sadece o tier listesi boş kalır.
//
//  STANDART CompetitiveRecord MODELİ (§5.1 — kesinleşmiş şema):
//    {
//      firma, urun, ilacGrubu,        // ALL_GROUPS değerlerinden biri (veya null — eşlenemezse)
//      ay, yil,                       // 'OCAK'..'HAZİRAN', 2026
//      standart: [{min,bonus}],       // ANAMAL+MF sütunu
//      kampanya: { baslangic, bitis, tiers:[{min,bonus}] } | null,  // AKSİYON sütunu
//      cepMf: [{min,bonus}] | null,
//      isOwn,                         // true/false (firma === İLKO varyantı)
//      degisimOncekiAya: 'TIRMANMA'|'GEVSEME'|'SABIT'|'YENI'|'COKTI',
//      guvenirlik: 'TAM'|'KISMI'      // tier parse başarılı mı
//    }
//
//  `indirimPct = bonus / (min + bonus)` SAKLANAN bir alan DEĞİL — ihtiyaç
//  anında türetilir (getIndirimPct yardımcı fonksiyonu) — mevcut kodun
//  hiçbir yerde yüzde saklamama tutarlılığı korunur (§5.1 notu).
//
//  Public API:
//    normalizeCompetitive()          → { ownActions: CompetitiveRecord[],
//                                         competitorActions: CompetitiveRecord[] } (cache'li)
//    getIndirimPct(tier)             → number (0-100, türetilmiş)
//    getMostGenerousTier(tiers)      → {min,bonus} | null ("headline" yoğunluk metriği)
//    getRecordsByGrup(ilacGrubu, ay) → CompetitiveRecord[] (rakipler, o pazar+ay için)
//    getRecordsByFirma(firma, urun)  → CompetitiveRecord[] (6 aylık seri, tek rakip)
//    clearCache()
//
//  CACHE: ims-adapter.js'in İÇERİK-İMZA bazlı deseni birebir izlenir
//  (§12 performans kuralı).
//
//  Kurallar:
//    • parseRakipAksiyonCSV() (js/data/csv-parser.js) DEĞİŞTİRİLMEDİ.
//    • normUrun()/stripTR() (data-normalizer.js) DEĞİŞTİRİLMEDİ — sadece
//      kullanılır (normUrun()'e §9.2'de tek satır alias eklendi, ayrı commit).
//    • DOM erişimi YOK.
//    • Bu FAZ'da hiçbir karar motoruna (risk/insight/recommendation/
//      opportunity) BAĞLANMADI — competitive-impact-engine.js (FAZ 6.6)
//      bu adapter'ın çıktısını tüketecek, henüz değil.
//
//  Bağımlılık: js/data/csv-parser.js (parseRakipAksiyonCSV), js/data/
//              data-normalizer.js (normUrun, stripTR), js/core/constants.js
//              (URUN_ORDER, ALL_GROUPS) — hepsi opsiyonel (typeof kontrolü)
//  Yükleme sırası: csv-parser.js, data-normalizer.js, constants.js SONRASI;
//                  henüz hiçbir tüketicisi olmadığı için KESİN bir "ÖNCESİ"
//                  kısıtı yok (competitive-impact-engine.js geldiğinde ondan
//                  önce olmalı — FAZ 6.6 notu)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._COMPETITIVE_ADAPTER_LOADED) {
    console.warn('[competitive-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._COMPETITIVE_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';
  var AY_SIRASI = ['OCAK','ŞUBAT','MART','NİSAN','MAYIS','HAZİRAN'];
  var AY_NUM = { 'OCAK':1, 'ŞUBAT':2, 'MART':3, 'NİSAN':4, 'MAYIS':5, 'HAZİRAN':6 };
  var DOSYA_YILI = 2026; // RAKIP_AKSİYON.csv'nin başlık satırından (sabit, dosya tek yıl kapsıyor)

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  function _isOwnFirma(firma) {
    if (!firma) return false;
    var u = _safe(function () { return stripTR(firma.trim().toUpperCase()); }, firma.trim().toUpperCase());
    return u.indexOf('ILKO') !== -1; // "İLKO İLAÇ" / "ILKO ILAC" varyantları
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) TIER PARSE — "50+25/100+60" → [{min,bonus}], guvenirlik
  // ──────────────────────────────────────────────────────────────────
  function _parseTiers(raw) {
    if (!raw) return { tiers: [], guvenirlik: 'TAM' };
    var s = String(raw).trim().replace(/\u00a0/g, '').trim(); // non-breaking space temizliği (§3 veri kalitesi notu)
    if (!s || s === '-' || s === '--') return { tiers: [], guvenirlik: 'TAM' };

    var parts = s.split('/').map(function (p) { return p.trim(); }).filter(Boolean);
    var tiers = [];
    var guvenirlik = 'TAM';

    parts.forEach(function (p) {
      var clean = p.replace(/\s+/g, '');
      var m = clean.match(/^(\d+)\+(\d+)$/);
      if (m) {
        tiers.push({ min: parseInt(m[1], 10), bonus: parseInt(m[2], 10) });
      } else {
        guvenirlik = 'KISMI'; // bilinen örnek: BERAT BERAN "10/1+50+6" (§3)
      }
    });

    return { tiers: tiers, guvenirlik: guvenirlik };
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) AKSİYON BAŞLIĞINDAN TARİH ARALIĞI — "AKSİYON 14-16 OCAK" → ISO
  // ──────────────────────────────────────────────────────────────────
  function _parseAksiyonTarih(baslik, ay) {
    if (!baslik) return null;
    var s = String(baslik).trim().replace(/\u00a0/g, '').trim();
    if (!s || s === '-' || s === '--') return null;

    var m = s.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-ZÇĞİÖŞÜa-zçğıöşü]+)/);
    if (!m) return null;

    var d1 = parseInt(m[1], 10), d2 = parseInt(m[2], 10);
    var ayAdi = m[3].toUpperCase();
    var ayNum = AY_NUM[ayAdi] || AY_NUM[ay] || null;
    if (!ayNum) return null;

    function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
    return {
      baslangic: DOSYA_YILI + '-' + pad(ayNum) + '-' + pad(d1),
      bitis:     DOSYA_YILI + '-' + pad(ayNum) + '-' + pad(d2)
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) "headline" yoğunluk metriği + türetilmiş indirim yüzdesi
  // ──────────────────────────────────────────────────────────────────
  function getIndirimPct(tier) {
    if (!tier || (tier.min + tier.bonus) === 0) return 0;
    return Math.round((tier.bonus / (tier.min + tier.bonus)) * 1000) / 10;
  }

  // En cömert tier = en yüksek indirimPct'e sahip olan (mutlak bonus değil,
  // ORAN bazlı — büyük alımda büyük bonus olması doğal, asıl sinyal oran).
  function getMostGenerousTier(tiers) {
    if (!tiers || !tiers.length) return null;
    var best = tiers[0], bestPct = getIndirimPct(tiers[0]);
    for (var i = 1; i < tiers.length; i++) {
      var pct = getIndirimPct(tiers[i]);
      if (pct > bestPct) { best = tiers[i]; bestPct = pct; }
    }
    return best;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) AY-ÜZERİ-AY DEĞİŞİM SİNYALİ — TIRMANMA/GEVSEME/SABIT/YENI/COKTI
  //     "Yoğunluk" = en cömert tier'ın indirimPct'i (standart şart için).
  // ──────────────────────────────────────────────────────────────────
  function _calcDegisim(currentTiers, previousTiers) {
    var curBest = getMostGenerousTier(currentTiers);
    var prevBest = getMostGenerousTier(previousTiers);

    var curPct = curBest ? getIndirimPct(curBest) : 0;
    var prevPct = prevBest ? getIndirimPct(prevBest) : 0;

    var curHas = !!curBest, prevHas = !!prevBest;

    if (!curHas && !prevHas) return 'SABIT';
    if (curHas && !prevHas) return 'YENI';
    if (!curHas && prevHas) return 'COKTI';

    var deltaAbs = Math.abs(curPct - prevPct);
    if (deltaAbs < 1) return 'SABIT'; // 1 puandan küçük fark → gürültü, sabit kabul
    return curPct > prevPct ? 'TIRMANMA' : 'GEVSEME';
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) POZİSYONEL GRUP EŞLEME — statik map yerine, parser çıktısının
  //     SIRASINI tarayarak İLKO satırlarını URUN_ORDER↔ALL_GROUPS ile
  //     eşler, alias durumunda mevcut grubu korur (§5 — dosya başı notu).
  // ──────────────────────────────────────────────────────────────────
  function _assignGroups(parsedRows) {
    var urunOrder = _safe(function () { return URUN_ORDER || []; }, ['PANOCER','ACİDPASS','GRİPORT COLD','MOKSEFEN','FAMTREC']);
    var allGroups = _safe(function () { return ALL_GROUPS || []; }, ['PANTAPROZOL PAZARI','ACIDPASS PAZARI','GRİPORT COLD PAZARI','MOKSİFLOKSASİN PAZARI','FAMTREC PAZARI']);

    // (firma,urun) sırasına göre benzersiz blokları çıkar — parser zaten
    // satırları (firma,urun,ay) bazında düzleştirdiği için, aynı (firma,urun)
    // farklı aylarda tekrar eder; burada sadece İLK GÖRÜLEN sıra önemli.
    var blockOrder = [];
    var seen = {};
    parsedRows.forEach(function (r) {
      var key = r.firma + '|' + r.urun;
      if (!seen[key]) { seen[key] = true; blockOrder.push({ firma: r.firma, urun: r.urun, key: key }); }
    });

    var groupByKey = {};      // (firma|urun) → ilacGrubu
    var currentGroupIdx = -1;
    var openGroupCanonicalUrun = null; // o anki açık grubun normUrun() ile eşlenmiş kanonik ürün adı

    blockOrder.forEach(function (b) {
      if (_isOwnFirma(b.firma)) {
        var canonical = _safe(function () { return normUrun(b.urun); }, b.urun.toUpperCase());

        // Alias kontrolü: bu İLKO satırı, halihazırda açık olan grubun
        // kanonik ürününe mi eşleniyor? (örn. "GRIPORT FİLMTAB 20" → "GRİPORT COLD")
        if (currentGroupIdx >= 0 && canonical === openGroupCanonicalUrun) {
          groupByKey[b.key] = allGroups[currentGroupIdx] || null;
          return; // grup DEĞİŞMEDİ — yeni blok açılmadı
        }

        // Yeni grup aç — URUN_ORDER içinde kanonik ürünün pozisyonunu bul,
        // bulunamazsa (beklenmedik yeni ürün) bir sonraki sıradaki boş
        // grup pozisyonuna ilerle (savunmacı fallback).
        var idx = urunOrder.indexOf(canonical);
        if (idx === -1) idx = currentGroupIdx + 1;

        currentGroupIdx = idx;
        openGroupCanonicalUrun = canonical;
        groupByKey[b.key] = allGroups[idx] || null;
      } else {
        // Rakip satırı: o anki açık gruba ait
        groupByKey[b.key] = currentGroupIdx >= 0 ? (allGroups[currentGroupIdx] || null) : null;
      }
    });

    return groupByKey;
  }

  // ──────────────────────────────────────────────────────────────────
  //  6) ANA NORMALİZASYON — normalizeCompetitive() (cache'li)
  // ──────────────────────────────────────────────────────────────────
  var _cache = null; // { ownActions, competitorActions, signature }

  function _dataSignature(parsedRows) {
    return parsedRows.length + ':' + parsedRows.reduce(function (s, r) {
      return s + (r.anamalMf || '').length + (r.aksiyonMf || '').length + (r.cepMf || '').length;
    }, 0);
  }

  function normalizeCompetitive() {
    var parsedRows = _safe(function () {
      if (typeof window.RAKIP_AKSIYON_RAW !== 'undefined' && window.RAKIP_AKSIYON_RAW) {
        return window.RAKIP_AKSIYON_RAW;
      }
      return [];
    }, []);

    if (!parsedRows.length) {
      return { ownActions: [], competitorActions: [] };
    }

    var sig = _dataSignature(parsedRows);
    if (_cache && _cache.signature === sig) {
      return { ownActions: _cache.ownActions, competitorActions: _cache.competitorActions };
    }

    var groupByKey = _assignGroups(parsedRows);

    // Her (firma,urun) için aylık seriyi grupla — ay-üstü-ay değişim
    // hesaplamak için önceki ayın tier'larına ihtiyaç var.
    var byFirmaUrun = {};
    parsedRows.forEach(function (r) {
      var key = r.firma + '|' + r.urun;
      if (!byFirmaUrun[key]) byFirmaUrun[key] = [];
      byFirmaUrun[key].push(r);
    });

    var ownActions = [];
    var competitorActions = [];

    Object.keys(byFirmaUrun).forEach(function (key) {
      try {
        var rows = byFirmaUrun[key].slice().sort(function (a, b) { return a.ayIndex - b.ayIndex; });
        var ilacGrubu = groupByKey[key] || null;
        var isOwn = _isOwnFirma(rows[0].firma);

        var prevStandartTiers = null;

        rows.forEach(function (r) {
          var standart = _parseTiers(r.anamalMf);
          var aksiyon = _parseTiers(r.aksiyonMf);
          var cep = _parseTiers(r.cepMf);

          var kampanyaTarih = _parseAksiyonTarih(r.aksiyonBaslik, r.ay);
          // DÜZELTME (FAZ 6.6 sırasında bulundu): kampanyaTarih, AKSİYON
          // sütun BAŞLIĞINDAN gelir — bu başlık o ay TÜM satırlarda AYNI
          // (pazar geneli aksiyon penceresinin varlığını gösterir, bir
          // firmanın O PENCEREYE GERÇEKTEN KATILIP KATILMADIĞINI değil).
          // "Bu firma bu ay kampanya yürüttü" sonucu SADECE o firmanın
          // KENDİ aksiyonMf hücresi doluysa (aksiyon.tiers.length>0)
          // çıkarılabilir — yoksa "pencere vardı ama bu firma katılmadı"
          // durumu yanlışlıkla "kampanya yürüttü" gibi görünür.
          var kampanya = aksiyon.tiers.length
            ? { baslangic: kampanyaTarih ? kampanyaTarih.baslangic : null,
                bitis:     kampanyaTarih ? kampanyaTarih.bitis     : null,
                tiers:     aksiyon.tiers }
            : null;

          var guvenirlik = (standart.guvenirlik === 'KISMI' || aksiyon.guvenirlik === 'KISMI' || cep.guvenirlik === 'KISMI')
            ? 'KISMI' : 'TAM';

          var record = {
            firma: r.firma,
            urun: r.urun,
            ilacGrubu: ilacGrubu,
            ay: r.ay,
            yil: DOSYA_YILI,
            standart: standart.tiers,
            kampanya: kampanya,
            cepMf: cep.tiers.length ? cep.tiers : null,
            isOwn: isOwn,
            degisimOncekiAya: _calcDegisim(standart.tiers, prevStandartTiers),
            guvenirlik: guvenirlik
          };

          if (isOwn) ownActions.push(record); else competitorActions.push(record);

          prevStandartTiers = standart.tiers;
        });
      } catch (_err) { /* null-safe: tek firma×ürün hata verse devam */ }
    });

    _cache = { ownActions: ownActions, competitorActions: competitorActions, signature: sig };
    return { ownActions: ownActions, competitorActions: competitorActions };
  }

  // ──────────────────────────────────────────────────────────────────
  //  7) SORGU YARDIMCILARI
  // ──────────────────────────────────────────────────────────────────
  function getRecordsByGrup(ilacGrubu, ay) {
    var all = normalizeCompetitive().competitorActions;
    return all.filter(function (r) {
      return r.ilacGrubu === ilacGrubu && (!ay || r.ay === ay);
    });
  }

  function getRecordsByFirma(firma, urun) {
    var both = normalizeCompetitive();
    var all = both.ownActions.concat(both.competitorActions);
    return all.filter(function (r) { return r.firma === firma && r.urun === urun; });
  }

  function clearCache() {
    _cache = null;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.CompetitiveAdapter = {
    normalizeCompetitive: normalizeCompetitive,
    getIndirimPct: getIndirimPct,
    getMostGenerousTier: getMostGenerousTier,
    getRecordsByGrup: getRecordsByGrup,
    getRecordsByFirma: getRecordsByFirma,
    clearCache: clearCache,
    version: ADAPTER_VERSION
  };

  console.debug('[competitive-adapter] yüklendi. Versiyon:', ADAPTER_VERSION);

})();
