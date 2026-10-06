// node worker/pv-auth-module.test.mjs   — bağımlılıksız birim testleri
import { hashPassword, signToken, verifyToken, handleLogin, requireAuth, canAccessTTT } from './pv-auth-module.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const secret = b64(crypto.getRandomValues(new Uint8Array(32)));
const salt1 = b64(crypto.getRandomValues(new Uint8Array(16))), salt2 = b64(crypto.getRandomValues(new Uint8Array(16)));
const env = { PV_JWT_SECRET: secret, PV_USERS: JSON.stringify({
  'AYKUT DİNLER': { salt: salt1, hash: await hashPassword('guclu-sifre-1', salt1), role: 'rep' },
  'ŞENOL YILMAZ': { salt: salt2, hash: await hashPassword('guclu-sifre-2', salt2), role: 'admin' } }),
  // sahte KV (deneme sayacı)
  PV_KV: (() => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; })() };
const login = (user, pass, ip = '1.1.1.1') => handleLogin(new Request('https://w/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ user, pass }) }), env);

// 1) doğru giriş + jeton
let r = await login('aykut dinler', 'guclu-sifre-1'); let j = await r.json();
ok(r.status === 200 && j.token && j.role === 'rep' && j.user === 'AYKUT DİNLER', 'doğru giriş (küçük harf ad dahil)');
// 2) yanlış şifre / olmayan kullanıcı → aynı hata
r = await login('AYKUT DİNLER', 'yanlis'); ok(r.status === 401, 'yanlış şifre 401');
r = await login('YOK KİŞİ', 'x'); ok(r.status === 401 && (await r.json()).error === 'invalid_credentials', 'olmayan kullanıcı aynı hata');
// 3) eski ortak şifre artık geçersiz
r = await login('ŞENOL YILMAZ', 'ilko2030'); ok(r.status === 401, 'sızmış ortak şifre reddedilir');
// 4) deneme sınırı
for (let i = 0; i < 5; i++) await login('ŞENOL YILMAZ', 'x', '9.9.9.9');
r = await login('ŞENOL YILMAZ', 'guclu-sifre-2', '9.9.9.9'); ok(r.status === 429, '5 başarısız denemeden sonra doğru şifre bile 429');
r = await login('ŞENOL YILMAZ', 'guclu-sifre-2', '8.8.8.8'); ok(r.status === 200, 'başka IP etkilenmez');
// 5) jeton doğrulama
const tok = (await (await login('AYKUT DİNLER', 'guclu-sifre-1')).json()).token;
const req = (t) => new Request('https://w/x', { headers: { Authorization: 'Bearer ' + t } });
let a = await requireAuth(req(tok), env); ok(a && a.user === 'AYKUT DİNLER' && a.role === 'rep', 'jeton kimliği');
ok(!(await requireAuth(new Request('https://w/x', { headers: { 'X-PV-User': encodeURIComponent('ŞENOL YILMAZ') } }), env)), 'X-PV-User başlığı artık kimlik sayılmaz');
// 6) kurcalama: payload'da role=admin yap, imza aynı
const [h, b, s] = tok.split('.'); const p = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
p.role = 'admin'; const fake = h + '.' + btoa(JSON.stringify(p)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + s;
ok(!(await requireAuth(req(fake), env)), 'payload kurcalama reddedilir');
// 7) alg=none
const none = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '') + '.' + b + '.';
ok(!(await requireAuth(req(none), env)), 'alg=none reddedilir');
// 8) süre dolumu
const old = await signToken({ sub: 'X', role: 'rep' }, secret, 10, Date.now() - 60000);
ok(!(await verifyToken(old, secret)), 'süresi dolmuş jeton reddedilir');
// 9) yanlış sırla imzalanmış jeton
const other = b64(crypto.getRandomValues(new Uint8Array(32)));
ok(!(await verifyToken(await signToken({ sub: 'X', role: 'admin' }, other), secret)), 'başka sırla imzalı jeton reddedilir');
// 10) kapsam
ok(canAccessTTT({ user: 'AYKUT DİNLER', role: 'rep' }, 'aykut dinler'), 'temsilci kendi verisine erişir');
ok(!canAccessTTT({ user: 'AYKUT DİNLER', role: 'rep' }, 'HAKAN YUMAK'), 'temsilci başkasına erişemez');
ok(canAccessTTT({ user: 'ŞENOL YILMAZ', role: 'admin' }, 'HAKAN YUMAK'), 'admin herkese erişir');
ok(!canAccessTTT(null, 'X'), 'kimliksiz erişemez');
console.log(`\n${pass} geçti, ${fail} başarısız`); process.exit(fail ? 1 : 0);
