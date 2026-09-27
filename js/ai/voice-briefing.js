// ══════════════════════════════════════════════════════════════════════
//  PHARMA VISION PORTAL · js/ai/voice-briefing.js
//  FAZ (yeni) — Sesli Günlük Brifing + Sesli Soru-Cevap Asistanı
//
//  Sorumluluk:
//    • Girişten sonra, temsilcinin o günkü rota/sipariş/rakip verilerini
//      mevcut AI proxy'si (fetchAI → worker.js → Anthropic) üzerinden
//      KISA, doğal konuşma diline uygun bir Türkçe metne dönüştürür ve
//      arka planda hazırlar (otomatik brifing).
//    • Web Speech API (SpeechSynthesis) ile bu metni — kullanıcı dokunuşu
//      sonrası, tarayıcı autoplay kısıtlamalarına uygun şekilde — sesli
//      okur.
//    • Web Speech API (SpeechRecognition, destekleyen tarayıcılarda) ile
//      mikrofonla soru alır, aynı AI proxy'sine gönderir, cevabı sesli
//      okur ("sesli sohbet" modu).
//
//  Bağımlılıklar (global, index.html scope'tan okunur — DEĞİŞTİRİLMEZ):
//    fetchAI                     (js/ai/ai-service.js)
//    buildTTTContext             (js/ai/ai-context.js)
//    buildExecutiveContext       (js/ai/ai-context.js)
//    window.buildRouteContext    (js/route/route-optimizer.js)
//    selAiTTT / LOGGED_IN_USER   (index.html)
//
//  Kamuya açık API:
//    window.initVoiceBriefing()  — login sonrası (initApp veri yüklemesi
//                                   bittikten sonra) bir kez çağrılır.
//
//  Yükleme sırası: js/ai/ai-service.js, js/ai/ai-context.js,
//                  js/route/route-optimizer.js SONRASI.
//  Not: Tarayıcı ses çalma politikaları gereği, sayfa açılır açılmaz
//  OTOMATİK SES ÇALINAMAZ — bu yüzden metin arka planda hazırlanır,
//  okuma ise kullanıcı "▶️ Dinle" butonuna dokununca başlar.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var LS_KEY_PREFIX = 'pv_voice_briefing_';

  var STATE = {
    briefingText: null,
    speaking: false,
    listening: false,
    panelOpen: false,
    recognizer: null,
    voice: null,
    ready: false
  };

  // ── Yardımcılar ────────────────────────────────────────────────────
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _getTTT() {
    return (typeof selAiTTT !== 'undefined' && selAiTTT) ||
           (typeof window.LOGGED_IN_USER !== 'undefined' && window.LOGGED_IN_USER) ||
           (typeof LOGGED_IN_USER !== 'undefined' && LOGGED_IN_USER) || null;
  }

  function _supportsTTS() { return 'speechSynthesis' in window; }
  function _supportsSTT() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  function _escape(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _pickTurkishVoice() {
    if (!_supportsTTS()) return null;
    var voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var tr = voices.filter(function (v) { return /^tr/i.test(v.lang || ''); });
    return tr[0] || null; // null ise tarayıcı varsayılan sesi kullanır (lang='tr-TR' yine de set edilir)
  }

  if (_supportsTTS()) {
    try {
      window.speechSynthesis.onvoiceschanged = function () { STATE.voice = _pickTurkishVoice(); };
      STATE.voice = _pickTurkishVoice();
    } catch (e) { /* sessiz */ }
  }

  // Bazı tarayıcılarda (özellikle Android Chrome) tek seferde çok uzun
  // utterance'lar sessizce kesiliyor — cümle bazında parçalayıp sırayla oku.
  function _splitForSpeech(text) {
    return String(text || '')
      .split(/(?<=[.!?…])\s+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function speak(text, onend) {
    if (!_supportsTTS() || !text) { if (onend) onend(); return; }
    try { window.speechSynthesis.cancel(); } catch (e) { /* sessiz */ } // önceki okumayı kes
    var chunks = _splitForSpeech(text);
    var i = 0;
    STATE.speaking = true;
    _updatePanelStatus();
    function next() {
      if (i >= chunks.length) {
        STATE.speaking = false;
        _updatePanelStatus();
        if (onend) onend();
        return;
      }
      var u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = 'tr-TR';
      if (STATE.voice) u.voice = STATE.voice;
      u.rate = 1.0;
      u.onend = function () { i++; next(); };
      u.onerror = function () { i++; next(); };
      window.speechSynthesis.speak(u);
    }
    next();
  }

  function stopSpeaking() {
    if (_supportsTTS()) { try { window.speechSynthesis.cancel(); } catch (e) { /* sessiz */ } }
    STATE.speaking = false;
    _updatePanelStatus();
  }

  // ── AI context derleme ──────────────────────────────────────────────
  function _buildBriefingContext(ttt) {
    var ctx = '';
    try { if (typeof buildTTTContext === 'function') ctx += buildTTTContext(ttt); } catch (e) { console.warn('[voice-briefing] buildTTTContext hata:', e.message); }
    try { if (typeof window.buildRouteContext === 'function') ctx += window.buildRouteContext(ttt); } catch (e) { console.warn('[voice-briefing] buildRouteContext hata:', e.message); }
    try { if (typeof buildExecutiveContext === 'function') ctx += buildExecutiveContext([ttt]); } catch (e) { /* sessiz — opsiyonel zenginleştirme */ }
    return ctx;
  }

  var BRIEFING_SYSTEM_PROMPT =
    'Sen İLKO İlaç PHARMA VISION portalının sesli günlük brifing asistanısın. ' +
    'Sana verilen satış/rota/rakip verisine dayanarak, temsilcinin sabah dinleyeceği KISA, DOĞAL KONUŞMA DİLİNDE bir Türkçe brifing yaz.\n' +
    'KURALLAR:\n' +
    '- Sadece düz metin yaz: markdown, yıldız, madde işareti, başlık KULLANMA (bu metin doğrudan sese çevrilecek).\n' +
    '- 110-190 kelime aralığında tut, kısa ve net cümleler kur.\n' +
    '- Şu sırayla anlat: (1) kısa bir "günaydın" + genel durum cümlesi, ' +
    '(2) BUGÜN hangi eczane(ler)e gidilecek ve neden (acil ziyaret mi, fırsat mı, kazanım mı), ' +
    '(3) hangi ürüne/ürün grubuna ağırlık verilmeli ve tahmini sipariş miktarı, ' +
    '(4) hangi rakip veya hangi brick\'te dikkatli olunmalı, ' +
    '(5) tek cümlelik motive edici bir kapanış.\n' +
    '- Eczane ve brick isimlerini olduğu gibi, açıkça telaffuz edilecek şekilde yaz.\n' +
    '- Sayıları konuşma diline uygun yuvarlak söyle ("243.500 TL" yerine "yaklaşık 244 bin lira" gibi).\n' +
    '- ROUTE OPTIMIZER verisi yoksa veya boşsa, genel performans/rakip verisiyle en iyi tahmini brifingi ver; ' +
    '"veri yok" gibi bir cümle KURMA.';

  var QA_SYSTEM_PROMPT =
    'Sen İLKO İlaç PHARMA VISION portalının sesli asistanısın. Temsilci sana sesli soru soruyor. ' +
    'Cevabı KISA (en fazla 80 kelime), doğal konuşma dilinde, markdown kullanmadan, somut sayı/eczane/brick ' +
    'isimleriyle Türkçe ver. Emin olmadığın bir şey varsa tahmin uydurma, elindeki veriyle en iyi cevabı ver.';

  async function generateBriefing(ttt, force) {
    var cacheKey = LS_KEY_PREFIX + ttt;
    if (!force) {
      try {
        var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached && cached.date === _todayStr() && cached.text) return cached.text;
      } catch (e) { /* sessiz — bozuk cache, yeniden üret */ }
    }
    if (typeof fetchAI !== 'function') {
      throw new Error('AI servisi yüklenemedi (fetchAI bulunamadı) — sayfayı yenileyin.');
    }
    var context = _buildBriefingContext(ttt);
    var text = await fetchAI({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context + '\n\nGörev: Bugünkü sesli brifingi hazırla. Temsilci: ' + ttt }]
    });
    try { localStorage.setItem(cacheKey, JSON.stringify({ date: _todayStr(), text: text })); } catch (e) { /* sessiz */ }
    return text;
  }

  async function askQuestion(ttt, question) {
    if (typeof fetchAI !== 'function') throw new Error('AI servisi bulunamadı.');
    var context = _buildBriefingContext(ttt);
    return await fetchAI({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context + '\n\nSesli soru: ' + question }]
    });
  }

  // ── UI ───────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('voiceBriefingStyles')) return;
    var css =
      '#vbFab{position:fixed;bottom:22px;right:20px;z-index:400;width:56px;height:56px;border-radius:50%;' +
      'background:linear-gradient(135deg,var(--c1),var(--c2));color:#fff;border:none;box-shadow:0 6px 20px rgba(79,0,140,.35);' +
      'font-size:24px;display:flex;align-items:center;justify-content:center;cursor:grab;transition:transform .15s;' +
      'touch-action:none;-webkit-user-select:none;user-select:none}' +
      '#vbFab:active{transform:scale(.92);cursor:grabbing}' +
      '#vbFab.vb-dragging{transition:none;box-shadow:0 10px 28px rgba(79,0,140,.55)}' +
      '#vbFab.vb-pulse{animation:vbPulse 1.6s ease-in-out infinite}' +
      '@keyframes vbPulse{0%,100%{box-shadow:0 6px 20px rgba(79,0,140,.35)}50%{box-shadow:0 6px 28px rgba(79,0,140,.65)}}' +
      /* KULLANICI İSTEĞİ: telefonda buton en altta sağda kalıp mobil alt
         menü (#mobileTabBar, 62px + güvenli alan) ile çakışıyor, menüye
         dokunmayı engelliyordu — varsayılan konum mobilde tab bar'ın
         ÜSTÜNE çıkarıldı. Buton ayrıca artık sürükle-bırak ile TAMAMEN
         serbest taşınabilir (bkz. _makeDraggable) ve son bırakılan yer
         cihaza kaydedilip bir sonraki açılışta hatırlanır. */
      '@media(max-width:768px){#vbFab{bottom:calc(74px + env(safe-area-inset-bottom,0))}}' +
      '#vbPanel{position:fixed;bottom:88px;right:20px;z-index:400;width:320px;max-width:92vw;background:var(--surf);' +
      'border:1px solid var(--border);border-radius:var(--card-radius);box-shadow:var(--card-shadow);' +
      'padding:16px;display:none;font-family:inherit;color:var(--text)}' +
      '#vbPanel.open{display:block}' +
      '#vbPanel h4{margin:0 0 8px;font-size:14px;color:var(--c1);display:flex;align-items:center;gap:6px}' +
      '#vbStatus{font-size:12px;color:var(--dim);margin-bottom:10px;min-height:16px}' +
      '.vb-btn{width:100%;padding:10px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;' +
      'margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit}' +
      '.vb-btn-primary{background:linear-gradient(135deg,var(--c1),var(--c2));color:#fff}' +
      '.vb-btn-secondary{background:var(--surf2);color:var(--text);border:1px solid var(--border)}' +
      '.vb-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '#vbTranscript{max-height:180px;overflow-y:auto;font-size:12px;line-height:1.5;background:var(--surf2);' +
      'border-radius:10px;padding:8px;margin-top:6px}' +
      '#vbTranscript:empty{display:none}' +
      '#vbTranscript .vb-q{color:var(--c1);font-weight:600;margin-top:6px}' +
      '#vbTranscript .vb-a{color:var(--text);margin-bottom:4px}';
    var style = document.createElement('style');
    style.id = 'voiceBriefingStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Sürükle-Bırak: FAB butonu (mobilde alt menüyü engellemesin diye
  //    kullanıcı istediği yere taşıyabilsin) ─────────────────────────────
  var LS_KEY_FAB_POS = LS_KEY_PREFIX + 'fab_pos'; // {left, top} px, cihaza özel
  var DRAG_THRESHOLD = 6; // px — bundan az hareket "dokunma" (tap) sayılır, panel açılır

  function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Kaydedilmiş bir konum varsa uygula (viewport dışında kalmışsa —
  // örn. ekran döndürüldüyse — içeri çeker). Yoksa CSS varsayılanı
  // (sağ-alt / mobilde tab bar üstü) geçerli kalır.
  function _applySavedFabPosition(fab) {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY_FAB_POS) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw.left !== 'number' || typeof raw.top !== 'number') return;
    var w = fab.offsetWidth || 56, h = fab.offsetHeight || 56;
    var left = _clamp(raw.left, 4, window.innerWidth - w - 4);
    var top = _clamp(raw.top, 4, window.innerHeight - h - 4);
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  function _makeDraggable(fab) {
    var dragging = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    fab.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return; // sadece sol tık / tek dokunuş
      dragging = true; moved = false;
      var r = fab.getBoundingClientRect();
      startX = ev.clientX; startY = ev.clientY;
      startLeft = r.left; startTop = r.top;
      try { fab.setPointerCapture(ev.pointerId); } catch (e) { /* sessiz */ }
    });

    fab.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // henüz "sürükleme" sayılmıyor
      if (!moved) { moved = true; fab.classList.add('vb-dragging'); }
      var w = fab.offsetWidth, h = fab.offsetHeight;
      var left = _clamp(startLeft + dx, 4, window.innerWidth - w - 4);
      var top = _clamp(startTop + dy, 4, window.innerHeight - h - 4);
      fab.style.left = left + 'px';
      fab.style.top = top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    });

    function _endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      fab.classList.remove('vb-dragging');
      try { fab.releasePointerCapture(ev.pointerId); } catch (e) { /* sessiz */ }
      if (moved) {
        // Gerçek bir sürükleme oldu — yeni konumu kaydet, bu tıklamayla
        // paneli AÇMA (kullanıcı butonu taşımak istedi, panel açmak değil).
        var r = fab.getBoundingClientRect();
        try { localStorage.setItem(LS_KEY_FAB_POS, JSON.stringify({ left: r.left, top: r.top })); } catch (e) { /* sessiz */ }
        var swallow = function (e2) { e2.stopPropagation(); e2.preventDefault(); fab.removeEventListener('click', swallow, true); };
        fab.addEventListener('click', swallow, true);
      }
      moved = false;
    }
    fab.addEventListener('pointerup', _endDrag);
    fab.addEventListener('pointercancel', _endDrag);

    // Ekran döndürme / klavye açılma gibi durumlarda buton görünür alanın
    // dışında kalmasın diye viewport her değiştiğinde konumu yeniden kelepçele.
    window.addEventListener('resize', function () {
      if (fab.style.left && fab.style.left !== 'auto') _applySavedFabPosition(fab);
    });
  }

  // Panel, FAB'ın O ANKİ konumuna göre açılır (FAB taşınmış olabilir) —
  // ekranın neresinde olursa olsun panel görünür alanın İÇİNDE kalır.
  function _positionPanelNearFab() {
    var fab = document.getElementById('vbFab');
    var panel = document.getElementById('vbPanel');
    if (!fab || !panel) return;
    var fr = fab.getBoundingClientRect();
    var pw = Math.min(320, window.innerWidth * 0.92);
    var ph = panel.offsetHeight || 260;
    var margin = 10;
    // Yatay: FAB'ın sağı taşarsa panel FAB'ın soluna, aksi halde sağ hizalı.
    var left = fr.right - pw;
    if (fr.left + pw + margin > window.innerWidth) left = window.innerWidth - pw - margin;
    left = _clamp(left, margin, window.innerWidth - pw - margin);
    // Dikey: FAB'ın üstünde yer yoksa (ekranın üst kısmındaysa) panel FAB'ın ALTINA açılır.
    var top = fr.top - ph - margin;
    if (top < margin) top = Math.min(fr.bottom + margin, window.innerHeight - ph - margin);
    top = _clamp(top, margin, Math.max(margin, window.innerHeight - ph - margin));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function _renderUI() {
    if (document.getElementById('vbFab')) return;

    var fab = document.createElement('button');
    fab.id = 'vbFab';
    fab.title = 'Sesli Asistan (taşımak için sürükleyin)';
    fab.innerHTML = '🎙️';
    fab.className = 'vb-pulse';
    fab.onclick = _togglePanel;

    var panel = document.createElement('div');
    panel.id = 'vbPanel';
    panel.innerHTML =
      '<h4>🎙️ Sesli Asistan</h4>' +
      '<div id="vbStatus">Hazır</div>' +
      '<button id="vbPlayBtn" class="vb-btn vb-btn-primary">▶️ Bugünkü Brifingi Dinle</button>' +
      '<button id="vbStopBtn" class="vb-btn vb-btn-secondary" style="display:none">⏹️ Durdur</button>' +
      '<button id="vbAskBtn" class="vb-btn vb-btn-secondary">🎤 Soru Sor</button>' +
      '<div id="vbTranscript"></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    _applySavedFabPosition(fab);
    _makeDraggable(fab);

    document.getElementById('vbPlayBtn').onclick = _onPlayClick;
    document.getElementById('vbStopBtn').onclick = function () { stopSpeaking(); };
    document.getElementById('vbAskBtn').onclick = _onAskClick;

    if (!_supportsSTT()) {
      var askBtn = document.getElementById('vbAskBtn');
      askBtn.disabled = true;
      askBtn.title = 'Bu tarayıcı sesli soru özelliğini desteklemiyor (Chrome/Edge deneyin).';
    }
    if (!_supportsTTS()) {
      var playBtn = document.getElementById('vbPlayBtn');
      playBtn.disabled = true;
      playBtn.title = 'Bu tarayıcı sesli okumayı desteklemiyor.';
    }
  }

  function _togglePanel() {
    var panel = document.getElementById('vbPanel');
    if (!panel) return;
    STATE.panelOpen = !STATE.panelOpen;
    panel.classList.toggle('open', STATE.panelOpen);
    // NOT: gerçek yükseklik ancak 'open' sınıfı eklenip panel display:block
    // olduktan SONRA doğru ölçülebiliyor — bu yüzden konumlandırma class
    // değişiminden SONRA yapılıyor.
    if (STATE.panelOpen) _positionPanelNearFab();
    var fab = document.getElementById('vbFab');
    if (fab) fab.classList.remove('vb-pulse');
  }

  function _setStatus(text) {
    var el = document.getElementById('vbStatus');
    if (el) el.textContent = text;
  }

  function _refreshButtons() {
    var playBtn = document.getElementById('vbPlayBtn');
    var stopBtn = document.getElementById('vbStopBtn');
    if (!playBtn || !stopBtn) return;
    stopBtn.style.display = STATE.speaking ? 'flex' : 'none';
    playBtn.style.display = STATE.speaking ? 'none' : 'flex';
  }

  function _updatePanelStatus() {
    _refreshButtons();
    if (STATE.speaking) _setStatus('🔊 Okunuyor…');
    else if (STATE.listening) _setStatus('🎤 Dinleniyor…');
    else if (STATE.ready) _setStatus('✅ Brifing hazır — dinlemek için dokunun');
    else _setStatus('Hazır');
  }

  function _appendTranscript(question, answer, isBriefing) {
    var t = document.getElementById('vbTranscript');
    if (!t) return;
    var html = '';
    if (question) html += '<div class="vb-q">🗣️ ' + _escape(question) + '</div>';
    html += '<div class="vb-a">' + (isBriefing ? '📋 ' : '🤖 ') + _escape(answer) + '</div>';
    t.innerHTML += html;
    t.scrollTop = t.scrollHeight;
  }

  async function _onPlayClick() {
    var ttt = _getTTT();
    if (!ttt) { _setStatus('⚠️ Temsilci bulunamadı.'); return; }
    var playBtn = document.getElementById('vbPlayBtn');
    if (STATE.briefingText) {
      // Zaten hazır — doğrudan oku (kullanıcı dokunuşu var, autoplay sorunu yok)
      _appendTranscript(null, STATE.briefingText, true);
      speak(STATE.briefingText);
      return;
    }
    _setStatus('⏳ Brifing hazırlanıyor…');
    playBtn.disabled = true;
    try {
      var text = await generateBriefing(ttt, false);
      STATE.briefingText = text;
      STATE.ready = true;
      playBtn.disabled = false;
      _appendTranscript(null, text, true);
      speak(text);
    } catch (e) {
      playBtn.disabled = false;
      _setStatus('❌ ' + (e.message || 'Brifing alınamadı'));
    }
  }

  function _onAskClick() {
    if (!_supportsSTT()) return;
    if (STATE.listening) { _stopListening(); return; }
    _startListening();
  }

  function _startListening() {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = new Rec();
    rec.lang = 'tr-TR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    STATE.recognizer = rec;
    STATE.listening = true;
    _updatePanelStatus();
    var askBtn = document.getElementById('vbAskBtn');
    if (askBtn) askBtn.textContent = '⏹️ Dinlemeyi Durdur';

    rec.onresult = async function (ev) {
      var question = ev.results[0][0].transcript;
      STATE.listening = false;
      _updatePanelStatus();
      if (askBtn) askBtn.textContent = '🎤 Soru Sor';
      var ttt = _getTTT();
      if (!ttt) { _setStatus('⚠️ Temsilci bulunamadı.'); return; }
      _setStatus('⏳ Yanıt hazırlanıyor…');
      try {
        var answer = await askQuestion(ttt, question);
        _appendTranscript(question, answer, false);
        speak(answer);
      } catch (e) {
        _setStatus('❌ ' + (e.message || 'Yanıt alınamadı'));
      }
    };
    rec.onerror = function (ev) {
      STATE.listening = false;
      _updatePanelStatus();
      if (askBtn) askBtn.textContent = '🎤 Soru Sor';
      if (ev.error === 'not-allowed') _setStatus('⚠️ Mikrofon izni gerekli.');
      else _setStatus('⚠️ Ses tanıma hatası: ' + ev.error);
    };
    rec.onend = function () {
      STATE.listening = false;
      _updatePanelStatus();
      if (askBtn) askBtn.textContent = '🎤 Soru Sor';
    };
    try { rec.start(); } catch (e) { STATE.listening = false; _updatePanelStatus(); }
  }

  function _stopListening() {
    if (STATE.recognizer) { try { STATE.recognizer.stop(); } catch (e) { /* sessiz */ } }
    STATE.listening = false;
    _updatePanelStatus();
    var askBtn = document.getElementById('vbAskBtn');
    if (askBtn) askBtn.textContent = '🎤 Soru Sor';
  }

  // ── Kamuya açık init — doLogin() → initApp() veri yüklemesi bittikten
  //    sonra ÇAĞRILIR (bkz. index.html doLogin() patch). Brifing metnini
  //    arka planda hazırlar (ses ÇALMAZ — sadece hazırlar), buton +
  //    panel'i sayfaya ekler.
  window.initVoiceBriefing = function () {
    try {
      _injectStyles();
      _renderUI();
      var ttt = _getTTT();
      if (!ttt) { console.warn('[voice-briefing] Temsilci bulunamadı, otomatik brifing atlandı.'); return; }
      if (!_supportsTTS()) return; // ses okuma desteklenmiyorsa arka plan üretimi gereksiz
      _setStatus('⏳ Bugünkü brifing hazırlanıyor…');
      generateBriefing(ttt, false).then(function (text) {
        STATE.briefingText = text;
        STATE.ready = true;
        _updatePanelStatus();
      }).catch(function (e) {
        console.warn('[voice-briefing] Otomatik brifing hazırlanamadı:', e.message);
        _setStatus('⚠️ Brifing hazırlanamadı — "Dinle" butonuna dokunarak tekrar deneyin.');
      });
    } catch (e) {
      console.error('[voice-briefing] init hata:', e);
    }
  };

})();
