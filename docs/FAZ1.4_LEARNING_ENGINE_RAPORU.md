# FAZ 1.4 — LEARNING ENGINE (PATTERN LEARNING) RAPORU
**Tarih:** 2026-06-17
**Kapsam:** Öğrenme Motoru / Pattern Learning (Master Prompt 03)
**Yöntem:** Eklemeli (additive) geliştirme — mevcut hiçbir dosya davranışı bozulmadı

---

## 1. Özet

| Görev | Durum |
|---|---|
| `js/ai/learning/learning-engine.js` | ✅ Tamamlandı |
| IndexedDB store (`learning_patterns`) | ✅ Tamamlandı (+ fallback bellek-içi dizi) |
| `updateLearningPatterns(outcome)` | ✅ Tamamlandı |
| `createPattern / updatePattern / findMatchingPatterns / getPatterns / getPatternsByProduct / getPatternsByBrick / getBestPatterns / deletePattern` | ✅ Tamamlandı |
| Pattern eşleştirme (duplicate önleme) | ✅ Tamamlandı — deterministik kompozit ID ile yapısal garanti |
| Başarı oranı / güven skoru / pattern eskimesi | ✅ Tamamlandı |
| Otomatik çalışma (yeni outcome oluştuğunda) | ✅ Tamamlandı — `outcome-tracker.js` → `saveOutcome()` içine eklendi |
| AI Context entegrasyonu (`bestPatterns`, `relevantPatterns`, `historicalSuccessRates`, `historicalFailures`, `learningConfidence`) | ✅ Tamamlandı — `ai-context-builder.js` |
| AI Kullanımı (`getPatternInsight`) | ✅ Hazır fonksiyon olarak teslim edildi, henüz hiçbir yere bağlanmadı — bkz. §7 |
| UI değişikliği | ⚠️ Bilinçli olarak yapılmadı (FAZ 1.3'teki gibi gösterilecek ekran yok) — bkz. §8 |
| Pattern örnekleri | ✅ Gerçek IndexedDB ile test edildi — bkz. §6 |
| Test | ✅ Gerçek IndexedDB (fake-indexeddb) ile uçtan uca test edildi — bkz. §6 |

**index.html değişikliği:** 1 yeni `<script>` satırı + açıklayıcı yorum. Başka hiçbir satır değişmedi.

---

## 2. ⚠️ KRİTİK BULGU — İsim Çakışması (çözüldü)

Projede **zaten** `js/ai/learning-engine.js` (Phase 5.4) adlı bir dosya var ve
`window.LearningEngine` global'ini kullanıyor — ama bu motor TAMAMEN FARKLI bir işi
yapıyor: pharmacy-forecast **tahmin doğruluğu** takibi (MAPE/MAE/RMSE, `recordPrediction`,
`evaluatePredictions`, AI Performans Dashboard'u besler).

Master Prompt 03'ün istediği yeni dosya da `learning-engine.js` adında ve aynı şekilde
"Learning Engine" olarak anılıyor — ama amacı bambaşka: **recommendation outcome'larından
pattern öğrenmek**. Eğer bu yeni dosya da `window.LearningEngine` kullansaydı, **mevcut
Phase 5.4 motorunun üzerine yazardı** ve AI Performans Dashboard'u çalışmaz hale gelirdi
(`index.html:841` — `window.LearningEngine.evaluatePredictions()` çağrısı bozulurdu).

**Çözüm:** Yeni dosya `window.PatternLearningEngine` global'ini kullanır. İki dosya da
kendi `js/ai/.../learning-engine.js` dosya adını taşıyor (farklı klasörlerde:
`js/ai/learning-engine.js` vs `js/ai/learning/learning-engine.js`) ama **global isimleri
ayrı**, birbirine dokunmazlar. Bu durum `index.html`'deki yorum bloğunda ve bu raporda
açıkça belgelendi ki ileride biri "LearningEngine"i arayıp yanlış dosyayı bulmasın.

---

## 3. Mimari Kararlar

### 3.1 Ayrı IndexedDB veritabanı

`outcome-tracker.js` (`pharma_ai_outcomes_db`) ile AYNI DB'yi kullanmak yerine, bu modül
kendi veritabanını (`pharma_ai_learning_db` / `learning_patterns`) açar. Sebep: aynı DB'yi
paylaşmak DB_VERSION'ı artırmayı ve `onupgradeneeded` mantığını outcome-tracker.js'te
DEĞİŞTİRMEYİ gerektirirdi — bu, zaten test edilmiş/çalışan bir dosyaya dokunma riski
taşırdı. Ayrı DB, sıfır riskle, tam izolasyon sağlar.

### 3.2 Duplicate önleme — arama yerine deterministik ID

Master Prompt'un "Aynı kriterler eşleşiyorsa aynı pattern güncellensin" kuralı, **arama
yapıp sonra karar vermek** yerine **deterministik bir kompozit ID** ile çözüldü:

```
id = "pat_" + PRODUCT + "_" + RECTYPE + "_" + growthRange + "_" + riskLevel + "_" + trendDirection + "_" + coverageLevel + "_" + scheduleFit
```

Aynı 7 koşul her zaman AYNI id'yi üretir → `store.put(pattern)` otomatik olarak ÜZERİNE
YAZAR. Bu, "Duplicate pattern oluşmasın" kuralını bir "ara-bul-ya da-oluştur" mantığına
değil, **depolama katmanının kendisine** garanti ettirir — yarış durumu (race condition)
riski de ortadan kalkar.

### 3.3 `brick` / `pharmacy` — eşleştirmede kullanılmıyor (şeffaflık notu)

Master Prompt'un "PATTERN EŞLEŞTİRME" bölümü, eşleştirme kriterleri arasında `brick` veya
`pharmacy`'i LİSTELEMİYOR (sadece: product, recommendationType, growthRange, riskLevel,
trendDirection, coverageLevel, scheduleFit). Ancak aynı dokümanın ilham verici örneği
("Panocer + **Tekeköy** + yükselen trend → %84") brick içeriyor — bu iki ifade arasında
bir tutarsızlık var.

**Karar:** Açık teknik liste (eşleştirme kriterleri) esas alındı; `brick`/`pharmacy`
pattern objesinde **bilgilendirme amaçlı** (son görülen örnek) olarak saklanıyor ama
eşleştirmeye DAHİL EDİLMİYOR. Bu, pattern'ların ÜRÜN+KOŞUL bazında GENELLENMESİNİ sağlıyor
(örn. "PANOCER + yükselen trend + düşük risk" tüm bricklerden gelen örnekleri birleştirir)
— ki Master Prompt'un "öğrenme" amacına (genel kural çıkarmak) brick-spesifik
parçalanmadan daha uygun olduğu değerlendirildi. `getPatternsByBrick()` fonksiyonu hâlâ
çalışır (son-görülen-brick üzerinden filtreler) ama bu "hangi pattern'lar şu an o brick'te
örnek vermiş" anlamına gelir, "o brick'e özel pattern" anlamına gelmez.

### 3.4 Koşul (conditions) çıkarımı — mevcut veriden en iyi çaba

| Koşul | Kaynak | Not |
|---|---|---|
| `growthRange`, `trendDirection` | `outcome.baselineGrowth` (FAZ 1.3'ten direkt gelir) | Doğrudan, güvenilir |
| `riskLevel` | `recommendation.contextSnapshot.tlPct` (4 seviyeli yeniden sınıflama) | tlPct yoksa Türkçe 3 seviyeli (`DÜŞÜK/ORTA/YÜKSEK`) string'e geri döner |
| `remainingDaysRange` | `recommendation.contextSnapshot.remainingDays` | Doğrudan |
| `coverageLevel` | **PROXY**: `contextSnapshot.tlPct` | ⚠️ Gerçek bir "kapsam" (pharmacy coverage) metriği şu an `contextSnapshot`'a kaydedilmiyor. tlPct en yakın mevcut proxy. Bkz. §9 öneri. |
| `scheduleFit` | Varsayılan `'today'` | ⚠️ Mevcut sistemde TÜM öneriler `autonomous-planning-engine.js`'in "BUGÜNÜN GÖREVİ" çıktısıdır, yani fiilen hep `'today'`dır. Açık bir `scheduleFit` alanı eklenirse öncelikli kullanılır. |

Bu iki proxy/varsayılan, kodda ve bu raporda açıkça işaretlendi — gelecekte gerçek
veriler eklenince (örn. `contextSnapshot`'a coverage/scheduleFit alanları eklenirse)
fonksiyonlar otomatik olarak onları kullanmaya geçer (`recDetail.scheduleFit ||
rec.scheduleFit || 'today'` gibi öncelik zinciri zaten kurulu).

### 3.5 Confidence vs. Age-Weight — iki ayrı kavram

`confidence` (örnek sayısına dayalı istatistiksel güvenilirlik) ile pattern eskimesi
(zamanla azalan İLGİ/güncellik) BİLEREK AYRI tutuldu:

- `pattern.confidence` → KALICI, sadece `sampleSize` büyüdükçe artar, asla zamanla
  düşmez (geçmiş istatistik geçerliliğini kaybetmez).
- `_effectiveConfidence(pattern)` (okuma anında hesaplanır, `getBestPatterns()` /
  `refreshContextCache()` içinde kullanılır) → `confidence × ageWeight(lastUpdated)`.
  Bu, "pattern'lar zamanla etkisini kaybetmeli" kuralını **sıralama/öncelik** seviyesinde
  uygular, ham istatistiği bozmadan.

---

## 4. Otomatik Tetikleme — `outcome-tracker.js` Değişikliği

`saveOutcome()` fonksiyonu ikiye bölündü:

```diff
- function saveOutcome(outcome) { /* IndexedDB/fallback yazma mantığı */ }
+ function _saveOutcomeRaw(outcome) { /* AYNI IndexedDB/fallback yazma mantığı — değişmedi */ }
+
+ function saveOutcome(outcome) {
+   return _saveOutcomeRaw(outcome).then(function (saved) {
+     if (saved && window.PatternLearningEngine && typeof window.PatternLearningEngine.updateLearningPatterns === 'function') {
+       window.PatternLearningEngine.updateLearningPatterns(saved).catch(function (e) { /* sessiz log */ });
+     }
+     return saved;
+   });
+ }
```

`saveOutcome()`'un **dönüş değeri ve davranışı dışarıdan bakıldığında birebir aynı**
(`_saveOutcomeRaw`'ın çözdüğü değeri olduğu gibi döner) — sadece ek olarak,
`PatternLearningEngine` yüklüyse onu guarded şekilde tetikler. `PatternLearningEngine`
yoksa (örn. dosya silinirse) `saveOutcome()` FAZ 1.3'teki gibi davranır, hiçbir şey
bozulmaz. `evaluateOpenRecommendations()` içindeki tüm çağrılar (toplu değerlendirme
dahil) bu kancadan otomatik geçer — manuel ek kod gerekmedi.

---

## 5. AI Context Entegrasyonu (`ai-context-builder.js`)

FAZ 1.3'teki ile AYNI desen (senkron cache) kullanıldı — IndexedDB asenkron olduğu için
`buildContext()`'in senkron sözleşmesi korunuyor:

```javascript
patterns: {
  bestPatterns:           [...],  // genel en-iyi 10 pattern (sampleSize>=2)
  relevantPatterns:       [...],  // context.product'a özel en-iyi 5 pattern
  historicalSuccessRates: { 'PANOCER': 83.3, ... },  // ürün bazlı ağırlıklı ortalama
  historicalFailures:     [...],  // successRate<40 olan, en güncel 5 pattern
  learningConfidence:     0.55    // tüm pattern'ların ortalama effective confidence'ı
}
```

`relevantPatterns`, `context.product`'a göre otomatik filtrelenir (zaten `buildContext()`
içinde çözülen `product` değişkeni yeniden kullanıldı — ek bir global okuma gerekmedi).
`PatternLearningEngine` yüklenmemişse güvenli varsayılanlar (`null`/`[]`/`{}`) döner.

---

## 6. Test / Doğrulama

`fake-indexeddb` ile **gerçek IndexedDB** üzerinde, 13 ayrı test grubu çalıştırıldı:

| Test | Sonuç |
|---|---|
| `window.LearningEngine` (Phase 5.4) ile çakışma YOK, `window.PatternLearningEngine` ayrı | ✅ |
| İlk outcome → yeni pattern (`sampleSize=1`, doğru `conditions`, doğru `confidence` bandı) | ✅ |
| Aynı koşullar (farklı brick) → AYNI pattern id, `sampleSize=2`, **duplicate oluşmuyor** | ✅ |
| İncremental ortalama (`averageDeltaTL`) doğru hesaplanıyor: (50+80)/2=65 | ✅ |
| Farklı koşullar (farklı ürün/risk/trend) → YENİ, ayrı pattern | ✅ |
| `successRate` formülü: `(successCount + partialCount×0.5)/sampleSize×100` → partial ekleyince 83.3 doğru çıktı | ✅ |
| `confidence` bantları (n=1→düşük, n=3→orta) doğru | ✅ |
| `not_evaluable` outcome → pattern OLUŞMUYOR (öğrenme sinyali yok) | ✅ |
| `getPatternsByProduct` / `getPatternsByBrick` | ✅ |
| `findMatchingPatterns` (kısmi kriter — sadece product+riskLevel) | ✅ |
| `getBestPatterns` (min sampleSize filtresi + sıralama) | ✅ |
| `getCachedSummary(product)` — ürün bazlı `relevantPatterns`, `historicalSuccessRates`, `learningConfidence` | ✅ |
| `getPatternInsight` — "Benzer koşullarda başarı oranı %83.3" doğru metin üretti | ✅ |
| `formatPatternSummary` — `confidenceLabel: 'Orta'` doğru | ✅ |
| `deletePattern` — gerçek silme doğrulandı | ✅ |
| **UÇTAN UCA ZİNCİR:** `evaluateOpenRecommendations()` → `saveOutcome()` → `PatternLearningEngine.updateLearningPatterns()` OTOMATİK çalıştı, doğru pattern oluştu | ✅ |
| `ai-context-builder.js` — `PatternLearningEngine` varken/yokken `patterns` alanı doğru/güvenli | ✅ |
| Proje genelinde tüm `.js` dosyaları sözdizimi kontrolü | ✅ |
| `index.html` script tag bütünlüğü | ✅ |

---

## 7. AI Kullanımı — Neden Henüz Bağlanmadı

Master Prompt: *"AI öneri üretirken ilgili pattern'ları dikkate alsın."*

`getPatternInsight(product, recommendationType, conditions)` fonksiyonu tamamen hazır
ve test edildi (örn. çıktı: *"Benzer koşullarda başarı oranı %83.3 (3 örnek)."*). Ancak
bunu GERÇEKTEN öneri üretimine bağlamak, `recommendation-engine.js` veya
`autonomous-planning-engine.js`'in (mevcut, çalışan, test edilmemiş ortamda dokunulması
riskli) öneri üretim akışını DEĞİŞTİRMEYİ gerektirir — bu, FAZ 0'da Eczane Satış sayfası
ve FAZ 1.3'te UI entegrasyonu için izlenen AYNI temkinli prensiple, bu fazda YAPILMADI.
FAZ 1.5 için somut bir entegrasyon noktası öneriliyor (bkz. §9).

---

## 8. UI Değişikliği — Neden Yapılmadı

FAZ 1.3'teki ile aynı durum geçerli: `RecommendationMemory` kayıtlarını render eden
hiçbir ekran mevcut değil, dolayısıyla "Başarı Oranı / Örnek Sayısı / Güven Seviyesi /
Son Güncelleme Tarihi" gösterilecek bir yer henüz yok. `formatPatternSummary(pattern)`
yardımcı fonksiyonu bu dört alanı tam olarak hazırlayıp döner — ileride bir öneri-detay
ekranı yapıldığında doğrudan kullanılabilir.

---

## 9. Güncellenen / Eklenen Dosyaların Listesi

| Dosya | Değişiklik türü |
|---|---|
| `js/ai/learning/learning-engine.js` | **YENİ** |
| `js/ai/outcomes/outcome-tracker.js` | Güncellendi — `saveOutcome()` ikiye bölündü (`_saveOutcomeRaw` + guarded hook), davranış dışarıdan aynı |
| `js/ai/core/ai-context-builder.js` | Güncellendi — 1 yeni alan (`patterns`, eklemeli) |
| `index.html` | Güncellendi — 1 `<script>` satırı + açıklayıcı yorum |
| `docs/FAZ1.4_LEARNING_ENGINE_RAPORU.md` | **YENİ** (bu rapor) |

Hiçbir dosyada mevcut bir satır SİLİNMEDİ veya fonksiyon imzası DEĞİŞTİRİLMEDİ
(`saveOutcome()` dışarıdan görünen imzası/davranışı birebir aynı kaldı).

---

## 10. Sonraki Adımlar (FAZ 1.5 Önerisi)

- **`getPatternInsight()`'ı gerçekten bağlama:** `autonomous-planning-engine.js`'in
  `mission.visits[]` oluşturduğu noktada, her visit için `getPatternInsight()` çağrılıp
  sonucun `recommendation.recommendation` içine (örn. `patternNote` alanı olarak)
  eklenmesi önerilir — bu, mevcut görsel/davranışsal akışı bozmadan, sadece ek bir
  bilgi alanı katar (gerçek tarayıcı testi sonrası uygulanmalı).
- **`coverageLevel` proxy'sini gerçek veriyle değiştirme:** `pharmacy-intelligence.js`'in
  zaten hesapladığı `visitPriorityScore`/`opportunityScore` metriklerinin
  `recommendation.contextSnapshot`'a (autonomous-planning-engine.js'te
  `_persistVisitRecommendations` içinde) eklenmesi, `coverageLevel`'ın tlPct proxy'si
  yerine gerçek kapsam verisiyle hesaplanmasını sağlar.
- **`scheduleFit` çeşitliliği:** Şu an tüm öneriler `'today'` olduğu için bu boyut
  fiilen sabit — gelecekte "bu hafta planlanan ama bugün değil" gibi öneri türleri
  eklenirse (`this_week`/`outside_plan`), bu zaten kod tarafında desteklenmeye hazır.
- Gerçek tarayıcıda IndexedDB davranışının manuel doğrulanması (FAZ 1.3'teki not
  burada da geçerli).
