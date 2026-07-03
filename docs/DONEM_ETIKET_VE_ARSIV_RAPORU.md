# Dönem Etiketleme Düzeltmesi + 6 Aylık Arşivleme Motoru — Rapor

## 1) Sorun

Uygulamada aktif dönem yanlış gösteriliyordu: 3 Temmuz 2026 tarihinde
"3.Dönem" yazıyordu. Doğru iş kuralı:

| Ay Aralığı        | Doğru Etiket     | Eski (Hatalı) Etiket |
|--------------------|------------------|------------------------|
| Ocak–Şubat         | 1.Dönem          | 1.Dönem (doğruydu)     |
| Mart–Nisan         | 2.Dönem          | 2.Dönem (doğruydu)     |
| Mayıs–Haziran      | 1.Kompanzasyon   | 1.Kompanzasyon (doğruydu) |
| **Temmuz–Ağustos** | **4.Dönem**      | ~~3.Dönem~~             |
| **Eylül–Ekim**     | **5.Dönem**      | ~~4.Dönem~~             |
| Kasım–Aralık       | 2.Kompanzasyon   | 2.Kompanzasyon (doğruydu) |

## 2) Kök Neden

`js/core/date-utils.js` içindeki tek kaynak `PERIODS` dizisinde
Temmuz–Ağustos ve Eylül–Ekim blokları yanlış key/label ile tanımlıydı.
Uygulamanın tamamı (`index.html`, `ai-engine.js`, `ai-context.js`,
`workload-engine.js`, `visit-planner.js`, `outcome-tracker.js`, vb.)
aktif dönemi **tek bir yerden** — `PERIODS.find(p => today>=p.start &&
today<=p.end)` — dinamik olarak okuyor. Başka hiçbir dosyada
`'3d'`/`'4d'` gibi hardcoded anahtar yoktu (grep ile doğrulandı).
Bu yüzden **tek dosyadaki** düzeltme tüm uygulamaya otomatik yansıdı.

## 3) Değişiklik — `js/core/date-utils.js`

- `key:'3d'` → `key:'4d'`, `label:'3.Dönem'` → `label:'4.Dönem'` (Temmuz–Ağustos)
- `key:'4d'` → `key:'5d'`, `label:'4.Dönem'` → `label:'5.Dönem'` (Eylül–Ekim)
- Her `PERIODS` elemanına yeni `halfYear` alanı eklendi:
  `H1` = {1d, 2d, k1}, `H2` = {4d, 5d, k2}. Bu alan sadece yeni arşiv
  motoru tarafından okunur, mevcut hiçbir tüketiciyi etkilemez.

## 4) Veri Giriş Gecikmesi (bilgi amaçlı doğrulama)

`js/ai/core/temporal-context-engine.js` zaten bu kuralı **sabit** değil,
**dinamik** hesaplıyor: IMS satırlarındaki en son dolu haftayı tarayıp
bugünün ISO haftasıyla farkını alıyor (`dataLagWeeks`). Verilen örnekle
(15–21 Haziran verisi 23 Haziran'da giriliyor, ~1 hafta gecikme) birebir
tutarlı bulundu — ek değişiklik gerekmedi.

## 5) Yeni Motor — `js/core/period-archive-manager.js`

**Amaç:** `GENEL_TABLO.csv` ve `IMS_TABLO.csv`, her dönem sonunda
kullanıcı tarafından GitHub'da sıfırlanıp yeni dönemin verisiyle
dolduruluyor (sistem yükünü azaltmak için). Bu motor, giden dönemin
**final verisini kaybetmeden** 6 aylık (yarıyıl) arşivine kaydeder.

**Çalışma mantığı:**
1. Her başarılı `syncData()` sonrasında, o anki GENEL/IMS verisi
   "son görüntü" (last snapshot) olarak `localStorage`'a yazılır —
   hangi dönem anahtarına (`PERIODS.find`) ait olduğu etiketiyle birlikte.
2. Bir sonraki sync'te bugünün tarihinden hesaplanan dönem anahtarı,
   kayıtlı son görüntünün dönem anahtarından **farklıysa** → dönem
   geçişi tespit edilir.
3. Geçiş tespit edilince, kayıtlı son görüntü (bir önceki dönemin FİNAL
   verisi) kalıcı olarak doğru yarıyıl arşivine (**H1** veya **H2**)
   taşınır.
4. Yeni dönemin verisi bir sonraki "son görüntü" olarak kaydedilir.

**Depolama (localStorage):**
- `PV_PERIOD_ARCHIVE_H1_V1` → 1.Dönem + 2.Dönem + 1.Kompanzasyon
- `PV_PERIOD_ARCHIVE_H2_V1` → 4.Dönem + 5.Dönem + 2.Kompanzasyon
- `PV_PERIOD_LAST_SNAPSHOT_V1` → henüz arşivlenmemiş "canlı" dönem verisi

**Public API (`window.PeriodArchiveManager`):**
- `processNewSync(genelArr, imsArr)` — `data-loader.js` içinden otomatik çağrılır
- `getCurrentPeriodKey(refDate?)`
- `getArchivedPeriod(periodKey)` → `{genel, ims, periodLabel, archivedAt, ...}`
- `getHalfYearArchive('H1' | 'H2')`
- `listArchivedPeriods()`
- `getSummary()` — konsoldan hızlı kontrol
- `clearAll()` — geri alınamaz, tüm arşivi siler

**Güvenlik / rollback:**
- GENEL_TABLO.csv/IMS_TABLO.csv'nin kendisi hâlâ **kullanıcı tarafından
  dönemsel olarak değiştirilir** — motor bu akışa müdahale ETMEZ, sadece
  giden veriyi arka planda yedekler.
- Boş/başarısız sync verisi arşivi bozamaz (`newGenelArr.length === 0`
  kontrolü).
- localStorage kota hatası (`QuotaExceededError`) veya erişim engeli
  durumunda sessizce loglar, `syncData()` akışını ETKİLEMEZ.
- Şu an hiçbir AI motoruna (forecast/insight/decision) henüz
  BAĞLANMADI — sadece arşiv altyapısını kurar. AI'ın geçmiş yarıyıl
  verisiyle karşılaştırma yapması istenirse ayrı bir FAZ olarak
  bağlanabilir.

## 6) Entegrasyon Noktaları

- `index.html` → `<script src="js/core/period-archive-manager.js">`
  eklendi, `date-utils.js`'ten hemen sonra, `data-loader.js`'ten önce.
- `js/data/data-loader.js` → `syncData()` içinde `GENEL DEDUP` bloğu
  bitiminden hemen sonra `PeriodArchiveManager.processNewSync(...)`
  çağrısı eklendi (try/catch ile korumalı, sessiz hata toleransı).

## 7) Test

Node ile uçtan uca simüle edildi (`vm` context, mock `Date`):
- 21 Haziran → `k1` ✅
- 15 Temmuz → `4d` ✅ (eskiden yanlış `3d` dönerdi)
- 15 Eylül → `5d` ✅ (eskiden yanlış `4d` dönerdi)
- 1.Dönem verisi sync edildi → tarih 2.Dönem'e ilerletildi → sonraki
  sync'te 1.Dönem otomatik `H1` arşivine düştü, veri korundu ✅

`js-syntax-check.yml` CI workflow'u `find js -name '*.js'` ile
çalıştığından yeni dosya otomatik kapsanıyor; `node --check` ile de
ayrıca doğrulandı, syntax hatası yok.
