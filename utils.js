/* ════════════════════════════════════════════════════════════
   SAMSUN 2D SATIŞ PORTALI — utils.js
   Saf mantıksal yardımcılar: sabitler, CSV parser'lar,
   hesaplama formülleri, tarih işlemleri.
   DOM bağımlılığı YOK.
   ════════════════════════════════════════════════════════════ */

// ── PRİM ÇARPAN TABLOSU (2026) ──────────────────────────────
const CARPAN_TABLE = {
  91:75,92:78,93:81,94:84,95:87,96:90,97:93,98:96,99:99,100:100,
  101:105,102:108,103:112,104:116,105:120,106:122,107:124,108:126,109:128,110:130,
  111:132,112:134,113:136,114:138,115:140,116:142,117:144,118:146,119:148,120:150,
  121:151,122:152,123:153,124:154,125:155,126:156,127:157,128:158,129:159,130:160
};

// MI & GI MATRİS (PDF sayfa 13)
const MIGI_MATRIX = {
  80:  {80:0,   85:0,   90:0,   95:0,    100:0.5, 110:0.5, 120:0.75,130:0.75,140:1,   150:1.1},
  85:  {80:0,   85:0,   90:0,   95:0.5,  100:0.5, 110:0.75,120:0.75,130:1,   140:1.1, 150:1.1},
  90:  {80:0,   85:0,   90:0.5, 95:0.5,  100:0.75,110:0.75,120:1,   130:1.1, 140:1.1, 150:1.25},
  95:  {80:0,   85:0.5, 90:0.5, 95:0.75, 100:0.75,110:1,   120:1.1, 130:1.1, 140:1.25,150:1.25},
  100: {80:0.5, 85:0.5, 90:0.75,95:0.75, 100:1,   110:1.1, 120:1.1, 130:1.25,140:1.25,150:1.5},
  110: {80:0.5, 85:0.75,90:0.75,95:1,    100:1.1, 110:1.1, 120:1.25,130:1.25,140:1.5, 150:1.5},
  120: {80:0.75,85:0.75,90:1,   95:1.1,  100:1.1, 110:1.25,120:1.25,130:1.5, 140:1.5, 150:1.75},
  130: {80:0.75,85:1,   90:1.1, 95:1.1,  100:1.25,110:1.25,120:1.5, 130:1.5, 140:1.75,150:1.75},
  140: {80:1,   85:1.1, 90:1.1, 95:1.25, 100:1.25,110:1.5, 120:1.5, 130:1.75,140:1.75,150:2},
  150: {80:1.1, 85:1.1, 90:1.25,95:1.25, 100:1.5, 110:1.5, 120:1.75,130:1.75,140:2,   150:2},
};

// Ürün ağırlıkları (sabit referans — CSV'den gelirse o öncelikli)
const URUN_AGIRLIK = {
  'PANOCER': 0.25, 'ACİDPASS': 0.25,
  'GRİPORT COLD': 0.20, 'MOKSEFEN': 0.15, 'FAMTREC': 0.15
};

// ── UYGULAMA SABİTLERİ ────────────────────────────────────
const URUN_ORDER = ['PANOCER','ACİDPASS','GRİPORT COLD','MOKSEFEN','FAMTREC'];

let ALL_TTTS = ['AYKUT DİNLER','EMRAH YILDIZ','HAKAN YUMAK','KÜRŞAD KARADAĞ',
                'MEHMET AKİF ÖZGEÇEN','MURAT KANDİŞ','SAMET ÇETİN','YILMAZ USTA'];

const ALL_GROUPS = ['PANTAPROZOL PAZARI','ACIDPASS PAZARI','MOKSİFLOKSASİN PAZARI',
                    'GRİPORT COLD PAZARI','FAMTREC PAZARI'];

function drugLabel(d){ return d.replace(' TOPLAM','').replace(' PAZARI',''); }

const GRP_LBL = {
  'PANTAPROZOL PAZARI':'Pantaprozol','ACIDPASS PAZARI':'Acidpass',
  'MOKSİFLOKSASİN PAZARI':'Moksiflo.','GRİPORT COLD PAZARI':'Griport Cold',
  'FAMTREC PAZARI':'Famtrec'
};

const DRUG_ORDER = {
  'PANTAPROZOL PAZARI':    ['PANOCER TOPLAM','PANTACTIVE','PULCET','PANTO','DIGER PANTAPROZOLE'],
  'ACIDPASS PAZARI':       ['ACIDPASS TOPLAM','TRIGAST','FAMODİN PLUS','TALCID','RENNIE','DIGER ACIDPASS'],
  'GRİPORT COLD PAZARI':  ['GRİPORT COLD','KATARIN','NUROFEN COLD FLUE','GRİBEX COLD FLUE','A FERİN','OTHER COLD PREP','OTHER COLD PREP - VIT C'],
  'MOKSİFLOKSASİN PAZARI':['MOKSEFEN','MOXAI','AVELOX','DİĞER MOKSİFLOKSASİN','DİĞER LEVOFLOKSASİN'],
  'FAMTREC PAZARI':        ['FAMTREC','BRUFEN','DİĞER FAMOTİDİN'],
};

const TTT_COLORS = ['#4F008C','#E07B39','#16A34A','#DC2626','#0891B2','#D97706','#7C3AED','#065F46'];

const TR_SIRA_MAP = {
  "KÜRŞAD KARADAĞ": 20, "MEHMET AKİF ÖZGEÇEN": 28, "MURAT KANDİŞ": 36,
  "YILMAZ USTA": 52, "SAMET ÇETİN": 54, "AYKUT DİNLER": 55,
  "HAKAN YUMAK": 64, "EMRAH YILDIZ": 67, "ŞENOL YILMAZ": 5
};

const IMS_TL_MAP = {
  "PANOCER":105.31,"ACİDPASS":112.23,"GRİPORT COLD":84.15,"MOKSEFEN":149,"FAMTREC":95
};

const URUN_CLR = {
  'PANOCER':'#16A34A','ACİDPASS':'#1BCED8','GRİPORT COLD':'#FF375E',
  'MOKSEFEN':'#521FD1','FAMTREC':'#E07B39'
};

const PAZ_COLORS = ['#E53E3E','#3B82F6','#F97316','#7C3AED','#10B981','#0891B2',
                    '#F59E0B','#8B5CF6','#EC4899','#14B8A6','#DC2626','#6366F1',
                    '#22D3EE','#84CC16','#FB923C'];

function getPazColor(d, ownIlac, idx){
  return d === ownIlac ? '#1BCED8' : PAZ_COLORS[idx % PAZ_COLORS.length];
}

const OWN_DRUG_BY_GRP = {
  'PANTAPROZOL PAZARI':    { ownIlac: 'PANOCER TOPLAM',  urun: 'PANOCER',      ilac_grubu:'PANTAPROZOL PAZARI'    },
  'ACIDPASS PAZARI':       { ownIlac: 'ACIDPASS TOPLAM', urun: 'ACİDPASS',     ilac_grubu:'ACIDPASS PAZARI'       },
  'MOKSİFLOKSASİN PAZARI':{ ownIlac: 'MOKSEFEN',         urun: 'MOKSEFEN',     ilac_grubu:'MOKSİFLOKSASİN PAZARI' },
  'GRİPORT COLD PAZARI':  { ownIlac: 'GRİPORT COLD',    urun: 'GRİPORT COLD', ilac_grubu:'GRİPORT COLD PAZARI'   },
  'FAMTREC PAZARI':        { ownIlac: 'FAMTREC',          urun: 'FAMTREC',      ilac_grubu:'FAMTREC PAZARI'        },
};

const OWN_IMS = {
  'PANTAPROZOL PAZARI':    'PANOCER TOPLAM',
  'ACIDPASS PAZARI':       'ACIDPASS TOPLAM',
  'MOKSİFLOKSASİN PAZARI':'MOKSEFEN',
  'GRİPORT COLD PAZARI':  'GRİPORT COLD',
  'FAMTREC PAZARI':        'FAMTREC',
};

const HOLIDAYS = new Set([
  '2026-01-01','2026-03-20','2026-03-21','2026-03-22',
  '2026-04-23','2026-05-01','2026-05-19',
  '2026-05-26','2026-05-27','2026-05-28','2026-05-29',
  '2026-07-15','2026-08-30','2026-10-29',
]);

const PERIODS = [
  {key:'1d',label:'1.Dönem',months:'Ocak–Şubat',start:'2026-01-01',end:'2026-02-28',
   badgeIcon:'📊',badgeColor:'#4F008C',badgeBg:'rgba(79,0,140,.12)',
   bannerGrad:'linear-gradient(135deg,#4F008C 0%,#7B2FBE 50%,#1BCED8 100%)',
   description:'Yıl Açılış Dönemi · Ocak – Şubat 2026'},
  {key:'2d',label:'2.Dönem',months:'Mart–Nisan',start:'2026-03-01',end:'2026-04-30',
   badgeIcon:'📈',badgeColor:'#0E7490',badgeBg:'rgba(14,116,144,.12)',
   bannerGrad:'linear-gradient(135deg,#0E7490 0%,#0891B2 50%,#1BCED8 100%)',
   description:'2.Satış Dönemi · Mart – Nisan 2026'},
  {key:'k1',label:'1.Kompanzasyon',months:'Mayıs–Haziran',start:'2026-05-01',end:'2026-06-30',
   badgeIcon:'🏆',badgeColor:'#D97706',badgeBg:'rgba(217,119,6,.12)',
   bannerGrad:'linear-gradient(135deg,#D97706 0%,#F59E0B 50%,#FCD34D 100%)',
   description:'1.Kompanzasyon Dönemi · Mayıs – Haziran 2026'},
  {key:'3d',label:'3.Dönem',months:'Temmuz–Ağustos',start:'2026-07-01',end:'2026-08-31',
   badgeIcon:'☀️',badgeColor:'#059669',badgeBg:'rgba(5,150,105,.12)',
   bannerGrad:'linear-gradient(135deg,#059669 0%,#10B981 50%,#34D399 100%)',
   description:'3.Satış Dönemi · Temmuz – Ağustos 2026'},
  {key:'4d',label:'4.Dönem',months:'Eylül–Ekim',start:'2026-09-01',end:'2026-10-31',
   badgeIcon:'🍂',badgeColor:'#7C3AED',badgeBg:'rgba(124,58,237,.12)',
   bannerGrad:'linear-gradient(135deg,#7C3AED 0%,#8B5CF6 50%,#A78BFA 100%)',
   description:'4.Satış Dönemi · Eylül – Ekim 2026'},
  {key:'k2',label:'2.Kompanzasyon',months:'Kasım–Aralık',start:'2026-11-01',end:'2026-12-31',
   badgeIcon:'🎯',badgeColor:'#DC2626',badgeBg:'rgba(220,38,38,.12)',
   bannerGrad:'linear-gradient(135deg,#DC2626 0%,#EF4444 50%,#FB7187 100%)',
   description:'2.Kompanzasyon Dönemi · Kasım – Aralık 2026'},
];

const MG_AY_ADI = {
  '01':'Ocak','02':'Şubat','03':'Mart','04':'Nisan','05':'Mayıs','06':'Haziran',
  '07':'Temmuz','08':'Ağustos','09':'Eylül','10':'Ekim','11':'Kasım','12':'Aralık'
};

// ── GEÇERLİ KULLANICILARA GİRİŞ SABİTLERİ ──────────────────
const VALID_USERS = [
  'Şenol Yılmaz','Yılmaz Usta','Murat Kandiş','Kürşad Karadağ',
  'Emrah Yıldız','Hakan Yumak','Aykut Dinler','Mehmet Akif Özgeçen','Samet Çetin'
];

const USER_TO_TTT = {
  'şenol yılmaz':          'ŞENOL YILMAZ',
  'yılmaz usta':           'YILMAZ USTA',
  'murat kandiş':          'MURAT KANDİŞ',
  'murat kandis':          'MURAT KANDİŞ',
  'kürşad karadağ':        'KÜRŞAD KARADAĞ',
  'kursad karadag':        'KÜRŞAD KARADAĞ',
  'emrah yıldız':          'EMRAH YILDIZ',
  'emrah yildiz':          'EMRAH YILDIZ',
  'hakan yumak':           'HAKAN YUMAK',
  'aykut dinler':          'AYKUT DİNLER',
  'mehmet akif özgeçen':   'MEHMET AKİF ÖZGEÇEN',
  'mehmet akif ozgecen':   'MEHMET AKİF ÖZGEÇEN',
  'samet çetin':           'SAMET ÇETİN',
  'samet cetin':           'SAMET ÇETİN',
};
const VALID_PASS = 'Saslan.9';

// ── TTT NORMALIZER MAP ────────────────────────────────────────
const TTT_NORM_MAP = {
  'KURSAD KARADAG':        'KÜRŞAD KARADAĞ',
  'AYKUT DINLER':          'AYKUT DİNLER',
  'MURAT KANDIS':          'MURAT KANDİŞ',
  'MEHMET AKIF OZGECEN':   'MEHMET AKİF ÖZGEÇEN',
  'SAMET CETIN':           'SAMET ÇETİN',
  'SENOL YILMAZ':          'ŞENOL YILMAZ',
  'HAKAN YUMAK':           'HAKAN YUMAK',
  'YILMAZ USTA':           'YILMAZ USTA',
  'EMRAH YILDIZ':          'EMRAH YILDIZ',
  'KURŞAD KARADAĞ':        'KÜRŞAD KARADAĞ',
};

function normTTT(raw) {
  if (!raw) return '';
  const u = raw.trim().toUpperCase();
  if (TTT_NORM_MAP[u]) return TTT_NORM_MAP[u];
  for (const [k, v] of Object.entries(TTT_NORM_MAP)) {
    if (u === k) return v;
  }
  // Fuzzy: Türkçe karakter strip
  const strip = s => s.replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/İ/g,'I')
    .replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ç/g,'C')
    .replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ı/g,'i')
    .replace(/ö/g,'o').replace(/ü/g,'u').replace(/ç/g,'c');
  const su = strip(u);
  for (const [k, v] of Object.entries(TTT_NORM_MAP)) {
    if (strip(k) === su) return v;
  }
  return '';
}

// ── CSV ARAÇLARI ──────────────────────────────────────────────
function detectSeparator(text) {
  const firstLine = text.replace(/\r/g,'').split('\n').find(l => l.trim());
  if (!firstLine) return ',';
  let inQ = false, commas = 0, semis = 0;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ) { if (ch === ',') commas++; if (ch === ';') semis++; }
  }
  const sep = semis > commas ? ';' : ',';
  console.log('[CSV] separator:', JSON.stringify(sep), '(commas:', commas, 'semis:', semis, ')');
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

// Türkçe sayı parser (nokta=binlik, virgül=ondalık, % izi)
function parseN(v) {
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (!s || s === '-' || s === '--' || s === '') return 0;
  s = s.replace('%', '').trim();
  if (!s || s === '-') return 0;
  const hasDot   = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) { s = s.replace(/\./g, ''); }
    else if (parts.length === 2 && parts[1].length === 3) { s = s.replace(/\./g, ''); }
  }
  const r = parseFloat(s);
  return isNaN(r) ? 0 : r;
}

function normPct(v) {
  // % değeri zaten 0-100 arasında gelebilir ya da 0-1 arasında
  const n = parseN(v);
  // Eğer 0-1 arasındaysa 100 ile çarp
  return (n > 0 && n <= 1) ? n * 100 : n;
}

// ── IMS CSV PARSER ────────────────────────────────────────────
function parseIMSCSV(csvText) {
  if (!csvText || csvText.trim().startsWith('<')) throw new Error('IMS_TABLO.csv HTML döndü');
  const sep  = detectSeparator(csvText);
  const lines = csvText.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
  const result = [];
  let headerSkipped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const c = parseCSVLine(line, sep);
    // Başlık satırını atla
    if (!headerSkipped) {
      const first = (c[0]||'').trim().toUpperCase();
      if (first.includes('BÖLGE') || first.includes('BOLGE') || first.includes('TTT') || first === 'REGION') {
        headerSkipped = true; continue;
      }
      if (first === '') { headerSkipped = true; continue; }
    }
    if (c.length < 6) continue;
    const tttRaw = (c[1]||'').trim();
    if (!tttRaw) continue;
    const ttt = normTTT(tttRaw) || tttRaw.toUpperCase();
    const ilacGrubu = (c[3]||'').trim().toUpperCase();
    const ilacRaw   = (c[4]||'').trim().toUpperCase();
    if (!ilacGrubu || !ilacRaw) continue;
    const is_mkt = ilacRaw.includes('PAZAR') || ilacRaw.includes('TOTAL') || ilacRaw.includes('TOPLAM') && ilacRaw.includes('PAZ');
    result.push({
      ttt,
      brick:      (c[2]||'').trim(),
      ilac_grubu: ilacGrubu,
      ilac:       ilacRaw,
      is_mkt,
      toplam:     parseN(c[5]),
      h1: parseN(c[7]),  h2: parseN(c[9]),  h3: parseN(c[11]),
      h4: parseN(c[13]), h5: parseN(c[15]), h6: parseN(c[17]),
      h7: parseN(c[19]), h8: parseN(c[21]), h9: parseN(c[23]),
    });
  }
  if (result.length === 0) throw new Error('IMS_TABLO: geçerli satır bulunamadı');
  console.log('[parseIMSCSV] Parsed', result.length, 'rows');
  return result;
}

// ── GENEL CSV PARSER ──────────────────────────────────────────
function parseGenelCSV(csvText) {
  if (!csvText || csvText.trim().startsWith('<')) throw new Error('GENEL_TABLO.csv HTML döndü');
  const sep   = detectSeparator(csvText);
  const lines = csvText.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
  const genel = [];
  const imsTL = {};
  const trSira = {};
  let headerSkipped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const c = parseCSVLine(line, sep);
    if (!headerSkipped) {
      const first = (c[0]||'').trim().toUpperCase();
      if (first.includes('TTT') || first.includes('PERSONEL') || first.includes('BÖLGE')) {
        headerSkipped = true; continue;
      }
      if (isNaN(parseFloat(c[9])) && i === 0) { headerSkipped = true; continue; }
    }
    if (c.length < 18) continue;
    const tttRaw  = (c[13]||'').trim();
    if (!tttRaw) continue;
    const ttt = normTTT(tttRaw) || tttRaw.toUpperCase();
    const urunRaw = (c[14]||'').trim().toUpperCase();
    if (!urunRaw) continue;
    const urunMap = { 'FAMTREK': 'FAMTREC', 'GRIPORT COLD': 'GRİPORT COLD' };
    const urun = urunMap[urunRaw] || urunRaw;
    if (urun === 'DESTEVIT' || !urun) continue;

    const tl_pct   = normPct(c[18]);
    const prim_pct = normPct(c[19]);
    const ims_tl   = parseN(c[12]);
    const tr_s     = Math.round(parseN(c[9]));

    if (ims_tl > 0 && urun !== 'GENEL TOPLAM') imsTL[urun] = Math.round(ims_tl);
    if (urun === 'GENEL TOPLAM' && tr_s > 0) trSira[ttt] = tr_s;

    genel.push({
      ttt, urun, tr_sira: tr_s,
      barem:          parseN(c[10]),
      urun_agirlik:   parseN(c[11]),
      ims_tl,
      hedef_tl:       parseN(c[15]),
      satis_tl:       parseN(c[16]),
      kalan_tl:       parseN(c[17]),
      tl_pct, prim_pct,
      hedef_kutu:     parseN(c[24]),
      cikan_kutu:     parseN(c[25]),
      kalan_kutu_100: parseN(c[26]),
      hft_kutu:       parseN(c[27]),
      hft_tl:         parseN(c[30]),
      brut_prim:      parseN(c[7]),
      net_prim:       parseN(c[8]),
      h1: parseN(c[36]), h2: parseN(c[37]), h3: parseN(c[38]),
      h4: parseN(c[39]), h5: parseN(c[40]), h6: parseN(c[41]),
      h7: parseN(c[42]), h8: parseN(c[43]), h9: parseN(c[44])
    });
  }
  if (genel.length === 0) throw new Error('GENEL_TABLO: geçerli satır bulunamadı');
  console.log('[parseGenelCSV] Parsed', genel.length, 'rows');
  return { genel, imsTL, trSira };
}

// ── MI GI TOPLAM CSV PARSER ───────────────────────────────────
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
  const _sep1 = detectSeparator(csvText);
  let di = 0;
  for (let i = 0; i < Math.min(6, rawLines.length); i++) {
    const f = (rawLines[i].split(_sep1)[0]||'').trim().toUpperCase();
    if (AYLAR.some(a => f === a)) { di = i; break; }
  }
  const records = [];
  for (let i = di; i < rawLines.length; i++) {
    const c = rawLines[i].split(_sep1).map(s => s.trim());
    if (c.length < 5) continue;
    const ayRaw  = (c[0]||'').toUpperCase();
    const person = (c[1]||'').trim();
    if (!ayRaw || !person) continue;
    if (person.toUpperCase().includes('NATIONAL') || person.toUpperCase().includes('GİDİLMEYEN')) continue;
    const ayE = Object.entries(AY_MAP).find(([k]) => ayRaw.includes(k));
    if (!ayE) continue;
    const donem = ayE[1] + '/2026';
    records.push({
      person, donem, ilac: 'GENEL',
      bi: pN(c[2]), evol: pN(c[3]), mi: pN(c[4]),
      pp2: pN(c[5]), pp1: pN(c[6]), pp_bi: pN(c[7]),
      hedef_pct: pN(c[8]), satis_pct: pN(c[9]), real_pct: pN(c[10])
    });
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

// ── MI GI BRICK CSV PARSER ────────────────────────────────────
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
  const ILACLAR = ['PANOCER','FAMTREC','MOKSEFEN','ACİDPASS','GRİPORT COLD'];
  const sep = detectSeparator(csvText);
  const lines = csvText.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
  const row0 = (lines[0]||'').split(sep).map(s=>s.trim().toUpperCase());
  const ayBloklar = [];
  let lastDonem = null;
  for (let col = 4; col < row0.length; col++) {
    const val = row0[col];
    if (!val) continue;
    let donem = null;
    for (const [ayAd, ayNo] of Object.entries(AY_MAP)) {
      if (val.includes(ayAd)) {
        const yilMatch = val.match(/\d{4}/);
        const yil = yilMatch ? yilMatch[0] : '2026';
        donem = ayNo + '/' + yil; break;
      }
    }
    if (donem && donem !== lastDonem) { ayBloklar.push({ donem, colStart: col }); lastDonem = donem; }
  }
  if (ayBloklar.length === 0) {
    const ayler = ['02','03','04','05','06','07','08','09','10','11','12'];
    ayler.forEach((ay, i) => { ayBloklar.push({ donem: ay+'/2026', colStart: 4 + i * 20 }); });
  }
  let dataStartIdx = 3;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const firstCol = (lines[i].split(sep)[0]||'').trim().toUpperCase();
    if (firstCol.includes('SIRA') || firstCol === '333 SIRA') { dataStartIdx = i + 1; break; }
  }
  const result = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const c = line.split(sep);
    const siraRaw = (c[0]||'').trim();
    if (!siraRaw || isNaN(parseInt(siraRaw))) continue;
    const personRaw = (c[2]||'').trim();
    const person = normTTT(personRaw) || personRaw;
    if (!person || person.toUpperCase().includes('GIDILMEYEN') || person.toUpperCase().includes('GİDİLMEYEN')) continue;
    const brick = (c[3]||'').trim();
    if (!brick) continue;
    for (const { donem, colStart } of ayBloklar) {
      for (let ilacIdx = 0; ilacIdx < ILACLAR.length; ilacIdx++) {
        const ilac = ILACLAR[ilacIdx];
        const bi   = pN(c[colStart + 0 * ILACLAR.length + ilacIdx]);
        const evol = pN(c[colStart + 1 * ILACLAR.length + ilacIdx]);
        const mi   = pN(c[colStart + 2 * ILACLAR.length + ilacIdx]);
        const pp   = pN(c[colStart + 3 * ILACLAR.length + ilacIdx]);
        if (bi !== null || evol !== null || mi !== null || pp !== null) {
          result.push({ sira: parseInt(siraRaw), bolge: (c[1]||'').trim(), person, brick, donem, ilac, bi, evol, mi, pp });
        }
      }
    }
  }
  console.log('[parseMiGiBrickCSV]', result.length, 'records');
  return result;
}

// Eski compat stubs
function parseMiGiKarneCSV(){ return {records:[],donem:''}; }
function parseMiGiCSV(){ return []; }

// ── PRİM HESAPLAMA FONKSİYONLARI ─────────────────────────────
function getCarpan(real_pct) {
  const r = Math.min(Math.max(Math.round(real_pct), 91), 130);
  return (CARPAN_TABLE[r] || 100) / 100;
}

function getMiGiKatsayi(mi, gi) {
  const MI_COLS = [80,85,90,95,100,110,120,130,140,150];
  const GI_ROWS = [80,85,90,95,100,110,120,130,140,150];
  const snapMI  = MI_COLS.reduce((a,b) => Math.abs(b-mi)<Math.abs(a-mi)?b:a);
  const snapGI  = GI_ROWS.reduce((a,b) => Math.abs(b-gi)<Math.abs(a-gi)?b:a);
  return MIGI_MATRIX[snapGI]?.[snapMI] ?? 0;
}

function calcPrimPuani(urunReals, ttt) {
  let total = 0;
  for (const urun of Object.keys(URUN_AGIRLIK)) {
    const real = urunReals[urun] || 0;
    if (real >= 70) {
      const r = (ttt && typeof GENEL !== 'undefined') ? GENEL.find(g => g.ttt === ttt && g.urun === urun) : null;
      const agirlik = (r && r.urun_agirlik > 0) ? r.urun_agirlik : (URUN_AGIRLIK[urun] || 0);
      total += Math.min(real, 130) * agirlik;
    }
  }
  return total;
}

// ── TARİH / İŞ GÜNÜ HESABI ───────────────────────────────────
function workDays(s, e) {
  let d = new Date(s), cnt = 0;
  const end = new Date(e);
  while (d <= end) {
    const dw = d.getDay();
    const ds = d.toISOString().slice(0,10);
    if (dw > 0 && dw < 6 && !HOLIDAYS.has(ds)) cnt++;
    d.setDate(d.getDate() + 1);
  }
  return cnt;
}

// ── MI GI FORMATLAMA ─────────────────────────────────────────
function mgFmt(v, ispp) {
  if (v === null || v === undefined) return '<span style="color:rgba(255,255,255,.2)">—</span>';
  const n = Number(v);
  if (ispp) return `<span style="color:var(--dim);font-size:11px">${n.toFixed(2)}%</span>`;
  const clr = n >= 100 ? '#34d399' : '#f87171';
  const w   = n >= 100 ? 'bold'    : 'normal';
  return `<span style="color:${clr};font-weight:${w};font-family:monospace">${n.toFixed(1)}</span>`;
}

function mgDurumBadge(evol, mi) {
  const e = evol ?? 0, m = mi ?? 0;
  if      (e >= 110 && m >= 100) return '<span class="mg-badge mg-good2">✅ Güçlü</span>';
  else if (e >= 100 && m >= 100) return '<span class="mg-badge mg-good">🔵 İyi</span>';
  else if (e < 90  || m < 90)   return '<span class="mg-badge mg-risk">⚠️ Risk</span>';
  else                           return '<span class="mg-badge mg-mid">🟡 Orta</span>';
}

function getIndeksColor(v) {
  if (v >= 120) return '#16A34A';
  if (v >= 100) return '#0891B2';
  if (v >= 80)  return '#D97706';
  return '#DC2626';
}

function getIndeksLabel(v) {
  if (v >= 120) return '🟢 Güçlü';
  if (v >= 100) return '🔵 İyi';
  if (v >= 80)  return '🟡 Orta';
  return '🔴 Zayıf';
}

function getPriorityLabel(sira, mi, gi) {
  const inTop333 = sira <= 333;
  const strong = mi >= 110 && gi >= 100;
  const risk   = mi < 90  || gi < 90;
  if (inTop333 && strong) return '<span style="background:#16A34A;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">🔑 ÖNCELİKLİ</span>';
  if (inTop333 && risk)   return '<span style="background:#DC2626;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">⚠️ RİSK</span>';
  if (inTop333)           return '<span style="background:#D97706;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">⭐ İZLE</span>';
  return '<span style="background:#94A3B8;color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700">2. GRP</span>';
}

// ── ECZANE CSV PARSER ────────────────────────────────────────
function parseEczaneCSV(csvText) {
  if (csvText.trim().startsWith('<')) throw new Error('ECZANE.csv HTML döndü');
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) throw new Error('ECZANE.csv boş');
  let startRow = 0;
  if ((rows[0][0]||'').trim().toLowerCase().includes('tarih')) startRow = 1;
  const result = [];
  const brickTTT = typeof getBrickTTTMap === 'function' ? getBrickTTTMap() : {};
  for (let i = startRow; i < rows.length; i++) {
    const c = rows[i];
    if (c.length < 9) continue;
    const gln   = (c[3]||'').trim();
    const ad    = (c[4]||'').trim();
    const brick = (c[5]||'').trim();
    const urun  = (c[6]||'').trim();
    if (!gln || !ad || !brick || !urun) continue;
    const tarih = (c[0]||'').trim();
    const adet  = parseInt(c[8]||0) || 0;
    const tutar = parseN(c[11]||0);
    const iade  = parseInt(c[12]||0) || 0;
    const ayParts = tarih.split('.');
    const ay = ayParts.length >= 2 ? ayParts[1].padStart(2,'0') + '/' + (ayParts[2]||'2026') : '01/2026';
    const ttt = brickTTT[brick.toUpperCase()] || null;
    result.push({ tarih, gln, ad, brick, urun, adet, tutar, iade, ay, ttt });
  }
  return result;
}

// ── IMS KUTU YENİDEN İNŞA ────────────────────────────────────
function rebuildKutuFromIMS() {
  KUTU.length = 0;
  const wk  = ['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const map = {};
  IMS.forEach(row => {
    const def = OWN_DRUG_BY_GRP[row.ilac_grubu];
    if (!def) return;
    if (row.ilac.trim().toUpperCase() !== def.ownIlac.trim().toUpperCase()) return;
    const key = row.ttt + '|' + def.urun;
    if (!map[key]) { map[key] = { ttt: row.ttt, urun: def.urun }; wk.forEach(w => { map[key][w] = 0; }); }
    wk.forEach(w => { map[key][w] += (row[w] || 0); });
  });
  Object.values(map).forEach(obj => KUTU.push(obj));
}
