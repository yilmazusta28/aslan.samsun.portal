# Arşiv → AI Motor Bağlantısı — Rapor (FAZ devamı)

## Amaç

`period-archive-manager.js` ile kurulan 6 aylık arşiv, önceki FAZ'da hiçbir
AI motoruna bağlı değildi (sadece localStorage'da biriktiriliyordu). Bu
FAZ'da arşivlenen geçmiş dönem verisi **insight, forecast (run-rate) ve
decision** motorlarına bağlandı.

## Yeni Dosya — `js/ai/core/period-archive-adapter.js`

`ims-adapter.js`'in IMS ham verisi için yaptığını, bu adapter arşiv
verisi için yapıyor: motorlar `PeriodArchiveManager`'ın localStorage
şemasını bilmiyor, sadece bu adapter'ın normalize (TTT bazlı, dönem
sıralı) çıktısını okuyor.

**API:**
- `getPreviousArchivedPeriod(ttt)` → TTT için, aktif dönemden bir önceki
  arşivlenmiş dönemin özeti (`genelTotal`, `genelRows`). TTT'nin o
  dönemde hiç kaydı yoksa veya arşiv boşsa **`null`** döner.
- `getHalfYearSeries(ttt)` → arşivde ne varsa, PERIODS sırasına göre
  kronolojik trend serisi.
- `getSummaryForTTT(ttt)` → ikisini tek çağrıda birleştiren kısayol.

**Bilinen sınırlama (dosya başında belgelendi):** `PERIODS` yıl bilgisi
taşımıyor (date-utils.js'in kendi tasarımı) — çok yıllı kullanımda aynı
anahtarlar (`1d`, `2d`, ...) üzerine yazılabilir. Bu, PERIODS'un mevcut
tasarımının bir devamı; adapter'ın yeni bir kısıtı değil.

## Bağlanan Motorlar

### 1) `insight-engine.js` — Blok 7 (yeni)
Mevcut dönem realizasyon yüzdesini, arşivdeki bir önceki dönemin final
realizasyonuyla karşılaştırır. Fark ≥10 puansa insight üretir:
> "1.Dönem realizasyonu %80.0 idi, bu dönem %65.0 (-15.0 puan düşüş)."

Arşiv boşsa (örn. yılın ilk dönemi) sessizce hiçbir şey üretmez —
mevcut insight akışını bozmaz.

### 2) `runrate-engine.js` — `historicalContext` alanı (yeni)
`calculateRunRate()` çıktısına salt-okunur yeni alan eklendi:
```js
historicalContext: {
  previousPeriodLabel: '1.Dönem',
  previousRealization: 80.0,
  currentRealization:  65.0
} | null
```
⚠️ **Mevcut `confidence` formülüne bilerek dokunulmadı** — bu formül
daha önce (`FIX-CONF-01`) özenle ayarlanmıştı, riske atmamak için sadece
bilgilendirme amaçlı yeni bir alan eklendi, hesaplama mantığı
değiştirilmedi.

### 3) `decision-engine.js` — `decisionBasis.historicalContext` (yeni)
`temporalContext` ile aynı desende, `decide()` çıktısının
`decisionBasis` bölümüne eklendi:
```js
decisionBasis: {
  ...
  temporalContext: {...} | null,
  historicalContext: { previousPeriodLabel, previousRealization } | null
}
```
Kararın kendisini (recommendation/confidence/risk) ETKİLEMEZ — sadece
şeffaflık amaçlı ek sinyal olarak eklendi (mevcut `temporalContext`
alanı da aynı şekilde salt bilgilendirme amaçlı kullanılıyordu).

## Entegrasyon Noktası — `index.html`

`period-archive-adapter.js` script tag'i `ims-adapter.js` sonrasına,
`temporal-context-engine.js` öncesine eklendi — üç bağlı motorun
(`insight-engine`, `runrate-engine`, `decision-engine`) hepsinden önce
yükleniyor.

## Rollback Güvenliği

- Üç motorun hepsi `window.PeriodArchiveAdapter` varlığını kontrol
  ediyor — script satırı silinirse motorlar sessizce eski davranışına
  döner, HİÇBİR ŞEY KIRILMAZ.
- Tüm yeni bloklar mevcut `try/catch` desenlerinin İÇİNDE veya aynı
  desende yeni try/catch ile sarıldı.
- `decisionBasis`/`historicalContext` ve `runrate` `historicalContext`
  alanları YENİ ve OPSİYONEL — var olan hiçbir tüketici kodu bu alanları
  beklemiyor, ekleme geriye dönük uyumlu.

## Test

`node --check` ile repo genelinde (CI ile birebir aynı komut) syntax
doğrulandı — hata yok. `period-archive-adapter.js` uçtan uca simüle
edildi (`vm` context, mock `Date`):
- 1.Dönem verisi sync edildi → 2.Dönem'e geçildi → `getPreviousArchivedPeriod('AHMET')`
  doğru şekilde 1.Dönem'in final verisini (`tl_pct:80`) döndürdü ✅
- Aynı dönemde kaydı olmayan TTT (`MEHMET`) için `null` döndü
  (sözleşmeyle tutarlı, önceki bir hatada boş nesne dönüyordu — düzeltildi) ✅
- 3 dönemlik veri sonrası `getHalfYearSeries('AHMET')` kronolojik sırayla
  `[1d, 2d]` trend serisini doğru üretti ✅
