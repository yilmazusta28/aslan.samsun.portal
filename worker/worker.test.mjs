// node worker/worker.test.mjs  — worker.js'i sahte GitHub/Anthropic ile uçtan uca sınar (bağımlılıksız)
import worker from './worker.js';
import { hashPassword } from './pv-auth-module.mjs';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const utf8b64 = (s) => { const by = new TextEncoder().encode(s); let b = ''; by.forEach(x => b += String.fromCharCode(x)); return btoa(b); };

// ── sahte GitHub Contents API + Anthropic
const files = new Map(); let anthropicCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.anthropic.com')) { anthropicCalls++; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })); }
  const m = /contents\/([^?]+)/.exec(url); if (!m) return new Response('?', { status: 500 });
  const path = decodeURIComponent(m[1]);
  if (!init.method || init.method === 'GET') {
    const f = files.get(path); if (!f) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ content: utf8b64(f.text), sha: f.sha }));
  }
  const body = JSON.parse(init.body); const text = new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0)));
  files.set(path, { text, sha: 's' + Math.random() }); return new Response('{}');
};
const salt = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));
const [sA, sH, sS] = [salt(16), salt(16), salt(16)];
const kv = (() => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; })();
const H = { a: await hashPassword('aykut-sifre-1', sA), h: await hashPassword('hakan-sifre-1', sH), s: await hashPassword('senol-sifre-1', sS) };
const mkEnv = (extra = {}) => ({ GITHUB_TOKEN: 'x', ANTHROPIC_API_KEY: 'k', PORTAL_PASSWORD: 'legacy-key', PV_JWT_SECRET: salt(32), PV_KV: kv,
  PV_USERS: JSON.stringify({ 'AYKUT DİNLER': { salt: sA, hash: H.a, role: 'rep' }, 'HAKAN YUMAK': { salt: sH, hash: H.h, role: 'rep' },
    'ŞENOL YILMAZ': { salt: sS, hash: H.s, role: 'admin' } }), ...extra });
const call = (env, path, body, headers = {}) => worker.fetch(new Request('https://w' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);
const login = async (env, u, p) => (await (await call(env, '/auth/login', { user: u, pass: p })).json()).token;
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
const legacy = async (env) => ({ 'X-PV-Auth': await sha(env.PORTAL_PASSWORD + ':' + Math.floor(Date.now() / 1000 / 300)), 'X-PV-User': encodeURIComponent('AYKUT DİNLER') });
const bearer = (t) => ({ Authorization: 'Bearer ' + t });
const rec = { ttt: 'AYKUT DİNLER', tarih: '2026-10-01', brick: 'X', id: 'r1', not: 'merhaba' };

// A) MOD: both  (geçiş dönemi)
let env = mkEnv();
ok((await call(env, '/dosyalar-sync', rec)).status === 401, 'kimliksiz istek 401');
ok((await call(env, '/dosyalar-sync', rec, await legacy(env))).status === 200, 'both: eski anahtar hâlâ çalışır (geçiş)');
const tA = await login(env, 'Aykut Dinler', 'aykut-sifre-1'), tH = await login(env, 'HAKAN YUMAK', 'hakan-sifre-1'), tS = await login(env, 'ŞENOL YILMAZ', 'senol-sifre-1');
ok(tA && tH && tS, 'üç kullanıcı giriş yaptı');
ok((await call(env, '/auth/login', { user: 'AYKUT DİNLER', pass: 'ilko2030' })).status === 401, 'eski ortak şifre ile giriş yok');
// B) yetki
let r = await call(env, '/dosyalar-sync', { ...rec, id: 'r2' }, bearer(tA)); ok(r.status === 200, 'temsilci kendi adına kayıt yazar');
r = await call(env, '/dosyalar-sync', { ...rec, ttt: 'HAKAN YUMAK', id: 'r3' }, bearer(tA)); ok(r.status === 403, 'temsilci BAŞKASI adına yazamaz');
r = await call(env, '/dosyalar-sync', { ...rec, ttt: 'HAKAN YUMAK', id: 'r4' }, bearer(tS)); ok(r.status === 200, 'admin herkes adına yazabilir');
const saved = JSON.parse(files.get('data/dosyalar_kayitlari.json').text).kayitlar;
ok(saved.find(x => x.id === 'r2')?.syncedBy === 'AYKUT DİNLER', 'kaydı kimin yazdığı sunucuda damgalanır (syncedBy)');
// C) başkasının kaydını değiştirme / silme
r = await call(env, '/dosyalar-update', { ...rec, id: 'r4', not: 'ele geçirildi' }, bearer(tA)); ok(r.status === 403, 'başkasının kaydı GÜNCELLENEMEZ');
r = await call(env, '/dosyalar-delete', { id: 'r4' }, bearer(tA)); ok(r.status === 403, 'başkasının kaydı SİLİNEMEZ');
r = await call(env, '/dosyalar-delete', { id: 'r2' }, bearer(tA)); ok(r.status === 200, 'kendi kaydı silinir');
r = await call(env, '/dosyalar-delete', { id: 'r4' }, bearer(tS)); ok(r.status === 200, 'admin başkasının kaydını silebilir');
// D) rota + prototip anahtarı
r = await call(env, '/rota-sync', { representative: 'HAKAN YUMAK', weekday: 1, bricks: ['a'] }, bearer(tA)); ok(r.status === 403, 'başkasının rotası yazılamaz');
r = await call(env, '/rota-sync', { representative: 'AYKUT DİNLER', weekday: 1, bricks: ['a'] }, bearer(tA)); ok(r.status === 200, 'kendi rotası yazılır');
r = await call(env, '/rota-sync', { representative: '__proto__', weekday: 1, bricks: ['a'] }, bearer(tS)); ok(r.status === 400, '__proto__ anahtarı reddedilir');
// E) tüm-dosya yazan uçlar
r = await call(env, '/sartlar-sync', { sartlar: [] }, bearer(tA)); ok(r.status === 200, 'varsayılan: temsilci /sartlar-sync yazabilir (mevcut davranış korunur)');
const envP = mkEnv({ PV_OVERWRITE_PRIVILEGED_ONLY: '1' });
const tA2 = await login(envP, 'AYKUT DİNLER', 'aykut-sifre-1'), tS2 = await login(envP, 'ŞENOL YILMAZ', 'senol-sifre-1');
ok((await call(envP, '/sartlar-sync', { sartlar: [] }, bearer(tA2))).status === 403, 'PV_OVERWRITE_PRIVILEGED_ONLY=1: temsilci 403');
ok((await call(envP, '/haber-sync', { haberler: [] }, bearer(tS2))).status === 200, '…yönetici yazabilir');
// F) AI proxy
const ai = (t, extra = {}) => call(env, '/', { model: 'claude-sonnet-5', max_tokens: 99999, messages: [{ role: 'user', content: 'x' }], ...extra }, bearer(t));
ok((await ai(tA)).status === 200 && anthropicCalls === 1, 'AI: oturumlu kullanıcı çağırır');
ok((await ai(tA, { model: 'claude-opus-9' })).status === 400, 'AI: izinsiz model reddedilir');
const big = await call(env, '/', { model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x'.repeat(250000) }] }, bearer(tA)); ok(big.status === 413, 'AI: aşırı büyük istek 413');
const bad = await worker.fetch(new Request('https://w/', { method: 'POST', headers: bearer(tA), body: '{bozuk' }), env); ok(bad.status === 400, 'AI: bozuk JSON 400 (eskiden 500 çöküyordu)');
const envL = mkEnv({ PV_AI_DAILY_LIMIT: '2' }); const tL = await login(envL, 'HAKAN YUMAK', 'hakan-sifre-1');
await call(envL, '/', { model: 'claude-sonnet-5', messages: [] }, bearer(tL)); await call(envL, '/', { model: 'claude-sonnet-5', messages: [] }, bearer(tL));
ok((await call(envL, '/', { model: 'claude-sonnet-5', messages: [] }, bearer(tL))).status === 429, 'AI: günlük sınır aşılınca 429');
// G) MOD: strict  (geçiş bitti)
const envS = mkEnv({ PV_AUTH_MODE: 'strict' });
ok((await call(envS, '/dosyalar-sync', rec, await legacy(envS))).status === 401, 'strict: sızmış eski anahtar artık İŞE YARAMAZ');
const tSt = await login(envS, 'AYKUT DİNLER', 'aykut-sifre-1');
ok((await call(envS, '/dosyalar-sync', { ...rec, id: 'z1' }, bearer(tSt))).status === 200, 'strict: jetonla çalışır');
// H) MOD: legacy (secret yok → hiçbir şey değişmez)
const envO = { GITHUB_TOKEN: 'x', ANTHROPIC_API_KEY: 'k', PORTAL_PASSWORD: 'legacy-key' };
ok((await call(envO, '/dosyalar-sync', rec, await legacy(envO))).status === 200, 'legacy (PV_JWT_SECRET yok): eski davranış aynen çalışır');
ok((await call(envO, '/auth/login', { user: 'a', pass: 'b' })).status === 501, 'legacy: /auth/login 501 (yapılandırılmamış)');
// I) CORS / preflight
const pf = await worker.fetch(new Request('https://w/auth/login', { method: 'OPTIONS' }), env);
ok(/Authorization/.test(pf.headers.get('Access-Control-Allow-Headers')), 'preflight Authorization başlığına izin verir');
console.log(`\n${pass} geçti, ${fail} başarısız`); process.exit(fail ? 1 : 0);
