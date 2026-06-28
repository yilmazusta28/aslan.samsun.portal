# FAZ 10.3 — Günlük Akıllı Ziyaret Listesi (5 Kademe) Raporu

## Yapılan Değişiklik

`route-optimizer.js::buildTodayRoute()` 5-kademeli sıralamaya uyarlandı. Fonksiyon **SİLİNMEDİ/DEĞİŞTİRİLMEDİ** — içindeki sıralama adımı netleştirildi.

## 5-Kademe Sıralama Mantığı

```
Kademe 1: RoutePlanInput.getTodayPlanSync()  → bugün için planlanmış brickler
Kademe 2: daysToNextOrder <= 7 ve rp >= 50  → sipariş zamanı gelmiş eczaneler
Kademe 3: CompetitiveAdapter aktif kampanya  → rakip baskısı olan brick'teki eczaneler
Kademe 4: opportunityScore >= 70            → yüksek fırsat (OpportunityScoreEngine)
Kademe 5: reorderProbability >= 60          → ziyaret edilmemiş yüksek potansiyel (proxy)
Fallback:  visitScore sıralaması            → 5 dolmadıysa genel sıralamadan tamamla
```

Kademeler sırayla doldurulur. Bir eczane birden fazla kademedeki koşulu karşılasa da listeye yalnızca bir kez eklenir (`used` map ile deduplicate).

## Maksimum Eczane Sayısı

`MAX_DAILY = 5` (SON-MASTER §12 kuralı). Eski `maxDailyVisits = 12` **buildWeeklyRoutes() için korundu** — sadece `buildTodayRoute()` 5 ile sınırlandı.

## Explainable AI Temeli (FAZ 11.1)

Her eczane nesnesine `tier` ve `neden` alanları eklendi:
```js
{ rank: 1, eczane: '...', neden: 'Sipariş zamanı (3 gün)', tier: 2, ... }
```
FAZ 11.1 "Neden?" butonu bu `neden` alanını tüketecek.

## Değiştirilen Dosyalar
- `js/route/route-optimizer.js` — 5 kademe helper fonksiyonu, `buildTodayRoute()` güncellendi, `_buildDayRoute()` `tier`/`neden` alanları eklendi
