# FAZ 9.0 — Pharmacy Behavior Engine (9 Davranış Tipi) Raporu

**Tarih:** 2026-06-28  
**Dosya:** `js/ai/core/pharmacy-behavior-engine.js` (FAZ 8.0 iskeleti genişletildi)

---

## 9 Davranış Tipi

| # | Tip | Açıklama | Tespit Kuralı |
|---|---|---|---|
| 1 | `RUTIN_SIPARIS` | Rutin Siparişçi (≈REGULAR_BUYER) | Düşük CV, düzenli alış |
| 2 | `KAMPANYA_ODAKLI` | Kampanya Odaklı (≈CAMPAIGN_BUYER) | Son ay > önceki ort × 3 |
| 3 | `STOKCU` | Stokçu | Aktif oran < %50, yüksek miktar (avg > 50) |
| 4 | `FIRSATCI` | Fırsatçı | Siparişlerin >%70'i CompetitiveAdapter kampanya aylarına denk |
| 5 | `MEVSIMSEL` | Mevsimsel | Belirli takvim aylarında ort > global ort × 1.5, 2+ yıl tekrar |
| 6 | `YENI_MUSTERI` | Yeni Müşteri | activeMonths ≤ 3 |
| 7 | `DUSUK_HACIMLI` | Düşük Hacimli Sürekli Alıcı | avg < 20 kutu, CV < 0.5, aktif > 3 ay |
| 8 | `TEMSILCI_BAGIMLI` | Temsilci Bağımlı | CoverageSelection.getSelection() = true (FAZ 9.2) |
| 9 | `TEMSILCISIZ_DUZENLI` | Temsilcisiz Düzenli | CoverageSelection.getSelection() = false (FAZ 9.2) |

**Özel durumlar:** `BELIRSIZ`, `VERI_YETERSIZ`

---

## Geriye Dönük Uyumluluk (5 Eski Sınıf)

`classification` alanı korunuyor — 9 yeni tipten 5 eski sınıfa eşleme:

| Yeni Tip | Eski Sınıf |
|---|---|
| RUTIN_SIPARIS | REGULAR_BUYER |
| KAMPANYA_ODAKLI, STOKCU, FIRSATCI | CAMPAIGN_BUYER |
| MEVSIMSEL, DUSUK_HACIMLI, TEMSILCI_BAGIMLI, TEMSILCISIZ_DUZENLI | REGULAR_BUYER |
| YENI_MUSTERI | GROWING |
| VERI_YETERSIZ | AT_RISK |
| GROWING / AT_RISK / REACTIVATION | Doğrudan legacy'den (eğer trend baskınsa) |

---

## Public API Değişiklikleri

**Yeni fonksiyon:** `classifyBehavior(r)` → `{ behaviorType, confidence, secondaryType, evidenceFields }`

**Değişmeyen:** `buildBehaviorProfiles(tttFilter)` → `BehaviorProfile[]` (aynı imza)

**Yeni profil alanları** (ek — mevcut alanlar değişmedi):
- `behaviorType` — 9-tip sınıflandırma
- `behaviorConfidence` — sınıflandırma güveni (0-1)
- `secondaryType` — ikincil sınıf (null olabilir)
- `evidenceFields` — hangi metriğin tetiklediği

---

## Veri Yetersizliği Toleransı

- **Mevsimsellik:** < 12 aylık veride kesin karar verilmiyor, `evidenceFields`'a not ekleniyor
- **Temsilci bağımlılığı:** FAZ 9.2 olmadan `BELIRSIZ` döner — hata fırlatmaz
- **Fırsatçı:** CompetitiveAdapter yoksa bu tip atlanır — sessiz fallback

---

## Sonraki Faz

FAZ 9.1 — Sales Memory Engine
