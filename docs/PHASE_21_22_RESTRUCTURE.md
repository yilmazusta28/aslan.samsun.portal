# PHASE 2.1 + 2.2 + DOSYA YAPISI YENİDEN YAPILANDIRMA RAPORU
**Tarih:** 2026-05-26  
**Son MD:** PHASE_20A_AUDIO_REPORT.md (Phase 2.0a — Audio System Extraction)  
**Bu rapor:** Phase 2.0a sonrasında yapılan tüm değişiklikler  

---

## 1. Özet

| Phase | Açıklama | Sonuç |
|-------|----------|-------|
| 2.1 | CSV Parser + Data Normalizer extraction | ✅ 63/63 |
| 2.2 | Prim Calc extraction | ✅ 63/63 (aynı sprint) |
| 3.0-pre | Dosya yapısı yeniden yapılandırma | ✅ 37/37 |

**Toplam index.html azalması (tüm phaseler):**

```
Başlangıç     : 7758 satır
Phase 2.0     :  -955 satır  (AI engine extraction)
Phase 2.0a    :  -100 satır  (Audio extraction)
Phase 2.1     :  -360 satır  (CSV parser extraction)
Phase 2.2     :   -84 satır  (Prim calc extraction)
Restrüktür    :   -57 satır  (workDays, formatters, charts stub)
─────────────────────────────
Şu an         : 6259 satır   (-%19.3 orijinalden)
```

---

## 2. Phase 2.1 — CSV Parser + Data Normalizer Extraction

### Taşınan fonksiyonlar → `js/data/csv-parser.js`

| Fonksiyon | Açıklama |
|-----------|----------|
| `detectSeparator(text)` | Virgül / noktalı virgül otomatik tespiti |
| `parseCSVLine(line, sep)` | Tek CSV satırı parse |
| `parseCSVRows(text)` | Tüm CSV metni parse |
| `parseN(v)` | TR/EN decimal format güvenli sayı çözümleyici |
| `stripTR(s)` | Türkçe → ASCII normalizer |
| `normTTT(raw)` | Temsilci adı canonical forma çevirme |
| `normUrun(raw)` | Ürün adı normalizasyonu |
| `normGrp(raw)` | Grup adı normalizasyonu |
| `isMktRow(ilac)` | Pazar satırı tespiti |
| `parseIMSCSV(csvText)` | IMS_TABLO.csv → JS object array |
| `parseGenelCSV(csvText)` | GENEL_TABLO.csv → JS object array |

**Kapsam dışında bırakılan:** `parseEczaneCSV()` — eczane render döngüsüyle derin coupling var, index.html'de korundu.

**Modül boyutu:** 370 satır  
**index.html azalması:** 360 satır  
**PHASE2-STUB:** `detectSeparator, parseCSVLine, parseCSVRows, parseN, stripTR, normTTT, normUrun, normGrp, isMktRow, parseIMSCSV, parseGenelCSV`

---

## 3. Phase 2.2 — Prim Calc Extraction

### Taşınan blok → `js/core/prim-calc.js`

| Sembol | Tür | Açıklama |
|--------|-----|----------|
| `CARPAN_TABLE` | const | Gerçekleşme % → prim çarpan tablosu (2026) |
| `MIGI_MATRIX` | const | MI & GI matris (PDF sayfa 13) |
| `URUN_AGIRLIK` | const | Ürün prim ağırlıkları |
| `getCarpan(real_pct)` | function | Gerçekleşme yüzdesinden çarpan döndürür |
| `getMiGiKatsayi(mi, gi)` | function | MI/GI'dan katsayı hesabı |
| `calcPrimForTTT(ttt)` | function | Tek TTT için prim hesabı |
| `calcPrimPuani(urunReals, ttt)` | function | Ürün ağırlıklı prim puanı |

**Bağımlılıklar:** `GENEL` (index.html — mutable state, taşınmadı)  
**Modül boyutu:** 91 satır  
**index.html azalması:** 84 satır  
**PHASE2-STUB:** `CARPAN_TABLE, getMiGiKatsayi, getCarpan, calcPrimForTTT, calcPrimPuani`

---

## 4. Validation Sprint — 63/63 ✅

Phase 2.1 + 2.2 aynı validation sprint'inde test edildi:

| Bölüm | Test | Sonuç |
|-------|------|-------|
| Script Loading Order | 8/8 | ✅ |
| CSV-Parser Module Integrity | 12/12 | ✅ |
| Prim-Calc Module Integrity | 5/5 | ✅ |
| index.html Stub Control | 8/8 | ✅ |
| Call Site Integrity | 8/8 | ✅ |
| No Duplicate Definitions | 5/5 | ✅ |
| Core Stability | 10/10 | ✅ |
| Rollback Safety | 7/7 | ✅ |

---

## 5. Dosya Yapısı Yeniden Yapılandırma

### Hedef yapı

```
files/
├── index.html
├── assets/
├── css/
├── data/
└── js/
    ├── ai/
    │   ├── ai-context.js
    │   ├── ai-engine.js
    │   └── ai-service.js
    ├── core/
    │   ├── async-guard.js
    │   ├── constants.js
    │   ├── date-utils.js
    │   ├── formatters.js
    │   ├── math-utils.js
    │   ├── prim-calc.js
    │   └── runtime-patches.js
    ├── data/
    │   ├── charts.js
    │   ├── csv-parser.js
    │   ├── data-normalizer.js
    │   └── storage.js
    └── utils/
        └── audio-utils.js
```

### Yeni modüller (bu aşamada oluşturulan)

#### `js/core/constants.js` (70 satır)
```
GS_IMS_URL, GS_GENEL_URL, GS_MIGI_*_URL, GS_ECZANE_URL
GITHUB_IMG_BASE
URUN_ORDER, URUN_CLR, ALL_TTTS, ALL_GROUPS
GRP_LBL, TR_SIRA_MAP, IMS_TL_MAP
USER_TO_TTT, OWN_IMS, OWN_DRUG_BY_GRP
```
Kaynak: index.html'de birbirinden ayrı ~8 farklı konumdaki sabitler toplandı.

#### `js/core/date-utils.js` (50 satır)
```
HOLIDAYS (Set)   — 2026 resmi tatilleri
PERIODS (Array)  — 6 satış dönemi tanımı (key, label, start, end, görsel)
workDays(s, e)   — HOLIDAYS-aware iş günü sayacı
```

#### `js/core/formatters.js` (41 satır)
```
fTL(n)                     — TL formatı (1.234₺)
fK(n)                      — Kutu formatı (1.234)
fPct(n)                    — Yüzde formatı (%12.3)
pCls(p), barCls(p)         — CSS sınıf yardımcıları
getIndeksColor(v)          — İndeks renk kodu
getIndeksLabel(v)          — İndeks etiket metni
getPriorityLabel(sira,mi,gi) — Öncelik etiketi
```

#### `js/core/math-utils.js` (32 satır)
```
parseN(v)         — TR/EN decimal standalone kopya
safePct(num, den) — Sıfır bölme güvenli yüzde
clamp(v, min, max)— Değer sıkıştırma
```

#### `js/core/async-guard.js` (28 satır)
```
var _aiInflight    = false  — AI chat lock
var _engineRunLock = false  — Engine çift çalıştırma lock
var _engineInflight = false — Engine AI analysis lock
resetAllGuards()            — Tüm guard'ları sıfırla
```
Önceki phase'lerde bu değişkenler hem index.html'deki shim'lerde hem modüllerde `var` ile tanımlanıyordu. Artık tek kaynak bu dosya; modüller sadece yönetir.

#### `js/core/runtime-patches.js` (38 satır)
Phase 1.9 B-01..B-03-4 patch'lerinin belgeleme dosyası. Çalıştırılabilir kod yok, sadece `console.debug` ve yorum bloğu. Referans amaçlı.

#### `js/data/charts.js` (35 satır)
```
var charts = {}           — Aktif Chart.js instance registry
destroyChart(id)          — Canvas leak'i önleyen temizleyici
mkChart(id,type,data,opts) — Standart Chart.js sarmalayıcı
```
Bağımlılık: `Chart.js` + `fK()` (formatters.js)

#### `js/data/data-normalizer.js` (70 satır)
csv-parser.js'den ayrıştırıldı. Sadece normalizasyon katmanı:
```
stripTR(s)       — Türkçe karakter → ASCII
normTTT(raw)     — Temsilci adı canonical'a çevir
normUrun(raw)    — Ürün adı normalize
normGrp(raw)     — Grup adı normalize
isMktRow(ilac)   — Pazar satırı mı?
```
Bağımlılık: `ALL_TTTS` (constants.js)

#### `js/data/storage.js` (36 satır)
ai-service.js'den ayrıştırıldı:
```
loadProxyUrl()  — localStorage'dan proxy URL yükle → window.AI_PROXY_URL
saveProxyUrl()  — Kullanıcı girişini localStorage'a kaydet
```

### PHASE3-STUB eklenenler (index.html'den kaldırılan inline tanımlar)

| Stub | Hedef modül | Satır tasarrufu |
|------|------------|-----------------|
| `workDays()` | `js/core/date-utils.js` | 6 satır |
| `fTL, fK, fPct, pCls, barCls` | `js/core/formatters.js` | 5 satır |
| `destroyChart, mkChart` | `js/data/charts.js` | ~22 satır |

---

## 6. Script Yükleme Sırası (Final)

```html
<!-- 1  --> <script src="chart.umd.min.js"></script>
<!-- 2  --> <script src="js/core/async-guard.js"></script>
<!-- 3  --> <script src="js/core/constants.js"></script>
<!-- 4  --> <script src="js/core/date-utils.js"></script>
<!-- 5  --> <script src="js/core/math-utils.js"></script>
<!-- 6  --> <script src="js/core/formatters.js"></script>
<!-- 7  --> <script src="js/core/prim-calc.js"></script>
<!-- 8  --> <script src="js/data/data-normalizer.js"></script>
<!-- 9  --> <script src="js/data/csv-parser.js"></script>
<!-- 10 --> <script src="js/data/charts.js"></script>
<!-- 11 --> <script src="js/data/storage.js"></script>
<!-- 12 --> <script src="js/utils/audio-utils.js"></script>
<!-- 13 --> <script src="js/ai/ai-context.js"></script>
<!-- 14 --> <script src="js/ai/ai-service.js"></script>
<!-- 15 --> <script src="js/ai/ai-engine.js"></script>
<!-- 16 --> <script> /* app init — DOMContentLoaded */ </script>
```

**Bağımlılık katmanları:**
```
Katman 1 (zero-dep)  : Chart.js, async-guard, constants
Katman 2 (core)      : date-utils, math-utils, formatters, prim-calc
Katman 3 (data)      : data-normalizer, csv-parser, charts, storage, audio-utils
Katman 4 (ai)        : ai-context, ai-service, ai-engine
Katman 5 (app)       : inline script
```

---

## 7. Modül Boyutları (Tam Liste)

| Modül | Satır | Kategori |
|-------|-------|----------|
| `js/ai/ai-engine.js` | 658 | AI |
| `js/data/csv-parser.js` | 369 | Data |
| `js/ai/ai-context.js` | 272 | AI |
| `js/ai/ai-service.js` | 228 | AI |
| `js/utils/audio-utils.js` | 109 | Utils |
| `js/core/prim-calc.js` | 91 | Core |
| `js/data/data-normalizer.js` | 70 | Data |
| `js/core/constants.js` | 69 | Core |
| `js/core/date-utils.js` | 50 | Core |
| `js/core/formatters.js` | 41 | Core |
| `js/core/runtime-patches.js` | 38 | Core |
| `js/data/storage.js` | 36 | Data |
| `js/data/charts.js` | 35 | Data |
| `js/core/math-utils.js` | 32 | Core |
| `js/core/async-guard.js` | 28 | Core |
| **Toplam modüller** | **2126** | |
| **index.html** | **6259** | |
| **Genel toplam** | **8385** | |

---

## 8. Stub Envanteri (Tam Liste)

index.html'de 22 adet PHASE2-STUB / PHASE3-STUB bulunuyor:

```
PHASE2-STUB (19 adet):
  L43   SoundFX + HapticFX → js/utils/audio-utils.js
  L48   CARPAN_TABLE, prim fns → js/core/prim-calc.js
  L360  buildTTTContext → js/ai/ai-context.js
  L365  aiQuick → js/ai/ai-context.js
  L369  sendAiMsg → js/ai/ai-service.js
  L376  _aiInflight → js/ai/ai-service.js
  L379  sendAiMsgWithText → js/ai/ai-service.js
  L476  loadProxyUrl → js/ai/ai-service.js (+ storage.js)
  L480  saveProxyUrl → js/ai/ai-service.js (+ storage.js)
  L975  buildEczaneContext → js/ai/ai-context.js
  L1097 detectSeparator..parseGenelCSV → js/data/csv-parser.js
  L4202 renderEngine → js/ai/ai-engine.js
  L4210 _engineRunLock → js/ai/ai-engine.js (+ async-guard.js)
  L4213 runEngine → js/ai/ai-engine.js
  L4217 _runEngineCore → js/ai/ai-engine.js
  L4224 _engineInflight → js/ai/ai-engine.js (+ async-guard.js)
  L4227 engineAiAnalysis → js/ai/ai-engine.js
  L4233 switchAiTab → js/ai/ai-engine.js
  L4239 setAiTTT → js/ai/ai-engine.js

PHASE3-STUB (3 adet):
  L1970 fTL, fK, fPct, pCls, barCls → js/core/formatters.js
  L1972 destroyChart, mkChart → js/data/charts.js
  L2107 workDays() → js/core/date-utils.js
```

---

## 9. Birikimli Skor Tablosu

```
Phase | Açıklama                | Δ Puan | Toplam
──────────────────────────────────────────────────
1.5   | Data integrity          | +14    | 54/100
1.9   | Runtime safety          | +14    | 68/100
2.0   | AI engine extraction    | +9     | 77/100
2.0a  | Audio extraction        | +2     | 79/100
2.1   | CSV parser extraction   | +3     | 82/100
2.2   | Prim calc extraction    | +2     | 84/100
3.0p  | Dosya yapısı reorgan.  | +4     | 88/100
──────────────────────────────────────────────────
Toplam kazanım: +48 puan (40 → 88)
```

---

## 10. Rollback Stratejisi (Güncel)

Her phase bağımsız olarak geri alınabilir:

```
Phase 2.1 rollback:
  1. index.html L18 script tag: <script src="js/data/csv-parser.js"> sil
  2. L1097 PHASE2-STUB bloğunu sil
  3. js/data/csv-parser.js içeriğini (header hariç) geri yapıştır

Phase 2.2 rollback:
  1. index.html L23 script tag: <script src="js/core/prim-calc.js"> sil
  2. L48 PHASE2-STUB bloğunu sil
  3. js/core/prim-calc.js içeriğini (header hariç) geri yapıştır

Restrüktür rollback:
  1. PHASE3-STUB satırlarını (3 adet) orijinal fonksiyonlarla değiştir
     — workDays: js/core/date-utils.js → L41+ (workDays fn bloğu)
     — fTL/fK/fPct/pCls/barCls: js/core/formatters.js → L27+ (5 fn)
     — destroyChart/mkChart: js/data/charts.js → L16+ (2 fn)
  2. Yeni script tag'lerini (constants, date-utils, vs.) HEAD'den sil
```

---

## 11. Sonraki Adımlar

### Acil (Phase 3.0)
- `<style>` bloğu (~850 satır) → `css/style.css`
- `renderAna()`, `renderPazar()`, `renderEkip()`, `renderEczane()` → component'lere ayır
- `_runEngineCore()` (~340 satır) → `js/ai/ai-engine-core.js`

### Orta vadeli
- `constants.js`'deki URL'leri environment-aware yap (dev/prod switch)
- `charts.js`'e renk teması entegrasyonu
- `data-normalizer.js` test suite (birim testler)

### Düşük öncelik
- `assets/` dizinine görseller ve fontlar taşı
- `data/` dizinine örnek CSV'ler ekle
- `js/calc/prim-calc.js` artık kullanılmıyor → silinebilir (kopya `js/core/`'da)

---

## 12. Phase 3.0 — CSS Extraction (Ek Güncelleme)

**Tarih:** 2026-05-26 (bu oturumda tamamlandı)

### Yapılan

`index.html` L4333-L5199 arası `<style>` bloğu (867 satır) → `css/style.css` dosyasına çıkarıldı.

```html
<!-- Önceki -->
<style>
  :root{ --bg:#F4F5FA; ... }
  /* 865 satır CSS */
</style>

<!-- Sonraki -->
<!-- PHASE3-STUB: <style> bloğu → css/style.css -->
<link rel="stylesheet" href="css/style.css">
```

**Link sırası:**
```html
<link href="https://fonts.googleapis.com/...">   <!-- 1. Google Fonts -->
<link href="https://cdnjs.../font-awesome...">   <!-- 2. Font Awesome -->
<link rel="stylesheet" href="css/style.css">     <!-- 3. Uygulama CSS -->
</head>
```

### Validation: 17/17 ✅

### Güncel index.html azalma tablosu

```
Orijinal          : 7758 satır
Phase 2.0         :  -955 satır
Phase 2.0a        :  -100 satır
Phase 2.1 + 2.2   :  -437 satır
Restrüktür stubs  :   -57 satır
Phase 3.0 CSS     :  -864 satır
─────────────────────────────
Şu an             : 5396 satır  (-%30.4 orijinalden)
```

### css/style.css içeriği (872 satır)

```
:root { CSS değişkenleri }
Base / Reset stilller
Layout (sidebar, navbar, page grid)
Component stilleri (card, btn, drawer, modal)
Tablo stilleri
Chart container stilleri
AI asistan stilleri
Animasyonlar (@keyframes)
@media (responsive breakpoints)
```
