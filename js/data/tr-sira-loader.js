// ══════════════════════════════════════════════════════════════
//  js/data/tr-sira-loader.js — "Ekip Performans Sıralaması" altındaki
//  Türkiye Geneli TR Sıralaması paneli: Veri Yükleme & Parser
//  Kaynak CSV: ./TR_SIRA.csv (GitHub repo kökünde, GS_*_URL desenine uygun)
//  Repo: https://github.com/yilmazusta28/aslan.samsun.portal/blob/main/TR_SIRA.csv
//
//  CSV YAPISI (';' ayraçlı, tek blok — dönemsel değil):
//    Satır 1 (başlık): ";BÖLGE;TTT;HEDEF;SATIŞ;REAL;PRİM PUANI;PP"
//    Satır 2: NATIONAL toplam satırı (SIRA kolonu boş)
//    Satır 3+: SIRA;BÖLGE;TTT;HEDEF;SATIŞ;REAL%;PRİM PUANI%;PP%
//              (Türkiye genelindeki TÜM TTT'ler, sadece Samsun değil)
//    Dosya sonunda bazı DOLGU/BOŞ satırlar olabilir (BÖLGE kolonunda "%"
//    görünen anlamsız satırlar) — bunlar parser tarafından atlanır.
//
//  Bağımlılık: js/data/csv-parser.js → parseN() (Türkçe sayı/yüzde formatı)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

const GS_TR_SIRA_URL = "./TR_SIRA.csv";

// ─── GÖMÜLÜ YEDEK VERİ (fetch başarısız olursa, örn. file:// veya offline) ───
const TR_SIRA_EMBEDDED_CSV = `;BÖLGE;TTT;HEDEF;SATIŞ;REAL;PRİM PUANI;PP
;NATIONAL;NATIONAL;0;0;0%;0%;0%
1;DİYARBAKIR;MEHMET ALİ DİLEKÇİ;0%;0%;0%;0%;0%
2;KONYA;AHMET BERAT DEMİRBAĞ;0%;0%;0%;0%;0%
3;DİYARBAKIR;CİHAT BAVER TUTCİ;0%;0%;0%;0%;0%
4;DİYARBAKIR;MAZLUM TAŞ;0%;0%;0%;0%;0%
5;İSTANBUL AVRUPA;AKIN ÖNAY;0%;0%;0%;0%;0%
6;DİYARBAKIR;YUSUF KENAN ÜNLÜ;0%;0%;0%;0%;0%
7;KONYA;İRFAN KARAGİŞİ;0%;0%;0%;0%;0%
8;SAMSUN;SAMET ÇETİN;0%;0%;0%;0%;0%
9;DİYARBAKIR;SEYFETTİN KAYA;0%;0%;0%;0%;0%
10;DİYARBAKIR;GÜRKAN AKALAN;0%;0%;0%;0%;0%
11;BURSA;MUZAFFER ÇİRKİN;0%;0%;0%;0%;0%
12;İZMİR;SÜLEYMAN ŞENTÜRK;0%;0%;0%;0%;0%
13;İSTANBUL ASYA;FATİH DİL;0%;0%;0%;0%;0%
14;DİYARBAKIR;ÖZKAN YILDIRIM;0%;0%;0%;0%;0%
15;KONYA;ZEKİ TANER BUDUR;0%;0%;0%;0%;0%
16;DİYARBAKIR;MAHMUT CENK ERGÜN;0%;0%;0%;0%;0%
17;ANKARA;İBRAHİM ALTAN İLHAN;0%;0%;0%;0%;0%
18;SAMSUN;MEHMET AKİF ÖZGEÇEN;0%;0%;0%;0%;0%
19;İZMİR;UĞUR İSMAİLOĞULLARI;0%;0%;0%;0%;0%
20;SAMSUN;KÜRŞAD KARADAĞ;0%;0%;0%;0%;0%
21;DİYARBAKIR;UFUK EROĞLU;0%;0%;0%;0%;0%
22;KONYA;AHMET BULUT;0%;0%;0%;0%;0%
23;KONYA;ÖNER SERKAN KUREŞ;0%;0%;0%;0%;0%
24;ANKARA;SERDAR KILIÇ;0%;0%;0%;0%;0%
25;ANKARA;FATİH ÇİÇEK;0%;0%;0%;0%;0%
26;BURSA;HAYRULLAH KISAKOL;0%;0%;0%;0%;0%
27;SAMSUN;HAKAN YUMAK;0%;0%;0%;0%;0%
28;SAMSUN;MURAT KANDİŞ;0%;0%;0%;0%;0%
29;İSTANBUL AVRUPA;UMUT ÇEVİK;0%;0%;0%;0%;0%
30;DİYARBAKIR;FATİH GÜLPER;0%;0%;0%;0%;0%
31;ANKARA;TUNAHAN BEĞEN;0%;0%;0%;0%;0%
32;SAMSUN;YILMAZ USTA;0%;0%;0%;0%;0%
33;İZMİR;SEDAT ÖZCAN;0%;0%;0%;0%;0%
34;İSTANBUL ASYA;EMRE AKÇA;0%;0%;0%;0%;0%
35;İSTANBUL AVRUPA;FURKAN ULU;0%;0%;0%;0%;0%
36;SAMSUN;AYKUT DİNLER;0%;0%;0%;0%;0%
37;ANKARA;KEMAL ÖZGÜR PEKER;0%;0%;0%;0%;0%
38;İZMİR;ESMA BÜYÜKSEVİNDİK;0%;0%;0%;0%;0%
39;BURSA;YUNUS AY;0%;0%;0%;0%;0%
40;İZMİR;DİLA ERKAN;0%;0%;0%;0%;0%
41;İSTANBUL AVRUPA;AHMET TOPRİL;0%;0%;0%;0%;0%
42;KONYA;HATİCE GÜNGÖR;0%;0%;0%;0%;0%
43;İSTANBUL ASYA;BATUHAN ERKAN;0%;0%;0%;0%;0%
44;İZMİR;YASEMİN KILIÇ;0%;0%;0%;0%;0%
45;İZMİR;ALİ TAHÇA;0%;0%;0%;0%;0%
46;KONYA;ABDULLAH TUNAHAN SIRDAŞ;0%;0%;0%;0%;0%
47;DİYARBAKIR;İBRAHİM HALİL YILMAZ;0%;0%;0%;0%;0%
48;KONYA;SONER BITIL;0%;0%;0%;0%;0%
49;İSTANBUL AVRUPA;MUSTAFA KEMAL ENGİN;0%;0%;0%;0%;0%
50;İSTANBUL AVRUPA;YAĞMUR KILIÇTAŞ;0%;0%;0%;0%;0%
51;ANKARA;FAZLI KORKMAZYİĞİT;0%;0%;0%;0%;0%
52;İZMİR;KEREM ÇAVUŞOĞLU;0%;0%;0%;0%;0%
53;KONYA;ERKAN USANMAZ;0%;0%;0%;0%;0%
54;İZMİR;AHMET GÜNDEM;0%;0%;0%;0%;0%
55;İSTANBUL ASYA;SAMED KAÇAR;0%;0%;0%;0%;0%
56;BURSA;GÖKHAN DALKİZ;0%;0%;0%;0%;0%
57;KONYA;BURÇİN KOYUNCU;0%;0%;0%;0%;0%
58;İSTANBUL ASYA;MUSTAFA YAMAK;0%;0%;0%;0%;0%
59;İSTANBUL ASYA;KADİR GÜRTUNCAY;0%;0%;0%;0%;0%
60;ANKARA;BURAK ALPARSLAN;0%;0%;0%;0%;0%
61;BURSA;BİROL KAPLAN;0%;0%;0%;0%;0%
62;KONYA;AYŞE GÖKMEN;0%;0%;0%;0%;0%
63;İZMİR;HÜLYA IŞIK;0%;0%;0%;0%;0%
64;ANKARA;BURAK YALÇIN;0%;0%;0%;0%;0%
65;BURSA;ANIL CELEP;0%;0%;0%;0%;0%
66;İSTANBUL AVRUPA;ALİ BUĞRAHAN KARHAN;0%;0%;0%;0%;0%
67;ANKARA;EMRE TOPSAKAL;0%;0%;0%;0%;0%
68;İSTANBUL ASYA;ERDAL GÜÇLÜ;0%;0%;0%;0%;0%
69;İSTANBUL ASYA;BOŞ TTT IST PENDIK BATI;0%;0%;0%;0%;0%
70;İSTANBUL AVRUPA;JİYAN AYTEK;0%;0%;0%;0%;0%
71;ANKARA;RECEP TEKOLUK;0%;0%;0%;0%;0%
72;ANKARA;BARIŞ ERDOĞAN;0%;0%;0%;0%;0%
73;İSTANBUL AVRUPA;ÖMER FARUK YILMAZ;0%;0%;0%;0%;0%
74;İSTANBUL AVRUPA;UFUK ÖZCAN;0%;0%;0%;0%;0%
75;İSTANBUL ASYA;CENGİZ DURNA;0%;0%;0%;0%;0%
76;İSTANBUL AVRUPA;MEHMET ODUNCU;0%;0%;0%;0%;0%
77;İSTANBUL ASYA;SİNAN ÖZMEN;0%;0%;0%;0%;0%
78;İSTANBUL AVRUPA;EMRAH UĞURLU;0%;0%;0%;0%;0%
79;İSTANBUL ASYA;BERK KAYA;0%;0%;0%;0%;0%
80;0%;0%;0%;0%;0%;0%;0%
81;0%;0%;0%;0%;0%;0%;0%
82;0%;0%;0%;0%;0%;0%;0%
83;0%;0%;0%;0%;0%;0%;0%
84;0%;0%;0%;0%;0%;0%;0%
85;0%;0%;0%;0%;0%;0%;0%
86;0%;0%;0%;0%;0%;0%;0%
87;0%;0%;0%;0%;0%;0%;0%
88;0%;0%;0%;0%;0%;0%;0%
89;0%;0%;0%;0%;0%;0%;0%
90;0%;0%;0%;0%;0%;0%;0%
`;

// ─── STATE ────────────────────────────────────────────────────
// [{ sira, bolge, ttt, hedef, satis, real, primPuani, pp }, ...]
window.TR_SIRA_FULL       = null;
window.TR_SIRA_LOAD_ERROR = null;

// ─── PARSER ───────────────────────────────────────────────────
function parseTrSiraCSV(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(l => l.trim().length);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split(';').map(s => s.trim());
    const bolge = (c[1] || '');
    const ttt   = (c[2] || '');
    if (i === 0 && /BÖLGE/i.test(bolge)) continue; // başlık satırı
    if (!bolge || !ttt) continue;                   // eksik satır
    if (/%/.test(bolge)) continue;                    // dosya sonundaki dolgu/çöp satır
    const siraRaw = (c[0] || '');
    const sira = siraRaw ? Math.round(typeof parseN === 'function' ? parseN(siraRaw) : parseFloat(siraRaw) || 0) : 0; // NATIONAL: sira boş → 0
    rows.push({
      sira,
      bolge: bolge.toUpperCase(),
      ttt:   ttt.toUpperCase(),
      hedef:     typeof parseN === 'function' ? parseN(c[3]) : 0,
      satis:     typeof parseN === 'function' ? parseN(c[4]) : 0,
      real:      typeof parseN === 'function' ? parseN(c[5]) : 0,
      primPuani: typeof parseN === 'function' ? parseN(c[6]) : 0,
      pp:        typeof parseN === 'function' ? parseN(c[7]) : 0
    });
  }
  return rows;
}

// ─── YÜKLEME (fetch + fallback) ────────────────────────────────
async function loadTrSiraData(forceFresh) {
  if (window.TR_SIRA_FULL && !forceFresh) return window.TR_SIRA_FULL;
  window.TR_SIRA_LOAD_ERROR = null;

  // file:// altında fetch CORS ile engellenir → doğrudan gömülü veriye düş
  if (window.location.protocol === 'file:') {
    try {
      window.TR_SIRA_FULL = parseTrSiraCSV(TR_SIRA_EMBEDDED_CSV);
      window.TR_SIRA_LOAD_ERROR = 'file://: GitHub\'dan taze veri çekilemedi, gömülü (statik) veri gösteriliyor.';
      return window.TR_SIRA_FULL;
    } catch (e) {
      window.TR_SIRA_LOAD_ERROR = 'Gömülü veri de okunamadı: ' + e.message;
      return null;
    }
  }

  try {
    const res = await fetch(GS_TR_SIRA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('TR_SIRA.csv yerine HTML döndü');
    const parsed = parseTrSiraCSV(text);
    if (!parsed.length) throw new Error('TR_SIRA.csv içinde geçerli satır bulunamadı');
    window.TR_SIRA_FULL = parsed;
    return parsed;
  } catch (e) {
    console.warn('[tr-sira-loader] Canlı CSV çekilemedi, gömülü veriye düşülüyor:', e.message);
    try {
      window.TR_SIRA_FULL = parseTrSiraCSV(TR_SIRA_EMBEDDED_CSV);
      window.TR_SIRA_LOAD_ERROR = 'Canlı veri çekilemedi (' + e.message + ') — gömülü (statik) veri gösteriliyor.';
      return window.TR_SIRA_FULL;
    } catch (e2) {
      window.TR_SIRA_LOAD_ERROR = 'Veri okunamadı: ' + e2.message;
      return null;
    }
  }
}
