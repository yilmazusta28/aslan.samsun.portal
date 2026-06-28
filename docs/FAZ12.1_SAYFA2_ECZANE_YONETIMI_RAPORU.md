# FAZ 12.1 — Sayfa 2: Eczane Yönetimi Raporu

## Eklenen Özellikler

### 1. ☑ Coverage Checkbox Sütunu (FAZ 9.2)

Tablo başına `☑` sütunu eklendi. Her satırda bir checkbox:
- `CoverageSelection.listSelected(ttt)` ile pre-loaded (async sidecar)
- İşaretli: temsilci bu eczaneyi ziyaret planına almış
- Değiştirildiğinde: `CoverageSelection.setSelection(pharmacy, checked, ttt)` çağrılır
- Yüksek potansiyel + seçilmemiş eczaneler: sarı zemin (`#FEFCE8`) + "★ Öneri" etiketi

### 2. "Son Ziyaret" Sütunu (FAZ 9.3)

Sağda iki yeni sütun eklendi: `Son Ziyaret` ve `AI Profil`.  
`StockEntryAdapter.getLatestStockEntry(pharmacy).date` async yüklenir — sidecar cache dolunca tablo yeniden render edilir.  
Stok girişi tarihi = ziyaret tarihi varsayımı (ayrı veri modeli açılmadı).

### 3. "AI Profil" Sütunu (FAZ 9.4 Digital Twin / PharmacyBehaviorEngine)

`PharmacyBehaviorEngine.buildBehaviorProfiles(ttt)` senkron çağrılır ve cache'e alınır.  
Her satırda: `behaviorType` → Türkçe etiket (Düzenli / Büyüyen / Risk / Kazanım / Kampanya vb.)  
Salt okunur badge — bu sayfada AI karar üretilmez.

### 4. Yüksek Potansiyel Satır Vurgulama

`CoverageSelection.listUnselectedHighPotential(ttt)` sonuçları sarı zemine alınır.  
Satır üzerine gelince "Ziyaret planına eklenmesi önerilir." tooltip'i gösterilir.

## Async Sidecar Pattern

```js
_loadFaz121SidecarData(ttt)
  → CoverageSelection.listSelected()          → _faz121Cache.selectedSet
  → CoverageSelection.listUnselectedHighPotential() → _faz121Cache.highPotentialSet
  → PharmacyBehaviorEngine.buildBehaviorProfiles()  → _faz121Cache.behaviorMap
  → StockEntryAdapter.getLatestStockEntry() × N     → _faz121Cache.stockDateMap
  → renderEczaneTable(_eczaneData)  (re-render)
```

İlk render hızlı (cache boş → "—" değerleri). Sidecar dolunca tablo otomatik yenilenir.

## Değiştirilen Dosyalar

- `index.html` — `_faz121Cache`, `_loadFaz121SidecarData()` eklendi; `renderEczaneContent()` sidecar tetikleyici; `renderEczaneTable()` 3 yeni sütun (header + row)
