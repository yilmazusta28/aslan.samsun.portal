// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/manager-panel-engine.js
//  FAZ 13.0 — Yönetici Paneli Genişletmesi
//
//  Sorumluluk: Yönetici (page7) sayfasına 4 yeni blok ekler.
//  MEVCUT HİÇBİR MOTOR/DOSYA DEĞİŞTİRİLMEDİ — yalnız okuyup üstüne inşa eder.
//    1) buildManagerKutuAggregate() → Ekip toplamı IMS TL Kutu Hedef & Kalan
//    2) renderManagerRankingFull()  → buildTeamRanking() çıktısının TAMAMI (tablo)
//    3) buildManagerBrickDetail(ttt)→ Seçilen temsilcinin brick bazlı
//                                     sıra / hedef TL / satış TL / kalan TL / PP%
//    4) buildManagerBrickNarrative(ttt) → Bölge müdürü için AI pazar analizi özeti
//
//  NOT (tahmini alanlar): Ham veride brick bazlı hedef_tl/satis_tl YOKTUR
//  (GENEL_TABLO sadece TTT+ürün seviyesindedir). Bu yüzden brick bazlı
//  hedef/satış/kalan TL, o brickteki KENDİ KUTU HACMİNİN (IMS toplam × birim
//  fiyat) TTT toplamı içindeki payına göre ORANTILI TAHMİN edilir. Bu,
//  uygulamada zaten kullanılan "IMS TL Hesabına Göre Kutu Hesaplaması"
//  yaklaşımıyla aynı mantığı brick seviyesine taşır. Arayüzde bu netlikle
//  rozetlenir ("Tahmini Dağılım").
//
//  Bağımlılık: constants.js, data-state.js (GENEL, IMS, MIGI_BRICK_TL_RAW),
//              team-ranking-engine.js (buildTeamRanking),
//              risk-engine.js (detectRisks) — opsiyonel
//  GitHub Pages compatible: classic script, no ES modules
//  Rollback: bu dosyayı ve index.html'deki <script> satırını silmek hiçbir
//            mevcut sayfayı/motoru bozmaz (page7 sadece render fonksiyonu
//            bulunamazsa o bloğu boş bırakır).
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, MIGI_BRICK_TL_RAW, ALL_TTTS, URUN_ORDER, URUN_CLR,
          IMS_TL_MAP, OWN_DRUG_BY_GRP, fK, fTL, buildTeamRanking, detectRisks */

(function () {
  'use strict';

  if (window._MANAGER_PANEL_ENGINE_LOADED) { return; }
  window._MANAGER_PANEL_ENGINE_LOADED = true;

  var MANAGER_NAME = 'ŞENOL YILMAZ';

  // ── 0) BÖLGE GENELİ KPI ŞERİDİ (ŞENOL YILMAZ resmi GENEL TOPLAM satırı) ──
  function renderManagerRegionKpi(containerId) {
    var el = document.getElementById(containerId || 'mgrRegionKpi');
    if (!el) return;
    var gt = (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === 'GENEL TOPLAM'; });
    if (!gt) {
      el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Bölge toplamı satırı (ŞENOL YILMAZ) CSV\'de bulunamadı.</div>';
      return;
    }
    var kalan = (gt.kalan_tl > 0) ? gt.kalan_tl : Math.max(0, (gt.hedef_tl || 0) - (gt.satis_tl || 0));
    var real = gt.tl_pct || 0;
    var realColor = real >= 100 ? '#16A34A' : real >= 91 ? '#059669' : real >= 70 ? '#D97706' : '#DC2626';

    function _c(label, value, color) {
      return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:10px 14px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">' + label + '</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + color + '">' + value + '</div></div>';
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px">' +
      _c('Bölge Realizasyon', '%' + real.toFixed(1), realColor) +
      _c('Hedef TL', fTL(gt.hedef_tl || 0), 'var(--fg,#111)') +
      _c('Satış TL', fTL(gt.satis_tl || 0), 'var(--fg,#111)') +
      _c('Kalan TL', fTL(kalan), 'var(--c2,#1BCED8)') +
      '</div>';
  }

  // ── 0b) BÖLGE ÖZET ANALİZİ (iadeler dahil) ───────────────────────────
  // "Genel Durum" sayfasındaki renderAnaInsight() + buildCompetitionAlerts()
  // ile AYNI mantık — mevcut fonksiyonlar ÇOĞALTILMADI, doğrudan çağrılır
  // (index.html'de global tanımlıdır). buildCompetitionAlerts('ŞENOL YILMAZ')
  // zaten ALL_TTTS'teki HERKESİN iade (negatif haftalık kutu) uyarılarını
  // toplar — bölge müdürü özetinde bu yüzden TÜM EKİBİN iadeleri görünür.
  function renderManagerBolgeOzet(bodyId, alertBoxId, alertBodyId) {
    var el = document.getElementById(bodyId || 'mgrBolgeOzetBody');
    if (!el) return;
    var ekip = (GENEL || []).filter(function (r) { return r.urun === 'GENEL TOPLAM' && r.ttt !== MANAGER_NAME; });
    var sorted = ekip.slice().sort(function (a, b) { return (b.tl_pct || 0) - (a.tl_pct || 0); });
    var best = sorted[0], worst = sorted[sorted.length - 1];
    var avg = ekip.length ? ekip.reduce(function (s, r) { return s + (r.tl_pct || 0); }, 0) / ekip.length : 0;
    var over70 = ekip.filter(function (r) { return (r.tl_pct || 0) >= 70; }).length;
    var urunSatis = (URUN_ORDER || []).map(function (u) {
      return { u: u, sum: (GENEL || []).filter(function (r) { return r.urun === u && r.ttt !== MANAGER_NAME; }).reduce(function (s, r) { return s + (r.satis_tl || 0); }, 0) };
    }).sort(function (a, b) { return b.sum - a.sum; });
    var gt = (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === 'GENEL TOPLAM'; }) || {};

    el.innerHTML =
      '🏢 <strong>Bölge Müdürü ' + MANAGER_NAME + '</strong> — Bölge toplam satış: <strong>' + fTL(gt.satis_tl) + '</strong> (' + fPct(gt.tl_pct) + ' hedef). TR Sırası: <strong>#' + (gt.tr_sira || '—') + '</strong>. ' +
      'Ekip ort. gerçekleşme: <strong>' + avg.toFixed(1) + '%</strong>. <strong>' + over70 + '/' + ekip.length + '</strong> temsilci %70 üstünde. ' +
      'Lider: <strong>' + (best ? best.ttt : '—') + '</strong> (' + fPct(best ? best.tl_pct : 0) + '). Gelişim gereken: <strong>' + (worst ? worst.ttt : '—') + '</strong> (' + fPct(worst ? worst.tl_pct : 0) + '). ' +
      'Bölge en güçlü ürün: <strong>' + (urunSatis[0] ? urunSatis[0].u : '—') + '</strong> (' + fTL(urunSatis[0] ? urunSatis[0].sum : 0) + ').';

    var alertBox = document.getElementById(alertBoxId || 'mgrBolgeAlertBox');
    var alertBody = document.getElementById(alertBodyId || 'mgrBolgeAlertBody');
    if (alertBox && alertBody) {
      var alerts = (typeof buildCompetitionAlerts === 'function') ? buildCompetitionAlerts(MANAGER_NAME) : [];
      if (alerts.length) {
        alertBox.style.display = 'block';
        alertBody.innerHTML = alerts.join('<br>');
      } else {
        alertBox.style.display = 'none';
      }
    }
  }

  // ── 0c) BÖLGE ÜRÜN BAZLI PERFORMANS ──────────────────────────────────
  // renderTTTDetail()'deki tttUrunBody tablosuyla AYNI kolonlar, ama
  // ttt==='ŞENOL YILMAZ' (bölge resmi toplamı) satırları üzerinden.
  function buildManagerUrunPerformans() {
    return (URUN_ORDER || [])
      .map(function (u) { return (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === u; }); })
      .filter(Boolean);
  }

  function renderManagerUrunPerformans(containerId) {
    var body = document.getElementById(containerId || 'mgrUrunBody');
    if (!body) return;
    var rows = buildManagerUrunPerformans();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--dim);padding:14px">Veri yok — CSV yüklenmemiş olabilir.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var pct = Math.min(r.tl_pct || 0, 100);
      var barColor = URUN_CLR[r.urun] || 'var(--c3)';
      return '<tr>' +
        '<td style="font-weight:700;color:' + (URUN_CLR[r.urun] || 'var(--c1)') + '">' + r.urun + '</td>' +
        '<td class="mono">' + fTL(r.hedef_tl) + '</td>' +
        '<td class="mono" style="font-weight:700">' + fTL(r.satis_tl) + '</td>' +
        '<td class="mono ' + (r.kalan_tl < 0 ? 'negative' : 'positive') + '">' + fTL(r.kalan_tl) + '</td>' +
        '<td><span class="bdg ' + pCls(r.tl_pct) + '">' + fPct(r.tl_pct) + '</span></td>' +
        '<td><div class="prog" style="width:80px"><div class="prog-fill ' + barCls(r.tl_pct) + '" style="width:' + pct + '%;background:' + barColor + '"></div></div></td>' +
        '<td class="mono">' + fPct(r.prim_pct) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ── 0d) BÖLGE HAFTALIK TL SATIŞ TRENDİ (grafik) ──────────────────────
  // renderTTTDetail()'deki tttHaftaTlChart ile AYNI mantık — her ürün için
  // haftalık (h1..h9) TL çizgisi, ŞENOL YILMAZ (bölge) satırları üzerinden.
  function renderManagerHaftaTlChart(canvasId) {
    var rows = buildManagerUrunPerformans();
    if (!rows.length || typeof mkChart !== 'function') return;
    var wkeys = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];
    mkChart(canvasId || 'mgrHaftaTlChart', 'line', {
      labels: wkeys.map(function (_, i) { return (i + 1) + '.Hft'; }),
      datasets: rows.map(function (r, i) {
        var clr = URUN_CLR[r.urun] || TTT_COLORS[i % TTT_COLORS.length];
        return {
          label: r.urun,
          data: wkeys.map(function (w) { return r[w] || 0; }),
          borderColor: clr, backgroundColor: clr + '18',
          tension: .4, fill: false, pointRadius: 4, borderWidth: 2.5
        };
      })
    }, {
      plugins: { title: { display: true, text: 'Bölge Geneli — Haftalık TL', color: '#4F008C', font: { size: 11, weight: 'bold' } } },
      scales: { y: { ticks: { callback: function (v) { return fTL(v); } } } }
    });
  }

  // ── 0e) BÖLGE HAFTALIK TL DÖKÜMÜ (tablo) ─────────────────────────────
  // "Satış Takibi" sayfasındaki weeklyTlBody ile AYNI kolonlar/toplam satırı
  // mantığı — ŞENOL YILMAZ (bölge) satırları üzerinden.
  function renderManagerHaftaTlDokum(containerId) {
    var body = document.getElementById(containerId || 'mgrHaftaTlDokumBody');
    if (!body) return;
    var wk = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];
    var rows = (URUN_ORDER || [])
      .map(function (u) { return (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === u; }); })
      .filter(function (r) { return r && r.hedef_tl > 0; });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--dim);padding:14px">Veri yok.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var vals = wk.map(function (w) { return r[w] || 0; });
      var nz = vals.filter(function (v) { return v > 0; });
      var avg = nz.length ? nz.reduce(function (a, b) { return a + b; }, 0) / nz.length : 0;
      return '<tr><td style="font-weight:700;color:' + (URUN_CLR[r.urun] || 'var(--c1)') + '">' + r.urun + '</td>' +
        vals.map(function (v) { return '<td class="mono" style="' + (v > 0 ? '' : 'color:#A0AEC0') + '">' + (v > 0 ? fTL(v) : '—') + '</td>'; }).join('') +
        '<td class="mono" style="color:var(--c2);font-weight:700">' + fTL(avg) + '</td></tr>';
    }).join('');
    var tots = wk.map(function (w) { return rows.reduce(function (s, r) { return s + (r[w] || 0); }, 0); });
    var nzT = tots.filter(function (v) { return v > 0; });
    var avgT = nzT.length ? nzT.reduce(function (a, b) { return a + b; }, 0) / nzT.length : 0;
    body.innerHTML += '<tr class="toplam-row" style="border-top:2px solid var(--border);background:#F7F9FC">' +
      '<td style="font-weight:700">TOPLAM</td>' +
      tots.map(function (v) { return '<td class="mono" style="font-weight:600;color:var(--c2)">' + (v > 0 ? fTL(v) : '—') + '</td>'; }).join('') +
      '<td class="mono" style="font-weight:700;color:var(--c1)">' + fTL(avgT) + '</td></tr>';
  }


  // ŞENOL YILMAZ (bölge) seçili biçimde açar. Motor ÇOĞALTILMADI —
  // AI Asistan sayfasındaki GERÇEK motora bağlanılır (tek kaynak, tek doğruluk).
  function openBolgeGeneliMotoru() {
    if (typeof goPage === 'function') goPage(5);
    setTimeout(function () {
      try {
        if (typeof setAiTTT === 'function') setAiTTT(MANAGER_NAME);
        if (typeof runEngine === 'function') runEngine();
      } catch (e) { console.warn('[manager-panel-engine] openBolgeGeneliMotoru hata:', e.message); }
    }, 60);
  }
  window.openBolgeGeneliMotoru = openBolgeGeneliMotoru;

  // ── EKLENTİ (katkı): TÜM EKİPTE KRİTİK AKSİYON LİSTESİ ───────────────
  // detectRisks() her temsilci için ayrı ayrı çalışıyordu ama bölge
  // müdürünün TEK EKRANDAN tüm ekipteki HIGH risklileri görebileceği
  // birleşik/önceliklendirilmiş bir liste yoktu. Bu, saf ekleme —
  // mevcut risk-engine.js DEĞİŞMEDİ, sadece tüm TTT'ler için toplanıyor.
  function buildTeamCriticalActions() {
    if (typeof detectRisks !== 'function') return [];
    var list = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS : [];
    var all = [];
    list.forEach(function (ttt) {
      try {
        (detectRisks(ttt) || []).forEach(function (r) {
          if (r.severity === 'HIGH') all.push({ ttt: ttt, title: r.title, detail: r.detail });
        });
      } catch (e) { /* silent */ }
    });
    return all;
  }

  function renderTeamCriticalActions(containerId) {
    var el = document.getElementById(containerId || 'mgrCriticalActions');
    if (!el) return;
    var actions = buildTeamCriticalActions();
    if (!actions.length) {
      el.innerHTML = '<div style="font-size:11px;color:#16A34A;padding:6px 0">✓ Ekipte kritik (yüksek risk) durum tespit edilmedi.</div>';
      return;
    }
    el.innerHTML = actions.map(function (a) {
      return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid var(--brd,#f3f4f6)">' +
        '<span style="flex-shrink:0;background:#DC262622;color:#DC2626;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;margin-top:2px">' + a.ttt.split(' ')[0] + '</span>' +
        '<div style="font-size:11px;line-height:1.5"><strong>' + a.title + '</strong><br>' + a.detail + '</div>' +
        '</div>';
    }).join('');
  }

  // ── 1) EKİP TOPLAMI — IMS TL KUTU HEDEF & KALAN ──────────────────────
  // ÖNCELİK: GENEL_TABLO'da zaten mevcut olan 'ŞENOL YILMAZ' (Bölge Toplamı)
  // satırları — bunlar kaynağın kendi ürettiği resmi bölge toplamıdır.
  // Bulunamazsa (CSV'de o satır yoksa) 8 temsilcinin TTT bazlı toplamı
  // hesaplanarak aynı sonuca ORANTISIZ fark olmadan ulaşılır (fallback).
  function buildManagerKutuAggregate() {
    var official = (URUN_ORDER || [])
      .map(function (u) { return (GENEL || []).find(function (r) { return r.ttt === MANAGER_NAME && r.urun === u; }); })
      .filter(function (r) { return r && r.hedef_kutu > 0; });

    if (official.length) {
      return official.map(function (r) {
        return {
          urun: r.urun, hedef_kutu: r.hedef_kutu || 0, cikan_kutu: r.cikan_kutu || 0,
          hft_kutu: r.hft_kutu || 0, hft_tl: r.hft_tl || 0, hedef_tl: r.hedef_tl || 0, satis_tl: r.satis_tl || 0
        };
      });
    }

    // Fallback: 8 temsilcinin manuel toplamı
    var list = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS : [];
    return (URUN_ORDER || []).map(function (u) {
      var agg = { urun: u, hedef_kutu: 0, cikan_kutu: 0, hft_kutu: 0, hft_tl: 0, hedef_tl: 0, satis_tl: 0 };
      list.forEach(function (ttt) {
        var r = (GENEL || []).find(function (row) { return row.ttt === ttt && row.urun === u; });
        if (!r) return;
        agg.hedef_kutu += (r.hedef_kutu || 0);
        agg.cikan_kutu += (r.cikan_kutu || 0);
        agg.hft_kutu   += (r.hft_kutu   || 0);
        agg.hft_tl     += (r.hft_tl     || 0);
        agg.hedef_tl   += (r.hedef_tl   || 0);
        agg.satis_tl   += (r.satis_tl   || 0);
      });
      return agg;
    }).filter(function (r) { return r.hedef_kutu > 0; });
  }

  function renderManagerKutuAggregate(containerId) {
    var body = document.getElementById(containerId || 'mgrKutuBody');
    if (!body) return;
    var rows = buildManagerKutuAggregate();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--dim);padding:14px">Veri yok — CSV yüklenmemiş olabilir.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var k70 = Math.max(0, r.hedef_kutu * 0.70 - r.cikan_kutu);
      var k91 = Math.max(0, r.hedef_kutu * 0.91 - r.cikan_kutu);
      var k100 = r.hedef_kutu - r.cikan_kutu;
      var k100Pos = k100 > 0;
      var k100TL = Math.max(0, r.hedef_tl - r.satis_tl);
      return '<tr>' +
        '<td style="font-weight:700;color:' + (URUN_CLR[r.urun] || 'var(--c1)') + '">' + r.urun + '</td>' +
        '<td class="mono">' + fK(r.hedef_kutu) + '</td>' +
        '<td class="mono">' + fK(r.cikan_kutu) + '</td>' +
        '<td class="mono ' + (k70 > 0 ? 'negative' : 'positive') + '" style="' + (!k70 ? 'color:#0BA87E;font-weight:700' : '') + '">' + (k70 > 0 ? fK(k70) : '✓ Geçildi') + '</td>' +
        '<td class="mono ' + (k91 > 0 ? 'negative' : 'positive') + '" style="' + (!k91 ? 'color:#0BA87E;font-weight:700' : '') + '">' + (k91 > 0 ? fK(k91) : '✓ Geçildi') + '</td>' +
        '<td class="mono ' + (k100Pos ? 'negative' : 'positive') + '" style="' + (!k100Pos ? 'color:#0BA87E;font-weight:700' : '') + '">' + (k100Pos ? fK(k100) : '✓ Geçildi') + '</td>' +
        '<td class="mono">' + fK(r.hft_kutu) + '</td>' +
        '<td class="mono">' + fTL(r.hft_tl) + '</td>' +
        '<td class="mono" style="color:var(--c2);font-weight:700">' + fTL(k100TL) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ── 2) TÜM EKİP SIRALAMASI (buildTeamRanking'in TAM listesi) ─────────
  function renderManagerRankingFull(containerId) {
    var body = document.getElementById(containerId || 'mgrRankingBody');
    if (!body) return;
    if (typeof buildTeamRanking !== 'function') {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--dim);padding:14px">team-ranking-engine.js yüklenmedi.</td></tr>';
      return;
    }
    var list = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS : [];
    var ranking = buildTeamRanking(list);
    if (!ranking.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--dim);padding:14px">Veri yok — CSV yüklenmemiş olabilir.</td></tr>';
      return;
    }
    var catColor = { STAR: '#16A34A', STABLE: '#059669', WATCHLIST: '#D97706', RISK: '#DC2626' };
    body.innerHTML = ranking.map(function (r) {
      var cc = catColor[r.category] || '#6b7280';
      return '<tr>' +
        '<td style="font-weight:700;color:var(--c1)">' + r.rank + '</td>' +
        '<td style="font-weight:600">' + r.ttt + '</td>' +
        '<td class="mono">%' + r.realization + '</td>' +
        '<td class="mono">%' + r.forecast + '</td>' +
        '<td class="mono">' + r.growthScore + '</td>' +
        '<td class="mono">' + r.marketShareScore + '</td>' +
        '<td class="mono" style="font-weight:700">' + r.score + '</td>' +
        '<td><span style="background:' + cc + '22;color:' + cc + ';border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700">' + r.category + '</span></td>' +
        '<td class="mono">' + fTL(r.primEstimate) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ── 3) BRICK BAZLI DETAY (seçilen temsilci) ──────────────────────────
  // BUG DÜZELTMESİ: r.ilac ham IMS metnidir ("PANOCER TOPLAM",
  // "ACIDPASS TOPLAM" gibi — bkz. csv-parser.js isMktRow yorumu) ve
  // IMS_TL_MAP anahtarları ("PANOCER","ACİDPASS",...) bu ham metinle
  // ASLA birebir eşleşmiyordu → o iki ürün için price=0 → sadece
  // Panocer/Acidpass satan bricklerde estTL=0 → weight=0 → hedef/satış
  // TL 0 görünüyordu ("bazı bricklerde hedef ve satış görünmüyor").
  // Doğru eşleme: r.ilac_grubu → OWN_DRUG_BY_GRP[...].urun → IMS_TL_MAP.
  function _brickDetailUnitPrice(r) {
    if (typeof OWN_DRUG_BY_GRP !== 'undefined' && OWN_DRUG_BY_GRP[r.ilac_grubu]) {
      var urun = OWN_DRUG_BY_GRP[r.ilac_grubu].urun;
      var p = (IMS_TL_MAP && IMS_TL_MAP[urun]) || 0;
      if (p) return p;
    }
    // Fallback: eski davranış (bazı özel/eşleşmeyen ilaç adları için)
    return (IMS_TL_MAP && IMS_TL_MAP[r.ilac]) || 0;
  }

  // @returns [{ brick, sira, hedefTL, satisTL, kalanTL, pp }] — sira artan
  function buildManagerBrickDetail(ttt) {
    if (!ttt) return [];

    // 3a) Kendi kutu hacmi (IMS, is_mkt:false) → brick bazlı tahmini TL ağırlığı
    var brickMap = {}; // BRICK -> { estTL, ppiVals:[] }
    (IMS || []).filter(function (r) { return r.ttt === ttt && !r.is_mkt; }).forEach(function (r) {
      var key = (r.brick || '').trim().toUpperCase();
      if (!key) return;
      if (!brickMap[key]) brickMap[key] = { estTL: 0, ppiVals: [] };
      var price = _brickDetailUnitPrice(r);
      brickMap[key].estTL += (r.toplam || 0) * price;
      if (r.toplam_ppi != null && !isNaN(r.toplam_ppi)) brickMap[key].ppiVals.push(r.toplam_ppi);
    });

    // 3b) Brick sırası (İlk 333 dahil) — MIGI_BRICK_TL_RAW'dan EN GÜNCEL
    // döneme ait sira (BUG DÜZELTMESİ: eskiden tüm ayların en iyisi/en
    // düşüğü alınıyordu — güncel ay kötü olsa bile eski iyi sıra hep
    // kazanıyordu, bkz. prim-calc.js'deki aynı düzeltme notu).
    var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
    var siraMap = {};
    var _siraRowsByBrick = {};
    (MIGI_BRICK_TL_RAW || []).filter(function (r) { return r.person === ttt; }).forEach(function (r) {
      var key = (r.brick || '').trim().toUpperCase();
      if (!key) return;
      if (!_siraRowsByBrick[key]) _siraRowsByBrick[key] = [];
      _siraRowsByBrick[key].push(r);
      if (!brickMap[key]) brickMap[key] = { estTL: 0, ppiVals: [] };
    });
    Object.keys(_siraRowsByBrick).forEach(function (key) {
      var rows = _siraRowsByBrick[key];
      var latest = rows.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
      var latestRow = rows.filter(function (r) { return _migiDonemNum(r.donem) === latest; })[0];
      siraMap[key] = latestRow ? latestRow.sira : null;
    });

    // 3c) TTT toplam hedef/satış TL → brick'lere orantılı dağıt
    var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    var hedefTotal = gt ? (gt.hedef_tl || 0) : 0;
    var satisTotal = gt ? (gt.satis_tl || 0) : 0;

    var keys = Object.keys(brickMap);
    var estTotal = keys.reduce(function (s, k) { return s + brickMap[k].estTL; }, 0);

    var rows = keys.map(function (key) {
      var b = brickMap[key];
      var weight = estTotal > 0 ? (b.estTL / estTotal) : 0;
      var satisTL = satisTotal * weight;
      var hedefTL = hedefTotal * weight;
      var kalanTL = Math.max(0, hedefTL - satisTL);
      var pp = b.ppiVals.length ? (b.ppiVals.reduce(function (s, v) { return s + v; }, 0) / b.ppiVals.length) : null;
      return {
        brick: key,
        sira: siraMap[key] || 9999,
        hedefTL: hedefTL,
        satisTL: satisTL,
        kalanTL: kalanTL,
        pp: pp
      };
    });

    rows.sort(function (a, b) { return a.sira - b.sira; });
    return rows;
  }

  function renderManagerBrickDetail(ttt, containerId) {
    var body = document.getElementById(containerId || 'mgrBrickDetailBody');
    if (!body) return;
    var rows = buildManagerBrickDetail(ttt);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:14px">Bu temsilci için brick verisi bulunamadı.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var top333 = r.sira <= 333;
      var ppColor = r.pp == null ? 'var(--dim)' : (r.pp >= 50 ? '#16A34A' : r.pp >= 30 ? '#D97706' : '#DC2626');
      return '<tr>' +
        '<td class="mono" style="' + (top333 ? 'font-weight:700;color:var(--c1)' : 'color:var(--dim)') + '">' + (r.sira >= 9999 ? '—' : r.sira) + '</td>' +
        '<td style="font-weight:600">' + r.brick + '</td>' +
        '<td class="mono">' + fTL(r.hedefTL) + '</td>' +
        '<td class="mono">' + fTL(r.satisTL) + '</td>' +
        '<td class="mono" style="color:var(--c2);font-weight:700">' + fTL(r.kalanTL) + '</td>' +
        '<td class="mono" style="color:' + ppColor + ';font-weight:700">' + (r.pp == null ? '—' : '%' + r.pp.toFixed(1)) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ── 4) AI PAZAR ANALİZİ ÖZETİ (bölge müdürüne) ───────────────────────
  function _lastActiveWeek(row) {
    var weeks = [row.h1, row.h2, row.h3, row.h4, row.h5, row.h6, row.h7, row.h8, row.h9];
    for (var i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i] > 0) return { idx: i + 1, val: weeks[i] };
    }
    return null;
  }

  function buildManagerBrickNarrative(ttt) {
    if (!ttt) return '<div style="color:var(--dim);font-size:11px">Temsilci seçin.</div>';

    var rows = buildManagerBrickDetail(ttt);
    if (!rows.length) return '<div style="color:var(--dim);font-size:11px">Bu temsilci için pazar verisi bulunamadı.</div>';

    var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    var ranking = (typeof buildTeamRanking === 'function') ? buildTeamRanking([ttt].concat((ALL_TTTS || []).filter(function (t) { return t !== ttt; }))) : [];
    var own = ranking.find(function (r) { return r.ttt === ttt; });

    var html = '';

    // Başlık özeti
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
    html += '<div style="font-size:12px"><strong>' + ttt + '</strong></div>';
    if (gt) html += '<div style="font-size:11px;color:var(--dim)">Genel Realizasyon: <strong style="color:var(--fg)">%' + (gt.tl_pct || 0).toFixed(1) + '</strong></div>';
    if (own) html += '<div style="font-size:11px;color:var(--dim)">Ekip Sırası: <strong style="color:var(--fg)">#' + own.rank + '</strong> · Kategori: <strong style="color:var(--fg)">' + own.category + '</strong></div>';
    html += '</div>';

    // Riskler (varsa)
    try {
      if (typeof detectRisks === 'function') {
        var risks = detectRisks(ttt) || [];
        var highs = risks.filter(function (r) { return r.severity === 'HIGH'; });
        if (highs.length) {
          html += '<div style="background:#DC262611;border:1px solid #DC262633;border-radius:8px;padding:8px 10px;margin-bottom:10px">';
          html += '<div style="font-size:10px;font-weight:700;color:#DC2626;margin-bottom:4px">⚠ KRİTİK RİSKLER</div>';
          highs.slice(0, 3).forEach(function (r) {
            html += '<div style="font-size:11px;line-height:1.5">• ' + r.detail + '</div>';
          });
          html += '</div>';
        }
      }
    } catch (e) { /* silent */ }

    // Brick bazlı özet — iyi / orta / kötü sınıflandırma (sadece PP verisi olanlar)
    var withPP = rows.filter(function (r) { return r.pp != null; });
    var iyi   = withPP.filter(function (r) { return r.pp >= 50; }).sort(function (a, b) { return b.pp - a.pp; });
    var orta  = withPP.filter(function (r) { return r.pp >= 30 && r.pp < 50; });
    var kotu  = withPP.filter(function (r) { return r.pp < 30; }).sort(function (a, b) { return a.pp - b.pp; });

    html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin:6px 0">Brick Bazlı Pazar Payı Dağılımı (' + withPP.length + ' brick)</div>';
    html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    html += '<span style="background:#16A34A22;color:#16A34A;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700">🟢 İyi (≥%50): ' + iyi.length + '</span>';
    html += '<span style="background:#D9770622;color:#D97706;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700">🟡 Orta (%30-49): ' + orta.length + '</span>';
    html += '<span style="background:#DC262622;color:#DC2626;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700">🔴 Zayıf (&lt;%30): ' + kotu.length + '</span>';
    html += '</div>';

    // İlk 333 içindeki en kritik bricklere ayrıntılı satış anlatımı
    var focusBricks = rows.filter(function (r) { return r.sira <= 333; }).slice(0, 6);
    if (!focusBricks.length) focusBricks = rows.slice(0, 6);

    if (focusBricks.length) {
      html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin:10px 0 6px">İlk 333 Önceliğinde Öne Çıkan Brickler</div>';
      focusBricks.forEach(function (fb) {
        var ownRows = (IMS || []).filter(function (r) { return r.ttt === ttt && !r.is_mkt && (r.brick || '').trim().toUpperCase() === fb.brick; });
        // brick içinde en çok satan kendi ürünü bul
        var dominant = null;
        ownRows.forEach(function (r) { if (!dominant || (r.toplam || 0) > (dominant.toplam || 0)) dominant = r; });

        var ppTag = fb.pp == null ? '' : (fb.pp >= 50 ? ' — pazar payı iyi durumda' : fb.pp >= 30 ? ' — pazar payı orta seviyede' : ' — pazar payı zayıf, aksiyon gerekli');
        var line = '<div style="font-size:11px;line-height:1.6;padding:4px 0;border-top:1px solid var(--brd,#f3f4f6)">';
        line += '<strong>' + fb.brick + '</strong> (sıra #' + (fb.sira >= 9999 ? '—' : fb.sira) + ')';
        if (fb.pp != null) line += ' — PP <strong>%' + fb.pp.toFixed(1) + '</strong>' + ppTag;
        if (dominant) {
          var la = _lastActiveWeek(dominant);
          if (la) {
            line += '. <em>' + dominant.ilac + '</em>, son aktif haftasında (' + la.idx + '. hafta) ' + fK(la.val) + ' kutu sattı (dönem toplamı ' + fK(dominant.toplam || 0) + ' kutu).';
          }
        }
        line += ' Kalan hedef: <strong style="color:var(--c2)">' + fTL(fb.kalanTL) + '</strong>.';
        line += '</div>';
        html += line;
      });
    }

    html += '<div style="font-size:9px;color:var(--dim);margin-top:10px;font-style:italic">* Hedef/Satış/Kalan TL, brick bazlı gerçek CSV verisi bulunmadığından, temsilcinin toplam hedefinin brick bazlı kendi kutu hacmine göre ORANTILI DAĞITILMASIYLA tahmin edilmiştir.</div>';

    return html;
  }

  function renderManagerAiAnaliz(ttt, containerId) {
    var el = document.getElementById(containerId || 'mgrAiAnalizBody');
    if (!el) return;
    el.innerHTML = buildManagerBrickNarrative(ttt);
  }

  // ── ORKESTRASYON — dropdown + tüm blokları doldur ────────────────────
  function _populateTttSelect(selectId) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    // BUG DÜZELTMESİ 1 (FAZ 13.1): select HTML'de zaten 1 placeholder option
    // (<option value="">— Temsilci Seçin —</option>) içeriyordu, bu yüzden
    // eski "if (sel.options.length) return" kontrolü HER ZAMAN true dönüyor
    // ve gerçek temsilci listesi ASLA eklenmiyordu (seçim kutusu hep boş
    // görünüyordu).
    // BUG DÜZELTMESİ 2 (FAZ 13.2): Şenol Yılmaz girişinde artık sayfa7
    // otomatik açıldığından (bkz. index.html doLogin()), bu fonksiyon veri
    // GELMEDEN ÖNCE de bir kez çalışabiliyor — ALL_TTTS henüz boşken
    // "dolduruldu" bayrağı kalıcı olarak set edilirse, veri sonradan
    // gelince select GERÇEKTEN hiç dolmuyordu. Artık bayrak yerine, mevcut
    // seçenek sayısı (placeholder hariç) ile ALL_TTTS uzunluğu her çağrıda
    // karşılaştırılıyor — liste değiştiyse (örn. boştan dolduysa) select
    // güncel seçim korunarak yeniden oluşturuluyor.
    var list = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS : [];
    var currentCount = sel.options.length - 1; // placeholder hariç
    if (currentCount === list.length && sel.dataset.populated === '1') return;
    var prevVal = sel.value;
    sel.innerHTML = '<option value="">— Temsilci Seçin —</option>' +
      list.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    if (list.indexOf(prevVal) !== -1) sel.value = prevVal;
    if (list.length) sel.dataset.populated = '1';
  }

  function onManagerTttChange() {
    var sel = document.getElementById('mgrTttSelect');
    var ttt = sel ? sel.value : '';
    renderManagerBrickDetail(ttt, 'mgrBrickDetailBody');
    renderManagerAiAnaliz(ttt, 'mgrAiAnalizBody');
    // FAZ 13.4 — "Takım Öğrenmesi & Peer Benchmark" kartı bu değere bağlı
    // (bkz. index.html renderTeamLearningCard()). Kart o an açıksa (display
    // !== 'none'), temsilci değişince "SİZİN İÇİN ÖNERİ" bölümü de canlı
    // güncellensin; kart kapalıysa gereksiz çalıştırmayalım.
    var tlc = document.getElementById('teamLearningCard');
    if (tlc && tlc.style.display !== 'none' && typeof renderTeamLearningCard === 'function') {
      renderTeamLearningCard(ttt);
    }
  }
  window.onManagerTttChange = onManagerTttChange;

  // ── FAZ 13.5 — EKİP HAFTALIK ROTA PLANLARI (Bölge Müdürü Görünümü) ──────
  // Her temsilcinin route-plan-input.js (FAZ 10.2) üzerinden KENDİSİNİN
  // girdiği haftalık brick planını (Pzt-Cum) tek tabloda gösterir.
  // Salt-okunur özet — kayıt/silme işlemleri temsilcinin kendi ekranında
  // (Eczane sayfası > "Haftalık Rota Planım") kalır, burada DEĞİŞTİRİLMEZ.
  function renderManagerTeamRoutePlans(containerId) {
    var el = document.getElementById(containerId || 'mgrTeamRouteBody');
    if (!el) return;
    if (!window.RoutePlanInput || typeof window.RoutePlanInput.getWeekPlan !== 'function') {
      el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Rota planlama modülü (route-plan-input.js) yüklenemedi.</div>';
      return;
    }
    var list = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS : [];
    var DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
    el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Yükleniyor…</div>';

    Promise.all(list.map(function (rep) {
      return window.RoutePlanInput.getWeekPlan(rep).catch(function () { return []; });
    })).then(function (allPlans) {
      var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="text-align:left;border-bottom:2px solid var(--border,#e5e7eb)">';
      html += '<th style="padding:6px 8px;white-space:nowrap">Temsilci</th>';
      DAYS.forEach(function (d) { html += '<th style="padding:6px 8px;white-space:nowrap">' + d + '</th>'; });
      html += '</tr></thead><tbody>';

      list.forEach(function (rep, i) {
        var plans = allPlans[i] || [];
        var byDay = {};
        plans.forEach(function (p) { byDay[p.weekday] = p.bricks || []; });
        var hasAny = Object.keys(byDay).some(function (k) { return (byDay[k] || []).length; });

        html += '<tr style="border-bottom:1px solid var(--border,#f3f4f6)">';
        html += '<td style="padding:6px 8px;font-weight:700;white-space:nowrap">' + rep + '</td>';
        for (var d = 1; d <= 5; d++) {
          var bricks = byDay[d] || [];
          html += '<td style="padding:6px 8px;color:' + (bricks.length ? 'var(--fg,#111)' : 'var(--dim,#9ca3af)') + '">' +
            (bricks.length ? bricks.join(', ') : '—') + '</td>';
        }
        html += '</tr>';
        if (!hasAny) {
          // Sessizce işaretle — ayrı bir satır değil, sadece stil ile belirtildi.
        }
      });
      html += '</tbody></table></div>';

      var girenSayisi = list.filter(function (rep, i) {
        return (allPlans[i] || []).some(function (p) { return (p.bricks || []).length; });
      }).length;
      html += '<div style="font-size:10px;color:var(--dim);margin-top:8px">' +
        girenSayisi + ' / ' + list.length + ' temsilci bu hafta için manuel plan girdi. Plan girmeyenler için AI\'nın otomatik önerdiği rota (Bugünkü Akıllı Rota kartı) esas alınır.</div>';

      el.innerHTML = html;
    }).catch(function (e) {
      el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Yüklenemedi: ' + e.message + '</div>';
    });
  }

  // ── FAZ 10 — Dönem Arşivi Kartı (kullanıcı isteğiyle eklendi) ────────
  function renderPeriodArchiveCard(containerId) {
    var el = document.getElementById(containerId || 'mgrPeriodArchive');
    if (!el) return;
    if (!window.PeriodArchiveManager) {
      el.innerHTML = '<p style="color:var(--dim);font-size:11px">Arşiv motoru yüklü değil.</p>';
      return;
    }
    var summary = window.PeriodArchiveManager.getSummary();
    var rows = [];
    ['H1', 'H2'].forEach(function (hy) {
      Object.keys(summary[hy] || {}).forEach(function (k) {
        var p = summary[hy][k];
        rows.push({ key: k, label: p.label, genelCount: p.genelCount, imsCount: p.imsCount, archivedAt: p.archivedAt });
      });
    });
    if (!rows.length) {
      el.innerHTML = '<p style="color:var(--dim);font-size:11px;padding:4px 0">' +
        'Henüz arşivlenmiş bir dönem yok — bir dönem kapanıp yeni döneme geçildiğinde (GENEL_TABLO/IMS_TABLO sıfırlanınca) burada otomatik görünecek.</p>';
      return;
    }
    el.innerHTML =
      '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.5">' +
      'GENEL_TABLO.csv/IMS_TABLO.csv her dönem sonunda sıfırlanır. Aşağıdaki dönemler bu tarayıcıda otomatik arşivlendi ' +
      '(sadece bu cihazda geçerli). <b>"📥 İndir"</b> ile GitHub reposundaki <code>arsiv/</code> klasörüne (dosya adını değiştirmeden) ' +
      'commit ederseniz, o dönem TÜM cihaz/tarayıcılarda otomatik görünür hale gelir.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
      '<thead><tr style="text-align:left;color:var(--dim);font-size:9px">' +
      '<th style="padding:4px 4px">Dönem</th><th style="padding:4px">Arşivlenme Tarihi</th><th style="padding:4px">GENEL/IMS Satır</th><th style="padding:4px"></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:5px 4px;font-weight:600">' + (r.label || r.key) + '</td>' +
          '<td style="padding:5px 4px;color:var(--dim)">' + (r.archivedAt ? r.archivedAt.slice(0, 10) : '—') + '</td>' +
          '<td style="padding:5px 4px;color:var(--dim)">' + r.genelCount + ' / ' + r.imsCount + '</td>' +
          '<td style="padding:5px 4px"><button onclick="window.PeriodArchiveManager.exportPeriodAsFile(\'' + r.key + '\')" ' +
          'style="font-size:9px;font-weight:600;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--fg);cursor:pointer">📥 İndir</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderManagerExtra() {
    try {
      // FAZ 13.4-DÜZELTME: renderManagerRegionKpi() artık çağrılmıyor —
      // "Bölge Geneli — ŞENOL YILMAZ" kartı kaldırıldı (mgrHeroBanner ile
      // aynı bilgiyi tekrar ediyordu). Fonksiyon rollback için dosyada durur.
      renderManagerBolgeOzet('mgrBolgeOzetBody', 'mgrBolgeAlertBox', 'mgrBolgeAlertBody');
      renderManagerUrunPerformans('mgrUrunBody');
      renderManagerHaftaTlDokum('mgrHaftaTlDokumBody');
      renderManagerKutuAggregate('mgrKutuBody');
      renderTeamCriticalActions('mgrCriticalActions');
      renderPeriodArchiveCard('mgrPeriodArchive');
      renderManagerRankingFull('mgrRankingBody');
      renderManagerTeamRoutePlans('mgrTeamRouteBody');
      _populateTttSelect('mgrTttSelect');
      var sel = document.getElementById('mgrTttSelect');
      var ttt = sel ? sel.value : '';
      renderManagerBrickDetail(ttt, 'mgrBrickDetailBody');
      renderManagerAiAnaliz(ttt, 'mgrAiAnalizBody');
      // Grafik: canvas'ın DOM'a tam yerleşmesi için kısa bir gecikme
      // (mevcut renderEkipCharts/renderTTTDetail'de kullanılan AYNI desen).
      if (typeof _safeTimeout === 'function') {
        _safeTimeout(function () { renderManagerHaftaTlChart('mgrHaftaTlChart'); }, 50);
      } else {
        renderManagerHaftaTlChart('mgrHaftaTlChart');
      }
    } catch (e) {
      console.warn('[manager-panel-engine] renderManagerExtra hata:', e.message);
    }
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.renderManagerRegionKpi     = renderManagerRegionKpi;
  window.renderPeriodArchiveCard    = renderPeriodArchiveCard;
  window.renderManagerBolgeOzet     = renderManagerBolgeOzet;
  window.buildManagerUrunPerformans = buildManagerUrunPerformans;
  window.renderManagerUrunPerformans= renderManagerUrunPerformans;
  window.renderManagerHaftaTlChart  = renderManagerHaftaTlChart;
  window.renderManagerHaftaTlDokum  = renderManagerHaftaTlDokum;
  window.buildTeamCriticalActions   = buildTeamCriticalActions;
  window.renderTeamCriticalActions  = renderTeamCriticalActions;
  window.buildManagerKutuAggregate  = buildManagerKutuAggregate;
  window.renderManagerKutuAggregate = renderManagerKutuAggregate;
  window.renderManagerRankingFull   = renderManagerRankingFull;
  window.buildManagerBrickDetail    = buildManagerBrickDetail;
  window.renderManagerBrickDetail   = renderManagerBrickDetail;
  window.buildManagerBrickNarrative = buildManagerBrickNarrative;
  window.renderManagerAiAnaliz      = renderManagerAiAnaliz;
  window.renderManagerTeamRoutePlans= renderManagerTeamRoutePlans;
  window.renderManagerExtra         = renderManagerExtra;

  console.debug('[manager-panel-engine] FAZ 13.0 yüklendi.');
})();
