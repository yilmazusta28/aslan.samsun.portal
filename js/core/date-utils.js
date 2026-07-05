// ══════════════════════════════════════════════════════════════
//  js/core/date-utils.js — Tarih Yardımcıları
//  Phase 3.0 extraction
//  Globals: HOLIDAYS, PERIODS, workDays()
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── Resmi Tatiller (2026) ────────────────────────────────────
const HOLIDAYS = new Set([
  '2026-01-01','2026-03-20','2026-03-21','2026-03-22',
  '2026-04-23','2026-05-01','2026-05-19',
  '2026-05-26','2026-05-27','2026-05-28','2026-05-29',
  '2026-07-15','2026-08-30','2026-10-29',
]);

// ── Satış Dönemleri ──────────────────────────────────────────
// ⚠️ Dönem Etiketleme Düzeltmesi (kullanıcı iş kuralı):
//    Ocak–Şubat=1.Dönem, Mart–Nisan=2.Dönem, Mayıs–Haziran=1.Kompanzasyon,
//    Temmuz–Ağustos=4.Dönem, Eylül–Ekim=5.Dönem, Kasım–Aralık=2.Kompanzasyon.
//    (Eskiden Temmuz–Ağustos "3.Dönem", Eylül–Ekim "4.Dönem" yanlış
//    etiketlenmişti — anahtarlar (key) ve etiketler (label) buna göre
//    düzeltildi: 3d→4d, 4d→5d.)
//    `halfYear` alanı 6-Aylık Arşivleme (period-archive-manager.js)
//    tarafından kullanılır: H1 = {1d,2d,k1}, H2 = {4d,5d,k2}.
const PERIODS = [
  {key:'1d',label:'1.Dönem',months:'Ocak–Şubat',start:'2026-01-01',end:'2026-02-28',halfYear:'H1',
   badgeIcon:'📊',badgeColor:'#4F008C',badgeBg:'rgba(79,0,140,.12)',
   bannerGrad:'linear-gradient(135deg,#4F008C 0%,#7B2FBE 50%,#1BCED8 100%)',
   description:'Yıl Açılış Dönemi · Ocak – Şubat 2026'},
  {key:'2d',label:'2.Dönem',months:'Mart–Nisan',start:'2026-03-01',end:'2026-04-30',halfYear:'H1',
   badgeIcon:'📈',badgeColor:'#0E7490',badgeBg:'rgba(14,116,144,.12)',
   bannerGrad:'linear-gradient(135deg,#0E7490 0%,#0891B2 50%,#1BCED8 100%)',
   description:'2.Satış Dönemi · Mart – Nisan 2026'},
  {key:'k1',label:'1.Kompanzasyon',months:'Mayıs–Haziran',start:'2026-05-01',end:'2026-06-30',halfYear:'H1',
   badgeIcon:'🏆',badgeColor:'#D97706',badgeBg:'rgba(217,119,6,.12)',
   bannerGrad:'linear-gradient(135deg,#D97706 0%,#F59E0B 50%,#FCD34D 100%)',
   description:'1.Kompanzasyon Dönemi · Mayıs – Haziran 2026'},
  {key:'4d',label:'4.Dönem',months:'Temmuz–Ağustos',start:'2026-07-01',end:'2026-08-31',halfYear:'H2',
   badgeIcon:'☀️',badgeColor:'#059669',badgeBg:'rgba(5,150,105,.12)',
   bannerGrad:'linear-gradient(135deg,#059669 0%,#10B981 50%,#34D399 100%)',
   description:'4.Satış Dönemi · Temmuz – Ağustos 2026'},
  {key:'5d',label:'5.Dönem',months:'Eylül–Ekim',start:'2026-09-01',end:'2026-10-31',halfYear:'H2',
   badgeIcon:'🍂',badgeColor:'#7C3AED',badgeBg:'rgba(124,58,237,.12)',
   bannerGrad:'linear-gradient(135deg,#7C3AED 0%,#8B5CF6 50%,#A78BFA 100%)',
   description:'5.Satış Dönemi · Eylül – Ekim 2026'},
  {key:'k2',label:'2.Kompanzasyon',months:'Kasım–Aralık',start:'2026-11-01',end:'2026-12-31',halfYear:'H2',
   badgeIcon:'🎯',badgeColor:'#DC2626',badgeBg:'rgba(220,38,38,.12)',
   bannerGrad:'linear-gradient(135deg,#DC2626 0%,#EF4444 50%,#FB7187 100%)',
   description:'2.Kompanzasyon Dönemi · Kasım – Aralık 2026'},
];

// ── İş Günü Hesabı ───────────────────────────────────────────
function workDays(s,e){
  let d=new Date(s),cnt=0;const end=new Date(e);
  while(d<=end){const dw=d.getDay();const ds=d.toISOString().slice(0,10);
    if(dw>0&&dw<6&&!HOLIDAYS.has(ds))cnt++;d.setDate(d.getDate()+1);}
  return cnt;
}

// ── Etkin Dönem (Effective Period) ──────────────────────────
// BUG DÜZELTMESİ (kullanıcı bildirimi): GENEL_TABLO.csv/IMS_TABLO.csv
// bir dönem takvimde bittiğinde HEMEN değil, birkaç gün SONRA
// güncelleniyor (örn. Haziran'ın son IMS verisi 7 Temmuz'da girilir).
// Saf takvim tarihine göre dönem seçen eski mantık (PERIODS.find),
// 1-7 Temmuz arasında zaten "4.Dönem" (Temmuz-Ağustos) seçiyordu —
// ama sistemdeki veri hâlâ bir önceki dönemin (1.Kompanzasyon) verisiydi.
// Sonuç: "kalan iş günü" yeni döneme göre hesaplanıyor, gerçekte daha
// başlamamış bir dönem için çok fazla gün varmış gibi görünüyordu.
// Çözüm: yeni dönemin takvim başlangıcından itibaren PERIOD_GRACE_DAYS
// (takvim günü) boyunca hesaplamalar hâlâ BİR ÖNCEKİ dönem üzerinden
// yapılır. Bu süre geçince normal şekilde yeni döneme geçilir.
const PERIOD_GRACE_DAYS = 7;

function _calendarDaysBetween(startStr, endStr) {
  return Math.round((new Date(endStr) - new Date(startStr)) / 86400000);
}

function getEffectivePeriod(dateStr) {
  dateStr = dateStr || new Date().toISOString().slice(0, 10);
  const idx = PERIODS.findIndex(p => dateStr >= p.start && dateStr <= p.end);
  if (idx < 0) return null;
  const cur = PERIODS[idx];
  const daysIntoPeriod = _calendarDaysBetween(cur.start, dateStr);
  if (daysIntoPeriod < PERIOD_GRACE_DAYS && idx > 0) {
    return PERIODS[idx - 1];
  }
  return cur;
}
