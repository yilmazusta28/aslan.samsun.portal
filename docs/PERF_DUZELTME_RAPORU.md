# Performans düzeltmeleri (eczane veri katmanı + yükleme yolu)

Ölçüm: Node ile (tarayıcı/Lighthouse YOK). Telefon süreleri tahmindir.

| # | Değişiklik | Dosya | Etki |
|---|-----------|-------|------|
| 1 | Keşif `eczane/manifest.json` ile; manifest yoksa eski ay-ay yoklama (yedek) | js/pharmacy/pharmacy-data-manager.js | Keşif: 21 tam indirme → 1 küçük istek (+≤2 ucuz 404 yoklaması) |
| 1b | Açılışta yalnızca EN YENİ ay; kalanlar boşta (requestIdleCallback), en yeniden eskiye, 2 işçi | aynı | İlk ekran/IMS ile bant yarışı biter. Bitince AI motor cache'leri temizlenir + `pharmacy:allMonthsLoaded` olayı |
| 1c | Yavaş bağlantı (saveData / 2g-3g) → arka planda yalnızca son 3 ay; `window.PV_PHARMACY_PRELOAD='all'|'recent'|'none'` ile zorlanabilir | aynı | Eski aylar filtre seçilince yüklenir |
| 1d | **Doğruluk hatası**: 8 sn abort + başarısız ayın cache'e `[]` yazılması kaldırıldı. Zaman aşımı 30 sn (gövde dahil), 1 yeniden deneme, hata cache'lenmez | aynı | Yavaş ağda aylar sessizce kaybolmaz |
| 2 | `no-store`/`Date.now()` kalktı → `?v=<içerik hash'i>` + varsayılan HTTP cache (manifest yoksa `no-cache` = ETag/304) | aynı + .github/workflows/update-eczane-manifest.yml | Tekrar girişte geçmiş aylar ağdan inmez |
| 2b | Manifest'e `v` (sha1[0:12]) eklendi; `modified`/`generatedAt` çıkarıldı (CI checkout'ta mtime her seferinde değişir → cache anahtarı olamaz; her çalışmada gereksiz commit üretirdi) | workflow, eczane/manifest.json (üretildi) | |
| 3 | CSV hızlı yol: tırnak yoksa `split(sep)`; `detectSeparator` artık tüm metni bölmez, log 1 kez | js/data/csv-parser.js | 21 dosya: 594 → 134 ms (Node), çıktı eski ayrıştırıcıyla birebir aynı (81.609 satır doğrulandı) |
| 4 | Çift base64 PNG (2×93 KB) → `assets/logo.png` (14,5 KB, 160 px) | index.html, assets/logo.png | index.html 624 → 437 KB |
| 5 | `kongre-etkisi.js` (116 KB) ilk kullanımda yüklenir (yer tutucu `renderKongreEtkisi*`) | index.html | İlk JS −116 KB; CSV ön-çekimi de ertelenir |
| 6a | `_updatePharmacyStore`: aynı ay yeniden yüklenince indeksler (byPharmacy/byBrick/byProduct) çoğalmıyor, tek geçişte kuruluyor | pharmacy-data-manager.js | Gizli hata kapandı |
| 6b | `loadPharmacyMonth` 100 ms polling → paylaşılan promise | aynı | |
| 6c | `ek-prim-loader.js` 1,5 sn yoklama: sekme gizliyse / kart ekranda değilse çalışmaz (olaysız programatik değişimler yüzünden yoklama korundu) | js/data/ek-prim-loader.js | |
| 6d | `innerHTML +=` (13 yerde) → `insertAdjacentHTML('beforeend', …)` | ai-service, ai-engine, voice-briefing, manager-panel-engine, prim-takip-page, index.html | Mevcut DOM yeniden ayrıştırılmaz |
| 6e | `push(...dizi)` (8 yerde) → `pvPushAll` | js/data/data-loader.js | Argüman sınırı riski yok |

Yeni API: `PharmacyDataManager.ensureAllMonths()`, `whenAllLoaded()`, `isAllLoaded()`.

Yapılmadı (bilinçli): manager-panel-engine.js / autonomous-planning-engine.js tembel yükleme (global bağımlılık sırası, tarayıcıda doğrulanamadı); IndexedDB; temsilci JPG küçültme (gösterim boyutu doğrulanmadı); iki-nesne bellek tekrarı (ölçülmedi).
Not: değişen betiklerin ?v= sürümü 20261031a'ya yükseltildi (cache kırma).

## Ek: Kongre performansı (files.zip, 5.–7. tur)
`js/ui/kongre-etkisi.js`: `medianOf` Float64Array ile sıralanıyor (sonuç birebir aynı, ~2,2×); otomatik başlatma `load` sonrası boşta (`requestIdleCallback`) çalışıyor. Dosya içeriği değiştiği için `?v=20261029b`. Tembel yükleme yer tutucusuyla uyumlu: dosya ilk kullanımda yüklenince başlatma zaten boşta çalışır, `renderMount` yine `ensure()` çağırır.
