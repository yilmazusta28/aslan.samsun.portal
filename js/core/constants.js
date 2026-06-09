// ══════════════════════════════════════════════════════════════
//  js/core/constants.js — Uygulama Sabitleri
//  Phase 3.0 extraction — dosya yapısı reorganizasyonu
//  Globals: GS_*_URL, OWN_IMS, OWN_DRUG_BY_GRP, IMS_TL_MAP,
//           URUN_ORDER, URUN_CLR, ALL_TTTS, ALL_GROUPS, GRP_LBL,
//           TR_SIRA_MAP, USER_TO_TTT, GITHUB_IMG_BASE, GS_ECZANE_URL
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── GitHub Raw CSV URL'leri ─────────────────────────────────
const GS_IMS_URL   = "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/IMS_TABLO.csv";
const GS_GENEL_URL = "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/GENEL_TABLO.csv";
// MI_GI.csv artık kullanılmıyor (MI_GI-TL.csv ve MI_GI-KUTU.csv kullanılıyor)
const GS_MIGI_TL_URL        = "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_TL_TOPLAM.csv";
const GS_MIGI_KUTU_URL      = "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_KUTU_TOPLAM.csv";
const GS_MIGI_BRICK_TL_URL  = "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-TL.csv";
const GS_MIGI_BRICK_KUTU_URL= "https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-KUTU.csv";
const GS_ECZANE_URL = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/eczane/ECZANE.csv';

// ── PHASE 5.2: Aylık Eczane Dosya Dizini ─────────────────────────
// Yeni format: data/ECZANE/YYYY_MM_Eczane.csv
// Eski ECZANE.csv → geriye dönük uyumluluk için korundu
const GS_ECZANE_DIR = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/ECZANE/';

// ── Medya & Asset URL'leri ───────────────────────────────────
const GITHUB_IMG_BASE = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/images/';

// ── Ürün & Grup Sabitleri ────────────────────────────────────
const URUN_ORDER = ['PANOCER','ACİDPASS','GRİPORT COLD','MOKSEFEN','FAMTREC'];
const ALL_TTTS = ['AYKUT DİNLER','EMRAH YILDIZ','HAKAN YUMAK','KÜRŞAD KARADAĞ','MEHMET AKİF ÖZGEÇEN','MURAT KANDİŞ','SAMET ÇETİN','YILMAZ USTA'];
const ALL_GROUPS = ['PANTAPROZOL PAZARI','ACIDPASS PAZARI','GRİPORT COLD PAZARI','MOKSİFLOKSASİN PAZARI','FAMTREC PAZARI'];
const GRP_LBL = {'PANTAPROZOL PAZARI':'Pantaprozol','ACIDPASS PAZARI':'Acidpass','GRİPORT COLD PAZARI':'Griport Cold','MOKSİFLOKSASİN PAZARI':'Moksiflo.','FAMTREC PAZARI':'Famtrec'};
const TR_SIRA_MAP = {"KÜRŞAD KARADAĞ": 20, "MEHMET AKİF ÖZGEÇEN": 28, "MURAT KANDİŞ": 36, "YILMAZ USTA": 52, "SAMET ÇETİN": 54, "AYKUT DİNLER": 55, "HAKAN YUMAK": 64, "EMRAH YILDIZ": 67, "ŞENOL YILMAZ": 5};
const IMS_TL_MAP = {"PANOCER":105.31,"ACİDPASS":112.23,"GRİPORT COLD":84.15,"MOKSEFEN":149,"FAMTREC":95};
const URUN_CLR = {'PANOCER':'#16A34A','ACİDPASS':'#1BCED8','GRİPORT COLD':'#FF375E','MOKSEFEN':'#521FD1','FAMTREC':'#E07B39'};

// ── Kullanıcı → TTT Eşleşme Tablosu ─────────────────────────
const USER_TO_TTT = {
  'şenol yılmaz':  'ŞENOL YILMAZ',
  'senol yilmaz':  'ŞENOL YILMAZ',
  'yılmaz usta':   'YILMAZ USTA',
  'yilmaz usta':   'YILMAZ USTA',   // I→i varyantı
  'murat kandiş':  'MURAT KANDİŞ',
  'murat kandis':  'MURAT KANDİŞ',
  'kürşad karadağ': 'KÜRŞAD KARADAĞ',
  'kursad karadag': 'KÜRŞAD KARADAĞ',
  'emrah yıldız':  'EMRAH YILDIZ',
  'emrah yildiz':  'EMRAH YILDIZ',
  'hakan yumak':   'HAKAN YUMAK',
  'aykut dinler':  'AYKUT DİNLER',
  'mehmet akif özgeçen': 'MEHMET AKİF ÖZGEÇEN',
  'mehmet akif ozgecen': 'MEHMET AKİF ÖZGEÇEN',
  'samet çetin':   'SAMET ÇETİN',
  'samet cetin':   'SAMET ÇETİN',
};

// ── Ürün Sahipliği (IMS grubu → kendi ürünümüz) ─────────────
const OWN_IMS = {
  'PANTAPROZOL PAZARI':    'PANOCER TOPLAM',
  'ACIDPASS PAZARI':       'ACIDPASS TOPLAM',
  'MOKSİFLOKSASİN PAZARI':'MOKSEFEN',
  'GRİPORT COLD PAZARI':  'GRİPORT COLD',
  'FAMTREC PAZARI':        'FAMTREC',
};

// ── IMS Grup → Kendi Ürün Detay Haritası ────────────────────
const OWN_DRUG_BY_GRP = {
  'PANTAPROZOL PAZARI':    { ownIlac: 'PANOCER TOPLAM',  urun: 'PANOCER',       ilac_grubu:'PANTAPROZOL PAZARI'   },
  'ACIDPASS PAZARI':       { ownIlac: 'ACIDPASS TOPLAM', urun: 'ACİDPASS',      ilac_grubu:'ACIDPASS PAZARI'      },
  'MOKSİFLOKSASİN PAZARI':{ ownIlac: 'MOKSEFEN',         urun: 'MOKSEFEN',      ilac_grubu:'MOKSİFLOKSASİN PAZARI'},
  'GRİPORT COLD PAZARI':  { ownIlac: 'GRİPORT COLD',    urun: 'GRİPORT COLD',  ilac_grubu:'GRİPORT COLD PAZARI'  },
  'FAMTREC PAZARI':        { ownIlac: 'FAMTREC',          urun: 'FAMTREC',       ilac_grubu:'FAMTREC PAZARI'       },
};
