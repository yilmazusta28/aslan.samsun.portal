# FAZ 12.3 — Rol Bazlı Arayüz (Temsilci / Yönetici) Raporu

## Yeni Dosya: `js/ui/role-visibility.js`

### Public API

```js
getCurrentRole()       → 'TEMSILCI' | 'YONETICI'
applyRoleVisibility()  → DOM'da role uymayan öğeleri gizler/gösterir
```

### Rol Kaynağı

```
window.LOGGED_IN_USER === 'ŞENOL YILMAZ' → YONETICI
Diğerleri                                → TEMSILCI
```

### Görünürlük Kuralları

| Öğe | TEMSILCI | YÖNETİCİ |
|-----|----------|----------|
| `snav7` (Yönetici Paneli + FAZ 12.2 formu) | `display:none` | görünür |
| `snav5` (AI Analiz Merkezi) | görünür | görünür |
| `snav6` (Eczane Yönetimi) | görünür | görünür |
| `sidebarRole` etiketi | Uzman Tıbbi Tanıtım Temsilcisi | Bölge Müdürü |

### Önemli: Hiçbir sayfa/motor silinmedi

Bu faz **sadece CSS `display` görünürlük** ekler. Veri, hesaplama ve routing katmanlarına dokunulmadı.

## Tetikleme Noktaları

1. **`DOMContentLoaded`**: Sayfa yüklendiğinde çalışır — `LOGGED_IN_USER` henüz boş olduğu için `snav7` varsayılan olarak gizli kalır.
2. **Login sonrası**: `LOGGED_IN_USER` set edildikten hemen sonra `applyRoleVisibility()` çağrılır → doğru role göre nav düzenlenir.

## Değiştirilen Dosyalar

- `js/ui/role-visibility.js` — YENİ
- `index.html` — script tag eklendi (line ~115); login handler'a `applyRoleVisibility()` çağrısı eklendi (line ~2016)
