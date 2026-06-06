// ══════════════════════════════════════════════════════════════
//  js/data/csv-parser.js — CSV Parse Katmanı
//  Bağımlılık: js/data/data-normalizer.js (stripTR, normTTT, normGrp, isMktRow)
//              js/core/constants.js (ALL_TTTS, OWN_IMS, TR_SIRA_MAP, PERIODS)
// ══════════════════════════════════════════════════════════════
function detectSeparator(text) {
  // İlk gerçek veri satırını al
  const firstLine = text.replace(/\r/g,'').split('\n').find(l => l.trim());
  if (!firstLine) return ',';
  // Tırnak dışındaki ; sayısı ile , sayısını karşılaştır
  let inQ = false, commas = 0, semis = 0;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ) {
      if (ch === ',') commas++;
      if (ch === ';') semis++;
    }
  }
  const sep = semis > commas ? ';' : ',';
  console.log('[CSV] separator detected:', JSON.stringify(sep),
    '(commas:', commas, 'semis:', semis, ')');
  return sep;
}

function parseCSVLine(line, sep) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCSVRows(text) {
  const sep = detectSeparator(text);
  return text.replace(/\r/g,'').split('\n')
    .filter(l => l.trim())
    .map(l => parseCSVLine(l, sep));
}

// ─── SAYI PARSER (Türkçe CSV formatı) ──────────────────────
// Türk Excel CSV: nokta=binlik, virgül=ondalık, % işareti olabilir
// Örnekler: "829.323"→829323  "1.934.453"→1934453  "56,34%"→56.34
//           "0,25"→0.25  "1.095"→1095  "-"→0  "191"→191
function parseN(v) {
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (!s || s === '-' || s === '--' || s === '') return 0;
  s = s.replace('%', '').trim();   // % işaretini kaldır
  if (!s || s === '-') return 0;

  // Excel parantez-negatif format: (972.456) veya (1.234,56)
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  const hasDot   = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Türk: "1.234,56" → noktaları sil, virgülü noktaya çevir
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // İngiliz: "1,234.56" → virgülleri sil
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Sadece virgül → Türk ondalık: "56,34" → 56.34
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      // "1.234.567" → binlik → hepsini sil
      s = s.replace(/\./g, '');
    } else if (parts.length === 2 && parts[1].length === 3) {
      // "1.095" → binlik (3 haneli sağ taraf)
      s = s.replace(/\./g, '');
    }
    // else "56.34" → ondalık, değiştirme
  }

  const r = parseFloat(s);
  if (isNaN(r)) return 0;
  return negative ? -r : r;
}

// ─── TTT NORMALIZER ─────────────────────────────────────────
// Google Sheets bazen ASCII, bazen Türkçe, bazen mixed-case gönderir.
// Hem tam eşleşme hem de ASCII-strip ile fuzzy match yapıyoruz.
const TTT_NORM_MAP = {
  // IMS_TABLO: ASCII (Türkçe karakter YOK)
  'KURSAD KARADAG':        'KÜRŞAD KARADAĞ',
  'AYKUT DINLER':          'AYKUT DİNLER',
  'MURAT KANDIS':          'MURAT KANDİŞ',
  'MEHMET AKIF OZGECEN':   'MEHMET AKİF ÖZGEÇEN',
  'SAMET CETIN':           'SAMET ÇETİN',
  'SENOL YILMAZ':          'ŞENOL YILMAZ',
  'HAKAN YUMAK':           'HAKAN YUMAK',
  'YILMAZ USTA':           'YILMAZ USTA',
  'EMRAH YILDIZ':          'EMRAH YILDIZ',
  // GENEL_TABLO: Türkçe karakterli
  'KÜRŞAD KARADAĞ':        'KÜRŞAD KARADAĞ',
  'AYKUT DİNLER':          'AYKUT DİNLER',
  'MURAT KANDİŞ':          'MURAT KANDİŞ',
  'HAKAN YUMAK':           'HAKAN YUMAK',
  'YILMAZ USTA':           'YILMAZ USTA',
  'EMRAH YILDIZ':          'EMRAH YILDIZ',
  'MEHMET AKİF ÖZGEÇEN':   'MEHMET AKİF ÖZGEÇEN',
  'SAMET ÇETİN':           'SAMET ÇETİN',
  'ŞENOL YILMAZ':          'ŞENOL YILMAZ',
};

// ASCII strip helper — Türkçe karakterleri ASCII'ye çevirir (Sheets bazen böyle export eder)
// → stripTR() data-normalizer.js'de tanımlı
// Known canonical names for reverse-lookup
// → CANONICAL_TTTS data-normalizer.js'de

// → normTTT() data-normalizer.js'de tanımlı
// ─── ÜRÜN NORMALIZER ────────────────────────────────────────
// → normUrun() data-normalizer.js'de tanımlı
// ─── VALID İLAÇ GRUPLARI ────────────────────────────────────
// normGrp: grup adını canonical forma çevirir (ASCII/Türkçe variant toleranslı)
// → normGrp() data-normalizer.js'de tanımlı
// is_mkt: Sadece PAZAR geneli TOPLAM satırlarını tanı
// "PANTOPRAZOLE PAZARI TOPLAM", "ACIDPASS PAZARI TOPLAM" gibi
// "PANOCER TOPLAM" veya "ACIDPASS TOPLAM" → kendi ürün, is_mkt=false
// → isMktRow() data-normalizer.js'de tanımlı
// ─── IMS_TABLO PARSER ───────────────────────────────────────
// Sütunlar: [0]BÖLGE [1]TTT [2]BRİCK [3]İLAÇGRUBU [4]İLAÇ [5]TOPLAM
//           [7]1.H  [9]2.H  [11]3.H  [13]4.H  [15]5.H  [17]6.H  [19]7.H  [21]8.H  [23]9.H
function parseIMSCSV(csvText) {
  if (csvText.trim().startsWith('<')) {
    throw new Error('IMS_TABLO.csv yerine HTML döndü. Birkaç saniye bekleyip tekrar deneyin.');
  }

  const rows = parseCSVRows(csvText);
  if (rows.length < 2) throw new Error('IMS_TABLO boş');

  // ── Sütun haritası ─────────────────────────────────────────
  // [0]=BÖLGE  [1]=TTT  [2]=BRİCK  [3]=İLAÇ GRUBU  [4]=İLAÇ
  // [5]=TOPLAM  [6]=TOPLAM PPI%
  // [7]=1.HAFTA  [8]=1.H PPI%  [9]=2.HAFTA  [10]=2.H PPI%
  // [11]=3.HAFTA [12]=3.H PPI% [13]=4.HAFTA [14]=4.H PPI%
  // [15]=5.HAFTA [16]=5.H PPI% [17]=6.HAFTA [18]=6.H PPI%
  // [19]=7.HAFTA [20]=7.H PPI% [21]=8.HAFTA [22]=8.H PPI%
  // [23]=9.HAFTA [24]=9.H PPI%

  console.log('[IMS CSV] İlk satır (' + rows[0].length + ' sütun):', rows[0].slice(0,6));
  console.log('[IMS CSV] İkinci satır:', rows[1] ? rows[1].slice(0,6) : 'yok');
  console.log('[IMS CSV] Toplam satır:', rows.length);

  // Header tespiti
  let startRow = 1;
  const h0 = (rows[0][0] || '').trim().toUpperCase();
  if (h0 === 'BOLGE' || h0 === 'BÖLGE' || h0 === 'SAMSUN' || h0 === '') {
    startRow = h0 === 'SAMSUN' ? 0 : 1;
  }

  const result = [];

  for (let i = startRow; i < rows.length; i++) {
    const c = rows[i];
    if (c.length < 6) continue;

    const ttt = normTTT(c[1]);
    if (!ttt) continue;

    const grp = normGrp(c[3]);
    if (!grp) continue;

    const ilac = (c[4] || '').trim();
    if (!ilac) continue;

    result.push({
      ttt,
      brick:       (c[2] || '').trim(),
      ilac_grubu:  grp,
      ilac,
      is_mkt:      isMktRow(ilac),
      toplam:      parseN(c[5]),
      toplam_ppi:  parseN(c[6]),  // G sütunu: "37,89%" → parseN → 37.89 (zaten %)
      h1: parseN(c[7]),  h2: parseN(c[9]),  h3: parseN(c[11]), h4: parseN(c[13]),
      h5: parseN(c[15]), h6: parseN(c[17]), h7: parseN(c[19]), h8: parseN(c[21]), h9: parseN(c[23])
    });
  }

  if (result.length === 0) {
    console.error('[IMS DEBUG] İlk 3 veri satırı:');
    for (let d = startRow; d < Math.min(startRow+3, rows.length); d++) {
      console.error('  Satır', d, ':', rows[d] ? rows[d].slice(0,6) : 'yok');
      if (rows[d]) {
        console.error('    TTT raw:', rows[d][1], '→', normTTT(rows[d][1]));
        console.error('    GRP raw:', rows[d][3], '→', normGrp(rows[d][3]));
      }
    }
    throw new Error('IMS_TABLO: geçerli satır bulunamadı. Konsolu kontrol edin.');
  }

  console.log('[parseIMSCSV] Parsed', result.length, 'rows. First:', JSON.stringify(result[0]));
  return result;
}


function parseGenelCSV(csvText) {
  const rows = parseCSVRows(csvText);
  if (csvText.trim().startsWith('<')) {
    throw new Error('GENEL_TABLO.csv yerine HTML döndü. Birkaç saniye bekleyip tekrar deneyin.');
  }
  if (rows.length < 2) throw new Error('GENEL_TABLO boş - dosya içeriği yok');

  console.log('[GENEL CSV] İlk satır (' + rows[0].length + ' sütun):', rows[0].slice(0,8));
  console.log('[GENEL CSV] Toplam satır:', rows.length);

  // ── Sütun haritası (0-index, CSV'deki sıra) ──────────────
  // A[0]  B[1]  C[2]  D[3]  E[4]  F[5]  G[6]  H[7]  I[8]
  // J[9]=TR SIRA   K[10]=BAREM   L[11]=ÜRÜN AĞIRLIĞI
  // M[12]=IMS TL   N[13]=TTT     O[14]=ÜRÜNLER
  // P[15]=HEDEF TL  Q[16]=SATIŞ TL  R[17]=KALAN TL
  // S[18]=TL%  (0-1 decimal)    T[19]=PRİM PUAN% (0-1 decimal)
  // U[20]=PPI TL   V[21]=PPI KUTU
  // W[22]=TOP.PAZAR TL  X[23]=TOP.PAZAR KUTU
  // Y[24]=HEDEF ANAMAL KTU   Z[25]=TOPLAM ÇIKAN ANAMAL KTU
  // AA[26]=%100 KALAN KTU    AB[27]=HAFTALIK GEREKEN KTU
  // AC[28]=SON IMS GEREKEN   AD[29]=TOPLAM FARK
  // AE[30]=HAFTALIK GEREKEN TL
  // AF[31]=TAHMİNİ SATIŞ  AG[32]=TAH.ANAMAL TL  AH[33]=TAH.ÜRÜN TL
  // AI[34]=TAH.TL%  AJ[35]=TAH.PRİM PUAN
  // AK[36]=1.H TL  AL[37]=2.H TL  AM[38]=3.H TL  AN[39]=4.H TL
  // AO[40]=5.H TL  AP[41]=6.H TL  AQ[42]=7.H TL  AR[43]=8.H TL  AS[44]=9.H TL

  // Header var mı? İlk satırın N[13] sütunu TTT ismi mi header mı?
  let startRow = 1;
  const maybeHeader = (rows[0][13] || '').trim().toUpperCase();
  if (!normTTT(maybeHeader)) {
    startRow = 1; // header var
  } else {
    startRow = 0; // header yok
  }

  const genel  = [];
  const imsTL  = {};  // urun → IMS TL fiyatı
  const trSira = {};  // ttt  → TR sıra no

  // normPct: parseN zaten % kaldırır.
  // "56,34%" → parseN → 56.34 (zaten yüzde, >1)
  // "0,4856" → parseN → 0.4856 (<1, ×100 yap)
  function normPct(raw) {
    const v = parseN(raw);
    if (v === 0) return 0;
    // Eğer değer 1'den büyükse zaten yüzde formatında (56.34 gibi)
    // Eğer 1'den küçük veya eşitse decimal format (0.5634), ×100 gerekli
    return v > 1 ? parseFloat(v.toFixed(4)) : parseFloat((v * 100).toFixed(4));
  }

  for (let i = startRow; i < rows.length; i++) {
    const c = rows[i];
    if (c.length < 15) continue;

    const ttt  = normTTT(c[13]);
    if (!ttt) continue;

    const urunRaw = (c[14] || '').trim().toUpperCase();
    if (!urunRaw) continue;

    // FAMTREK → FAMTREC normalize, diğerleri aynen
    const urunMap = { 'FAMTREK': 'FAMTREC', 'GRIPORT COLD': 'GRİPORT COLD' };
    const urun = urunMap[urunRaw] || urunRaw;

    // DESTEVIT veya boş ürünleri atla
    if (urun === 'DESTEVIT' || !urun) continue;

    const tl_pct   = normPct(c[18]);   // S: TL%
    const prim_pct = normPct(c[19]);   // T: PRİM PUAN%
    const ims_tl   = parseN(c[12]);    // M: IMS TL
    const tr_s     = Math.round(parseN(c[9])); // J: TR SIRA

    // IMS TL haritası (GENEL TOPLAM hariç)
    if (ims_tl > 0 && urun !== 'GENEL TOPLAM') {
      imsTL[urun] = Math.round(ims_tl);
    }

    // TR SIRA (GENEL TOPLAM satırından al)
    if (urun === 'GENEL TOPLAM' && tr_s > 0) {
      trSira[ttt] = tr_s;
    }

    genel.push({
      ttt, urun,
      tr_sira:        tr_s,
      barem:          parseN(c[10]),
      urun_agirlik:   parseN(c[11]),
      ims_tl,
      hedef_tl:       parseN(c[15]),   // P
      satis_tl:       parseN(c[16]),   // Q
      kalan_tl:       parseN(c[17]) || (parseN(c[15]) - parseN(c[16])), // R (fallback: hedef-satis)
      tl_pct,                           // S ×100
      prim_pct,                         // T ×100
      hedef_kutu:     parseN(c[24]),   // Y
      cikan_kutu:     parseN(c[25]),   // Z
      kalan_kutu_100: parseN(c[26]),   // AA
      hft_kutu:       parseN(c[27]),   // AB
      hft_tl:         parseN(c[30]),   // AE
      brut_prim:      parseN(c[7]),    // H
      net_prim:       parseN(c[8]),    // I
      // Haftalık TL: AK(36)..AS(44)
      h1: parseN(c[36]), h2: parseN(c[37]), h3: parseN(c[38]),
      h4: parseN(c[39]), h5: parseN(c[40]), h6: parseN(c[41]),
      h7: parseN(c[42]), h8: parseN(c[43]), h9: parseN(c[44])
    });
  }

  if (genel.length === 0) throw new Error('GENEL_TABLO: geçerli satır bulunamadı');
  console.log('[parseGenelCSV] Parsed', genel.length, 'rows. First:', JSON.stringify(genel[0]));
  console.log('[parseGenelCSV] GENEL TOPLAM:',
    JSON.stringify(genel.filter(r=>r.urun==='GENEL TOPLAM').map(r=>({ttt:r.ttt,tl:r.tl_pct,h:r.hedef_tl,s:r.satis_tl}))));
  return { genel, imsTL, trSira };
}

// ─── KENDİ ÜRÜN HARİTASI ────────────────────────────────────