# FAZ 11.0 — AI Confidence Meter Raporu

## Yeni Dosya: `js/ui/confidence-meter.js`

### Fonksiyon

```js
renderConfidenceMeter(score) → HTML string
```

`score`: 0-100 integer/float. Çıktı: inline progress-bar + renkli badge.

Renk eşikleri:
| Aralık | Renk |
|--------|------|
| 0-39   | Kırmızı `#DC2626` |
| 40-69  | Amber `#D97706` |
| 70-100 | Yeşil `#16A34A` |

### Global Erişim

```js
// Namespace üzerinden:
window.ConfidenceMeter.renderConfidenceMeter(80)

// Bare global (template literal içinde kullanım için):
window.renderConfidenceMeter(80)
```

Her iki yol da aynı fonksiyonu çağırır. Guard pattern: eğer yüklenmediyse çağıran taraf fallback'e düşer.

## Bağlantı Noktaları (Wired Locations)

### 1. `index.html::renderAIDecisionCard()` (FAZ 10.1 decision çıktısı)

**Önceki (inline):**
```html
<div style="font-size:18px;font-weight:800;color:#7C3AED">%${d.confidence}</div>
<div style="font-size:9px;color:var(--dim)">güven</div>
```

**Sonraki (standardized):**
```js
${typeof renderConfidenceMeter === 'function'
  ? renderConfidenceMeter(d.confidence)
  : '<span ...>%' + d.confidence + '</span>'}
```

Kaynak: `window.DecisionEngine.decide(ttt).confidence` (max %80 tavanlı).

### 2. `js/route/route-optimizer.js::renderTodayRouteCard()` (FAZ 10.3 günlük liste)

`_probBar(p.reorderProbability)` yerine `window.renderConfidenceMeter(p.reorderProbability)` — fallback: `_probBar` (mevcut helper, silinmedi).

Kaynak: `reorderProbability` (reorder-classifier çıktısı, 0-100).

### 3. `js/ai/ai-engine.js::_runEngineCore()` (AI Asistan sekmesi haftalık eczane planı)

`%${e.reorderProbability}` span'ı yerine `window.renderConfidenceMeter(e.reorderProbability)` — fallback: eski `span` (guard ile).

Kaynak: `reorderProbability` (buildClassifierTop30 / PHARMACY_INTELLIGENCE çıktısı).

## Yeni Confidence Hesabı YOK

Bu faz mevcut confidence değerleri (decision-engine %80 cap, reorder-classifier %0-100) için YENİ bir hesaplama yazmadı — sadece sunum katmanını standardize etti.

## Değiştirilen Dosyalar

- `js/ui/confidence-meter.js` — YENİ
- `index.html` — script tag eklendi, `renderAIDecisionCard()` güncellendi
- `js/route/route-optimizer.js` — `_probBar` yerine `renderConfidenceMeter` (fallback korundu)
- `js/ai/ai-engine.js` — haftalık plan `reorderProbability` gösterimi güncellendi
