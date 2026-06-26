# FAZ 7.0 — GENEL SOURCEADAPTER ARAYÜZÜ + 2 PİLOT KAYNAK RAPORU
**Tarih:** 2026-06-26
**Kapsam:** Genel `SourceAdapter` arayüzü + Saha Gözlemleri + Stok pilot entegrasyonu (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §13, §16)
**Yöntem:** Eklemeli (additive) geliştirme — mevcut hiçbir dosya davranışı bozulmadı

---

## 1. Özet

| Görev | Durum |
|---|---|
| `js/ai/core/source-adapter.js` (genel registry: register/discover/normalize/cache/contextHook) | ✅ Tamamlandı |
| `js/data/csv-parser.js` → `parseSahaGozlemCSV()` (KATMAN 0, yeni) | ✅ Tamamlandı |
| `js/data/csv-parser.js` → `parseStokCSV()` (KATMAN 0, yeni) | ✅ Tamamlandı |
| `js/ai/core/field-observation-adapter.js` (Pilot #1 — Saha Gözlemleri) | ✅ Tamamlandı |
| `js/ai/core/stock-adapter.js` (Pilot #2 — Stok) | ✅ Tamamlandı |
| `AIContextBuilder` köprüsü (`context.fieldObservations`, `context.stockSignals`) | ✅ Tamamlandı — 1 yeni resolver + 1 satır `Object.assign` |
| `data-loader.js::syncData()` senkronizasyon çağrısı | ✅ Tamamlandı — 1 try/catch bloğu, OutcomeTracker ile AYNI fire-and-forget desen |
| `.github/workflows/update-saha-gozlem-manifest.yml` | ✅ Tamamlandı (eczane-manifest deseniyle aynı) |
| `.github/workflows/update-stok-manifest.yml` | ✅ Tamamlandı (eczane-manifest deseniyle aynı) |
| `index.html` script kayıtları (3 satır) | ✅ Tamamlandı |
| Uçtan uca fonksiyonel test (gerçek veri senaryosu) | ✅ Node ile simüle edildi — bkz. §5 |
| Uçtan uca fonksiyonel test (veri henüz yok senaryosu — bugünkü gerçek durum) | ✅ Node ile simüle edildi — bkz. §5 |
| `node --check` (repo genelinde, tüm `js/**/*.js`) | ✅ Geçti |
| Karar motoruna bağlama (risk/decision/rca) | ⚠️ Bilinçli olarak yapılmadı — bkz. §6 |
| UI değişikliği | ⚠️ Bilinçli olarak yapılmadı — bkz. §6 |

**index.html değişikliği:** 3 yeni `<script>` satırı + açıklayıcı yorum bloğu. Başka hiçbir satır değişmedi.

---

## 2. Neden iki pilot, neden bu sıra

Roadmap FAZ 7.0'ı "Saha Gözlemleri **veya** Stok" olarak tanımlıyordu — kullanıcı onayıyla **ikisi de, sıralı** uygulandı:

1. **Saha Gözlemleri** ilk yazıldı ve registry'ye bağlandı — arayüzün İLK gerçek tüketicisi.
2. **Stok** ikinci, BAĞIMSIZ bir veri modeliyle (tamamen farklı alanlar: `urun`/`ilacGrubu`/`durum` vs. `kategori`/`onem`) AYNI arayüze uyduruldu — `source-adapter.js` dosyasına TEK SATIR dahi dokunmadan.

Bu, roadmap'in FAZ 7.0 için beklediği kanıtı **ikiye katlar**: tek bir örnek tesadüf olabilirdi, ikinci bağımsız örnek registry'nin gerçekten genel olduğunu gösterir.

---

## 3. Mimari Kararlar

### 3.1 Registry'nin sorumluluğu — "cache()" merkezi hale getirildi

`ims-adapter.js`/`competitive-adapter.js` her biri kendi içinde içerik-imzası bazlı cache mantığını AYRI AYRI yazmıştı (§12'nin zaten işaret ettiği tekrar). `source-adapter.js` bunu GENEL bir mekanizmaya taşıdı: bir adapter sadece `discover()`+`normalize()` yazar, registry imzayı hesaplar (adapter `cacheSignature` sağlarsa onu, yoksa güvenli bir JSON-uzunluğu fallback'ini kullanır), değişmeyen veriyi tekrar normalize ETMEZ.

**Bilinçli karar:** Mevcut 3 adapter (ims/competitive/pharmacy) bu registry'ye GERİYE DÖNÜK TAŞINMADI. "Ekle, kırma" prensibi (§16) gereği, zaten çalışan ve hiçbir hata raporu olmayan koda dokunmanın riski, kazanılacak tutarlılıktan daha ağır basıyordu. FAZ 7.0'ın kanıtlaması gereken şey zaten "yeni kaynaklar nasıl eklenir", "eski kaynaklar nasıl yeniden yazılır" değil.

### 3.2 İzolasyon — bir adapter çökerse diğerleri etkilenmez

`discoverAndNormalizeAll()` her adapter'ı kendi `.then()/.catch()` zincirinde çalıştırır (`Promise.all` ile toplanır). Saha Gözlemleri adapter'ı hata fırlatsa bile Stok adapter'ı (veya gelecekteki 3. bir adapter) ETKİLENMEZ — registry seviyesinde garanti edildi, her adapter kendi try/catch'ini yazmak ZORUNDA değil (§15 risk azaltımı, "yeni kaynak mevcut sistemi kırmaz" iddiasının teknik temeli).

### 3.3 Veri henüz YOK — bu FAZ'ın gerçek test koşulu

Roadmap'in işaret ettiği `Saha Gözlemleri`/`Stok` kaynakları repo'da henüz mevcut DEĞİL (CSV/manifest yok). Bu, mimariyi test etmek için tesadüfen İYİ bir koşul: her iki adapter da `discover()` içinde `fetchManifest()` çağırır, dosya/manifest 404 dönerse (gerçek bugünkü durum) **sessizce boş** sonuç döner — `EMPTY` durumuyla işaretlenir, hata FIRLATILMAZ. §5'teki test bunu doğruluyor. Saha ekibi `saha-gozlem/*.csv` veya `stok/*.csv` dosyalarını ilk kez push ettiğinde, ilgili GitHub Action manifest.json'u otomatik üretecek ve bir sonraki `syncData()` çağrısında veri OTOMATİK görünür hale gelecek — **hiçbir kod değişikliği gerekmeden.**

### 3.4 CSV başlık-adı bazlı parse (RAKIP_AKSİYON'dan FARKLI bir seçim)

`parseRakipAksiyonCSV` sabit pozisyonel sütun haritası kullanıyordu (dosya formatı sabit, çok satırlı başlık). Saha Gözlemleri/Stok için henüz gerçek bir dosya YOK — bu yüzden `parseSahaGozlemCSV`/`parseStokCSV` **başlık ADI bazlı** (`TARIH`, `TTT`, `HEDEF_TIPI`, ...) okuma yapıyor: sütun SIRASI değişse de (saha ekibi Excel'de sütun eklese/sırasını değiştirse) parser kırılmaz, sadece tanımadığı başlıklar boş gelir. Bu, ileride gerçek dosya formatı netleştiğinde **revize edilebilecek** bir varsayım — kesin format saha ekibinden geldiğinde ayrı bir küçük FAZ olarak güncellenebilir (RAKIP_AKSİYON'un EK A'sında olduğu gibi).

### 3.5 Stok → ilaçGrubu eşlemesi — yeni taksonomi İCAT EDİLMEDİ

`stock-adapter.js`, `competitive-adapter.js`'in §1.1 mantığını birebir izler: `URUN_ORDER` ↔ `ALL_GROUPS` (constants.js) pozisyonel eşlemesi kullanılır, `normUrun()` (data-normalizer.js) DEĞİŞTİRİLMEDEN sadece okunur. §5'teki test, `PANOCER → PANTAPROZOL PAZARI` ve `ACİDPASS → ACIDPASS PAZARI` eşlemesinin doğru çalıştığını doğruluyor.

---

## 4. Yeni Dosyalar / Değişen Satırlar

| Dosya | Değişiklik |
|---|---|
| `js/ai/core/source-adapter.js` | YENİ — genel registry |
| `js/ai/core/field-observation-adapter.js` | YENİ — Pilot #1 |
| `js/ai/core/stock-adapter.js` | YENİ — Pilot #2 |
| `js/data/csv-parser.js` | EK — `parseSahaGozlemCSV()`, `parseStokCSV()` (dosya sonuna eklendi, mevcut hiçbir fonksiyon değişmedi) |
| `js/ai/core/ai-context-builder.js` | EK — `_resolveSourceAdapterFields()` + `Object.assign(context, ...)` (2 satır net değişiklik, mevcut alanlar dokunulmadı) |
| `js/data/data-loader.js` | EK — `SourceAdapterRegistry.discoverAndNormalizeAll()` çağrısı (1 try/catch bloğu, RAKIP_AKSİYON bloğunun hemen altına) |
| `index.html` | EK — 3 `<script>` satırı + yorum bloğu |
| `.github/workflows/update-saha-gozlem-manifest.yml` | YENİ |
| `.github/workflows/update-stok-manifest.yml` | YENİ |

**Hiçbir dosya SİLİNMEDİ veya YENİDEN YAZILMADI.**

---

## 5. Test

İki senaryo Node.js içinde (DOM'suz, `fetch`/global'ler mock'lanarak) uçtan uca simüle edildi:

**Senaryo A — gerçek veri geldiğinde:** Mock manifest + CSV → `discoverAndNormalizeAll()` → `{fieldObservations:'OK', stockSignals:'OK'}` → `context.fieldObservations`/`context.stockSignals` doğru şekilde dolduruldu (kategori çıkarımı, ürün→grup eşlemesi, `criticalCount`/`recentCount` türetilen alanlar dahil). `getObservationsByCategory('RAKIP')` ve `getCriticalStockouts()` sorgu yardımcıları doğru sonuç döndü.

**Senaryo B — bugünkü gerçek durum (veri yok):** `fetch` her zaman 404 → `discoverAndNormalizeAll()` → `{fieldObservations:'EMPTY', stockSignals:'EMPTY'}` → `available:false`, hiçbir hata fırlatılmadı.

Ayrıca: `node --check` repo genelindeki TÜM `js/**/*.js` dosyalarında (CI'daki `js-syntax-check.yml` ile aynı komut) çalıştırıldı — hepsi geçti.

**Not — index.html inline `<script>` syntax kontrolü:** CI'nin bu adımı, FAZ 7.0'dan BAĞIMSIZ olarak, orijinal (değiştirilmemiş) ZIP'te de zaten başarısız oluyor (inline script #1). Bu FAZ 7.0'ın bir parçası DEĞİL — ayrı bir mevcut sorun, dokunulmadı.

---

## 6. Bilinçli Olarak Yapılmadı

- **Karar motoruna bağlama:** `context.fieldObservations`/`context.stockSignals` henüz hiçbir risk/decision/rca motoruna BAĞLANMADI. `rca-engine.js` (§10'da tasarlanan, henüz YAZILMAMIŞ) yazıldığında "Stok" nedeni için artık "veri yok" değil bu context alanını kanıt kaynağı olarak okuyabilir — bu BİLİNÇLİ olarak bu FAZ'ın kapsamı dışında tutuldu (FAZ 7.0'ın beklenen kazanımı "mimari kanıt", "karar üretimi" değil).
- **UI:** Henüz hiçbir ekran kartı bu veriye bağlı değil — FAZ 6.9'daki gibi "headless motor önce, UI sonra" deseni izlendi.
- **Gerçek CSV formatı netleştirme:** Saha ekibinden gerçek dosya gelene kadar §3.4'teki başlık adları bir VARSAYIM — RAKIP_AKSİYON'un EK A sürecinde olduğu gibi, gerçek dosya geldiğinde küçük bir revizyon FAZ'ı gerekebilir.

---

## 7. Rollback

Üç `<script>` satırını + `data-loader.js`/`ai-context-builder.js`'teki eklenen blokları silmek **hiçbir mevcut motoru kırmaz** — her iki entegrasyon noktası da `typeof`/varlık kontrolüyle korunaklı, registry yoksa context ve `syncData()` FAZ 7.0 ÖNCESİYLE birebir aynı davranır.
