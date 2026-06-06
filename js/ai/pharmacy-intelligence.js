// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/pharmacy-intelligence.js — PHASE 4.5
//  Eczane Intelligence Engine: Top30 ziyaret önceliklendirme
//
//  Global bağımlılıklar:
//    Veri   : ECZANE_RAW, eczaneLoaded
//    Utils  : fK (optional)
//
//  Yükleme sırası: data-state.js SONRASI, ai-context.js ÖNCESI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

/* global ECZANE_RAW, eczaneLoaded */

// ── 1. Global State ───────────────────────────────────────────────────
window.PHARMACY_INTELLIGENCE = {
  top30: [],
  opportunities: [],
  risks: [],
  generatedAt: null
};

// ── 2. Yardımcı: Ay sıralama değeri ──────────────────────────────────
function _piMonthToNum(ayStr) {
  // "MM/YYYY" → sayısal sıra değeri
  if (!ayStr) return 0;
  var parts = ayStr.split('/');
  if (parts.length < 2) return 0;
  var m = parseInt(parts[0], 10) || 0;
  var y = parseInt(parts[1], 10) || 0;
  return y * 100 + m;
}

// ── 3. buildPharmacyProfiles() ────────────────────────────────────────
// ECZANE_RAW'ı işleyerek her eczane için kapsamlı profil üretir
function buildPharmacyProfiles(tttFilter) {
  if (!ECZANE_RAW || !Array.isArray(ECZANE_RAW) || ECZANE_RAW.length === 0) {
    return [];
  }

  // TTT filtresi opsiyonel
  var source = tttFilter
    ? ECZANE_RAW.filter(function(r) { return r.ttt === tttFilter; })
    : ECZANE_RAW;

  if (!source.length) return [];

  // Eczane bazında veri topla
  var eczMap = {};

  source.forEach(function(r) {
    var key = r.gln || r.ad;
    if (!key) return;
    var adet = parseInt(r.adet, 10) || 0;
    if (!eczMap[key]) {
      eczMap[key] = {
        gln:    r.gln || '',
        eczane: r.ad  || '',
        brick:  r.brick || '',
        ttt:    r.ttt || '',
        // ay → kutu haritası
        aylar: {},
        urunler: new Set()
      };
    }
    var e = eczMap[key];
    // Brick veya ttt güncellenebilir (son değer baskın)
    if (r.brick) e.brick = r.brick;
    if (r.ttt)   e.ttt   = r.ttt;
    // Ay toplamı
    if (r.ay) {
      e.aylar[r.ay] = (e.aylar[r.ay] || 0) + adet;
    }
    if (r.urun) e.urunler.add(r.urun);
  });

  var profiles = [];

  Object.values(eczMap).forEach(function(e) {
    try {
      var profile = _buildSingleProfile(e);
      if (profile) profiles.push(profile);
    } catch (err) {
      // null-safe: tek eczane hata verse devam et
    }
  });

  return profiles;
}

// ── 4. Tek eczane profili oluştur ─────────────────────────────────────
function _buildSingleProfile(e) {
  var aylar = e.aylar || {};
  var ayKeys = Object.keys(aylar).sort(function(a, b) {
    return _piMonthToNum(a) - _piMonthToNum(b);
  });

  if (!ayKeys.length) return null;

  var totalBoxes    = 0;
  var monthCount    = ayKeys.length;
  var monthlyBoxes  = []; // [{ ay, kutu }]

  ayKeys.forEach(function(ay) {
    var kutu = aylar[ay] || 0;
    totalBoxes += kutu;
    monthlyBoxes.push({ ay: ay, kutu: kutu });
  });

  var lastMonthBoxes = monthlyBoxes[monthlyBoxes.length - 1].kutu;
  var avgBoxes = monthCount > 0 ? totalBoxes / monthCount : 0;

  // ── 5. Momentum analizi (son 3 ay) ──────────────────────────────────
  var last3 = monthlyBoxes.slice(-3).map(function(x) { return x.kutu; });
  var momentum = _calcMomentum(last3);

  // ── 6. Kampanya spike tespiti ────────────────────────────────────────
  var spikeFlag = _detectSpike(monthlyBoxes, avgBoxes);

  // ── 7. Reorder olasılığı ─────────────────────────────────────────────
  var reorderProbability = _calcReorderProbability({
    monthlyBoxes: monthlyBoxes,
    monthCount:   monthCount,
    lastMonthBoxes: lastMonthBoxes,
    avgBoxes:     avgBoxes,
    momentum:     momentum,
    spikeFlag:    spikeFlag
  });

  // ── 8. Next month forecast ───────────────────────────────────────────
  var forecastBoxes = _calcForecast(monthlyBoxes, avgBoxes, momentum);

  // ── 9. Kayıp eczane riski ────────────────────────────────────────────
  var lostRisk = _detectLostRisk(monthlyBoxes);

  // ── 10. Consistency (düzenlilik) ────────────────────────────────────
  var consistency = _calcConsistency(monthlyBoxes, avgBoxes);

  // ── 11. Scoring formula ──────────────────────────────────────────────
  var momentumScore = _momentumToScore(momentum);
  var rawScore = (
    momentumScore         * 0.25 +
    reorderProbability    * 0.35 +
    Math.min(forecastBoxes / Math.max(avgBoxes, 1) * 50, 100) * 0.20 +
    consistency           * 0.20
  );
  // 0-100 normalize
  var score = Math.min(100, Math.max(0, Math.round(rawScore)));

  return {
    gln:               e.gln,
    eczane:            e.eczane,
    brick:             e.brick,
    ttt:               e.ttt,
    totalBoxes:        totalBoxes,
    totalProducts:     e.urunler.size,
    monthCount:        monthCount,
    lastMonthBoxes:    lastMonthBoxes,
    avgBoxes:          Math.round(avgBoxes * 10) / 10,
    trend:             _calcTrend(monthlyBoxes),
    momentum:          momentum,
    spikeFlag:         spikeFlag,
    lostRisk:          lostRisk,
    reorderProbability: reorderProbability,
    forecastBoxes:     forecastBoxes,
    consistency:       Math.round(consistency),
    score:             score
  };
}

// ── Momentum hesapla ──────────────────────────────────────────────────
function _calcMomentum(last3) {
  if (!last3 || last3.length < 2) return 'stabil';
  var nonZero = last3.filter(function(v) { return v > 0; });
  if (nonZero.length < 2) return 'düşüş';

  var first = last3[0] || 0;
  var last  = last3[last3.length - 1] || 0;

  if (last3.length === 1) return 'stabil';

  // Yüzde değişim
  if (first === 0) {
    return last > 0 ? 'yükselen' : 'stabil';
  }

  var pct = (last - first) / first;

  if (pct >= 0.30) return 'yükselen';
  if (pct <= -0.30) return 'düşüş';
  return 'stabil';
}

// ── Momentumu sayısal skora çevir ─────────────────────────────────────
function _momentumToScore(momentum) {
  if (momentum === 'yükselen') return 85;
  if (momentum === 'stabil')   return 55;
  if (momentum === 'düşüş')    return 20;
  return 50;
}

// ── Trend etiketi (son 2 ay) ──────────────────────────────────────────
function _calcTrend(monthlyBoxes) {
  if (!monthlyBoxes || monthlyBoxes.length < 2) return 'Yeterli veri yok';
  var prev = monthlyBoxes[monthlyBoxes.length - 2].kutu;
  var curr = monthlyBoxes[monthlyBoxes.length - 1].kutu;
  if (curr > prev * 1.15) return 'Yükselen trend';
  if (curr < prev * 0.85) return 'Düşen trend';
  return 'Stabil';
}

// ── Kampanya spike tespiti ────────────────────────────────────────────
// Bir ayda ortalmanın 3x+ üzerinde alış varsa spike
function _detectSpike(monthlyBoxes, avgBoxes) {
  if (!monthlyBoxes || monthlyBoxes.length < 2 || avgBoxes < 1) return false;
  var threshold = avgBoxes * 3;
  return monthlyBoxes.some(function(m) { return m.kutu >= threshold; });
}

// ── Reorder olasılığı (0-100) ─────────────────────────────────────────
function _calcReorderProbability(opts) {
  var score = 50; // başlangıç

  var monthCount     = opts.monthCount     || 0;
  var lastMonthBoxes = opts.lastMonthBoxes || 0;
  var avgBoxes       = opts.avgBoxes       || 0;
  var momentum       = opts.momentum       || 'stabil';
  var spikeFlag      = opts.spikeFlag      || false;
  var monthlyBoxes   = opts.monthlyBoxes   || [];

  // + Düzenli sipariş (3+ ay sipariş verdiyse)
  if (monthCount >= 6) score += 25;
  else if (monthCount >= 3) score += 15;
  else if (monthCount >= 2) score += 8;

  // + Son ay aktifse
  if (lastMonthBoxes > 0) score += 15;
  else score -= 20; // son ay sipariş yok

  // + Yükselen trend
  if (momentum === 'yükselen') score += 12;
  else if (momentum === 'düşüş') score -= 12;

  // - Kampanya sıçraması: büyük spike sonrası stok dolu, yeni sipariş gecikir
  if (spikeFlag) {
    // Spike son aylarda mıydı?
    var last2 = monthlyBoxes.slice(-2).map(function(x) { return x.kutu; });
    var avgLast2 = last2.reduce(function(s, v) { return s + v; }, 0) / Math.max(1, last2.length);
    if (avgLast2 >= avgBoxes * 2.5) {
      score -= 25; // spike henüz taze, stok var
    } else {
      score -= 10; // spike eski, etki azalmış
    }
  }

  // - Uzun süredir sipariş yok
  var zeroCount = monthlyBoxes.filter(function(m) { return m.kutu === 0; }).length;
  if (zeroCount >= 3) score -= 20;
  else if (zeroCount >= 2) score -= 10;

  // + Küçük ama düzenli alışlar (ortalama tutarlıysa)
  if (avgBoxes > 0 && avgBoxes <= 30 && monthCount >= 3) score += 8;

  return Math.min(99, Math.max(1, Math.round(score)));
}

// ── Next month forecast ───────────────────────────────────────────────
function _calcForecast(monthlyBoxes, avgBoxes, momentum) {
  if (!monthlyBoxes || monthlyBoxes.length === 0) return 0;

  var last3vals = monthlyBoxes.slice(-3).map(function(m) { return m.kutu; });

  // Basit lineer projeksiyon: son 3 aya linear fit
  var base = 0;
  if (last3vals.length >= 3) {
    // Son 3 ay ağırlıklı ortalama (en yeni 3x, orta 2x, eski 1x)
    var w = [1, 2, 3];
    var wSum = 0, vSum = 0;
    last3vals.forEach(function(v, i) {
      vSum += v * w[i];
      wSum += w[i];
    });
    base = wSum > 0 ? vSum / wSum : avgBoxes;

    // Trend etkisi
    var first = last3vals[0];
    var last  = last3vals[last3vals.length - 1];
    if (first > 0) {
      var delta = (last - first) / last3vals.length;
      base += delta; // bir adım daha ilerlet
    }
  } else if (last3vals.length >= 2) {
    var diff = last3vals[1] - last3vals[0];
    base = Math.max(0, last3vals[1] + diff);
  } else {
    base = avgBoxes;
  }

  // Momentum çarpanı
  if (momentum === 'yükselen') base *= 1.10;
  else if (momentum === 'düşüş') base *= 0.85;

  return Math.max(0, Math.round(base));
}

// ── Kayıp eczane riski ────────────────────────────────────────────────
// Son ay(lar)da sıfır ama öncesinde aktifse risk var
function _detectLostRisk(monthlyBoxes) {
  if (!monthlyBoxes || monthlyBoxes.length < 2) return false;
  var lastMonth = monthlyBoxes[monthlyBoxes.length - 1].kutu;
  var prevMonth = monthlyBoxes[monthlyBoxes.length - 2].kutu;
  var hasPriorActivity = monthlyBoxes.slice(0, -1).some(function(m) { return m.kutu > 20; });

  // Ani düşüş: önceki ay büyük alış, son ay çok düşük
  if (hasPriorActivity) {
    if (lastMonth === 0) return true;
    if (prevMonth > 0 && lastMonth < prevMonth * 0.25) return true;
  }
  return false;
}

// ── Düzenlilik (consistency) ──────────────────────────────────────────
function _calcConsistency(monthlyBoxes, avgBoxes) {
  if (!monthlyBoxes || monthlyBoxes.length < 2 || avgBoxes < 1) return 30;
  // Standart sapma bazlı tutarlılık
  var mean = avgBoxes;
  var variance = monthlyBoxes.reduce(function(s, m) {
    var diff = m.kutu - mean;
    return s + diff * diff;
  }, 0) / monthlyBoxes.length;
  var stdDev = Math.sqrt(variance);
  var cv = stdDev / Math.max(mean, 1); // coefficient of variation
  // CV düşükse tutarlı: 0→100, 2→0
  var score = Math.max(0, 100 - cv * 50);
  return Math.min(100, score);
}

// ── 12. Top30 Listesi ─────────────────────────────────────────────────
function buildTop30Pharmacies(tttFilter) {
  var profiles = buildPharmacyProfiles(tttFilter);
  if (!profiles.length) return [];

  // Score'a göre sırala
  profiles.sort(function(a, b) { return b.score - a.score; });

  var top30 = profiles.slice(0, 30);

  return top30.map(function(p, idx) {
    return {
      rank:               idx + 1,
      eczane:             p.eczane,
      brick:              p.brick,
      ttt:                p.ttt,
      score:              p.score,
      reorderProbability: p.reorderProbability,
      forecastBoxes:      p.forecastBoxes,
      momentum:           p.momentum,
      spikeFlag:          p.spikeFlag,
      lostRisk:           p.lostRisk,
      trend:              p.trend,
      avgBoxes:           p.avgBoxes,
      lastMonthBoxes:     p.lastMonthBoxes,
      reason:             _buildReason(p)
    };
  });
}

// ── Neden seçildi açıklaması ──────────────────────────────────────────
function _buildReason(p) {
  var reasons = [];
  if (p.momentum === 'yükselen')       reasons.push('Yükselen trend');
  if (p.reorderProbability >= 80)      reasons.push('Yüksek sipariş olasılığı');
  if (p.reorderProbability >= 60 && p.reorderProbability < 80) reasons.push('Sipariş yaklaşıyor');
  if (p.forecastBoxes > p.avgBoxes * 1.2) reasons.push('Güçlü forecast');
  if (p.monthCount >= 6)               reasons.push('Düzenli müşteri');
  if (p.lostRisk)                      reasons.push('⚠ Kayıp riski');
  if (p.spikeFlag)                     reasons.push('Kampanya alıcısı');
  if (!reasons.length)                 reasons.push('Potansiyel fırsat');
  return reasons[0]; // en öncelikli sebep
}

// ── 13. Fırsatlar ve Riskler ──────────────────────────────────────────
function buildOpportunitiesAndRisks(profiles) {
  var opportunities = [];
  var risks = [];

  if (!profiles || !profiles.length) return { opportunities: [], risks: [] };

  profiles.forEach(function(p) {
    // Fırsatlar: yükselen momentum + yüksek reorder
    if (p.momentum === 'yükselen' && p.reorderProbability >= 70) {
      opportunities.push({
        eczane: p.eczane,
        brick:  p.brick,
        reason: 'Yükselen trend + sipariş zamanı yaklaşıyor',
        forecastBoxes: p.forecastBoxes
      });
    }
    // Riskler: kayıp eczane veya ciddi düşüş
    if (p.lostRisk) {
      risks.push({
        eczane: p.eczane,
        brick:  p.brick,
        reason: 'Son ay sipariş yok — kayıp riski',
        lastMonthBoxes: p.lastMonthBoxes
      });
    }
    if (p.momentum === 'düşüş' && p.reorderProbability < 40) {
      risks.push({
        eczane: p.eczane,
        brick:  p.brick,
        reason: 'Düşen trend + düşük sipariş olasılığı',
        lastMonthBoxes: p.lastMonthBoxes
      });
    }
  });

  return {
    opportunities: opportunities.slice(0, 10),
    risks:         risks.slice(0, 10)
  };
}

// ── 14. Ana orkestrasyon fonksiyonu ──────────────────────────────────
function runPharmacyIntelligence(tttFilter) {
  try {
    if (!ECZANE_RAW || !eczaneLoaded) {
      console.warn('[PharmacyIntelligence] ECZANE_RAW henüz yüklenmedi');
      return false;
    }

    var profiles = buildPharmacyProfiles(tttFilter);
    var top30    = buildTop30Pharmacies(tttFilter);
    var opRisk   = buildOpportunitiesAndRisks(profiles);

    window.PHARMACY_INTELLIGENCE = {
      top30:       top30,
      profiles:    profiles,
      opportunities: opRisk.opportunities,
      risks:         opRisk.risks,
      generatedAt:   new Date().toISOString(),
      tttFilter:     tttFilter || 'TÜMÜ'
    };

    console.log('[PharmacyIntelligence] ✅ Üretildi:',
      profiles.length, 'profil |',
      top30.length, 'top30 |',
      opRisk.risks.length, 'risk |',
      opRisk.opportunities.length, 'fırsat'
    );
    return true;
  } catch (err) {
    console.error('[PharmacyIntelligence] Hata:', err);
    return false;
  }
}

// ── 15. AI Context Builder ────────────────────────────────────────────
function buildPharmacyContext(tttFilter) {
  try {
    var pi = window.PHARMACY_INTELLIGENCE;

    // Veri yoksa üret
    if (!pi || !pi.top30 || !pi.top30.length || pi.tttFilter !== (tttFilter || 'TÜMÜ')) {
      runPharmacyIntelligence(tttFilter);
      pi = window.PHARMACY_INTELLIGENCE;
    }

    if (!pi || !pi.top30 || !pi.top30.length) {
      return '\n\n--- ECZANE INTELLIGENCE ---\n(Veri yok veya yüklenmedi)';
    }

    var lines = [
      '',
      '--- ECZANE INTELLIGENCE (Phase 4.5) ---',
      'Üretim: ' + (pi.generatedAt ? pi.generatedAt.slice(0, 10) : '—'),
      'Toplam profil: ' + (pi.profiles ? pi.profiles.length : 0),
      '',
      '=== BU HAFTA ZİYARET EDİLECEK TOP 30 ECZANE ==='
    ];

    pi.top30.forEach(function(e) {
      lines.push(
        '#' + e.rank + ' ' + e.eczane +
        ' [' + e.brick + ']' +
        ' | Skor: ' + e.score +
        ' | Sipariş %: ' + e.reorderProbability +
        ' | Tahmin: ' + e.forecastBoxes + ' kutu' +
        ' | ' + e.reason
      );
    });

    // Toplam potansiyel
    var totalForecast = pi.top30.reduce(function(s, e) { return s + (e.forecastBoxes || 0); }, 0);
    lines.push('');
    lines.push('TOP 30 Toplam Potansiyel: ' + totalForecast + ' kutu');

    // Riskler
    if (pi.risks && pi.risks.length) {
      lines.push('');
      lines.push('⚠ KAYIP RİSKİ OLAN ECZANELER:');
      pi.risks.slice(0, 5).forEach(function(r) {
        lines.push('  ' + r.eczane + ' [' + r.brick + ']: ' + r.reason);
      });
    }

    // Fırsatlar
    if (pi.opportunities && pi.opportunities.length) {
      lines.push('');
      lines.push('💡 FIRSAT ECZANELER:');
      pi.opportunities.slice(0, 5).forEach(function(o) {
        lines.push('  ' + o.eczane + ' [' + o.brick + ']: ' + o.reason + ' (Tahmin: ' + o.forecastBoxes + ' kutu)');
      });
    }

    return lines.join('\n');

  } catch (err) {
    console.warn('[PharmacyIntelligence] buildPharmacyContext hata:', err.message);
    return '';
  }
}

// ── 16. Dashboard Kartı Render ────────────────────────────────────────
function renderPharmacyIntelligenceCard(containerId, tttFilter) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Önce veriyi üret
  var ok = runPharmacyIntelligence(tttFilter);
  var pi = window.PHARMACY_INTELLIGENCE;

  if (!ok || !pi || !pi.top30 || !pi.top30.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Veri yükleniyor veya eczane verisi mevcut değil.</div>';
    return;
  }

  var totalForecast = pi.top30.reduce(function(s, e) { return s + (e.forecastBoxes || 0); }, 0);
  var avgScore = Math.round(pi.top30.reduce(function(s, e) { return s + e.score; }, 0) / pi.top30.length);

  // Tablo satırları
  var rows = pi.top30.map(function(e) {
    var mColor = e.momentum === 'yükselen' ? '#16A34A'
               : e.momentum === 'düşüş'   ? '#DC2626'
               : '#0891B2';
    var riskBadge = e.lostRisk   ? '<span style="font-size:9px;background:#FEE2E2;color:#DC2626;border-radius:4px;padding:1px 5px;margin-left:4px">⚠ Risk</span>' : '';
    var spikeBadge = e.spikeFlag ? '<span style="font-size:9px;background:#FEF3C7;color:#D97706;border-radius:4px;padding:1px 5px;margin-left:2px">🔔 Spike</span>' : '';

    return '<tr>' +
      '<td style="font-weight:700;color:var(--c1);text-align:center">' + e.rank + '</td>' +
      '<td style="font-weight:600">' + e.eczane + riskBadge + spikeBadge + '</td>' +
      '<td style="font-size:10px;color:var(--dim)">' + e.brick + '</td>' +
      '<td style="text-align:center">' +
        '<span style="font-weight:800;font-size:13px;color:' + (e.score >= 75 ? '#521FD1' : e.score >= 50 ? '#0891B2' : '#64748B') + '">' + e.score + '</span>' +
      '</td>' +
      '<td style="text-align:center;font-weight:700;color:#0891B2">' + e.forecastBoxes + '</td>' +
      '<td style="text-align:center">' +
        '<div style="display:flex;align-items:center;gap:4px;justify-content:center">' +
          '<div style="width:36px;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden">' +
            '<div style="height:100%;width:' + e.reorderProbability + '%;background:' + (e.reorderProbability >= 75 ? '#16A34A' : e.reorderProbability >= 50 ? '#D97706' : '#DC2626') + ';border-radius:3px"></div>' +
          '</div>' +
          '<span style="font-size:10px;font-weight:700">%' + e.reorderProbability + '</span>' +
        '</div>' +
      '</td>' +
      '<td style="font-size:10px;color:' + mColor + ';font-weight:600">' + e.momentum + '</td>' +
      '<td style="font-size:10px;color:var(--dim)">' + e.reason + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="card">' +
      '<div class="card-hd">' +
        '<span class="card-title">🏆 Bu Hafta Ziyaret Edilecek 30 Eczane</span>' +
        '<span class="card-badge">' + pi.top30.length + ' eczane</span>' +
        '<span class="card-badge" style="margin-left:8px;background:#EFF6FF;color:#1D4ED8">Toplam tahmin: ' + totalForecast + ' kutu</span>' +
        '<span class="card-badge" style="margin-left:8px;background:#F0FDF4;color:#15803D">Ort. skor: ' + avgScore + '</span>' +
      '</div>' +
      '<div class="card-body-0 scroll-x">' +
        '<table class="tbl" style="min-width:750px">' +
          '<thead><tr>' +
            '<th style="text-align:center">#</th>' +
            '<th>Eczane</th>' +
            '<th>Brick</th>' +
            '<th style="text-align:center">Skor</th>' +
            '<th style="text-align:center">Tahmini Kutu</th>' +
            '<th style="text-align:center">Sipariş %</th>' +
            '<th>Momentum</th>' +
            '<th>Neden</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

// ── 17. Entegrasyon: buildTTTContext'e otomatik enjeksiyon ─────────────
// ai-context.js'deki buildTTTContext çıktısına pharmacy context ekle
// Bu fonksiyon ai-context.js'deki try/catch bloklarına eşdeğer yapı kullanır
(function _patchAiContextForPharmacy() {
  // Sayfa tamamen yüklendikten sonra monkey-patch uygula
  // NOT: Bu yaklaşım mevcut Phase 4.x pattern'ine uygundur
  // buildTTTContext'e doğrudan dokunmak yerine, ai-service.js'nin
  // context toplama aşamasına entegre olacak şekilde global flag bırak
  window._PHARMACY_INTELLIGENCE_READY = true;
})();

console.log('[PharmacyIntelligence] ✅ Phase 4.5 yüklendi');
