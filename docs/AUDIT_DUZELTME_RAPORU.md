# AUDIT DÜZELTME RAPORU
**Tarih:** 2026-06-29
**Kapsam:** Önceki audit'te (FAZ8-12 tam uygulama kontrolü) bulunan 2 kritik gap'in düzeltilmesi

---

## Düzeltme 1 — Top 30 GERÇEKTEN kaldırıldı

**Sorun:** FAZ12.0 raporu "Top30 kaldırıldı" diyordu, ama `js/ai/ai-engine.js`'de farklı bir isimle
("Bu Haftanın Eczane Planı", `_weeklyPlan`/`WPP_V3_` cache, 30 eczaneye kadar liste) AYNI desen
hâlâ render ediliyordu — yeni max-5 "Günün Öncelikli Eczaneleri" kartının YANINDA.

**Yapılan:** `js/ai/ai-engine.js`'den şu kaldırıldı:
- Hesaplama bloğu: `_isoWeekKey()`, `_weeklyPlan`, `_cacheKey`(`WPP_V3_*`), `_clsMap`/`_clsBadge`, `eczTasks` (~93 satır)
- Render bloğu: "Bu Haftanın Eczane Planı" `task-card` div'i

Kart 1 (Bugün Sat) ve Kart 4 (Prim Durumu) **dokunulmadı**. Hiçbir başka dosya bu değişkenleri
kullanmıyordu (`grep` ile doğrulandı) — silinmesi güvenli.

**Sonuç:** AI Asistan sekmesinde artık SADECE Sayfa 1'in "Günün Öncelikli Eczaneleri" (max 5,
FAZ 10.3 + FAZ 12.0) kartı var — başka hiçbir yerde 30 eczanelik liste YOK.

---

## Düzeltme 2 — Sayısal stok girişi artık UI'dan çağrılabiliyor

**Sorun:** `stock-entry-adapter.js` (`recordStockEntry`, IndexedDB, sayısal) doğru yazılmıştı,
`digital-twin-builder.js` ondan doğru okuyordu — ama hiçbir UI elemanı `recordStockEntry()`'yi
ÇAĞIRMIYORDU. Temsilci sayısal stok girişi (örn. "Panocer 12") yapamıyordu.

**Yapılan (`index.html`):**
1. Eczane Detay Listesi'nin "📦 Stok" sütununa, mevcut nitel dropdown'ların (kritik/normal/
   yeterli — `stok-adapter.js`, DOKUNULMADI) altına bir `🔢 Sayı gir` butonu eklendi.
2. Tek bir global popover (`stokSayisalPopover` + overlay) eklendi — `URUN_ORDER`'daki 5 ürün
   için ayrı sayı input'u (serbest metin DEĞİL, FAZ 9.3'ün önerdiği "ayrı kutucuk" deseni).
3. Üç yeni fonksiyon: `openStokSayisalPopover()` (açar, `getLatestStockEntry()` ile son bilinen
   değerleri önceden doldurur), `closeStokSayisalPopover()`, `saveStokSayisalGiris()` (sadece
   doldurulan ürünleri `recordStockEntry(eczane, bugun, products)` ile kaydeder).

**Korunan:** `stok-adapter.js` (nitel, localStorage) ve mevcut dropdown UI'sı **hiç değişmedi** —
bu, FAZ 9.3'ün "iki kaynak ayrı kalsın" kararıyla tutarlı; sayısal giriş AYNI hücreye EK olarak
eklendi, var olanı EZMEDİ.

---

## Doğrulama

- `node --check` → tüm `.js` dosyaları + `index.html` inline scriptler (bilinen, FAZ 7.0'dan
  önce var olan #1 hatası dışında) temiz.
- Yeni 3 fonksiyon (`openStokSayisalPopover`, `closeStokSayisalPopover`, `saveStokSayisalGiris`)
  ve kaldırılan değişkenler (`_weeklyPlan` vb.) için duplicate/kalıntı referans taraması yapıldı —
  temiz.

## Hâlâ Açık Kalan (bu düzeltmenin kapsamı dışında, önceki audit'te not edilmişti)

- `docs/FAZ9.1`, `FAZ9.2`, `FAZ9.3`, `FAZ9.4` rapor dosyaları hâlâ eksik (kod var, rapor yok).
- `stock-entry-adapter.js`'deki ölü `SourceAdapterRegistry` referansı (zararsız, `if` korumalı)
  temizlenmedi — isterseniz ayrı bir küçük faz olarak ele alınabilir.
