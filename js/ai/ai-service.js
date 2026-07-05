// ══════════════════════════════════════════════════════════════════════
//  PHARMA VISION PORTAL  ·  ai-service.js
//  Phase 2.0 extraction — index.html L724-976, L722, L5535
//
//  Sorumluluk:
//    • Proxy URL yönetimi   (loadProxyUrl, saveProxyUrl)
//    • AI fetch wrapper     (fetchAI)
//    • Chat mesaj gönderme  (sendAiMsg, sendAiMsgWithText)
//    • Concurrency guard    (_aiInflight)
//    • Stale response guard (_reqTTT snapshot)
//    • HTTP guard           (response.ok)
//
//  Global bağımlılıklar (index.html scope'tan okunur):
//    State   : selAiTTT, engineSelTTT, aiChatHistory
//    Utils   : buildTTTContext()
//    DOM ID  : aiChatArea, aiStatus, aiInput, aiSendBtn, proxyUrlInput, proxyStatus
//
//  Yükleme sırası: ai-context.js SONRASI, app.js ÖNCESI
// ══════════════════════════════════════════════════════════════════════
/* global selAiTTT, engineSelTTT, aiChatHistory, buildTTTContext, switchAiTab */

// ── Concurrency guards ─────────────────────────────────────────────
// Phase 1.9 FIX-RT-01 — bu dosyaya taşındı, index.html stub'la delege eder
// _aiInflight → js/core/async-guard.js

// ── Proxy yönetimi ─────────────────────────────────────────────────
// Kaynak: index.html L953-L996
var _AI_DEFAULT_PROXY = 'https://samsun.yilmazusta28.workers.dev';

// STUB: loadProxyUrl() → js/data/storage.js

// STUB: saveProxyUrl() → js/data/storage.js

function _updateProxyStatus(url) {
  var el = document.getElementById('proxyStatus');
  if (!el) return;
  if (url && url !== 'https://YOUR-WORKER.workers.dev') {
    el.innerHTML = '<span style="color:var(--good)">✅ Proxy aktif: ' + url + '</span>';
  } else {
    el.innerHTML = '<span style="color:#D97706">⚠️ Proxy ayarlanmadı</span>';
  }
}

function _getProxyUrl() {
  return window.AI_PROXY_URL || _AI_DEFAULT_PROXY;
}

// ── Temel AI fetch wrapper ─────────────────────────────────────────
// Kaynak: index.html L796-L834 (sendAiMsgWithText içinden)
// HTTP guard + response.ok kontrolü (Phase 1.9 B-02-2)
async function fetchAI(payload) {
  var url = _getProxyUrl();
  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error('Sunucu hatası: HTTP ' + response.status + ' ' + response.statusText);
  }
  var data = await response.json();
  var text = data.content && data.content[0] && data.content[0].text;
  if (!text) {
    // DÜZELTME: gerçek proxy/API hatasını yut madan göster (bkz. ai-engine.js'deki aynı düzeltme)
    var apiErr = (data.error && data.error.message) || data.message || null;
    throw new Error(apiErr ? 'Proxy/API hatası: ' + apiErr : 'Yanıt alınamadı (içerik boş).');
  }
  return text;
}

// ── Markdown → HTML format helper ─────────────────────────────────
function _formatAIReply(text) {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ── sendAiMsg — input okuyup wrapper ──────────────────────────────
// Kaynak: index.html L711-L722
async function sendAiMsg() {
  var input = document.getElementById('aiInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendAiMsgWithText(text);
}

// ── sendAiMsgWithText — tam AI chat akışı ─────────────────────────
// Kaynak: index.html L724-L952
// Phase 1.9 patchleri korundu:
//   B-01-1: _aiInflight guard
//   B-01-2: button disable
//   B-01-3: input disable
//   B-02-2: response.ok (fetchAI içinde)
//   B-02-3/5: TTT snapshot + stale discard
async function sendAiMsgWithText(text) {
  if (!selAiTTT && engineSelTTT) selAiTTT = engineSelTTT;
  if (!selAiTTT) { alert('Lütfen temsilci seçin.'); return; }

  // B-01-1: Concurrency guard
  if (_aiInflight) {
    var _ca = document.getElementById('aiChatArea');
    if (_ca) {
      _ca.innerHTML += '<div class="ai-bubble-ai" style="opacity:.6;font-size:11px">' +
        '<strong style="color:#92400E">⏳ Bekle</strong><br>' +
        'Önceki yanıt bekleniyor, lütfen bekleyin…</div>';
      requestAnimationFrame(function(){ _ca.scrollTop = _ca.scrollHeight; });
    }
    return;
  }
  _aiInflight = true;

  // B-02-5: TTT snapshot — fetch sırasında selAiTTT değişirse stale discard
  var _reqTTT = selAiTTT;

  // B-01-2 + B-01-3: UI lock
  var _sendBtn   = document.getElementById('aiSendBtn');
  var _sendInput = document.getElementById('aiInput');
  if (_sendBtn)   { _sendBtn.disabled   = true;  _sendBtn.style.opacity   = '0.5'; }
  if (_sendInput) { _sendInput.disabled = true; }

  var chatArea = document.getElementById('aiChatArea');
  var statusEl = document.getElementById('aiStatus');

  // AUDIT7 sertleştirmesi: `chatArea`/`statusEl` bulunamazsa (örn. ileride
  // bu ID'ler yine yanlışlıkla kaldırılırsa) eskiden burada `null.innerHTML`
  // ile SESSİZCE çöküyordu VE bu satır try/catch/finally BLOĞUNUN DIŞINDA
  // olduğu için `_aiInflight` kilidi asla serbest bırakılmıyordu — tek bir
  // eksik DOM elemanı sayfa yenilenene kadar TÜM AI sorgularını kalıcı
  // olarak kilitliyordu. Artık böyle bir durumda erken ve güvenli çıkış
  // yapılıyor, kilit serbest bırakılıyor, konsola açık hata yazılıyor.
  if (!chatArea || !statusEl) {
    console.error('[ai-service] #aiChatArea veya #aiStatus DOM\'da bulunamadı — AI yanıtı gösterilemiyor.');
    _aiInflight = false;
    if (_sendBtn)   { _sendBtn.disabled   = false; _sendBtn.style.opacity   = ''; }
    if (_sendInput) { _sendInput.disabled = false; }
    alert('AI yanıt alanı yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
    return;
  }

  chatArea.innerHTML += '<div class="ai-bubble-user">' +
    '<strong style="color:#4F008C">👤 Siz</strong><br>' + text + '</div>';
  requestAnimationFrame(function(){ chatArea.scrollTop = chatArea.scrollHeight; });

  var loadId = 'ai_loading_' + Date.now();
  chatArea.innerHTML += '<div id="' + loadId + '" class="ai-bubble-ai">' +
    '<strong style="color:var(--c1)">🤖 AI Asistan</strong><br>' +
    '<span style="color:var(--dim)">⏳ Analiz ediliyor...</span></div>';
  requestAnimationFrame(function(){ chatArea.scrollTop = chatArea.scrollHeight; });
  statusEl.textContent = '⏳ Düşünüyor...';

  // Phase 4.1 — Unified Context: buildExecutiveContext enriches the prompt
  // Falls back to buildTTTContext if executive modules not loaded.
  var context;
  try {
    if (typeof buildExecutiveContext === 'function') {
      // buildExecutiveContext uses buildTTTContext + forecast + prim + simulator + territory
      context = buildTTTContext(_reqTTT) +
                buildExecutiveContext([_reqTTT]);
    } else {
      context = buildTTTContext(_reqTTT);
    }
  } catch (_ctxErr) {
    console.warn('[ai-service] context build hata, fallback:', _ctxErr.message);
    context = buildTTTContext(_reqTTT);
  }
  var systemPrompt = 'Sen İLKO İlaç firmasının PHARMA VISION bölgesi için çalışan uzman bir satış analisti ve stratejistsin.\n' +
    '2026 İLKO TTT prim sistemi:\n' +
    '- TL Real Primi: %91+ realizasyon, çarpan tablosu (baz: 55.000₺/dönem)\n' +
    '- Portföy Primi: %91+ TL real VE %91+ prim puanı (baz: 11.000₺)\n' +
    '- MI&GI Primi: %70+ TL real, matris katsayısı (baz: 14.000₺)\n' +
    '- Prim puanı = ürün ağırlığı × ürün real (min %70, max %130)\n' +
    'IMS Analiz Kuralları:\n' +
    '- IMS TL fiyatları: PANOCER=105.31₺, ACİDPASS=112.23₺, GRİPORT COLD=84.15₺, MOKSEFEN=149₺, FAMTREC=95₺\n' +
    '- Kalan TL hedefi / IMS TL fiyatı = satılması gereken anamal kutu miktarı\n' +
    '- Brick bazlı pazar payı %15 altındaysa ve pazar >500 kutu ise risk brick\n' +
    '- Rakibin pay >%30 ve bizim <%15 ise öncelikli hedef brick\n' +
    '- İlk 333 brick yatırım önceliği taşır\n' +
    '- Eczane önerisi yaparken: hedefi / IMS TL fiyatı = kutu, brick başına dağıt\n\n' +
    'ZAMAN DUYARLI DEĞERLENDİRME KURALLARI (KRİTİK):\n' +
    '- Hedefler 2 aylık (dönemlik) periyotta değerlendirilir — anlık realizasyon yanıltıcıdır\n' +
    '- Analiz yaparken MUTLAKA verimdeki \'Projeksiyon Analizi\' bölümünü kullan: run-rate, senaryo ve gap verilerini değerlendir\n' +
    '- \'Hedefi tutamazsın\' demeden önce: kalan iş günü × günlük ihtiyaç = ulaşılabilir mi? hesapla\n' +
    '- Mevcut ivme/ihtiyaç oranı >0.8x ise hedef hâlâ ulaşılabilir — temsilciyi motive et\n' +
    '- Değerlendirme sırası: (1) Run-rate ile dönem sonu projeksiyonu → (2) Gap analizi → (3) Eylem planı\n' +
    '- Senaryo bazlı konuş: \'Mevcut ivmeyle dönem sonunda %X realizasyona ulaşırsın. %91 için günlük Y₺ daha gerekiyor.\'\n' +
    '- Dönemin başındaysa (kalan gün > toplam günün %60\'ı): motivasyon ve büyüme odaklı plan ver\n' +
    '- Dönemin sonundaysa (kalan gün < %30): gerçekçi acil eylem planı, somut günlük kutu/TL hedefi ver\n' +
    'Yanıtlar: Net, somut sayılı, uygulanabilir Türkçe. Brick ve eczane isimleri ile öner.';

  aiChatHistory.push({ role: 'user', content: context + '\n\nSoru/Görev: ' + text });

  // Phase 2.3.5 — TASK 1: Safe memory cap (preserve newest messages)
  var MAX_CHAT_HISTORY = 50;
  while (aiChatHistory.length > MAX_CHAT_HISTORY) {
    aiChatHistory.shift();
  }

  try {
    var reply = await fetchAI({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: aiChatHistory.slice(-6)
    });

    // B-02-5: Stale response koruması
    if (selAiTTT !== _reqTTT) {
      console.warn('[AI] Stale response discarded — TTT changed', _reqTTT, '→', selAiTTT);
      var staleEl = document.getElementById(loadId);
      if (staleEl) staleEl.remove();
      aiChatHistory.pop();
      statusEl.textContent = '⚠️ TTT değişti';
      return;
    }

    aiChatHistory.push({ role: 'assistant', content: reply });

    // Phase 2.3.5 — TASK 1: Safe memory cap (preserve newest messages)
    var MAX_CHAT_HISTORY = 50;
    while (aiChatHistory.length > MAX_CHAT_HISTORY) {
      aiChatHistory.shift();
    }

    var loadEl = document.getElementById(loadId);
    if (loadEl) {
      loadEl.innerHTML = '<strong style="color:var(--c1)">🤖 AI Asistan</strong>' +
        '<br><div style="margin-top:6px;line-height:1.6">' + _formatAIReply(reply) + '</div>';
    }
    statusEl.textContent = '✅ Hazır';

    // Phase 4.2 — AI Memory Layer: her başarılı AI yanıtı sonrası snapshot + strateji kaydı
    try {
      if (typeof saveMemorySnapshot  === 'function') saveMemorySnapshot(_reqTTT);
      if (typeof recordStrategyCall  === 'function') recordStrategyCall('chat', _reqTTT);
    } catch (_memErr) { /* silent — hafıza hatası AI akışını bozmaz */ }

  } catch (err) {
    var errEl = document.getElementById(loadId);
    var isProxy = err.message && (
      err.message.includes('fetch') ||
      err.message.includes('CORS') ||
      err.message.includes('Failed')
    );
    var errMsg = isProxy
      ? '🔧 Proxy kurulumu gerekli. AI Asistan sayfasındaki kurulum talimatlarını takip edin.'
      : err.message;
    if (errEl) errEl.innerHTML = '<strong style="color:#DC2626">⚠️ Hata</strong>' +
      '<br><div style="margin-top:6px;font-size:11px">' + errMsg + '</div>';
    statusEl.textContent = '❌ Hata';

  } finally {
    // B-01-1: Lock serbest
    _aiInflight = false;
    // B-01-2 + B-01-3: UI unlock
    if (_sendBtn)   { _sendBtn.disabled   = false; _sendBtn.style.opacity = ''; }
    if (_sendInput) { _sendInput.disabled = false; _sendInput.focus(); }
  }
  requestAnimationFrame(function(){ chatArea.scrollTop = chatArea.scrollHeight; });
}
