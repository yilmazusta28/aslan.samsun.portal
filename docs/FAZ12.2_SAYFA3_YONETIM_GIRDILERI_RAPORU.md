# FAZ 12.2 — Sayfa 3: Yönetim ve AI Girdileri Raporu

## Yeni Dosya: `js/ai/core/saha-gozlem-store.js`

### Public API

```js
SahaGozlemStore.saveObservation({ kategori, eczane?, ttt?, not, tarih?, girenTTT? }) → Promise<obs>
SahaGozlemStore.getAll()                → Promise<obs[]>
SahaGozlemStore.getByEczane(eczane)     → obs[] (senkron, cache)
SahaGozlemStore.getByTTT(ttt)          → Promise<obs[]>
SahaGozlemStore.getByKategori(kat)      → Promise<obs[]>
SahaGozlemStore.deleteObservation(id)   → Promise<boolean>
SahaGozlemStore.refresh()              → Promise
```

### Kategori Değerleri (parseSahaGozlemCSV şemasıyla uyumlu)

`RAKIP | STOK | FIYAT | GERI_BILDIRIM | DIGER`

### Depolama

IndexedDB: `pharma_ai_pharma_db` v3 → `saha_gozlemleri` store  
(pharma-db.js v2 → v3 yükseltildi)  
CSV kaynağı SİLİNMEDİ — `SahaGozlemStore.getByEczane()` mevcut `sales-memory-engine.js` referansını karşılıyor.

## UI: Yönetici Paneli (page 7)

Üç bölüm eklendi:

### 1. Saha Gözlemleri Giriş Formu

- Kategori dropdown (RAKIP/FIYAT/STOK/GERI_BILDIRIM/DIGER)
- Eczane alanı (opsiyonel)
- Not textarea
- "Kaydet" butonu → `SahaGozlemStore.saveObservation()` → liste otomatik yenilenir
- Son 20 kayıt listelenir; her kayıt yanında ✕ silme butonu

### 2. AI Eğitim Girdileri Kısayolları

- "☑ Ziyaret Planı (FAZ 9.2)" → Eczane sayfasına yönlendirir
- "✓ Gün Sonu Geri Bildirimi (FAZ 11.2)" → Eczane sayfasına yönlendirir
- Açıklama: her iki input kanalının nerede olduğunu gösterir

## `SahaGozlemStore` — `sales-memory-engine.js` Entegrasyonu

`sales-memory-engine.js` zaten `window.SahaGozlemStore.getByEczane(eczane)` referansını içeriyordu (FAZ 7.0 contextHook). Bu modül şimdi bu referansı karşılıyor:
- Eczane için fiyat/zam gözlemleri (`kategori === 'FIYAT'`) `zamBehavior` alanına besleniyor
- CSV kaynağı yoksa bu IndexedDB kaynağı tek kaynak olarak çalışıyor

## Değiştirilen Dosyalar

- `js/ai/core/saha-gozlem-store.js` — YENİ
- `js/ai/core/pharma-db.js` — v2 → v3, `saha_gozlemleri` store eklendi
- `index.html` — script tag eklendi, page 7'ye form + kısayollar + `_saveSahaGozlem()` / `_renderSgList()` fonksiyonları
