// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/order-forecast-engine.js — FAZ 12.x (kullanıcı isteği)
//  Ürün Bazlı Sipariş Zamanlaması Motoru
//
//  Sorumluluk:
//    pharmacy-behavior-engine.js (FAZ 9.1) eczane SEVİYESİNDE (tüm ürünler
//    birleşik) "sıradaki sipariş ne zaman" hesabı yapıyor. Bu dosya AYNI,
//    doğrulanmış takvim-bazlı döngü mantığını (bkz. pharmacy-behavior-
//    engine.js içindeki avgCycle düzeltmesi) ÜRÜN BAZINDA tekrarlar —
//    yani "bu eczane PANOCER'i ne zaman, ACİDPASS'i ne zaman sipariş
//    verecek" sorusunu ayrı ayrı cevaplar. Kod tekrarını önlemek için
//    döngü/tarih hesabı window.PharmacyBehaviorEngine'in dışa açtığı
//    yardımcılardan (calcAvgCycleFromCalendar, monthToDate, daysSinceMonth)
//    devralınır — mantık İKİ YERDE AYRI AYRI YAZILMAZ.
//
//    buildProductOrderForecast(tttFilter) → eczane × ürün bazlı tam liste
//    buildTop15OrderForecast(tttFilter)   → alış zamanına göre sıralı ilk 15
//    renderTop15OrderForecastCard(id, tttFilter) → kart HTML'i basar
//
//  Veri kaynağı: window.PharmacyAdapter.normalizePharmacy(tttFilter)
//    → her eczane için monthsByProduct: { URUN: { 'MM/YYYY': kutu } }
//
//  Yükleme sırası: pharmacy-adapter.js VE pharmacy-behavior-engine.js
//  SONRASI (ikisine de bağımlı).
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  function _monthNum(m) {
    var p = m.split('/');
    return parseInt(p[1], 10) * 12 + parseInt(p[0], 10);
  }

  function _fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // ── Tek bir eczane × ürün serisi için döngü/tarih hesabı ──────────────
  // pharmacy-behavior-engine.js'teki eczane-seviyesi hesapla AYNI mantık
  // (avgCycle: ardışık aktif aylar arası gerçek takvim günü ortalaması;
  // stockMultiplier: son sipariş, önceki ortalamanın kaç katıysa döngü o
  // oranda uzatılır, 4 kat ile sınırlı).
  function _productForecast(monthsObj, BE) {
    var months = Object.keys(monthsObj || {}).sort(function (a, b) {
      return _monthNum(a) - _monthNum(b);
    });
    // EN AZ 3 aktif ay şartı (2 değil): sadece 2 sipariş noktasından
    // hesaplanan döngü tek bir tesadüfi boşluğa aşırı duyarlı olabiliyor
    // (ör. eczane 1 yıl önce 2 ay üst üste sipariş verip sonra hiç
    // sipariş vermemişse, "kısa döngü" yanılgısı oluşur).
    if (months.length < 3) return null;

    var vals = months.map(function (m) { return monthsObj[m] || 0; });
    var lastMonth = months[months.length - 1];
    var lastVal   = vals[vals.length - 1];
    var priorVals = vals.slice(0, -1).filter(function (v) { return v > 0; });
    var totalAll  = vals.reduce(function (s, v) { return s + v; }, 0);
    var priorAvg  = priorVals.length
      ? priorVals.reduce(function (s, v) { return s + v; }, 0) / priorVals.length
      : totalAll / vals.length;

    var stockMultiplier = (priorAvg > 0 && lastVal > priorAvg)
      ? Math.min(4, lastVal / priorAvg) : 1;

    var avgCycle       = BE.calcAvgCycleFromCalendar(months);
    var effectiveCycle = Math.round(avgCycle * stockMultiplier);
    var daysSince       = BE.daysSinceMonth(lastMonth);

    // ÖNEMLİ: pharmacy-behavior-engine.js'teki eczane-seviyesi alanların
    // aksine (orada daysToNextOrder>=0 olarak kırpılıyor, çünkü decision-
    // engine.js'in 30-günlük VISIT_NOW penceresi negatif olmayan bir değer
    // bekliyor), BURADA kasıtlı olarak HAM (negatif olabilen) farkı
    // kullanıyoruz. Neden: bu kart "alış zamanına göre sırala" istiyor —
    // kırpılmış değerle onlarca gecikmiş eczane hepsi "0 gün / bugün"
    // etiketinde üst üste yığılır ve sıralama anlamsızlaşır. Ham farkla
    // "12 gün gecikmiş" ile "38 gün gecikmiş" ayrışabiliyor, tarih de
    // geçmişte gösterilebiliyor (daha dürüst: "bu sipariş X gün önce
    // beklenmesi gerekiyordu").
    var rawDaysToNext = effectiveCycle - daysSince;

    var eod = new Date();
    eod.setDate(eod.getDate() + rawDaysToNext);

    return {
      lastMonth:        lastMonth,
      lastQty:          lastVal,
      avgQty:           Math.round(totalAll / vals.length),
      activeMonths:     vals.length,
      avgCycleDays:     avgCycle,
      effectiveCycleDays: effectiveCycle,
      daysSinceLastOrder: daysSince,
      daysToNextOrder:  rawDaysToNext,   // negatif olabilir → gecikmiş sipariş
      expectedOrderDate: _fmtDate(eod)
    };
  }

  // ── Eczane × Ürün bazlı tam liste ──────────────────────────────────────
  function buildProductOrderForecast(tttFilter) {
    if (!window.PharmacyAdapter || typeof window.PharmacyAdapter.normalizePharmacy !== 'function') return [];
    if (!window.PharmacyBehaviorEngine || typeof window.PharmacyBehaviorEngine.calcAvgCycleFromCalendar !== 'function') return [];
    var BE = window.PharmacyBehaviorEngine;

    var records = window.PharmacyAdapter.normalizePharmacy(tttFilter) || [];
    var out = [];

    records.forEach(function (r) {
      try {
        var productForecasts = [];
        Object.keys(r.monthsByProduct || {}).forEach(function (urun) {
          var f = _productForecast(r.monthsByProduct[urun], BE);
          if (!f) return;
          // ÇAKMA FİLTRESİ (kendi eklemem): beklenen döngünün TAM 1 katından
          // daha fazla gecikmiş bir sipariş, "yakında sipariş verecek"
          // değil, "muhtemelen pasif/kaybedilmiş müşteri" demektir — bu
          // liste bir SIPARIŞ TAKVİMİ, churn/reaktivasyon listesi değil
          // (o zaten ayrı yerde: AT_RISK/REACTIVATION sınıflandırması).
          // Karıştırırsak liste 1+ yıllık ölü hesaplarla dolar, gerçekten
          // aksiyon alınabilecek yakın tarihli satırlar kaybolur.
          if (f.daysToNextOrder < -f.effectiveCycleDays) return;
          f.product = urun;
          productForecasts.push(f);
        });
        if (!productForecasts.length) return;

        // Eczane içindeki ürünleri BUGÜNE olan mutlak yakınlığa göre sırala
        // (aşağıdaki eczaneler-arası sıralamayla aynı mantık — bkz. not).
        productForecasts.sort(function (a, b) {
          return Math.abs(a.daysToNextOrder) - Math.abs(b.daysToNextOrder);
        });

        out.push({
          gln:            r.gln,
          eczane:         r.eczane,
          brick:          r.brick,
          representative: r.representative,
          nearestExpectedOrderDate: productForecasts[0].expectedOrderDate,
          nearestDaysToNextOrder:   productForecasts[0].daysToNextOrder,
          nearestProduct:           productForecasts[0].product,
          products: productForecasts
        });
      } catch (_e) { /* null-safe — bir eczane hata verirse listenin geri kalanını etkilemesin */ }
    });

    // KENDİ ÖNERİM (kullanıcıyla test edilerek karara bağlandı): sıralama
    // ham tarihe göre (artan) değil, BUGÜNE OLAN MUTLAK YAKINLIĞA göre
    // yapılıyor. Neden: ham artan sıralamada liste ya sadece "çoktan çok
    // gecikmiş" (churn'e yakın) ya da sadece "aylar sonrası" eczanelerle
    // doluyor — ikisi de sahada BU HAFTA ne yapılacağı sorusuna cevap
    // vermiyor. Mutlak yakınlık, "az önce siparişi kaçırmış" ile "birkaç
    // gün içinde sipariş verecek" eczaneleri AYNI önem sırasına koyarak,
    // gerçekten bu hafta odaklanılması gereken eczaneleri öne çıkarıyor.
    out.sort(function (a, b) {
      return Math.abs(a.nearestDaysToNextOrder) - Math.abs(b.nearestDaysToNextOrder);
    });

    return out;
  }

  // ── Alış zamanına göre sıralı ilk 15 ───────────────────────────────────
  // mode: 'all' (varsayılan, bugüne mutlak yakınlık) | 'overdue' (sadece
  // gecikmiş, en çok gecikmiş önce) | 'upcoming' (sadece yaklaşan, en
  // yakın önce). Filtre PHARMACY seviyesinde uygulanır (nearestDaysToNextOrder),
  // ürün satırları her zaman kendi içinde mutlak yakınlığa göre sıralı kalır.
  function buildTop15OrderForecast(tttFilter, mode) {
    mode = mode || 'all';
    var all = buildProductOrderForecast(tttFilter);
    var filtered = all;

    if (mode === 'overdue') {
      filtered = all
        .filter(function (p) { return p.nearestDaysToNextOrder < 0; })
        .sort(function (a, b) { return a.nearestDaysToNextOrder - b.nearestDaysToNextOrder; }); // en çok gecikmiş önce
    } else if (mode === 'upcoming') {
      filtered = all
        .filter(function (p) { return p.nearestDaysToNextOrder >= 0; })
        .sort(function (a, b) { return a.nearestDaysToNextOrder - b.nearestDaysToNextOrder; }); // en yakın önce
    }
    // mode === 'all' → zaten buildProductOrderForecast'ta mutlak yakınlığa göre sıralı

    return filtered.slice(0, 15);
  }

  // ── Kart render ─────────────────────────────────────────────────────────
  function _urgencyMeta(daysToNext) {
    if (daysToNext < 0)   return { color: '#DC2626', label: 'Gecikmiş — ' + Math.abs(daysToNext) + ' gün önce beklendi' };
    if (daysToNext === 0) return { color: '#DC2626', label: 'Bugün' };
    if (daysToNext <= 7)  return { color: '#DC2626', label: daysToNext + ' gün sonra' };
    if (daysToNext <= 21) return { color: '#D97706', label: daysToNext + ' gün sonra' };
    return { color: '#16A34A', label: daysToNext + ' gün sonra' };
  }

  // Filtre butonlarının tıklanınca hangi container/tttFilter'ı yeniden
  // render edeceğini bilmesi için son render bağlamı hatırlanır.
  var _lastCtx = { containerId: null, tttFilter: null, mode: 'all' };

  var FILTER_LABELS = { all: 'Tümü', overdue: 'Gecikmiş', upcoming: 'Yaklaşan' };

  function _renderFilterBar(mode) {
    var btns = ['all', 'overdue', 'upcoming'].map(function (m) {
      var active = m === mode;
      return '<button type="button" onclick="OrderForecastEngine.setFilterMode(\'' + m + '\')" '
        + 'style="font-size:10px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;'
        + 'border:1px solid ' + (active ? '#2563EB' : 'var(--border)') + ';'
        + 'background:' + (active ? '#2563EB' : 'transparent') + ';'
        + 'color:' + (active ? '#fff' : 'var(--dim)') + '">'
        + FILTER_LABELS[m] + '</button>';
    }).join('');
    return '<div style="display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border)">' + btns + '</div>';
  }

  // Filtre değişince dışarıdan (buton onclick'i) çağrılır — index.html'e
  // dokunmadan, en son render edilen container/tttFilter'ı hatırlayarak
  // yeniden çizer.
  function setFilterMode(mode) {
    if (!_lastCtx.containerId) return;
    renderTop15OrderForecastCard(_lastCtx.containerId, _lastCtx.tttFilter, mode);
  }

  function renderTop15OrderForecastCard(containerId, tttFilter, mode) {
    var el = document.getElementById(containerId);
    if (!el) return;

    mode = mode || 'all';
    _lastCtx = { containerId: containerId, tttFilter: tttFilter, mode: mode };

    var list = buildTop15OrderForecast(tttFilter, mode);
    var filterBar = _renderFilterBar(mode);

    if (!list.length) {
      el.innerHTML = filterBar
        + '<div style="padding:16px;color:var(--dim);font-size:12px;text-align:center">'
        + (mode === 'all'
            ? 'Henüz yeterli veri yok — ürün bazlı tahmin için en az 3 aylık sipariş geçmişi gerekir.'
            : 'Bu filtreye uyan eczane yok (' + FILTER_LABELS[mode] + ').')
        + '</div>';
      return;
    }

    var rows = list.map(function (p, i) {
      var urg = _urgencyMeta(p.nearestDaysToNextOrder);
      var productLines = p.products.slice(0, 3).map(function (pf) {
        var u = _urgencyMeta(pf.daysToNextOrder);
        return '<div style="font-size:10px;line-height:1.65;white-space:nowrap">'
          + '<b>' + pf.product + '</b> — ~' + pf.avgQty + ' kutu '
          + '<span style="color:' + u.color + ';font-weight:600">(' + pf.expectedOrderDate + ')</span>'
          + '</div>';
      }).join('');
      var extra = p.products.length > 3
        ? '<div style="font-size:9px;color:var(--dim)">+' + (p.products.length - 3) + ' ürün daha</div>' : '';

      return '<tr>'
        + '<td style="font-size:10px;color:var(--dim);text-align:center">' + (i + 1) + '</td>'
        + '<td style="font-size:11px;font-weight:600">' + p.eczane
          + '<div style="font-size:9px;color:var(--dim);font-weight:400">' + (p.brick || '') + '</div></td>'
        + '<td style="font-size:11px;white-space:nowrap">'
          + '<span style="color:' + urg.color + ';font-weight:700">' + p.nearestExpectedOrderDate + '</span>'
          + '<div style="font-size:9px;color:' + urg.color + '">' + urg.label + '</div></td>'
        + '<td>' + productLines + extra + '</td>'
        + '</tr>';
    }).join('');

    el.innerHTML =
      filterBar
      + '<div class="card-body-0 scroll-x" style="max-height:400px;overflow-y:auto">'
      + '<table class="tbl" style="min-width:560px">'
      + '<thead><tr>'
      + '<th style="width:26px">#</th><th>Eczane</th><th>En Yakın Tahmini Sipariş</th><th>Ürün Bazlı Tahmin</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>'
      + '<div style="padding:6px 10px;font-size:9px;color:var(--dim);border-top:1px solid var(--border)">'
      + 'Sıralama: bugüne en yakın tahmini sipariş tarihine göre (gecikmiş veya yaklaşan fark etmeksizin, en yakın önce). '
      + 'Kendi döngüsüne göre 1 kattan fazla gecikmiş ürünler (muhtemelen pasif müşteri) listeye alınmaz — bkz. AT_RISK/REACTIVATION. '
      + 'Tarihler geçmiş sipariş ritmine dayalı istatistiksel tahmindir, kesin değildir.'
      + '</div>';
  }

  window.OrderForecastEngine = {
    buildProductOrderForecast:   buildProductOrderForecast,
    buildTop15OrderForecast:     buildTop15OrderForecast,
    renderTop15OrderForecastCard: renderTop15OrderForecastCard,
    setFilterMode:               setFilterMode,
    version: '1.1'
  };

  console.debug('[order-forecast-engine] yüklendi — ürün bazlı sipariş zamanlaması (Top 15, alış zamanına göre sıralı).');

})();
