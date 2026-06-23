# FAZ 6.7 — Decision Engine: Uygulama Kılavuzu

**Tarih:** 2026-06-23  
**Durum:** Kod üretildi — aşağıdaki 3 adım uygulandıktan sonra aktif olur.

---

## Üretilen Dosya

```
js/ai/decision/decision-engine.js   ← YENİ (bu dosya)
```

Başka hiçbir mevcut dosya değiştirilmiyor.

---

## Adım 1 — Dosyayı projeye ekle

`js/ai/decision/decision-engine.js` dosyasını projenin aynı klasörüne koy:

```
js/ai/decision/
├── competitive-impact-engine.js   (FAZ 6.6 — mevcut)
├── opportunity-score-engine.js    (FAZ 6.5 — mevcut)
└── decision-engine.js             ← YENİ
```

---

## Adım 2 — index.html'e script etiketi ekle

`index.html`'de aşağıdaki satırı bul:

```html
<script src="js/ai/decision/opportunity-score-engine.js"></script>
<!-- END FAZ 6.5 Opportunity Score Engine -->
```

Hemen ALTINA ekle:

```html
<!-- FAZ 6.7: Decision Engine (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §9, §16)
     Sistem artık sadece ANALİZ değil, KARAR üretir. Alternatif aksiyon
     seçenekleri oluşturur; başarı olasılığı / risk / TL etkisi üzerinden
     puanlar; en uygun alternatifi seçer.
     Problem tipleri: BRICK_PRIORITY, PRODUCT_FOCUS, DEFENSE, RECOVERY, GROWTH.
     Bağımlılıklar: opportunity-score-engine.js + competitive-impact-engine.js
     (opsiyonel — yoksa sessizce devreye girmez); risk-engine, forecast-engine,
     scenario-builder, learning-hub (hepsi opsiyonel).
     AIContextBuilder.context.decision alanını doldurur (önceden null'dı).
     Rollback: bu satırı silmek hiçbir şeyi KIRMAZ — AIContextBuilder
     eksik durumda null'a güvenli düşer. -->
<script src="js/ai/decision/decision-engine.js"></script>
<!-- END FAZ 6.7 Decision Engine -->
```

> **Yükleme sırası kuralı:**  
> `opportunity-score-engine.js` → `decision-engine.js` → `territory-engine.js` (mevcut sıra korunuyor)

---

## Adım 3 — ai-context-builder.js'de decision alanını bağla

`js/ai/core/ai-context-builder.js`'de şu satırı bul (≈ satır 401):

```javascript
      decision: null,
```

Şununla değiştir:

```javascript
      // FAZ 6.7 — Decision Engine bağlantısı.
      // DecisionEngine yoksa null'a güvenli düşer — geriye dönük uyumlu.
      decision: _safe(function () {
        if (!window.DecisionEngine) return null;
        return window.DecisionEngine.getDecisionContext({ ttt: ttt });
      }, null),
```

Ve aynı dosyanın en altındaki `console.debug` satırında versiyon notunu güncelle:

**Bul:**
```
'[ai-context-builder] FAZ 0 + FAZ 1.3 (outcomes) + FAZ 1.4 (patterns) + AI Mimari Stabilizasyonu (normalizedIMS) + FAZ 6.3 v2 (learning/coverage/planning/forecast/recommendationHistory) + FAZ 6.5 (opportunity/8-bileşen) yüklendi.'
```

**Değiştir:**
```
'[ai-context-builder] FAZ 0 + FAZ 1.3 (outcomes) + FAZ 1.4 (patterns) + AI Mimari Stabilizasyonu (normalizedIMS) + FAZ 6.3 v2 (learning/coverage/planning/forecast/recommendationHistory) + FAZ 6.5 (opportunity/8-bileşen) + FAZ 6.7 (decision) yüklendi.'
```

---

## API Özeti

```javascript
// Tek karar tipi
var record = window.DecisionEngine.decide(context, 'BRICK_PRIORITY');
// record → {
//   recommendation: { title, detail, rationale, urgency },
//   confidence: 82,          // 0-95
//   expectedTL: 47500,       // null = hesaplanamadı
//   risk: { level: 'LOW', topRisk: null },
//   alternatives: [...]      // puanlı tüm seçenekler
// }

// Tüm problem tipleri tek geçişte
var batch = window.DecisionEngine.decideBatch(context);
// batch → { BRICK_PRIORITY: ..., PRODUCT_FOCUS: ..., DEFENSE: ..., ... }

// AI prompt için özet (AIContextBuilder bunu zaten çağırır)
var dc = window.DecisionEngine.getDecisionContext(context);
// dc → { primaryDecision: {...}, defenseAlert: {...}, availableDecisions: [...] }
```

### Problem tipleri

| Tip | Soru |
|-----|------|
| `BRICK_PRIORITY` | Hangi brick'e öncelik verilmeli? (varsayılan) |
| `PRODUCT_FOCUS` | Hangi ürüne odaklanılmalı? |
| `DEFENSE` | Rakip saldırısına karşı ne yapılmalı? |
| `RECOVERY` | Düşen bölgede nasıl toparlanılır? |
| `GROWTH` | Büyüme fırsatı nerede? |

---

## Rollback

Bu fazı geri almak için:
1. `index.html`'den `decision-engine.js` script etiketini sil.
2. `ai-context-builder.js`'de `decision: null` satırını geri yükle.
3. `js/ai/decision/decision-engine.js` dosyasını sil.

Başka hiçbir dosya değişmediği için hiçbir şey kırılmaz.

---

## Sıradaki Faz

**FAZ 6.8 — Team Learning**  
En başarılı temsilci davranışını öğren → diğerlerine öner.  
Bağımlılık: FAZ 6.2 (LearningHub) — hazır.

---

## Notlar

- `confidence` skoru hiçbir zaman **%95'i geçmez** — sistem kesinlik iddia etmez.
- TL etkisi `analyzeProductImpact` / `analyzeBrickImpact` motorlarından gelir; bu motorlar yoksa `null` döner (hata değil).
- `DEFENSE` tipi sadece `CompetitiveImpactEngine` aktif ve rakip kampanyası tespit edilmişse anlamlı alternatifler üretir; yoksa boş döner.
- Tüm bağımlılıklar opsiyonel — `typeof` ile kontrol edilir, eksikse nötr değer (50) kullanılır.
