# FAZ 10.1 — Decision Engine Eczane Seviyesine Genişletme Raporu

## Eklenen: `PHARMACY_VISIT` problemType

`decision-engine.js` (FAZ 6.7) genişletildi. Mevcut 5 problemType değiştirilmedi.

### Yeni Dal: `_generatePharmacyAlternatives(twins[])`

`decide()` içinde `PHARMACY_VISIT` algılandığında `_generateAlternatives()` yerine bu fonksiyon çağrılır.

Girdi: `DigitalTwin[]` (FAZ 9.4 DigitalTwinBuilder.getDigitalTwin() çıktısı)  
Tip belirleme mantığı:
- `STOCK_ALERT`: `lastKnownStock === 0`
- `VISIT_NOW`: `orderDiscipline >= 0.65` AND sipariş tarihi 30 gün içinde
- `WAIT`: diğer durumlar

### Çıktı Şeması (DEĞİŞMEDİ)

```js
{
  recommendation: {
    type: 'VISIT_NOW' | 'WAIT' | 'STOCK_ALERT',  // yeni değerler
    target: 'Eczane Adı',                          // brick değil eczane
    action: string,
    priority: 'HIGH'|'MEDIUM'|'LOW'
  },
  confidence: number,   // 0-80 (CONFIDENCE_CEILING korundu)
  expectedTL: null,     // eczane-seviyesinde scenario-builder bağlantısı yok
  risk: {...},          // detectRisks() hâlâ kullanılıyor
  alternatives: [...],
  decisionBasis: {...}  // opportunityTop.brick → eczane adı
}
```

### Yeniden Kullanılan Adımlar

| Adım | Fonksiyon | Değişti mi? |
|------|-----------|-------------|
| 2    | `_scoreSuccess(alt, ttt)` | HAYIR — alt.scores null, base=50 fallback çalışır |
| 3    | `_scoreRisk(alt, ttt)` | HAYIR — competitive check null-safe |
| 4    | `_estimateTLImpact(alt, ttt)` | HAYIR — bilinmeyen tip → null döner |
| 5    | `_selectBest(scored)` | HAYIR — ağırlıklı skor aynı |

### Çağrı Örnekleri

```js
// Mevcut (brick bazlı) — değişmedi:
DecisionEngine.decide('temsilci1');
DecisionEngine.decide('temsilci1', 'RESCUE');

// Yeni (eczane bazlı):
DecisionEngine.decide('temsilci1', 'PHARMACY_VISIT');  // otomatik twin listesi (top 15)
DecisionEngine.decide('temsilci1', 'PHARMACY_VISIT', { twins: [twin1, twin2] });  // manuel twin listesi
```

## Değiştirilen Dosyalar
- `js/ai/decision/decision-engine.js` — `_generatePharmacyAlternatives()`, `_dateStr30Days()`, `_pharmacyReason()`, `decide()` signature, `_buildActionSentence()` PHARMACY_VISIT tipleri, version `1.0` → `1.1`
