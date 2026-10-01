// ══════════════════════════════════════════════════════════════════════
//  js/core/prim-ledger.js — Dönemsel Prim Kayıt Defteri
//
//  AMAÇ (kullanıcı isteği): Prim, dönem bitiminden 2 ay sonra gelen
//  MI & GIGI ile kesinleşiyor (bkz. migi-donem.js). O tarihte GENEL_TABLO
//  çoktan yeni dönemin verisiyle dolu olduğundan, kesin hesap için
//  dönemin ÜRÜN BAZLI TL Real % bilgileri sistemde SAKLI olmalı.
//
//  Kayıt (temsilci × dönem):
//    { genel:{tl_pct, prim_pct, hedef_tl, satis_tl},
//      urunler:{ 'PANOCER':{tl_pct, hedef_tl, satis_tl, agirlik}, ... },
//      source:'sync'|'arsiv'|'manuel', savedAt:ISO }
//  Kaynak öncelik: manuel > (sync | arsiv | uzak dosya).
//    • sync   → her syncData() sonrası "etkin dönem" (7 gün grace'li,
//               bkz. getEffectivePeriod) için otomatik güncellenir.
//    • arsiv  → PeriodArchiveManager'daki kapanmış dönemlerden içe aktarılır
//               (ledger'da henüz kaydı yoksa).
//    • manuel → kullanıcı Prim Hesapla sayfasından ürün % girer (kaydı
//               olmayan geçmiş dönemler için, ör. 3.Dönem).
//
//  Depolama: localStorage PV_PRIM_LEDGER_V1  →  { v:1, entries:{ '2026|k1': { TTT: kayıt } } }
//  Paylaşım: exportYear(year) → PRIM_KAYIT_{yil}.json indirir; arsiv/ klasörüne
//    commit edilirse hydrateRemote() tüm cihazlarda otomatik okur (404 sessiz).
//
//  Bağımlılık: constants.js (URUN_ORDER, ALL_TTTS, GS_ARSIV_DIR), date-utils.js
//  (PERIODS, getEffectivePeriod), period-archive-manager.js, prim-calc.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._PRIM_LEDGER_LOADED) return;
  window._PRIM_LEDGER_LOADED = true;

  var LS = 'PV_PRIM_LEDGER_V1';
  var _remoteTried = {};

  function _read() {
    try {
      var o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o && o.entries) return o;
    } catch (e) { console.warn('[prim-ledger] okuma hatası:', e.message); }
    return { v: 1, entries: {} };
  }
  function _write(o) {
    try { localStorage.setItem(LS, JSON.stringify(o)); return true; }
    catch (e) { console.warn('[prim-ledger] yazma hatası:', e.message); return false; }
  }
  function _k(year, key) { return year + '|' + key; }
  function _periodMeta(key) {
    return (typeof PERIODS !== 'undefined' ? PERIODS : []).find(function (p) { return p.key === key; }) || null;
  }
  function _yearOf(key) {
    var m = _periodMeta(key);
    return m ? m.start.slice(0, 4) : String(new Date().getFullYear());
  }
  function _round(v) { return v == null ? null : Math.round(v * 100) / 100; }

  // Prim Puanı — calcPrimPuani ile AYNI kural (ürün real ≥70, tavan 130, ağırlıklı)
  function _primPuani(urunler) {
    var total = 0;
    Object.keys(URUN_AGIRLIK).forEach(function (u) {
      var r = urunler[u];
      var real = r ? (r.tl_pct || 0) : 0;
      if (real >= 70) {
        var w = (r && r.agirlik > 0) ? r.agirlik : URUN_AGIRLIK[u];
        total += Math.min(real, 130) * w;
      }
    });
    return total;
  }

  // GENEL dizisinden bir temsilcinin kaydını üret (yoksa null)
  function _buildFromGenel(genelArr, ttt, source) {
    var g = (genelArr || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    if (!g) return null;
    if (!(g.hedef_tl > 0) && !(g.tl_pct > 0)) return null;   // boş/sıfır dönem verisini kaydetme
    var urunler = {};
    URUN_ORDER.forEach(function (u) {
      var r = (genelArr || []).find(function (x) { return x.ttt === ttt && x.urun === u; });
      if (r) urunler[u] = { tl_pct: _round(r.tl_pct || 0), hedef_tl: r.hedef_tl || 0, satis_tl: r.satis_tl || 0,
                            agirlik: r.urun_agirlik > 0 ? r.urun_agirlik : null };
    });
    return {
      genel: { tl_pct: _round(g.tl_pct || 0), prim_pct: g.prim_pct ? _round(g.prim_pct) : _round(_primPuani(urunler)),
               hedef_tl: g.hedef_tl || 0, satis_tl: g.satis_tl || 0 },
      urunler: urunler, source: source, savedAt: new Date().toISOString()
    };
  }

  function get(year, key, ttt) {
    var e = _read().entries[_k(year, key)];
    return (e && e[ttt]) || null;
  }

  // Her syncData() sonrası: etkin dönem için canlı kayıt + arşivden içe aktarım
  function captureAll(genelArr) {
    var db = _read(), changed = false;

    // 1) Canlı: etkin dönem (grace'li — dönem sonu verisi birkaç gün geç gelir)
    var eff = (typeof getEffectivePeriod === 'function') ? getEffectivePeriod() : null;
    if (eff && genelArr && genelArr.length) {
      var kk = _k(_yearOf(eff.key), eff.key);
      ALL_TTTS.forEach(function (t) {
        var cur = db.entries[kk] && db.entries[kk][t];
        if (cur && cur.source === 'manuel') return;           // manuel kayıt ezilmez
        var rec = _buildFromGenel(genelArr, t, 'sync');
        if (!rec) return;
        if (!db.entries[kk]) db.entries[kk] = {};
        db.entries[kk][t] = rec; changed = true;
      });
    }

    // 2) Arşiv: kapanmış dönemlerden, ledger'da kaydı OLMAYANLARI içe aktar
    var PM = window.PeriodArchiveManager;
    if (PM && typeof PM.listArchivedPeriods === 'function') {
      PM.listArchivedPeriods().forEach(function (key) {
        var arch = PM.getArchivedPeriod(key);
        if (!arch || !arch.genel) return;
        var ak = _k(_yearOf(key), key);
        ALL_TTTS.forEach(function (t) {
          if (db.entries[ak] && db.entries[ak][t]) return;
          var rec = _buildFromGenel(arch.genel, t, 'arsiv');
          if (!rec) return;
          if (!db.entries[ak]) db.entries[ak] = {};
          db.entries[ak][t] = rec; changed = true;
        });
      });
    }
    if (changed) _write(db);
    return changed;
  }

  // Manuel kayıt: urunReals = {PANOCER: 105.2, ...}; genelReal boşsa ağırlıklı ortalama
  function setManual(year, key, ttt, urunReals, genelReal) {
    var db = _read();
    var urunler = {}, wsum = 0, any = false;
    URUN_ORDER.forEach(function (u) {
      var v = urunReals[u];
      if (v === '' || v == null || isNaN(v)) return;
      any = true;
      urunler[u] = { tl_pct: _round(+v), hedef_tl: null, satis_tl: null, agirlik: null };
      wsum += (+v) * URUN_AGIRLIK[u];
    });
    if (!any && !(genelReal > 0)) return false;
    var rec = {
      genel: { tl_pct: _round(genelReal > 0 ? +genelReal : wsum), prim_pct: _round(_primPuani(urunler)), hedef_tl: null, satis_tl: null },
      urunler: urunler, source: 'manuel', savedAt: new Date().toISOString()
    };
    var kk = _k(year, key);
    if (!db.entries[kk]) db.entries[kk] = {};
    db.entries[kk][ttt] = rec;
    return _write(db);
  }

  function remove(year, key, ttt) {
    var db = _read(), kk = _k(year, key);
    if (db.entries[kk] && db.entries[kk][ttt]) {
      delete db.entries[kk][ttt];
      return _write(db);
    }
    return false;
  }

  function exportYear(year) {
    var db = _read(), out = { v: 1, year: String(year), entries: {}, exportedAt: new Date().toISOString() };
    Object.keys(db.entries).forEach(function (k) { if (k.indexOf(year + '|') === 0) out.entries[k] = db.entries[k]; });
    if (typeof document === 'undefined') return false;
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'PRIM_KAYIT_' + year + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    return true;
  }

  // arsiv/PRIM_KAYIT_{yil}.json → yerelde olmayanları (veya yerel manuel olmayanları,
  // uzak MANUEL ise) birleştir. Sayfa başına yıl başına 1 deneme; 404 sessiz.
  function hydrateRemote(year) {
    year = String(year || new Date().getFullYear());
    if (_remoteTried[year] || typeof fetch !== 'function' || typeof GS_ARSIV_DIR === 'undefined') return Promise.resolve(false);
    _remoteTried[year] = true;
    return fetch(GS_ARSIV_DIR + 'PRIM_KAYIT_' + year + '.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (!payload || !payload.entries) return false;
        var db = _read(), changed = false;
        Object.keys(payload.entries).forEach(function (kk) {
          Object.keys(payload.entries[kk]).forEach(function (t) {
            var remote = payload.entries[kk][t], local = db.entries[kk] && db.entries[kk][t];
            if (local && !(remote.source === 'manuel' && local.source !== 'manuel')) return;
            if (!db.entries[kk]) db.entries[kk] = {};
            db.entries[kk][t] = remote; changed = true;
          });
        });
        if (changed) { _write(db); if (typeof window.renderPrimGecmis === 'function') window.renderPrimGecmis(); }
        return changed;
      })
      .catch(function () { return false; });
  }

  window.PrimLedger = { get: get, captureAll: captureAll, setManual: setManual, remove: remove,
                        exportYear: exportYear, hydrateRemote: hydrateRemote, primPuani: _primPuani };
})();
