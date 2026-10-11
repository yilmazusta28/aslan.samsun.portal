// ══════════════════════════════════════════════════════════════
//  js/ai/voice-intents.js — Sesli soru yönlendirici ("önce motor, LLM ince katman")
//
//  Amaç: Her sesli soruda ~9-10K token'lık TÜM bağlamı Sonnet'e göndermek yerine
//  soruyu üç kademeden geçirmek:
//
//   Kademe 0  (0 TL)   Kurallı cevap — sık sorular (kalan hedef, performans, brick,
//                      ürün, pazar payı, en geride/iyi brick) mevcut motor verisinden
//                      konuşma diliyle hazır şablonla cevaplanır. LLM ÇAĞRILMAZ.
//   Kademe 1  (ucuz)   Açık uçlu ama basit soru → YALNIZ ilgili veri bölümleri
//                      (~0,7-1,2K token) + küçük model (Haiku sınıfı).
//   Kademe 2           "Neden / ne yapmalıyım / strateji" → ilgili bölümler
//                      (~2-3K token) + Sonnet.
//
//  Çıktı: window.VoiceIntents.route(ttt, soru) →
//     { tier:0, text }                              (hazır cevap)
//   | { tier:1|2, model, maxTokens, context }       (LLM'e gidecek daraltılmış bağlam)
//
//  Sayılar konuşma diline çevrilir ("yaklaşık 244 bin lira", "yüzde 52"); isimlere ek
//  getirilmez (Türkçe ünlü uyumu hatası olmasın diye cümleler ek gerektirmeyecek kurulur).
//
//  Bağımlılıklar (hepsi opsiyonel, yoksa LLM kademesine düşülür):
//   GENEL, calculateRunRate, buildTTTContext, buildRouteContext,
//   window.buildManagerBrickDetail (manager-panel-engine.js), window.BRICK_TL_HEDEF.
//  GitHub Pages compatible: classic script, no ES modules.
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var SIMPLE_MODEL = 'claude-haiku-4-5-20251001';   // worker izin listesinde
  var DEEP_MODEL   = 'claude-sonnet-5';

  // ── yardımcılar ─────────────────────────────────────────────────
  function _key(s) {
    if (typeof window.brickTlKey === 'function') return window.brickTlKey(s);
    return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function _norm(q) { return _key(q).replace(/[^A-Z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  function sayTL(n) {
    var a = Math.abs(Math.round(+n || 0)), s;
    if (a >= 1e6) s = (Math.round(a / 1e5) / 10).toString().replace('.', ',') + ' milyon lira';
    else if (a >= 1000) {
      var k = a / 1000;
      s = (k < 10 ? (Math.round(k * 10) / 10).toString().replace('.', ',') : Math.round(k).toString()) + ' bin lira';
    } else s = a + ' lira';
    return (a >= 1000 ? 'yaklaşık ' : '') + s;
  }
  function sayPct(p) {
    p = +p || 0;
    return 'yüzde ' + (p >= 10 ? Math.round(p) : (Math.round(p * 10) / 10).toString().replace('.', ','));
  }
  function sayKutu(n) {
    var a = Math.abs(Math.round(+n || 0));
    return (a >= 1000 ? 'yaklaşık ' : '') + a + ' kutu';
  }

  // ── veri erişimi ────────────────────────────────────────────────
  function _total(ttt) {
    try { return GENEL.find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; }) || null; } catch (e) { return null; }
  }
  function _products(ttt) {
    try { return GENEL.filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; }); } catch (e) { return []; }
  }
  function _rr(ttt) {
    try { return (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : null; } catch (e) { return null; }
  }
  // Brick bazlı GERÇEK veri (Brick_TL_Hedef.csv) olan satırlar
  function _bricks(ttt) {
    try {
      if (typeof window.buildManagerBrickDetail !== 'function') return [];
      return window.buildManagerBrickDetail(ttt).filter(function (r) { return r.fromCsv; });
    } catch (e) { return []; }
  }

  // ── soru sınıflandırma ──────────────────────────────────────────
  // "nasıl" tek başına strateji değildir ("performansım nasıl?"); yalnız eylem kalıplarıyla ("nasıl artırırım") strateji sayılır.
  var RX_STRATEGIC = /\b(NEDEN|NICIN|NIYE|NASIL (YAP|ARTIR|ULAS|KAPAT|DEGISTIR|ILERLE|DAVRAN|GELISTIR)|NE YAP|ONER|TAVSIYE|STRATEJI|ANALIZ|YORUM|ACIKLA|KARSILASTIR|PLAN|FIRSAT|RISK|IPUCU|KOC|ULASMAK|ULASABILIR|YAPMALI|YAPSAM)/;
  var RX_METRIC    = /KALAN|KALDI|PERFORMANS|GERCEKLES|HEDEF|SATIS|SATTIM|\bPP\b|PAZAR PAY|KUTU|YUZDE/;
  var RX_KUTU      = /\bKUTU/;
  var RX_PP        = /PAZAR PAY|PAZAR HISSE|\bPP\b/;
  var RX_KALAN     = /\bKALAN|\bKALDI|\bKALMIS/;
  var RX_PERF      = /PERFORMANS|GERCEKLES|YUZDE KAC|KAC YUZDE|NE DURUMDA|NASILIM|HEDEFE NE KADAR|NE KADAR YAPTIM|NE KADAR SATTIM/;
  var RX_WORST     = /GERIDE|ACIK VER|EN KOTU|EN DUSUK|EN ZAYIF|EN UZAK|ONCELIK|DIKKAT/;
  var RX_BEST      = /EN IYI|EN YUKSEK|EN BASARILI|LIDER|ONDE/;
  var RX_BRICKWORD = /BRICK|BOLGE/;

  function _productMention(nq, ttt) {
    var rows = _products(ttt), found = null;
    rows.forEach(function (r) {
      var k = _key(r.urun), first = k.split(' ')[0];
      if (!found && (nq.indexOf(k) >= 0 || (first.length >= 5 && nq.indexOf(first) >= 0))) found = r;
    });
    return found;
  }

  // Soruda geçen brick(ler): ünlü ekleri ("Çorum'da") için startsWith eşleşmesi; çok brick'te geçen
  // ortak kelimeler ("MERKEZ", il adı) daha düşük ağırlıklı.
  function _brickMatches(nq, rows) {
    var qTok = nq.split(' ').filter(function (t) { return t.length >= 4; });
    if (!qTok.length || !rows.length) return [];
    var freq = {};
    rows.forEach(function (r) {
      var seen = {};
      _key(r.brick).split(/[ +\-]+/).forEach(function (t) { if (t.length >= 4 && !seen[t]) { seen[t] = 1; freq[t] = (freq[t] || 0) + 1; } });
    });
    var scored = rows.map(function (r) {
      var score = 0;
      _key(r.brick).split(/[ +\-]+/).forEach(function (bt) {
        if (bt.length < 4) return;
        if (qTok.some(function (qt) { return qt.indexOf(bt) === 0; })) score += 1 / freq[bt];
      });
      return { r: r, score: score };
    }).filter(function (x) { return x.score > 0; });
    if (!scored.length) return [];
    var best = Math.max.apply(null, scored.map(function (x) { return x.score; }));
    return scored.filter(function (x) { return Math.abs(x.score - best) < 1e-9; }).map(function (x) { return x.r; });
  }

  // Soruda temsilcinin KENDİ listesinde olmayan (başka temsilcinin) bir brick geçiyorsa sessizce
  // toplam cevap vermek yanıltıcı olur → açıkça söyle.
  function _foreignBrick(nq, ownRows) {
    var all = window.BRICK_TL_HEDEF;
    if (!all) return null;
    var own = {}; ownRows.forEach(function (r) { own[_key(r.brick)] = 1; });
    var others = Object.keys(all).filter(function (k) { return !own[k]; }).map(function (k) { return { brick: all[k].brick }; });
    var m = _brickMatches(nq, others);
    return m.length ? m : null;
  }

  // ── Kademe 0 cevap üreticileri (hepsi: metin | null) ────────────
  function _brickLine(r, kutu) {
    if (kutu) {
      if (r.hedefKutu == null) return null;
      if (!(r.hedefKutu > 0)) return r.brick + ' için bu dönem hedef görünmüyor.';
      var pk = r.satisKutu / r.hedefKutu * 100;
      return r.brick + ': hedef ' + sayKutu(r.hedefKutu) + ', satış ' + sayKutu(r.satisKutu) +
        ', gerçekleşme ' + sayPct(pk) + '. Kalan ' + sayKutu(r.kalanKutu) + '.';
    }
    if (!(r.hedefTL > 0)) return r.brick + ' için bu dönem hedef görünmüyor.';
    return r.brick + ': hedef ' + sayTL(r.hedefTL) + ', satış ' + sayTL(r.satisTL) +
      ', gerçekleşme ' + sayPct(r.satisTL / r.hedefTL * 100) + '. Kalan ' + sayTL(r.kalanTL) + '.';
  }

  function _ansBrick(ttt, nq, matches, urunRow) {
    var kutu = RX_KUTU.test(nq);
    // Brick + ürün: CSV'deki ürün kırılımı
    if (urunRow && window.BRICK_TL_HEDEF && !kutu) {
      var outP = [];
      matches.slice(0, 3).forEach(function (r) {
        var rec = window.BRICK_TL_HEDEF[_key(r.brick)];
        var u = rec && rec.urunler.filter(function (x) { return _key(x.urun).replace(/ /g, '') === _key(urunRow.urun).replace(/ /g, ''); })[0];
        if (!u) return;
        var t = r.brick + ' ' + urunRow.urun + ': hedef ' + sayTL(u.hedef) + ', satış ' + sayTL(u.satis) +
          (u.hedef > 0 ? ', gerçekleşme ' + sayPct(u.satis / u.hedef * 100) : '');
        if (RX_PP.test(nq) && u.pazar > 0) t += ', pazar payı ' + sayPct(u.satis / u.pazar * 100);
        outP.push(t + '.');
      });
      return outP.length ? outP.join(' ') : null;
    }
    // Brick pazar payı
    if (RX_PP.test(nq)) {
      var outS = [];
      matches.slice(0, 2).forEach(function (r) {
        var ps = (r.products || []).filter(function (p) { return p.ourShare != null; })
          .map(function (p) { return p.urun + ' ' + sayPct(p.ourShare); });
        if (ps.length) outS.push(r.brick + ' pazar payın: ' + ps.join(', ') + '.');
      });
      return outS.length ? outS.join(' ') : null;
    }
    var lines = matches.slice(0, 3).map(function (r) { return _brickLine(r, kutu); });
    if (lines.some(function (l) { return !l; })) return null;
    return lines.join(' ');
  }

  function _ansRank(ttt, nq) {
    var rows = _bricks(ttt).filter(function (r) { return r.hedefTL > 0; });
    if (rows.length < 2) return null;
    var kutu = RX_KUTU.test(nq) && rows[0].hedefKutu != null;
    var best = RX_BEST.test(nq) && !RX_WORST.test(nq);
    var pct = function (r) { return kutu ? r.satisKutu / r.hedefKutu * 100 : r.satisTL / r.hedefTL * 100; };
    var kal = function (r) { return kutu ? r.kalanKutu : r.kalanTL; };
    var fmt = kutu ? sayKutu : sayTL;
    var sorted = rows.slice().sort(best ? function (a, b) { return pct(b) - pct(a); }
                                        : function (a, b) { return kal(b) - kal(a); }).slice(0, 3);
    var head = best ? 'Gerçekleşmesi en yüksek üç brick: ' : 'Hedefe en uzak, yani kalan hedefi en yüksek üç brick: ';
    return head + sorted.map(function (r) {
      return r.brick + ', gerçekleşme ' + sayPct(pct(r)) + ', kalan ' + fmt(kal(r));
    }).join('; ') + '.';
  }

  function _ansProduct(ttt, nq, urunRow) {
    if (RX_KUTU.test(nq)) return null;   // ürün bazlı kutu özeti kurallı katmanda yok → LLM
    var r = urunRow;
    var t = r.urun + ': hedef ' + sayTL(r.hedef_tl) + ', satış ' + sayTL(r.satis_tl) +
      ', gerçekleşme ' + sayPct(r.tl_pct) + '. Kalan ' + sayTL(r.kalan_tl != null ? r.kalan_tl : Math.max(0, r.hedef_tl - r.satis_tl)) + '.';
    if (RX_PP.test(nq)) {
      var rows = _bricks(ttt), own = 0, mkt = 0;
      rows.forEach(function (b) {
        var rec = window.BRICK_TL_HEDEF && window.BRICK_TL_HEDEF[_key(b.brick)];
        (rec ? rec.urunler : []).forEach(function (u) {
          if (_key(u.urun).replace(/ /g, '') === _key(r.urun).replace(/ /g, '')) { own += u.satis; mkt += u.pazar; }
        });
      });
      if (mkt > 0) t += ' Pazar payın ' + sayPct(own / mkt * 100) + '.';
    }
    return t;
  }

  function _ansKalan(ttt, nq) {
    if (RX_KUTU.test(nq)) {
      var rows = _bricks(ttt);
      if (!rows.length || rows[0].hedefKutu == null) return null;
      var h = 0, s = 0;
      rows.forEach(function (r) { h += r.hedefKutu || 0; s += r.satisKutu || 0; });
      return 'Hedefine ' + sayKutu(Math.max(0, h - s)) + ' kaldı. Toplam hedef ' + sayKutu(h) + ', şimdiye kadar ' + sayKutu(s) + '.';
    }
    var g = _total(ttt);
    if (!g) return null;
    var kalan = g.kalan_tl != null ? g.kalan_tl : Math.max(0, g.hedef_tl - g.satis_tl);
    var t = 'Hedefine ' + sayTL(kalan) + ' kaldı. Hedef ' + sayTL(g.hedef_tl) + ', satışın ' + sayTL(g.satis_tl) + '.';
    var rr = _rr(ttt);
    if (rr && rr.remainingDays > 0) {
      t += ' Dönemde ' + rr.remainingDays + ' iş günü var; hedefi tam kapatmak için günde ortalama ' + sayTL(kalan / rr.remainingDays) + ' gerekir.';
    }
    return t;
  }

  function _ansPerf(ttt) {
    var g = _total(ttt);
    if (!g || !(g.hedef_tl > 0)) return null;
    var t = 'Gerçekleşmen ' + sayPct(g.tl_pct != null ? g.tl_pct : g.satis_tl / g.hedef_tl * 100) +
      '. Hedef ' + sayTL(g.hedef_tl) + ', satış ' + sayTL(g.satis_tl) + '.';
    var rr = _rr(ttt);
    if (rr && rr.projectedMonthEnd > 0) {
      t += ' Mevcut tempoyla dönem sonu tahminim ' + sayPct(rr.projectedMonthEnd / g.hedef_tl * 100) + '.';
    }
    return t;
  }

  function _ansPP(ttt) {
    var rows = _bricks(ttt);
    if (!rows.length || !window.BRICK_TL_HEDEF) return null;
    var agg = {};
    rows.forEach(function (b) {
      var rec = window.BRICK_TL_HEDEF[_key(b.brick)];
      (rec ? rec.urunler : []).forEach(function (u) {
        var a = agg[u.urun] || (agg[u.urun] = { own: 0, mkt: 0 });
        a.own += u.satis; a.mkt += u.pazar;
      });
    });
    var parts = Object.keys(agg).filter(function (k) { return agg[k].mkt > 0; })
      .map(function (k) { return k + ' ' + sayPct(agg[k].own / agg[k].mkt * 100); });
    return parts.length ? 'Bölgendeki pazar payın: ' + parts.join(', ') + '.' : null;
  }

  // ── Kademe 1/2: daraltılmış bağlam ──────────────────────────────
  function _sections(full) {
    var secs = [], cur = { title: '', body: [] };
    String(full || '').split('\n').forEach(function (l) {
      var m = /^(===|---)\s+(.+?)\s+(===|---)$/.exec(l.trim());
      if (m && !/RAPORU? SONU/.test(m[2])) { secs.push(cur); cur = { title: _key(m[2]), body: [l] }; }
      else cur.body.push(l);
    });
    secs.push(cur);
    return secs;
  }

  var TOPICS = [
    { id: 'pazar',   q: /RAKIP|PAZAR|\bPP\b|\bPAY\b|KONUM|SIRA/,                 s: /PAZAR & RAKIP/ },
    { id: 'tahmin',  q: /TAHMIN|PROJEKSIYON|DONEM SONU|SENARYO|OLASILIK/,        s: /TAHMINI PROJEKSIYON/ },
    { id: 'prim',    q: /PRIM|BAREM|KOMPANZ/,                                    s: /^PRIM \(PHASE|SIMULATOR \(PHASE/ },
    { id: 'eczane',  q: /ECZANE|ROTA|ZIYARET|BUGUN|NEREYE|MUSTERI/,              s: /ECZANE VERISI/ },
    { id: 'brick',   q: /BRICK|BOLGE/,                                           s: /BRICK ANALIZI/ }
  ];
  var BASE_RX = /^$|BOLGE SATIS VERILERI|GENEL PERFORMANS|PROJEKSIYON ANALIZI|URUN BAZLI PERFORMANS|KALAN HEDEF|SURE OZETI/;
  var STRATEGY_RX = /SATIS INTELLIGENCE|BOLGE OPTIMIZASYON/;

  function _brickSummary(ttt) {
    var rows = _bricks(ttt).filter(function (r) { return r.hedefTL > 0; });
    if (!rows.length) return '';
    var top = rows.slice().sort(function (a, b) { return b.kalanTL - a.kalanTL; }).slice(0, 6);
    return '\n--- BRICK ÖZETİ (gerçek brick hedef/satış, kalan hedefi en yüksek 6 brick) ---\n' +
      top.map(function (r) {
        return r.brick + ': hedef ' + Math.round(r.hedefTL / 1000) + 'K, satış ' + Math.round(r.satisTL / 1000) +
          'K, %' + (r.satisTL / r.hedefTL * 100).toFixed(1) + ', kalan ' + Math.round(r.kalanTL / 1000) + 'K';
      }).join('\n');
  }

  function _scopedContext(ttt, nq, strategic) {
    var full = '';
    try { full = (typeof buildTTTContext === 'function') ? buildTTTContext(ttt) : ''; } catch (e) { full = ''; }
    if (!full) return '';
    var topics = TOPICS.filter(function (t) { return t.q.test(nq); });
    var secs = _sections(full).filter(function (sec) {
      if (BASE_RX.test(sec.title)) return true;
      if (strategic && STRATEGY_RX.test(sec.title)) return true;
      return topics.some(function (t) { return t.s.test(sec.title); });
    });
    var ctx = secs.map(function (s) { return s.body.join('\n'); }).join('\n');
    ctx += _brickSummary(ttt);
    if (topics.some(function (t) { return t.id === 'eczane'; })) {
      try { if (typeof window.buildRouteContext === 'function') ctx += '\n' + window.buildRouteContext(ttt); } catch (e) { /* opsiyonel */ }
    }
    return ctx;
  }

  // ── ana yönlendirici ────────────────────────────────────────────
  function route(ttt, question) {
    var nq = _norm(question);
    var strategic = RX_STRATEGIC.test(nq);
    var res = null;

    if (!strategic) {
      try {
        var rows = _bricks(ttt);
        var urunRow = _productMention(nq, ttt);
        var matches = _brickMatches(nq, rows);
        var text = null;
        var foreign = (!matches.length && RX_METRIC.test(nq)) ? _foreignBrick(nq, rows) : null;
        if (foreign)                                      text = 'Sorduğun brick senin listende görünmüyor: ' + foreign.slice(0, 2).map(function (f) { return f.brick; }).join(' ve ') + (foreign.length > 2 ? ' ve benzerleri' : '') + '.';
        else if (matches.length && matches.length <= 3)  text = _ansBrick(ttt, nq, matches, urunRow);
        else if (RX_BRICKWORD.test(nq) && (RX_WORST.test(nq) || RX_BEST.test(nq))) text = _ansRank(ttt, nq);
        else if (urunRow)                                 text = _ansProduct(ttt, nq, urunRow);
        else if (RX_PP.test(nq))                          text = _ansPP(ttt);
        else if (RX_KALAN.test(nq))                       text = _ansKalan(ttt, nq);
        else if (RX_PERF.test(nq))                        text = _ansPerf(ttt);
        if (text) res = { tier: 0, text: text };
      } catch (e) { console.warn('[voice-intents] kurallı cevap hatası:', e.message); }
    }

    if (!res) {
      var ctx = '';
      try { ctx = _scopedContext(ttt, nq, strategic); } catch (e) { console.warn('[voice-intents] bağlam hatası:', e.message); }
      if (ctx) res = { tier: strategic ? 2 : 1, model: strategic ? DEEP_MODEL : SIMPLE_MODEL, maxTokens: strategic ? 450 : 300, context: ctx };
    }
    if (res) {
      window.VoiceIntents.lastTier = res.tier;
      console.debug('[voice-intents] kademe ' + res.tier + (res.context ? ' (bağlam ~' + Math.round(res.context.length / 3) + ' token, ' + res.model + ')' : ' (LLM yok)'));
    }
    return res;   // null → çağıran eski tam bağlama düşer
  }

  window.VoiceIntents = { route: route, lastTier: null,
    _t: { sayTL: sayTL, sayPct: sayPct, sayKutu: sayKutu, norm: _norm, scoped: _scopedContext } };
})();
