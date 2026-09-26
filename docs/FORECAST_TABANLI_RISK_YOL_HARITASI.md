# FORECAST TABANLI RİSK — TARAMA RAPORU + YOL HARİTASI

**Tarih:** 2026-09-26
**Kapsam:** Genel Durum sayfası, Bölge Özet Analizi, AI Pazar Analizi — Bölge
Müdürü Özeti, Ekip Genelinde Kritik Aksiyon Listesi, ve tüm ekosistemdeki
risk/forecast motorlarının genel taraması.

---

## 1) BU OTURUMDA YAPILAN DEĞİŞİKLİKLER

| # | Yer | Değişiklik |
|---|-----|-----------|
| 1 | Genel Durum → "Ekip Performans Sıralaması" (`#genelTablo`, `renderGenelTablo()`) | Kolon sırası: **Sıra · Temsilci · TR Sıra · Hedef TL · Satış TL · Kalan TL · TL % · PP % · Gerçekleşme · Forecast %**. TR Sıra öne alındı, sona `generateForecast()` kaynaklı **Forecast %** kolonu eklendi. |
| 2 | 💡 Bölge Özet Analizi kutucuğu (`computeHedefOranlari()`, `renderAnaInsight()`) | **Forecast TL** (Dönem Sonu Tahmini TL) ve **Forecast %** çipleri eklendi — TL National Payı / TL Bölge Payı / Gerekli Pazar Payı'nın yanına. |
| 3 | `js/ai/intelligence/risk-engine.js` (`detectRisks()`) | **R1** (genel realizasyon), **R2** (ürün bazlı) ve **R5** (portföy prim riski) artık ANLIK `tl_pct` yerine `generateForecast()`'ın **dönem sonu tahmini** (`projectedReal` / `productForecasts`) değerine göre sınıflandırılıyor. Forecast ≥ %100 ise risk üretilmez ("mevcut durumu koru"); düşükse severity kademeli artıyor ("önlem artır"). |
| 4 | `js/ai/executive/team-risk-engine.js` (`_safeForecast()`) | Eskiden `calculateRunRate()` (birleşik/eski motor) kullanıyordu — artık `generateForecast()` (tek gerçek kaynak) kullanıyor, `calculateRunRate` sadece yedek. Bu, "Ekip Performans Sıralaması (Tümü)" (Yönetici paneli) sayfasındaki risk kategorizasyonunu da aynı tek kaynağa bağladı. |

**Etki zinciri (neden tek yerde değişiklik iki panele de yansıdı):**
`detectRisks()` → hem `buildManagerBrickNarrative()` ("🧭 AI Pazar Analizi —
Bölge Müdürü Özeti" içindeki "⚠ KRİTİK RİSKLER" kutusu) hem de
`buildTeamCriticalActions()` ("🚨 Ekip Genelinde Kritik Aksiyon Listesi")
tarafından tüketiliyor. Ayrıca `js/ai/predictive/projection-engine.js` ve
`js/ai/intelligence/recommendation-engine.js` da aynı `detectRisks()`
çıktısını kullanıyor (AI Asistan / Sales Intelligence sayfası) — yani bu
değişiklik oralara da otomatik yansıdı.

---

## 2) GENEL TARAMA — AI + MANTIK/MATEMATİKSEL MOTORLAR (bu konuyla ilgili)

| Motor | Dosya | Forecast/Risk ile ilişkisi | Durum |
|---|---|---|---|
| Forecast (tek gerçek kaynak) | `js/ai/predictive/forecast-engine.js` | `generateForecast(ttt)` → `projectedTL/projectedReal/productForecasts` | ✅ Değişmedi, zaten doğru — R1/R2/R5 buna bağlandı |
| Risk tespiti | `js/ai/intelligence/risk-engine.js` | R1/R2/R5 forecast tabanlı | ✅ Bu oturumda güncellendi |
| Risk tespiti (R3 pazar payı) | aynı dosya | `bizim_pay/rakip_pay` | ⚪ Değişmedi — veri kaynağı projede hiç yok, kasıtlı dormant (bkz. dosya başı AUDIT NOTU) |
| Risk tespiti (R4 MI&GI) | aynı dosya | brick MI/GI ortalaması | ⚪ Değişmedi — forecast'la doğrudan ilgisi yok (ayrı veri boyutu) |
| Ekip risk sınıflandırma | `js/ai/executive/team-risk-engine.js` | `analyzeTeamRisk()` | ✅ Bu oturumda `generateForecast()`'a bağlandı |
| Ekip sıralama skoru | `js/ai/executive/team-ranking-engine.js` | zaten `generateForecast()` kullanıyordu | ✅ Değişmedi, zaten tutarlıydı |
| Yönetici özeti | `js/ai/executive/executive-summary-engine.js` | `analyzeTeamRisk()` + `buildTeamForecast()` çıktısını okuyor | ⚪ Girdileri güncellendiği için mesajları otomatik iyileşti, kod değişmedi |
| Ekip forecast toplamı | `js/ai/executive/team-forecast-engine.js` | `buildTeamForecast()` | ⚪ İncelendi, ayrı/bağımsız hesap — sonraki adımda birleştirilebilir (bkz. §3) |
| Orkestrasyon | `js/ai/executive/executive-engine.js` | ranking+forecast+risk+summary'yi birleştiriyor | ⚪ Girdileri güncellendi, kod değişmedi |
| AI Asistan projeksiyon | `js/ai/predictive/projection-engine.js` | `calculateRunRate → generateForecast → detectRisks` zinciri | ✅ Zincirin son halkası güncellendiği için otomatik iyileşti |
| Aksiyon önerisi | `js/ai/intelligence/recommendation-engine.js` | `detectRisks()` çıktısını R1/R2 aksiyonlarına çeviriyor | ✅ Girdi güncellendi, kod değişmedi — başlık eşlemeleri (`risk.title`) yeni başlıklarla (`'Dönem Sonu Forecast Kritik'` vb.) uyumlu, kırılma yok |
| Sipariş zamanlaması | `js/ai/core/order-forecast-engine.js` | ürün bazlı sipariş zamanı tahmini | ⚪ Farklı konu (stok/sipariş), risk skorlamasıyla doğrudan ilgisiz |
| Fırsat/İçgörü motorları | `js/ai/intelligence/opportunity-engine.js`, `insight-engine.js` | pazar payı verisi eksikliği (R3 ile aynı kök neden) | ⚪ Değişmedi — aynı "veri kaynağı yok" kısıtı geçerli |
| Intelligence orkestrasyonu | `js/ai/intelligence/intelligence-orchestrator.js` | `detectRisks()`'i çağırıyor | ✅ Girdi güncellendi |

---

## 3) SONRAKİ ADIMLAR İÇİN YOL HARİTASI (öneri, uygulanmadı)

1. **`team-forecast-engine.js` ↔ `forecast-engine.js` birleştirmesi** — ekip
   toplam forecast'ı (`buildTeamForecast`) hâlâ kendi ağırlıklı ortalama
   yöntemini kullanıyor; `generateForecast()` sonuçlarının TTT bazlı
   toplamıyla birebir örtüşüp örtüşmediği doğrulanmalı (team-ranking-engine.js
   FAZ 23 notundaki "iki farklı motor, iki farklı sayı" hatasının aynısı
   burada da gizli olabilir).
2. **R3 (Pazar Payı Kaybı) için gerçek veri kaynağı** — `bizim_pay/rakip_pay`
   hâlâ hiçbir yerde üretilmiyor; bu blok kasıtlı olarak devre dışı. Gerçek
   rakip pazar payı verisi eklenirse (örn. IMS'in "toplam_ppi" alanına
   benzer bir rakip kolonu), forecast tabanlı severity mantığı buraya da
   uygulanabilir.
3. **R4 (MI&GI) forecast'a bağlanabilir mi?** — Şu an sadece MEVCUT MI/GI
   ortalamasına bakıyor; brick bazlı bir "gidişat" (trend) hesaplanabilirse
   (örn. son 2 dönem MI değişimi) aynı "%100'ü geçecekse koru, düşükse
   önlem al" mantığı brick seviyesine de taşınabilir.
4. **Pozitif geri bildirim (opsiyonel)** — Şu an forecast ≥ %100 olduğunda
   `detectRisks()` sessizce risk ÜRETMİYOR (istenen davranış). İstenirse,
   "başarılı gidişat" için ayrı, düşük öncelikli bir POZİTİF bilgi nesnesi
   (örn. `severity:'INFO'`) eklenip Kritik Aksiyon Listesi'nde "🟢 Gidişatı
   koru" şeklinde de gösterilebilir — şu an sadece risk YOKLUĞU ile ima
   ediliyor.
5. **Genel Durum sayfasındaki Forecast % performans maliyeti** — `Ekip
   Performans Sıralaması` tablosu artık her satır için `generateForecast()`
   çağırıyor (TTT başına ~1 hesap). Ekip büyüklüğü arttıkça (400-500
   kullanıcıya ölçeklenme hedefi, bkz. proje notları) bu tablo yalnızca
   ~8-9 TTT için render edildiğinden bugün sorun değil, ama yönetici
   panelindeki benzer tablolarla birlikte önbelleğe alma (aynı dönemde
   `generateForecast(ttt)` sonucunu bir kez hesaplayıp paylaşma)
   değerlendirilebilir.

---

## 4) TEST NOTU

Değiştirilen JS dosyaları `node --check` ile sözdizimi doğrulamasından
geçirildi; `index.html` içindeki tüm `<script>` blokları birleştirilip aynı
şekilde kontrol edildi — hata yok. Fonksiyonel test (gerçek CSV verisiyle
tarayıcıda) yapılmadı — GitHub'a push edip canlıda doğrulamanız gerekir.
