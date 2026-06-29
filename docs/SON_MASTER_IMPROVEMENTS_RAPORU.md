# SON-MASTER PRODUCT ARCHITECTURE — Uygulama Raporu

## Gap Analizi

| Kriter | Önceki Durum | Sonraki Durum |
|--------|-------------|---------------|
| Motor otomatik çalışır | ❌ Manuel "Motoru Çalıştır" | ✅ Otomatik: login + TTT seçimi |
| Prim Puanı görünür | ❌ Sadece motor çıktısında | ✅ Hero meta'da her zaman |
| Günlük Hedef TL görünür | ❌ Sadece motor çıktısında | ✅ Hero meta'da her zaman |
| Günün En Kritik 3 Aksiyonu | ❌ Yok | ✅ Motor çıktısının başında |
| AI Koç kartı yeri | ❌ Page6'dan page5 DOM'una | ✅ Motor core'dan doğrudan |
| Tekrar eden coach render | ❌ renderEczaneContent() içinde | ✅ Kaldırıldı |

## Yapılan Değişiklikler

### `index.html`

**Hero meta (page5):**
- Eklendi: `emv_daily` (Günlük Hedef TL) meta item
- Eklendi: `emv_prim` (Prim Puanı) meta item
- Toplam hero meta: 7 item (önceki: 5)

**engineOutput (page5):**
- Eklendi: `<div id="gunun3AksiyonCard"></div>` — motor output'un en üstünde

**goPage(5):**
- Eklendi: `window._engineAutoRan` kontrolü — data yüklü ve TTT seçili ise motor otomatik çalışır

**renderEczaneContent() (page6):**
- Kaldırıldı: `renderCoachSummaryCard()` / `renderScenarioCard()` çağrıları
- Bu çağrılar `_runEngineCore()` içine taşındı (doğru yer: Sayfa 1 = AI Analiz Merkezi)

### `js/ai/ai-engine.js`

**renderEngine():**
- `emv_daily` = kalan TL ÷ kalan iş günü (ön değer, motor çalışmadan da görünür)
- `emv_prim` = `gt.prim_pct` (ön değer)

**_runEngineCore():**
- `emv_daily` ve `emv_prim` tam hesaplanan değerlerle güncellenir
- `gunun3AksiyonCard` render edilir:
  1. İlk ziyaret eczanesi (weekly plan'dan)
  2. Risk brick (critBricks[0])
  3. Fırsat brick (oppBricks[0]) veya günlük hedef fallback
- Sales Coach V2 (`renderCoachSummaryCard` / `renderScenarioCard`) burada çağrılır

**setAiTTT():**
- `_engineAutoRan = false` reset → yeni TTT seçiminde motor yeniden çalışır
- Motor otomatik tetiklenir (data yüklü ise)

## Kabul Kriterleri Kontrol

| Kriter | Durum |
|--------|-------|
| AI tek merkezden karar üretir | ✅ Tüm AI çıktıları page5'te |
| Top 30 kaldırıldı | ✅ (FAZ 12.0'da yapıldı) |
| Günlük öneri maks 5 eczane | ✅ (FAZ 12.0'da yapıldı) |
| AI doğal Türkçe konuşur | ✅ buildDailyNarrative() |
| Explainable AI | ✅ (FAZ 11.1'de yapıldı) |
| Confidence Score | ✅ (FAZ 11.0'da yapıldı) |
| Outcome Learning | ✅ (FAZ 11.2'de yapıldı) |
| Rol Bazlı Arayüz | ✅ (FAZ 12.3'te yapıldı) |
| Mobil uyumluluk | ✅ (FAZ 12.4'te yapıldı) |
