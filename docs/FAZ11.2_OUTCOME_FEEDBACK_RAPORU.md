# FAZ 11.2 — Gün Sonu Outcome Feedback (Manuel) Raporu

## Yeni API: `OutcomeTracker.recordManualFeedback(visitContext, feedbackType)`

```js
visitContext: { eczane, brick, ttt, product? }
feedbackType: 'UYGULANDIM' | 'SIPARIS_ALINDI' | 'SIPARIS_ALINAMADI' | 'ZIYARET_GERCEKLESMEDI'
```

### Ne Yapar

1. Var olan outcome kaydını `eczane + tarih` eşleşmesiyle arar
2. Bulursa: `manualFeedback: { type, recordedAt }` alanını **ekler** — `status` DOKUNULMAZ (arşiv olarak kalır)
3. Bulamazsa: minimal kayıt oluşturur (`status: null`, `manualFeedback` dolu)
4. `PatternLearningEngine.updateLearningPatterns()` çağrır — **effectiveStatus = manualFeedback.type → status eşlemesi**
5. `PharmacyBehaviorEngine.clearCache()` çağrır (FAZ 11.2 Learning Loop)

### Manuel Feedback → Status Eşlemesi

| feedbackType | effectiveStatus (PatternLearning'e) |
|---|---|
| UYGULANDIM | success |
| SIPARIS_ALINDI | success |
| SIPARIS_ALINAMADI | fail |
| ZIYARET_GERCEKLESMEDI | not_evaluable (öğrenme sinyali taşımaz) |

### Çakışma Kuralı

`learning-engine.js`'te `_effectiveStatus(outcome)` yardımcı fonksiyonu eklendi:
- `manualFeedback.type` varsa → `_MANUAL_TO_STATUS` tablosundan eşle → **bu değeri kullan**
- Yoksa → mevcut `outcome.status`'u kullan (eski davranış korundu)

`createPattern()` ve `updatePattern()` her ikisi de artık `_effectiveStatus(outcome)` kullanıyor.

## UI: `renderManualFeedbackButtons(visitContext)` — FAZ 11.2

`js/ui/explainable-ai.js`'e eklendi. Dört buton üretir:
- ✓ Uygulandı → yeşil
- ✓ Sipariş alındı → mavi
- ✗ Sipariş alınamadı → amber
- ✗ Ziyaret yapılmadı → kırmızı

Tıklandığında `OutcomeTracker.recordManualFeedback()` çağrılır ve buton disabled/renkli olur.

### Bağlantı Noktaları

1. **`renderAIDecisionCard()`** (index.html) — decision card'ın altına 4 buton eklendi
2. **`renderTodayRouteCard()`** (route-optimizer.js) — "Neden?" hücresinin altına 4 buton eklendi

## Learning Loop Doğrulaması

Zincir analizi:
```
Yeni IMS verisi
  → IMS global değişkeni güncellenir (mevcut davranış)
  → (varsa yeni sipariş verisi)
  → FAZ 9.3: StockEntryAdapter.saveStockEntry() → IndexedDB
  → FAZ 11.2: OutcomeTracker.recordManualFeedback() → IndexedDB
      ↓
      PatternLearningEngine.updateLearningPatterns(enriched) → öğrenme güncellendi
      PharmacyBehaviorEngine.clearCache()                    ← YENİ EKLEME
      ↓
  → Bir sonraki buildBehaviorProfiles() çağrısı → YENİDEN hesaplar
```

**Sonuç:** PharmacyBehaviorEngine sadece `syncData()` / `buildBehaviorProfiles()` çağrısında hesaplıyor — outcome sonrası OTOMATIK tetiklenmiyor. Bu tasarım doğru: cache geçersiz kılındığında bir sonraki çağrı taze sonuç üretir. `clearCache()` ile invalidate edildi ✓.

## Değiştirilen Dosyalar

- `js/ai/outcomes/outcome-tracker.js` — `recordManualFeedback()` eklendi, export edildi
- `js/ai/learning/learning-engine.js` — `_effectiveStatus()`, `_MANUAL_TO_STATUS` eklendi; `createPattern()` + `updatePattern()` güncellendi
- `js/ui/explainable-ai.js` — `renderManualFeedbackButtons()` eklendi, export edildi
- `index.html` — `renderAIDecisionCard()`'a feedback butonları eklendi
- `js/route/route-optimizer.js` — route satırlarına feedback butonları eklendi
