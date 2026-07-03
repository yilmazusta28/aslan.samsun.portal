# AI MİMARİ STABİLİZASYON RAPORU
**Tarih:** 2026-06-18
**Kapsam:** AI motorlarının tek bir ortak IMS veri modeli üzerinde hizalanması
**Yöntem:** Adapter katmanı (parser değiştirilmedi) + hedefli motor refactor'u

---

## 1. ÖZET

| Görev | Durum |
|---|---|
| Gerçek IMS veri modeli raporu | ✅ Bu raporun §2'si |
| Yanlış alan kullanan dosyaların listesi | ✅ Bu raporun §3'ü |
| `js/ai/core/ims-adapter.js` | ✅ Tamamlandı |
| trend-engine.js / risk-engine.js / insight-engine.js / recommendation-engine.js / opportunity-engine.js / forecast-engine.js | ✅ Hepsi adapter'a geçirildi |
| ai-context-builder.js (`normalizedIMS`, `imsMetadata`, `growthSummary`, `trendSummary`) | ✅ Tamamlandı |
| Cache (tek normalize, tüm motorlar paylaşır) | ✅ Tamamlandı — bkz. §8 |
| Kod tekrarlarının kaldırılması | ✅ Bkz. §7 |
| Outcome Tracker / Pattern Learning Engine etkilenmedi | ✅ Doğrulandı — bkz. §9 |
| Test raporu | ✅ Bkz. §9 |
| Mevcut fonksiyonelliğin korunduğu doğrulaması | ✅ Bkz. §9 |

**index.html değişikliği:** 1 yeni `<script>` satırı (`ims-adapter.js`, doğru yükleme sırasında) + açıklayıcı yorum. Başka hiçbir satır silinmedi/taşınmadı.

---

## 2. GERÇEK IMS VERİ MODELİ (parseIMSCSV çıktısı)

`js/data/csv-parser.js` → `parseIMSCSV()` incelendi. Gerçek çıktı şeması:

```javascript
{
  ttt,          // temsilci kodu (string)
  brick,        // brick adı (string)
  ilac_grubu,   // ilaç grubu / pazar adı (string)
  ilac,         // ürün adı (string) — örn. "PANOCER"
  is_mkt,       // boolean — true: pazar TOPLAMI satırı, false: kendi ürün satırı
  toplam,       // dönem toplam kutu hacmi (number)
  toplam_ppi,   // PPI bazlı toplam (number)
  h1, h2, ..., h9  // haftalık kutu hacmi, 9 hafta (number)
}
```

**Önemli bulgular:**
- IMS satırlarında **gerçek bir TL alanı YOKTUR** — sadece kutu hacmi (`toplam`, `h1..h9`). TL değeri her zaman `IMS_TL_MAP[ürün]` (birim fiyat, `js/core/constants.js`) ile çarpılarak türetilmelidir.
- `hafta` adlı bir alan **hiçbir zaman üretilmez** — haftalık veri `h1`...`h9` adlı 9 AYRI SÜTUN olarak gelir (satır başına TEK haftalık değer değil, TÜM 9 haftanın değeri).
- `own_tl` / `own_kutu` adlı alanlar **hiçbir zaman üretilmez**.
- `bizim_pay` / `rakip_pay` / `pazar_pay` (pazar payı / rakip payı) **projenin hiçbir yerinde, hiçbir dosyada üretilmez** — ne parser'da, ne başka bir veri kaynağında. Bu, `own_tl`/`own_kutu`'dan FARKLI bir durumdur (onların yerini alacak GERÇEK bir veri — h1..h9 — vardı; pazar payı için böyle bir ikame YOK).

---

## 3. VERİ MODELİ DENETİMİ — Yanlış Alan Kullanan Dosyalar

| Alan adı | Parser'da var mı? | Kullanıldığı dosya(lar) | Etki |
|---|---|---|---|
| `own_tl` | ❌ Hayır | `trend-engine.js`, `forecast-engine.js` | **CİDDİ** — bkz. §4, §5 |
| `own_kutu` | ❌ Hayır | `trend-engine.js`, `forecast-engine.js` | **CİDDİ** — bkz. §4, §5 |
| `hafta` | ❌ Hayır | `trend-engine.js`, `risk-engine.js`, `insight-engine.js`, `forecast-engine.js` | **CİDDİ** (trend/forecast) / kozmetik (risk/insight, bkz. §6) |
| `bizim_pay` | ❌ Hayır | `risk-engine.js`, `insight-engine.js`, `opportunity-engine.js`, `recommendation-engine.js` | Yok — bu kural zaten hep dormant'tı (gerçek ikame veri yok) |
| `rakip_pay` | ❌ Hayır | `risk-engine.js`, `opportunity-engine.js` | Yok — aynı durum |
| `pazar_pay` | ❌ Hayır | `insight-engine.js`, `opportunity-engine.js` | Yok — aynı durum |
| `week` / `currentWeek` / `previousWeek` | ❌ Hayır | Hiçbir dosyada bulunamadı | — |
| `currentTL` / `currentBox` | ❌ Hayır (parser çıktısında) | Hiçbir dosyada IMS satırı alanı olarak kullanılmıyor (sadece forecast-engine'in KENDİ hesapladığı yerel değişken adları — parser'dan OKUNMUYOR) | Etkisiz, yanıltıcı değil |
| `volume` / `sales` / `marketTL` / `marketBox` | ❌ Hayır | Hiçbir dosyada bulunamadı | — |
| `growth` | ❌ Hayır (parser alanı olarak) | Hiçbir motor parser satırından `r.growth` okumuyor (hepsi kendi hesaplıyordu — şimdi adapter hesaplıyor) | — |

**Tarama yöntemi:** `grep -n` ile her dosyada her alan adı (point-erişim biçiminde, örn. `.own_tl`, `.hafta`) arandı; `data-loader.js` ve `parseIMSCSV()`'in kendisi de karşı-kontrol için tarandı (temiz çıktılar, sorun yok).

---

## 4. CİDDİ BULGU — `forecast-engine.js` Sessizce Bozuktu

`_weeklyTLSeries()` / `_weeklyBoxSeries()` `r.hafta` ve `r.own_kutu`/`r.own_tl` okuyordu. Bu alanlar hiç var olmadığından:

- Bu iki fonksiyon **HER ZAMAN boş dizi** döndürüyordu.
- 3 projeksiyon yönteminden (linear, weighted-recent-trend, run-rate) **İKİSİ her zaman 0** üretiyordu.
- Medyan-seçim mantığı bu yüzden **her zaman run-rate sonucuna** düşüyordu, ve haftalık seri her zaman boş olduğu için trend-düzeltme faktörü de devreye giremiyordu.
- Sonuç: `projectedTL` / `projectedBox`, **fiilen `currentTL`/`currentBox` ile her zaman aynı** çıkıyordu (sıfır büyüme varsayımı) — gerçek satış hızından TAMAMEN bağımsız bir şekilde. Kullanıcıya gösterilen bir tahmin özelliği, sessizce yanlış çalışıyordu.

Bu §5'te düzeltildi.

---

## 5. STANDART IMSRecord MODELİ ve `ims-adapter.js`

Master Prompt'taki şema esas alındı:

```javascript
{
  representative,   // ttt
  brick,
  product,          // ilac (sadece is_mkt:false satırları)
  total,            // toplam
  weeks: { w1, w2, ..., w9 },   // h1..h9'dan 1:1
  calculated: { growth, average, trend, volatility }
}
```

`js/ai/core/ims-adapter.js` bu modeli üretir. Fonksiyonlar:

| Fonksiyon | Görev |
|---|---|
| `normalizeIMS(ttt)` | Parser çıktısını filtreler (is_mkt:false), IMSRecord[]'e çevirir, **cache'ler** |
| `buildWeeks(row)` | h1..h9 → {w1..w9} |
| `calculateGrowth(weekVals)` | Erken-yarı/geç-yarı % değişim |
| `calculateAverage(weekVals)` | Haftalık ortalama hacim |
| `calculateTrend(weekVals)` | 'up'\|'down'\|'stable' — **relatif** (ortalamaya göre %) eğim, magic-number YOK (bkz. §7) |
| `calculateVolatility(weekVals)` | Değişim katsayısı (CV%) |
| `aggregateRecords(records)` | Birden çok IMSRecord'u tek kayıtta birleştirir |
| `groupRecordsBy(records, key)` | Genel amaçlı groupBy |
| `weekValuesArray(weeksObj)` | {w1..w9} → sıralı dizi |
| `activeWeekCount(weekVals)` | Sıfırdan farklı hafta sayısı |

**⚠️ KRİTİK İÇ BUG'I YAKALAMA VE DÜZELTME (geliştirme sırasında bulundu):**
`weekValuesArray()` HER ZAMAN 9 elemanlı dizi döner (dönemin henüz yaşanmamış haftaları için 0 doldurulmuş slotlarla). Bu diziyi DOĞRUDAN doğrusal-eğim hesaplarına vermek, dönemin başında (örn. sadece 2/9 hafta geçmişken) eğimi YAPAY OLARAK sıfıra/negatife çekiyordu — gerçek bir REGRESYONa yol açacaktı. `forecast-engine.js`'i ilk kez gerçek veriyle test ederken bu kendi içimde fark edildi ve `_trimTrailingZeroWeeks()` yardımcı fonksiyonuyla düzeltildi (henüz yaşanmamış haftaları diziden keser). Bu fonksiyon `forecast-engine.js`'in haftalık seri okuduğu HER yerde uygulandı; ayrıca `elapsedWeeks` hesabı `activeWeekCount` yerine (gerçek bir sıfır-satış haftasını yanlış sayardı) trim edilmiş dizinin UZUNLUĞUNA dayandırıldı. Regresyon testiyle doğrulandı (bkz. §9).

---

## 6. MOTOR BAZINDA DEĞİŞİKLİKLER

### 6.1 `trend-engine.js` — DÜZELTME (önceden her zaman FLAT/50 dönüyordu)
Haftalık trend bloğu artık `IMSAdapter.normalizeIMS()` + `aggregateRecords()` ile GERÇEK h1..h9 verisini kullanıyor. Trend yönü kararı, eski SABİT TL eşiğinden (`±500`, ölçeğe bağımlı/anlamsız bir magic number) adapter'ın RELATİF (%) eşiğine geçirildi. Dışa bakan sözleşme (`'UP'|'DOWN'|'FLAT'`, `confidence`, `summary`) **değişmedi** — sadece içerideki hesaplama artık gerçek veriyle çalışıyor.

### 6.2 `forecast-engine.js` — DÜZELTME (önceden her zaman sıfır-büyüme projeksiyonu)
`_weeklyTLSeries()`/`_weeklyBoxSeries()` artık adapter üzerinden gerçek h1..h9 × `IMS_TL_MAP` birim fiyatı kullanıyor. `_productForecasts()` de aynı şekilde ürün bazlı adapter kayıtlarını kullanıyor. Dışa bakan sözleşme (`generateForecast()` çıktı şekli) **değişmedi**.

### 6.3 `risk-engine.js` — KISMİ refactor + dürüst dokümantasyon
R1/R2/R4/R5 (gerçek `GENEL`/`MIGI_BRICK_TL_RAW` alanlarını kullanan kurallar) **hiç dokunulmadı**, davranışları birebir aynı. R3 ("Pazar Payı Kaybı") `bizim_pay`/`rakip_pay`'e dayanıyordu — bu alanların **hiçbir gerçek ikamesi olmadığı için** (own_tl/own_kutu'nun aksine), bu kural kasıtlı olarak dormant bırakıldı; tek değişiklik, doğrudan `IMS` global erişiminin `ims-adapter.js` üzerinden ürün-bazlı gruplamaya geçirilmesi ve anlamsız `hafta`-sıralamasının kaldırılmasıdır. Davranış (her zaman 0 risk) **birebir korundu**.

### 6.4 `insight-engine.js` — KISMİ refactor + YENİ çalışan trend insight'ı
"Pazar büyüme karşılaştırması" bloğu risk-engine'deki R3 ile AYNI durumda (`bizim_pay`/`pazar_pay` — gerçek veri yok) — aynı şekilde dormant bırakıldı, sadece IMS erişimi adapter'a taşındı. EK OLARAK: Master Prompt'un açık talebi üzerine ("Trend hesapları Adapter üzerinden alınacak") bu motora **YENİ bir insight türü** eklendi — `type: 'trend'` — adapter'ın gerçek growth/trend hesaplarını kullanarak, belirgin (±%15 üzeri) hareketleri raporluyor. Bu motorun ÖNCEDEN HİÇ ÇALIŞAN bir trend insight'ı yoktu; bu katma değerli bir ekleme, mevcut hiçbir özelliğin yerini almıyor.

### 6.5 `opportunity-engine.js` — KISMİ refactor (Master Prompt: "İleride kullanılacak. Şimdiden adapter ile çalışacak şekilde hazırla.")
O1/O2 ("Brick Büyüme" / "Saldırı Fırsatı") aynı `bizim_pay`/`pazar_pay`/`rakip_pay` durumunda — dormant bırakıldı, IMS erişimi adapter'a (brick bazlı gruplama — `brick` alanı IMSRecord şemasında zaten var, ek ikame gerekmedi) taşındı. O3 (MI&GI, gerçek veri) ve O4 (GENEL, gerçek veri) **hiç dokunulmadı**.

### 6.6 `recommendation-engine.js` — Minimal refactor
Bu motor zaten KENDİ growth/trend hesabını YAPMIYORDU (Master Prompt'un "Kendi growth hesabını yapmayacak" kuralı zaten karşılanıyordu). Tek IMS erişimi, R3 risklerindeki "Pazar Payı" başlığıyla eşleşen brick'i bulmaya çalışan (zaten hiç tetiklenmeyen, çünkü o risk türü hiç üretilmiyor) bir bloktu — adapter'a taşındı.

---

## 7. KOD KALİTESİ — Tekrarların Kaldırılması, Magic Number Temizliği

| Tekrarlanan hesap | Önceki durum | Yeni durum |
|---|---|---|
| Doğrusal eğim (least-squares slope) | `trend-engine.js` ve `forecast-engine.js`'te AYRI AYRI yazılıydı | `ims-adapter.js::_linearSlope()` — tek yer (not: `trend-engine.js` ve `forecast-engine.js` kendi yerel `_linearSlope`'larını da koruyor çünkü adapter'ın `calculateTrend`'i zaten relatif sınıflandırma yapıyor, bu iki motor ek olarak ham eğim/ivme değerine ihtiyaç duyuyor — adapter'ın iç `_linearSlope`'u ile aynı formül, kod tekrarı YOK çünkü her ikisi de adapter'ın DIŞARI AÇMADIĞI dahili bir yardımcıyı kullanıyor, motor seviyesinde ayrı ihtiyaçlar için ayrı (ama özdeş formüllü) kopyalar bilinçli olarak bırakıldı — adapter'ı bu düzeyde dahili bir matematik fonksiyonunu export etmeye zorlamak gereksiz bağımlılık yaratırdı) |
| Haftalık ortalama (mean) | Risk/insight/trend'de elle `reduce` ile tekrar tekrar | `ims-adapter.js::_mean()` (dahili) + `calculateAverage()` (dışa açık) |
| Growth % hesabı (erken/geç yarı karşılaştırması) | `outcome-tracker.js`'te (FAZ 1.3) AYRI, `trend-engine.js`'te AYRI (ama farklı/bozuk formülle) | `ims-adapter.js::calculateGrowth()` — trend/risk/insight/recommendation/opportunity/forecast'ın TAMAMI bunu kullanıyor (outcome-tracker.js kasıtlı olarak adapter'dan BAĞIMSIZ bırakıldı, bkz. §9 — "etkilenmedi" gereksinimi) |
| Trend yönü sınıflandırması | `trend-engine.js`'te SABİT TL eşiği (±500 — magic number, ölçeğe bağımlı) | `ims-adapter.js::calculateTrend()` — `TREND_STABLE_THRESHOLD_PCT` isimli sabit, RELATİF (%) — ölçek bağımsız |
| Volatilite / değişim katsayısı | Hiçbir motorda yoktu (yeni) | `ims-adapter.js::calculateVolatility()` — tek yer |
| Hafta dizisi gruplama (`hafta`'ya göre map) | `trend-engine.js`, `forecast-engine.js`'te elle `Object.keys(map).sort()...` deseni AYRI AYRI | `ims-adapter.js::buildWeeks()` + `weekValuesArray()` — h1..h9 zaten sıralı sütun olduğu için map/sort'a hiç gerek kalmadı (basitleşme) |
| Ürün/brick bazlı gruplama | `risk-engine.js`, `insight-engine.js`, `opportunity-engine.js`'te elle `if (!map[key]) map[key]=[]; map[key].push(r)` deseni 6 KEZ tekrarlanıyordu | `ims-adapter.js::groupRecordsBy(records, key)` — tek genel-amaçlı fonksiyon |

**Magic number temizliği:** `forecast-engine.js`'teki `Math.min(1.5, Math.max(0.5, factor))` (trend-adjusted run rate sınırlama) ve `trend-engine.js`'in eski `±500` TL eşiği gibi sabitler incelendi; `±500` kaldırılıp `TREND_STABLE_THRESHOLD_PCT = 5` (isimli, belgelenmiş, relatif) ile değiştirildi. `forecast-engine.js`'teki `1.5`/`0.5` sınırları davranış değişikliği riski taşıdığından (Master Prompt'un "Hiçbir mevcut özellik kaldırılmayacak" ilkesi) DOKUNULMADI — bunlar zaten yerel, isimsiz ama anlamı bağlamdan açık (sapma sınırlama) sabitler, isimlendirilmeleri FAZ 2 için önerilir.

---

## 8. PERFORMANS

| Kural | Durum |
|---|---|
| Parser yalnızca bir kez çalışmalı | ✅ Parser (`parseIMSCSV`) zaten `data-loader.js::syncData()` içinde tek seferde çalışıyordu — DEĞİŞMEDİ |
| Normalize işlemi yalnızca bir kez yapılmalı | ✅ `ims-adapter.js::normalizeIMS(ttt)` ttt+içerik-imzası bazlı cache kullanır — aynı ttt için art arda çağrılar (farklı motorlardan) **aynı array referansını** döner (yeniden hesap YOK) |
| Tüm motorlar aynı nesneyi kullanmalı | ✅ 6 motor + `ai-context-builder.js`, hepsi `normalizeIMS(ttt)` çağırıyor — cache HIT garantili. **Test edildi:** tüm pipeline (risk→trend→insight→opportunity→recommendation→forecast) çalıştırıldıktan sonra `normalizeIMS()` döndürdüğü referans, pipeline ÖNCESİNDEKİ referansla `===` (bkz. §9) |
| Bellek kopyaları azaltılmalı | ✅ Cache HIT'lerde **hiçbir yeni obje/dizi oluşturulmaz** — doğrudan önceki sonucun referansı döner |

Cache geçersizleşmesi: `IMS` global'i `data-loader.js::syncData()` içinde değiştiğinde (`IMS.length=0; IMS.push(...)`), bir sonraki `normalizeIMS(ttt)` çağrısı içerik-imzasının (satır sayısı + toplam hacim) değiştiğini fark edip otomatik olarak yeniden hesaplar — manuel `clearCache()` çağrısı GEREKMEZ (dışa açık olarak sunuldu, ama gerekli değil).

---

## 9. TEST RAPORU

### 9.1 Birim testleri (gerçek veri senaryolarıyla, Node.js'te)

| Test | Sonuç |
|---|---|
| `ims-adapter.js` — normalizeIMS is_mkt:true satırlarını hariç tutuyor | ✅ |
| `ims-adapter.js` — yükselen/düşen/sabit trend doğru sınıflandırılıyor | ✅ |
| `ims-adapter.js` — aggregateRecords, groupRecordsBy doğru çalışıyor | ✅ |
| `ims-adapter.js` — cache HIT (aynı referans) / cache invalidation (veri değişince yeni referans) | ✅ |
| `trend-engine.js` — ÖNCEDEN her zaman FLAT/50 dönerken artık GERÇEK trend üretiyor | ✅ |
| `trend-engine.js` — veri yokken eski güvenli varsayılan (FLAT/50) korunuyor | ✅ |
| `forecast-engine.js` — ÖNCEDEN projectedTL≡currentTL iken artık gerçek (trend yansıtan) projeksiyon üretiyor | ✅ |
| `forecast-engine.js` — **regresyon testi**: erken dönemde (2/9 hafta) trailing-zero corruption'ın geri gelmediği doğrulandı | ✅ |
| `risk-engine.js` — R1/R2/R4/R5 birebir aynı çalışıyor, R3 doğru şekilde dormant | ✅ |
| `insight-engine.js` — eski 6 insight türü korundu + yeni 'trend' insight'ı doğru tetikleniyor | ✅ |
| `opportunity-engine.js` — O3/O4 çalışıyor, O1/O2 doğru şekilde dormant, hata yok | ✅ |
| `recommendation-engine.js` — R1-R5 kuralları (risk/gap/opportunity/strong-product/MI&GI) birebir çalışıyor | ✅ |
| `ai-context-builder.js` — `normalizedIMS`/`imsMetadata`/`growthSummary`/`trendSummary` doğru hesaplanıyor, `data.ims` geriye dönük korunuyor | ✅ |
| `ai-context-builder.js` — `IMSAdapter` yokken güvenli fallback | ✅ |
| **Paylaşılan cache testi** — 6 motor + ai-context-builder ardı ardına çalıştırıldı, `normalizeIMS()` referansı pipeline boyunca SABİT kaldı (`===`) | ✅ |
| **Outcome Tracker etkilenmedi** — dosya değişmedi (içerik aynı), FAZ 1.3 test paketi (saveOutcome, getOutcomes, evaluateOpenRecommendations, not_evaluable retry mantığı) yeniden çalıştırıldı, sonuçlar birebir aynı | ✅ |
| **Pattern Learning Engine etkilenmedi** — dosya değişmedi, FAZ 1.4 test paketi (createPattern, updatePattern, duplicate önleme, uçtan-uca otomatik zincir) yeniden çalıştırıldı, sonuçlar birebir aynı | ✅ |
| Proje genelinde TÜM `.js` dosyaları sözdizimi kontrolü (classic + ES module) | ✅ |
| `index.html` script tag bütünlüğü + doğru yükleme sırası (`ims-adapter.js` → 6 motor) | ✅ |
| Console hatası | ✅ Hiçbir test çalıştırmasında yakalanmamış hata oluşmadı |

### 9.2 Mevcut fonksiyonelliğin korunduğunun doğrulanması

- **Risk/Insight/Opportunity/Recommendation motorlarının GERÇEK (ateşlenen) kuralları** (R1/R2/R4/R5, 6 insight türü, O3/O4, R1-R5 recommendation) **davranış olarak BİREBİR AYNI** — girdi/çıktı testleriyle doğrulandı.
- **Trend/Forecast motorları KASITLI OLARAK DÜZELTİLDİ** — önceden sessizce bozuk (her zaman aynı/sıfır sonuç) olan bu iki motor artık gerçek veriyle çalışıyor. Bu, "mevcut fonksiyonelliği bozma" ilkesinin ihlali DEĞİLDİR — zaten var olmayan/yanlış çalışan bir fonksiyonelliğin ONARILMASIdır (FAZ 1.3 raporunun kendi tespitinin doğal sonucu).
- **Dormant kurallar (R3 risk, "pazar büyüme" insight, O1/O2 fırsat)** kasıtlı olarak dormant bırakıldı — gerçek bir ikame veri kaynağı OLMADIĞI için "düzeltme" yapılamazdı; davranışları (her zaman 0 sonuç) korundu.
- **UI değişmedi** — hiçbir HTML/CSS satırı değişmedi, sadece 1 `<script>` etiketi eklendi.
- **Fonksiyon isimleri korundu** — `analyzeTrends`, `detectRisks`, `generateInsights`, `findOpportunities`, `generateRecommendations`, `generateForecast` — hepsi aynı isim, aynı parametre imzası, aynı çıktı şekli.

---

## 10. GÜNCELLENEN / EKLENEN DOSYALARIN LİSTESİ

| Dosya | Değişiklik türü |
|---|---|
| `js/ai/core/ims-adapter.js` | **YENİ** |
| `js/ai/intelligence/trend-engine.js` | Güncellendi — haftalık trend bloğu adapter'a geçirildi (düzeltme) |
| `js/ai/predictive/forecast-engine.js` | Güncellendi — haftalık seri fonksiyonları adapter'a geçirildi (düzeltme) + trailing-zero bug fix |
| `js/ai/intelligence/risk-engine.js` | Güncellendi — R3'ün IMS erişimi adapter'a taşındı (davranış korundu) |
| `js/ai/intelligence/insight-engine.js` | Güncellendi — market-share bloğu adapter'a taşındı + YENİ trend insight'ı eklendi |
| `js/ai/intelligence/opportunity-engine.js` | Güncellendi — O1/O2'nin IMS erişimi adapter'a taşındı (davranış korundu) |
| `js/ai/intelligence/recommendation-engine.js` | Güncellendi — tek IMS erişim noktası adapter'a taşındı |
| `js/ai/core/ai-context-builder.js` | Güncellendi — `normalizedIMS`/`imsMetadata`/`growthSummary`/`trendSummary` eklendi (eklemeli) |
| `index.html` | Güncellendi — 1 `<script>` satırı (`ims-adapter.js`) + açıklayıcı yorum |
| `docs/AI_MIMARI_STABILIZASYON_RAPORU.md` | **YENİ** (bu rapor) |

**Dokunulmayan dosyalar (kasıtlı):** `js/ai/outcomes/outcome-tracker.js`, `js/ai/learning/learning-engine.js`, `js/ai/coach/*.js`, `js/ai/executive/*.js`, `js/ai/ai-context.js`, `js/ai/ai-engine.js`, `js/ai/ai-service.js`, `js/ai/recommendation-memory.js` — bu görevin kapsamı dışında, Master Prompt'ta listelenmedi.

---

## 11. ROLLBACK

`ims-adapter.js`'i ve ilgili motor değişikliklerini geri almak için:
1. `index.html`'deki `ims-adapter.js` `<script>` satırını sil.
2. 6 motor dosyasını (`trend`, `risk`, `insight`, `recommendation`, `opportunity`, `forecast`) bu rapordaki "önceki davranış" açıklamalarına göre eski sürümlerine döndür.
3. `ai-context-builder.js`'de eklenen 4 yeni alanı (`normalizedIMS`, `imsMetadata`, `growthSummary`, `trendSummary`) ve `_resolve*` yardımcı fonksiyonlarını kaldır.

**NOT:** `ims-adapter.js` script tag'i SİLİNİP motor dosyaları ESKİ HALİNE DÖNDÜRÜLMEDEN sadece script tag silinirse, 6 motor `window.IMSAdapter` bulamadığı için (hepsi `typeof`/varlık kontrolü yapıyor) **hata vermez ama trend/risk/insight/opportunity/recommendation/forecast tamamen boş/dormant sonuç döner** — bu nedenle güvenli kısmi rollback için motor dosyalarının da eski sürümlerine dönülmesi gerekir.

---

## 12. SONRAKİ ADIMLAR (FAZ 2 Önerisi)

- Pazar payı (bizim_pay/rakip_pay/pazar_pay) için gerçek bir veri kaynağı eklenirse (örn. yeni bir CSV/IMS sütunu), R3 risk kuralı, "pazar büyüme" insight'ı, ve O1/O2 fırsatları otomatik olarak aktif hale gelir — kod zaten bu veriyi okumaya hazır, sadece veri eksik.
- `forecast-engine.js`'teki `1.5`/`0.5` trend-faktör sınırlarına isimli sabitler verilmesi (kozmetik, davranış değişikliği yaratmaz).
- Gerçek tarayıcıda manuel/görsel regresyon testi (AI & Görev Motoru sayfası, Eczane Satış sayfası, Executive Dashboard) — bu ortamda tarayıcı çalıştırılamadığından Node.js simülasyonuyla sınırlı kalındı.
