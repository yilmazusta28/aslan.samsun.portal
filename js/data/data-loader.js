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
async function syncData() {
  if (_syncLock) { console.log('[syncData] Zaten çalışıyor, atlandı'); return; }
  _syncLock = true;
  const statusEl = document.getElementById('syncStatus');
  const loadMsg  = document.getElementById('loadMsg');
  statusEl.textContent = '⏳ Güncelleniyor…';

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

    const [csvIMS, csvGenel, csvMiGiTL, csvMiGiKutu, csvMiGiBTL, csvMiGiBKutu] = await Promise.all([
      respIMS.text(),
      respGenel.text(),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_TL_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_KUTU_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-TL.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-KUTU.csv'),
    ]);

    console.log('[CSV] TOPLAM-TL:', csvMiGiTL.length, 'TOPLAM-KUTU:', csvMiGiKutu.length,
      'BRICK-TL:', csvMiGiBTL.length, 'BRICK-KUTU:', csvMiGiBKutu.length);

    // Parse IMS + GENEL
    const newIMS = parseIMSCSV(csvIMS);
    const { genel: newGenel, imsTL: newImsTL, trSira: newTrSira } = parseGenelCSV(csvGenel);

    // TOPLAM dosyaları
    if(csvMiGiTL)  { try{ const p=parseMiGiToplamCSV(csvMiGiTL);   MIGI_TL_RAW.length=0;      MIGI_TL_RAW.push(...p);      console.log('[TOPLAM-TL]',p.length); }catch(e){console.warn(e);} }
    if(csvMiGiKutu){ try{ const p=parseMiGiToplamCSV(csvMiGiKutu); MIGI_KUTU_RAW.length=0;    MIGI_KUTU_RAW.push(...p);    console.log('[TOPLAM-KUTU]',p.length); }catch(e){console.warn(e);} }
    // BRICK dosyaları
    if(csvMiGiBTL)  { try{ const p=parseMiGiBrickCSV(csvMiGiBTL);   MIGI_BRICK_TL_RAW.length=0;   MIGI_BRICK_TL_RAW.push(...p);   console.log('[BRICK-TL]',p.length); }catch(e){console.warn(e);} }
    if(csvMiGiBKutu){ try{ const p=parseMiGiBrickCSV(csvMiGiBKutu); MIGI_BRICK_KUTU_RAW.length=0; MIGI_BRICK_KUTU_RAW.push(...p); console.log('[BRICK-KUTU]',p.length); }catch(e){console.warn(e);} }

    // Dizileri güncelle
    IMS.length   = 0;  IMS.push(...newIMS);

    // Phase 1 Refactor: IMS normalize cache'ini sıfırla
    // IMSAdapter bir sonraki erişimde yeni veriyi normalize eder (lazy).
    if (window.IMSAdapter && typeof window.IMSAdapter.invalidateIMSCache === 'function') {
      window.IMSAdapter.invalidateIMSCache();
    }

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

    // IMS TL fiyatlarını güncelle
    Object.assign(IMS_TL_MAP, newImsTL);

    // TR SIRA haritasını güncelle
    Object.assign(TR_SIRA_MAP, newTrSira);

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

    const now = new Date();
    statusEl.textContent = '✅ ' + now.toLocaleTimeString('tr-TR');
    statusEl.title = `IMS: ${newIMS.length} | GENEL: ${newGenel.length} | TOPLAM-TL: ${MIGI_TL_RAW.length} | BRICK-TL: ${MIGI_BRICK_TL_RAW.length}`;
    if (loadMsg) loadMsg.textContent = 'Veriler yüklendi ✅';
    console.log('[SYNC OK] IMS:', newIMS.length, 'GENEL:', newGenel.length,
      'KUTU:', KUTU.length, 'TTTS:', ALL_TTTS);
    console.log('[IMS_TL_MAP]', JSON.stringify(IMS_TL_MAP));
    console.log('[TR_SIRA_MAP]', JSON.stringify(TR_SIRA_MAP));

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
