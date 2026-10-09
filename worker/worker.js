// ── GÜVENLİK DÜZELTMESİ (kod incelemesi bulgusu — worker.js'teki AI proxy
// endpoint'i kimlik doğrulaması YOKTU): `ALLOWED` değişkeni yalnızca CORS
// response header'ı için kullanılıyordu — bu, TARAYICI DIŞINDAN (curl,
// Postman, bir script) gelen istekleri ENGELLEMEZ; sadece tarayıcı bunu
// kendi güvenlik modeli için okur. Worker URL'i GitHub'daki herkese açık
// kaynak kodda (ai-service.js) durduğundan, bunu bulan biri
// ANTHROPIC_API_KEY'i sınırsız harcayabilir, GITHUB_TOKEN ile veri
// yazabilirdi.
//
// Çözüm: paylaşılan gizli bir anahtardan (env.PORTAL_PASSWORD — LOGIN
// şifresinden AYRI, sadece worker yetkilendirmesi için kullanılan uzun
// rastgele bir değer) türetilen, 5 dakikada bir değişen (rotating) bir
// SHA-256 token. İstemci giriş yaptıktan sonra bu token'ı her istekte
// `X-PV-Auth` header'ında gönderir (bkz. js/core/pv-auth.js). Worker aynı
// hesaplamayı yapıp karşılaştırır; eşleşmezse 401 döner. NOT: anahtar
// yine client-side JS'te durduğu için KARARLI bir saldırganı durdurmaz —
// asıl amacı, worker URL'ini bulan ANONİM bot/scanner'ları ve URL/istek
// kopyalayıp tekrar oynatmayı (token'lar 5-10 dk sonra geçersiz olur)
// engellemektir.
const PV_AUTH_WINDOW_SEC = 300; // 5 dakikalık rotasyon penceresi

async function _pvSha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Zamanlama (timing) saldırılarına karşı sabit-zamanlı karşılaştırma
function _pvConstantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function _verifyPvAuth(request, env) {
  if (!env.PORTAL_PASSWORD) return false; // secret tanımlı değilse: fail-closed (reddet)
  const token = request.headers.get('X-PV-Auth');
  if (!token) return false;
  const nowWin = Math.floor(Date.now() / 1000 / PV_AUTH_WINDOW_SEC);
  // Şu anki VE bir önceki pencere kabul edilir (saat kayması / pencere
  // sınırında atılan istekler yanlışlıkla reddedilmesin diye).
  for (const win of [nowWin, nowWin - 1]) {
    const expected = await _pvSha256Hex(env.PORTAL_PASSWORD + ':' + win);
    if (_pvConstantTimeEqual(expected, token)) return true;
  }
  return false;
}

// ══════════════ FAZ 2: SUNUCU TARAFLI KİMLİK DOĞRULAMA (pv-auth-module.mjs ile aynı kod) ══════════════
const enc = new TextEncoder();
const PBKDF2_ITER = 100000;              // Workers üst sınırı
const TOKEN_TTL_S = 12 * 3600;
const MAX_FAILS = 5, FAIL_WINDOW_S = 15 * 60;
const PRIVILEGED_ROLES = ['admin', 'manager'];

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const normName = (s) => String(s || '').trim().toLocaleUpperCase('tr-TR');

async function hashPassword(password, saltB64) {
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
async function signToken(payload, secret, ttl = TOKEN_TTL_S, now = Date.now()) {
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}
async function verifyToken(token, secret, now = Date.now()) {
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
async function handleLogin(request, env, now = Date.now()) {
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
async function requireAuth(request, env, now = Date.now()) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m || !env.PV_JWT_SECRET) return null;
  const p = await verifyToken(m[1], env.PV_JWT_SECRET, now);
  return p ? { user: p.sub, role: p.role } : null;
}
// Yetkili roller her temsilciyi, diğerleri yalnız kendi verisini görebilir/yazabilir
function canAccessTTT(auth, ttt) {
  if (!auth) return false;
  if (PRIVILEGED_ROLES.includes(auth.role)) return true;
  return normName(ttt) === normName(auth.user);
}


// ══ FAZ 2 — YARDIMCILAR (kimlik/yetki) ═══════════════════════════════════
// auth: {user, role, verified}. verified=true → imzalı jetondan (güvenilir); false → eski ortak anahtar (X-PV-User doğrulanmamış).
function _authzDeny(auth, ttt, headers) {
  if (!auth || !auth.verified) return null;                         // eski mod: davranış değişmez
  if (ttt == null || ttt === '') return null;
  if (canAccessTTT(auth, ttt)) return null;
  return new Response(JSON.stringify({ error: 'bu temsilci adına işlem yetkiniz yok' }), { status: 403, headers });
}
function _stamp(auth) {                                             // kaydı sunucuda KİM yazdı (istemci beyanına güvenme)
  return (auth && auth.verified) ? { syncedBy: auth.user } : {};
}
function _withCors(res, ALLOWED) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', ALLOWED); h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env) {
    const ALLOWED = 'https://yilmazusta28.github.io';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': ALLOWED,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-PV-Auth, X-PV-User',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      }});
    }

    // ── FAZ 2: kişiye özel giriş (kimlik doğrulama GEREKTİRMEZ) ─────────
    if (url.pathname === '/auth/login') {
      if (!env.PV_JWT_SECRET) return _withCors(new Response(JSON.stringify({ error: 'sunucu girişi yapılandırılmadı' }), { status: 501, headers: { 'Content-Type': 'application/json' } }), ALLOWED);
      return _withCors(await handleLogin(request, env), ALLOWED);
    }

    // ── GÜVENLİK: tüm route'lardan ÖNCE kimlik doğrulama ────────────────
    // PV_AUTH_MODE: 'legacy' (yalnız eski X-PV-Auth) | 'both' (jeton VEYA eski anahtar — geçiş dönemi)
    //               | 'strict' (YALNIZ imzalı jeton). Tanımsızsa: PV_JWT_SECRET varsa 'both', yoksa 'legacy'.
    const mode = env.PV_AUTH_MODE || (env.PV_JWT_SECRET ? 'both' : 'legacy');
    let auth = null;
    if (mode !== 'legacy') {
      const a = await requireAuth(request, env);
      if (a) auth = { user: a.user, role: a.role, verified: true };
    }
    if (!auth && mode !== 'strict' && (await _verifyPvAuth(request, env))) {
      let u = ''; try { u = decodeURIComponent(request.headers.get('X-PV-User') || ''); } catch (e) { /* yoksay */ }
      auth = { user: u, role: 'legacy', verified: false };            // doğrulanmamış kimlik: yetki kararı VERİLMEZ
    }
    if (!auth) {
      return new Response(JSON.stringify({ error: 'yetkisiz erişim — geçerli oturum/anahtar yok' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED, 'Vary': 'Origin' },
      });
    }

    // ── Rota planı GitHub senkron endpoint'i ───────────────────────────
    // PHARMA VISION > Saha Yönetimi > Ekip Haftalık Rota Planları
    if (url.pathname === '/rota-sync') {
      return handleRotaSync(request, env, ALLOWED, auth);
    }

    // ── BUG DÜZELTMESİ (kod incelemesi bulgusu — bkz. Doküman İnceleme
    // Raporu): index.html dört adet daha worker senkron URL'i tanımlıyor
    // ve ilgili client kodları (saha-gozlem-store.js, sales-conditions.js)
    // bunlara fiilen POST atıyor — ama bu dört endpoint'in HİÇBİRİ eskiden
    // worker.js'de tanımlı DEĞİLDİ. Sonuç: bu istekler eşleşen bir route
    // bulamayıp aşağıdaki "AI proxy" dalına düşüyor, gövdeleri (ör.
    // {kategori, eczane, ttt, ...}) Anthropic'in beklediği {model,
    // messages} şemasına uymadığı için Anthropic 400 hatası döndürüyor,
    // worker bunu DEĞİŞTİRMEDEN ama HTTP 200 ile istemciye iletiyor — bu
    // yüzden istemcideki `if (!res.ok) console.warn(...)` kontrolü hiç
    // tetiklenmiyor ve senkron SESSİZCE başarısız oluyordu. Saha gözlemi,
    // satış şartları ve haber takibi verileri yalnızca tarayıcıdaki
    // IndexedDB/localStorage'da kalıyor, yöneticinin GitHub'daki
    // data/*.json dosyalarına hiç yazılmıyordu.
    if (url.pathname === '/gozlem-sync') {
      return handleAppendSync(request, env, ALLOWED, {
        auth, tttField: 'ttt',
        path: 'data/saha_gozlemleri.json',
        listKey: 'gozlemler',
        requiredFields: ['eczane', 'ttt'],
        commitPrefix: 'gozlem',
      });
    }
    if (url.pathname === '/stok-sync') {
      return handleAppendSync(request, env, ALLOWED, {
        auth,
        path: 'data/stok_girisleri.json',
        listKey: 'girisler',
        requiredFields: ['pharmacy'],
        commitPrefix: 'stok',
      });
    }
    // ── FAZ 19.0: "Dosyalar" sayfası — temsilcinin manuel girdiği saha
    // sunum/toplantı kayıtları. stok-sync ile AYNI append deseni: her
    // istek data/dosyalar_kayitlari.json'daki "kayitlar" dizisine EKLENİR,
    // üzerine yazılmaz — böylece tüm temsilcilerin kayıtları GitHub'da
    // tek dosyada birikir ve Şenol Yılmaz (Bölge Müdürü) hepsini görebilir.
    if (url.pathname === '/dosyalar-sync') {
      return handleAppendSync(request, env, ALLOWED, {
        auth, tttField: 'ttt',
        path: 'data/dosyalar_kayitlari.json',
        listKey: 'kayitlar',
        requiredFields: ['ttt', 'tarih', 'brick'],
        commitPrefix: 'dosyalar',
      });
    }
    // ── FAZ 21.0: "Dosyalar" sayfasında düzenleme/silme desteği ─────────
    // /dosyalar-update: id'si eşleşen kaydı günceller (yoksa ekler — upsert).
    // /dosyalar-delete: id'si eşleşen kaydı listeden çıkarır.
    if (url.pathname === '/dosyalar-update') {
      return handleUpdateSync(request, env, ALLOWED, {
        auth, tttField: 'ttt',
        path: 'data/dosyalar_kayitlari.json',
        listKey: 'kayitlar',
        requiredFields: ['id', 'ttt', 'tarih', 'brick'],
        commitPrefix: 'dosyalar-guncelle',
      });
    }
    if (url.pathname === '/dosyalar-delete') {
      return handleDeleteSync(request, env, ALLOWED, {
        auth,
        path: 'data/dosyalar_kayitlari.json',
        listKey: 'kayitlar',
        requiredFields: ['id'],
        commitPrefix: 'dosyalar-sil',
      });
    }
    if (url.pathname === '/sartlar-sync') {
      return handleOverwriteSync(request, env, ALLOWED, {
        auth,
        path: 'data/satis_sartlari.json',
        commitPrefix: 'sartlar',
      });
    }
    if (url.pathname === '/haber-sync') {
      return handleOverwriteSync(request, env, ALLOWED, {
        auth,
        path: 'data/piyasa_haberleri.json',
        commitPrefix: 'haber',
      });
    }

    // ── MEVCUT: AI (Claude API) proxy mantığı — kimlik doğrulama yukarıda
    // eklendi ─────────────────────────
    // FAZ 2: gövde boyutu/JSON doğrulaması + kullanıcı başına günlük kullanım sınırı (PV_KV varsa)
    const _raw = await request.text();
    if (_raw.length > 200000) {
      return new Response(JSON.stringify({ error: { message: 'istek çok büyük' } }), { status: 413, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED } });
    }
    let body;
    try { body = JSON.parse(_raw); } catch (e) {
      return new Response(JSON.stringify({ error: { message: 'geçersiz JSON' } }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED } });
    }
    if (env.PV_KV && auth.verified) {
      const _day = new Date().toISOString().slice(0, 10);
      const _k = 'ai:' + auth.user + ':' + _day;
      const _n = parseInt((await env.PV_KV.get(_k)) || '0', 10);
      const _limit = parseInt(env.PV_AI_DAILY_LIMIT || '300', 10);
      if (_n >= _limit) {
        return new Response(JSON.stringify({ error: { message: 'günlük AI kullanım sınırına ulaşıldı' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED } });
      }
      await env.PV_KV.put(_k, String(_n + 1), { expirationTtl: 172800 });
    }

    // ── GÜVENLİK EKİ: model + max_tokens sınırlaması (bkz. Eylül 2026
    // olayı — bu proxy body.model'i hiç kontrol etmiyordu; X-PV-Auth
    // bulunsa bile portalın kendisi PAHALI bir model veya çok yüksek
    // max_tokens göndermeye zorlanabilirdi/kötüye kullanılabilirdi).
    // Portal SADECE claude-sonnet-5 kullanıyor (bkz. ai-service.js,
    // ai-engine.js, voice-briefing.js) — bağlantı testinde ayrıca
    // claude-haiku-4-5-20251001 kullanılıyor. Bunların dışındaki
    // herhangi bir model reddedilir; max_tokens 1000'i geçemez.
    const ALLOWED_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001'];
    const MAX_TOKENS_CAP = 1000;

    if (!ALLOWED_MODELS.includes(body.model)) {
      return new Response(JSON.stringify({
        error: { message: 'izin verilmeyen model: ' + body.model },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED },
      });
    }
    if (typeof body.max_tokens !== 'number' || body.max_tokens > MAX_TOKENS_CAP) {
      body.max_tokens = MAX_TOKENS_CAP;
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED,
      }
    });
  }
};

// ── FAZ 22.0 BUG DÜZELTMESİ — UTF-8 base64 çözümü ──────────────────────
// ESKİ KOD: `atob(meta.content)` → atob() her baytı Latin-1 karakteri gibi
// döndürür. GitHub'daki JSON UTF-8 kodlu olduğundan, Türkçe karakterlerin
// 2 baytı iki ayrı karaktere dönüşüyordu ("ŞENOL" → "ÅENOL"). Bu bozuk
// metin sonra `encodeURIComponent` ile TEKRAR UTF-8'e kodlanıp yazıldığı
// için bozulma HER yazma turunda katlanarak büyüyordu (bkz. canlı
// data/rota_planlari.json: "ÃÂÃÂÃÂ..."). Artık okuma TextDecoder,
// yazma TextEncoder ile yapılıyor — tam tur (round-trip) kayıpsız.
function _b64ToUtf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function _utf8ToB64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ── Ortak: GitHub Contents API'den mevcut dosyayı oku ────────────────────
async function _ghReadJson(apiBase, branch, ghHeaders, fallback) {
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (getRes.status === 200) {
    const meta = await getRes.json();
    const decoded = _b64ToUtf8(meta.content || '');
    try {
      return { data: JSON.parse(decoded), sha: meta.sha };
    } catch (e) {
      return { data: fallback, sha: meta.sha };
    }
  }
  if (getRes.status === 404) {
    return { data: fallback, sha: null };
  }
  throw new Error('github read failed: ' + getRes.status);
}

// ── Ortak: GitHub Contents API'ye yaz (409 çakışmasında bir kez retry) ──
async function _ghWriteJson(apiBase, branch, ghHeaders, content, sha, message, retryOnConflict) {
  const newContentB64 = _utf8ToB64(JSON.stringify(content, null, 2));
  let putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: newContentB64, branch, ...(sha ? { sha } : {}) }),
  });

  if (putRes.status === 409 && retryOnConflict) {
    const { data: freshData, sha: freshSha } = await retryOnConflict();
    const retryB64 = _utf8ToB64(JSON.stringify(freshData, null, 2));
    putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message + ' (retry)', content: retryB64, branch, sha: freshSha }),
    });
  }
  return putRes;
}

function _ghContext(env) {
  const OWNER = 'yilmazusta28';
  const REPO = 'aslan.samsun.portal';
  const BRANCH = 'main';
  return {
    BRANCH,
    ghHeaders: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'pharma-vision-worker',
    },
    apiBaseFor: (path) => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
  };
}

// ── /gozlem-sync ve /stok-sync: kayıt listesine EKLEME (append) ─────────
async function handleAppendSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }
  const missing = (cfg.requiredFields || []).filter((f) => !payload || !payload[f]);
  if (missing.length) {
    return new Response(JSON.stringify({ error: 'eksik alan(lar): ' + missing.join(', ') }), { status: 400, headers: corsHeaders });
  }
  { // FAZ 2: doğrulanmış kullanıcı yalnız KENDİ temsilci adına yazabilir (yetkili roller hariç)
    const _deny = _authzDeny(cfg.auth, cfg.tttField ? payload[cfg.tttField] : null, corsHeaders);
    if (_deny) return _deny;
  }

  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const fallback = { [cfg.listKey]: [], updatedAt: null };

  try {
    let { data: current, sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, fallback);
    if (!Array.isArray(current[cfg.listKey])) current[cfg.listKey] = [];
    current[cfg.listKey].push(Object.assign({}, payload, { syncedAt: new Date().toISOString(), ..._stamp(cfg.auth) }));
    current.updatedAt = new Date().toISOString();

    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, current, sha,
      `${cfg.commitPrefix}: yeni kayıt eklendi`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, fallback).then(({ data, sha }) => {
        if (!Array.isArray(data[cfg.listKey])) data[cfg.listKey] = [];
        data[cfg.listKey].push(Object.assign({}, payload, { syncedAt: new Date().toISOString(), ..._stamp(cfg.auth) }));
        data.updatedAt = new Date().toISOString();
        return { data, sha };
      })
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: String(errBody).slice(0, 200) }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── /dosyalar-update: id'si eşleşen kaydı günceller (yoksa ekler) ───────
async function handleUpdateSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }
  const missing = (cfg.requiredFields || []).filter((f) => !payload || !payload[f]);
  if (missing.length) {
    return new Response(JSON.stringify({ error: 'eksik alan(lar): ' + missing.join(', ') }), { status: 400, headers: corsHeaders });
  }
  { // FAZ 2: doğrulanmış kullanıcı yalnız KENDİ temsilci adına yazabilir (yetkili roller hariç)
    const _deny = _authzDeny(cfg.auth, cfg.tttField ? payload[cfg.tttField] : null, corsHeaders);
    if (_deny) return _deny;
  }

  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const fallback = { [cfg.listKey]: [], updatedAt: null };

  function _applyUpdate(data) {
    if (!Array.isArray(data[cfg.listKey])) data[cfg.listKey] = [];
    const list = data[cfg.listKey];
    const idx = list.findIndex((r) => r && r.id === payload.id);
    const updated = Object.assign({}, payload, { syncedAt: new Date().toISOString(), ..._stamp(cfg.auth) });
    if (idx >= 0) list[idx] = updated; else list.push(updated);
    data.updatedAt = new Date().toISOString();
    return data;
  }

  try {
    let { data: current, sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, fallback);
    { // FAZ 2: başkasının kaydını (id tahminiyle) değiştirme/silme engeli
      const _ex = (Array.isArray(current[cfg.listKey]) ? current[cfg.listKey] : []).find((r) => r && r.id === payload.id);
      if (_ex) { const _d = _authzDeny(cfg.auth, _ex.ttt, corsHeaders); if (_d) return _d; }
    }
    current = _applyUpdate(current);

    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, current, sha,
      `${cfg.commitPrefix}: kayıt güncellendi (${payload.id})`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, fallback).then(({ data, sha }) => ({ data: _applyUpdate(data), sha }))
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: String(errBody).slice(0, 200) }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── /dosyalar-delete: id'si eşleşen kaydı listeden çıkarır ──────────────
async function handleDeleteSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }
  const missing = (cfg.requiredFields || []).filter((f) => !payload || !payload[f]);
  if (missing.length) {
    return new Response(JSON.stringify({ error: 'eksik alan(lar): ' + missing.join(', ') }), { status: 400, headers: corsHeaders });
  }
  { // FAZ 2: doğrulanmış kullanıcı yalnız KENDİ temsilci adına yazabilir (yetkili roller hariç)
    const _deny = _authzDeny(cfg.auth, cfg.tttField ? payload[cfg.tttField] : null, corsHeaders);
    if (_deny) return _deny;
  }

  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const fallback = { [cfg.listKey]: [], updatedAt: null };

  function _applyDelete(data) {
    if (!Array.isArray(data[cfg.listKey])) data[cfg.listKey] = [];
    data[cfg.listKey] = data[cfg.listKey].filter((r) => !(r && r.id === payload.id));
    data.updatedAt = new Date().toISOString();
    return data;
  }

  try {
    let { data: current, sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, fallback);
    { // FAZ 2: başkasının kaydını (id tahminiyle) değiştirme/silme engeli
      const _ex = (Array.isArray(current[cfg.listKey]) ? current[cfg.listKey] : []).find((r) => r && r.id === payload.id);
      if (_ex) { const _d = _authzDeny(cfg.auth, _ex.ttt, corsHeaders); if (_d) return _d; }
    }
    current = _applyDelete(current);

    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, current, sha,
      `${cfg.commitPrefix}: kayıt silindi (${payload.id})`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, fallback).then(({ data, sha }) => ({ data: _applyDelete(data), sha }))
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: String(errBody).slice(0, 200) }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── /sartlar-sync ve /haber-sync: dosyanın TAMAMINI üzerine yaz (overwrite) ─
async function handleOverwriteSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }

  // FAZ 2: dosyanın TAMAMINI ezen uçlar — PV_OVERWRITE_PRIVILEGED_ONLY=1 ise yalnız admin/manager yazabilir
  if (cfg.auth && cfg.auth.verified && env.PV_OVERWRITE_PRIVILEGED_ONLY === '1' && !PRIVILEGED_ROLES.includes(cfg.auth.role)) {
    return new Response(JSON.stringify({ error: 'bu işlem için yönetici yetkisi gerekir' }), { status: 403, headers: corsHeaders });
  }
  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const content = Object.assign({}, payload, { updatedAt: new Date().toISOString() });

  try {
    const { sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, {});
    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, content, sha,
      `${cfg.commitPrefix}: güncellendi`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, {}).then(({ sha }) => ({ data: content, sha }))
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: String(errBody).slice(0, 200) }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── BUG DÜZELTMESİ (tarayıcılar arası tutarsız rota planı dökümü) ──────────
// TEŞHİS: route-plan-input.js (istemci, FAZ 15.0) her kayıtta artık
// {representative, weekGroup, weekday, bricks} gönderiyor (weekGroup: 1=A
// Haftası, 2=B Haftası) — ama bu fonksiyon weekGroup'u HİÇ OKUMUYOR ve
// GitHub'a DÜZ (flat) `plans[temsilci][gün] = bricks` olarak yazıyordu.
// Sonuç: A Haftası Pazartesi kaydı ile B Haftası Pazartesi kaydı GitHub'da
// AYNI ANAHTARDA (gün=1) ÇAKIŞIYOR, biri diğerinin üstüne yazılıyordu.
// Bu paylaşımlı (GitHub) dosya; Yönetici Paneli'nin VE farklı bir
// tarayıcıda/cihazda IndexedDB'si boş olan herhangi bir oturumun tek veri
// kaynağıdır — kendi tarayıcınızdaki (yerel IndexedDB'de duran, bozulmamış)
// veriyle GitHub'daki bu çakışmış veri farklı olduğu için "her tarayıcıda
// farklı döküm" görülüyordu.
// ÇÖZÜM: weekGroup artık okunuyor ve GitHub'a NESTED
// `plans[temsilci][weekGroup][gün] = bricks` olarak yazılıyor —
// route-plan-input.js'in fetchTeamPlans() zaten bu nested formatı bekliyor.
// Dosyada hâlâ eski DÜZ formatta kalmış bir temsilci varsa (bu koddan önce
// yazılmış), önce otomatik olarak "1" (A Haftası) altına göçürülüyor, kayıp
// olmadan yeni kayıt bunun üstüne ekleniyor.
// repData: mevcut dosyadaki plans[temsilci] değeri. Eski (FAZ 15.0 öncesi
// veya bu bug nedeniyle GitHub'a düz yazılmış) formatta ise
// {gün: bricks[]} şeklindedir (değerler doğrudan dizi) — bunu nested
// {"1": {gün: bricks[]}} (A Haftası) altına göçürür. Zaten nested ise
// (değerler obje) OLDUĞU GİBİ döner. Tanımsızsa boş obje döner.
function _normalizeLegacyRepPlan(repData) {
  if (!repData) return {};
  var isLegacyFlat = Object.keys(repData).some(function (k) { return Array.isArray(repData[k]); });
  if (isLegacyFlat) return { '1': repData };
  return repData;
}

async function handleRotaSync(request, env, ALLOWED, auth) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED,
  };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }

  const { representative, weekday, bricks } = payload || {};
  // weekGroup FAZ 15.0 öncesi istemcilerde YOK olabilir — böyle durumda
  // geriye uyumlu şekilde A Haftası (1) varsayılır (bkz. route-plan-input.js
  // içindeki aynı geriye-uyum kararı).
  const weekGroup = (payload && (payload.weekGroup === 1 || payload.weekGroup === 2)) ? payload.weekGroup : 1;
  if (!representative || !weekday || !Array.isArray(bricks)) {
    return new Response(JSON.stringify({ error: 'representative, weekday, bricks zorunlu' }), { status: 400, headers: corsHeaders });
  }

  // FAZ 2: yalnız kendi rotası (yetkili roller hariç) + prototip kirletme anahtarlarını reddet
  if (['__proto__', 'constructor', 'prototype'].includes(String(representative))) {
    return new Response(JSON.stringify({ error: 'geçersiz temsilci' }), { status: 400, headers: corsHeaders });
  }
  { const _deny = _authzDeny(auth, representative, corsHeaders); if (_deny) return _deny; }

  const OWNER = 'yilmazusta28';
  const REPO = 'aslan.samsun.portal';
  const BRANCH = 'main';
  const PATH = 'data/rota_planlari.json';
  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const ghHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'pharma-vision-rota-sync',
  };

  // 1) Mevcut dosyayı oku (SHA gerekli — GitHub PUT için zorunlu)
  let current = { plans: {}, updatedAt: null };
  let sha = null;
  try {
    const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
    if (getRes.status === 200) {
      const meta = await getRes.json();
      sha = meta.sha;
      const decoded = _b64ToUtf8(meta.content || '');
      current = JSON.parse(decoded);
      if (!current.plans) current.plans = {};
    } else if (getRes.status !== 404) {
      return new Response(JSON.stringify({ error: 'github read failed', status: getRes.status }), { status: 502, headers: corsHeaders });
    }
  } catch (e) {
    // dosya hiç yok / bozuk → sıfırdan başla
  }

  // 2) Güncelle: plans[representative][weekGroup][weekday] = bricks
  //    (eski düz kayıt varsa önce "1" altına göçür — bkz. yukarıdaki not)
  current.plans[representative] = _normalizeLegacyRepPlan(current.plans[representative]);
  if (!current.plans[representative][weekGroup]) current.plans[representative][weekGroup] = {};
  current.plans[representative][weekGroup][weekday] = bricks;
  current.updatedAt = new Date().toISOString();

  const newContentB64 = _utf8ToB64(JSON.stringify(current, null, 2));

  // 3) GitHub'a yaz (yeni bir commit oluşur)
  let putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `rota: ${representative} gün ${weekday} güncellendi`,
      content: newContentB64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  // 409 çakışma (iki temsilci aynı anda kaydettiyse) → bir kez daha dener
  if (putRes.status === 409) {
    try {
      const retryGet = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
      if (retryGet.status === 200) {
        const meta2 = await retryGet.json();
        const decoded2 = JSON.parse(_b64ToUtf8(meta2.content || ''));
        if (!decoded2.plans) decoded2.plans = {};
        decoded2.plans[representative] = _normalizeLegacyRepPlan(decoded2.plans[representative]);
        if (!decoded2.plans[representative][weekGroup]) decoded2.plans[representative][weekGroup] = {};
        decoded2.plans[representative][weekGroup][weekday] = bricks;
        decoded2.updatedAt = new Date().toISOString();
        const retryContentB64 = _utf8ToB64(JSON.stringify(decoded2, null, 2));
        putRes = await fetch(apiBase, {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `rota: ${representative} gün ${weekday} güncellendi (retry)`,
            content: retryContentB64,
            branch: BRANCH,
            sha: meta2.sha,
          }),
        });
      }
    } catch (e) { /* aşağıda genel hata olarak dönecek */ }
  }

  if (!putRes.ok) {
    const errBody = await putRes.text();
    return new Response(JSON.stringify({ error: 'github write failed', detail: String(errBody).slice(0, 200) }), { status: 502, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
}
