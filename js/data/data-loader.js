// ══════════════════════════════════════════════════════════════
//  js/data/data-loader.js — CSV Fetch & Hydration Katmanı
//  Phase 2.1 extraction — EXACT copy from index.html
//  Bağımlılıklar:
//    js/core/constants.js     → GS_*_URL sabitler
//    js/data/data-state.js    → IMS, GENEL, KUTU, MIGI_*, ECZANE_RAW
//    js/data/data-normalizer.js → normTTT, stripTR
//    js/data/csv-parser.js    → parseIMSCSV, parseGenelCSV
//  Globals: rebuildKutuFromIMS, parseMiGiToplamCSV,
//           parseMiGiBrickCSV, syncData, _syncLock
//  Yükleme sırası: data-state → csv-parser → data-loader
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Kutu Verisi Yeniden İnşası ───────────────────────────────
function rebuildKutuFromIMS() {
  KUTU.length = 0;
  const wk  = ['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const map = {};

  IMS.forEach(row => {
    const def = OWN_DRUG_BY_GRP[row.ilac_grubu];
    if (!def) return;
    // Büyük/küçük harf veya boşluk farkına toleranslı karşılaştırma
    if (row.ilac.trim().toUpperCase() !== def.ownIlac.trim().toUpperCase()) return;
    const key = row.ttt + '|' + def.urun;
    if (!map[key]) {
      map[key] = { ttt: row.ttt, urun: def.urun };
      wk.forEach(w => { map[key][w] = 0; });
    }
    wk.forEach(w => { map[key][w] += (row[w] || 0); });
  });

  Object.values(map).forEach(obj => KUTU.push(obj));
}

// ── MI/GI Toplam CSV Parser ──────────────────────────────────
function parseMiGiToplamCSV(csvText) {
  if (!csvText || csvText.trim().startsWith('<')) return [];
  const pN = s => {
    s = String(s||'').trim().replace(/\s/g,'');
    if (!s || s === '-') return null;
    const v = parseFloat(s.replace(/\./g,'').replace(',','.'));
    return isNaN(v) ? null : v;
  };
  const AY_MAP = {'OCAK':'01','ŞUBAT':'02','MART':'03','NİSAN':'04','MAYIS':'05','HAZİRAN':'06',
    'TEMMUZ':'07','AĞUSTOS':'08','EYLÜL':'09','EKİM':'10','KASIM':'11','ARALIK':'12'};
  const AYLAR = Object.keys(AY_MAP);
  const URUNLER = ['PANOCER','FAMTREC','MOKSEFEN','ACİDPASS','GRİPORT COLD'];

  const rawLines = csvText.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');

  // Separator otomatik tespiti (virgül veya noktalı virgül)
  const _sep1 = detectSeparator(csvText);

  // Veri satırı başlangıcı — ilk AY adıyla başlayan satır
  let di = 0;
  for (let i = 0; i < Math.min(6, rawLines.length); i++) {
    const f = (rawLines[i].split(_sep1)[0] || '').trim().toUpperCase();
    if (AYLAR.some(a => f === a)) { di = i; break; }
  }

  const records = [];
  for (let i = di; i < rawLines.length; i++) {
    const c = rawLines[i].split(_sep1).map(s => s.trim());
    if (c.length < 5) continue;
    const ayRaw  = (c[0] || '').toUpperCase();
    const person = (c[1] || '').trim();
    if (!ayRaw || !person) continue;
    if (person.toUpperCase().includes('NATIONAL') || person.toUpperCase().includes('GİDİLMEYEN')) continue;
    const ayE = Object.entries(AY_MAP).find(([k]) => ayRaw.includes(k));
    if (!ayE) continue;
    const donem = ayE[1] + '/2026'; // "02/2026"

    // GENEL satırı (tüm ürünler toplamı)
    records.push({
      person, donem, ilac: 'GENEL',
      bi:   pN(c[2]),  evol: pN(c[3]),  mi: pN(c[4]),
      pp2:  pN(c[5]),  pp1:  pN(c[6]),  pp_bi: pN(c[7]),
      hedef_pct: pN(c[8]), satis_pct: pN(c[9]), real_pct: pN(c[10])
    });

    // Ürün bazlı satırlar — BI[11-15] EVOL[16-20] MI[21-25] PP[26-30]
    URUNLER.forEach((u, idx) => {
      const bi = pN(c[11+idx]), evol = pN(c[16+idx]), mi = pN(c[21+idx]), pp = pN(c[26+idx]);
      if (bi === null && evol === null && mi === null) return;
      records.push({ person, donem, ilac: u, bi, evol, mi, pp1: pp, pp2: null, pp_bi: null,
        hedef_pct: null, satis_pct: null, real_pct: null });
    });
  }
  console.log('[parseMiGiToplamCSV]', records.length, 'records');
  return records;
}

// ── MI/GI Brick CSV Parser ───────────────────────────────────
function parseMiGiBrickCSV(csvText) {
  if (!csvText || csvText.trim().startsWith('<')) return [];

  const pN = s => {
    s = String(s||'').trim().replace(/\s/g,'');
    if (!s || s === '-') return null;
    const v = parseFloat(s.replace(/\./g,'').replace(',','.'));
    return isNaN(v) ? null : v;
  };

  const AY_MAP = {'OCAK':'01','SUBAT':'02','ŞUBAT':'02','MART':'03','NISAN':'04','NİSAN':'04',
    'MAYIS':'05','HAZIRAN':'06','HAZİRAN':'06','TEMMUZ':'07','AGUSTOS':'08','AĞUSTOS':'08',
    'EYLUL':'09','EYLÜL':'09','EKIM':'10','EKİM':'10','KASIM':'11','ARALIK':'12'};

  const sep = detectSeparator(csvText);
  const lines = csvText.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');

  /*
   * CSV geniş (wide) formatı:
   *   Satır 0: ;;;;  2026 ŞUBAT ;;;;; 2026 MART ...   (her 5. sütunda ay adı)
   *   Satır 1: ;;;;  BÜYÜME INDEX; EVOLATION; MARKET; PAZAR PAYI; ...
   *   Satır 2: 333 SIRA;BÖLGE;PERSONEL;BRICK; PANOCER ; FAMTREC ; MOKSEFEN ; ACİDPASS ; GRİPORT COLD ; ...
   *   Satır 3+: veri
   *
   * Sütun yapısı (0-indexed):
   *   0=SIRA, 1=BÖLGE, 2=PERSONEL, 3=BRICK
   *   Her ay için 5 ilaç × 4 metrik = 20 sütun
   *   Ay başlığı satır0'da her 20 sütunda bir tekrarlanır
   *   Metrik sırası (satır1): BI, EVOL, MI, PP — her metrik 5 ilaç bloğunu kapsar
   *   İlaç sırası (satır2): PANOCER, FAMTREC, MOKSEFEN, ACİDPASS, GRİPORT COLD
   */
  const ILACLAR = ['PANOCER','FAMTREC','MOKSEFEN','ACİDPASS','GRİPORT COLD'];
  const METRIKS = ['bi','evol','mi','pp']; // 4 metrik, her biri 5 ilaç = 20 sütun/ay

  // Satır 0'dan ay adlarını çıkar
  const row0 = (lines[0]||'').split(sep).map(s=>s.trim().toUpperCase());

  // Her ay bloğunun başlangıç sütun indeksini bul
  // Ay adı "2026 ŞUBAT" gibi geliyor — boş olmayan hücreleri bul
  const ayBloklar = []; // [{donem:'02/2026', colStart:4}, ...]
  let lastDonem = null;
  for (let col = 4; col < row0.length; col++) {
    const val = row0[col];
    if (!val) continue;
    // "2026 ŞUBAT" → yıl+ay parse
    let donem = null;
    for (const [ayAd, ayNo] of Object.entries(AY_MAP)) {
      if (val.includes(ayAd)) {
        const yilMatch = val.match(/\d{4}/);
        const yil = yilMatch ? yilMatch[0] : '2026';
        donem = ayNo + '/' + yil;
        break;
      }
    }
    if (donem && donem !== lastDonem) {
      ayBloklar.push({ donem, colStart: col });
      lastDonem = donem;
    }
  }

  // Eğer satır0'dan ay bulunamazsa fallback: sabit aralıkla tahmin et
  if (ayBloklar.length === 0) {
    // Her 20 sütunda bir ay (4 metrik × 5 ilaç)
    const ayler = ['02','03','04','05','06','07','08','09','10','11','12'];
    ayler.forEach((ay, i) => {
      ayBloklar.push({ donem: ay+'/2026', colStart: 4 + i * 20 });
    });
  }

  // Header satırını bul ("333 SIRA" veya "SIRA" ile başlayan satır)
  let dataStartIdx = 3; // varsayılan
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const firstCol = (lines[i].split(sep)[0] || '').trim().toUpperCase();
    if (firstCol.includes('SIRA') || firstCol === '333 SIRA') {
      dataStartIdx = i + 1;
      break;
    }
  }
  console.log('[parseMiGiBrickCSV] dataStartIdx:', dataStartIdx);

  const result = [];

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const c = line.split(sep);
    const siraRaw = (c[0]||'').trim();
    if (!siraRaw || isNaN(parseInt(siraRaw))) continue;
    const personRaw = (c[2]||'').trim();
    const person = normTTT(personRaw) || personRaw;
    if (!person || person.toUpperCase().includes('GIDILMEYEN') ||
        person.toUpperCase().includes('GİDİLMEYEN')) continue;

    const brick = (c[3]||'').trim();
    if (!brick) continue;

    for (const { donem, colStart } of ayBloklar) {
      // colStart'tan itibaren: 5 BI, 5 EVOL, 5 MI, 5 PP (toplam 20 sütun/ay)
      for (let ilacIdx = 0; ilacIdx < ILACLAR.length; ilacIdx++) {
        const ilac = ILACLAR[ilacIdx];
        const bi   = pN(c[colStart + 0 * ILACLAR.length + ilacIdx]);
        const evol = pN(c[colStart + 1 * ILACLAR.length + ilacIdx]);
        const mi   = pN(c[colStart + 2 * ILACLAR.length + ilacIdx]);
        const pp   = pN(c[colStart + 3 * ILACLAR.length + ilacIdx]);

        // En az bir değer varsa kaydı ekle
        if (bi !== null || evol !== null || mi !== null || pp !== null) {
          result.push({
            sira: parseInt(siraRaw),
            bolge: (c[1]||'').trim(),
            person,
            brick,
            donem,
            ilac,
            bi, evol, mi, pp
          });
        }
      }
    }
  }

  console.log('[parseMiGiBrickCSV] wide-format →', result.length, 'records |',
    new Set(result.map(r=>r.brick)).size, 'bricks |',
    new Set(result.map(r=>r.donem)).size, 'dönem |',
    new Set(result.map(r=>r.person)).size, 'personel');
  return result;
}

// ── Fetch & Sync Guard ───────────────────────────────────────
// _syncLock → data-state.js'de tanımlı (let _syncLock = false)
// syncData() eş zamanlı çift çağrı koruması buradan yönetilir.

// ── Ana Veri Yükleme Fonksiyonu ──────────────────────────────
// AUDIT2 Bulgu 4 düzeltmesi: data-cache.js (Phase 2.3.5) artık gerçekten
// kullanılıyor. `forceFresh=true` ile çağrılırsa (manuel "Güncelle" butonu,
// bkz. index.html:2462/5060) cache atlanır, HER ZAMAN GitHub'dan taze veri
// çekilir — kullanıcının elle tetiklediği bir yenileme asla eski veri
// göstermemeli. `forceFresh` verilmezse (otomatik ilk açılış — initApp()),
// geçerli (<24 saat) bir cache varsa önce ONDAN anında yüklenir (ağ
// beklemeden ekran dolar), ardından YİNE DE arkaplanda taze fetch denenir
// (aşağıdaki ana akış devam eder) — yani cache asla fetch'in YERİNE geçmez,
// sadece ilk boyamayı hızlandırır. Başarılı her fetch sonunda saveDataCache()
// çağrılır. Rollback: bu bloğu ve dosya sonundaki saveDataCache() çağrısını
// silmek yeterli, syncData() eskisi gibi çalışmaya devam eder.
async function syncData(forceFresh) {
  if (_syncLock) { console.log('[syncData] Zaten çalışıyor, atlandı'); return; }
  _syncLock = true;
  const statusEl = document.getElementById('syncStatus');
  const loadMsg  = document.getElementById('loadMsg');
  statusEl.textContent = '⏳ Güncelleniyor…';

  if (!forceFresh && typeof window.loadDataCache === 'function') {
    try {
      const _hadCache = window.loadDataCache();
      if (_hadCache) {
        console.log('[syncData] Geçerli cache bulundu — anında gösteriliyor, taze veri arkaplanda çekiliyor.');
        rebuildKutuFromIMS();
        // FAZ 12.3 BUG DÜZELTMESİ: IMS artık (cache'ten) hazır — PDM52
        // eczane/ klasörünü IMS boşken işlemiş olabilir (temsilci alanı
        // eksik kalmış olabilir); şimdi IMS hazır olduğuna göre eksikleri
        // geriye doldur (bkz. pharmacy-data-manager.js::reresolveTTT).
        if (window.PharmacyDataManager && typeof window.PharmacyDataManager.reresolveTTT === 'function') {
          window.PharmacyDataManager.reresolveTTT();
        }
        if (loadMsg) loadMsg.textContent = 'Önbellekten yüklendi, güncelleniyor…';
        if (curPage === 0)      renderAna();
        else if (curPage === 1) renderPazar();
        else if (curPage === 2) renderTakip();
        else if (curPage === 3) { initMigi1(); initMigi2(); }
        else if (curPage === 4) buildPrimInputs();
        else if (curPage === 5) renderAiAsistan();
        else if (curPage === 6) renderEczane();
        // FAZ 13.4-DÜZELTME: page7 (Yönetici) burada da eksikti — banner
        // (mgrHeroBanner) ilk açılışta cache'ten anında dolması gerekirken
        // hiç render edilmiyordu; kullanıcı başka sayfaya gezinip page7'ye
        // dönünce goPage(7) tekrar çağrıldığı için "düzeliyormuş" gibi
        // görünüyordu. Artık cache anında geldiğinde de dolduruluyor.
        else if (curPage === 7) {
          if (typeof renderManagerHeroBanner === 'function') renderManagerHeroBanner();
          if (typeof renderManagerExtra === 'function') renderManagerExtra();
        }
        const _loadingEl = document.getElementById('loading');
        if (_loadingEl) _loadingEl.style.display = 'none';
      }
    } catch (e) {
      console.warn('[syncData] Cache ön-yükleme hatası (sessiz, fresh fetch devam ediyor):', e.message);
    }
  }

  // file:// protokolünde CORS engeli — kullanıcıyı bilgilendir
  if (window.location.protocol === 'file:') {
    const msg = '⚠️ Dosya doğrudan açıldı (file://). GitHub\'dan veri yüklemek için portala bir web sunucusu üzerinden ya da doğrudan GitHub Pages üzerinden erişin.';
    if (loadMsg) { loadMsg.textContent = msg; loadMsg.style.color='#D97706'; loadMsg.style.maxWidth='340px'; loadMsg.style.textAlign='center'; }
    statusEl.textContent = '⚠️ file:// — veri yüklenemez';
    _syncLock = false;
    // Demo mod: sadece UI'ı başlat, veri olmadan
    document.getElementById('loading').style.display='none';
    if(typeof goPage==='function') goPage(1);
    return;
  }

  try {
    // GitHub raw önbelleğini atlatmak için cache:no-store + timestamp
    const fetchOpts = { cache: 'no-store', mode: 'cors' };
    const ts = Date.now();

    // Üç tabloyu paralel çek
    // Kritik: IMS + GENEL (bunlar olmadan portal çalışmaz)
    const [respIMS, respGenel] = await Promise.all([
      fetch(GS_IMS_URL   + '?v=' + ts, fetchOpts),
      fetch(GS_GENEL_URL + '?v=' + ts, fetchOpts),
    ]);

    // Tüm CSV'leri güvenli şekilde çek — biri başarısız olursa diğerleri devam eder
    const safeGet = async (url) => {
      const fileName = url.split('/').pop();
      // 1. deneme: cache:no-store, redirect:follow (mode:cors YOK — preflight sorununu önler)
      // 2. deneme: query string ile (CDN bypass)
      const attempts = [
        () => fetch(url, { cache: 'no-store', redirect: 'follow' }),
        () => fetch(url + '?nocache=' + ts, { redirect: 'follow' }),
      ];
      for (const attempt of attempts) {
        try {
          const r = await attempt();
          if (r.ok) {
            const text = await r.text();
            if (text && !text.trim().startsWith('<')) {
              console.log('[OK]', fileName, text.length, 'chars');
              return text;
            }
            console.warn('[WARN] CSV değil HTML geldi:', fileName);
          } else {
            console.warn('[HTTP ' + r.status + '] ' + fileName);
          }
        } catch(e) { console.warn('[ERR]', fileName, e.message); }
      }
      console.error('[FAIL] Yüklenemedi:', fileName, url);
      return '';
    };

    if (!respIMS.ok)   throw new Error('IMS_TABLO.csv yüklenemedi (HTTP ' + respIMS.status + ')');
    if (!respGenel.ok) throw new Error('GENEL_TABLO.csv yüklenemedi (HTTP ' + respGenel.status + ')');

    const [csvIMS, csvGenel, csvMiGiTL, csvMiGiKutu, csvMiGiBTL, csvMiGiBKutu, csvRakip] = await Promise.all([
      respIMS.text(),
      respGenel.text(),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_TL_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_KUTU_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-TL.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-KUTU.csv'),
      safeGet(GS_RAKIP_URL),
    ]);

    console.log('[CSV] TOPLAM-TL:', csvMiGiTL.length, 'TOPLAM-KUTU:', csvMiGiKutu.length,
      'BRICK-TL:', csvMiGiBTL.length, 'BRICK-KUTU:', csvMiGiBKutu.length);

    // Parse IMS + GENEL
    const newIMS = parseIMSCSV(csvIMS);
    const { genel: newGenel, imsTL: newImsTL, trSira: newTrSira, regions: newRegions } = parseGenelCSV(csvGenel);

    // TOPLAM dosyaları
    if(csvMiGiTL)  { try{ const p=parseMiGiToplamCSV(csvMiGiTL);   MIGI_TL_RAW.length=0;      MIGI_TL_RAW.push(...p);      console.log('[TOPLAM-TL]',p.length); }catch(e){console.warn(e);} }
    if(csvMiGiKutu){ try{ const p=parseMiGiToplamCSV(csvMiGiKutu); MIGI_KUTU_RAW.length=0;    MIGI_KUTU_RAW.push(...p);    console.log('[TOPLAM-KUTU]',p.length); }catch(e){console.warn(e);} }
    // BRICK dosyaları
    if(csvMiGiBTL)  { try{ const p=parseMiGiBrickCSV(csvMiGiBTL);   MIGI_BRICK_TL_RAW.length=0;   MIGI_BRICK_TL_RAW.push(...p);   console.log('[BRICK-TL]',p.length); }catch(e){console.warn(e);} }
    if(csvMiGiBKutu){ try{ const p=parseMiGiBrickCSV(csvMiGiBKutu); MIGI_BRICK_KUTU_RAW.length=0; MIGI_BRICK_KUTU_RAW.push(...p); console.log('[BRICK-KUTU]',p.length); }catch(e){console.warn(e);} }

    // ── FAZ 6.4: RAKIP_AKSİYON.csv — kritik DEĞİL, MI/GI dosyalarıyla AYNI
    // tolerans deseni (safeGet zaten yukarıda hata-toleranslı çekti).
    // window.RAKIP_AKSIYON_RAW → competitive-adapter.js'in beklediği ham
    // parser çıktısı (bkz. competitive-adapter.js dosya başı yorumu).
    // CompetitiveAdapter / RakipSartlariManager bu FAZ'da henüz hiçbir karar
    // motoruna bağlı değil — burada sadece veri TAZE TUTULUYOR, render
    // tetiklenmiyor (rollback güvenli: bu blok atılırsa hiçbir mevcut motor
    // etkilenmez).
    if (csvRakip) {
      try {
        const parsedRakip = parseRakipAksiyonCSV(csvRakip);
        window.RAKIP_AKSIYON_RAW = parsedRakip;
        console.log('[RAKIP_AKSIYON]', parsedRakip.length, 'satır');

        if (window.CompetitiveAdapter && window.RakipSartlariManager) {
          const competitive = window.CompetitiveAdapter.normalizeCompetitive();
          window.RakipSartlariManager.importFromAdapter(competitive.competitorActions);
        }
      } catch (e) { console.warn('[RAKIP_AKSIYON] parse/import hata (sessiz):', e.message); }
    }

    // Dizileri güncelle
    IMS.length   = 0;  IMS.push(...newIMS);

    // ── FAZ 1.3: Outcome Tracker — yeni IMS yüklendiğinde, Recommendation
    // Memory içindeki açık (evaluated=false) önerileri otomatik değerlendir.
    // Asenkron, fire-and-forget — syncData()'nın akışını bloklamaz/bozmaz.
    // OutcomeTracker yüklenmemişse (dosya yoksa/eski sürüm) hiçbir şey yapmaz.
    if (window.OutcomeTracker && typeof window.OutcomeTracker.evaluateOpenRecommendations === 'function') {
      window.OutcomeTracker.evaluateOpenRecommendations(IMS).catch(function (e) {
        console.warn('[data-loader] OutcomeTracker.evaluateOpenRecommendations hata (sessiz):', e.message);
      });
    }

    // ── GENEL DEDUP ──────────────────────────────────────────────────
    // CSV'de aynı ttt+urun kombinasyonu birden fazla satır olabilir.
    // İLK SATIR kazanır — kullanıcı tarafından ilk sıradaki veri doğru/güncel.
    const _genelMap = new Map();
    for (const row of newGenel) {
      const key = row.ttt + '||' + row.urun;
      if (!_genelMap.has(key)) {
        _genelMap.set(key, Object.assign({}, row));
      }
      // Duplicate satırlar sessizce atlanır
    }
    const dedupedGenel = Array.from(_genelMap.values());
    console.log('[GENEL DEDUP] Önce:', newGenel.length, '→ Sonra:', dedupedGenel.length,
      '(' + (newGenel.length - dedupedGenel.length) + ' duplicate kaldırıldı)');
    GENEL.length = 0;  GENEL.push(...dedupedGenel);
    // ── END GENEL DEDUP ──────────────────────────────────────────────

    // ── FAZ — 6 Aylık Dönem Arşivleme ──────────────────────────────
    // GENEL_TABLO.csv/IMS_TABLO.csv her dönem sonunda kullanıcı tarafından
    // sıfırlanıp yeni dönemin verisiyle doldurulur (iş kuralı). Bu motor,
    // dönem geçişini günün tarihinden tespit eder ve giden dönemin SON
    // bilinen (final) verisini kalıcı olarak yarıyıl arşivine (H1/H2)
    // taşır. Hata toleranslı — arşivleme başarısız olsa bile syncData akışı
    // ETKİLENMEZ (rollback-safe).
    if (window.PeriodArchiveManager) {
      try {
        var _archiveResult = window.PeriodArchiveManager.processNewSync(dedupedGenel, newIMS);
        if (_archiveResult && _archiveResult.archived) {
          console.log('[period-archive] Dönem geçişi tespit edildi:',
            _archiveResult.previousPeriodKey, '→', _archiveResult.currentPeriodKey,
            '| Önceki dönem arşivlendi.');
        }
      } catch (e) {
        console.warn('[period-archive] processNewSync hata (sessiz):', e.message);
      }
    }
    // ── END FAZ — 6 Aylık Dönem Arşivleme ──────────────────────────

    // FAZ 10: GitHub'daki arsiv/ klasöründen olası geçmiş dönemleri dene
    // (kullanıcı exportPeriodAsFile() ile indirip commit ettiyse). Sadece
    // sayfa başına BİR KEZ denenir (gereksiz tekrarlı ağ isteği olmasın) —
    // hata toleranslı, syncData akışını asla bloklamaz/bozmaz.
    if (window.PeriodArchiveManager && !window._pvArchiveHydrateTried) {
      window._pvArchiveHydrateTried = true;
      window.PeriodArchiveManager.hydrateFromRemote().catch(function () { /* sessiz */ });
    }

    // IMS TL fiyatlarını güncelle
    Object.assign(IMS_TL_MAP, newImsTL);

    // TR SIRA haritasını güncelle
    Object.assign(TR_SIRA_MAP, newTrSira);

    // ── Bölge/Ulusal Sıralaması ──────────────────────────────────────
    // GENEL_TABLO.csv'ye eklenen NATIONAL/DİYARBAKIR/KONYA/BURSA vb. bölge
    // satırları (bkz. csv-parser.js parseGenelCSV — "BÖLGE/ULUSAL SATIRI").
    // Yönetici sayfasındaki Bölge Sıralaması tablosunu besler.
    if (typeof REGION_RANKING !== 'undefined') {
      REGION_RANKING.length = 0;
      REGION_RANKING.push(...(newRegions || []));
    }

    // KUTU'yu yeniden oluştur
    rebuildKutuFromIMS();

    // ALL_TTTS'i GENEL'den güncelle (Şenol hariç temsilciler)
    const freshTTTs = [...new Set(
      newGenel
        .filter(r => r.urun !== 'GENEL TOPLAM' && r.ttt !== 'ŞENOL YILMAZ')
        .map(r => r.ttt)
    )].sort();
    ALL_TTTS.length = 0;
    ALL_TTTS.push(...freshTTTs);

    // UI'ı yenile
    renderTopBar();
    // Giriş yapan kullanıcının temsilcisini otomatik seç (ŞENOL YILMAZ hariç)
    // Includes kontrolü: direkt veya normTTT ile eşleşen canonical adla karşılaştır
    const _lu_norm = normTTT(LOGGED_IN_USER) || LOGGED_IN_USER;
    const _lu_match = ALL_TTTS.find(t => t === _lu_norm || normTTT(t) === _lu_norm) || null;
    console.log('[SYNC] LOGGED_IN_USER:', LOGGED_IN_USER, '| norm:', _lu_norm, '| match:', _lu_match, '| ALL_TTTS:', ALL_TTTS);
    if (_lu_match && _lu_match !== 'ŞENOL YILMAZ') {
      const lu = _lu_match;
      selTTT       = lu;   // Ana sayfa TTT picker
      selTTT_p2    = lu;   // Satış Takibi
      selTTT_p1    = lu;   // Pazar Analizi
      selMigiTTT   = lu;
      mg2_ttt      = lu;   // MI/GI Brick
      selAiTTT     = lu;   // AI Asistan
      engineSelTTT = lu;   // AI Motor
      selEczaneTTT = lu;   // Eczane
      // Prim sayfası select (DOM hazırsa hemen, değilse _autoTTT ile)
      const _primSel = document.getElementById('primTTT');
      if (_primSel) _primSel.value = lu;
      window._autoTTT = lu;
    } else {
      // Şenol Yılmaz veya eşleşme yok: tüm temsilciler görünür, ilk temsilci seçili
      selTTT       = '';
      selTTT_p2    = ALL_TTTS[0] || '';
      selTTT_p1    = ALL_TTTS[0] || '';
      selMigiTTT   = ''; mg2_ttt = '';
      selAiTTT     = 'ŞENOL YILMAZ';
      engineSelTTT = ALL_TTTS[0] || '';
      selEczaneTTT = '';
      window._autoTTT = null;
    }
    if (curPage === 0)      renderAna();
    else if (curPage === 1) renderPazar();
    else if (curPage === 2) renderTakip();
    else if (curPage === 3) { initMigi1(); initMigi2(); }
    else if (curPage === 4) buildPrimInputs();
    else if (curPage === 5) renderAiAsistan();
    else if (curPage === 6) renderEczane();
    // FAZ 13.1 DÜZELTMESİ: bu dispatch'te page7 (Yönetici) eksikti — Şenol
    // Yılmaz girişinde artık varsayılan sayfa page7 olduğundan (bkz.
    // index.html doLogin()), veri senkronize OLDUKTAN SONRA panel
    // yenilenmiyordu (goPage(7) veri gelmeden önce çağrıldığı için ilk
    // render'da "veri yüklenmemiş" görünüyordu ve syncData bitince asla
    // güncellenmiyordu). Diğer sayfalar zaten burada yenileniyordu, page7
    // unutulmuştu.
    // FAZ 13.4-DÜZELTME: renderExecutiveDashboard('executiveDashboardContainer')
    // artık YOK — "📊 Genel Bakış" bölümü kaldırıldığından bu çağrı hiçbir şey
    // yapmıyordu (fonksiyon/konteyner yok). Asıl eksik olan ve banner'ın ("Bölge
    // Geneli — ŞENOL YILMAZ" mor kutusu) ilk açılışta boş kalmasına yol açan
    // çağrı buydu: renderManagerHeroBanner() burada hiç çağrılmıyordu. goPage(7)
    // veri gelmeden önce (giriş anında) çalıştığı için banner boş doluyordu;
    // kullanıcı başka sayfaya gezip page7'ye dönünce goPage(7) TEKRAR çalıştığı
    // (ve bu sefer veri hazır olduğu) için "düzeliyormuş" gibi görünüyordu.
    else if (curPage === 7) {
      if (typeof renderManagerHeroBanner === 'function') renderManagerHeroBanner();
      if (typeof renderManagerExtra === 'function') renderManagerExtra();
    }

    const now = new Date();
    statusEl.textContent = '✅ ' + now.toLocaleTimeString('tr-TR');
    statusEl.title = `IMS: ${newIMS.length} | GENEL: ${newGenel.length} | TOPLAM-TL: ${MIGI_TL_RAW.length} | BRICK-TL: ${MIGI_BRICK_TL_RAW.length}`;
    if (loadMsg) loadMsg.textContent = 'Veriler yüklendi ✅';
    console.log('[SYNC OK] IMS:', newIMS.length, 'GENEL:', newGenel.length,
      'KUTU:', KUTU.length, 'TTTS:', ALL_TTTS);
    console.log('[IMS_TL_MAP]', JSON.stringify(IMS_TL_MAP));
    console.log('[TR_SIRA_MAP]', JSON.stringify(TR_SIRA_MAP));

    // FAZ 12.3 BUG DÜZELTMESİ: taze IMS/MIGI_TL_RAW burada kesinleşti —
    // PDM52'nin eczane/ klasörünü (muhtemelen bu veriler henüz yokken)
    // işlemesi sırasında boş kalmış temsilci alanlarını şimdi geriye
    // doldur (bkz. pharmacy-data-manager.js::reresolveTTT). Cache-hit
    // yolunda zaten bir kez denenmiş olabilir — reresolveTTT idempotent
    // (sadece hâlâ eksik olanları doldurur), tekrar çağırmak zararsız.
    if (window.PharmacyDataManager && typeof window.PharmacyDataManager.reresolveTTT === 'function') {
      window.PharmacyDataManager.reresolveTTT();
    }

    // AUDIT2 Bulgu 4 düzeltmesi: taze fetch başarıyla bitti — 24 saatlik
    // cache'e yaz (bir sonraki ilk açılışta anında gösterim için).
    if (typeof window.saveDataCache === 'function') {
      try { window.saveDataCache(); } catch (e) { console.warn('[syncData] saveDataCache hata (sessiz):', e.message); }
    }

  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.title = err.message;
    console.error('[syncData]', err);
    if (loadMsg) loadMsg.textContent = '❌ Veri yüklenemedi: ' + err.message;
    throw err;
  } finally {
    setTimeout(() => { _syncLock = false; }, 3000);
  }
}
