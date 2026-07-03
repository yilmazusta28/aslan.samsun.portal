# index.html — Phase 1 Patch Talimatları

Bu doküman `index.html`'e yapılacak **minimum, geri alınabilir** değişiklikleri tanımlar.
Her değişiklik numara ile işaretlenmiştir. Sırayla uygulayın.

---

## ADIM 0 — Yedek Al (KRİTİK)

```bash
cp index.html index_backup_v4.html
```

---

## ADIM 1 — Script Taglarını Ekle (HEAD bölümü)

`<head>` bölümünde Chart.js script tagından **hemen sonra** ekle:

```html
<!-- Mevcut satır (değiştirme): -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>

<!-- YENİ: Bu satırları hemen altına ekle -->
<script src="js/config/constants.js"></script>
<script src="js/utils/formatters.js"></script>
<script src="js/utils/date-utils.js"></script>
<script src="js/utils/math-utils.js"></script>
<script src="js/data/data-normalizer.js"></script>
<script src="js/data/csv-parser.js"></script>
<script src="js/data/storage.js"></script>
<script src="js/render/charts.js"></script>
```

---

## ADIM 2 — index.html İçindeki Satırları Yoruma Al

Her fonksiyon/sabit bloğunun BAŞINA ve SONUNA yorum ekle.
**SİLME** — sadece yoruma al. Rollback için gerekli.

### 2.1 CARPAN_TABLE ve MIGI_MATRIX (L113-134)

```js
// MOVED TO: js/config/constants.js
/* 
const CARPAN_TABLE = { ... };
const MIGI_MATRIX = { ... };
*/
```

### 2.2 getCarpan, getMiGiKatsayi, URUN_AGIRLIK, calcPrimForTTT, calcPrimPuani (L137-196)

```js
// MOVED TO: js/utils/math-utils.js
/*
function getCarpan(real_pct) { ... }
function getMiGiKatsayi(mi, gi) { ... }
const URUN_AGIRLIK = { ... };
function calcPrimForTTT(ttt) { ... }
function calcPrimPuani(urunReals, ttt) { ... }
*/
```

### 2.3 getIndeksColor, getIndeksLabel, getPriorityLabel (L225-249)

```js
// MOVED TO: js/utils/math-utils.js
/*
function getIndeksColor(v) { ... }
function getIndeksLabel(v) { ... }
function getPriorityLabel(...) { ... }
*/
```

### 2.4 loadProxyUrl, saveProxyUrl, updateProxyStatus, testProxy (L817-890)

```js
// MOVED TO: js/data/storage.js
/*
function loadProxyUrl() { ... }
function saveProxyUrl() { ... }
function updateProxyStatus(url) { ... }
async function testProxy() { ... }
*/
```

### 2.5 GS_*_URL sabitler (L1483-1489, L964-965)

```js
// MOVED TO: js/config/constants.js
/*
const GS_IMS_URL = ...;
const GS_GENEL_URL = ...;
const GS_MIGI_TL_URL = ...;
...vs...
const GS_ECZANE_URL = ...;
const GITHUB_IMG_BASE = ...;
*/
```

### 2.6 detectSeparator, parseCSVLine, parseCSVRows, parseN (L1491-1573)

```js
// MOVED TO: js/data/csv-parser.js
/*
function detectSeparator(text) { ... }
function parseCSVLine(line, sep) { ... }
function parseCSVRows(text) { ... }
function parseN(v) { ... }
*/
```

### 2.7 stripTR, CANONICAL_TTTS, normTTT (L1602-1647)

```js
// MOVED TO: js/data/data-normalizer.js
/*
function stripTR(s) { ... }
const CANONICAL_TTTS = [...];
function normTTT(raw) { ... }
*/
```

### 2.8 TTT_NORM_MAP (L1578-1601)

```js
// MOVED TO: js/config/constants.js
/*
const TTT_NORM_MAP = { ... };
*/
```

### 2.9 VALID_USERS, USER_TO_TTT, VALID_PASS (L1380-1422)

```js
// MOVED TO: js/config/constants.js
/*
const VALID_USERS = [...];
const USER_TO_TTT = { ... };
const VALID_PASS = '...';
*/
```

### 2.10 parseMiGiToplamCSV, parseMiGiBrickCSV (L1914-2101)

```js
// MOVED TO: js/data/csv-parser.js
/*
function parseMiGiToplamCSV(csvText) { ... }
function parseMiGiBrickCSV(csvText) { ... }
function parseMiGiKarneCSV() { ... } // ölü kod
function parseMiGiCSV() { ... }       // ölü kod
*/
```

### 2.11 parseIMSCSV, parseGenelCSV (L1655-1853)

```js
// MOVED TO: js/data/csv-parser.js
/*
function parseIMSCSV(csvText) { ... }
function parseGenelCSV(csvText) { ... }
*/
```

### 2.12 parseEczaneCSV (L1023-1059)

```js
// MOVED TO: js/data/csv-parser.js
/*
function parseEczaneCSV(csvText) { ... }
*/
```

### 2.13 URUN_ORDER, ALL_GROUPS, URUN_CLR, TTT_COLORS vb. (L2650-2712)

```js
// MOVED TO: js/config/constants.js
/*
const URUN_ORDER = [...];
const ALL_GROUPS = [...];
...
const PERIODS = [...];
*/
```

### 2.14 fTL, fK, fPct, pCls, barCls (L2725-2733)

```js
// MOVED TO: js/utils/formatters.js
/*
function fTL(n) { ... }
function fK(n) { ... }
function fPct(n) { ... }
function pCls(p) { ... }
function barCls(p) { ... }
*/
```

### 2.15 drugLabel, getPazColor (L2654, L2677)

```js
// MOVED TO: js/utils/formatters.js
/*
function drugLabel(d) { ... }
function getPazColor(d, ownIlac, idx) { ... }
*/
```

### 2.16 destroyChart, mkChart (L2735-2752)

```js
// MOVED TO: js/render/charts.js
/*
function destroyChart(id) { ... }
function mkChart(id, type, data, opts = {}) { ... }
*/
```

### 2.17 workDays (L2888-2893)

```js
// MOVED TO: js/utils/date-utils.js
/*
function workDays(s, e) { ... }
*/
```

---

## ADIM 3 — showZamHesap Duplikasyonu Temizle

**SORUN:** `showZamHesap` iki kez tanımlı (L894 ve L5547).
JavaScript'te ikincisi geçerli. İkinci tanım her iki davranışı da kapsıyor.

**ÇÖZÜM:** Birinci tanımı (L894-898) yoruma al:

```js
// MOVED: showZamHesap ilk tanım L894 → L5547'deki versiyon geçerli
/*
function showZamHesap() {
  const panel = document.getElementById('zamPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') buildZamInputs();
}
*/
```

---

## ADIM 4 — Test Kontrol Listesi

Her adımdan sonra tarayıcıda kontrol et:

```
[ ] DevTools Console'da hata yok mu?
[ ] Veri yükleniyor mu? (syncData OK mesajı)
[ ] Temsilci seçimi çalışıyor mu?
[ ] Ana Sayfa render oluyor mu?
[ ] Pazar Analizi çalışıyor mu?
[ ] Satış Takibi çalışıyor mu?
[ ] MI/GI sayfası çalışıyor mu?
[ ] Prim hesaplama çalışıyor mu?
[ ] AI asistan yanıt veriyor mu?
[ ] Eczane CSV yükleniyor mu?
[ ] Mobil görünüm bozulmadı mı?
[ ] Dark mode çalışıyor mu?
```

---

## ADIM 5 — Rollback Prosedürü

Herhangi bir sorun çıkarsa:

```bash
# index.html'i yedeğe geri döndür
cp index_backup_v4.html index.html

# Script taglarını kaldır (head'den)
# → js/ klasörü kalabilir, zararı yok
```

---

## Sonraki Phase

Phase 2'de şunlar çıkarılacak:
- `js/engines/runrate-engine.js` → projeksiyon hesaplamaları
- `js/engines/premium-engine.js` → `calcPrim`, `buildPrimInputs`
- `js/engines/migi-engine.js` → `initMigi1`, `initMigi2`

Phase 3'te:
- `js/render/tables.js` → tablo render fonksiyonları
- `js/render/pharmacy-renderer.js` → eczane sayfası
- `js/ai/ai-engine.js` → AI motoru
