# FAZ 11.1 — Explainable AI "Neden?" Butonu Raporu

## Yeni Dosya: `js/ui/explainable-ai.js`

### Public API

```js
// decisionBasis → Türkçe cümle dizisi (ham JSON yok)
ExplainableAI.buildDecisionBasisText(decisionBasis, neden?) → string[]

// <details> HTML string — tıklanınca açılır panel
ExplainableAI.renderNedenButton(decisionBasis, neden?) → HTML string

// Bare global (template literal içinde):
renderNedenButton(decisionBasis, neden?)
```

### Açıklama Mantığı

`buildDecisionBasisText()` şu alanları Türkçe cümleye çevirir:

| Alan | Türkçe Çıktı |
|------|--------------|
| `neden` (FAZ 10.3) | "📍 Ziyaret nedeni: Sipariş zamanı (3 gün)" |
| `opportunityTop.brick` | "🎯 En yüksek fırsat bölgesi: Kadıköy (skor: 84)" |
| `learningSignal` | "📚 Geçmiş öğrenme başarısı: %72" |
| `outcomeSignal` | "📊 Kayıtlı sonuç başarısı: %65" |
| `competitiveFlag: true` | "⚠️ Bu bölgede aktif rakip kampanyası tespit edildi" |
| `temporalContext` | "📅 Dönemin 6. haftası · 2 hafta kaldı · IMS verisi: ..." |

Ham JSON hiçbir zaman gösterilmez.

### Panel Tasarımı

`<details>/<summary>` native HTML ile açılır/kapanır — ek JavaScript gerektirmez. Ana ekranda sadece "❓ Neden?" butonu görünür; tıklanınca açıklama paneli açılır.

## Bağlantı Noktaları

### 1. `index.html::renderAIDecisionCard()` (FAZ 10.1)
Decision card'ın altına `renderNedenButton(d.decisionBasis)` eklendi.

### 2. `js/route/route-optimizer.js::renderTodayRouteCard()` (FAZ 10.3)
Tabloya "Neden?" sütunu eklendi; her satırda `renderNedenButton(null, p.neden)` çağrılır. `p.neden` alanı FAZ 10.3'te zaten her eczane için set edilmişti ("Sipariş zamanı (3 gün)" vb.).

## Değiştirilen Dosyalar

- `js/ui/explainable-ai.js` — YENİ
- `index.html` — script tag eklendi, `renderAIDecisionCard()` güncellendi
- `js/route/route-optimizer.js` — "Neden?" sütunu + hücre eklendi
