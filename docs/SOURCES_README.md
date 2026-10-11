# IMS Otomasyonu — Veri Kaynağı Analizi ve Güncelleme

## 1. Tespit: portalın okuduğu ama otomasyonun üretmediği kaynaklar

Portal (`constants.js` / `data-loader.js` / `migi-donem.js` / `brick-tl-loader.js`) repo kökünden 12 CSV okuyor.
Otomasyon bunlardan yalnızca 7'sini üretiyordu:

| Portal dosyası | YENI_IMS_.xlsm kaynağı | Eski durum | Yeni durum |
|---|---|---|---|
| GENEL_TABLO.csv | GENELTABLO (45 kol, 64 satır) | otomatik | otomatik |
| IMS_TABLO.csv | TOPLAM IMS | otomatik | otomatik |
| YTD_TL.csv / YTD_KUTU.csv | YTD_TL / YTD_KUTU | otomatik | otomatik |
| TR_SIRA.csv | TR_SIRA | otomatik | otomatik |
| MI_GIGI.csv | 2025-2026-2027 | otomatik | otomatik |
| Brick_TL_Hedef.csv | BRICK TL HEDEF | otomatik | otomatik |
| **MI_GI_TL_TOPLAM.csv** | MI_GI_TL_TOPLAM (31 kol) | elle | **otomatik (yeni)** |
| **MI_GI_KUTU_TOPLAM.csv** | MI_GI_KUTU_TOPLAM (31 kol) | elle | **otomatik (yeni)** |
| **MI_GI-TL.csv** | MI_GI-TL (224 kol, brick bazlı) | elle | **otomatik (yeni)** |
| **MI_GI-KUTU.csv** | MI_GI-KUTU (224 kol, brick bazlı) | elle | **otomatik (yeni)** |

Bu 4 dosya MI&GI Takibi, brick sıralaması (`brick-ranking-engine`), Dosyalar sayfası ve yönetici paneli
(brick ulusal sırası) tarafından kullanılıyor.

## 2. Bilerek dahil EDİLMEYENLER

- xlsm içi çalışma sayfaları: `TOPLAM & HAFTALIKLAR`, `SUZULMUS`, `PPI VERI`, `MIGIGI`, `MI_GIGI`, `1`…`9`, `1.HAFTA`…`4.HAFTA`.
  Portal bunları okumuyor; ara hesap/ara çıktı sayfaları (N.HAFTA CSV/JSON zaten `otomasyon_ciktilari`'na yazılıyor).
- xlsm'de hiç bulunmayan kaynaklar: `RAKIP_AKSIYON.csv`, `eczane/*.csv`, `data/*.json`. Bunlar IMS dosyasından çekilemez;
  ayrı bir otomasyon gerekir.

## 3. Yapılan değişiklikler

**ims_transform.py**
- `FINAL_EXPORTS` kayıt defteri eklendi: yeni kaynak = listeye 1 satır.
- 4 yeni export eklendi (zorunlu değil: sheet okunamazsa diğer CSV'lerin push'unu engellemez, sadece uyarı basar).
- xlsm artık her sheet için yeniden değil **tek kez** yükleniyor (test: 121 sn → 30 sn).

**weekly_ims_automation.ps1**
- Elle yazılmış kopyalama ve `$gitFiles` listeleri, tek `$FinalCsvFiles` dizisine ve döngüye çevrildi.
- Git'e yalnızca klonda gerçekten var olan dosyalar ekleniyor (olmayan pathspec `git add`'i düşürmesin).
- Üretilmeyen zorunlu çıktı için `HATA`, opsiyonel için `UYARI` loglanıyor.

> `ims_transform.py` ile `weekly_ims_automation.ps1` listelerini birlikte güncellemek gerekir (ikisi aynı adları kullanır).

## 4. Doğrulama (YENI_IMS_.xlsm üzerinde)

- Mevcut 7 CSV: eski ve yeni script çıktıları **bayt bayt aynı** (regresyon yok).
- 4 yeni CSV, portalın kendi `parseMiGiToplamCSV` / `parseMiGiBrickCSV` fonksiyonlarıyla (node) parse edildi:
  - TOPLAM TL/KUTU: 259'ar kayıt, 9 temsilci, 11 ay (02–12/2026), NATIONAL satırı ayrı dizide (11).
  - Brick TL/KUTU: 1578'er kayıt, 79 brick.
- Sayısal biçim Excel'in Türkçe "CSV (noktalı virgülle ayrılmış)" çıktısıyla aynı (1.125,18 / "-" / boş = #N/A).

## 5. Dikkat

- Brick sayfalarında Mayıs, Temmuz, Eylül ve sonrası kaynak xlsm'de `#N/A` (yalnızca Şub, Mar, Nis, Haz, Ağu dolu).
  Export bunu doğru yansıtıyor; bu aylar dolunca otomatik gelir. Beklenmiyorsa ilgili dış bağlantıları kontrol et.
- Yeni CSV'ler ilk çalıştırmada git klonuna kopyalanıp push edilir; `yeni_csv/` klasörü aynı dosyaların bugünkü halidir.
- `files-orj.zip` içinde `guvenlik_cikti/` (JWT secret, kullanıcı/şifre dosyaları) ve `.claude/settings.local.json` var.
  `.gitignore` bunları dışlıyor ama zip'i paylaşmadan önce bu klasörleri çıkar. Bu dosyaları açmadım.
