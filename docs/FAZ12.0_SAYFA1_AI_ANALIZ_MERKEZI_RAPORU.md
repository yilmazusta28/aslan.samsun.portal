# FAZ 12.0 — Sayfa 1: AI Analiz Merkezi Raporu

## Yapılan Değişiklikler

### 1. Top30 UI Kartları Kaldırıldı

`enginePharmacyTop30` ve `engineReorderTop30` div'leri index.html'den kaldırıldı.
Altındaki motorlar (FAZ 8.1 kanonik sıralama) **SİLİNMEDİ** — sadece bu eski UI placeholder'ları kaldırıldı (zaten boştular, render fonksiyonu yoktu).

### 2. "Günün Öncelikli Eczaneleri" Kartı

`gunununOncelikliEczaneleriCard` div eklendi. `_runEngineCore()` her çalıştığında `_renderGununEczaneleri(container, ttt)` fonksiyonu bu div'i doldurur.

**Her eczane satırında:**
- Sıra numarası (1-5)
- Eczane adı + brick
- Kademe badge (1-5 — FAZ 10.3 `tier` alanı)
- `buildDailyNarrative()` ile tek paragraflık Türkçe özet
- FAZ 11.0 Confidence Meter (`reorderProbability`)
- FAZ 11.1 "Neden?" butonu (`neden` alanı)
- FAZ 11.2 Manuel feedback 4 buton

### 3. `buildDailyNarrative(eczane, twin, decision)` — YENİ (`coach-engine.js`)

```js
buildDailyNarrative('Akdeniz Eczanesi', twin, decision) →
"Kadıköy bölgesindeki Akdeniz Eczanesi bugünün öncelikli eczanesidir.
 Profil: düzenli alıcı. Tahmini 12 kutu stok kalmış (2026-07-05 dolayında
 sipariş bekleniyor). Tahmini sipariş: 8 kutu. Başarı olasılığı: %75."
```

Girdi null olsa bile her alan güvenli: sadece mevcut alanlar cümleye dahil edilir.
Mevcut coach mesaj fonksiyonları (`buildSalesCoach`, `formatCoachForAI`, `renderCoachSummary`) **DEĞİŞMEDİ**.

### 4. Single AI Principle Denetimi

Görünür motor isimleri bulundu ve değiştirildi:

| Eski | Yeni | Konum |
|------|------|-------|
| "Auto Strategy Engine" | "AI Analiz Merkezi" | engine-badge (snav5 hero) |
| "Decision Engine" | "AI Öneri" | acc_ai_decision_badge |

Teknik isimler (fonksiyon/değişken adları) değiştirilmedi — sadece kullanıcıya görünen metin.

## Değiştirilen Dosyalar

- `index.html` — Top30 divleri kaldırıldı, `gunununOncelikliEczaneleriCard` eklendi, Single AI Principle düzeltmeleri
- `js/ai/ai-engine.js` — `_renderGununEczaneleri()` fonksiyonu eklendi, `_runEngineCore()` sonu güncellendi
- `js/ai/coach/coach-engine.js` — `buildDailyNarrative()` eklendi, export edildi
