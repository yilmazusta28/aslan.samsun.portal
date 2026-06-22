// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/temporal-context-engine.js
//  İŞ KURALI — IMS Dönemsel Zaman Modeli (Temporal Intelligence)
//
//  Sorumluluk:
//    IMS'in h1..h9 alanlarının "yılın ilk N haftası" DEĞİL, "içinde
//    bulunulan 2 aylık hedef döneminin (cycle) haftaları" anlamına
//    geldiğini sisteme kazandırır. Tüm AI motorlarının (Forecast,
//    Recommendation, Opportunity, Coverage, RCA, Decision, Competitive
//    Intelligence) kullanması gereken TemporalContext'i üretir.
//
//  ⚠️ BU MOTOR KULLANICI TARAFINDAN VERİLEN BİR İŞ KURALININ DOĞRUDAN
//    UYGULANMASIDIR (konuşma içinde paylaşıldı, AI_MIMARI_ANALIZ_VE_
//    YOL_HARITASI.md'de YOKTU — roadmap'in FAZ 6.6 sırasında ortaya
//    çıkan "h1..h9'u takvime bağlayan mekanizma yok" bulgusunu ÇÖZER).
//    Kullanıcıyla birlikte doğrulanan somut referans noktaları:
//      • Bugün 21 Haziran 2026 (Pazar) → ISO hafta 25
//      • Mevcut IMS verisi 8-14 Haziran haftasına ait → ISO hafta 24
//      • dataLagWeeks = 25 - 24 = 1 (iş kuralı §3 ile birebir tutarlı)
//      • Cycle = Mayıs-Haziran (PERIODS'taki 'k1', 2026-05-01 — 2026-06-30)
//      • Cycle'ın 1. haftası = Mayıs'ın 1. haftası = ISO hafta 18
//      • imsDataWeek (cycle içindeki sıra) = 24 - 18 + 1 = 7
//    Bu üç değer (bugünün tarihi, IMS'teki en son dolu hafta, cycle
//    tanımları) ile JS'te ISO hafta hesabı yapılıp doğrulandı (Node testi,
//    kullanıcının verdiği rakamlarla BİREBİR eşleşti).
//
//  CYCLE TANIMLARI — js/core/date-utils.js::PERIODS İLE BİREBİR AYNI
//    tarih aralıkları (Ocak-Şubat, Mart-Nisan, Mayıs-Haziran, Temmuz-
//    Ağustos, Eylül-Ekim, Kasım-Aralık) — PERIODS DEĞİŞTİRİLMEDİ, bu
//    motor onu OKUR. Yeni bir taksonomi İCAT EDİLMEDİ.
//
//  HESAP MANTIĞI (kullanıcı onayıyla netleşti):
//    1. Bugünün tarihinden PERIODS'a bakarak hangi cycle'da olduğumuz bulunur.
//    2. Cycle başlangıç tarihinin ISO haftası = cycle'ın "1. haftası" (h1).
//       (h1 SABİTTİR — cycle başında h1'den başlar, kayan pencere DEĞİLDİR;
//       kullanıcı onayı: "h1 = cycle'ın sabit 1. haftası".)
//    3. IMS satırları taranır — TÜM satırlarda (is_mkt true/false ayrımı
//       yapılmadan) en az bir satırda sıfırdan farklı olan EN YÜKSEK h-
//       indeksi "mevcut IMS veri haftası" (cycle içi sıra) kabul edilir
//       (kullanıcı onayı: "IMS satırlarını tarayarak bul").
//    4. Gerçek ISO hafta = cycle'ın 1.hafta ISO numarası + (imsDataWeek - 1).
//    5. dataLagWeeks = bugünün ISO haftası - IMS verisinin ISO haftası.
//    6. cycleLength = cycle bitiş tarihinin ISO haftası - cycle'ın 1.hafta
//       ISO numarası + 1 (genelde 8 veya 9 — iş kuralı §1 ile tutarlı,
//       SABİT 9 DEĞİL, yıla göre değişebilir).
//    7. remainingWeeks = cycleLength - imsDataWeek.
//
//  STANDART TemporalContext MODELİ (iş kuralı §5'teki JSON şemasıyla
//  BİREBİR AYNI alan adları):
//    {
//      currentCycle: 'Mayıs-Haziran',
//      cycleKey: 'k1',                  // PERIODS'taki key (extra, RAW karşılaştırma için)
//      cycleWeek: 7,                    // = imsDataWeek (cycle içindeki sıra, IMS verisine göre)
//      cycleLength: 9,                  // o cycle'ın toplam hafta sayısı (8 veya 9)
//      remainingWeeks: 2,
//      isoWeek: 25,                     // BUGÜNÜN ISO haftası
//      imsDataWeek: 24,                 // IMS VERİSİNİN ISO haftası (dikkat: cycleWeek'ten
//                                       // farklı bir anlam — bu ISO YIL haftası, cycleWeek
//                                       // CYCLE İÇİ sıra; iş kuralı §5 örneğinde de bu ayrım var)
//      dataLagWeeks: 1,
//      lastIMSUpdate: null,             // bu motor BİLMEZ (dosya meta verisi yok) — null
//      nextExpectedIMSUpdate: 'Her Salı'// iş kuralı §4 sabiti
//    }
//
//  ⚠️ İSİM ÇAKIŞMASI UYARISI (iş kuralı §5 örneğindeki JSON ile BİREBİR
//    aynı alan adları kullanıldı, ama "isoWeek" VE "imsDataWeek" ikisi de
//    ISO YIL haftası anlamına gelir — "cycleWeek" ise CYCLE İÇİ sıra
//    anlamına gelir. Örnekte "Cycle Week: 6/8" ile "Yılın ISO Haftası: 14"
//    AYRI kavramlar olarak gösterilmişti, bu motor da bu ayrımı korur.
//
//  Public API:
//    getTemporalContext(referenceDate?) → TemporalContext (cache'li,
//                                          referenceDate verilmezse `new Date()`)
//    getCycleForDate(date)              → PERIODS elemanı | null
//    getCycleWeek1ISO(cycle)            → number (cycle başlangıcının ISO haftası)
//    getCycleLength(cycle)              → number (8 veya 9)
//    findLastFilledWeek(rows)           → number (1-9, IMS satırlarından
//                                          tespit edilen en son dolu h-indeksi)
//    clearCache()
//
//  Kurallar:
//    • PERIODS (js/core/date-utils.js) DEĞİŞTİRİLMEDİ — sadece okunur.
//    • IMS/GENEL parser'ları DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • Bu motor şu an hiçbir karar motoruna (Forecast/Recommendation/
//      Opportunity/Coverage/RCA/Decision/Competitive) henüz BAĞLANMADI —
//      iş kuralı §6'nın listelediği bağlama AYRI bir adımdır (her motor
//      kendi içinde TemporalContext'i okuyacak şekilde güncellenmeli,
//      bu motor sadece TemporalContext'i ÜRETİR).
//
//  Bağımlılık: js/core/date-utils.js (PERIODS), js/data/data-state.js (IMS)
//  Yükleme sırası: date-utils.js SONRASI; diğer AI motorlarından (Forecast/
//                  Opportunity/RCA/vb.) ÖNCE olmalı (onlar bunu okuyacak
//                  hale geldiğinde)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._TEMPORAL_CONTEXT_ENGINE_LOADED) {
    console.warn('[temporal-context-engine] Zaten yüklü — atlandı');
    return;
  }
  window._TEMPORAL_CONTEXT_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';
  var H_FIELDS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) ISO 8601 hafta hesabı — kullanıcının verdiği 3 referans noktasıyla
  //     doğrulandı (21 Haz 2026→25, 1 May 2026→18, 8 Haz 2026→24).
  // ──────────────────────────────────────────────────────────────────
  function _isoWeekInfo(d) {
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return { isoYear: date.getUTCFullYear(), isoWeek: weekNo };
  }

  function _dateStr(d) {
    return d.toISOString().slice(0, 10);
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) getCycleForDate(date) — PERIODS'tan ilgili 2 aylık dönemi bulur.
  //     PERIODS DEĞİŞTİRİLMEDİ, sadece okunur.
  // ──────────────────────────────────────────────────────────────────
  function getCycleForDate(date) {
    var periods = _safe(function () { return PERIODS || []; }, []);
    var dateStr = _dateStr(date);
    for (var i = 0; i < periods.length; i++) {
      if (dateStr >= periods[i].start && dateStr <= periods[i].end) return periods[i];
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) getCycleWeek1ISO(cycle) — h1'i temsil eden ISO hafta numarası:
  //     cycle başlangıcında veya sonrasındaki İLK TAM PAZARTESİ haftası.
  //     Kullanıcı onayı: Mayıs-Haziran cycle başlangıcı Mayıs 1 (Cuma),
  //     h1 = ISO 19 = 4-10 Mayıs (27 Nisan başlayan ISO 18 DEĞİL).
  // ──────────────────────────────────────────────────────────────────
  function getCycleWeek1ISO(cycle) {
    if (!cycle) return null;
    var startDate = new Date(cycle.start + 'T00:00:00');
    // Başlangıç Pazartesi ise 0 gün ekle, aksi halde sıradaki Pazartesi'ye ilerle
    var dow = startDate.getDay(); // 0=Pazar, 1=Pzt...6=Cmt
    var daysUntilMon = dow === 1 ? 0 : dow === 0 ? 1 : (8 - dow);
    var h1Monday = new Date(startDate);
    h1Monday.setDate(startDate.getDate() + daysUntilMon);
    return _isoWeekInfo(h1Monday).isoWeek;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) getCycleLength(cycle) — cycle'ın toplam hafta sayısı (8 veya 9,
  //     SABİT 9 DEĞİL — iş kuralı §1: "bazı yıllarda 9 hafta").
  // ──────────────────────────────────────────────────────────────────
  function getCycleLength(cycle) {
    if (!cycle) return null;
    var week1ISO = getCycleWeek1ISO(cycle);
    var endDate = new Date(cycle.end + 'T00:00:00');
    var endISO = _isoWeekInfo(endDate).isoWeek;
    // ISO yıl sınırını geçen cycle'lar (örn. Kasım-Aralık → yeni yılın
    // ISO 1. haftasına taşabilir) için endISO küçük çıkabilir — bu durumda
    // 52/53 haftalık yıl döngüsünü telafi et.
    if (endISO < week1ISO) {
      var endYear = _isoWeekInfo(endDate).isoYear;
      var weeksInYear = _isoWeeksInYear(endYear - 1);
      endISO += weeksInYear;
    }
    return endISO - week1ISO + 1;
  }

  function _isoWeeksInYear(year) {
    // ISO yılın kaç haftası olduğunu 31 Aralık'ın ISO haftasından bulur
    // (52 ya da 53 olabilir).
    var dec31 = new Date(Date.UTC(year, 11, 31));
    var info = _isoWeekInfo(dec31);
    return info.isoYear === year ? info.isoWeek : 52;
  }

  // ──────────────────────────────────────────────────────────────────
  //  5b) _isoWeekToRange(isoWeek, isoYear) — bir ISO hafta numarasının
  //      gerçek Pazartesi-Pazar tarih aralığını üretir (TR formatı).
  //      Kullanıcı onayıyla doğrulanan referans: ISO 24, 2026 → 08-14 Haziran.
  // ──────────────────────────────────────────────────────────────────
  var TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
                   'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

  function _isoWeekToRange(isoWeek, isoYear) {
    // ISO yılın 1. haftasının Pazartesi'sini bul
    var jan4 = new Date(Date.UTC(isoYear, 0, 4));
    var jan4Day = jan4.getUTCDay() || 7;
    var week1Mon = new Date(jan4);
    week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

    // İstenen hafta'nın Pazartesi'si
    var mon = new Date(week1Mon);
    mon.setUTCDate(week1Mon.getUTCDate() + (isoWeek - 1) * 7);

    var sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);

    function fmt(d) {
      return d.getUTCDate() + ' ' + TR_MONTHS[d.getUTCMonth()];
    }
    return {
      start: mon.toISOString().slice(0,10),
      end:   sun.toISOString().slice(0,10),
      label: fmt(mon) + ' – ' + fmt(sun)  // örn. "8 Haziran – 14 Haziran"
    };
  }

  // hN → tarih aralığı haritası: { h1: {start,end,label}, ..., hN: {...} }
  // Sadece IMS'te mevcut olan (1..lastFilledIdx) haftalar için üretilir.
  function _buildWeekDateRanges(cycleWeek1ISO, lastFilledIdx, isoYear) {
    var map = {};
    for (var n = 1; n <= lastFilledIdx; n++) {
      var isoW = cycleWeek1ISO + n - 1;
      // ISO yıl sınırını geçerse bir sonraki yıla geç
      var yr = isoYear;
      var weeksInYear = _isoWeeksInYear(yr);
      if (isoW > weeksInYear) { isoW -= weeksInYear; yr++; }
      map['h' + n] = _isoWeekToRange(isoW, yr);
    }
    return map;
  }


  //     satırda sıfırdan farklı olan EN YÜKSEK h-indeksini bulur
  //     (kullanıcı onayı: "IMS satırlarını tarayarak bul").
  // ──────────────────────────────────────────────────────────────────
  function findLastFilledWeek(rows) {
    if (!rows || !rows.length) return 0;
    var maxIdx = 0;
    rows.forEach(function (r) {
      for (var i = H_FIELDS.length - 1; i >= 0; i--) {
        var v = r[H_FIELDS[i]];
        if (v && v !== 0) {
          if ((i + 1) > maxIdx) maxIdx = i + 1; // 1-tabanlı (h1=1, h9=9)
          break; // bu satır için en yüksek dolu alanı bulduk, sıradaki satıra geç
        }
      }
    });
    return maxIdx;
  }

  // ──────────────────────────────────────────────────────────────────
  //  6) ANA API — getTemporalContext(referenceDate)
  // ──────────────────────────────────────────────────────────────────
  var _cache = null; // { context, signature }

  function _dataSignature(rows, refDate) {
    return (rows ? rows.length : 0) + '|' + _dateStr(refDate);
  }

  function getTemporalContext(referenceDate) {
    var refDate = referenceDate || new Date();

    var imsRows = _safe(function () { return IMS || []; }, []);
    var sig = _dataSignature(imsRows, refDate);
    if (_cache && _cache.signature === sig) return _cache.context;

    var cycle = getCycleForDate(refDate);
    if (!cycle) {
      // Tanımlı hiçbir cycle'a düşmüyor (örn. PERIODS eksik/boş) — null-safe boş context
      var emptyCtx = {
        currentCycle: null, cycleKey: null, cycleWeek: null, cycleLength: null,
        remainingWeeks: null, isoWeek: _isoWeekInfo(refDate).isoWeek, imsDataWeek: null,
        dataLagWeeks: null, lastIMSUpdate: null, nextExpectedIMSUpdate: 'Her Salı'
      };
      _cache = { context: emptyCtx, signature: sig };
      return emptyCtx;
    }

    var cycleWeek1ISO = getCycleWeek1ISO(cycle);

    var lastFilledIdx = findLastFilledWeek(imsRows);
    // ISO yıl: cycle başlangıcının yılını kullan
    var cycleStartYear = parseInt(cycle.start.slice(0,4), 10);

    // Her yüklenmiş hN için gerçek tarih aralığı haritası
    var weekDateRanges = lastFilledIdx > 0
      ? _buildWeekDateRanges(cycleWeek1ISO, lastFilledIdx, cycleStartYear)
      : {};

    // İMS verisinin ISO hafta numarası ve tarih aralığı
    var imsDataISOWeek = lastFilledIdx > 0 ? (cycleWeek1ISO + lastFilledIdx - 1) : null;
    var imsDataWeekRange = imsDataISOWeek
      ? _isoWeekToRange(imsDataISOWeek, cycleStartYear)
      : null;

    var todayISOWeek = _isoWeekInfo(refDate).isoWeek;
    var dataLagWeeks = (imsDataISOWeek != null) ? (todayISOWeek - imsDataISOWeek) : null;

    // cycleLength: ISO takvim matematiği yerine SADECE yüklenmiş veriden
    // gözlemlenen hafta sayısı — kısmi son hafta sorunu tamamen ortadan
    // kalkar (kullanıcı açıklaması: "sadece yüklenen verileri dikkate al").
    // null döndürmek yerine gözlemlenen değer + açık bir flag ekledik.
    var cycleWeeksObserved = lastFilledIdx || null;
    var remainingWeeks = null; // cycle bitmeden kaç hafta kaldığı bilinemez
                               // (toplam hafta sayısı dosyadan çıkarılamıyor,
                               //  her Salı yeni yüklemeyle güncellenir)

    var context = {
      currentCycle: cycle.months || cycle.label || null,
      cycleKey: cycle.key || null,
      cycleWeek: lastFilledIdx || null,        // cycle içi sıra (IMS'ten gözlemlenen)
      cycleWeeksObserved: cycleWeeksObserved,  // şimdiye kadar kaç hafta yüklendi
      cycleLength: null,                       // bilinmiyor (kısmi hafta sorunu — bkz. açıklama)
      remainingWeeks: remainingWeeks,          // bilinmiyor (cycleLength bilinmediği için)
      isoWeek: todayISOWeek,                   // BUGÜNÜN ISO haftası
      imsDataWeek: imsDataISOWeek,             // IMS verisinin ISO yıl haftası
      imsDataWeekRange: imsDataWeekRange,       // ör. {start:'2026-06-08', end:'2026-06-14', label:'8 Haziran – 14 Haziran'}
      weekDateRanges: weekDateRanges,           // h1..hN → tarih aralıkları
      dataLagWeeks: dataLagWeeks,
      lastIMSUpdate: imsDataWeekRange ? imsDataWeekRange.label : null, // en iyi tahmin
      nextExpectedIMSUpdate: 'Her Salı'
    };

    _cache = { context: context, signature: sig };
    return context;
  }

  function clearCache() {
    _cache = null;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.TemporalContextEngine = {
    getTemporalContext: getTemporalContext,
    getCycleForDate: getCycleForDate,
    getCycleWeek1ISO: getCycleWeek1ISO,
    getCycleLength: getCycleLength,
    findLastFilledWeek: findLastFilledWeek,
    clearCache: clearCache,
    version: ENGINE_VERSION
  };

  console.debug('[temporal-context-engine] yüklendi. Versiyon:', ENGINE_VERSION);

})();
