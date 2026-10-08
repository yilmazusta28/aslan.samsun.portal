# Güvenlik Yol Haritası — PHARMA VISION

Durum: ✅ yapıldı · 🟡 hazır, devreye alınmayı bekliyor · ⏳ planlandı

## Faz 1 — İstemci tarafı sertleştirme (bu sürümde) ✅
| # | Bulgu | Düzeltme | Durum |
|---|---|---|---|
| 1.1 | Saklı XSS (kullanıcı metni `innerHTML`'e ham basılıyor) | `js/core/security.js` → `pvEsc / pvJsArg / pvSafeUrl / pvOpen`; `dosyalar-page`, `dosyalar-manager-summary`, `sales-conditions`, `prim-gecmis` uygulandı | ✅ (başlangıç) |
| 1.2 | `window.open` ile `noopener` yok, `javascript:` URL | `pvOpen()` (şema filtresi + noopener,noreferrer) | ✅ |
| 1.3 | CDN script'lerinde SRI yok | Chart.js / PapaParse / xlsx `vendor/` altına alındı (+ SHA256SUMS, lisanslar) | ✅ |
| 1.4 | CSP yok | `<meta>` CSP: harici script yok, bağlantılar yalnız worker + GitHub; `object-src 'none'` | ✅ (`'unsafe-inline'` şimdilik gerekli) |
| 1.5 | `.claude/settings.local.json` repoda | `.gitignore` + **`git rm --cached .claude/settings.local.json`** (elle) | 🟡 |

**Kalan XSS işi:** `innerHTML` 227 yerde. Kullanıcı/uzak kaynaklı alan basan her yer `pvEsc()`'e çevrilmeli.
Öncelik: worker'dan gelen kayıtları gösterenler (rota planı, stok girişi, saha gözlem, şartlar, AI sohbet çıktısı).
Kural (code review): *"Kullanıcı/uzak/CSV kaynaklı metin HTML'e `pvEsc()` olmadan basılmaz."*

## Faz 2 — Sunucu taraflı kimlik doğrulama ✅ kod hazır · 🟡 devreye alma sizde
Sorun: `VALID_PASS` ve `_PV_WORKER_KEY` açık repoda → herkes herkes olarak girebilir.

Yapıldı (hepsi testli: `node worker/pv-auth-module.test.mjs` 16, `node worker/worker.test.mjs` 28):
- **`worker/worker.js`** (sizin worker'ınızın yamalı hâli, tek dosya — Cloudflare'e olduğu gibi yapıştırılır):
  - `/auth/login` (kişiye özel şifre, PBKDF2, 5 hatada 429), imzalı 12 saatlik jeton
  - Üç mod (`PV_AUTH_MODE`): `legacy` (eski davranış) → `both` (geçiş) → `strict` (yalnız jeton)
  - Yetki: temsilci yalnız **kendi** adına yazar/günceller/siler/rota girer; admin/manager hepsini yapar; başkasının kaydı id tahminiyle değiştirilemez/silinemez
  - Kaydı kimin yazdığı sunucuda damgalanır (`syncedBy`); AI proxy: gövde sınırı, bozuk JSON 400, kullanıcı başına günlük sınır (KV), `__proto__` rota anahtarı reddi
- **İstemci:** `window.PV_SERVER_AUTH` bayrağı (index.html, **şimdilik false**) · `pv-auth.js` jeton/oturum yönetimi · `doLogin` sunucu girişi. Bayrak kapalıyken hiçbir şey değişmez.

### Devreye alma (sırayla, her adım geri alınabilir)
1. **Worker'ı deploy et:** `worker/worker.js`'i Cloudflare'e yükle. `PV_JWT_SECRET` tanımlı olmadığı için hâlâ `legacy` çalışır → kesinti yok.
2. **Gizli değerler** (`wrangler secret put …`): `PV_JWT_SECRET` (`openssl rand -base64 32`) ve `PV_USERS`:
   her kişi için `node tools/make-user-hash.mjs "AYKUT DİNLER" rep` çıktısını tek JSON'da birleştir
   (`ŞENOL YILMAZ`/`ADMIN` → `admin`, `YILMAZ USTA` → `manager`, diğerleri `rep`). İsteğe bağlı KV: `PV_KV` bağla (deneme sınırı + AI günlük sınırı için; `PV_AI_DAILY_LIMIT` varsayılan 300).
3. **Dene:** `curl -X POST https://<worker>/auth/login -d '{"user":"AYKUT DİNLER","pass":"…"}'` → `token` dönmeli. Bu aşamada mod otomatik `both`.
4. **Siteyi aç:** `index.html`'de `window.PV_SERVER_AUTH = true` → yayınla. Herkes kişisel şifresiyle girer (eski ortak şifre artık çalışmaz).
5. **Herkes taşınınca:** `PV_AUTH_MODE=strict` → sızmış eski anahtar işe yaramaz.
6. **Temizlik:** `VALID_PASS`, `VALID_USERS` şifre kontrolü ve `_PV_WORKER_KEY`'i istemciden sil; `PORTAL_PASSWORD` secret'ını sil; `ANTHROPIC_API_KEY`'i döndür (eski anahtar kaynakta durduğu sürece kötüye kullanılmış olabilir).

`PV_OVERWRITE_PRIVILEGED_ONLY=1` → `/sartlar-sync` ve `/haber-sync` (dosyanın TAMAMINI ezen uçlar) yalnız admin/manager'a açılır. **Karar gerekli:** bu uçları temsilciler kullanıyor mu? Kullanmıyorsa `1` yapın (bir temsilcinin tüm dosyayı ezmesini engeller).

## Faz 3 — Veri gizliliği ⏳
CSV'ler (satış, hedef, prim, MI/GIGI) herkese açık Pages'te. Seçenekler: (a) repoyu private yap + CSV'leri worker üzerinden (yetkili) servis et,
(b) Cloudflare Access ile siteyi kimlik arkasına al. Faz 2 tamamlanmadan anlamlı değil.

## Faz 4 — Sürekli ⏳
- CI: `node --check` yanında `worker/*.test.mjs`, "ham `innerHTML` + kullanıcı alanı" lint kuralı
- GitHub Actions'ı commit SHA'sına sabitle; Dependabot/`npm audit` (xlsx 0.18.5 → okuma eklenirse 0.20.x)
- `'unsafe-inline'`'ı kaldırmak için satır içi `onclick`'leri `addEventListener`'a taşı (uzun vadeli)
