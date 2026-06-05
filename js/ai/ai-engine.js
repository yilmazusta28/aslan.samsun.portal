// ══════════════════════════════════════════════════════════════════════
//  SAMSUN 2D PORTAL  ·  ai-engine.js
//  Phase 2.0 extraction — index.html L5122-5745
//
//  Sorumluluk:
//    • engineSelTTT state          (bu dosyada tanımlanır)
//    • renderEngine()              — engine UI render
//    • _engineRunLock              — çift çalışma koruması (B-03-1)
//    • runEngine()                 — orchestrator
//    • _runEngineCore()            — hesap + DOM yazma
//    • _engineInflight             — AI concurrency guard (B-03-2)
//    • engineAiAnalysis(type)      — AI fetch + render
//    • switchAiTab(tab)            — tab geçişi
//    • setAiTTT(ttt)               — TTT seçimi
//
//  Global bağımlılıklar (index.html scope'tan okur):
//    Veri    : GENEL, IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded
//    Sabitler: OWN_IMS, IMS_TL_MAP, URUN_ORDER, PERIODS, ALL_TTTS
//              GS_ECZANE_URL, URUN_CLR
//    Utils   : workDays(), fK(), fTL(), fPct(), calcPrimPuani()
//              getBrickTTTMap(), parseEczaneCSV(), getTTTPhoto()
//              _autoSelTTT(), SoundFX
//    AI      : buildTTTContext(), fetchAI(), _formatAIReply()
//              renderAiAsistan(), selAiTTT
//
//  Yükleme sırası: ai-context.js, ai-service.js SONRASI — app.js ÖNCESI
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded */
/* global OWN_IMS, IMS_TL_MAP, URUN_ORDER, PERIODS, ALL_TTTS, GS_ECZANE_URL, URUN_CLR */
/* global workDays, fK, fTL, fPct, calcPrimPuani, getBrickTTTMap, parseEczaneCSV */
/* global getTTTPhoto, _autoSelTTT, SoundFX, buildTTTContext, fetchAI, _formatAIReply */
/* global renderAiAsistan, selAiTTT */

function renderEngine() {
  // Temsilci bar oluştur
  const bar = document.getElementById('engineTttBar');
  if (!bar) return;
  const allT = ['ŞENOL YILMAZ', ...ALL_TTTS];
  if (!engineSelTTT && ALL_TTTS.length) engineSelTTT = _autoSelTTT(ALL_TTTS[0]);

  bar.innerHTML = allT.map(t => {
    const isSenol = t === 'ŞENOL YILMAZ';
    const photoUrl = getTTTPhoto(t);
    const initials = t.split(' ').map(w=>w[0]).slice(0,2).join('');
    const avatarHtml = photoUrl
      ? `<img src="${photoUrl}" onerror="this.style.display='none'" crossorigin="anonymous">`
      : `<div class="etb-avatar" style="background:${URUN_CLR[isSenol?'PANOCER':'ACİDPASS']||'#4F008C'}">${initials}</div>`;
    return `<button class="engine-ttt-btn${t===engineSelTTT?' active':''}" onclick="setAiTTT('${t}')">
      ${avatarHtml}
      <span>${isSenol?'🏢 '+t:t}</span>
    </button>`;
  }).join('');

  // Hero meta güncelle
  const today = new Date().toISOString().slice(0,10);
  const cur = PERIODS.find(p=>today>=p.start&&today<=p.end);
  const rem = cur ? workDays(today, cur.end) : '—';

  const gt = GENEL.find(r=>r.ttt===engineSelTTT&&r.urun==='GENEL TOPLAM');
  document.getElementById('emv_ttt').textContent   = engineSelTTT.split(' ')[0];
  document.getElementById('emv_real').textContent  = gt ? fPct(gt.tl_pct) : '—';
  document.getElementById('emv_real').className    = 'engine-meta-val ' + (gt?.tl_pct>=91?'good':gt?.tl_pct>=70?'warn':'danger');
  document.getElementById('emv_gun').textContent   = rem + ' gün';
  document.getElementById('emv_kalan').textContent = gt ? fTL(Math.max(0,gt.kalan_tl)) : '—';
  document.getElementById('emv_donem').textContent = cur ? cur.label : '—';
  document.getElementById('engineTttBadge').textContent = engineSelTTT;

  // Eğer daha önce çalıştırıldıysa output koru
}

// ── Motoru çalıştır ─────────────────────────────────────────
// ── B-03-1: _engineRunLock — runEngine çift çağrı koruması ─────────────────
// btn.disabled tek başına yetmez: 120ms setTimeout penceresi içinde
// programatik çağrı veya race ile ikinci _runEngineCore başlatılabilir.

// _engineRunLock → js/core/async-guard.js

function runEngine() {
  if (!engineSelTTT) { alert('Temsilci seçin!'); return; }

  // ── B-03-1: Duplicate execution guard ──────────────────────────────────
  if (_engineRunLock) {
    console.warn('[runEngine] Zaten çalışıyor, atlandı');
    return;
  }
  _engineRunLock = true;

  const btn = document.getElementById('engineRunBtn');
  btn.disabled = true;
  btn.classList.add('running');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analiz ediliyor...';

  setTimeout(() => {
    try {
      _runEngineCore();
    } catch(e) {
      console.error('Engine error:', e);
    }
    btn.disabled = false;
    btn.classList.remove('running');
    btn.innerHTML = '<i class="fas fa-bolt"></i> Motoru Çalıştır';
    _engineRunLock = false;    // ── B-03-1: her durumda serbest bırak
  }, 120);
}

function _runEngineCore() {
  const ttt = engineSelTTT;
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const todayDisplay = today.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long'});

  // ── Veri topla ──────────────────────────────────────────
  const cur     = PERIODS.find(p=>todayStr>=p.start&&todayStr<=p.end);
  const remDays = cur ? workDays(todayStr, cur.end) : 0;
  const gt      = GENEL.find(r=>r.ttt===ttt&&r.urun==='GENEL TOPLAM');
  const urunRows= GENEL.filter(r=>r.ttt===ttt&&r.urun!=='GENEL TOPLAM');
  // MI&GI: MIGI_BRICK_TL_RAW'dan bu temsilcinin en son döneme ait brick bazlı verisi
  const _migiSrc = (MIGI_BRICK_TL_RAW||[]).filter(r=>r.person===ttt);
  // Brick başına mevcut dönemdeki ortalama mi/gi değerlerini hesapla
  const _brickMap = {};
  _migiSrc.forEach(r=>{
    const k = r.brick;
    if(!_brickMap[k]) _brickMap[k]={brick:k,sira:r.sira,miVals:[],bVals:[],person:r.person};
    if(r.mi!=null) _brickMap[k].miVals.push(r.mi);
    if(r.bi!=null) _brickMap[k].bVals.push(r.bi);
  });
  const migiRows = Object.values(_brickMap).map(b=>({
    brick:b.brick, sira:b.sira, person:b.person, ttt:ttt,
    mi: b.miVals.length ? b.miVals.reduce((s,v)=>s+v,0)/b.miVals.length : null,
    gi: b.bVals.length  ? b.bVals.reduce((s,v)=>s+v,0)/b.bVals.length  : null,
    panocer_mi: b.miVals.length ? b.miVals[b.miVals.length-1] : 0
  })).filter(b=>b.sira);
  const eczRows = (ECZANE_RAW||[]).filter(r=>r.ttt===ttt);

  // IMS verileri
  const imsRows = (IMS||[]).filter(r=>r.ttt===ttt);

  // ── KPI hesapla ─────────────────────────────────────────
  // kalanTL: CSV sütun R sıfırsa hedef_tl - satis_tl ile türet
  const _gtKalanRaw  = gt ? gt.kalan_tl : 0;
  const _gtKalanCalc = (gt && gt.hedef_tl > 0)
    ? Math.max(0, gt.hedef_tl - (gt.satis_tl || 0))
    : 0;
  const kalanTL     = _gtKalanRaw > 0 ? _gtKalanRaw : _gtKalanCalc;
  const totalReal   = gt ? gt.tl_pct : 0;
  const kalanPerDay = remDays > 0 && kalanTL > 0 ? kalanTL / remDays : 0;

  // Ürün bazlı kalan & günlük hedef
  const urunKPI = urunRows.map(r => {
    const p     = IMS_TL_MAP[r.urun] || 0;
    // kalan_tl: CSV'den geliyorsa kullan, 0 ise hedef×(1-real%) ile türet
    const rawKalan = r.kalan_tl;
    const calcKalan = (r.hedef_tl > 0 && r.tl_pct > 0)
      ? Math.max(0, r.hedef_tl * (1 - r.tl_pct / 100))
      : 0;
    const kalan = (rawKalan > 0) ? rawKalan : calcKalan;
    // kalanKutu: CSV kalan_kutu_100 > TL/fiyat hesabı > 0
    const kalanKutu = (r.kalan_kutu_100 > 0)
      ? r.kalan_kutu_100
      : (p > 0 && kalan > 0 ? Math.round(kalan / p) : 0);
    const gunlukKutu = remDays > 0 && kalanKutu > 0 ? Math.ceil(kalanKutu / remDays) : 0;
    // tl_pct < 100 ise henüz hedefe ulaşılmamış — kalan sıfır gösterme
    const hedeyeUlasti = r.tl_pct >= 100;
    return { ...r, kalan, kalanKutu, gunlukKutu, imsFiyat: p, hedeyeUlasti };
  });

  // ── Brick analizi ───────────────────────────────────────
  const top333    = migiRows.filter(r=>r.sira<=333);
  const riskBricks= top333.filter(r=>r.mi<90||r.gi<90).sort((a,b)=>a.sira-b.sira).slice(0,5);
  const oppBricks = top333.filter(r=>r.mi>=110&&r.gi>=100).sort((a,b)=>a.sira-b.sira).slice(0,5);
  const critBricks= riskBricks.slice(0,3); // ilk 3 risk brick = bugün git

  // IMS'ten risk brickler (pazar payı düşük)
  const imsRiskBricks = [];
  if (imsRows.length) {
    const brickSet = [...new Set(imsRows.map(r=>r.brick))];
    brickSet.forEach(b => {
      const mkt  = imsRows.filter(r=>r.brick===b&&r.is_mkt).reduce((s,r)=>s+r.toplam,0);
      const own  = imsRows.filter(r=>r.brick===b&&!r.is_mkt&&Object.values(OWN_IMS).includes(r.ilac)).reduce((s,r)=>s+r.toplam,0);
      if (mkt > 300 && own / Math.max(1,mkt) < 0.15) {
        imsRiskBricks.push({ brick: b, ppi: (own/mkt*100).toFixed(0), mkt });
      }
    });
    imsRiskBricks.sort((a,b)=>b.mkt-a.mkt);
  }

  // ── Eczane analizi ──────────────────────────────────────
  // Eczane ttt ataması (lazy) — brickTTT haritasıyla ttt null satırları düzelt
  if (ECZANE_RAW && ECZANE_RAW.length) {
    const _bttMap = getBrickTTTMap();
    if (Object.keys(_bttMap).length) {
      ECZANE_RAW.forEach(r=>{ if(!r.ttt && r.brick) r.ttt=_bttMap[r.brick.toUpperCase()]||null; });
    }
  }
  // Eczane yüklü değilse arka planda yükle (motor tekrar çalıştırılınca hazır olur)
  if (!eczaneLoaded && !ECZANE_RAW) {
    fetch(GS_ECZANE_URL+'?v='+Date.now(),{cache:'no-store'})
      .then(r=>r.ok?r.text():Promise.reject('HTTP '+r.status))
      .then(csv=>{ECZANE_RAW=parseEczaneCSV(csv);eczaneLoaded=true;console.log('[ECZANE BG-engine]',ECZANE_RAW.length);})
      .catch(e=>console.warn('[ECZANE BG-engine]',e));
  }
  // ECZANE_RAW ham satır formatı: {gln, ad, brick, urun, adet, ay, ttt}
  // Motor için eczane bazında topla (ay ayrımı olmadan toplam adet)
  const _eczMap = {};
  (ECZANE_RAW||[]).filter(r=>r.ttt===ttt&&r.adet>0).forEach(r=>{
    const k = r.gln||r.ad;
    if(!_eczMap[k]) _eczMap[k]={ad:r.ad,brick:r.brick,ttt:r.ttt,toplam:0,urun:r.urun,uruns:new Set()};
    _eczMap[k].toplam += (r.adet||0);
    _eczMap[k].uruns.add(r.urun);
  });
  const aktifEcz = Object.values(_eczMap).filter(e=>e.toplam>0);
  const topEcz   = [...aktifEcz].sort((a,b)=>b.toplam-a.toplam).slice(0,8);

  // ── Prim durumu hesapla ─────────────────────────────────
  const primTL   = gt?.tl_pct >= 91 ? 55000 * (gt.tl_pct>=130?2.5:gt.tl_pct>=120?2.0:gt.tl_pct>=110?1.6:gt.tl_pct>=105?1.3:gt.tl_pct>=100?1.1:gt.tl_pct>=95?1.0:0.9) : 0;
  const primPuan = gt?.prim_pct || calcPrimPuani(Object.fromEntries(urunRows.map(r=>[r.urun,r.tl_pct])), ttt);
  const primPort = (gt?.tl_pct>=91 && primPuan>=91) ? 11000 : 0;
  const primMIGI = gt?.tl_pct>=70 ? 14000 * (migiRows.length > 0 ? (() => {
    const miAvg = migiRows.reduce((s,r)=>s+r.mi,0)/Math.max(1,migiRows.length);
    const giAvg = migiRows.reduce((s,r)=>s+r.gi,0)/Math.max(1,migiRows.length);
    return Math.min((miAvg/100)*(giAvg/100),2.5).toFixed(2);
  })() : 1) : 0;
  const toplamPrim = primTL + primPort + primMIGI;

  // ── Günlük görev kartları oluştur ───────────────────────
  // Kart 1: Bugün git (Brick rotası)
  let brickTasks = '';
  if (critBricks.length) {
    brickTasks = critBricks.map((b,i)=>`
      <div class="task-row">
        <div class="task-priority tp-${i===0?'1':i===1?'2':'3'}">${i+1}</div>
        <div class="task-text">
          <div class="task-main">${b.brick}</div>
          <div class="task-detail">
            <span class="task-tag tt-brick">Sıra #${b.sira}</span>
            MI: ${b.mi?.toFixed(0)||'—'} · GI: ${b.gi?.toFixed(0)||'—'}
            ${b.mi<90?'<span class="task-tag tt-risk">MI Riski</span>':b.gi<90?'<span class="task-tag tt-risk">GI Riski</span>':''}
          </div>
        </div>
      </div>`).join('');
  } else {
    brickTasks = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">İlk 333\'te risk brick yok 🎉</div>';
  }

  // Kart 2: Bugün sat (Ürün hedefleri)
  const urunTasks = urunKPI.filter(r=>!r.hedeyeUlasti).map((r,i)=>`
    <div class="task-row">
      <div class="task-priority ${r.tl_pct<70?'tp-1':r.tl_pct<91?'tp-2':'tp-ok'}">${r.tl_pct<70?'!':r.tl_pct<91?'↑':'✓'}</div>
      <div class="task-text">
        <div class="task-main">${r.urun} <span style="font-size:10px;color:var(--dim)">%${r.tl_pct?.toFixed(0)||0}</span></div>
        <div class="task-detail">
          <span class="task-tag tt-urun">Günlük ${r.gunlukKutu} kutu</span>
          ${r.kalan>0?'Kalan: '+fTL(r.kalan)+' · '+r.kalanKutu+' kutu':('%'+r.tl_pct?.toFixed(0)+' gerçekleşme — hedef yükleniyor')} · ${r.imsFiyat>0?r.imsFiyat+'₺/kutu':''}
        </div>
      </div>
    </div>`).join('') || '<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">Tüm ürünler hedefe ulaştı 🏆</div>';

  // Kart 3: Eczane öncelikleri
  const eczTasks = topEcz.slice(0,4).map((e,i)=>{
    const urunStr = e.uruns ? [...e.uruns].slice(0,2).join('/') : (e.urun||'');
    return `
    <div class="task-row">
      <div class="task-priority tp-${i<2?'2':'3'}">${i+1}</div>
      <div class="task-text">
        <div class="task-main">${e.ad||'Eczane'}</div>
        <div class="task-detail">
          <span class="task-tag tt-brick">${e.brick||'—'}</span>
          Toplam ${fK(e.toplam||0)} kutu · ${urunStr}
        </div>
      </div>
    </div>`;
  }).join('') || `<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">${!eczaneLoaded?'⏳ Eczane verisi yükleniyor… Motoru tekrar çalıştırın.':'Eczane verisi yok'}</div>`;

  // Kart 4: Prim durumu
  const primTasks = `
    <div class="task-row">
      <div class="task-priority ${primTL>0?'tp-ok':'tp-1'}">${primTL>0?'✓':'!'}</div>
      <div class="task-text">
        <div class="task-main">TL Real Primi <span style="font-size:10px;color:var(--dim)">%${totalReal?.toFixed(0)||0}</span></div>
        <div class="task-detail"><span class="task-tag tt-prim">${primTL>0?fTL(primTL):'Henüz yok'}</span> Eşik: %91 · Mevcut: %${totalReal?.toFixed(1)||0}</div>
      </div>
    </div>
    <div class="task-row">
      <div class="task-priority ${primPort>0?'tp-ok':'tp-2'}">${primPort>0?'✓':'↑'}</div>
      <div class="task-text">
        <div class="task-main">Portföy Primi <span style="font-size:10px;color:var(--dim)">Puan: ${primPuan?.toFixed(0)||0}</span></div>
        <div class="task-detail"><span class="task-tag tt-prim">${primPort>0?fTL(primPort):'Henüz yok'}</span> Puan eşiği: 91 · Mevcut: ${primPuan?.toFixed(1)||0}</div>
      </div>
    </div>
    <div class="task-row">
      <div class="task-priority ${primMIGI>0?'tp-ok':'tp-3'}">${primMIGI>0?'✓':'↑'}</div>
      <div class="task-text">
        <div class="task-main">MI&GI Primi</div>
        <div class="task-detail"><span class="task-tag tt-prim">${fTL(Math.round(Number(primMIGI)))}</span> Baz: 14.000₺ · Katsayı çarpımı</div>
      </div>
    </div>
    <div class="task-row" style="background:linear-gradient(90deg,rgba(79,0,140,.04),rgba(27,206,216,.02));border:1px solid rgba(79,0,140,.1)">
      <div class="task-priority" style="background:linear-gradient(135deg,#4F008C,#1BCED8)">Σ</div>
      <div class="task-text">
        <div class="task-main" style="color:var(--c1)">Tahmini Toplam Prim</div>
        <div class="task-detail" style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:var(--c2)">${fTL(Math.round(toplamPrim))}</div>
      </div>
    </div>`;

  // Task grid doldur
  document.getElementById('engineTaskGrid').innerHTML = `
    <div class="task-card">
      <div class="task-card-header">
        <div class="task-card-icon" style="background:linear-gradient(135deg,rgba(79,0,140,.1),rgba(79,0,140,.05))">🗺️</div>
        <div><div class="task-card-title">Bugün Git</div><div class="task-card-sub">Öncelikli Brick Rotası</div></div>
      </div>
      ${brickTasks}
    </div>
    <div class="task-card">
      <div class="task-card-header">
        <div class="task-card-icon" style="background:linear-gradient(135deg,rgba(27,206,216,.1),rgba(27,206,216,.05))">💊</div>
        <div><div class="task-card-title">Bugün Sat</div><div class="task-card-sub">Ürün Günlük Hedef</div></div>
      </div>
      ${urunTasks}
    </div>
    <div class="task-card">
      <div class="task-card-header">
        <div class="task-card-icon" style="background:linear-gradient(135deg,rgba(217,119,6,.1),rgba(217,119,6,.05))">🏥</div>
        <div><div class="task-card-title">Öncelikli Eczaneler</div><div class="task-card-sub">Top ${Math.min(4,topEcz.length)} Müşteri</div></div>
      </div>
      ${eczTasks}
    </div>
    <div class="task-card">
      <div class="task-card-header">
        <div class="task-card-icon" style="background:linear-gradient(135deg,rgba(5,150,105,.1),rgba(5,150,105,.05))">💰</div>
        <div><div class="task-card-title">Prim Durumu</div><div class="task-card-sub">Dönemlik Tahmin</div></div>
      </div>
      ${primTasks}
    </div>`;

  // ── Risk paneli ─────────────────────────────────────────
  const riskHtml = [
    ...riskBricks.slice(0,4).map(b=>`
      <div class="risk-item ri-danger">
        <div class="risk-item-name">⚠️ ${b.brick}</div>
        <div class="risk-item-detail">Sıra #${b.sira} · MI: ${b.mi?.toFixed(0)||'—'} · GI: ${b.gi?.toFixed(0)||'—'}<br>
        ${b.mi<90?'<b>MI indeksi kritik!</b>':''} ${b.gi<90?'<b>GI indeksi kritik!</b>':''}</div>
      </div>`),
    ...urunKPI.filter(r=>r.tl_pct<70).map(r=>`
      <div class="risk-item ri-warn">
        <div class="risk-item-name">📉 ${r.urun}</div>
        <div class="risk-item-detail">Gerçekleşme: %${r.tl_pct?.toFixed(1)||0}${r.kalan>0?' · Kalan: '+fTL(r.kalan):''}<br>
        Günlük hedef: ${r.gunlukKutu > 0 ? r.gunlukKutu + ' kutu' : (r.tl_pct < 100 ? 'Hedef TL eksik — CSV güncelle' : '✅')} (${remDays} gün kaldı)</div>
      </div>`),
    ...imsRiskBricks.slice(0,2).map(b=>`
      <div class="risk-item ri-warn">
        <div class="risk-item-name">📊 ${b.brick}</div>
        <div class="risk-item-detail">IMS Pay: %${b.ppi} (eşik %15) · Pazar: ${fK(b.mkt)} kutu<br>Rakip baskısı yüksek!</div>
      </div>`),
  ].join('') || '<div style="color:var(--good);font-size:12px;padding:12px;text-align:center">Risk tespit edilmedi 🎉</div>';

  // ── Fırsat paneli ───────────────────────────────────────
  const oppHtml = [
    ...oppBricks.slice(0,4).map(b=>`
      <div class="risk-item ri-good">
        <div class="risk-item-name">🚀 ${b.brick}</div>
        <div class="risk-item-detail">Sıra #${b.sira} · MI: ${b.mi?.toFixed(0)||'—'} · GI: ${b.gi?.toFixed(0)||'—'}<br>
        Güçlü performans — payı artır!</div>
      </div>`),
    ...urunKPI.filter(r=>r.tl_pct>=91).map(r=>`
      <div class="risk-item ri-blue">
        <div class="risk-item-name">✅ ${r.urun}</div>
        <div class="risk-item-detail">%${r.tl_pct?.toFixed(1)||0} gerçekleşme · Hedefe ulaşıldı<br>
        ${r.kalanKutu>0?'Ekstra satış bonus artırır':'Hedef üstü sat!'}</div>
      </div>`),
  ].slice(0,5).join('') || '<div style="color:var(--dim);font-size:12px;padding:12px;text-align:center">Analiz için daha fazla veri gerekli</div>';

  document.getElementById('engineRisks').innerHTML = riskHtml;
  document.getElementById('engineOpps').innerHTML  = oppHtml;

  // ── Haftalık Strateji Timeline ──────────────────────────
  const totalWeeks = Math.ceil(remDays / 5);
  const wks = [];
  let cumDays = 0;
  for (let w=0; w<Math.min(totalWeeks,4); w++) {
    const wDays  = Math.min(5, remDays - cumDays);
    const wKalan = kalanTL > 0 ? Math.round(kalanTL * wDays / Math.max(1,remDays)) : 0;
    const wKutu  = urunKPI.map(r=>{
      // kalanKutu 0 ise hedef_kutu × kalan% / remDays ile türet
      let kutu = r.kalanKutu || 0;
      if (kutu === 0) {
        // Önce CSV'deki kalan_kutu_100 alanını kullan
        if (r.kalan_kutu_100 > 0) {
          kutu = r.kalan_kutu_100;
        } else if (r.hedef_kutu > 0 && r.tl_pct < 100) {
          // CSV'de yoksa hedef × kalan% hesapla
          kutu = Math.round(r.hedef_kutu * (1 - r.tl_pct / 100));
        }
      }
      return {urun:r.urun, kutu: Math.ceil(kutu * wDays / Math.max(1,remDays))};
    });
    const dotCls = w===0?'danger':w===1?'warn':'good';
    const brickFocus = critBricks.slice(0,2+w).map(b=>b.brick).join(', ') || 'Tüm brickler';
    wks.push(`
      <div class="stl-item">
        <div class="stl-dot ${dotCls}"></div>
        <div class="stl-week">${w===0?'Bu Hafta':'Hafta '+(w+1)} · ${wDays} iş günü</div>
        <div class="stl-content">
          <div class="stl-title">${w===0?'🔥 Kritik Görevler':w===1?'📈 Büyüme Hedefi':w===2?'🎯 Konsolidasyon':'🏁 Sprint Finish'}</div>
          <div class="stl-tasks">
            <b>TL Hedef:</b> ${fTL(wKalan)} (günlük ${fTL(Math.round(wKalan/Math.max(1,wDays)))})<br>
            <b>Brick Fokus:</b> ${brickFocus}<br>
            <b>Ürün önceliği:</b> ${wKutu.filter(k=>k.kutu>0).map(k=>`${k.urun}: ${k.kutu} kutu`).join(' · ')||'—'}
          </div>
        </div>
      </div>`);
    cumDays += wDays;
  }

  document.getElementById('engineTimeline').innerHTML = wks.join('');
  document.getElementById('engineWeekBadge').textContent = totalWeeks + ' Hafta Kaldı';

  // ── Prim Optimizasyon Senaryosu ─────────────────────────
  const hedefReal = 91;
  const gerekliKalanTL = gt && gt.hedef_tl ? gt.hedef_tl * hedefReal/100 - gt.satis_tl : 0;
  const gerekliTLStr = gerekliKalanTL > 0 ? fTL(Math.max(0,gerekliKalanTL)) + ' daha satmalı' : '✅ Hedef aşıldı';

  document.getElementById('enginePrimPanel').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">
      <div style="background:linear-gradient(135deg,rgba(79,0,140,.07),rgba(79,0,140,.03));border:1px solid rgba(79,0,140,.12);border-radius:14px;padding:16px">
        <div style="font-size:10px;color:var(--c1);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">%91 İçin Gereken</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:var(--c2)">${gerekliTLStr}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:4px">Mevcut: %${totalReal?.toFixed(1)||0}</div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(217,119,6,.07),rgba(217,119,6,.03));border:1px solid rgba(217,119,6,.15);border-radius:14px;padding:16px">
        <div style="font-size:10px;color:#D97706;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Tahmini TL Prim</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:#D97706">${fTL(Math.round(primTL))}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:4px">Baz: 55.000₺/dönem</div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(5,150,105,.07),rgba(5,150,105,.03));border:1px solid rgba(5,150,105,.15);border-radius:14px;padding:16px">
        <div style="font-size:10px;color:#059669;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Portföy Primi</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:#059669">${primPort>0?fTL(primPort):'Henüz yok'}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:4px">Prim Puanı: ${primPuan?.toFixed(1)||0} (eşik: 91)</div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(14,116,144,.07),rgba(14,116,144,.03));border:1px solid rgba(14,116,144,.15);border-radius:14px;padding:16px">
        <div style="font-size:10px;color:#0E7490;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">MI&GI Primi</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:#0E7490">${fTL(Math.round(Number(primMIGI)))}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:4px">Baz: 14.000₺</div>
      </div>
    </div>
    <div style="background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:14px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;color:#fff;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:4px">Tahmini Dönem Toplam Prim</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:800">${fTL(Math.round(toplamPrim))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;opacity:.7;margin-bottom:3px">%91 hedefe ulaşıldığında</div>
        <div style="font-size:11px;opacity:.85">${gerekliKalanTL>0?'Kalan: '+fTL(Math.round(gerekliKalanTL)):' Hedef aşıldı 🎉'}</div>
      </div>
    </div>`;

  document.getElementById('enginePrimBadge').textContent = fTL(Math.round(toplamPrim));

  // ── Tarih badge ─────────────────────────────────────────
  document.getElementById('taskDateBadge').textContent = todayDisplay + ' · ' + remDays + ' iş günü';

  // Output göster, empty gizle
  document.getElementById('engineOutput').style.display = 'block';
  document.getElementById('engineEmpty').style.display  = 'none';

  // AI çıktı alanını sıfırla
  document.getElementById('engineAiOutput').style.display = 'none';
  document.getElementById('engineAiChatArea').innerHTML = '';
}

// ── Engine AI Analizi ────────────────────────────────────────
// ── ENGINE AI CONCURRENCY GUARD (FIX-RT-02) ──────────────────
// Motor analizi paralel çağrılmasını engeller.
// _engineInflight → js/core/async-guard.js


async function engineAiAnalysis(type) {
  if (_engineInflight) {
    const aiArea = document.getElementById('engineAiChatArea');
    if (aiArea) {
      aiArea.innerHTML += `<div class="ai-bubble-ai" style="opacity:.6;font-size:11px">
        <strong style="color:#92400E">⏳ Bekle</strong><br>
        Önceki analiz devam ediyor…
      </div>`;
      aiArea.scrollTop = aiArea.scrollHeight;
    }
    return;
  }
  _engineInflight = true;

  const aiOut  = document.getElementById('engineAiOutput');
  const aiArea = document.getElementById('engineAiChatArea');
  aiOut.style.display = 'block';

  // ── B-02-5: TTT snapshot — fetch sırasında engineSelTTT değişirse yanıt yoksayılır ──
  const _reqEngTTT = engineSelTTT;

  const loadId = 'eng_ai_' + Date.now();
  aiArea.innerHTML += `<div id="${loadId}" class="ai-bubble-ai">
    <strong style="color:var(--c1)"><i class="fas fa-brain" style="margin-right:5px"></i>Strateji Motoru</strong><br>
    <span style="color:var(--dim)">⏳ Analiz hazırlanıyor...</span>
  </div>`;
  aiArea.scrollTop = aiArea.scrollHeight;

  // Phase 4.1 — Unified Context: tüm motorların çıktısını birleştir
  let ctx;
  try {
    ctx = buildTTTContext(engineSelTTT);
    if (typeof buildForecastContext  === 'function') ctx += buildForecastContext(engineSelTTT);
    if (typeof buildPrimContext      === 'function') ctx += buildPrimContext(engineSelTTT);
    if (typeof buildSimulatorContext === 'function') ctx += buildSimulatorContext(engineSelTTT);
    if (typeof buildTerritoryContext === 'function') ctx += buildTerritoryContext(engineSelTTT);
    if (typeof buildExecutiveContext === 'function') ctx += buildExecutiveContext([engineSelTTT]);
  } catch (_ctxErr) {
    console.warn('[ai-engine] engineAiAnalysis context hata, fallback:', _ctxErr.message);
    ctx = buildTTTContext(engineSelTTT);
  }
  const today = new Date();
  const cur = PERIODS.find(p=>{const t=today.toISOString().slice(0,10);return t>=p.start&&t<=p.end;});
  const remDays = cur ? workDays(today.toISOString().slice(0,10), cur.end) : 0;

  const prompts = {
    full: `Görev Motoru — Samsun 2D Kapsamlı Analiz

Temsilci: ${engineSelTTT} | Kalan: ${remDays} iş günü

ÖNCELİKLE projeksiyon verilerini değerlendir:
- Mevcut günlük run-rate ile dönem sonunda hangi %realizasyona ulaşılır?
- %91 hedefi için gereken günlük satış vs mevcut günlük ortalama farkı nedir?
- Buna göre hedef "ulaşılabilir / zorlu / kritik" kategorisinden hangisine giriyor?

Sonra aşağıdakileri üret:
1. DURUM DEĞERLENDİRMESİ → Projeksiyon bazlı gerçekçi dönem sonu tahmini ve hedef mesafesi
2. BUGÜN NE YAP? → En kritik 3 brick ziyareti, öncelikli ürün ve hedef kutu sayısı
3. BU HAFTA PLANI → Günlük TL hedefi, brick rotası, eczane öncelikleri
4. GAP KAPATMA STRATEJİSİ → %91 için hangi ürün/brick kombinasyonu, somut kutu hedefi
5. PRİM YOLU → Hangi ürüne odaklanılmalı, prim puanı nasıl artırılır
6. SOMUT SAYILAR → Her öneri için kutu, TL ve eczane ismi ver

Not: "Hedefi tutamazsın" yerine "Şu anda X hızındasın, %91 için Y₺/gün daha gerekiyor, bunu Z brick/ürün ile kapatabilirsin" formatında yanıt ver.

${ctx}`,

    bricks: `Görev Motoru — Brick Ziyaret Planı

Temsilci: ${engineSelTTT} | Kalan: ${remDays} iş günü

Önce projeksiyon verisini oku: dönem sonu tahmini ve günlük gap ne kadar?
Bu gap'i hangi bricklerde kapatmak en verimli? Buna göre:
1. Bugün gidilecek İLK 5 brick (öncelik sırası ile) — neden öncelikli olduğunu say
2. Her brick için: hangi eczanelere git, hangi ürünü sun, kaç kutu hedefle
3. Risk bricklerde (MI<90 veya GI<90) rakip analizi yap ve savunma stratejisi öner
4. Bir haftalık brick rotası planı — hangi gün nereye git
5. Kalan ${remDays} günde brick başına düşen TL hedefi

${ctx}`,

    prim: `Görev Motoru — Prim Maksimizasyon Planı

Temsilci: ${engineSelTTT} | Kalan: ${remDays} iş günü

ÖNCELİKLE projeksiyon verilerini değerlendir:
- Mevcut run-rate ile dönem sonu %kaçta biter?
- %91 eşiğine ulaşmak için kalan ${remDays} günde günlük kaç ₺ gerekiyor?
- Bu rakam mevcut günlük ortalamaya göre gerçekçi mi?

Sonra:
1. Üç senaryo analizi: iyi/baz/kötü — her birinde tahmini prim tutarı
2. %91 TL Real için ürün bazlı günlük kutu hedefi (somut, isimli)
3. Portföy primini almak için prim puanı nasıl 91'e çıkar
4. MI&GI primini artırmak için brick öncelikleri
5. En yüksek prim için hangi ürün/brick kombinasyonu — tablo formatında ver

${ctx}`,

    eczane: `Görev Motoru — Eczane Sipariş Planı

Temsilci: ${engineSelTTT} | Kalan: ${remDays} iş günü

Projeksiyon verilerini göz önünde bulundur: günlük gap ne kadar?
Bu gap'i eczane bazında nasıl dağıt?

1. Bu hafta sipariş zamanı gelen TOP 10 eczane (tüketim hızı bazlı)
2. Her eczane için önerilen ürün, hedef kutu ve günlük gap'e katkısı
3. Kalan ${remDays} günde eczane başına düşen satış hedefi
4. Kampanya alımı yapıp uzun süre almayacak eczaneleri işaretle
5. Brick bazında eczane yoğunlaşma analizi — hangi brickte potansiyel var

${ctx}`
  };

  const systemPrompt = `Sen İLKO İlaç Samsun 2D bölgesi için çalışan uzman satış stratejistsin.
Net, somut, uygulanabilir Türkçe yanıtlar ver. Her öneri için sayısal hedef belirt.
Brick ve eczane isimlerini mutlaka kullan.
Format: başlıklar bold (**Başlık**), maddeler net ve kısa.

ZAMAN DUYARLI DEĞERLENDİRME — MUTLAKA UYGULA:
- Hedefler 2 aylık dönemde değerlendirilir. Anlık realizasyon tek başına yorum yapılamaz.
- Verilen 'Projeksiyon Analizi' bölümünü analiz et: run-rate, senaryo ve gap verilerini kullan.
- Değerlendirme çerçeven: (1) Mevcut ivme ile dönem sonu projeksiyonu → (2) %91 için günlük gap → (3) Eylem planı
- 'Hedefi tutamazsın' yerine: 'Mevcut hızla dönem sonunda %X realizasyona ulaşırsın. %91 için günlük Y₺ daha gerekiyor. Bunu Z ürünü/brick ile kapatabilirsin.' de.
- Kalan gün > toplam günün %60'ı ise: motivasyon yüksek tut, büyüme odaklı plan ver.
- Kalan gün < %30 ise: somut acil eylem planı, günlük kutu hedefleri ve eczane listesi ver.`;

  try {
    const AI_PROXY = window.AI_PROXY_URL || 'https://samsun.yilmazusta28.workers.dev';
    const response = await fetch(AI_PROXY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompts[type] || prompts.full }]
      })
    });

    // ── B-02-4: HTTP hata kontrolü ─────────────────────────────────────────
    if (!response.ok) {
      throw new Error(`Sunucu hatası: HTTP ${response.status} ${response.statusText}`);
    }

    const data   = await response.json();
    const reply  = data.content?.[0]?.text || 'Yanıt alınamadı.';

    // ── B-02-5: Stale response koruması — fetch sırasında TTT değiştiyse yoksay ──
    if (engineSelTTT !== _reqEngTTT) {
      console.warn('[engineAI] Stale response discarded — TTT changed', _reqEngTTT, '→', engineSelTTT);
      const el = document.getElementById(loadId);
      if (el) el.remove();   // stale bubble'ı DOM'dan temizle
      return;
    }

    const fmt    = reply.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    const el     = document.getElementById(loadId);
    if (el) el.innerHTML = `<strong style="color:var(--c1)"><i class="fas fa-brain" style="margin-right:5px"></i>Strateji Motoru</strong><br><div style="margin-top:8px;line-height:1.7">${fmt}</div>`;
  } catch(err) {
    const el = document.getElementById(loadId);
    if (el) el.innerHTML = `<strong style="color:#DC2626">⚠️ Hata</strong><br>${err.message}`;
  } finally {
    _engineInflight = false;                    // FIX-RT-02: her durumda kilidi serbest bırak
  }
  aiArea.scrollTop = aiArea.scrollHeight;
}


// ── SEKMELİ AI SAYFA ──────────────────────────────────────────────────────

function switchAiTab(tab) {
  SoundFX.click();
  // Tüm sekme içeriklerini gizle
  ['motor','chat','quick'].forEach(t => {
    const el = document.getElementById('aiTab_' + t);
    const btn = document.getElementById('tab_' + t);
    if (el) el.style.display = 'none';
    if (btn) {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--dim)';
      btn.style.borderBottomColor = 'transparent';
      btn.style.fontWeight = '600';
    }
  });
  // Seçili sekmeyi göster
  const active = document.getElementById('aiTab_' + tab);
  const activeBtn = document.getElementById('tab_' + tab);
  if (active) active.style.display = 'block';
  if (activeBtn) {
    activeBtn.style.background = 'linear-gradient(135deg,rgba(79,0,140,.06),rgba(27,206,216,.03))';
    activeBtn.style.color = 'var(--c1)';
    activeBtn.style.borderBottomColor = 'var(--c1)';
    activeBtn.style.fontWeight = '700';
  }
}

// ── renderEngine'da selAiTTT←→engineSelTTT senkronizasyonu ─────────────
// Temsilci seçilince her iki değişkeni güncelle
function setAiTTT(ttt) {
  SoundFX.click();

  // ── B-03-4: Inflight uyarısı — AI request sırasında TTT değişimi ────────
  // _aiInflight veya _engineInflight aktifse: kullanıcıyı uyar, değişime izin ver.
  // Stale response koruması (B-02-5) fetch tamamlandığında yanıtı yoksayar.
  if ((_aiInflight || _engineInflight) && ttt !== selAiTTT) {
    console.warn('[setAiTTT] Inflight request sırasında TTT değişimi:', selAiTTT, '→', ttt,
      '— mevcut yanıt tamamlandığında yoksayılacak.');
    // UI: aktif butonu güncelle ama mevcut fetch'i iptal etme
    // (AbortController Phase 2 için ayrılmıştır — şimdilik graceful discard yeterli)
  }

  selAiTTT     = ttt;
  engineSelTTT = ttt;
  renderAiAsistan();
}

// ── showZamHesapQuick: quick sekmesindeki zam panelini göster (FIX-RT-07) ──
// ÖNCEKİ: function showZamHesap() redeclaration — strict mode'da SyntaxError
// DÜZELTME: showZamHesapQuick olarak yeniden adlandırıldı
// HTML: onclick="showZamHesap()" → onclick="showZamHesapQuick()" güncellendi
