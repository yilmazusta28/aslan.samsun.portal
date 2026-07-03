# PHARMA VISION Portal — Modülerizasyon Göç Planı
**Versiyon:** Phase 1 Plan  
**Tarih:** 2026-05-18  
**Kapsam:** Stabilizasyon ve Modülerizasyon (Yeniden Yazım DEĞİL)

---

## 1. Mevcut Durum Analizi

### Dosya Boyutu
- `index.html`: **7.560 satır** tek dosya
- Yaklaşık ~2.000 satır CSS (inline `<style>`)
- Yaklaşık ~5.500 satır JavaScript (inline `<script>`)
- ~50 satır base64 MP3 ses verisi (SoundFX)

### Tespit Edilen Sorunlar

| # | Sorun | Risk Seviyesi | Konum |
|---|-------|--------------|-------|
| 1 | `parseN()` fonksiyonu 2 yerde tanımlı — hem global hem `parseMiGiToplamCSV` içinde | YÜKSEK | L1538, L1916 |
| 2 | `pN` local parser — `parseN` ile aynı mantık, 3 farklı yerde tekrar | YÜKSEK | L1916, L1978 |
| 3 | `showZamHesap()` iki kez tanımlı — ikincisi birincinin üzerine yazıyor | YÜKSEK | L894, L5547 |
| 4 | AI sistem prompt metni 2 yerde — `sendAiMsg` ve `engineAiAnalysis` | ORTA | L743, L5471 |
| 5 | Eczane fetch kodu 3 yerde — `renderEczane`, `buildEczaneContext`, `_runEngineCore` | YÜKSEK | L1069, L1337, L5122 |
| 6 | AI fetch mantığı 2 yerde — `sendAiMsgWithText` ve `engineAiAnalysis` | ORTA | L777, L5486 |
| 7 | `workDays()` büyük ihtimalle 3+ yerde referans veriliyor ama tek tanım | DÜŞÜK | Aranacak |
| 8 | `GENEL TOPLAM` filtresi pattern her yerde inline | DÜŞÜK | Yaygın |
| 9 | Tüm render fonksiyonları global scope'ta — isim çakışma riski | ORTA | Genel |
| 10 | `parseMiGiKarneCSV` ve `parseMiGiCSV` — compat stub, ölü kod | DÜŞÜK | L2103-2105 |

---

## 2. Global Değişken ve Fonksiyon Haritası

### Global State (Mutable)
```
IMS[]           GENEL[]         KUTU[]
MIGI_TL_RAW[]   MIGI_KUTU_RAW[] MIGI_BRICK_TL_RAW[] MIGI_BRICK_KUTU_RAW[]
ECZANE_RAW      eczaneLoaded
curPage         selTTT          selTTT_p1   selTTT_p2
selGroup        selHafta        selKutuUruns
charts{}        _syncLock
selAiTTT        aiChatHistory   engineSelTTT
selEczaneTTT    selEczaneBrick  selEczaneUrun  selEczaneAy
eczaneSortKey   eczaneSortAsc   _eczaneData    _eczaneSearchFilter
mg1_tip         mg1_donem       mg1_veri       mg1_person
mg2_ttt         mg2_donem       mg2_veri       mg2_333
_activeMfDrawer LOGGED_IN_USER  CALC_SYNC{}    window._lastCalcPrim
```

### Sabitler (Immutable)
```
URUN_ORDER[]        ALL_GROUPS[]        URUN_CLR{}
URUN_AGIRLIK{}      URUN_ORDER_PRIM[]   TTT_COLORS[]
TR_SIRA_MAP{}       IMS_TL_MAP{}        HOLIDAYS Set
PERIODS[]           OWN_DRUG_BY_GRP{}   OWN_IMS{}
GRP_LBL{}           DRUG_ORDER{}        PAZ_COLORS[]
VALID_USERS[]       USER_TO_TTT{}       TTT_NORM_MAP{}
CANONICAL_TTTS[]    GS_IMS_URL          GS_GENEL_URL
GS_MIGI_*_URL       GS_ECZANE_URL       GITHUB_IMG_BASE
AI_PROXY_URL (window) VALID_PASS
```

### Temel Fonksiyonlar (Kategorilere Göre)

**Formatters (Saf, Bağımsız)**
```
fTL(n)      fK(n)       fPct(n)
pCls(p)     barCls(p)   drugLabel(d)
getPazColor(d, ownIlac, idx)
```

**Math / Date Utils (Saf, Bağımsız)**
```
workDays(from, to)
getCarpan(pct)          getMiGiKatsayi(mi, gi)
getIndeksLabel(v)       getIndeksColor(v)
calcPrimPuani(urunReals, ttt)
calcPrimForTTT(ttt)
```

**CSV Parsers**
```
detectSeparator(text)   parseCSVLine(line, sep)   parseCSVRows(text)
parseN(v)               normTTT(name)             stripTR(s)
parseIMSCSV(csvText)    parseGenelCSV(csvText)
parseMiGiToplamCSV(csvText)  parseMiGiBrickCSV(csvText)
parseEczaneCSV(csvText)
```

**Storage / Proxy**
```
loadProxyUrl()    saveProxyUrl()    updateProxyStatus(url)    testProxy()
```

**Render — Ana Sayfa**
```
renderAna()         selectTTT(t)      renderTopBar()
renderGenelTablo()  renderEkipCharts() renderTTTDetail()
renderTTTHaftalikChart()  buildCompetitionAlerts(ttt)
```

**Render — Pazar**
```
renderPazar()       buildPazarFilters()    renderPazarChart()
```

**Render — Satış Takibi**
```
renderTakip()        buildTakipFilters()   renderTakipTable()
buildForecast()
```

**Render — MI/GI**
```
initMigi1()   initMigi2()    mg2Toggle333()
mgFmt(v, ispp)   mgDurumBadge(evol, mi)
buildMigiFilters()  renderMiGi()     renderMigi1Table()   renderMigi2Table()
```

**Render — Prim**
```
buildPrimInputs()   calcPrim()      resetPrim()
buildZamInputs()    calcZam()       showZamHesap()
```

**Render — Eczane**
```
renderEczane()      buildEczaneFilters()   renderEczaneContent()
renderEczaneTable() renderEczaneCharts()
filterEczaneTable() sortEczane(key)
```

**Render — AI**
```
renderAiAsistan()   switchAiTab(tab)   setAiTTT(ttt)
```

**AI Engine**
```
sendAiMsg()              sendAiMsgWithText(text)
buildTTTContext(ttt)     buildEczaneContext(ttt)
engineAiAnalysis(type)   runEngine()   _runEngineCore()
renderEngine()
```

**Data / Sync**
```
syncData()          rebuildKutuFromIMS()   getBrickTTTMap()
getTTTPhoto(ttt)
```

**UI Utils**
```
goPage(i)            toggleMfDrawer(id)    closeMfDrawer(id)
mkChart(id,...)      destroyChart(id)
toggleTheme()        toggleSidebar()       aiQuick(type)
```

**Auth**
```
doLogin()     _autoSelTTT(fallback)
```

---

## 3. Bağımlılık Haritası

```
config.js          ← hiçbir şeye bağımlı değil
  ↓
utils/formatters.js ← config.js
utils/math-utils.js ← config.js
utils/date-utils.js ← config.js (HOLIDAYS, PERIODS)
  ↓
data/csv-parser.js  ← config.js + utils/formatters.js
data/storage.js     ← config.js (URL'ler)
data/normalizer.js  ← config.js (TTT_NORM_MAP)
  ↓
engines/runrate-engine.js  ← config + utils + data
engines/premium-engine.js  ← config + utils
engines/migi-engine.js     ← config + data
  ↓
render/charts.js           ← config + utils
render/tables.js           ← config + utils + engines
render/pharmacy-renderer.js← config + data + tables
render/ai-renderer.js      ← config + engines + data
  ↓
ai/ai-engine.js            ← tüm render + data + engines
  ↓
main.js                    ← her şeyi bağlar
```

---

## 4. Çıkarım Öncelik Sırası (En Düşük Risk → En Yüksek)

| Adım | Modül | Dosya | Risk | Neden Güvenli |
|------|-------|-------|------|---------------|
| 1 | Sabitler | `js/config/constants.js` | 🟢 ÇOK DÜŞÜK | Hiçbir fonksiyon yok, sadece veri |
| 2 | Formatters | `js/utils/formatters.js` | 🟢 ÇOK DÜŞÜK | Saf fonksiyon, bağımlılık yok |
| 3 | Date Utils | `js/utils/date-utils.js` | 🟢 DÜŞÜK | Yalnızca HOLIDAYS + PERIODS'a bağımlı |
| 4 | Math Utils | `js/utils/math-utils.js` | 🟡 DÜŞÜK | Prim hesapları — dikkatli test gerekli |
| 5 | CSV Parser | `js/data/csv-parser.js` | 🟡 ORTA | Duplicate `pN` temizleme |
| 6 | Storage | `js/data/storage.js` | 🟢 DÜŞÜK | Proxy URL fonksiyonları |
| 7 | Charts | `js/render/charts.js` | 🟡 ORTA | `mkChart/destroyChart` |
| 8 | Run-Rate Engine | `js/engines/runrate-engine.js` | 🟡 ORTA | `calcPrimForTTT`, `workDays` |
| 9 | Premium Engine | `js/engines/premium-engine.js` | 🟡 ORTA | `calcPrim`, `getCarpan` |
| 10 | AI Engine | `js/ai/ai-engine.js` | 🔴 YÜKSEK | En son — her şeye bağımlı |

---

## 5. Duplicate Fonksiyon Tespiti ve Temizlik Planı

### 5.1 `parseN` / `pN` Duplikasyonu (EN KRİTİK)

**Mevcut durum:**
- `parseN(v)` → satır ~1538, global — tam implementasyon
- `pN` → satır ~1916, `parseMiGiToplamCSV` içinde yerel closure
- `pN` → satır ~1978, `parseMiGiBrickCSV` içinde yerel closure

**Temizlik:** Global `parseN` korunur. İki yerel `pN` → `parseN` çağrısına dönüştürülür.
**Risk:** `pN` yerel versiyonları tam olarak aynı mı? → Test gerekli.

### 5.2 `showZamHesap` Duplikasyonu

**Mevcut durum:**
- Satır ~894: `function showZamHesap()` — ilk tanım (zamPanel'i toggle)
- Satır ~5547: `function showZamHesap()` — ikinci tanım (zamPanelQuick + zamPanel)

**JavaScript davranışı:** İkinci `function` bildirimi birincinin yerini alır (hoisting). Yani şu anda yalnızca ikinci çalışıyor.

**Temizlik:** İlk tanım kaldırılır. İkincisi korunur. Birincinin içeriği zaten ikincinin içinde var.
**Risk:** DÜŞÜK — browser zaten ikincini kullanıyor.

### 5.3 `parseMiGiKarneCSV` / `parseMiGiCSV` — Ölü Kod

```js
function parseMiGiKarneCSV(){ return {records:[],donem:''}; }
function parseMiGiCSV(){ return []; }
```
→ Silinebilir. Hiçbir yerde çağrılmıyor (compat stubs).

### 5.4 Eczane Fetch Duplikasyonu

Üç yerde:
1. `renderEczane()` — ana yükleme
2. `buildEczaneContext()` — arka plan yükleme
3. `_runEngineCore()` — motor arka plan yükleme

**Temizlik:** `loadEczaneData()` adında tek bir async fonksiyon oluştur. Diğerleri bunu çağırır.

---

## 6. Hedef Klasör Yapısı

```
/
├── index.html          ← Sadece HTML + CSS + <script> tag'leri
├── js/
│   ├── main.js         ← initApp, syncData, goPage, routing
│   ├── config/
│   │   └── constants.js← Tüm sabitler ve konfigürasyon
│   ├── utils/
│   │   ├── formatters.js   ← fTL, fK, fPct, pCls, barCls
│   │   ├── date-utils.js   ← workDays, HOLIDAYS (ref), PERIODS (ref)
│   │   └── math-utils.js   ← getCarpan, getMiGiKatsayi, calcPrimPuani
│   ├── data/
│   │   ├── csv-parser.js   ← detectSeparator, parseN, parseIMSCSV, parseGenelCSV
│   │   ├── data-normalizer.js  ← normTTT, stripTR, TTT_NORM_MAP
│   │   └── storage.js      ← loadProxyUrl, saveProxyUrl, updateProxyStatus
│   ├── render/
│   │   ├── charts.js           ← mkChart, destroyChart
│   │   ├── tables.js           ← renderGenelTablo, renderTTTDetail
│   │   ├── ai-renderer.js      ← renderAiAsistan, switchAiTab
│   │   └── pharmacy-renderer.js← renderEczane, renderEczaneTable
│   ├── engines/
│   │   ├── runrate-engine.js   ← calcPrimForTTT, projeksiyon
│   │   ├── premium-engine.js   ← calcPrim, buildPrimInputs
│   │   └── migi-engine.js      ← initMigi1, initMigi2, mgFmt
│   └── ai/
│       └── ai-engine.js        ← sendAiMsg, runEngine, engineAiAnalysis
└── README.md
```

---

## 7. Script Tag Stratejisi (GitHub Pages Uyumlu)

GitHub Pages düz HTML/CSS/JS sunar. ES Modules kullanmak mümkündür ama `type="module"` ile:

```html
<!-- index.html içinde HEAD bölümü -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>

<!-- Klasik script sırası (güvenli, module kullanmadan) -->
<script src="js/config/constants.js"></script>
<script src="js/utils/formatters.js"></script>
<script src="js/utils/date-utils.js"></script>
<script src="js/utils/math-utils.js"></script>
<script src="js/data/csv-parser.js"></script>
<script src="js/data/data-normalizer.js"></script>
<script src="js/data/storage.js"></script>
<script src="js/render/charts.js"></script>
<script src="js/engines/runrate-engine.js"></script>
<script src="js/engines/premium-engine.js"></script>
<script src="js/engines/migi-engine.js"></script>
<script src="js/render/tables.js"></script>
<script src="js/render/pharmacy-renderer.js"></script>
<script src="js/render/ai-renderer.js"></script>
<script src="js/ai/ai-engine.js"></script>
<script src="js/main.js"></script>
```

**Neden `type="module"` YOK?**
- Tüm mevcut fonksiyonlar global scope'ta çağrılıyor (`onclick="..."`)
- HTML inline event handler'lar module scope'a erişemez
- Bu değişiklik UI'ı tamamen bozar
- Mevcut yapıda global scope zorunlu

**Import/Export YOK** — Global namespace korunur, sadece dosya ayırımı yapılır.

---

## 8. Geri Alma (Rollback) Güvenliği

Her adımda:
1. `index.html`'nin yedeği alınır: `index_backup_v{N}.html`
2. Yeni dosya üretilir ve `index.html`'e `<script src=...>` eklenir
3. Orjinal inline kod **yoruma alınır, silinmez** — ilk 2 haftada
4. Tüm testler geçtikten sonra inline yorum kaldırılır

**Test Kriterleri (Her Adımda):**
- [ ] Veri yükleniyor mu? (syncData çalışıyor mu?)
- [ ] Temsilci seçimi çalışıyor mu?
- [ ] Tüm sayfalar render oluyor mu?
- [ ] Prim hesaplama çalışıyor mu?
- [ ] AI asistan yanıt veriyor mu?
- [ ] Eczane CSV yükleniyor mu?
- [ ] Mobil görünüm bozulmadı mı?

---

## 9. Phase 1 Uygulama: `js/config/constants.js`

**Bu adımda yapılacak:**
1. Tüm sabitler constants.js'e taşınır
2. index.html'de inline sabitler `// MOVED TO js/config/constants.js` yorumuyla işaretlenir
3. `<script src="js/config/constants.js">` head'e eklenir

**Çıkarılacak sabitler:**
- `URUN_ORDER`, `ALL_GROUPS`, `URUN_CLR`, `URUN_AGIRLIK`, `URUN_ORDER_PRIM`
- `TTT_COLORS`, `PAZ_COLORS`, `GRP_LBL`, `DRUG_ORDER`
- `TR_SIRA_MAP`, `IMS_TL_MAP`
- `HOLIDAYS`, `PERIODS`
- `OWN_DRUG_BY_GRP`, `OWN_IMS`
- `GS_IMS_URL`, `GS_GENEL_URL`, `GS_MIGI_*_URL`, `GS_ECZANE_URL`, `GITHUB_IMG_BASE`
- `VALID_USERS`, `USER_TO_TTT`, `TTT_NORM_MAP`, `CANONICAL_TTTS`
- `VALID_PASS`

**Çıkarılmayacaklar (mutable state):**
- `IMS`, `GENEL`, `KUTU`, `ALL_TTTS` — runtime'da değişiyor
- Tüm `sel*` değişkenler — UI state

---

## 10. Tahmini Zaman Çizelgesi

| Hafta | Görev | Risk |
|-------|-------|------|
| 1 | constants.js + formatters.js | 🟢 |
| 2 | date-utils.js + math-utils.js | 🟢 |
| 3 | csv-parser.js + duplicate temizliği | 🟡 |
| 4 | storage.js + charts.js | 🟢 |
| 5 | runrate-engine.js + premium-engine.js | 🟡 |
| 6 | migi-engine.js + tables.js | 🟡 |
| 7 | pharmacy-renderer.js + ai-renderer.js | 🟡 |
| 8 | ai-engine.js + main.js | 🔴 |
| 9-10 | Test, inline kod temizliği, dokümantasyon | — |
