// ═════════════════════════════════════════════════════════════════
//  PHARMA VISION PORTAL  ·  js/core/pv-auth.js
//  Sunucu taraflı oturum (worker PV_AUTH_MODE=strict ile çalışır)
//
//  - Giriş: worker'daki /auth/login (kişiye özel şifre; şifre istemcide
//    SAKLANMAZ, doğrulama sunucuda yapılır).
//  - Dönen imzalı jeton sessionStorage'a yazılır ve worker'a atılan her
//    istekte `Authorization: Bearer <jeton>` olarak gönderilir.
//  - ESKİ ortak anahtar (_PV_WORKER_KEY / X-PV-Auth) ve VALID_PASS
//    istemciden KALDIRILDI. Worker'da PORTAL_PASSWORD secret'ı da silinmeli.
//
//  Kullanım: const headers = await pvAuthHeaders();
//            fetch(url, { headers: Object.assign({'Content-Type':'application/json'}, headers), ... })
//
//  Yükleme sırası: LOGIN script bloğu SONRASI, worker'a istek atan
//  TÜM dosyalardan ÖNCESİ (index.html'deki mevcut sıra değişmez).
// ═════════════════════════════════════════════════════════════════

var PV_WORKER_BASE = 'https://samsun.yilmazusta28.workers.dev';
var _PV_SESSION_KEY = 'pv_session_v1';

function _pvSession() {
  try {
    var o = JSON.parse(sessionStorage.getItem(_PV_SESSION_KEY) || 'null');
    if (o && o.token && o.exp * 1000 > Date.now() + 30000) return o;     // süresi dolmak üzere olanı kullanma
  } catch (e) { /* sessionStorage kapalı/bozuk */ }
  return null;
}

async function pvServerLogin(user, pass) {
  try {
    var res = await fetch(PV_WORKER_BASE + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user, pass: pass })
    });
    var j = await res.json().catch(function () { return {}; });
    if (res.ok && j.token) {
      sessionStorage.setItem(_PV_SESSION_KEY, JSON.stringify({ token: j.token, user: j.user, role: j.role, exp: j.exp }));
      _pvExpiredShown = false;                         // yeni oturum → ileride süre dolunca tekrar uyarılabilsin
      return { ok: true, user: j.user, role: j.role };
    }
    if (res.status === 429) return { ok: false, message: 'Çok fazla hatalı deneme — 15 dakika sonra tekrar deneyin.' };
    if (res.status === 501) return { ok: false, message: 'Sunucu girişi henüz yapılandırılmadı.' };
    return { ok: false, message: 'Kullanıcı adı veya şifre hatalı.' };
  } catch (e) {
    return { ok: false, message: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' };
  }
}

function pvClearSession() { try { sessionStorage.removeItem(_PV_SESSION_KEY); } catch (e) { /* yoksay */ } }

var _pvExpiredShown = false;
function _pvSessionExpired() {                       // jeton doldu → giriş ekranını yeniden göster (bir kez)
  // Yalnız giriş YAPILMIŞ bir oturum için: giriş ekranındayken (henüz kimse girmemişken) "süre doldu" gösterme
  if (typeof LOGGED_IN_USER === 'undefined' || !LOGGED_IN_USER) return;
  if (_pvExpiredShown) return; _pvExpiredShown = true;
  var ls = document.getElementById('loginScreen'), er = document.getElementById('loginErr');
  if (ls) ls.style.display = '';
  if (er) { er.textContent = 'Oturum süresi doldu — lütfen yeniden giriş yapın.'; er.style.display = 'block'; }
}

// Worker'a atılan HER istekte kullanılacak header'ları üretir.
async function pvAuthHeaders() {
  var who = encodeURIComponent((typeof LOGGED_IN_USER !== 'undefined' && LOGGED_IN_USER) || '');
  var ses = _pvSession();
  if (ses) return { 'Authorization': 'Bearer ' + ses.token, 'X-PV-User': who };
  _pvSessionExpired();                                // oturum yok/doldu → yeniden giriş iste
  return { 'X-PV-User': who };                         // jetonsuz istek: worker (strict) 401 döner
}

console.debug('[pv-auth] Yüklendi — worker istekleri imzalı jeton (Bearer) ile yapılacak.');
