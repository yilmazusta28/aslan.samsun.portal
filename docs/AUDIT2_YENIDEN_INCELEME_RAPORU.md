# AUDIT-2 — Yeniden İnceleme Raporu
**Tarih:** 2026-07-03
**Kapsam:** `docs/AUDIT_DUZELTME_RAPORU.md` (2026-06-29) "düzeltildi" dediği maddelerin
gerçekten canlıda çözülüp çözülmediğinin doğrulanması + genel "bağlanmamış motor" taraması.
**Yöntem:** Statik kod taraması (`grep`/`node` script) — her bulgu dosya+satır numarasıyla
doğrulanmıştır, varsayıma dayanmaz.

---

## 🔴 BULGU 1 — "İlk 30 Ziyaret Önceliği" KALKMADI (kritik) — ✅ ÇÖZÜLDÜ (2026-07-03)

**Kullanıcı kararı:** "İkisini de kaldır (SON-MASTER kriteri: Top30 tamamen kalksın)"

**Yapılan (`index.html`):**
- İki accordion div'i (`acc_top30visit` → "🏆 İlk 30 Ziyaret Önceliği", `acc_reorder30` →
  "📦 Bu Hafta Siparişe En Yakın 30 Eczane") tamamen kaldırıldı.
- Bunları besleyen PHASE 4.5 / PHASE 4.6.1 render try/catch blokları (`renderPharmacyIntelligenceCard`,
  `renderClassifierTop30Card` çağrıları) kaldırıldı.
- **Dokunulmadı:** `pharmacy-intelligence.js`'teki `buildTop30Pharmacies()` — bu fonksiyon hâlâ
  `autonomous-planning-engine.js`'in veri kaynağı (Bulgu 3 çözülünce devreye girecek).

**Yeni gözlem (bu düzeltmenin yan etkisi):** Render çağrısı kaldırılınca, `reorder-classifier.js`
(`buildClassifierTop30`, `buildReorderClassifierContext`, `classifyAllPharmacies`, `runClassifier`)
dosyasının TÜMÜ artık hiçbir yerden çağrılmıyor — index.html'deki eski yorum "ai-context.js
Phase 4.6.1 bloğunu sil" diyordu ama böyle bir blok ai-context.js'te YOK, bu da zaten stale bir
yorumdu. Yani `reorder-classifier.js` (~700 satır) şu an tamamen ölü kod — script olarak
yükleniyor ama sıfır etkisi var. Silinmedi (ayrı bir karar gerektirir), sadece not düşüldü.

Orijinal analiz (aşağıda referans için korunuyor):

`AUDIT_DUZELTME_RAPORU.md`, Top 30'un "gerçekten kaldırıldığını" iddia ediyor — ama bu sadece
AI Asistan sekmesindeki **5. kopyayı** (`ai-engine.js`'deki `_weeklyPlan`) kaldırdı. **Eczane
sayfasında (Sayfa 2) hâlâ İKİ AYRI, TAM ÇALIŞAN Top-30 kartı yan yana duruyor:**

```html
<!-- index.html:5990-6011 -->
<div class="eczane-accordion" id="acc_top30visit">
  <span class="card-title">🏆 İlk 30 Ziyaret Önceliği</span>   ← BİREBİR bu başlık
  <div id="pharmacyIntelligenceCard"></div>
</div>
<div class="eczane-accordion" id="acc_reorder30">
  <span class="card-title">📦 Bu Hafta Siparişe En Yakın 30 Eczane</span>
  <div id="reorderClassifierCard"></div>
</div>
```

Her ikisi de `index.html:1378-1400`'de aktif olarak render ediliyor:
- `renderPharmacyIntelligenceCard()` ← `pharmacy-intelligence.js` → `buildTop30Pharmacies()`
- `renderClassifierTop30Card()` ← `reorder-classifier.js` → `buildClassifierTop30()`

Ayrıca üçüncü, kullanılmayan bir Top-30 hesaplayıcı daha var:
`pharmacy-data-manager.js` → `buildTop30VisitPriority()` — sadece
`autonomous-planning-engine.js` (bkz. Bulgu 3, tamamen bağlı değil) içinden çağrılıyor,
başka hiçbir UI'da değil.

**Kök neden:** `pharmacy-ranking.js` (FAZ 8.1) dört `buildTop30*` fonksiyonunu "kanonik
sıralama kaynağına" delege etti (hesaplama tek yerden besleniyor) — ama bu SADECE hesaplama
mantığını birleştirdi, **UI kartlarını birleştirmedi**. Dört fonksiyon hâlâ ayrı ayrı var,
ikisi hâlâ ayrı kartlar olarak render ediliyor.

**Önerilen düzeltme:** Eczane sayfasındaki iki accordion'dan birini seçip diğerini kaldırmak
(veya ikisini `pharmacy-ranking.js`'in kanonik kaynağını kullanan TEK bir kart altında
birleştirmek).

---

## 🟡 BULGU 2 — "Son Ziyaret" stok girişine bağlı AMA pratikte hep boş

Kod incelemesi: `index.html:1486` (`_loadFaz121SidecarData`) → `StockEntryAdapter.
getLatestStockEntry()` çağrısı → sonucu `_faz121Cache.stockDateMap` → tabloda "Son Ziyaret"
sütunu (`index.html:1778`, `1851`). **Bağlantının kendisi doğru kurulmuş.**

İki gerçek sorun var:

1. **100 eczane sınırı** (`index.html:1487`): `_eczaneData.slice(0, 100)` — bir TTT'nin
   bölgesinde 100'den fazla eczane varsa, 100'den sonrakiler için "Son Ziyaret" HİÇBİR ZAMAN
   dolmaz, sürekli "—" gösterir. Bu sessiz bir veri kaybı, hata vermiyor.
2. **Veri henüz yok:** Sayısal stok girişi (`🔢 Sayı gir` butonu) yeni eklendi
   (`AUDIT_DUZELTME_RAPORU.md`, 2026-06-29) — temsilciler henüz kullanmadıysa IndexedDB boş,
   dolayısıyla "Son Ziyaret" sütunu şu an herkes için "—" görünüyor. Bu bir kod hatası değil,
   ama kullanıcıya "çalışmıyor" izlenimi veriyor çünkü sütun sessizce boş kalıyor — kullanıcıya
   "henüz veri girilmedi" gibi bir ayırt edici mesaj yok (şu an "—" hem "veri yok" hem "hata"
   anlamına gelebiliyor).

**Önerilen düzeltme:** (a) `slice(0,100)` sınırını kaldırmak veya sayfalama ile artırmak,
(b) "—" yerine "Henüz stok girişi yok" gibi ayırt edici bir metin, (c) STAT bar / özet kartında
kaç eczanenin stok girişi olduğunu göstermek (adoption'ı görünür kılmak için).

---

## 🔴 BULGU 3 — `autonomous-planning-engine.js` (PHASE 5.7, 1024 satır) TAMAMEN BAĞLANMAMIŞ

"AI Saha Komutanı" adıyla yüklenen bu motor `index.html:518`'de script tag'i var, hiç hata
vermeden yükleniyor — ama **public API'sindeki 11 fonksiyondan HİÇBİRİ, kodun HİÇBİR yerinde
çağrılmıyor:**

```
dailyMission · weeklyMission · monthlyMission · generateWeeklyPlan
generateMonthlySprint · optimizeGapClosure · generateActionCards
simulateScenario · getExecutiveSummary · loadSavedDailyPlan · loadSavedWeeklyPlan
```

Diğer "henüz bağlanmadı" motorlarının aksine (örn. `learning-hub.js`, `temporal-context-
engine.js`), bu dosyanın script tag'i yanında **"henüz bağlanmadı" uyarısı YOK** — yani muhtemelen
geliştirici bunu unutmuş, kasıtlı bir bekleme durumu değil. 1024 satırlık, günlük/haftalık/
aylık görev üretimi, senaryo simülasyonu ve yönetici özeti üreten kapsamlı bir motor şu an
kullanıcıya SIFIR değer sağlıyor.

**Bu, "çalışmayan AI" tanımına birebir uyan en büyük bulgu.**

---

## 🟡 BULGU 4 — `data-cache.js` (Phase 2.3.5, 24 saatlik önbellek) TAMAMEN ETKİSİZ

`saveDataCache()` / `loadDataCache()` / `isCacheValid()` / `clearDataCache()` — dördü de
script olarak yükleniyor ama **`data-loader.js`'in `syncData()` fonksiyonu bunları hiç
çağırmıyor.** Sonuç: dosya başlığında vaat edilen "24 saatlik cache — süresi dolmuşsa fresh
fetch" davranışı hiç çalışmıyor, her sayfa açılışında/senkronizasyonda TAM veri GitHub'dan
yeniden çekiliyor. Performans motoru var ama devre dışı — kullanıcı gereksiz yere daha yavaş
yükleme yaşıyor.

**Önerilen düzeltme:** `syncData()` başında `isCacheValid()` kontrolü + `loadDataCache()` ile
kısa devre, sync sonunda `saveDataCache()` çağrısı eklemek (rollback-safe, try/catch ile).

---

## 🟢 Küçük Bulgu 5 — `renderIntelligenceSummary` ölü render fonksiyonu (düşük öncelik)

`intelligence-orchestrator.js`'in eski render fonksiyonu hiçbir yerde çağrılmıyor — AMA bunun
ALTINDAKİ veri motoru (`buildSalesIntelligence` → `AICore.analyze`) `ai-context.js` üzerinden
GERÇEKTEN çalışıyor ve diğer kartları besliyor. Yani "motor" çalışıyor, sadece eski/artık
kullanılmayan bir render sarmalayıcısı kod içinde kalmış. Temizlik amaçlı silinebilir, aciliyeti
yok.

---

## Doğrulanan, SORUN OLMAYAN alanlar (yanlış alarm olabilecekleri kontrol ettim)

- `js/pharmacy/sales-conditions.js` (Satış Şartları sayfası, `_pv*` fonksiyonları) — İLK
  BAKIŞTA "hiç çağrılmıyor" göründü, ama `renderSatisKosullariPanel()` accordion'dan lazy-load
  ile çağrılıyor (`index.html:6015`) ve `_pv*` onclick'leri bu render fonksiyonunun ÜRETTİĞİ
  HTML içinde dinamik olarak oluşuyor. **Çalışıyor**, statik grep'te görünmemesi normal.
- `js/ai/ai-sales-coach-v2.js` (`renderCoachSummaryCard`, `renderScenarioCard`) —
  `index.html:1436-1443`'te aktif çağrılıyor. **Çalışıyor.**
- `js/ai/core/saha-gozlem-store.js` — `index.html`'de saha gözlem formu üzerinden
  `saveObservation`/`getAll`/`deleteObservation` çağrılıyor, ayrıca `sales-memory-engine.js`
  okuyor. **Çalışıyor.**

---

## Genel Yapı Notu — Dokümantasyon Güncelliği

`docs/DEPENDENCY_MAP.md`, projenin çok erken (Phase 1-3) planlama aşamasından kalma ve artık
var olmayan bir dosya yapısını (`js/render/tables.js`, `js/engines/premium-engine.js` vb.)
tasvir ediyor — mevcut 60+ dosyalık AI mimarisini YANSITMIYOR. Bilgi amaçlı: bu dosyayı
güncellemek veya "tarihseldir" notu eklemek faydalı olur, aksi halde yeni birinin oryantasyonu
yanıltabilir.

---

## Öncelik Sıralaması (önerilen)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 3 | autonomous-planning-engine.js bağlı değil | Yüksek (1024 satırlık motor sıfır değer) | Orta-Yüksek (nereye/nasıl bağlanacağına karar gerekir) |
| 1 | Top-30 iki kart | Kullanıcı kafa karışıklığı, "kalkmadı" algısı | Düşük (bir kartı kaldırmak) |
| 4 | data-cache.js bağlı değil | Performans (gereksiz yeniden fetch) | Düşük (2 çağrı eklemek) |
| 2 | Son Ziyaret 100 sınırı + boş veri mesajı | Orta (sessiz veri kaybı hissi) | Düşük |
| 5 | Ölü render fonksiyonu | Kozmetik | Çok düşük |

Hangisiyle başlamamı istersin?
