// ══════════════════════════════════════════════════════════════════════
//  worker/pv-auth-module.mjs — Cloudflare Worker için sunucu taraflı kimlik doğrulama (FAZ 2)
//
//  Neden: istemcideki ortak şifre (VALID_PASS) ve worker anahtarı (_PV_WORKER_KEY) herkese
//  açık repoda. Bu modül şunu sağlar:
//    • KİŞİYE ÖZEL şifre (PBKDF2-SHA256 + tuz; düz şifre hiçbir yerde saklanmaz)
//    • Giriş denemesi sınırı (KV ile IP+kullanıcı başına; KV yoksa devre dışı kalır)
//    • İmzalı oturum jetonu (HS256 JWT, varsayılan 12 saat) — kimlik JETONDAN okunur
//      (istemcinin gönderdiği X-PV-User başlığına GÜVENİLMEZ)
//    • Rol/kapsam denetimi: yetkili roller (admin/manager) her temsilciyi, diğerleri yalnız kendini
//
//  Kullanım (mevcut worker.js içinde):
//    import { handleLogin, requireAuth, canAccessTTT } from './pv-auth-module.mjs';
//    if (url.pathname === '/auth/login') return handleLogin(request, env);
//    const auth = await requireAuth(request, env);          // {user, role} | null
//    if (!auth) return new Response('Yetkisiz', { status: 401 });
//    if (!canAccessTTT(auth, body.ttt)) return new Response('Yasak', { status: 403 });
//
//  Gizli değerler (wrangler secret put …): PV_JWT_SECRET (≥32 rastgele bayt, base64), PV_USERS (JSON)
//  PV_USERS biçimi: {"AYKUT DİNLER":{"salt":"<b64>","hash":"<b64>","role":"rep"},
//                    "ŞENOL YILMAZ":{"salt":"…","hash":"…","role":"admin"}}
//  Girdileri üretmek için:  node tools/make-user-hash.mjs "AYKUT DİNLER" rep
//  Opsiyonel KV bağlama: env.PV_KV (giriş deneme sayacı)
//  Yalnız Web Crypto kullanır (Workers + Node ≥18'de çalışır).
// ══════════════════════════════════════════════════════════════════════
const enc = new TextEncoder();
const PBKDF2_ITER = 100000;              // Workers üst sınırı
const TOKEN_TTL_S = 12 * 3600;
const MAX_FAILS = 5, FAIL_WINDOW_S = 15 * 60;
export const PRIVILEGED_ROLES = ['admin', 'manager'];

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const normName = (s) => String(s || '').trim().toLocaleUpperCase('tr-TR');

export async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: PBKDF2_ITER }, key, 256);
  return b64(bits);
}
// Sabit zamanlı karşılaştırma
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', unb64(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signToken(payload, secret, ttl = TOKEN_TTL_S, now = Date.now()) {
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}
export async function verifyToken(token, secret, now = Date.now()) {
  try {
    const [h, b, s] = String(token || '').split('.');
    if (!h || !b || !s) return null;
    if (JSON.parse(new TextDecoder().decode(unb64u(h))).alg !== 'HS256') return null;   // alg=none saldırısını reddet
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(s), enc.encode(h + '.' + b));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(b)));
    if (!p.exp || p.exp < Math.floor(now / 1000)) return null;
    return p;
  } catch (_) { return null; }
}

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

async function failCount(env, k) { return env.PV_KV ? parseInt(await env.PV_KV.get(k) || '0', 10) : 0; }
async function bumpFail(env, k) { if (env.PV_KV) await env.PV_KV.put(k, String((await failCount(env, k)) + 1), { expirationTtl: FAIL_WINDOW_S }); }
async function clearFail(env, k) { if (env.PV_KV) await env.PV_KV.delete(k); }

// POST /auth/login  {user, pass}  →  {token, user, role, exp}
export async function handleLogin(request, env, now = Date.now()) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  let body; try { body = await request.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }
  const user = normName(body.user), pass = String(body.pass || '');
  const ip = request.headers.get('CF-Connecting-IP') || 'ip?';
  const fk = 'fail:' + ip + ':' + user;
  if ((await failCount(env, fk)) >= MAX_FAILS) return json({ error: 'too_many_attempts' }, 429, { 'Retry-After': String(FAIL_WINDOW_S) });
  let users; try { users = JSON.parse(env.PV_USERS || '{}'); } catch (_) { users = {}; }
  const rec = Object.entries(users).find(([n]) => normName(n) === user)?.[1];
  // Kullanıcı yoksa da aynı maliyette hash çalıştır (kullanıcı adı sızdırmayı zorlaştırır)
  const salt = rec ? rec.salt : b64(new Uint8Array(16));
  const calc = await hashPassword(pass, salt);
  if (!rec || !safeEqual(calc, rec.hash)) { await bumpFail(env, fk); return json({ error: 'invalid_credentials' }, 401); }
  await clearFail(env, fk);
  const token = await signToken({ sub: user, role: rec.role || 'rep' }, env.PV_JWT_SECRET, TOKEN_TTL_S, now);
  return json({ token, user, role: rec.role || 'rep', exp: Math.floor(now / 1000) + TOKEN_TTL_S });
}

// Authorization: Bearer <jeton>  →  {user, role} | null   (kimlik YALNIZ jetondan gelir)
export async function requireAuth(request, env, now = Date.now()) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m || !env.PV_JWT_SECRET) return null;
  const p = await verifyToken(m[1], env.PV_JWT_SECRET, now);
  return p ? { user: p.sub, role: p.role } : null;
}
// Yetkili roller her temsilciyi, diğerleri yalnız kendi verisini görebilir/yazabilir
export function canAccessTTT(auth, ttt) {
  if (!auth) return false;
  if (PRIVILEGED_ROLES.includes(auth.role)) return true;
  return normName(ttt) === normName(auth.user);
}
