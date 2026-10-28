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

## 6. Ek Prim (EK-PRIM) — yeni

| Portal dosyası | xlsm kaynağı | Durum |
|---|---|---|
| EK_PRIM.csv | EK-PRIM A:E (Griport Cold ek prim) | otomatik (zorunlu değil) |
| EK_PRIM_FAMTREC.csv | EK-PRIM G:L (Famtrec ek prim; TTT, 4-5 D HEDEF TL, 4-5 D SATIŞ TL, TL REAL %, TEKİL ECZ., PRİM) | otomatik (zorunlu değil) |

- `ims_transform.py` → `FINAL_EXPORTS` ve `weekly_ims_automation.ps1` → `$FinalCsvFiles` listelerine `EK_PRIM` eklendi; her çalışmada CSV üretilir, git klonuna kopyalanır ve push edilir.
- Portalda `js/data/ek-prim-loader.js` CSV'yi okuyup **Prim Hesapla** sayfasında "Ek Prim Tablosu" kartına basar (`index.html`, `#ekPrimCard`).
- Kolon başlıkları (EYLÜL SATIŞ / EKİM SATIŞ vb.) CSV'den okunur; dönem değişince kod değişmez, sadece xlsm'deki sayfa güncellenir.
- Gizlilik: `ttt-lock.js` kuralı geçerli; YILMAZ USTA / ŞENOL YILMAZ tüm tabloyu + toplamı görür, diğer temsilciler yalnızca kendi satırını görür.
- Portalda yeni dosyalar: `js/data/ek-prim-loader.js`, `EK_PRIM.csv` (bugünkü hali). `index.html`'e kart + script etiketi eklendi.

## 7. Kongre Takip otomasyonu — yeni

`Kongre_Takip_otomatik.xlsx` (VERI / LISTELER / KAYNAK sayfaları) artık aynı zamanlanmış görevlerin içinde güncelleniyor.

| Dosya | Görev |
|---|---|
| `kongre_veri_guncelle.py` | Aylık "ASLAN IMS TREND PIVOT" dosyalarındaki HAM DATA'dan VERI ve açılır liste kaynaklarını (bölge → TTT → brick) yeniler. Yeni ay yoksa dosyaya dokunmaz. |
| `kongre_guncelle.ps1` | Python betiğini çağırır, sonucu `automation_log.txt`'e `[KONGRE]` etiketiyle yazar. Her durumda `exit 0` döner: kongre adımındaki bir hata IMS akışını bozmaz. |
| `run_ims_with_retry.ps1` | IMS denemeleri bittikten sonra `kongre_guncelle.ps1`'i çağırır (IMS'te yeni hafta olsun olmasın). Zamanlanmış görevler değişmedi. |
| `period_config.json` | `kongre_enabled`, `kongre_script`, `kongre_xlsx`, `kongre_pivot_folders` (hepsi isteğe bağlı). |

- **Zamanlama:** Ayrı görev gerekmiyor. Salı görevi + oturum açılışı + 08:00–20:00 saatlik kontrol zaten çalışıyor; Trend Pivot dosyası ay içinde ne zaman gelirse bir sonraki turda yakalanır.
- **Aynı anda tek koşu:** Adım, IMS ile aynı `Global\IMS_Haftalik_Otomasyon` mutex'inin içinde çalışır.
- **Kapatmak için:** `period_config.json` içinde `"kongre_enabled": false`.
- **Dikkat:** Yazılacak yeni veri varken `Kongre_Takip_otomatik.xlsx` Excel'de açıksa kayıt yapılamaz (log: "Kongre dosyası Excel'de açık"); dosyayı kapatınca sonraki saatlik turda tamamlanır. Yazmadan önce `Kongre_Takip_otomatik.yedek.xlsx` yedeği alınır.
- **Dosya konumu:** `kongre_veri_guncelle.py` ve `Kongre_Takip_otomatik.xlsx` varsayılan olarak bu klasörde aranır; başka yerdeyse yolu `period_config.json`'a tam yol olarak yazın.

## 4. Kongre Etkisi (KONGRE_TAKIP_1 / KONGRE_TAKIP_2)

Portal: Performans > Kongre Etkisi (temsilci) ve Yönetici paneli > Kongre Etkisi Analizi kartı (`js/ui/kongre-etkisi.js`).

| Repo dosyası | xlsm sayfası | Kullanım |
|---|---|---|
| KONGRE_TAKIP_1.csv | KONGRE_TAKIP_1 (A:BE) | analiz (aylık kutu / pazar payı / EVO) |
| KONGRE_TAKIP_2.csv | KOGRE_TAKİP_2 (A:AL, sayfa adı xlsm'de yazım hatalı; `SHEET_ALIASES` ile bulunur) | katılımcı hekimler |
| KONGRE_TAKIP_1.xlsx / KONGRE_TAKIP_2.xlsx | aynı sayfalar, **xlsm'deki biçimle** (renk, birleştirme, genişlik, filtre) | yönetici kartındaki "Excel İndir" |

Güncelleme yolları (ikisi de aynı dosyaları üretir, idempotent):
1. Haftalık akış: `ims_transform.py --export-final-tables` (FINAL_EXPORTS + `export_kongre_styled`) -> `$FinalCsvFiles` ile git'e.
2. Bağımsız: `run_ims_with_retry.ps1` her kosuda `kongre_export_push.ps1` calistirir. xlsm'in son değişim damgası
   (`otomasyon_ciktilari\.kongre_stamp`) değişmişse `kongre_export.py` ile 4 dosyayı üretir, içerik değiştiyse commit + push eder.
   Kapatmak için period_config.json'a `"kongre_push_enabled": false`; klon yolu için `"git_clone_dir": "..."`.
Not: xlsm'deki kongre sayfaları xlsm'in KAYDEDİLMİŞ değerlerini taşır; Kongre_Takip_otomatik.xlsx -> xlsm yansıması ve kayıt sonrası ilk koşuda gönderilir.

## 8. SharePoint → OneDrive bağlantı düzeltmesi

`YENI IMS .xlsm` içinde Excel'in aktif kullandığı bazı dış bağlantılar doğrudan `https://selcukluholding.sharepoint.com/...` adresine
(ŞUBAT/MART/AĞUSTOS Karne, ASLAN 37. hafta) ya da artık erişilemeyen ağ yollarına (`\\7D471D08\...`, `\\AF2F8709\...`) bağlıydı.
Hepsi, OneDrive'ın yerel klasörlerine çevrildi (`C:\Users\yilma\OneDrive - Selçuklu Holding A.Ş\...`):

| Kaynak | Yeni yer |
|---|---|
| IMS - Aylık Veriler / Aslan / `<yıl>` / ASLAN KESİNLEŞMİŞ AYLIK IMS | `2. Kesinleşmiş IMS\<yıl>\ASLAN KESİNLEŞMİŞ AYLIK IMS\` |
| Karne / ASLAN / `<yıl>` | `3. Karne\ASLAN\<yıl>\` |
| IMS - Haftalık Veriler / Aslan / `<yıl>` | `1. Haftalık IMS\<yıl>\` |
| eski "Selçuklu Holding Portal - Aslan 1" (5D/6D) | `2. Kesinleşmiş IMS\2026\ASLAN KESİNLEŞMİŞ AYLIK IMS\` |

- `refresh_links.ps1`: bağlantı yolu çözümlenirken artık URL kodlaması (`%20`) ve Unicode biçimi (NFC) normalleştiriliyor; böylece SharePoint kaynaklı bir bağlantı tekrar çıkarsa çalışma anında OneDrive yoluna çevrilir.
- `period_config.json`: `sharepoint_synced_folder` anahtarı `onedrive_haftalik_folder` oldu (script eski adı da okur).

