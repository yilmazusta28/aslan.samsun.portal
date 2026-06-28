# FAZ 8.1 — Tek Kanonik Sıralama Raporu

**Tarih:** 2026-06-28  
**Kapsam:** Dört buildTop30* fonksiyonunu tek kanonik sıralama kaynağına bağlama

---

## Dört Fonksiyonun Skor Formülü Karşılaştırması

| Fonksiyon | Girdi Kaynağı | Sıralama Kriteri | Çıktı Şeması |
|---|---|---|---|
| `pharmacy-intelligence.js::buildTop30Pharmacies` | `buildPharmacyProfiles()` → PharmacyBehaviorEngine | `visitPriorityScore` | `{rank, eczane, visitPriorityScore, opportunityScore, ...}` |
| `reorder-engine.js::buildTop30Reorder` | `analyzePharmacyHistory()` → PharmacyBehaviorEngine | `score` | `{rank, eczane, score, momentum, avgBoxes, ...}` |
| `reorder-classifier.js::buildClassifierTop30` | `classifyAllPharmacies()` → PharmacyBehaviorEngine | `score` | `{rank, eczane, score, nextOrderProducts, daysToNextOrder, ...}` |
| `pharmacy-data-manager.js::buildTop30VisitPriority` | `buildReorderPredictionScores()` | `visitPriorityScore = reorderScore × brickPriority × growthPotential` | `{eczane, visitPriorityScore, brickPriority, growthPotential, ...}` |

---

## Kanonik Fonksiyon: `rankPharmacies(ttt)`

**Dosya:** `js/ai/core/pharmacy-ranking.js`  
**Global:** `window.PharmacyRanking.rankPharmacies(tttFilter)` → `RankedRecord[]`

### Ağırlıklandırma (4 bileşen × %25):

| Bileşen | Kaynak | Normalize | Ağırlık |
|---|---|---|---|
| `momentumScore` | `growthRate` | `(growthRate + 100) / 2` → [0,100] | %25 |
| `consistencyScore` | `activeMonths / totalMonths` | oran × 100 → [0,100] | %25 |
| `opportunityScore` | `reorderProbability` | prob × 100 → [0,100] | %25 |
| `urgencyScore` | `daysToNextOrder` | `max(0, 100 - days*100/60)` → [0,100] | %25 |

`canonicalScore = round(momentumScore×0.25 + consistencyScore×0.25 + opportunityScore×0.25 + urgencyScore×0.25)`

---

## Wrapper Değişikliği — Her Fonksiyon %100 Kanonik Kaynağa Delege

Her bir `buildTop30*` fonksiyonu başına aşağıdaki desen eklendi:

```js
if (window.PharmacyRanking && typeof window.PharmacyRanking.rankPharmacies === 'function') {
  var ranked = window.PharmacyRanking.rankPharmacies(tttFilter);
  // kendi eski şemasına map'le
  return ...;
}
// legacy fallback (değişmedi)
```

**Hiçbir çağıran kod değişmedi** — her fonksiyonun public API'si (imza + dönüş alanları) aynı kaldı.

---

## Örnek 5 Eczane — Eski/Yeni Skor Karşılaştırması

*Not: Gerçek veri yüklendiğinde karşılaştırma yapılabilir. Kanonik skor 4 bileşeni dengeler; eski `visitPriorityScore` sadece reorder + brick gap iken yeni skor tutarlılık ve aciliyet de ekler. Farkın büyüklüğü veri setine bağlıdır.*

---

## index.html Yükleme Sırası

```
pharmacy-adapter.js    ← FAZ 6.0 (girdi kaynağı)
pharmacy-ranking.js    ← FAZ 8.1 (kanonik sıralama — YENİ)
pharmacy-behavior-engine.js ← FAZ 8.0/6.1 (profile builder)
pharmacy-intelligence.js    ← wrapper (artık rankPharmacies delege eder)
pharmacy-data-manager.js    ← wrapper
reorder-engine.js           ← wrapper
reorder-classifier.js       ← wrapper
```

---

## Sonraki Faz

FAZ 8.2 — Yönetici Sekmesi Durum Tespiti
