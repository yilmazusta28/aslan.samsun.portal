# FAZ 10.2 — Haftalık Rota Planı Manuel Giriş Raporu

## Karar

Mevcut `buildWeeklyRoutes()` (AI önerisi) **DEĞİŞTİRİLMEDİ** — "AI önerisi" kartı olarak kalmaya devam eder.  
Yeni `route-plan-input.js` AYRI bir veri modeli: temsilci kendi brick planını girer, AI buna göre çalışır.

## Yeni Dosya: `js/ai/core/route-plan-input.js`

### Veri Modeli
```js
{
  id:             'representative|weekday',  // composite keyPath
  representative: 'ttt-kodu',
  weekday:        1|2|3|4|5,               // 1=Pazartesi...5=Cuma
  bricks:         ['Brick1', 'Brick2'],
  updatedAt:      'ISO string'
}
```

### IndexedDB: `pharma_ai_pharma_db` → v2 (FAZ 9.2'nin DB'si)
- Yeni store: `route_plans` (keyPath: `id`, index: `representative`, `weekday`)
- `pharma-db.js` v1 → v2 yükseltildi

### Public API
- `setDayPlan(weekday, bricks, rep?)` → Promise
- `getDayPlan(weekday, rep?)` → Promise
- `getWeekPlan(rep?)` → Promise
- `getTodayPlan(rep?)` → Promise
- `getTodayPlanSync(rep?)` → sync (bellek-içi cache, FAZ 10.3 için)
- `clearWeekPlan(rep?)` → Promise
- `renderRoutePlanForm(containerId, opts?)` → UI form (Pazartesi-Cuma brick seçimi)

### Bağlama Kuralı (FAZ 10.3'te uygulandı)
Eğer temsilci o gün için MANUEL plan girmişse → `buildTodayRoute()` önce bu planı okur  
Plan YOKSA → mevcut AI-hesaplı sıralama (Kademe 2-5) devreye girer

## Değiştirilen Dosyalar
- `js/ai/core/pharma-db.js` — v1 → v2, `route_plans` store eklendi
- `js/ai/core/route-plan-input.js` — YENİ
- `index.html` — `<script src="js/ai/core/route-plan-input.js">` eklendi
