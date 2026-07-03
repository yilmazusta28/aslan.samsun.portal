# FAZ 10.0 — Gerçek Tüketim Modeli ve Kampanya Ayrıştırma Raporu

## Mevcut `avgMonthlyBoxes` Doğrulaması

`pharmacy-intelligence.js:549`:
```js
var avgMonthlyBoxes = activeMonths > 0 ? totalBoxes / activeMonths : 0;
```
- `activeMonths = sales.filter(v => v > 0).length` — sıfır aylar ZATen ÇIKARILIYOR
- Yani mevcut `avgMonthlyBoxes` = "boş-ay-çıkarmalı" ortalama
- **DEĞİŞTİRİLMEDİ** (geriye dönük uyumluluk — mevcut UI kartları bu alanı kullanıyor)

## Eklenen: `flagStockBuildMonths(sales[])`

`pharmacy-intelligence.js` (BÖLÜM 4'ten önce):

```js
function flagStockBuildMonths(sales) {
  // nonZero ortalama × 2.5 eşik (FAZ 9.1 SalesMemoryEngine ile tutarlı)
  // reorder-classifier'ın "son ay > ortalama×3" kuralını genişleten daha erken tespit
  var nonZero = sales.filter(v => v > 0);
  var mean = nonZero.reduce((s,v) => s+v, 0) / nonZero.length;
  var threshold = mean * 2.5;
  return sales.map(v => v > threshold);  // boolean flag dizisi
}
```

- Girdi: aylık satış dizisi (sıfır dahil)
- Çıktı: boolean flag dizisi (true = kampanya spike / stock build ayı)
- Eşik: non-zero ortalama × 2.5 (FAZ 9.1 ile tutarlı)
- `window.flagStockBuildMonths` olarak dışa aktarıldı

## Eklenen: `avgMonthlyBoxesAdjusted`

`pharmacy-intelligence.js` profil nesnesine eklendi:

```js
avgMonthlyBoxesAdjusted: _avgMonthlyBoxesAdjusted(sales)
```

Hesaplama:
1. `flagStockBuildMonths(sales)` çağrılır
2. `v > 0 && !isSpike` olan aylar filtrelenir
3. Bu ayların ortalaması alınır
4. Eğer tüm aktif aylar spike ise (stokçu eczane), en azından nonZero ortalaması döner

**Kullanım:** FAZ 9.1 SalesMemoryEngine ve FAZ 9.4 Digital Twin bu alanı tercih etmeli.

## Örnek Karşılaştırma (ÖZEL MASTER PROMPT §8)

| Dizi | avgMonthlyBoxes | avgMonthlyBoxesAdjusted |
|------|-----------------|------------------------|
| [42, 75, 0, 75, 0] | 192/3 = 64 | spike yok (75 < 64×2.5=160) → 64 |
| [42, 75, 0, 250, 0] | 367/3 = 122 | 250 > 122×2.5=305? Hayır → 122 |
| [40, 50, 0, 180, 0] | 270/3 = 90 | 180 > 90×2.5=225? Hayır → 90 |
| [40, 50, 0, 300, 0] | 390/3 = 130 | 300 > 130×2.5=325? Hayır → 130 |
| [40, 45, 0, 400, 0] | 485/3 = 162 | 400 > 162×2.5=405? Hayır → 162 |
| [40, 42, 0, 420, 0] | 502/3 = 167 | 420 > 167×2.5=418? EVET → [40,42] → 41 |

Son satır örnek: gerçek aylık tüketim 41 kutu, 420 kutuluk ay kampanya spike.

## Değiştirilen Dosyalar
- `js/pharmacy/pharmacy-intelligence.js` — `flagStockBuildMonths()`, `_avgMonthlyBoxesAdjusted()`, profil alanı + export
