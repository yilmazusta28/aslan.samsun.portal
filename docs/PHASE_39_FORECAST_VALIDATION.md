# PHASE 3.9 — FORECAST VALIDATION SPRINT RAPORU
**Tarih:** 2026-06-02  
**Audit kapsamı:** ai-engine.js · ai-context.js · prim-calc.js · date-utils.js · index.html (calcPrim)  
**Test temsilcisi:** YILMAZ USTA (Dönem 3 verileri)  
**Metodoloji:** Kod bazlı statik analiz + sayısal doğrulama + çapraz karşılaştırma

---

## YÖNETİCİ ÖZETİ

| Kategori | Durum | Kritik Sorun |
|----------|-------|--------------|
| Forecast Engine | ⚠️ SORUNLU | Projeksiyon drift %60pp |
| Prim Engine | ❌ HATA | ai-engine.js tüm eşiklerde yanlış |
| Target Simulator | ⚠️ SORUNLU | kalan_tl fallback sapması |
| Territory Engine | ✅ DOĞRU | |
| AI Coach Context | ⚠️ KISMİ | Projeksiyon AI'a yanlış gönderiliyor |

**Kritik bulgular:** 3 · Orta bulgular: 4 · Düşük bulgular: 3

---

## 1. FORECAST ENGINE

### 1.1 Kalan İş Günü Hesabı

**Fonksiyon:** `workDays(s, e)` — `date-utils.js`  
**Formül:** Hafta içi günleri say, `HOLIDAYS_2026` setindeki tatilleri çıkar  

| Dönem | Beklenen | Gerçekleşen | Durum |
|-------|----------|-------------|-------|
| 1.Dönem (01.02→13.03) | 51 | 51 | ✅ |
| 2.Dönem (16.03→10.04) | 19 | 19 | ✅ |
| 3.Dönem (14.04→26.06) | 47 | 47 | ✅ |
| 4.Dönem (29.06→11.09) | 54 | 54 | ✅ |
| 5.Dönem (14.09→20.11) | 49 | 49 | ✅ |
| 6.Dönem (23.11→31.12) | 29 | 29 | ✅ |

**Dönem 3 (2026-06-02 itibarıyla):**

| KPI | Formül | Değer |
|-----|--------|-------|
| Toplam iş günü | workDays(14.04, 26.06) | **47** |
| Geçen iş günü | totalWD − remDays | **28** |
| Kalan iş günü | workDays(02.06, 26.06) | **19** |
| İlerleme | 28/47 | **%59.6** |

**Sonuç: ✅ DOĞRU** — workDays tatil listesi ve hafta sonu filtrelemesi matematiksel olarak doğru.

---

### 1.2 Run-Rate Hesabı

**Fonksiyon:** `ai-context.js` L49  
**Formül:** `runRate = satisNow / passedDays`

| Girdi | Değer |
|-------|-------|
| Satış TL | 1.250.000₺ |
| Geçen iş günü | 28 |
| **Run-rate** | **44.643₺/gün** |

**Veri kaynağı:** `GENEL[ttt].satis_tl` (GENEL_TABLO.csv → `parseGenelCSV()`)  
**Sonuç: ✅ DOĞRU**

---

### 1.3 Dönem Sonu Projeksiyonu

**Fonksiyon:** `ai-context.js` L50  
**Formül:** `projEOD = runRate × totalWD`

| Hesap | Değer |
|-------|-------|
| Run-rate | 44.643₺/gün |
| Toplam iş günü | 47 |
| **Projeksiyon** | **2.098.214₺** |
| Hedef TL | 1.400.000₺ |
| **Proj. Realizasyon** | **%149.9** |
| **Anlık Realizasyon** | **%89.3** |
| **Drift** | **60.6 puan** |

### ⚠️ BULGU F-01: Projeksiyon Semantik Hatası (ORTA)

**Sorun:** Projeksiyon formülü `runRate × totalWD` dönem başından itibaren hesaplıyor — sanki tüm dönemi o hızla geçirmiş gibi. Oysa dönemin %59.6'sı geçti, geriye %40.4 kaldı. Doğru formül:

```
projEOD = satisNow + runRate × remDays
```

| Formül | Değer | Anlam |
|--------|-------|-------|
| Mevcut (`runRate × totalWD`) | 2.098.214₺ = **%149.9** | ❌ Geçmiş günleri çift sayıyor |
| Doğru (`satis + rate × kalan`) | 1.250.000 + 44.643×19 = **2.098.217₺ = %149.9** | ✅ Aynı sonuç |

**Not:** Bu özel durumda iki formül aynı sonucu veriyor çünkü `satisNow = runRate × passedDays`. Matematiksel eşdeğerlik doğrulanmıştır. **Sayısal hata yok**, ancak AI'a gönderilen projeksiyon konteksti semantik olarak yanıltıcı olabilir (çift hesap izlenimi).

---

### 1.4 %91 Hedef Gap Analizi

**Fonksiyon:** `ai-context.js` L52  
**Formül:**
```
kalanGap91 = max(0, hedefTL × 0.91 − satisNow)
gunlukIhtiyac = kalanGap91 / remDays
```

| KPI | Formül | Değer |
|-----|--------|-------|
| %91 hedef TL | 1.400.000 × 0.91 | **1.274.000₺** |
| Anlık satış | — | 1.250.000₺ |
| **Gap %91** | 1.274.000 − 1.250.000 | **24.000₺** |
| Kalan iş günü | — | 19 |
| **Günlük ihtiyaç** | 24.000 / 19 | **1.263₺/gün** |
| Run-rate | — | 44.643₺/gün |
| **İhtiyaç/mevcut oranı** | 1.263 / 44.643 | **0.03x** |

**Sonuç: ✅ DOĞRU** — %89.3 realizasyondaki temsilci için günlük 1.263₺ yeterli. Mevcut run-rate'in %3'ü.

---

### 1.5 Senaryo Modeli

**Fonksiyon:** `ai-context.js` L57-59  

| Senaryo | Formül | Değer | Proj.% |
|---------|--------|-------|--------|
| İyi (+%20 ivme) | 1.250.000 + 44.643 × 1.20 × 19 | 2.267.620₺ | %161.9 |
| Baz (mevcut) | 1.250.000 + 44.643 × 19 | 2.098.217₺ | %149.9 |
| Kötü (−%20 düşüş) | 1.250.000 + 44.643 × 0.80 × 19 | 1.928.814₺ | %137.8 |

**Sonuç: ✅ DOĞRU** — Senaryo aritmetiği tutarlı.

---

## 2. PRİM ENGINE

### 2.1 TL Real Primi — CARPAN TABLOSU

**Baz prim:** 55.000₺  
**Eşik:** ≥%91  

#### 2.1.1 ai-engine.js — Hardcode Çarpan (YANLIŞ)

```javascript
// ai-engine.js L215
const primTL = gt?.tl_pct >= 91
  ? 55000 * (tl_pct>=130?2.5 : tl_pct>=120?2.0 : tl_pct>=110?1.6
           : tl_pct>=105?1.3 : tl_pct>=100?1.1 : tl_pct>=95?1.0 : 0.9)
  : 0;
```

#### 2.1.2 prim-calc.js — Matematiksel CARPAN_TABLE (DOĞRU)

```javascript
function getCarpan(real) {
  const r = Math.min(Math.max(Math.round(real), 91), 130);
  return (CARPAN_TABLE[r] || 100) / 100;
}
```

### ❌ BULGU P-01: TL Real Prim Sapması (KRİTİK)

| Real% | CARPAN_TABLE (doğru) | ai-engine (hardcode) | Fark | Sapma% |
|-------|---------------------|---------------------|------|--------|
| %91 | 41.250₺ (0.75×) | 49.500₺ (0.90×) | +8.250₺ | **+%20.0** |
| %95 | 47.850₺ (0.87×) | 55.000₺ (1.00×) | +7.150₺ | **+%14.9** |
| %100 | 55.000₺ (1.00×) | 60.500₺ (1.10×) | +5.500₺ | **+%10.0** |
| %105 | 66.000₺ (1.20×) | 71.500₺ (1.30×) | +5.500₺ | **+%8.3** |
| %110 | 71.500₺ (1.30×) | 88.000₺ (1.60×) | +16.500₺ | **+%23.1** |
| %120 | 82.500₺ (1.50×) | 110.000₺ (2.00×) | +27.500₺ | **+%33.3** |
| %130 | 88.000₺ (1.60×) | 137.500₺ (2.50×) | +49.500₺ | **+%56.3** |

**Kök neden:** ai-engine.js `getCarpan()` fonksiyonunu kullanmıyor, aralık-tabanlı hardcode çarpan kullanıyor. `CARPAN_TABLE`'daki ayrıntılı değerler (ör. %91=75/100, %92=78/100...) yok sayılıyor.

**Etki:** Engine'in gösterdiği prim rakamları **her zaman yüksek** — kullanıcı gerçekte alabileceğinden daha fazla prim gösteriyor.

---

### 2.2 Portföy Primi

**Koşul:** TL real ≥%91 VE prim puanı ≥%91  

#### index.html / calcPrim (DOĞRU):
```javascript
portfoyPrim = (effReal >= 91 && primPuani >= 91)
  ? 0.20 × getCarpan(effReal) × 55.000 : 0;
```

#### ai-engine.js (YANLIŞ):
```javascript
const primPort = (gt?.tl_pct>=91 && primPuan>=91) ? 11.000 : 0;
```

### ❌ BULGU P-02: Portföy Prim Sabit Değer Hatası (KRİTİK)

| Real% | calcPrim (doğru) | ai-engine (sabit) | Fark |
|-------|-----------------|------------------|------|
| %91 | 8.250₺ | 11.000₺ | **−2.750₺** |
| %95 | 9.570₺ | 11.000₺ | **−1.430₺** |
| %100 | 11.000₺ | 11.000₺ | 0₺ ✅ |
| %105 | 13.200₺ | 11.000₺ | **+2.200₺** |
| %110 | 14.300₺ | 11.000₺ | **+3.300₺** |
| %120 | 16.500₺ | 11.000₺ | **+5.500₺** |

**Kök neden:** Portföy primi `0.20 × carpan × baz` formulünü takip ediyor, sadece %100 realizasyonda 11.000₺ sabitiyle örtüşüyor.  
**Etki:** %91-99 aralığında engine düşük, %100+ aralığında engine yüksek gösteriyor.

---

### 2.3 MI&GI Primi

**Baz:** 14.000₺ · **Koşul:** TL real ≥%70 · **Kaynak:** MIGI_MATRIX

#### prim-calc.js (DOĞRU):
```javascript
getMiGiKatsayi(mi, gi) → MIGI_MATRIX[snapGI][snapMI]
migiPrim = katsayi × 14.000
```

#### ai-engine.js (YANLIŞ):
```javascript
const migiPrim = 14000 * Math.min((miAvg/100)*(giAvg/100), 2.5)
```

### ❌ BULGU P-03: MI&GI Hesap Yöntemi Yanlış (KRİTİK)

| MI | GI | Matris (doğru) | Engine formül | Fark |
|----|----|----|----|----|
| 80 | 80 | 0₺ (0.0×) | 8.960₺ (0.64×) | **+8.960₺** |
| 95 | 100 | 10.500₺ (0.75×) | 13.300₺ (0.95×) | **+2.800₺** |
| 100 | 100 | 14.000₺ (1.00×) | 14.000₺ (1.00×) | 0₺ ✅ |
| 110 | 110 | 15.400₺ (1.10×) | 16.940₺ (1.21×) | **+1.540₺** |
| 120 | 120 | 17.500₺ (1.25×) | 20.160₺ (1.44×) | **+2.660₺** |
| 80 | 90 | 0₺ (0.0×) | 11.200₺ (0.80×) | **+11.200₺** |

**Kritik durum:** MI=80, GI=80 → matris **0₺** (prim yok), engine **8.960₺** gösteriyor.  
**Kök neden:** Engine `mi×gi / 10000` formülü kullanıyor; bu doğrusal bir çarpım. MIGI_MATRIX ise basamaklı, eşik tabanlı bir matris. Hiçbir zaman eşdeğer değil.

---

### 2.4 Prim Puanı Hesabı

**Fonksiyon:** `calcPrimPuani()` — `prim-calc.js`  
**Formül:** `Σ (min(real, 130) × agirlik)` → real ≥ %70 olan ürünler için

**Test verisi:** PANOCER:%89.3, ACİDPASS:%92.1, GRİPORT:%78.5, MOKSEFEN:%85.2, FAMTREC:%0

| Ürün | Real% | Capped | Ağırlık | Katkı |
|------|-------|--------|---------|-------|
| PANOCER | 89.3 | 89.3 | 0.25 | 22.33 |
| ACİDPASS | 92.1 | 92.1 | 0.25 | 23.03 |
| GRİPORT | 78.5 | 78.5 | 0.20 | 15.70 |
| MOKSEFEN | 85.2 | 85.2 | 0.15 | 12.78 |
| FAMTREC | 0.0 | — | 0.15 | 0 (%70 altı) |
| **TOPLAM** | | | **1.00** | **73.83** |

**Sonuç:** Prim puanı = **73.83** → %91 eşiğinin altında → Portföy primi yok.

**Sonuç: ✅ DOĞRU** — calcPrimPuani formülü matematiksel olarak tutarlı.

---

### 2.5 Prim Toplamı Karşılaştırması

**Örnek:** TL Real=%95, Prim Puanı=%73.83, MI=95, GI=100

| Bileşen | calcPrim (doğru) | ai-engine | Fark |
|---------|-----------------|----------|------|
| TL Real | 47.850₺ | 55.000₺ | +7.150₺ |
| Portföy | 0₺ (<91pp) | 0₺ | 0₺ |
| MI&GI | 10.500₺ | 13.300₺ | +2.800₺ |
| **TOPLAM** | **58.350₺** | **68.300₺** | **+9.950₺ (%17.1)** |

---

## 3. TARGET SIMULATOR

### 3.1 Kalan TL

**Öncelik sırası (ai-engine.js):**
1. `gt.kalan_tl` (CSV sütun R) → sıfır değilse kullan
2. `gt.hedef_tl − gt.satis_tl` → hesapla

### ⚠️ BULGU T-01: Fallback Sapması (DÜŞÜK)

CSV `kalan_tl = 0` iken:

| Yöntem | Hesap | Değer |
|--------|-------|-------|
| `hedef × (1 − tl_pct/100)` | 1.400.000 × (1 − 0.893) | 149.800₺ |
| `hedef − satis` (matematiksel) | 1.400.000 − 1.250.000 | **150.000₺** |
| **Fark** | | **200₺ (%0.13)** |

**Kök neden:** `tl_pct` CSV'de yuvarlama nedeniyle 2 ondalık basamakla geldiğinde küçük sapma oluşabilir. Tercih edilmesi gereken: `hedef_tl − satis_tl` (doğrudan).

---

### 3.2 Kalan Kutu

**Öncelik sırası:**
1. `kalan_kutu_100` (CSV sütun AA)
2. `kalan_tl / IMS_TL_MAP[urun]`
3. `hedef_kutu × (1 − tl_pct/100)`

**Test: PANOCER, tl_pct=%38, kalan_tl=0, hedef_tl=300.000₺**

| Yöntem | Hesap | Değer |
|--------|-------|-------|
| calcKalan | 300.000 × (1 − 0.38) | 186.000₺ |
| kalanKutu | 186.000 / 105.31 | **1.766 kutu** |
| gunlukKutu | ⌈1.766 / 19⌉ | **93 kutu/gün** |

**Sonuç: ✅ DOĞRU** (CSV'de kalan_tl ve kalan_kutu_100 sıfır ise)

### ⚠️ BULGU T-02: Haftalık Kutu Hesabı Tutarsızlığı (ORTA)

`wKutu` hesabı haftalık orantılama yapıyor:
```javascript
kutu = Math.ceil(kalanKutu × wDays / remDays)
// 1.766 × 5 / 19 = 464.7 → 465 kutu/hafta
```
Ancak gunlukKutu × wDays = 93 × 5 = **465** — tutarlı ✅

Sorun: `wKutu` hesabında `hedef_kutu` fallback kullanılıyor ama `hedef_kutu` CSV sütun Y (dönem başı hedef), kalan kutu değil. Bu durumda `hedef_kutu × (1 − tl_pct/100) × wDays/remDays` ile `kalanKutu × wDays/remDays` arasında küçük tutarsızlık oluşabilir.

---

### 3.3 Günlük TL Hedefi (Haftalık Plan)

**Formül:** `wKalan = kalanTL × wDays / remDays`

| Hafta | wDays | wKalan | Günlük |
|-------|-------|--------|--------|
| Hafta 1 | 5 | 39.474₺ | 7.895₺ |
| Hafta 2 | 5 | 39.474₺ | 7.895₺ |
| Hafta 3 | 5 | 39.474₺ | 7.895₺ |
| Hafta 4 | 4 | 31.579₺ | 7.895₺ |

**Sonuç: ✅ DOĞRU** — Günlük hedef tüm haftalar için eşit, beklenen davranış.

---

## 4. TERRITORY ENGINE

### 4.1 Risk Brick Skoru

**Kural:** `sira ≤ 333 AND (mi < 90 OR gi < 90)`  
**Kaynak:** `MIGI_BRICK_TL_RAW`

| Test Brick | Sıra | MI | GI | Risk? | Beklenen | Sonuç |
|------------|------|----|----|-------|----------|-------|
| ORDU MERKEZ-1 | 75 | 71 | 153 | ✅ (MI<90) | ✅ | ✅ |
| GIRESUN MERKEZ | 282 | 92 | 108 | ❌ | ❌ | ✅ |

**Sonuç: ✅ DOĞRU**

### 4.2 IMS Pazar Payı Risk Skoru

**Kural:** `ppi < 15% AND pazar > 500 kutu`

| Brick | PPI | Pazar | Risk? |
|-------|-----|-------|-------|
| GIRESUN MERKEZ-2 | %6 | 16.324 | ✅ |
| ORDU FATSA | %9 | 11.037 | ✅ |

**Sonuç: ✅ DOĞRU**

### 4.3 Fırsat Skoru

**Kural:** `ppi > 25% AND ownB > 0` (ai-context.js L140)

**Sonuç: ✅ DOĞRU** — Güçlü pazar payı bricklerini fırsat olarak işaretliyor.

---

## 5. AI SALES COACH

### 5.1 Bağlam Kalitesi Analizi

**Fonksiyon:** `buildTTTContext(ttt)` — `ai-context.js`

### ⚠️ BULGU A-01: Projeksiyon Bağlamı Yanıltıcı (ORTA)

AI'a gönderilen context'te:
```
Mevcut ivmeyle dönem sonu tahmini: 2.098.214₺ → %149.9
```
Bu değer matematiksel olarak doğru ama kullanıcı dönem henüz bitmemişken `%89.3 anlık realizasyon` ile `%149.9 projeksiyon` arasındaki 60 puanlık farkı kavramak zor. AI yanıtlarında bazen "Zaten çok iyi durumdasın" tonu oluşabilir.

**Öneri:** Context'e şu ek bilgi eklenmeli:
```
NOT: Dönem sonu projeksiyonu mevcut günlük satış temposuyla hesaplanmıştır.
Anlık realizasyon ≠ dönem sonu realizasyon. Proje kesin değildir.
```

### ⚠️ BULGU A-02: Prim Context Yanlış Değer İçeriyor (YÜKSEK)

`ai-engine.js` engine panelinde gösterilen prim rakamları AI prompt'una dolaylı olarak girdi oluşturuyor (kullanıcı ekranda gördüğü değerleri AI'a soruyor). Engine'deki yanlış prim hesaplamaları (Bulgu P-01/P-02/P-03) dolaylı olarak AI yanıtlarını da kirletiyor.

### 5.2 Ürün Öneri Kalitesi

**ai-context.js L165:**
```javascript
kalanKutu = Math.round(r.kalan_tl / p)
```
`kalan_tl` sıfır geldiğinde `kalanKutu = 0` → AI "0 kutu gerekli" diyor.  
Engine'deki fallback (Bulgu T-01) bu durumu kısmen düzeltiyor ancak context builder'da aynı düzeltme yok.

### ❌ BULGU A-03: ai-context.js Fallback Eksik (ORTA)

`buildTTTContext()` içindeki L165:
```javascript
const kalanKutu = Math.round(r.kalan_tl / p);
```
`r.kalan_tl = 0` ise `kalanKutu = 0` → AI context'ine "0 kutu" bilgisi gidiyor.  
Oysa ai-engine.js'de `_gtKalanCalc` fallback eklendi. Context builder'da bu fallback **yok**.

---

## 6. FORMÜL REFERANSİ VE SAPMA TABLOSU

| # | KPI | Kaynak | Formül | Durum | Max Sapma |
|---|-----|--------|--------|-------|-----------|
| F1 | Kalan iş günü | date-utils.js | workDays(tatil filtreli) | ✅ | 0 |
| F2 | Run-rate | ai-context.js | satis/passedDays | ✅ | 0 |
| F3 | Projeksiyon | ai-context.js | rate×totalWD ≡ satis+rate×remDays | ✅ | ~3₺ |
| F4 | %91 Gap | ai-context.js | max(0, hedef×0.91−satis) | ✅ | 0 |
| F5 | Günlük ihtiyaç | ai-context.js | gap91/remDays | ✅ | 0 |
| F6 | TL Real Prim | ai-engine.js | **HARDCODE** ≠ CARPAN_TABLE | ❌ | +49.500₺ |
| F7 | TL Real Prim | prim-calc.js | getCarpan×55.000 | ✅ | 0 |
| F8 | Portföy Prim | ai-engine.js | **11.000 sabit** ≠ 0.20×carpan×baz | ❌ | ±5.500₺ |
| F9 | Portföy Prim | prim-calc.js | 0.20×carpan×55.000 | ✅ | 0 |
| F10 | MI&GI Prim | ai-engine.js | **mi×gi/10000×14000** ≠ matris | ❌ | +11.200₺ |
| F11 | MI&GI Prim | prim-calc.js | getMiGiKatsayi(matris)×14000 | ✅ | 0 |
| F12 | Prim Puanı | prim-calc.js | Σ(capped_real×agirlik) | ✅ | 0 |
| F13 | Kalan TL (fallback) | ai-engine.js | hedef×(1−pct/100) | ⚠️ | 200₺ |
| F14 | Kalan Kutu | ai-engine.js | kalan_kutu_100 > kalan/fiyat | ✅ | 0 |
| F15 | Brick Risk | ai-engine.js | sira≤333 AND mi/gi<90 | ✅ | 0 |
| F16 | IMS Risk | ai-engine.js | ppi<15 AND pazar>500 | ✅ | 0 |
| F17 | kalanKutu (context) | ai-context.js | kalan_tl/fiyat (fallback YOK) | ⚠️ | ∞ |

---

## 7. BULGULAR ÖZETİ

### Kritik Bulgular (Kod değişikliği gerektirir)

| ID | Dosya | Satır | Sorun | Etki |
|----|-------|-------|-------|------|
| **P-01** | ai-engine.js | L215 | TL Real prim hardcode çarpan — CARPAN_TABLE yerine aralık-tabanlı | +8.250₺ ~ +49.500₺ her temsilcide |
| **P-02** | ai-engine.js | L217 | Portföy prim 11.000₺ sabit — değişken olmalı | ±5.500₺ |
| **P-03** | ai-engine.js | L218-222 | MI&GI prim mi×gi formülü — MIGI_MATRIX yerine | 0₺~+11.200₺ |

### Orta Bulgular

| ID | Dosya | Satır | Sorun |
|----|-------|-------|-------|
| **A-03** | ai-context.js | L165 | kalan_tl=0 iken kalanKutu=0 AI context'ine gidiyor |
| **T-02** | ai-engine.js | L375 | wKutu fallback hedef_kutu (dönem başı) kullanıyor |
| **A-01** | ai-context.js | L87 | Projeksiyon/anlık realizasyon farkı context'te yeterli uyarı yok |
| **A-02** | ai-engine.js | L215-223 | Engine paneli yanlış prim → kullanıcı AI'a yanlış değer soruyor |

### Düşük Bulgular

| ID | Dosya | Sorun |
|----|-------|-------|
| **T-01** | ai-engine.js | kalan_tl fallback: %tl_pct tabanlı ≈200₺ sapma |
| **F-01** | ai-context.js | Projeksiyon formülü eşdeğer ama semantik olarak farklı |

---

## 8. ÖNCELİKLENDİRİLMİŞ DÜZELTME SIRASI

```
1. [KRİTİK] ai-engine.js L215-222 — prim hesabını getCarpan() ve getMiGiKatsayi() ile değiştir
2. [KRİTİK] ai-engine.js L217    — portföy primini 0.20×getCarpan(tl_pct)×55000 yap
3. [ORTA]   ai-context.js L165   — kalan_tl=0 iken fallback ekle
4. [DÜŞÜK]  ai-engine.js L141    — kalan_tl fallback yöntemini hedef−satis yap
```

---

## 9. ÜRETİM HAZIRLIK SKORU

| Alan | Puan | Açıklama |
|------|------|----------|
| Forecast Engine | 90/100 | Projeksiyon eşdeğer, tatil/iş günü doğru |
| Prim Engine (calcPrim) | 95/100 | CARPAN_TABLE doğru, formül tutarlı |
| Prim Engine (ai-engine) | **42/100** | 3 kritik hata, tüm eşiklerde yanlış |
| Target Simulator | 85/100 | Fallback zinciri çalışıyor, küçük sapma |
| Territory Engine | 95/100 | Risk/fırsat mantığı doğru |
| AI Coach Context | 75/100 | Projeksiyon konteksti iyileştirilebilir |
| **GENEL SKOR** | **80/100** | Kritik 3 prim hatası düzeltilince 93+ |

