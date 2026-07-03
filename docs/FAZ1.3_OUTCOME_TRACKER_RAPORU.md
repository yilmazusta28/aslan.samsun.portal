# FAZ 1.3 — OUTCOME TRACKER RAPORU
**Tarih:** 2026-06-17
**Kapsam:** Öneri Sonuç Takip Motoru (Master Prompt 02)
**Yöntem:** Eklemeli (additive) geliştirme — mevcut hiçbir dosya davranışı bozulmadı

---

## 1. Özet

| Görev | Durum |
|---|---|
| `js/ai/outcomes/outcome-tracker.js` | ✅ Tamamlandı |
| IndexedDB store (`recommendation_outcomes`) | ✅ Tamamlandı (+ fallback bellek-içi dizi) |
| `evaluateRecommendationOutcome(recommendation, previousIMS, currentIMS)` | ✅ Tamamlandı |
| `saveOutcome / getOutcomes / getOutcomeByRecommendationId / getOutcomesByProduct / getOutcomesByBrick / getOutcomesByStatus / deleteOutcome` | ✅ Tamamlandı |
| Otomatik çalışma (yeni IMS yüklendiğinde) | ✅ Tamamlandı — `js/data/data-loader.js` → `syncData()` içine eklendi |
| Recommendation Memory entegrasyonu (`evaluated`, `outcomeId`, `lastEvaluationDate`) | ✅ Tamamlandı — `js/ai/recommendation-memory.js` |
| AI Context entegrasyonu (`recentOutcomes`, `successRate`, `lastSuccessfulActions`, `lastFailedActions`) | ✅ Tamamlandı — `js/ai/core/ai-context-builder.js` |
| UI değişikliği | ⚠️ Bilinçli olarak yapılmadı — bkz. §8 |
| Performans (incremental, tekrar değerlendirmeme, memoizasyon) | ✅ Tamamlandı |
| Test | ✅ Gerçek IndexedDB (fake-indexeddb) ile uçtan uca test edildi — bkz. §9 |

**index.html değişikliği:** 1 yeni `<script>` satırı + manifest notu. Başka hiçbir satır değişmedi.

---

## 2. Önemli Veri-Şeması Tespiti (şeffaflık için)

Master Prompt'taki alan adları (`baselineTL`, `evaluationTL`) "TL" ima ediyor, ancak
gerçek veri yapısı incelendiğinde:

| Veri seti | Gerçek TL alanı var mı? | Granülerlik |
|---|---|---|
| `IMS` (parseIMSCSV çıktısı) | ❌ Hayır — sadece kutu hacmi (`toplam`, `h1..h9`) | ttt + brick + ilac |
| `ECZANE_RAW` (pharmacy-data-manager çıktısı) | ✅ Evet — `tutar` alanı gerçek TL | ttt + brick + eczane + urun + ay |

**Çözüm:** `outcome-tracker.js`, satır şekline bakıp (`tutar` var mı, `toplam` var mı)
otomatik olarak doğru kaynağı seçer (`_aggregateValue()`). IMS-bazlı (brick/temsilci
seviyeli) önerilerde "TL" alanı kutu hacmi proxy'sidir — bu her outcome kaydının
`notes` alanında açıkça belirtilir (örn. *"Değer kaynağı: IMS kutu hacmi (TL alanı
mevcut değil — toplam alanı proxy olarak kullanıldı)"*). Eczane-hedefli önerilerde
gerçek `tutar` (TL) kullanılır.

Ayrıca: `trend-engine.js`, `risk-engine.js`, `insight-engine.js` içinde `r.hafta`,
`r.own_kutu`, `r.own_tl` alanlarına referans var — ancak gerçek `parseIMSCSV()` çıktısında
bu alanlar YOK (gerçek alanlar: `h1..h9`, `toplam`). Bu, bu üç motorun haftalık trend
hesaplamasının şu anda her zaman "yetersiz veri" sonucu döndürdüğü anlamına gelebilir.
**Bu, FAZ 1.3'ün kapsamı DIŞINDA bir bulgu** — outcome-tracker.js bu hataya düşmemek için
KENDİ `h1..h9` tabanlı büyüme hesaplamasını kullanır (bkz. `_aggregateGrowthPct`), bu üç
motora dokunulmadı. Ayrıntılı inceleme ve olası düzeltme önerisi için bkz. §10.

---

## 3. Yeni Dosya: `js/ai/outcomes/outcome-tracker.js`

### 3.1 Mimarisi

```
evaluateOpenRecommendations(currentIMS)          ← syncData() tetikler
  │
  ├─ _loadPreviousIMSSnapshot()  [localStorage'dan önceki IMS hali]
  ├─ RecommendationMemory.getRecommendations().filter(evaluated===false)
  │
  └─ her açık öneri için (memoize edilmiş, aynı ttt+brick+ürün+eczane
     kombinasyonu bir kez hesaplanır):
        │
        evaluateRecommendationOutcome(rec, previousIMS, currentIMS)  ← SAF FONKSİYON
          │
          ├─ _filterRows()        → ttt/brick/ürün/eczane eşleşmesi
          ├─ _aggregateValue()    → tutar (TL) veya toplam (kutu proxy)
          ├─ _aggregateGrowthPct() → h1..h9 (IMS) veya ay (eczane) bazlı erken/geç karşılaştırma
          ├─ status: success | partial | fail | not_evaluable
          └─ confidence: 0.1–1.0
        │
        ├─ status === not_evaluable → KAYDETME, evaluated=false BIRAKILIR (yeniden denenir)
        └─ status ∈ {success,partial,fail} → saveOutcome() [IndexedDB]
                                            → RecommendationMemory.markRecommendationEvaluated()
  │
  └─ _saveCurrentAsSnapshot()  [bir sonraki sync için currentIMS'i sakla]
  └─ refreshContextCache()      [ai-context-builder.js için senkron cache güncelle]
```

### 3.2 Neden IndexedDB + localStorage birlikte kullanıldı?

- **IndexedDB** (`pharma_ai_outcomes_db` / `recommendation_outcomes`): Master Prompt'un
  açıkça istediği, sorgulanabilir (index'li: `recommendationId`, `product`, `brick`,
  `status`, `evaluationDate`) kalıcı depo. Bu, **projedeki ilk IndexedDB kullanımıdır**
  — tarayıcı desteklemiyorsa (örn. bazı tarayıcılarda gizli sekme) bellek-içi diziye
  otomatik düşer, uygulama çökmez.
- **localStorage** (sadece `_loadPreviousIMSSnapshot` / `_saveCurrentAsSnapshot`):
  Uygulama `IMS` dizisini her senkronizasyonda **yerinde değiştiriyor**
  (`IMS.length=0; IMS.push(...)`), yani "önceki" hal hiçbir yerde saklanmıyordu. Bu
  iki fonksiyon, bir önceki senkronizasyondaki IMS halini hafif bir anlık görüntü
  olarak saklayarak `evaluateRecommendationOutcome`'un ihtiyaç duyduğu gerçek bir
  "önce/sonra" karşılaştırması sağlar. Bu, Master Prompt'ta yeni bir IndexedDB store
  istenmediği için (sadece `recommendation_outcomes` istendi) bilinçli bir tasarım
  kararıdır.

### 3.3 NOT_EVALUABLE Davranışı — Önemli Tasarım Kararı

Master Prompt'un "Daha önce evaluated=true olan önerileri tekrar işlememeli" kuralı ile
"İlgili IMS verisi bulunamıyorsa not_evaluable" kuralı arasında bir gerilim var: eğer
`not_evaluable` sonucu da öneriyi `evaluated=true` yapıyorsa, bu özelliğin devreye
alındığı **ilk** senkronizasyonda (henüz önceki snapshot yokken) değerlendirilen TÜM
açık öneriler kalıcı olarak "değerlendirilemedi" durumunda sıkışıp kalır — gerçek veri
sonradan gelse bile bir daha denenmez.

**Çözüm:** `not_evaluable` sonucu ÖZEL olarak ele alınır — IndexedDB'ye YAZILMAZ ve
öneri `evaluated=false` bırakılır, böylece bir SONRAKİ senkronizasyonda (artık gerçek
bir önceki snapshot mevcutken) yeniden denenir. Bu hem veri kirliliğini önler (aynı
öneri için tekrar tekrar "değerlendirilemedi" kaydı oluşmaz) hem de "sıkışma" sorununu
çözer. Bu davranış gerçek IndexedDB ile test edildi (bkz. §9, Test A/B).

---

## 4. Recommendation Memory Entegrasyonu (`js/ai/recommendation-memory.js`)

**Değişiklik 1 — `_buildRecord()`:** Üç yeni alan eklendi, varsayılan değerlerle:
```diff
  outcome     : 'pending',
  outcomeValue: null
+ ,
+ evaluated         : false,
+ outcomeId         : null,
+ lastEvaluationDate: null
```
Mevcut `outcome` / `outcomeValue` alanları **dokunulmadı** — bu ayrı, eski bir takip
mekanizması (muhtemelen manuel/farklı bir akış için), Outcome Tracker'ın
`evaluated`/`outcomeId`/`lastEvaluationDate` alanlarıyla çakışmaz.

**Değişiklik 2 — yeni fonksiyon `markRecommendationEvaluated(id, outcomeId)`:**
`updateRecommendationOutcome()`'dan farklı bir fonksiyon olarak eklendi (o, eski
`outcome`/`outcomeValue` alanlarını günceller; bu, yeni `evaluated`/`outcomeId`/
`lastEvaluationDate` alanlarını günceller). `window.RecommendationMemory` köprü
nesnesine eklendi. **Mevcut hiçbir fonksiyon imzası veya davranışı değişmedi.**

---

## 5. AI Context Entegrasyonu (`js/ai/core/ai-context-builder.js`)

`buildContext()`'in döndürdüğü objeye **yeni bir alan** eklendi:

```javascript
outcomes: {
  recentOutcomes:        [...],  // son 6 ay, en yeni 20 kayıt
  successRate:           66.7,   // % (not_evaluable hariç)
  lastSuccessfulActions: [...],  // son 5 başarılı
  lastFailedActions:     [...]   // son 5 başarısız
}
```

**Senkron/asenkron uyumsuzluğu nasıl çözüldü:** `buildContext()` (ve onu kullanan
`AICore.analyze()`, `intelligence-orchestrator.js`) **senkron** çalışır; ancak
IndexedDB sorguları **asenkron**dur. Bunu çözmek için `outcome-tracker.js` bir senkron
cache tutar (`getCachedSummary()`) — bu cache her `evaluateOpenRecommendations()`
çalıştığında ve sayfa ilk yüklendiğinde (best-effort) arka planda güncellenir.
`buildContext()` bu cache'i okur; `outcome-tracker.js` yüklenmemişse veya cache henüz
hesaplanmamışsa güvenli varsayılanlar (`null`/`[]`) döner — **hiçbir mevcut alan
etkilenmedi, FAZ 0'ın senkron mimarisi bozulmadı.**

---

## 6. Otomatik Tetikleme (`js/data/data-loader.js`)

`syncData()` fonksiyonunda, `IMS` dizisi güncellendiği satırın HEMEN SONRASINA
eklendi:

```javascript
IMS.length = 0;  IMS.push(...newIMS);

// FAZ 1.3: Outcome Tracker — yeni IMS yüklendiğinde açık önerileri değerlendir
if (window.OutcomeTracker && typeof window.OutcomeTracker.evaluateOpenRecommendations === 'function') {
  window.OutcomeTracker.evaluateOpenRecommendations(IMS).catch(function (e) {
    console.warn('[data-loader] OutcomeTracker.evaluateOpenRecommendations hata (sessiz):', e.message);
  });
}
```

Asenkron, fire-and-forget — `syncData()`'nın geri kalan akışını (GENEL dedup, KUTU
yeniden oluşturma, ALL_TTTS güncelleme vb.) **bloklamaz veya etkilemez**.
`OutcomeTracker` yüklenmemişse (typeof kontrolü) hiçbir şey yapılmaz — `syncData()`
eskisi gibi çalışır.

---

## 7. Güncellenen / Eklenen Dosyaların Listesi

| Dosya | Değişiklik türü |
|---|---|
| `js/ai/outcomes/outcome-tracker.js` | **YENİ** |
| `js/ai/recommendation-memory.js` | Güncellendi — 3 yeni alan + 1 yeni fonksiyon (eklemeli) |
| `js/ai/core/ai-context-builder.js` | Güncellendi — 1 yeni alan (`outcomes`, eklemeli) |
| `js/data/data-loader.js` | Güncellendi — `syncData()` içine 1 guarded çağrı bloğu (eklemeli) |
| `index.html` | Güncellendi — 1 `<script>` satırı + manifest notu |
| `docs/FAZ1.3_OUTCOME_TRACKER_RAPORU.md` | **YENİ** (bu rapor) |

Hiçbir dosyada mevcut bir satır SİLİNMEDİ veya fonksiyon imzası DEĞİŞTİRİLMEDİ.

---

## 8. UI Değişikliği — Neden Yapılmadı

Master Prompt: *"Şimdilik yeni ekran oluşturma. Ancak mevcut öneriler için
✓/≈/✕/? durumları gösterilebilsin."*

İnceleme: `RecommendationMemory.getRecommendations()` çıktısını render eden **hiçbir
mevcut ekran bulunamadı** — bu bir "görünmez hafıza katmanı" (index.html'deki kendi
yorumunda da böyle tanımlanıyor: *"Görünmez hafıza katmanı — UI değişmez"*). Yani
şu an gösterilecek bir öneri LİSTESİ ekranı zaten yok; status ikonlarını "ekleyecek"
bir yer henüz mevcut değil.

Buna rağmen, ileride böyle bir ekran yapıldığında hazır olması için
`formatOutcomeStatusIcon(status)` yardımcı fonksiyonu eklendi (`'✓'|'≈'|'✕'|'?'`
döner) — şu an hiçbir yere bağlanmadı, mevcut UI'da hiçbir görsel değişiklik yok.

---

## 9. Test / Doğrulama

FAZ 0'dan farklı olarak bu modül **gerçek bir IndexedDB implementasyonu**
(`fake-indexeddb` npm paketi, Node üzerinde) ile test edildi — sadece mock değil,
gerçek transaction/cursor/index davranışı doğrulandı:

| Test | Sonuç |
|---|---|
| `node --check` (4 değişen/yeni dosya, classic + ES module) | ✅ |
| `evaluateRecommendationOutcome` — previousIMS boş → `not_evaluable` | ✅ |
| `evaluateRecommendationOutcome` — gerçek senaryo (100→150 kutu) → `success`, `deltaTL=50` | ✅ |
| `saveOutcome` + `getOutcomes` (gerçek IndexedDB round-trip) | ✅ |
| `getOutcomeByRecommendationId` / `getOutcomesByProduct` / `getOutcomesByBrick` / `getOutcomesByStatus` | ✅ |
| `deleteOutcome` (gerçek silme doğrulandı) | ✅ |
| **Test A** — İlk sync (snapshot yok) → `not_evaluable`, DB'ye yazılmıyor, `evaluated=false` kalıyor | ✅ |
| **Test B** — İkinci sync (snapshot artık var) → gerçek değerlendirme, `success`, kayıt oluşuyor | ✅ |
| `evaluateOpenRecommendations` — daha önce `evaluated=true` olanlar tekrar işlenmiyor | ✅ |
| `evaluateOpenRecommendations` — memoizasyon (aynı kombinasyon, tek hesap) | ✅ |
| `getCachedSummary()` — `successRate`, `lastSuccessfulActions` doğru hesaplanıyor | ✅ |
| `formatOutcomeStatusIcon` — 4 durum da doğru ikon döndürüyor | ✅ |
| `recommendation-memory.js` (gerçek dosya, mock değil) — `saveRecommendation` varsayılanları, `markRecommendationEvaluated`, mevcut `outcome`/`outcomeValue` alanlarının bozulmadığı | ✅ |
| `ai-context-builder.js` — `OutcomeTracker` varken/yokken `outcomes` alanı doğru/güvenli | ✅ |
| Proje genelinde tüm `.js` dosyaları sözdizimi kontrolü | ✅ |
| `index.html` script tag bütünlüğü (referans edilen tüm yerel dosyalar diskte var) | ✅ |

---

## 10. Sonraki Adımlar (FAZ 1.4 / FAZ 2 Önerisi)

- **Veri şeması uyarısı (öncelikli):** `trend-engine.js`, `risk-engine.js`,
  `insight-engine.js`'deki `r.hafta` / `r.own_kutu` / `r.own_tl` referanslarının
  gerçek `parseIMSCSV()` çıktısıyla (`h1..h9`, `toplam`) eşleşmediği doğrulanmalı ve
  gerekiyorsa düzeltilmeli — bu, FAZ 1.3 kapsamı dışında bırakıldı (mevcut
  fonksiyonelliği bozma riski taşıdığından, sadece bu rapor aracılığıyla
  bildirilmektedir).
- Eczane (pharmacy) hedefli önerilerin değerlendirilmesi için `evaluateOpenRecommendations()`'a
  `ECZANE_RAW` tabanlı bir ikinci tetikleme eklenebilir (şu an sadece IMS tetikliyor —
  Master Prompt'un literal "Yeni IMS yüklendiğinde" ifadesiyle sınırlı tutuldu).
- Gerçek tarayıcıda IndexedDB davranışının (özellikle Safari/iOS gizli sekme
  kısıtlamaları) manuel doğrulanması — `fake-indexeddb` testi büyük ölçüde güven verir
  ama gerçek tarayıcı motorlarıyla %100 özdeş değildir.
- Önerileri listeleyen bir ekran yapıldığında `formatOutcomeStatusIcon()` kolayca
  bağlanabilir.
