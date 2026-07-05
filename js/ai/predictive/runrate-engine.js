// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/runrate-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//
//  Sorumluluk: Günlük satış hızı (run rate) hesabı
//    • calculateRunRate(ttt) → { dailyRunRate, projectedMonthEnd, confidence }
//
//  Yöntem:
//    current_sales / elapsed_work_days = günlük hız
//    günlük hız × toplam_dönem_iş_günü = dönem sonu projeksiyonu
//
//  ✅ YENİ — historicalContext alanı (opsiyonel, salt-okunur):
//    js/ai/core/period-archive-adapter.js yüklüyse, 6 aylık arşivdeki bir
//    önceki dönemin final realizasyonunu ekler. Mevcut confidence
//    FORMÜLÜNE dokunulmadı — sadece bilgilendirme amaçlı ek alandır.
//
//  Bağımlılık:
//    js/data/data-state.js  (GENEL, IMS)
//    js/core/date-utils.js  (PERIODS, workDays, HOLIDAYS)
//    js/core/constants.js   (IMS_TL_MAP, URUN_ORDER)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, PERIODS, workDays, IMS_TL_MAP, URUN_ORDER */

(function () {
  'use strict';

  // ── _currentPeriod ────────────────────────────────────────
  // Bugünün tarihine göre aktif dönemi döndürür.
  // @returns {{ label, start, end }|null}
  function _currentPeriod() {
    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
    for (var i = 0; i < periods.length; i++) {
      if (todayStr >= periods[i].start && todayStr <= periods[i].end) {
        return periods[i];
      }
    }
    // Dönem bulunamazsa en yakın gelecek dönemi döndür
    for (var j = 0; j < periods.length; j++) {
      if (todayStr < periods[j].start) return periods[j];
    }
    return periods[periods.length - 1] || null;
  }

  // ── _safeWorkDays ─────────────────────────────────────────
  // workDays() wrapper — hata durumunda takvim günü farkı döner.
  function _safeWorkDays(start, end) {
    try {
      if (typeof workDays === 'function') return workDays(start, end);
    } catch (e) { /* fall through */ }
    // Fallback: takvim farkı × 0.71 (hafta içi oranı)
    var ms = new Date(end) - new Date(start);
    return Math.max(1, Math.round(ms / 86400000 * 0.71));
  }

  // ── _confidence ───────────────────────────────────────────
  // Güven skoru: TAHMİN KESİNLİĞİ (ne kadar veri toplanmış)
  // ≠ hedef başarı olasılığı (o ayrı hesaplanır).
  // Dönem ilerlemesi + haftalık veri varlığına göre 0-85 arası döner.
  // MAX 85: "Kesin tahmin yapılamaz" mesajını önlemek için tavan düşük tutuldu.
  // FIX-CONF-01: artık realizasyon durumunu da faktör olarak alıyor.
  function _confidence(elapsedDays, totalDays, hasWeeklyData, projReal, hedefReal) {
    if (totalDays === 0) return 0;
    var progress = elapsedDays / totalDays;

    // Zaman bazlı baz skor (metodolojik kesinlik)
    var base;
    if      (progress >= 0.75) base = 75;
    else if (progress >= 0.50) base = 60;
    else if (progress >= 0.25) base = 45;
    else if (progress >= 0.10) base = 30;
    else                        base = 15;

    // Haftalık IMS verisi yoksa kesinlik düşer
    if (!hasWeeklyData) base = Math.round(base * 0.65);

    // Projeksiyon ve gerçekleşme arasındaki uçurum büyükse kesinlik düşer
    // (gerçekleşme %37 iken projeksiyon %123 gösteriyorsa güven OLAMAZ yüksek)
    if (typeof projReal === 'number' && typeof hedefReal === 'number') {
      var gap = Math.abs(projReal - hedefReal);
      if (gap > 50) base = Math.round(base * 0.5);
      else if (gap > 30) base = Math.round(base * 0.7);
      else if (gap > 15) base = Math.round(base * 0.85);
    }

    // Tavan 82: hiçbir zaman "neredeyse kesin" görünmesin
    return Math.min(82, Math.max(5, base));
  }

  // ── _lastFilledWeek ───────────────────────────────────────
  // GENEL TOPLAM satırındaki h1..h9 haftalık TL kolonlarından en son
  // (en yüksek indexli) DOLU olan haftayı döndürür. 0 = hiç veri yok.
  function _lastFilledWeek(gt) {
    if (!gt) return 0;
    var weeks = [gt.h9, gt.h8, gt.h7, gt.h6, gt.h5, gt.h4, gt.h3, gt.h2, gt.h1];
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i] && weeks[i] > 0) return 9 - i;
    }
    return 0;
  }

  // ── _resolveDataPeriod ─────────────────────────────────────
  // FIX-RR-03 (KÖK NEDEN DÜZELTMESİ) — kullanıcı geri bildirimiyle tespit edildi:
  //
  // Sorun: _currentPeriod() SADECE takvim tarihine bakıyor. Ama gerçek hayatta
  // veri girişi takvimden ~1 hafta geriden gidiyor: takvim "4.Dönem
  // (Temmuz–Ağustos) başladı, 3 iş günü geçti" dese de, GENEL_TABLO'ya henüz
  // 4.Dönem'in hedefleri/verisi YÜKLENMEMİŞ olabilir — sistemde hâlâ ÖNCEKİ
  // dönemin (örn. 1.Kompanzasyon, Mayıs–Haziran) neredeyse tamamlanmış verisi
  // (h8/h9 haftaları dolu, satis_tl hedefin ~%90'ı gibi) durmaktadır.
  //
  // Bu durumda calculateRunRate "3 iş günü içinde neredeyse tam bir dönemlik
  // satış yapılmış" sanıp günlük hızı inanılmaz şişiriyor ve 40+ kalan güne
  // yayınca projeksiyon %1000+ gibi anlamsız seviyelere çıkıyor.
  //
  // Tespit yöntemi: haftalık kolonlardaki (h1..h9) EN SON DOLU hafta, takvim
  // dönemine göre "olması gereken" haftadan çok ileride ise (örn. takvimde
  // 1. haftadayız ama veri 8. haftayı gösteriyor), bu verinin hâlâ ÖNCEKİ
  // döneme ait olduğu anlaşılır. Bu durumda:
  //   • Gün hesabı (elapsedDays/totalDays/remainingDays) ÖNCEKİ dönem baz
  //     alınarak yapılır,
  //   • O dönem veri bazında "kapanmış" sayılır (remainingDays sıfırlanır) —
  //     yani ileri projeksiyon YAPILMAZ, sadece mevcut gerçekleşme raporlanır.
  //     (4.Dönem'in hedefleri sisteme girilmeden 4.Dönem için projeksiyon
  //     üretmek zaten anlamsız.)
  //
  // Yeni dönemin gerçek verisi gelmeye başladığında (h1 dolu, ileri haftalar
  // boş) bu fonksiyon otomatik olarak takvim dönemine geri döner.
  function _resolveDataPeriod(calPeriod, genelTotal) {
    var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
    var calIdx = -1;
    for (var i = 0; i < periods.length; i++) {
      if (periods[i] === calPeriod || periods[i].key === calPeriod.key) { calIdx = i; break; }
    }
    if (calIdx <= 0 || !genelTotal) return { period: calPeriod, dataStale: false };

    try {
      var totalDaysCal = _safeWorkDays(calPeriod.start, calPeriod.end);
      var todayStr2    = new Date().toISOString().slice(0, 10);
      var elapsedCal   = _safeWorkDays(calPeriod.start,
        todayStr2 < calPeriod.start ? calPeriod.start :
        todayStr2 > calPeriod.end   ? calPeriod.end   : todayStr2);

      // Takvim ilerlemesine göre "olması gereken" hafta (9 haftalık bölümleme, kabaca)
      var expectedWeek = Math.max(1, Math.ceil((elapsedCal / Math.max(1, totalDaysCal)) * 9));
      var lastFilled   = _lastFilledWeek(genelTotal);

      // Veri, beklenenden 3+ hafta ileride ise → hâlâ önceki döneme ait.
      if (lastFilled - expectedWeek >= 3) {
        return { period: periods[calIdx - 1], dataStale: true };
      }
    } catch (e) { /* silent — belirsizlikte takvim dönemine güven */ }

    return { period: calPeriod, dataStale: false };
  }

  // ── calculateRunRate ──────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   dailyRunRate:      number,   // günlük ortalama TL satış
  //   projectedMonthEnd: number,   // dönem sonu projeksiyon TL
  //   projectedRealization: number,// hedef realizasyon % tahmini
  //   elapsedDays:       number,
  //   remainingDays:     number,
  //   totalDays:         number,
  //   periodLabel:       string,
  //   confidence:        number,
  //   note:              string
  // }}
  function calculateRunRate(ttt) {
    var result = {
      dailyRunRate:          0,
      projectedMonthEnd:     0,
      projectedRealization:  0,
      elapsedDays:           0,
      remainingDays:         0,
      totalDays:             0,
      periodLabel:           '—',
      confidence:            0,
      note:                  'Veri yetersiz.',
      dataStale:             false, // FIX-RR-03: veri hâlâ önceki döneme aitse true
      historicalContext:     null   // 6 Aylık Arşiv — bkz. period-archive-adapter.js
    };

    try {
      // ── Takvime göre dönem ────────────────────────────────
      var calPeriod = _currentPeriod();
      if (!calPeriod) { result.note = 'Aktif dönem bulunamadı.'; return result; }

      // ── Mevcut satış (GENEL TOPLAM) — dönem çözümlemesi için önce alınır ──
      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      // ── FIX-RR-03: takvim dönemi ile GERÇEK veri hangi döneme aitse onu kullan ──
      var resolved = _resolveDataPeriod(calPeriod, genelTotal);
      var period   = resolved.period;
      result.dataStale = resolved.dataStale;

      var todayStr   = new Date().toISOString().slice(0, 10);
      var totalDays  = _safeWorkDays(period.start, period.end);
      // Veri hâlâ önceki döneme aitse (dataStale), o dönem veri bazında
      // "kapanmış" sayılır: elapsed=total, remaining=0 → ileri projeksiyon
      // yapılmaz, sadece mevcut gerçekleşme raporlanır.
      var elapsedDays = resolved.dataStale
        ? totalDays
        : _safeWorkDays(period.start,
            todayStr < period.start ? period.start :
            todayStr > period.end   ? period.end   : todayStr);
      var remainingDays = Math.max(0, totalDays - elapsedDays);

      result.periodLabel  = period.label + (resolved.dataStale ? ' (veri — takvim henüz ' + calPeriod.label + ')' : '');
      result.totalDays    = totalDays;
      result.elapsedDays  = elapsedDays;
      result.remainingDays = remainingDays;

      if (elapsedDays === 0) {
        result.note = 'Dönem henüz başlamadı.';
        result.confidence = 15;
        return result;
      }

      var currentTL = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var _hedefRaw = genelTotal ? (genelTotal.hedef_tl || 0) : 0;
      // FIX-RR-01: hedef_tl=0 ama tl_pct>0 ise geri hesapla (Phase 3.0.3 fix)
      var hedefTL = (_hedefRaw === 0 && (genelTotal ? (genelTotal.tl_pct || 0) : 0) > 0 && currentTL > 0)
        ? Math.round(currentTL / ((genelTotal.tl_pct || 1) / 100))
        : _hedefRaw;

      // ── Haftalık IMS verisi var mı? ───────────────────────
      var imsRows = (typeof IMS !== 'undefined' ? IMS : [])
        .filter(function (r) { return r.ttt === ttt; });
      var hasWeeklyData = imsRows.length > 0;

      // ── Günlük run rate (ham gözlem — diğer motorlar bunu kullanıyor,
      //    dokunulmadı) ──────────────────────────────────────
      var dailyRate = elapsedDays > 0 ? currentTL / elapsedDays : 0;

      // ── FIX-RR-02 (BUG DÜZELTMESİ) ─────────────────────────────────
      // Sorun: Dönemin ilk günlerinde (örn. yeni dönemin 1-5. iş günü)
      // "kutu yüklemesi" (sell-in) nedeniyle satış geçici olarak çok
      // yüksek görünebilir. Bu ham günlük hız hiç yumuşatılmadan kalan
      // TÜM güne (örn. 40+ iş günü) sabit kabul edilip lineer çarpılınca
      // projeksiyon gerçekçi olmayan seviyelere sıçrıyor (gözlenen örnek:
      // ekip forecast %1377). 3 günlük bir örneklemle 40+ günlük bir
      // projeksiyon yapmak istatistiksel olarak güvenilir değil — ve bu
      // tek temsilcinin sapması ekip ortalamasını da bozabiliyor.
      //
      // Düzeltme: Projeksiyonda kullanılan hız, gözlem miktarına göre
      // ağırlıklandırılıyor. Az gün geçtiyse (RELIABLE_DAYS eşiğinin
      // altında) ham hıza tam güvenmek yerine "hedefe zamanında ulaşmak
      // için gereken günlük hız" (hedefTL / totalDays) ile harmanlanıyor;
      // gözlem arttıkça (RELIABLE_DAYS'e ulaşınca tam güven) ham hıza
      // kayıyor. NOT: dailyRunRate alanı hâlâ HAM gözlemi döndürüyor —
      // diğer motorlar (coach/simulator) "şu an günde ne kadar satıyorsun"
      // bilgisini ham olarak kullanmaya devam ediyor; sadece dönem sonu
      // PROJEKSİYONU yumuşatılıyor.
      var RELIABLE_DAYS   = 10; // ~2 hafta iş günü — bu noktadan sonra ham hıza tam güven
      var obsWeight        = Math.min(1, elapsedDays / RELIABLE_DAYS);
      var targetPaceRate    = hedefTL > 0 ? (hedefTL / totalDays) : dailyRate;
      var effectiveDailyRate = (dailyRate * obsWeight) + (targetPaceRate * (1 - obsWeight));

      // ── Projeksiyon: mevcut + kalan günler × yumuşatılmış (efektif) hız ──
      var projected = currentTL + (effectiveDailyRate * remainingDays);

      // ── Realizasyon tahmini ──────────────────────────────
      var projReal    = hedefTL > 0 ? (projected / hedefTL) * 100 : 0;
      var currentReal = hedefTL > 0 ? (currentTL / hedefTL) * 100 : 0;

      result.dailyRunRate          = Math.round(dailyRate);
      result.projectedMonthEnd     = Math.round(projected);
      result.projectedRealization  = Math.round(projReal * 10) / 10;
      // FIX-CONF-01: pass projReal and currentReal so confidence reflects the gap
      result.confidence            = _confidence(elapsedDays, totalDays, hasWeeklyData, projReal, currentReal);

      result.note = 'Günlük run rate: ₺' + Math.round(dailyRate).toLocaleString('tr-TR') +
        ' | ' + elapsedDays + '/' + totalDays + ' iş günü geçti.';

      // ── 6 Aylık Arşiv — Önceki Dönem Bağlamı (YENİ) ─────────────
      // Mevcut confidence FORMÜLÜNE dokunulmadı (kasıtlı — bkz. FIX-CONF-01
      // yorumu, formül önceden titizlikle ayarlandı). Bu blok sadece
      // BİLGİLENDİRME amaçlı salt-okunur bir alan ekler; period-archive-
      // adapter.js yüklü değilse veya arşiv boşsa sessizce null kalır.
      if (window.PeriodArchiveAdapter && typeof window.PeriodArchiveAdapter.getPreviousArchivedPeriod === 'function') {
        var prevPeriodRR = window.PeriodArchiveAdapter.getPreviousArchivedPeriod(ttt);
        if (prevPeriodRR && prevPeriodRR.genelTotal) {
          result.historicalContext = {
            previousPeriodLabel: prevPeriodRR.label,
            previousRealization: prevPeriodRR.genelTotal.tl_pct || 0,
            currentRealization:  currentReal
          };
        }
      }

    } catch (e) {
      console.warn('[runrate-engine] calculateRunRate hata:', e.message);
      result.note = 'Hesaplama hatası: ' + e.message;
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.calculateRunRate = calculateRunRate;
  // period helper — diğer modüller kullanabilir
  window._rrCurrentPeriod = _currentPeriod;

  console.debug('[runrate-engine] Phase 3.1 yüklendi.');

})();
