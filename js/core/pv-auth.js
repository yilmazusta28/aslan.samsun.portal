// ══════════════════════════════════════════════════════════════════════
//  PHARMA VISION PORTAL  ·  js/core/pv-auth.js
//  GÜVENLİK DÜZELTMESİ — worker.js'teki tüm senkron endpoint'leri
//  (AI proxy dahil) artık kimlik doğrulaması istiyor.
//
//  Mekanizma: paylaşılan gizli bir anahtardan (_PV_WORKER_KEY — LOGIN
//  şifresinden BİLEREK AYRI tutuldu, bkz. aşağıdaki not) 5 dakikada bir
//  değişen bir SHA-256 token üretilir ve her worker isteğinde
//  `X-PV-Auth` header'ında gönderilir. worker.js aynı hesaplamayı
//  env.PORTAL_PASSWORD ile yapıp karşılaştırır.
//
//  ÖNEMLİ — GERÇEKÇİ TEHDİT MODELİ: Bu anahtar client-side JS'te durduğu
//  için (tıpkı VALID_PASS gibi) GitHub Pages kaynağını inceleyen KARARLI
//  bir kişiyi durdurmaz. Amacı: worker URL'ini bulan ANONİM bot/tarayıcı
//  script'lerinin (Anthropic/GitHub kotasını sessizce tüketmesini) ve
//  yakalanmış bir isteğin süresiz tekrar oynatılmasını (token'lar ~5-10
//  dk sonra geçersiz olur) engellemek. Gerçek (login'e bağlı, sızma
//  riski taşımayan) yetkilendirme için üretim yeniden yapımında
//  sunucu tarafı oturum/JWT önerilir (bkz. Doküman İnceleme Raporu).
//
//  _PV_WORKER_KEY'in VALID_PASS'ten (giriş şifresi) FARKLI tutulmasının
//  nedeni: bu token'lar ağ isteklerinde/loglarda görünebilir; login
//  şifresiyle aynı olsaydı, bu iz sürülebilir kanaldan giriş şifresi de
//  dolaylı olarak ifşa olabilirdi. Bu iki değeri birbirinden bağımsız
//  tutmak, biri sızsa bile diğerini etkilemez.
//
//  DEPLOY ADIMI (bir kerelik):
//    1) Aşağıdaki _PV_WORKER_KEY değerini uzun/rastgele bir dizeyle
//       değiştir (ör. `openssl rand -hex 32` ile üretilebilir).
//    2) Cloudflare Worker'da AYNI değeri secret olarak tanımla:
//         wrangler secret put PORTAL_PASSWORD
//       (worker.js env.PORTAL_PASSWORD olarak okuyor)
//    3) Bu dosyayı index.html'e, LOGIN script bloğundan SONRA,
//       ai-service.js / ai-engine.js / saha-gozlem-store.js /
//       stock-entry-adapter.js / route-plan-input.js /
//       sales-conditions.js dosyalarından ÖNCE ekle:
//         <script src="js/core/pv-auth.js"></script>
//
//  Yükleme sırası: LOGIN script bloğu SONRASI, worker'a istek atan
//  TÜM dosyalardan ÖNCESİ.
// ══════════════════════════════════════════════════════════════════════

// TODO(deploy): aşağıdaki değeri `openssl rand -hex 32` ile üretilen
// rastgele bir dizeyle değiştir ve AYNI değeri worker secret'ı olarak
// (PORTAL_PASSWORD) tanımla. Bu placeholder ile ÇALIŞMAZ — bilinçli
// olarak worker.js'teki değerle eşleşmeyecek şekilde bırakıldı.
const _PV_WORKER_KEY = '91a10ba4125a31b7e4dbde096661c9f58af32413818a773e4e734f62fcaeda80';

const _PV_AUTH_WINDOW_SEC = 300; // worker.js'teki PV_AUTH_WINDOW_SEC ile AYNI olmalı

async function _pvSha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// Worker'a atılan HER istekte kullanılacak header'ları üretir.
// Kullanım: const headers = await pvAuthHeaders();
//           fetch(url, { headers: Object.assign({'Content-Type':'application/json'}, headers), ... })
async function pvAuthHeaders() {
  var win = Math.floor(Date.now() / 1000 / _PV_AUTH_WINDOW_SEC);
  var token = await _pvSha256Hex(_PV_WORKER_KEY + ':' + win);
  return {
    'X-PV-Auth': token,
    // Sadece log/teşhis amaçlı — worker tarafında doğrulanmıyor, güvenlik
    // kararı buna dayanmıyor.
    'X-PV-User': encodeURIComponent((typeof LOGGED_IN_USER !== 'undefined' && LOGGED_IN_USER) || '')
  };
}

console.debug('[pv-auth] Yüklendi — worker istekleri artık X-PV-Auth ile imzalanacak.');
