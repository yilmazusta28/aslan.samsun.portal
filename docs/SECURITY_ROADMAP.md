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

## Faz 2 — Sunucu taraflı kimlik doğrulama (asıl çözüm) 🟡
Sorun: `VALID_PASS='ilko2030'` ve `_PV_WORKER_KEY` açık repoda → herkes herkes olarak girebilir; temsilci kilidi (`ttt-lock.js`) yalnız arayüzdür.

Hazır: `worker/pv-auth-module.mjs` (+ 16 birim test, `node worker/pv-auth-module.test.mjs`)
- Kişiye özel şifre (PBKDF2-SHA256, tuzlu), giriş deneme sınırı (KV), imzalı 12 saatlik JWT
- Kimlik **jetondan** okunur (`X-PV-User` başlığına güvenilmez), `canAccessTTT()` ile kapsam denetimi

Uygulama adımları (sırayla):
1. `worker.js`'te her uca `requireAuth()` + `canAccessTTT()` ekle (yazma/silme uçları dahil) — **`worker.js` gerekli**
2. `wrangler secret put PV_JWT_SECRET` (32 rastgele bayt, base64) ve `PV_USERS` (her kişi için `node tools/make-user-hash.mjs "AD" rep`)
3. İstemci: `doLogin` → `POST /auth/login`, jeton `sessionStorage`; `pvAuthHeaders()` → `Authorization: Bearer`
4. Eski `_PV_WORKER_KEY` kabulünü kapat → `VALID_PASS`, `VALID_USERS`, `_PV_WORKER_KEY`'i istemciden sil
5. Tüm kullanıcılara yeni şifre ver; Anthropic anahtarını döndür (rotate)

## Faz 3 — Veri gizliliği ⏳
CSV'ler (satış, hedef, prim, MI/GIGI) herkese açık Pages'te. Seçenekler: (a) repoyu private yap + CSV'leri worker üzerinden (yetkili) servis et,
(b) Cloudflare Access ile siteyi kimlik arkasına al. Faz 2 tamamlanmadan anlamlı değil.

## Faz 4 — Sürekli ⏳
- CI: `node --check` yanında `worker/*.test.mjs`, "ham `innerHTML` + kullanıcı alanı" lint kuralı
- GitHub Actions'ı commit SHA'sına sabitle; Dependabot/`npm audit` (xlsx 0.18.5 → okuma eklenirse 0.20.x)
- `'unsafe-inline'`'ı kaldırmak için satır içi `onclick`'leri `addEventListener`'a taşı (uzun vadeli)
