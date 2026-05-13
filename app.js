/* ════════════════════════════════════════════════════════════
   SAMSUN 2D SATIŞ PORTALI — app.js
   DOM manipülasyonu, olay dinleyiciler, grafik çizimleri,
   veri çekme (syncData) ve tüm render fonksiyonları.
   utils.js yüklü olmalıdır.
   ════════════════════════════════════════════════════════════ */

// ── VERİ DEPOLARI ─────────────────────────────────────────────
let IMS   = [];
let GENEL = [];
let KUTU  = [];
let MIGI_RAW = [], MIGI_TL_RAW = [], MIGI_KUTU_RAW = [];
let MIGI_BRICK_TL_RAW = [], MIGI_BRICK_KUTU_RAW = [];
let ECZANE_RAW = null, eczaneLoaded = false;

// ── UYGULAMA STATE ────────────────────────────────────────────
let curPage = 0, selTTT = '', selTTT_p1 = '', selTTT_p2 = '';
let selGroup = ALL_GROUPS[0], selHafta = 'toplam';
let selKutuUruns = new Set(URUN_ORDER);
let charts = {}, LOGGED_IN_USER = '';
let selAiTTT = '', aiChatHistory = [], engineSelTTT = '';
let mg1_tip='TL', mg1_donem='TÜMÜ', mg1_veri='TUM';
let mg2_tip='TL', mg2_ttt='', mg2_brick='TÜMÜ', mg2_donem='TÜMÜ', mg2_veri='TUM', mg2_333=false;
let selMigiTip='TL', selMigiTTT='', selMigiBrick='TÜMÜ', selMigiDonem='TÜMÜ', selMigiIlac='TÜMÜ';
let selEczaneTTT='', selEczaneBrick='TÜMÜ', selEczaneUrun='TÜMÜ', selEczaneAy='TÜMÜ';
let eczaneSortKey='toplam', eczaneSortAsc=false;
let _eczaneData=[], _eczaneSearchFilter='';
let CALC_SYNC = {ttt:'', totPct:0, totPrimPuan:0, urunReals:{}, timestamp:0};

// ── FORMAT ───────────────────────────────────────────────────
function fTL(n){if(n==null||isNaN(n))return'—';const abs=Math.abs(n),sign=n<0?'-':'';return sign+Math.round(abs).toLocaleString('tr-TR')+'₺';}
function fK(n){if(n==null||isNaN(n))return'—';return Math.round(n).toLocaleString('tr-TR');}
function fPct(n){if(n==null)return'—';return n.toFixed(1)+'%';}
function pCls(p){return p>=70?'bdg-good':p>=50?'bdg-mid':'bdg-bad';}
function barCls(p){return p>=70?'p-good':p>=50?'p-mid':'p-bad';}

// ── GRAFİK ───────────────────────────────────────────────────
function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function mkChart(id,type,data,opts={}){
  destroyChart(id);
  const ctx=document.getElementById(id);if(!ctx)return;
  charts[id]=new Chart(ctx,{type,data,options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#718096',font:{size:10,family:'Inter'},padding:8}},tooltip:{bodyFont:{family:'JetBrains Mono',size:11},titleFont:{family:'Inter',size:11}}},scales:(!['pie','doughnut'].includes(type))?{x:{grid:{color:'#F0F4F8'},ticks:{color:'#718096',font:{size:9}}},y:{grid:{color:'#F0F4F8'},ticks:{color:'#718096',font:{size:9},callback:v=>fK(v)}}}:undefined,...opts}});
  return charts[id];
}

function getTTTPhoto(ttt){
  const m={'ŞENOL YILMAZ':'Senol','YILMAZ USTA':'Yilmaz','MURAT KANDİŞ':'Murat','KÜRŞAD KARADAĞ':'Kursad','EMRAH YILDIZ':'Emrah','HAKAN YUMAK':'Hakan','AYKUT DİNLER':'Aykut','MEHMET AKİF ÖZGEÇEN':'Mehmet','SAMET ÇETİN':'Samet'};
  const n=m[ttt];return n?GITHUB_IMG_BASE+n+'.jpg':null;
}

// ── GİRİŞ ────────────────────────────────────────────────────
function trLower(s){return s.replace(/\u0130/g,'i').replace(/I/g,'\u0131').toLocaleLowerCase('tr-TR');}
function doLogin(){
  const user=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  const errEl=document.getElementById('loginErr');
  const userLow=trLower(user);
  if((VALID_USERS.some(u=>trLower(u)===userLow)||Object.keys(USER_TO_TTT).some(k=>k===userLow))&&pass===VALID_PASS){
    document.getElementById('loginScreen').style.display='none';
    errEl.style.display='none';
    LOGGED_IN_USER=USER_TO_TTT[userLow]||USER_TO_TTT[user.toLowerCase()]||'';
    const _sn=document.getElementById('sidebarUserName'),_sa=document.getElementById('sidebarAvatarWrap');
    if(_sn) _sn.textContent=user;
    if(_sa){const pu=getTTTPhoto(LOGGED_IN_USER||user.toUpperCase());if(pu){_sa.innerHTML='<img src="'+pu+'" alt="'+user+'" crossorigin="anonymous" onerror="this.style.display=\'none\'">';}else{_sa.innerHTML='<span>'+user.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()+'</span>';}}
    if(typeof initApp==='function') initApp(); else window._pendingLogin=true;
  } else {
    errEl.style.display='block';
    document.getElementById('loginPass').value='';
    document.getElementById('loginPass').focus();
  }
}

// ── SIDEBAR ──────────────────────────────────────────────────
function toggleSidebar(){document.getElementById('sidenav')?.classList.toggle('open');document.getElementById('sideOverlay')?.classList.toggle('open');}
function closeSidebar(){document.getElementById('sidenav')?.classList.remove('open');document.getElementById('sideOverlay')?.classList.remove('open');}
function toggleAcc(el){const grp=el.closest('.acc-group'),body=grp.querySelector('.acc-body'),isOpen=grp.classList.contains('open');grp.parentElement.querySelectorAll('.acc-group.open').forEach(g=>{g.classList.remove('open');g.querySelector('.acc-body')?.classList.remove('open');});if(!isOpen){grp.classList.add('open');body?.classList.add('open');}}

// ── ROUTING ──────────────────────────────────────────────────
function goPage(i){
  curPage=i;
  document.querySelectorAll('.page').forEach((p,j)=>p.classList.toggle('active',j===i));
  document.querySelectorAll('.nav-tab').forEach((t,j)=>t.classList.toggle('active',j===i));
  for(let k=0;k<=6;k++){const el=document.getElementById('ni'+k);if(el) el.classList.toggle('active',k===i);}
  if(window.innerWidth<=1024) closeSidebar();
  if(i===0) renderAna();
  else if(i===1) renderPazar();
  else if(i===2) renderTakip();
  else if(i===3) {initMigi1();initMigi2();}
  else if(i===4) {buildPrimInputs();syncPrimFromCalc();}
  else if(i===5) renderAiAsistan();
  else if(i===6) renderEczane();
}
function selectTTT(ttt){selTTT=selTTT===ttt?'':ttt;buildTTTPicker();goPage(0);}
// ── SYNC DATA ────────────────────────────────────────────────
let _syncLock=false;
async function syncData(){
  if(_syncLock){console.log('[syncData] çalışıyor, atlandı');return;}
  _syncLock=true;
  const statusEl=document.getElementById('syncStatus'),loadMsg=document.getElementById('loadMsg');
  statusEl.textContent='⏳ Güncelleniyor…';
  if(window.location.protocol==='file:'){
    const msg='Dosya doğrudan açıldı (file://). Bir web sunucusu veya GitHub Pages üzerinden erişin.';
    if(loadMsg){loadMsg.textContent=msg;loadMsg.style.color='#D97706';loadMsg.style.maxWidth='340px';loadMsg.style.textAlign='center';}
    statusEl.textContent='⚠️ file:// — veri yüklenemez';_syncLock=false;
    document.getElementById('loading').style.display='none';
    if(typeof goPage==='function') goPage(1);return;
  }
  try{
    const fetchOpts={cache:'no-store',mode:'cors'},ts=Date.now();
    const [respIMS,respGenel]=await Promise.all([
      fetch(GS_IMS_URL+'?v='+ts,fetchOpts),
      fetch(GS_GENEL_URL+'?v='+ts,fetchOpts),
    ]);
    const safeGet=async(url)=>{const fn=url.split('/').pop();const attempts=[()=>fetch(url,{cache:'no-store',redirect:'follow'}),()=>fetch(url+'?nocache='+ts,{redirect:'follow'})];for(const a of attempts){try{const r=await a();if(r.ok){const t=await r.text();if(t&&!t.trim().startsWith('<')){console.log('[OK]',fn,t.length,'chars');return t;}console.warn('[WARN] HTML geldi:',fn);}else console.warn('[HTTP '+r.status+']',fn);}catch(e){console.warn('[ERR]',fn,e.message);}}console.error('[FAIL]',fn);return'';};
    if(!respIMS.ok)   throw new Error('IMS_TABLO.csv yüklenemedi (HTTP '+respIMS.status+')');
    if(!respGenel.ok) throw new Error('GENEL_TABLO.csv yüklenemedi (HTTP '+respGenel.status+')');
    const[csvIMS,csvGenel,csvMiGiTL,csvMiGiKutu,csvMiGiBTL,csvMiGiBKutu]=await Promise.all([
      respIMS.text(),respGenel.text(),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_TL_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI_KUTU_TOPLAM.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-TL.csv'),
      safeGet('https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MI_GI-KUTU.csv'),
    ]);
    const newIMS=parseIMSCSV(csvIMS);
    const{genel:newGenel,imsTL:newImsTL,trSira:newTrSira}=parseGenelCSV(csvGenel);
    if(csvMiGiTL)  {try{const p=parseMiGiToplamCSV(csvMiGiTL);  MIGI_TL_RAW.length=0;     MIGI_TL_RAW.push(...p);     }catch(e){console.warn(e);}}
    if(csvMiGiKutu){try{const p=parseMiGiToplamCSV(csvMiGiKutu);MIGI_KUTU_RAW.length=0;   MIGI_KUTU_RAW.push(...p);   }catch(e){console.warn(e);}}
    if(csvMiGiBTL)  {try{const p=parseMiGiBrickCSV(csvMiGiBTL);  MIGI_BRICK_TL_RAW.length=0;  MIGI_BRICK_TL_RAW.push(...p);  }catch(e){console.warn(e);}}
    if(csvMiGiBKutu){try{const p=parseMiGiBrickCSV(csvMiGiBKutu);MIGI_BRICK_KUTU_RAW.length=0;MIGI_BRICK_KUTU_RAW.push(...p);}catch(e){console.warn(e);}}
    IMS.length=0;IMS.push(...newIMS);
    GENEL.length=0;GENEL.push(...newGenel);
    Object.assign(IMS_TL_MAP,newImsTL);
    Object.assign(TR_SIRA_MAP,newTrSira);
    rebuildKutuFromIMS();
    const freshTTTs=[...new Set(newGenel.filter(r=>r.urun!=='GENEL TOPLAM'&&r.ttt!=='ŞENOL YILMAZ').map(r=>r.ttt))].sort();
    ALL_TTTS.length=0;ALL_TTTS.push(...freshTTTs);
    if(!selTTT_p1&&ALL_TTTS.length) selTTT_p1=ALL_TTTS[0];
    if(!selTTT_p2&&ALL_TTTS.length) selTTT_p2=ALL_TTTS[0];
    renderTopBar();
    if(LOGGED_IN_USER&&LOGGED_IN_USER!=='ŞENOL YILMAZ'&&ALL_TTTS.includes(LOGGED_IN_USER)){
      const lu=LOGGED_IN_USER;
      selTTT_p2=lu;selTTT_p1=lu;selMigiTTT=lu;mg2_ttt=lu;selAiTTT=lu;selEczaneTTT=lu;
    }
    if(curPage===0)      renderAna();
    else if(curPage===1) renderPazar();
    else if(curPage===2) renderTakip();
    else if(curPage===3) {initMigi1();initMigi2();}
    else if(curPage===4) buildPrimInputs();
    else if(curPage===5) renderAiAsistan();
    else if(curPage===6) renderEczane();
    const now=new Date();
    statusEl.textContent='✅ '+now.toLocaleTimeString('tr-TR');
    statusEl.title='IMS:'+newIMS.length+' | GENEL:'+newGenel.length+' | TL:'+MIGI_TL_RAW.length+' | BRICK:'+MIGI_BRICK_TL_RAW.length;
    if(loadMsg) loadMsg.textContent='Veriler yüklendi ✅';
    console.log('[SYNC OK] IMS:',newIMS.length,'GENEL:',newGenel.length,'KUTU:',KUTU.length,'TTTS:',ALL_TTTS);
  }catch(err){
    statusEl.textContent='❌ '+err.message;statusEl.title=err.message;
    console.error('[syncData]',err);
    if(loadMsg) loadMsg.textContent='❌ Veri yüklenemedi: '+err.message;
    throw err;
  }finally{setTimeout(()=>{_syncLock=false;},3000);}
}

// ── TOP BAR ──────────────────────────────────────────────────
function renderTopBar(){
  if(!GENEL.length) return;
  const sg=GENEL.find(r=>r.ttt==='ŞENOL YILMAZ'&&r.urun==='GENEL TOPLAM');
  if(sg){
    const h=document.getElementById('sb_hedef'),s=document.getElementById('sb_satis'),p=document.getElementById('sb_pct');
    if(h) h.textContent=fTL(sg.hedef_tl);
    if(s) s.textContent=fTL(sg.satis_tl);
    if(p){p.textContent=fPct(sg.tl_pct);p.className='sb-stat-val '+(sg.tl_pct>=70?'good':sg.tl_pct>=50?'warn':'danger');}
    ['tb_hedef','tb_satis','tb_pct'].forEach((id,i)=>{const el=document.getElementById(id);if(el) el.textContent=[fTL(sg.hedef_tl),fTL(sg.satis_tl),fPct(sg.tl_pct)][i];});
  }
  const today=new Date().toISOString().slice(0,10);
  const cur=PERIODS.find(p=>today>=p.start&&today<=p.end);
  if(cur){const rem=workDays(today,cur.end);const cv=document.getElementById('periodChipVal');if(cv) cv.textContent=cur.label+' — '+rem+' iş günü kaldı';const tpl=document.getElementById('topbarPeriodLabel');if(tpl) tpl.textContent=cur.label+' Dashboard';renderPeriodBanner(cur,rem);renderSidebarPeriodPill(cur,rem);}
}

function renderPeriodBanner(cur,rem){
  const el=document.getElementById('periodBanner');if(!el) return;
  const s=new Date(cur.start),e=new Date(cur.end),t=new Date();
  const pct=Math.min(100,(t-s)/(e-s)*100).toFixed(1);
  const totalWD=workDays(cur.start,cur.end),passWD=Math.max(0,totalWD-rem);
  const pctClr=rem<=5?'#FCD34D':rem<=10?'#FDE68A':'#fff';
  el.style.cssText='background:'+cur.bannerGrad+';border-radius:18px;padding:20px 26px;margin-bottom:22px;color:#fff;position:relative;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.18);display:flex;align-items:center;gap:18px;';
  el.innerHTML='<div style="width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0">'+cur.badgeIcon+'</div><div style="flex:1;min-width:0"><div style="font-size:20px;font-weight:800;margin-bottom:2px">'+cur.label+' <span style="font-weight:400;font-size:15px;opacity:.85">'+cur.months+'</span></div><div style="font-size:11px;opacity:.7;margin-bottom:12px">'+cur.description+'</div><div style="background:rgba(255,255,255,.2);border-radius:6px;height:7px;overflow:hidden;margin-bottom:7px"><div style="height:100%;width:'+pct+'%;background:rgba(255,255,255,.85);border-radius:6px"></div></div><div style="display:flex;align-items:center;gap:14px;font-size:11px;opacity:.85"><span><b>'+passWD+'</b> gün geçti</span><span style="color:'+pctClr+';font-weight:700"><b>'+rem+'</b> iş günü kaldı</span><span>Toplam <b>'+totalWD+'</b> iş günü</span></div></div><div style="text-align:center;flex-shrink:0;min-width:72px"><div style="font-family:JetBrains Mono,monospace;font-size:32px;font-weight:800;color:'+pctClr+'">'+pct+'%</div><div style="font-size:9px;opacity:.65;margin-top:3px">İlerleme</div></div>';
}

function renderSidebarPeriodPill(cur,rem){
  const pill=document.getElementById('sidebarPeriodPill');if(!pill) return;
  pill.style.display='block';
  const lbl=document.getElementById('spp_label'),sub=document.getElementById('spp_sub'),bar=document.getElementById('spp_bar');
  if(lbl){lbl.textContent=cur.label;lbl.style.color=cur.badgeColor||'#1BCED8';}
  if(sub) sub.textContent=rem+' iş günü kaldı';
  if(bar){const s=new Date(cur.start),e=new Date(cur.end),t=new Date();const w=Math.min(100,Math.max(0,(t-s)/(e-s)*100)).toFixed(1);bar.style.width=w+'%';bar.style.background=cur.badgeColor||'var(--c3)';}
}

// ── PAGE 0: ANA SAYFA ────────────────────────────────────────
function buildTTTPicker(){
  const allList=['ŞENOL YILMAZ',...ALL_TTTS];
  const grid=document.getElementById('tttPickerGrid');if(!grid) return;
  grid.innerHTML=allList.map((t,idx)=>{
    const isSenol=t==='ŞENOL YILMAZ';
    const r=GENEL.find(g=>g.ttt===t&&g.urun==='GENEL TOPLAM');
    const p=r?r.tl_pct:0,trSira=TR_SIRA_MAP[t]||0;
    const pCol=p>=91?'#059669':p>=70?'#D97706':'#DC2626';
    const trCol=trSira<=30?'#059669':trSira<=60?'#D97706':'#DC2626';
    const progCol=p>=91?'#059669':p>=70?'#f59e0b':'#ef4444';
    const isSel=selTTT===t;
    const photoUrl=getTTTPhoto(t);
    const avatarBg=isSenol?'linear-gradient(135deg,#0E7490,#1BCED8)':'linear-gradient(135deg,'+TTT_COLORS[Math.max(0,idx-1)%TTT_COLORS.length]+','+TTT_COLORS[(Math.max(0,idx-1)+2)%TTT_COLORS.length]+')';
    const initials=t.split(' ').map(s=>s[0]).slice(0,2).join('');
    const shortName=isSenol?t:t.split(' ').slice(0,2).join(' ');
    const photoEl=photoUrl?'<img src="'+photoUrl+'" alt="'+t+'" loading="lazy" crossorigin="anonymous" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">':'';
    const fallbackStyle=photoUrl?'display:none':'display:flex';
    return '<div class="ttt-pick'+(isSel?(isSenol?' sel-senol':' sel'):'')+'" onclick="selectTTT(\''+t+'\')">'
      +'<div class="tp-photo-wrap">'+photoEl
      +'<div class="tp-avatar-fallback" style="background:'+avatarBg+';'+fallbackStyle+'">'+initials+'</div>'
      +(isSel?'<div class="tp-sel-badge">✓</div>':'')+'</div>'
      +'<div class="tp-info">'
      +'<div class="tp-name">'+(isSenol?'🏢 ':'')+'<strong>'+shortName+'</strong></div>'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:1px">'
      +'<div class="tp-pct" style="color:'+pCol+'">'+fPct(p)+'</div>'
      +'<div style="font-size:8px;color:'+trCol+';font-weight:700">'+(isSenol?'BM':('#'+trSira))+'</div></div>'
      +'<div class="tp-prog"><div class="tp-prog-fill" style="width:'+Math.min(p,130).toFixed(0)+'%;background:'+progCol+'"></div></div>'
      +'</div></div>';
  }).join('');
}

function renderAna(){
  if(!GENEL.length||!IMS.length) return;
  buildTTTPicker();
  const anaContent=document.getElementById('anaContent');if(!anaContent) return;
  if(selTTT){
    anaContent.innerHTML='<div id="periodBanner"></div><div class="insight mb16" id="anaInsight"><div class="insight-title">💡 Temsilci Özeti</div><div class="insight-body" id="anaInsightBody">Yükleniyor…</div></div><div id="alertBox" class="alert-box" style="display:none;margin-bottom:16px"><div class="alert-title">⚠️ Uyarılar</div><div class="alert-body" id="alertBoxBody"></div></div><div id="tttSummaryBox"></div><div class="card mb16"><div class="card-hd"><span class="card-title">📦 Ürün Bazlı Performans</span></div><div class="card-body-0 scroll-x"><table class="tbl" style="min-width:600px"><thead><tr><th>Ürün</th><th>Hedef TL</th><th>Satış TL</th><th>Kalan TL</th><th>TL %</th><th>İlerleme</th><th>PPI %</th></tr></thead><tbody id="tttUrunBody"></tbody></table></div></div><div class="g2"><div class="card"><div class="card-hd"><span class="card-title">📈 Haftalık TL Satış</span></div><div class="card-body"><div class="ch-md"><canvas id="tttHaftaTlChart2"></canvas></div></div></div><div class="card"><div class="card-hd"><span class="card-title">📊 Ürün Gerçekleşme %</span></div><div class="card-body"><div class="ch-md"><canvas id="tttUrunPctChart2"></canvas></div></div></div></div>';
    renderTTTDetailInto();
  } else {
    anaContent.innerHTML='<div id="periodBanner"></div><div class="insight mb16" id="anaInsight"><div class="insight-title">💡 Bölge Özeti</div><div class="insight-body" id="anaInsightBody">Yükleniyor…</div></div><div id="alertBox" class="alert-box" style="display:none;margin-bottom:16px"><div class="alert-title">⚠️ Uyarılar</div><div class="alert-body" id="alertBoxBody"></div></div><div class="card mb16"><div class="card-hd"><span class="card-title">🏆 Ekip Performansı</span><span class="card-badge" id="tttPickerBadge">'+ALL_TTTS.length+' kişi</span></div><div class="card-body-0 scroll-x"><table class="tbl" style="min-width:600px"><thead><tr><th>Sıra</th><th>Temsilci</th><th>Hedef TL</th><th>Satış TL</th><th>Kalan TL</th><th>TL %</th><th>Prim %</th><th>İlerleme</th><th>TR Sıra</th></tr></thead><tbody id="genelTbody"></tbody></table></div></div><div class="g2"><div class="card"><div class="card-hd"><span class="card-title">📈 Haftalık TL Satış</span></div><div class="card-body"><div class="ch-md"><canvas id="ekipHaftalikChart"></canvas></div></div></div><div class="card"><div class="card-hd"><span class="card-title">📊 Ürün Bazlı Satış</span></div><div class="card-body"><div class="ch-md"><canvas id="bolgeUrunChart"></canvas></div></div></div></div>';
    renderGenelTablo();
    renderEkipCharts();
  }
  renderAnaInsight();
  const today=new Date().toISOString().slice(0,10);
  const cur=PERIODS.find(p=>today>=p.start&&today<=p.end);
  if(cur) renderPeriodBanner(cur,workDays(today,cur.end));
}

function renderTTTDetailInto(){
  const rows=GENEL.filter(r=>r.ttt===selTTT&&r.urun!=='GENEL TOPLAM'&&r.urun!=='DESTEVIT').sort((a,b)=>URUN_ORDER.indexOf(a.urun)-URUN_ORDER.indexOf(b.urun));
  const gen=GENEL.find(r=>r.ttt===selTTT&&r.urun==='GENEL TOPLAM')||{};
  const isSenol=selTTT==='ŞENOL YILMAZ';
  const _bp=getTTTPhoto(selTTT);
  const _in=selTTT.split(' ').map(s=>s[0]).slice(0,2).join('');
  const _tr=TR_SIRA_MAP[selTTT]||0;
  const _trCol=_tr<=30?'#16A34A':_tr<=60?'#D97706':'#DC2626';
  const _tp=calcPrimForTTT(selTTT);
  const summaryEl=document.getElementById('tttSummaryBox');
  if(summaryEl) summaryEl.innerHTML='<div class="tsb" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0"><div style="width:100px;height:100px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,rgba(255,255,255,.15),rgba(255,255,255,.05));border:3px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center">'+(_bp?'<img src="'+_bp+'" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:top center">':'<div style="font-size:30px;font-weight:900;color:#fff">'+_in+'</div>')+'</div><div style="text-align:center"><div style="font-size:11px;font-weight:800;color:#fff">'+selTTT+'</div></div></div><div style="flex:1;min-width:0"><div class="tsb-grid" style="grid-template-columns:repeat(3,1fr)"><div><div class="tsb-lbl">Toplam Hedef</div><div class="tsb-val">'+fTL(gen.hedef_tl)+'</div></div><div><div class="tsb-lbl">Toplam Satış</div><div class="tsb-val">'+fTL(gen.satis_tl)+'</div></div><div><div class="tsb-lbl">Gerçekleşme</div><div class="tsb-val">'+fPct(gen.tl_pct)+'</div></div><div><div class="tsb-lbl">Kalan TL</div><div class="tsb-val">'+fTL(gen.kalan_tl)+'</div></div><div><div class="tsb-lbl">Prim Puan</div><div class="tsb-val">'+fPct(gen.prim_pct||0)+'</div></div><div><div class="tsb-lbl">TR Sıra</div><div class="tsb-val" style="color:'+_trCol+'">'+(_tr?'#'+_tr:'—')+'</div></div></div></div></div>';
  const tbody=document.getElementById('tttUrunBody');
  if(tbody) tbody.innerHTML=rows.map(r=>'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</td><td class="mono">'+fTL(r.hedef_tl)+'</td><td class="mono">'+fTL(r.satis_tl)+'</td><td class="mono '+(r.kalan_tl<0?'negative':'positive')+'">'+fTL(r.kalan_tl)+'</td><td><span class="bdg '+pCls(r.tl_pct)+'">'+fPct(r.tl_pct)+'</span></td><td><div class="prog" style="width:80px"><div class="prog-fill '+barCls(r.tl_pct)+'" style="width:'+Math.min(r.tl_pct,100)+'%"></div></div></td><td><span class="bdg bdg-blue">'+fPct(r.prim_pct||0)+'</span></td></tr>').join('');
  const wkeys=['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  setTimeout(()=>{
    mkChart('tttHaftaTlChart2','line',{labels:wkeys.map((_,i)=>(i+1)+'.Hft'),datasets:rows.map((r,i)=>({label:r.urun,data:wkeys.map(w=>r[w]||0),borderColor:URUN_CLR[r.urun]||TTT_COLORS[i],backgroundColor:(URUN_CLR[r.urun]||TTT_COLORS[i])+'18',tension:.4,fill:false,pointRadius:4,borderWidth:2}))},{plugins:{legend:{labels:{font:{size:9}}}},scales:{y:{ticks:{callback:v=>fTL(v)}}}});
    mkChart('tttUrunPctChart2','bar',{labels:rows.map(r=>r.urun),datasets:[{label:'TL %',data:rows.map(r=>r.tl_pct||0),backgroundColor:rows.map(r=>(URUN_CLR[r.urun]||'#8164CF')+'cc'),borderColor:rows.map(r=>URUN_CLR[r.urun]||'#8164CF'),borderWidth:2,borderRadius:5}]},{plugins:{legend:{display:false}},scales:{y:{max:150,ticks:{callback:v=>v+'%'}}}});
  },50);
}

function renderAnaInsight(){
  const insightEl=document.getElementById('anaInsightBody'),alertBox=document.getElementById('alertBox');
  if(!insightEl) return;
  const ekip=GENEL.filter(r=>r.urun==='GENEL TOPLAM'&&r.ttt!=='ŞENOL YILMAZ');
  const sorted=[...ekip].sort((a,b)=>b.tl_pct-a.tl_pct);
  const best=sorted[0],worst=sorted[sorted.length-1];
  const avg=ekip.length?ekip.reduce((s,r)=>s+r.tl_pct,0)/ekip.length:0;
  const over70=ekip.filter(r=>r.tl_pct>=70).length;
  const urunSatis=URUN_ORDER.map(u=>({u,sum:GENEL.filter(r=>r.urun===u&&r.ttt!=='ŞENOL YILMAZ').reduce((s,r)=>s+r.satis_tl,0)})).sort((a,b)=>b.sum-a.sum);
  let bodyHtml='';
  if(selTTT){
    const rows=GENEL.filter(r=>r.ttt===selTTT&&r.urun!=='GENEL TOPLAM'&&r.urun!=='DESTEVIT');
    const gen=GENEL.find(r=>r.ttt===selTTT&&r.urun==='GENEL TOPLAM')||{};
    const en=[...rows].sort((a,b)=>b.tl_pct-a.tl_pct)[0]||{};
    const dusuk=[...rows].sort((a,b)=>a.tl_pct-b.tl_pct)[0]||{};
    bodyHtml='<strong>'+selTTT+'</strong> toplam <strong>'+fTL(gen.satis_tl)+'</strong> satış ('+fPct(gen.tl_pct)+' hedef). Güçlü: <strong>'+(en.urun||'—')+'</strong> ('+fPct(en.tl_pct)+'). Gelişim: <strong>'+(dusuk.urun||'—')+'</strong> ('+fPct(dusuk.tl_pct)+'). TR: <strong>#'+(gen.tr_sira||'—')+'</strong>.';
    if(alertBox) alertBox.style.display='none';
  } else {
    bodyHtml='Ekip ort. gerçekleşme: <strong>'+avg.toFixed(1)+'%</strong>. '+over70+'/'+ekip.length+' temsilci %70 üstünde. Lider: <strong>'+(best?.ttt||'—')+'</strong> ('+fPct(best?.tl_pct)+'). Bölge en güçlü ürün: <strong>'+(urunSatis[0]?.u||'—')+'</strong>.';
    if(alertBox) alertBox.style.display='none';
  }
  insightEl.innerHTML=bodyHtml;
}

function renderGenelTablo(){
  const rows=[...GENEL.filter(r=>r.urun==='GENEL TOPLAM'&&r.ttt!=='ŞENOL YILMAZ')].sort((a,b)=>b.tl_pct-a.tl_pct);
  const el=document.getElementById('genelTbody');if(!el) return;
  el.innerHTML=rows.map((r,i)=>{
    const trSira=TR_SIRA_MAP[r.ttt]||0;
    const trCol=trSira<=30?'#0BA87E':trSira<=60?'#D97706':'#DC2626';
    const pp=r.prim_pct||0;
    return '<tr><td><span class="rk '+(i===0?'rk-1':i===1?'rk-2':i===2?'rk-3':'rk-n')+'">'+(i+1)+'</span></td>'
      +'<td style="font-weight:600;cursor:pointer;color:var(--c1)" onclick="selectTTT(\''+r.ttt+'\')">'+r.ttt+'</td>'
      +'<td class="mono">'+fTL(r.hedef_tl)+'</td><td class="mono" style="font-weight:700">'+fTL(r.satis_tl)+'</td>'
      +'<td class="mono '+(r.kalan_tl<0?'negative':'positive')+'">'+fTL(r.kalan_tl)+'</td>'
      +'<td><span class="bdg '+pCls(r.tl_pct)+'">'+fPct(r.tl_pct)+'</span></td>'
      +'<td><span class="bdg bdg-blue" style="'+(pp>=91?'background:#16A34A;color:#fff':pp>=70?'background:#D97706;color:#fff':'')+'">'+fPct(pp)+'</span></td>'
      +'<td><div class="prog" style="width:80px"><div class="prog-fill '+barCls(r.tl_pct)+'" style="width:'+Math.min(r.tl_pct,100)+'%"></div></div></td>'
      +'<td style="color:'+trCol+';font-weight:700">'+(trSira?'#'+trSira:'—')+'</td></tr>';
  }).join('');
}

function renderEkipCharts(){
  const wkeys=['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const tttRows=ALL_TTTS.map(t=>GENEL.find(r=>r.ttt===t&&r.urun==='GENEL TOPLAM')).filter(Boolean);
  const ds=tttRows.map((r,i)=>({label:r.ttt.split(' ')[0],data:wkeys.map(w=>r[w]||0),borderColor:TTT_COLORS[i%TTT_COLORS.length],backgroundColor:TTT_COLORS[i%TTT_COLORS.length]+'18',tension:.4,fill:false,pointRadius:4,borderWidth:2}));
  setTimeout(()=>{
    mkChart('ekipHaftalikChart','line',{labels:wkeys.map((_,i)=>(i+1)+'.Hft'),datasets:ds},{plugins:{legend:{labels:{font:{size:9}}}},scales:{y:{ticks:{callback:v=>fTL(v)}}}});
    const urunData=URUN_ORDER.map(u=>GENEL.filter(r=>r.urun===u&&r.ttt!=='ŞENOL YILMAZ').reduce((s,r)=>s+r.satis_tl,0));
    mkChart('bolgeUrunChart','bar',{labels:URUN_ORDER,datasets:[{label:'Bölge TL',data:urunData,backgroundColor:URUN_ORDER.map(u=>(URUN_CLR[u]||'#8164CF')+'cc'),borderColor:URUN_ORDER.map(u=>URUN_CLR[u]||'#8164CF'),borderWidth:2,borderRadius:5}]},{plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fTL(v)}}}});
  },50);
}
// ── PAGE 1: PAZAR ANALİZİ ────────────────────────────────────
function renderPazar(){
  if(!IMS.length) return;
  if(!selTTT_p1&&ALL_TTTS.length) selTTT_p1=ALL_TTTS[0];
  if(!selGroup) selGroup=ALL_GROUPS[0];
  const area=document.getElementById('pazarChartArea'),topBar=document.getElementById('pazarTopFilterBar');
  if(topBar) topBar.innerHTML='<div class="top-filter-bar" style="position:static;background:transparent;border:none;box-shadow:none;padding:0;margin:0 0 14px"><div class="filter-row" style="flex-wrap:wrap;gap:10px"><div class="filter-group"><span class="filter-label">Temsilci</span>'+['ŞENOL YILMAZ',...ALL_TTTS].map(t=>'<button class="tfb-sp'+(t===selTTT_p1?' active':'')+'" onclick="selTTT_p1=\''+t+'\';renderPazar()">'+t.split(' ')[0]+'</button>').join('')+'</div><div class="filter-sep"></div><div class="filter-group"><span class="filter-label">Grup</span>'+ALL_GROUPS.map(g=>'<button class="tfb-sp'+(g===selGroup?' active':'')+'" onclick="selGroup=\''+g+'\';renderPazar()">'+(GRP_LBL[g]||g)+'</button>').join('')+'</div><div class="filter-sep"></div><div class="filter-group"><span class="filter-label">Hafta</span>'+[{k:'toplam',l:'Toplam'},...['h1','h2','h3','h4','h5','h6','h7','h8','h9'].map((h,i)=>({k:h,l:(i+1)+'.H'}))].map(h=>'<button class="tfb-sp'+(h.k===selHafta?' active':'')+'" onclick="selHafta=\''+h.k+'\';renderPazar()">'+h.l+'</button>').join('')+'</div></div></div>';
  const ownIlac=OWN_IMS[selGroup]||'';
  const drugs=(DRUG_ORDER[selGroup]||[]).filter(d=>IMS.some(r=>r.ilac===d&&r.ttt===selTTT_p1&&r.ilac_grubu===selGroup));
  const grpData=IMS.filter(r=>r.ttt===selTTT_p1&&r.ilac_grubu===selGroup&&!r.is_mkt);
  const mktRows=IMS.filter(r=>r.ttt===selTTT_p1&&r.ilac_grubu===selGroup&&r.is_mkt);
  const bricks=[...new Set(grpData.map(r=>r.brick))].sort();
  const wk=['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const getHV=r=>selHafta==='toplam'?r.toplam:(r[selHafta]||0);
  const ownWk=wk.map(w=>grpData.filter(r=>r.ilac===ownIlac).reduce((s,r)=>s+(r[w]||0),0));
  const mktWk=wk.map(w=>mktRows.reduce((s,r)=>s+(r[w]||0),0));
  if(!area) return;
  area.innerHTML='<div class="g2 mb16"><div class="card"><div class="card-hd"><span class="card-title">📊 Brick Bazlı Pazar</span></div><div class="card-body"><div class="ch-xl"><canvas id="pazarChart"></canvas></div></div></div><div class="card"><div class="card-hd"><span class="card-title">🏆 Pazar Payı</span></div><div class="card-body"><div class="ch-xl"><canvas id="marketBarChart"></canvas></div></div></div></div><div class="card mb16"><div class="card-hd"><span class="card-title">📈 Haftalık Trend</span></div><div class="card-body"><div class="ch-md"><canvas id="trendChart"></canvas></div></div></div><div class="card mb16"><div class="card-hd"><span class="card-title">📋 Rakip Tablo</span></div><div class="card-body-0 scroll-x"><table class="tbl" style="min-width:700px"><thead><tr><th>İlaç</th>'+wk.map(w=>'<th>'+w.replace('h','')+'_.H</th>').join('')+'<th>Toplam</th></tr></thead><tbody id="rakipBody"></tbody></table></div></div>';
  setTimeout(()=>{
    const brickLabels=bricks.slice(0,15);
    const datasets=drugs.map((drug,i)=>({label:drugLabel(drug),data:brickLabels.map(b=>grpData.filter(r=>r.ilac===drug&&r.brick===b).reduce((s,r)=>s+getHV(r),0)),backgroundColor:getPazColor(drug,ownIlac,i)+'bb',borderColor:getPazColor(drug,ownIlac,i),borderWidth:drug===ownIlac?3:2,borderRadius:3}));
    const mktByBrick=brickLabels.map(b=>mktRows.filter(r=>r.brick===b).reduce((s,r)=>s+getHV(r),0));
    datasets.push({type:'line',label:'Toplam Pazar',data:mktByBrick,borderColor:'#DC2626',backgroundColor:'transparent',borderWidth:2,pointRadius:5,yAxisID:'y'});
    destroyChart('pazarChart');const pctx=document.getElementById('pazarChart');
    if(pctx) charts['pazarChart']=new Chart(pctx,{type:'bar',data:{labels:brickLabels.map(b=>b.length>14?b.substr(0,14)+'…':b),datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#718096',font:{size:9},padding:5}},title:{display:true,text:selTTT_p1+' — '+(GRP_LBL[selGroup]||selGroup),color:'#4F008C',font:{size:11,weight:'bold'}},tooltip:{callbacks:{label:i=>' '+i.dataset.label+': '+fK(i.raw)}}},scales:{x:{stacked:false,grid:{display:false},ticks:{color:'#718096',font:{size:8},maxRotation:40}},y:{display:false,beginAtZero:true}}}});
    const drugTots=drugs.map(drug=>grpData.filter(r=>r.ilac===drug).reduce((s,r)=>s+getHV(r),0));
    destroyChart('marketBarChart');const mctx=document.getElementById('marketBarChart');
    if(mctx) charts['marketBarChart']=new Chart(mctx,{type:'bar',data:{labels:drugs.map(d=>drugLabel(d)),datasets:[{label:'Kutu',data:drugTots,backgroundColor:drugs.map((d,i)=>getPazColor(d,ownIlac,i)+'99'),borderColor:drugs.map((d,i)=>getPazColor(d,ownIlac,i)),borderWidth:2,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{ticks:{font:{size:9},maxRotation:0}}}}});
    // Rakip tablosu
    const body=document.getElementById('rakipBody');
    if(body){const lbl=d=>d===ownIlac?d.replace(' TOPLAM','').replace(' PAZARI',''):d;const drugW=drugs.map(drug=>{const vals=wk.map(w=>grpData.filter(r=>r.ilac===drug).reduce((s,r)=>s+(r[w]||0),0));const tot=grpData.filter(r=>r.ilac===drug).reduce((s,r)=>s+r.toplam,0);return{drug,vals,tot};});body.innerHTML=drugW.map(({drug,vals,tot})=>{const isOwn=drug===ownIlac;return'<tr style="'+(isOwn?'background:rgba(27,206,216,.05)':'')+'"><td><span class="'+(isOwn?'tag-own':'tag-comp')+'">'+(isOwn?'KENDİ':'RAKİP')+'</span> <strong style="'+(isOwn?'color:#0E7490':'')+'">'+lbl(drug)+'</strong></td>'+vals.map(v=>'<td class="mono" style="'+(v>0?'':'color:#A0AEC0')+'">'+(v>0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="font-weight:700">'+fK(tot)+'</td></tr>';}).join('');body.innerHTML+='<tr style="border-top:2px solid var(--border);background:#F7F9FC"><td style="font-weight:700">📦 Toplam Pazar</td>'+mktWk.map(v=>'<td class="mono" style="font-weight:700">'+fK(v)+'</td>').join('')+'<td class="mono" style="font-weight:700">'+fK(mktRows.reduce((s,r)=>s+r.toplam,0))+'</td></tr>';}
    // Trend
    const ppiWk=wk.map((w,i)=>mktWk[i]>0?(ownWk[i]/mktWk[i]*100):0);
    mkChart('trendChart','line',{labels:wk.map((_,i)=>(i+1)+'.H'),datasets:[{label:ownIlac+' Pazar Payı %',data:ppiWk,borderColor:'#1BCED8',backgroundColor:'rgba(27,206,216,.1)',tension:.4,fill:true,pointRadius:5,borderWidth:2,yAxisID:'y1'},{label:ownIlac+' Kutu',data:ownWk,borderColor:'#4F008C',backgroundColor:'rgba(79,0,140,.06)',tension:.4,fill:false,pointRadius:4,borderWidth:2,yAxisID:'y'}]},{plugins:{title:{display:true,text:selTTT_p1+' — '+(GRP_LBL[selGroup]||selGroup)+' Trend',color:'#4F008C',font:{size:11}}},scales:{y:{ticks:{callback:v=>fK(v)},position:'left'},y1:{grid:{display:false},ticks:{callback:v=>v.toFixed(0)+'%',color:'#0E7490'},position:'right'}}});
  },50);
}

// ── PAGE 2: SATIŞ TAKİBİ ────────────────────────────────────
function renderTakip(){buildTTT2Slicer();renderTakipContent();}
function renderTakipContent(){renderKutuTable();renderCalcTable();renderWeeklyTable2();}

function buildTTT2Slicer(){
  if(!selTTT_p2&&ALL_TTTS.length) selTTT_p2=ALL_TTTS[0];
  const bar=document.getElementById('ttt2SlicerBar');
  if(bar) bar.innerHTML=ALL_TTTS.map(t=>'<button class="tfb-sp'+(t===selTTT_p2?' active':'')+'" onclick="setP2(\''+t+'\')">'+t.split(' ')[0]+'</button>').join('');
  const badge=document.getElementById('takipBadge');if(badge) badge.textContent=selTTT_p2;
  const title=document.getElementById('tttUrunTableTitle');if(title) title.textContent=selTTT_p2+' — Ürün Bazlı Performans';
}
function setP2(t){selTTT_p2=t;buildTTT2Slicer();renderTakipContent();}

function renderKutuTable(){
  const rows=URUN_ORDER.map(u=>GENEL.find(r=>r.ttt===selTTT_p2&&r.urun===u)).filter(r=>r&&r.hedef_kutu>0);
  const el=document.getElementById('tttUrunBody');
  if(el) el.innerHTML=rows.map(r=>{const k100TL=Math.max(0,r.hedef_tl-r.satis_tl),tlPct=r.tl_pct||0,ppiPct=r.prim_pct||0;return'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</td><td class="mono">'+fTL(r.hedef_tl)+'</td><td class="mono">'+fTL(r.satis_tl)+'</td><td class="mono '+(k100TL<=0?'positive':'negative')+'">'+fTL(k100TL)+'</td><td><span class="bdg '+pCls(tlPct)+'">'+fPct(tlPct)+'</span></td><td><div class="prog" style="width:80px"><div class="prog-fill '+barCls(tlPct)+'" style="width:'+Math.min(tlPct,100)+'%"></div></div></td><td><span class="bdg bdg-blue">'+fPct(ppiPct)+'</span></td></tr>';}).join('');
  const tttSummaryBox=document.getElementById('tttSummaryBox');
  if(tttSummaryBox){const gt=GENEL.find(r=>r.ttt===selTTT_p2&&r.urun==='GENEL TOPLAM')||{};tttSummaryBox.innerHTML='<div class="tsb"><div class="tsb-name">📊 '+selTTT_p2+'</div><div class="tsb-grid"><div><div class="tsb-lbl">Hedef TL</div><div class="tsb-val">'+fTL(gt.hedef_tl)+'</div></div><div><div class="tsb-lbl">Satış TL</div><div class="tsb-val">'+fTL(gt.satis_tl)+'</div></div><div><div class="tsb-lbl">TL %</div><div class="tsb-val">'+fPct(gt.tl_pct)+'</div></div><div><div class="tsb-lbl">Kalan TL</div><div class="tsb-val">'+fTL(gt.kalan_tl)+'</div></div></div></div>';}
  const wkeys=['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const kutuRows=URUN_ORDER.map(u=>KUTU.find(r=>r.ttt===selTTT_p2&&r.urun===u)).filter(r=>r);
  const kutuSlicers=document.getElementById('kutuUrunSlicers');
  if(kutuSlicers) kutuSlicers.innerHTML=URUN_ORDER.map(u=>'<button class="tfb-sp'+(selKutuUruns.has(u)?' active':'')+'" style="font-size:9px;padding:3px 8px" onclick="toggleKutuUrun(\''+u+'\')">'+u+'</button>').join('');
  const kutuBody=document.getElementById('kutuHaftaBody');
  if(kutuBody) kutuBody.innerHTML=kutuRows.filter(r=>selKutuUruns.has(r.urun)).map(r=>{const vals=wkeys.map(w=>r[w]||0);const tot=vals.reduce((a,b)=>a+b,0);return'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</td>'+vals.map(v=>'<td class="mono" style="'+(v>0?'':v<0?'color:#DC2626':'color:#A0AEC0')+'">'+(v!==0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="font-weight:700;color:var(--c1)">'+fK(tot)+'</td></tr>';}).join('');
  setTimeout(()=>{
    mkChart('tttHaftaTlChart','line',{labels:wkeys.map((_,i)=>(i+1)+'.Hft'),datasets:rows.map((r,i)=>({label:r.urun,data:wkeys.map(w=>r[w]||0),borderColor:URUN_CLR[r.urun]||TTT_COLORS[i],backgroundColor:(URUN_CLR[r.urun]||TTT_COLORS[i])+'18',tension:.4,fill:false,pointRadius:4,borderWidth:2}))},{plugins:{legend:{labels:{font:{size:9}}}},scales:{y:{ticks:{callback:v=>fTL(v)}}}});
    mkChart('tttUrunPctChart','bar',{labels:rows.map(r=>r.urun),datasets:[{label:'TL %',data:rows.map(r=>r.tl_pct||0),backgroundColor:rows.map(r=>(URUN_CLR[r.urun]||'#8164CF')+'cc'),borderColor:rows.map(r=>URUN_CLR[r.urun]||'#8164CF'),borderWidth:2,borderRadius:5}]},{plugins:{legend:{display:false}},scales:{y:{max:150,ticks:{callback:v=>v+'%'}}}});
    const filtRows=kutuRows.filter(r=>selKutuUruns.has(r.urun));
    mkChart('kutuHaftaChart','bar',{labels:wkeys.map((_,i)=>(i+1)+'.H'),datasets:filtRows.map(r=>({label:r.urun,data:wkeys.map(w=>r[w]||0),backgroundColor:(URUN_CLR[r.urun]||'#8164CF')+'99',borderColor:URUN_CLR[r.urun]||'#8164CF',borderWidth:2,borderRadius:3}))},{plugins:{legend:{labels:{font:{size:9}}}},scales:{y:{ticks:{callback:v=>fK(v)}}}});
  },50);
}
function toggleKutuUrun(u){if(selKutuUruns.has(u)) selKutuUruns.delete(u); else selKutuUruns.add(u);renderCalcTable();}

function renderCalcTable(){
  const rows=URUN_ORDER.map(urun=>{const r=GENEL.find(g=>g.ttt===selTTT_p2&&g.urun===urun);return{urun,r};}).filter(({r})=>r);
  const el=document.getElementById('calcBody');
  if(el) el.innerHTML=rows.map(({urun,r})=>'<tr><td style="font-weight:700;color:'+(URUN_CLR[urun]||'var(--c1)')+';min-width:110px">'+urun+'</td><td style="min-width:110px"><input class="inp" type="number" min="0" step="1" id="kutu_'+urun.replace(/\s+/g,'_')+'" value="0" style="width:100px;padding:5px 8px;font-size:12px" oninput="liveCalcRow(\''+urun+'\')"></td><td class="mono" id="ra_'+urun.replace(/\s+/g,'_')+'" style="color:var(--c2)">—</td><td class="mono" id="rk_'+urun.replace(/\s+/g,'_')+'" style="min-width:130px"><div style="font-size:11px">'+fTL(r.satis_tl)+'</div><div style="font-size:9px;color:var(--dim)">Mevcut</div></td><td class="mono" style="color:var(--dim)">'+fTL(r.hedef_tl)+'</td><td class="mono" id="rkal_'+urun.replace(/\s+/g,'_')+'" style="color:#DC2626">'+fTL(Math.max(0,r.hedef_tl-r.satis_tl))+'</td><td id="rp_'+urun.replace(/\s+/g,'_')+'"><span class="bdg '+pCls(r.tl_pct)+'">'+fPct(r.tl_pct)+'</span></td><td id="rpr_'+urun.replace(/\s+/g,'_')+'"><span class="bdg bdg-blue">'+fPct(r.prim_pct||0)+'</span></td></tr>').join('');
  const foot=document.getElementById('calcFoot');if(foot) foot.innerHTML='';
  const ins=document.getElementById('calcInsight');if(ins) ins.style.display='none';
}

function liveCalcRow(urun){
  const r=GENEL.find(g=>g.ttt===selTTT_p2&&g.urun===urun);if(!r) return;
  const key=urun.replace(/\s+/g,'_');
  const kutu=parseFloat(document.getElementById('kutu_'+key)?.value)||0;
  const imsPrice=IMS_TL_MAP[urun]||0;
  const tahAnamal=kutu*imsPrice,toplamS=r.satis_tl+tahAnamal;
  const tahPct=r.hedef_tl>0?(toplamS/r.hedef_tl*100):0;
  const agirlik=r.urun_agirlik>0?r.urun_agirlik:(URUN_AGIRLIK[urun]||0);
  const tahPrimPuan=tahPct>=70?Math.min(tahPct,130)*agirlik:0;
  const raEl=document.getElementById('ra_'+key);if(raEl) raEl.textContent=kutu>0?fTL(tahAnamal):'—';
  const rkEl=document.getElementById('rk_'+key);if(rkEl){if(kutu>0){rkEl.innerHTML='<div style="font-size:11px;font-weight:700;color:var(--c1)">'+fTL(toplamS)+'</div><div style="font-size:9px;color:var(--dim)">'+fTL(r.satis_tl)+' + '+fTL(tahAnamal)+'</div>';}else{rkEl.innerHTML='<div style="font-size:11px">'+fTL(r.satis_tl)+'</div><div style="font-size:9px;color:var(--dim)">Mevcut</div>';}}
  const rkalEl=document.getElementById('rkal_'+key);if(rkalEl){const kalan=Math.max(0,r.hedef_tl-toplamS);rkalEl.textContent=fTL(kalan);rkalEl.style.color=kalan<=0?'#16A34A':'#DC2626';}
  const rpEl=document.getElementById('rp_'+key);if(rpEl) rpEl.innerHTML='<span class="bdg '+pCls(tahPct)+'">'+fPct(tahPct)+'</span>';
  const rprEl=document.getElementById('rpr_'+key);if(rprEl) rprEl.innerHTML='<span class="bdg bdg-blue">'+fPct(tahPrimPuan)+'</span>';
  runCalcSummary();
}

function runCalcSummary(){
  let totH=0,totS=0,totAnamal=0,totPrimPuan=0;const urunReals={};
  URUN_ORDER.forEach(urun=>{const r=GENEL.find(g=>g.ttt===selTTT_p2&&g.urun===urun);if(!r) return;const key=urun.replace(/\s+/g,'_');const kutu=parseFloat(document.getElementById('kutu_'+key)?.value)||0;const tahAnamal=kutu*(IMS_TL_MAP[urun]||0);const toplamS=r.satis_tl+tahAnamal;const tahPct=r.hedef_tl>0?(toplamS/r.hedef_tl*100):0;const agirlik=r.urun_agirlik>0?r.urun_agirlik:(URUN_AGIRLIK[urun]||0);totPrimPuan+=tahPct>=70?Math.min(tahPct,130)*agirlik:0;urunReals[urun]=tahPct;totH+=r.hedef_tl;totS+=toplamS;totAnamal+=tahAnamal;});
  const totPct=totH>0?(totS/totH*100):0,totKalan=Math.max(0,totH-totS);
  const foot=document.getElementById('calcFoot');
  if(foot) foot.innerHTML='<tr style="border-top:2px solid var(--c1);background:rgba(79,0,140,.04)"><td style="font-weight:700;color:var(--c1)">TOPLAM</td><td></td><td class="mono" style="font-weight:700;color:var(--c2)">'+(totAnamal>0?fTL(totAnamal):'—')+'</td><td class="mono" style="font-weight:700">'+fTL(totS)+'</td><td class="mono" style="color:var(--dim)">'+fTL(totH)+'</td><td class="mono" style="color:'+(totKalan<=0?'#16A34A':'#DC2626')+';font-weight:700">'+fTL(totKalan)+'</td><td><span class="bdg '+pCls(totPct)+'">'+fPct(totPct)+'</span></td><td><span class="bdg bdg-blue">'+fPct(totPrimPuan)+'</span></td></tr>';
  const ins=document.getElementById('calcInsight');if(ins){ins.style.display=totAnamal>0?'block':'none';const body=document.getElementById('calcInsightBody');if(body) body.innerHTML='Tahmini gerçekleşme: <strong>'+fPct(totPct)+'</strong> | Hedefe kalan: <strong>'+fTL(totKalan)+'</strong> | Tahmini prim puan: <strong>'+fPct(totPrimPuan)+'</strong>';}
  CALC_SYNC={ttt:selTTT_p2,totPct,totPrimPuan,urunReals,timestamp:Date.now()};
  syncPrimFromCalc();
}
function runCalc(){runCalcSummary();}
function resetCalc(){URUN_ORDER.forEach(u=>{const k=u.replace(/\s+/g,'_');const el=document.getElementById('kutu_'+k);if(el) el.value=0;const r=GENEL.find(g=>g.ttt===selTTT_p2&&g.urun===u);if(r){const rkEl=document.getElementById('rk_'+k);if(rkEl) rkEl.innerHTML='<div style="font-size:11px">'+fTL(r.satis_tl)+'</div><div style="font-size:9px;color:var(--dim)">Mevcut</div>';const rkalEl=document.getElementById('rkal_'+k);if(rkalEl){rkalEl.textContent=fTL(Math.max(0,r.hedef_tl-r.satis_tl));rkalEl.style.color='#DC2626';}const rpEl=document.getElementById('rp_'+k);if(rpEl) rpEl.innerHTML='<span class="bdg '+pCls(r.tl_pct)+'">'+fPct(r.tl_pct)+'</span>';const rprEl=document.getElementById('rpr_'+k);if(rprEl) rprEl.innerHTML='<span class="bdg bdg-blue">'+fPct(r.prim_pct||0)+'</span>';const raEl=document.getElementById('ra_'+k);if(raEl) raEl.innerHTML='—';}});const foot=document.getElementById('calcFoot');if(foot) foot.innerHTML='';const ins=document.getElementById('calcInsight');if(ins) ins.style.display='none';}

function renderWeeklyTable2(){
  const rows=URUN_ORDER.map(u=>GENEL.find(r=>r.ttt===selTTT_p2&&r.urun===u)).filter(r=>r&&r.hedef_tl>0);
  const wk=['h1','h2','h3','h4','h5','h6','h7','h8','h9'];
  const tlBody=document.getElementById('weeklyTlBody');
  if(tlBody){tlBody.innerHTML=rows.map(r=>{const vals=wk.map(w=>r[w]||0);const nz=vals.filter(v=>v>0);const avg=nz.length?nz.reduce((a,b)=>a+b,0)/nz.length:0;return'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</td>'+vals.map(v=>'<td class="mono" style="'+(v>0?'':'color:#A0AEC0')+'">'+(v>0?fTL(v):'—')+'</td>').join('')+'<td class="mono" style="color:var(--c2);font-weight:700">'+fTL(avg)+'</td></tr>';}).join('');const tots=wk.map(w=>rows.reduce((s,r)=>s+(r[w]||0),0));const nzT=tots.filter(v=>v>0);const avgT=nzT.length?nzT.reduce((a,b)=>a+b,0)/nzT.length:0;tlBody.innerHTML+='<tr style="border-top:2px solid var(--border);background:#F7F9FC"><td style="font-weight:700">TOPLAM</td>'+tots.map(v=>'<td class="mono" style="font-weight:600;color:var(--c2)">'+(v>0?fTL(v):'—')+'</td>').join('')+'<td class="mono" style="font-weight:700;color:var(--c1)">'+fTL(avgT)+'</td></tr>';}
  const kutuEl=document.getElementById('weeklyKutuBody');
  if(kutuEl){const kutuRows=URUN_ORDER.map(u=>KUTU.find(r=>r.ttt===selTTT_p2&&r.urun===u)).filter(r=>r);kutuEl.innerHTML=kutuRows.map(r=>{const vals=wk.map(w=>r[w]||0);const nzV=vals.filter(v=>v>0);const avg=nzV.length?Math.round(nzV.reduce((a,b)=>a+b,0)/nzV.length):0;return'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</td>'+vals.map(v=>'<td class="mono" style="'+(v>0?'':v<0?'color:#DC2626':'color:#A0AEC0')+'">'+(v!==0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="color:var(--c2);font-weight:700">'+(avg>0?fK(avg):'—')+'</td></tr>';}).join('');const kTots=wk.map(w=>kutuRows.reduce((s,r)=>s+(r[w]||0),0));const kNz=kTots.filter(v=>v>0);const kAvg=kNz.length?Math.round(kNz.reduce((a,b)=>a+b,0)/kNz.length):0;kutuEl.innerHTML+='<tr style="border-top:2px solid var(--border);background:#F7F9FC"><td style="font-weight:700">TOPLAM</td>'+kTots.map(v=>'<td class="mono" style="font-weight:600;color:var(--c2)">'+(v>0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="font-weight:700;color:var(--c1)">'+(kAvg>0?fK(kAvg):'—')+'</td></tr>';}
  const imsKutuEl=document.getElementById('weeklyImsKutuBody');
  if(imsKutuEl){const imsRows=URUN_ORDER.map(u=>GENEL.find(r=>r.ttt===selTTT_p2&&r.urun===u)).filter(r=>r&&r.hedef_tl>0);imsKutuEl.innerHTML=imsRows.map(r=>{const p=IMS_TL_MAP[r.urun]||1;const vals=wk.map(w=>r[w]>0?Math.round(r[w]/p):0);const nzV=vals.filter(v=>v>0);const avg=nzV.length?Math.round(nzV.reduce((a,b)=>a+b,0)/nzV.length):0;return'<tr><td style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'<span style="font-size:8px;font-weight:400;color:var(--dim);margin-left:4px">'+p+'₺</span></td>'+vals.map(v=>'<td class="mono" style="'+(v>0?'':'color:#A0AEC0')+'">'+(v>0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="color:var(--c2);font-weight:700">'+(avg>0?fK(avg):'—')+'</td></tr>';}).join('');const iTots=wk.map(w=>imsRows.reduce((s,r)=>{const p=IMS_TL_MAP[r.urun]||1;return s+(r[w]>0?Math.round(r[w]/p):0);},0));const iNz=iTots.filter(v=>v>0);const iAvg=iNz.length?Math.round(iNz.reduce((a,b)=>a+b,0)/iNz.length):0;imsKutuEl.innerHTML+='<tr style="border-top:2px solid var(--border);background:#F7F9FC"><td style="font-weight:700">TOPLAM</td>'+iTots.map(v=>'<td class="mono" style="font-weight:600;color:var(--c2)">'+(v>0?fK(v):'—')+'</td>').join('')+'<td class="mono" style="font-weight:700;color:var(--c1)">'+(iAvg>0?fK(iAvg):'—')+'</td></tr>';}
}
// ── PAGE 3: MI & GI ──────────────────────────────────────────
function initMigi1(){
  const src=mg1_tip==='TL'?MIGI_TL_RAW:MIGI_KUTU_RAW;
  const donems=[...new Set(src.map(r=>r.donem))].filter(Boolean).sort();
  const veriOpts=[{k:'TUM',l:'Tüm'},{k:'BI',l:'Büyüme'},{k:'EVOL',l:'EVOL'},{k:'MI',l:'Market'},{k:'PP',l:'Pazar Payı'}];
  const bar=document.getElementById('mg1FilterBar');
  if(bar) bar.innerHTML='<div class="filter-row"><div class="filter-group"><span class="filter-label">Tip</span><button class="tfb-sp'+(mg1_tip==='TL'?' active':'')+'" onclick="mg1_tip=\'TL\';initMigi1()">TL</button><button class="tfb-sp'+(mg1_tip==='KUTU'?' active':'')+'" onclick="mg1_tip=\'KUTU\';initMigi1()">Kutu</button></div><div class="filter-sep"></div><div class="filter-group"><span class="filter-label">Dönem</span>'+['TÜMÜ',...donems].map(d=>{const lbl=d==='TÜMÜ'?'Tümü':(MG_AY_ADI[d.split('/')[0]]||d);return'<button class="tfb-sp'+(d===mg1_donem?' active':'')+'" onclick="mg1_donem=\''+d+'\';initMigi1()">'+lbl+'</button>';}).join('')+'</div><div class="filter-sep"></div><div class="filter-group"><span class="filter-label">Veriler</span>'+veriOpts.map(v=>'<button class="tfb-sp'+(v.k===mg1_veri?' active':'')+'" onclick="mg1_veri=\''+v.k+'\';initMigi1()">'+v.l+'</button>').join('')+'</div></div>';
  renderMigi1();
}

function renderMigi1(){
  const src=mg1_tip==='TL'?MIGI_TL_RAW:MIGI_KUTU_RAW;
  const tbody=document.getElementById('mg1Tbody'),badge=document.getElementById('mg1Badge');
  if(!src.length){if(tbody)tbody.innerHTML='<tr><td colspan="20" style="text-align:center;padding:32px;color:var(--dim)">⚠️ Veri yüklenemedi</td></tr>';return;}
  let rows=src.filter(r=>{if(mg1_donem!=='TÜMÜ'&&r.donem!==mg1_donem) return false;if(mg1_veri==='TUM'&&r.ilac!=='GENEL') return false;if(mg1_veri!=='TUM'&&r.ilac==='GENEL') return false;return true;});
  if(badge) badge.textContent=rows.length+' kayıt';
  const URUNLER=['PANOCER','FAMTREC','MOKSEFEN','ACİDPASS','GRİPORT COLD'];
  const thead=document.getElementById('mg1Thead');
  if(mg1_veri==='TUM'){
    if(thead) thead.innerHTML='<tr><th>Temsilci</th><th>Dönem</th><th>Büyüme İnd.</th><th>EVOL İnd.</th><th>Market İnd.</th><th>Pazar Payı%</th><th>PP Büyüme</th><th>TL Real%</th><th>Durum</th></tr>';
    if(tbody) tbody.innerHTML=rows.map(r=>'<tr><td style="font-weight:700;font-size:11px">'+r.person+'</td><td style="font-size:10px;color:var(--dim)">'+(MG_AY_ADI[r.donem.split('/')[0]]||r.donem)+'</td><td>'+mgFmt(r.bi)+'</td><td>'+mgFmt(r.evol)+'</td><td>'+mgFmt(r.mi)+'</td><td>'+mgFmt(r.pp1,true)+'</td><td>'+mgFmt(r.pp_bi)+'</td><td>'+mgFmt(r.real_pct)+'</td><td>'+mgDurumBadge(r.evol,r.mi)+'</td></tr>').join('')||'<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--dim)">Veri yok</td></tr>';
  } else {
    const personDonems=[...new Set(rows.map(r=>r.person+'||'+r.donem))];
    const field={BI:'bi',EVOL:'evol',MI:'mi',PP:'pp1'}[mg1_veri]||'evol';
    if(thead) thead.innerHTML='<tr><th>Temsilci</th><th>Dönem</th>'+URUNLER.map(u=>'<th style="font-size:10px">'+u+'</th>').join('')+'<th>Durum</th></tr>';
    const pivotRows=personDonems.map(pd=>{const [person,donem]=pd.split('||');const obj={person,donem};URUNLER.forEach(u=>{const rec=rows.find(r=>r.person===person&&r.donem===donem&&r.ilac===u);obj[u]=rec?rec[field]:null;});const genel=src.find(r=>r.person===person&&r.donem===donem&&r.ilac==='GENEL');obj._evol=genel?.evol;obj._mi=genel?.mi;return obj;});
    if(tbody) tbody.innerHTML=pivotRows.map(r=>'<tr><td style="font-weight:700;font-size:11px">'+r.person+'</td><td style="font-size:10px;color:var(--dim)">'+(MG_AY_ADI[r.donem.split('/')[0]]||r.donem)+'</td>'+URUNLER.map(u=>'<td>'+mgFmt(r[u],mg1_veri==='PP')+'</td>').join('')+'<td>'+mgDurumBadge(r._evol,r._mi)+'</td></tr>').join('')||'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--dim)">Veri yok</td></tr>';
  }
}

function initMigi2(){
  const src=mg2_tip==='TL'?MIGI_BRICK_TL_RAW:MIGI_BRICK_KUTU_RAW;
  const persons=[...new Set(src.map(r=>r.person))].filter(Boolean).sort();
  if(!mg2_ttt&&persons.length) mg2_ttt=persons[0];
  const srcP=mg2_ttt?src.filter(r=>r.person===mg2_ttt):src;
  const bricksSorted=[...new Map(srcP.map(r=>[r.brick,r.sira])).entries()].sort((a,b)=>a[1]-b[1]).map(([b])=>b);
  const donems=[...new Set(srcP.map(r=>r.donem))].filter(Boolean).sort();
  const veriOpts=[{k:'TUM',l:'Tüm'},{k:'BI',l:'Büyüme'},{k:'EVOL',l:'EVOL'},{k:'MI',l:'Market'},{k:'PP',l:'Pazar Payı'}];
  const bar=document.getElementById('mg2FilterBar');
  if(bar) bar.innerHTML='<div class="filter-row" style="flex-wrap:wrap;gap:8px">'
    +'<div class="filter-group"><span class="filter-label">Tip</span><button class="tfb-sp'+(mg2_tip==='TL'?' active':'')+'" onclick="mg2_tip=\'TL\';initMigi2()">TL</button><button class="tfb-sp'+(mg2_tip==='KUTU'?' active':'')+'" onclick="mg2_tip=\'KUTU\';initMigi2()">Kutu</button></div>'
    +'<div class="filter-sep"></div>'
    +'<div class="filter-group"><span class="filter-label">Temsilci</span>'+persons.map(p=>'<button class="tfb-sp'+(p===mg2_ttt?' active':'')+'" onclick="selMg2Ttt(\''+p.replace(/'/g,"\\'")+'\')">'+p.split(' ')[0]+'</button>').join('')+'</div>'
    +'<div class="filter-sep"></div>'
    +'<div class="filter-group"><span class="filter-label">Dönem</span>'+['TÜMÜ',...donems].map(d=>{const lbl=d==='TÜMÜ'?'Tümü':(MG_AY_ADI[d.split('/')[0]]||d);return'<button class="tfb-sp'+(d===mg2_donem?' active':'')+'" onclick="mg2_donem=\''+d+'\';initMigi2()">'+lbl+'</button>';}).join('')+'</div>'
    +'<div class="filter-sep"></div>'
    +'<div class="filter-group"><span class="filter-label">Veriler</span>'+veriOpts.map(v=>'<button class="tfb-sp'+(v.k===mg2_veri?' active':'')+'" onclick="mg2_veri=\''+v.k+'\';initMigi2()">'+v.l+'</button>').join('')+'</div>'
    +'<div class="filter-sep"></div>'
    +'<div class="filter-group"><span class="filter-label">Sıra</span><button class="tfb-sp'+(mg2_333?' active':'')+'" onclick="mg2Toggle333()">İlk 333</button></div>'
    +'<div class="filter-sep"></div>'
    +'<div class="filter-group" style="max-width:100%"><span class="filter-label">Brick</span><div style="display:flex;flex-wrap:wrap;gap:3px;max-height:68px;overflow-y:auto;padding-right:4px">'+['TÜMÜ',...bricksSorted].map(b=>{const sira=b==='TÜMÜ'?null:srcP.find(r=>r.brick===b)?.sira;const lbl=b==='TÜMÜ'?'Tümü':(sira?sira+' · ':'')+b;return'<button class="tfb-sp'+(b===mg2_brick?' active':'')+'" style="font-size:10px" onclick="mg2_brick=\''+b.replace(/'/g,"\\'")+'\';initMigi2()">'+lbl+'</button>';}).join('')+'</div></div>'
    +'</div>';
  renderMigi2();
}

function renderMigi2(){
  const src=mg2_tip==='TL'?MIGI_BRICK_TL_RAW:MIGI_BRICK_KUTU_RAW;
  const tbody=document.getElementById('mg2Tbody'),badge=document.getElementById('mg2Badge');
  if(!src.length){if(tbody)tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--dim)">⚠️ Brick verisi henüz yüklenmedi</td></tr>';return;}
  let rows=src.filter(r=>{if(mg2_ttt&&r.person!==mg2_ttt) return false;if(mg2_donem!=='TÜMÜ'&&r.donem!==mg2_donem) return false;if(mg2_brick!=='TÜMÜ'&&r.brick!==mg2_brick) return false;return true;});
  if(mg2_333) rows=rows.filter(r=>r.sira<=333);
  if(badge) badge.textContent=rows.length+' kayıt';
  const URUNLER=['PANOCER','FAMTREC','MOKSEFEN','ACİDPASS','GRİPORT COLD'];
  const thead=document.getElementById('mg2Thead');
  const field={TUM:null,BI:'bi',EVOL:'evol',MI:'mi',PP:'pp'}[mg2_veri];
  const siraBadge=s=>s<=333?'<span style="color:#22d3ee">'+s+'</span>':s;
  if(mg2_veri==='TUM'){
    if(thead) thead.innerHTML='<tr><th>Sıra</th><th>Brick</th><th>Temsilci</th><th>Dönem</th><th>İlaç</th><th>Büyüme İnd.</th><th>EVOL İnd.</th><th>Market İnd.</th><th>Pazar Payı%</th><th>Durum</th></tr>';
    if(tbody) tbody.innerHTML=rows.map(r=>'<tr><td class="mono" style="font-size:10px;color:var(--dim);font-weight:600">'+siraBadge(r.sira)+'</td><td style="font-size:10px;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+r.brick+'">'+r.brick+'</td><td style="font-size:10px;color:var(--c3)">'+r.person.split(' ')[0]+'</td><td style="font-size:10px;color:var(--dim)">'+(MG_AY_ADI[r.donem.split('/')[0]]||r.donem)+'</td><td style="font-size:10px">'+r.ilac+'</td><td>'+mgFmt(r.bi)+'</td><td>'+mgFmt(r.evol)+'</td><td>'+mgFmt(r.mi)+'</td><td>'+mgFmt(r.pp,true)+'</td><td>'+mgDurumBadge(r.evol,r.mi)+'</td></tr>').join('')||'<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--dim)">Veri yok</td></tr>';
  } else {
    const keys=[...new Map(rows.map(r=>[r.sira+'|'+r.person+'|'+r.brick+'|'+r.donem,{sira:r.sira,person:r.person,brick:r.brick,donem:r.donem}])).entries()].map(([,v])=>v).sort((a,b)=>a.sira-b.sira);
    if(thead) thead.innerHTML='<tr><th>Sıra</th><th>Brick</th><th>Temsilci</th><th>Dönem</th>'+URUNLER.map(u=>'<th style="font-size:10px">'+u.replace('GRİPORT COLD','GRIPORT')+'</th>').join('')+'<th>Durum</th></tr>';
    if(tbody) tbody.innerHTML=keys.map(k=>'<tr><td class="mono" style="font-size:10px;color:var(--dim);font-weight:600">'+siraBadge(k.sira)+'</td><td style="font-size:10px;font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+k.brick+'">'+k.brick+'</td><td style="font-size:10px;color:var(--c3)">'+k.person.split(' ')[0]+'</td><td style="font-size:10px;color:var(--dim)">'+(MG_AY_ADI[k.donem.split('/')[0]]||k.donem)+'</td>'+URUNLER.map(u=>{const rec=rows.find(r=>r.sira===k.sira&&r.person===k.person&&r.brick===k.brick&&r.donem===k.donem&&r.ilac===u);return'<td>'+mgFmt(rec?rec[field]:null,mg2_veri==='PP')+'</td>';}).join('')+'<td>'+mgDurumBadge(rows.find(r=>r.sira===k.sira&&r.person===k.person&&r.brick===k.brick&&r.donem===k.donem)?.evol,rows.find(r=>r.sira===k.sira&&r.person===k.person&&r.brick===k.brick&&r.donem===k.donem)?.mi)+'</td></tr>').join('')||'<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--dim)">Veri yok</td></tr>';
  }
}
function mg2Toggle333(){mg2_333=!mg2_333;initMigi2();}
// ── PAGE 4: PRİM HESAPLA ─────────────────────────────────────
function getPrimRealId(u){return 'primReal_'+u.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'X');}

function buildPrimInputs(){
  const sel=document.getElementById('primTTT');
  if(sel&&sel.options.length<=1){ALL_TTTS.forEach(t=>{const opt=document.createElement('option');opt.value=opt.textContent=t;sel.appendChild(opt);});}
  if(sel&&!sel.value&&ALL_TTTS.length) sel.value=ALL_TTTS[0];
  const container=document.getElementById('primUrunInputs');
  if(container&&!container.children.length){
    URUN_ORDER.forEach(u=>{container.innerHTML+='<div><label style="font-size:9px;font-weight:700;color:'+(URUN_CLR[u]||'var(--c1)')+';display:block;margin-bottom:3px">'+u+'</label><input type="number" class="inp" id="'+getPrimRealId(u)+'" value="" min="0" max="200" placeholder="TL Real %" oninput="calcPrim()" style="padding:5px 8px"></div>';});
  }
  calcPrim();
}

function syncPrimFromCalc(){
  const page4=document.getElementById('page4');
  if(!page4||!page4.classList.contains('active')) return;
  if(!CALC_SYNC.timestamp) return;
  const primTTTEl=document.getElementById('primTTT');
  if(primTTTEl&&CALC_SYNC.ttt) primTTTEl.value=CALC_SYNC.ttt;
  updateSyncBadge();calcPrim();
}

function updateSyncBadge(){
  const badge=document.getElementById('primSyncBadge');if(!badge) return;
  if(CALC_SYNC.timestamp){const saniye=Math.round((Date.now()-CALC_SYNC.timestamp)/1000);const zaman=saniye<5?'az önce':saniye+'s önce';badge.innerHTML='<span style="color:#16A34A">🔗 Hesaplayıcı bağlı</span> <span style="color:var(--dim);font-size:9px">('+CALC_SYNC.ttt+' · '+zaman+')</span>';badge.style.background='#F0FDF4';badge.style.border='1px solid #BBF7D0';}
  else{badge.innerHTML='<span style="color:#D97706">⚠️ Hesaplayıcıdan veri yok — Satış Takibi sayfasında kutu girin</span>';badge.style.background='#FFFBEB';badge.style.border='1px solid #FDE68A';}
}

function applyCalcToPrim(){
  if(!CALC_SYNC.timestamp){alert('Önce Satış Takibi → Tahminli Hesaplayıcıya kutu değeri girin.');return;}
  const primTTTEl=document.getElementById('primTTT');
  if(primTTTEl&&CALC_SYNC.ttt) primTTTEl.value=CALC_SYNC.ttt;
  URUN_ORDER.forEach(u=>{const el=document.getElementById(getPrimRealId(u));if(el&&CALC_SYNC.urunReals[u]!==undefined) el.value=CALC_SYNC.urunReals[u].toFixed(1);});
  calcPrim();
}

function calcPrimForTTT(ttt){
  const rGenel=GENEL.find(g=>g.ttt===ttt&&g.urun==='GENEL TOPLAM');if(!rGenel) return 0;
  const effReal=rGenel.tl_pct||0;
  const urunRows=GENEL.filter(g=>g.ttt===ttt&&g.urun!=='GENEL TOPLAM'&&g.urun!=='DESTEVIT');
  const urunReals=Object.fromEntries(urunRows.map(r=>[r.urun,r.tl_pct]));
  const primPuani=rGenel.prim_pct||calcPrimPuani(urunReals,ttt);
  const carpan=effReal>=91?getCarpan(effReal):0;
  const migiKatsayi=effReal>=70?getMiGiKatsayi(100,100):0;
  return carpan*55000+(effReal>=91&&primPuani>=91?0.20*55000*carpan:0)+migiKatsayi*14000;
}

function calcPrim(){
  const ttt=document.getElementById('primTTT')?.value;if(!ttt) return;
  const urunReals={};let toplam_hedef=0,toplam_satis=0;
  const hasManualInput=URUN_ORDER.some(u=>document.getElementById(getPrimRealId(u))?.value);
  const hasCalcData=CALC_SYNC.timestamp>0&&CALC_SYNC.ttt===ttt;
  URUN_ORDER.forEach(u=>{
    const r=GENEL.find(g=>g.ttt===ttt&&g.urun===u);
    const inp=document.getElementById(getPrimRealId(u));
    let realPct=0;
    if(inp?.value){realPct=parseFloat(inp.value);}
    else if(hasCalcData&&CALC_SYNC.urunReals[u]!==undefined){realPct=CALC_SYNC.urunReals[u];if(inp) inp.placeholder=realPct.toFixed(1)+'% (Hesaplayıcı)';}
    else if(r){realPct=r.tl_pct;if(inp) inp.placeholder=r.tl_pct.toFixed(1)+'% (mevcut)';}
    urunReals[u]=realPct||0;
    if(r){toplam_hedef+=r.hedef_tl;toplam_satis+=r.satis_tl;}
  });
  let effReal;
  if(hasCalcData&&CALC_SYNC.totPct>0&&!hasManualInput){effReal=CALC_SYNC.totPct;}
  else if(!hasManualInput){const rGenel=GENEL.find(g=>g.ttt===ttt&&g.urun==='GENEL TOPLAM');effReal=rGenel?.tl_pct||(toplam_hedef>0?(toplam_satis/toplam_hedef*100):0);}
  else{effReal=URUN_ORDER.reduce((s,u)=>{const inp=document.getElementById(getPrimRealId(u));const val=inp?.value?parseFloat(inp.value):0;const r2=GENEL.find(g=>g.ttt===ttt&&g.urun===u);const ag=(r2&&r2.urun_agirlik>0)?r2.urun_agirlik:(URUN_AGIRLIK[u]||0.2);return s+val*ag;},0);}
  let primPuani;
  if(hasCalcData&&CALC_SYNC.totPrimPuan>0&&!hasManualInput){primPuani=CALC_SYNC.totPrimPuan;}
  else if(!hasManualInput){const rGenel=GENEL.find(g=>g.ttt===ttt&&g.urun==='GENEL TOPLAM');primPuani=rGenel?.prim_pct||calcPrimPuani(urunReals,ttt);}
  else{primPuani=calcPrimPuani(urunReals,ttt);}
  const mi=parseFloat(document.getElementById('primMI')?.value)||100;
  const gi=parseFloat(document.getElementById('primGI')?.value)||100;
  const carpan=effReal>=91?getCarpan(effReal):0;
  const migiKatsayi=effReal>=70?getMiGiKatsayi(mi,gi):0;
  const BAZ=55000,BAZ_MIGI=14000;
  const tlRealPrim=carpan*BAZ;
  const portfoyPrim=(effReal>=91&&primPuani>=91)?0.20*BAZ*carpan:0;
  const migiPrim=migiKatsayi*BAZ_MIGI;
  const toplamPrim=tlRealPrim+portfoyPrim+migiPrim;
  const okStyle=v=>v>0?'color:#16A34A;font-weight:700':'color:#DC2626;font-weight:700';
  const kaynakLabel=hasCalcData&&!URUN_ORDER.some(u=>document.getElementById(getPrimRealId(u))?.value)
    ?'<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:6px 10px;font-size:10px;color:#1D4ED8;margin-bottom:8px">🔗 <strong>Hesaplayıcıdan besleniyor</strong> — '+CALC_SYNC.ttt+' · TL Real: <strong>'+CALC_SYNC.totPct.toFixed(1)+'%</strong> · Prim Puanı: <strong>'+CALC_SYNC.totPrimPuan.toFixed(1)+'%</strong></div>'
    :'<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;padding:6px 10px;font-size:10px;color:#C2410C;margin-bottom:8px">✏️ <strong>Manuel giriş modu</strong></div>';
  const res=document.getElementById('primResult');
  if(res) res.innerHTML='<div style="display:grid;gap:8px">'+kaynakLabel
    +'<div style="background:#fff;border-radius:8px;padding:10px;border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);font-weight:600;margin-bottom:6px">KOŞUL KONTROLÜ</div><div style="font-size:11px;display:grid;gap:5px"><div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)"><span>TL Realizasyon</span><strong style="'+(effReal>=91?'color:#16A34A':'color:#DC2626')+'">'+effReal.toFixed(1)+'% '+(effReal>=91?'✅ (≥91%)':'❌ (<91%)')+'</strong></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)"><span>Prim Puanı</span><strong style="'+(primPuani>=91?'color:#16A34A':'color:#DC2626')+'">'+primPuani.toFixed(1)+'% '+(primPuani>=91?'✅':'⚠️ Portföy yok')+'</strong></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)"><span>MI İndeks</span><strong style="color:'+getIndeksColor(mi)+'">'+mi+' — '+getIndeksLabel(mi)+'</strong></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span>GI İndeks</span><strong style="color:'+getIndeksColor(gi)+'">'+gi+' — '+getIndeksLabel(gi)+'</strong></div>'
    +'</div></div>'
    +'<div style="background:#fff;border-radius:8px;padding:10px;border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);font-weight:600;margin-bottom:6px">PRİM HESABI (DÖNEMLİK)</div><table style="width:100%;font-size:11px;border-collapse:collapse">'
    +'<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px">TL Real Primi</td><td style="text-align:right"><span style="'+okStyle(tlRealPrim)+'">'+Math.round(tlRealPrim).toLocaleString('tr-TR')+' ₺</span></td></tr>'
    +'<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px">Portföy Primi</td><td style="text-align:right"><span style="'+okStyle(portfoyPrim)+'">'+Math.round(portfoyPrim).toLocaleString('tr-TR')+' ₺</span></td></tr>'
    +'<tr style="border-bottom:2px solid var(--c1)"><td style="padding:5px">MI & GI Primi (katsayı: '+migiKatsayi+'x)</td><td style="text-align:right"><span style="'+okStyle(migiPrim)+'">'+Math.round(migiPrim).toLocaleString('tr-TR')+' ₺</span></td></tr>'
    +'<tr style="background:rgba(79,0,140,.04)"><td style="padding:8px;font-weight:700;color:var(--c1);font-size:13px">TOPLAM PRİM</td><td style="text-align:right;font-size:16px;font-weight:800;color:var(--c1)">'+Math.round(toplamPrim).toLocaleString('tr-TR')+' ₺</td></tr>'
    +'</table></div>'
    +'<div style="font-size:9px;color:var(--dim);background:#F7F9FC;padding:8px;border-radius:6px">* Dönemlik hesaplama. MI & GI değerleri dönem bitiminde kesinleşir.</div>'
    +'</div>';
}
// ── PAGE 5: AI & MOTOR ───────────────────────────────────────
function renderAiAsistan(){
  const allTTTs=ALL_TTTS.length?ALL_TTTS:['AYKUT DİNLER'];
  if(!selAiTTT&&allTTTs.length) selAiTTT=allTTTs[0];
  if(!engineSelTTT) engineSelTTT=selAiTTT;
  switchAiTab('motor');renderEngine();
  const aiAll=['ŞENOL YILMAZ',...allTTTs];
  const aiTttBar=document.getElementById('aiTttBar');
  if(aiTttBar) aiTttBar.innerHTML=aiAll.map(t=>'<button class="sp-btn'+(t===selAiTTT?' active':'')+'" onclick="setAiTTT(\''+t+'\')">'+t+'</button>').join('');
  loadProxyUrl();
}

function setAiTTT(ttt){selAiTTT=ttt;engineSelTTT=ttt;renderAiAsistan();}

function switchAiTab(tab){
  ['motor','chat','quick'].forEach(t=>{
    const el=document.getElementById('aiTab_'+t),btn=document.getElementById('tab_'+t);
    if(el) el.style.display='none';
    if(btn){btn.style.background='transparent';btn.style.color='var(--dim)';btn.style.borderBottomColor='transparent';btn.style.fontWeight='600';}
  });
  const active=document.getElementById('aiTab_'+tab),activeBtn=document.getElementById('tab_'+tab);
  if(active) active.style.display='block';
  if(activeBtn){activeBtn.style.background='linear-gradient(135deg,rgba(79,0,140,.06),rgba(27,206,216,.03))';activeBtn.style.color='var(--c1)';activeBtn.style.borderBottomColor='var(--c1)';activeBtn.style.fontWeight='700';}
}

function buildTTTContext(ttt){
  const genelRows=GENEL.filter(r=>r.ttt===ttt&&r.urun!=='GENEL TOPLAM');
  const genelTotal=GENEL.find(r=>r.ttt===ttt&&r.urun==='GENEL TOPLAM');
  const migiRows=(MIGI_TL_RAW||[]).filter(r=>r.ttt===ttt);
  const top333=migiRows.filter(r=>r.sira<=333);
  const trSira=TR_SIRA_MAP[ttt]||'?';
  let ctx='=== SAMSUN 2D SATIŞ VERİLERİ ===\nTemsilci: '+ttt+' | TR Sırası: #'+trSira+'\nDönem: 2026\n\n--- GENEL PERFORMANS ---\nToplam Gerçekleşme: %'+(genelTotal?.tl_pct?.toFixed(2)||0)+'\nHedef TL: '+(genelTotal?.hedef_tl||0).toLocaleString('tr-TR',{maximumFractionDigits:0})+' ₺\nSatış TL: '+(genelTotal?.satis_tl||0).toLocaleString('tr-TR',{maximumFractionDigits:0})+' ₺\nKalan TL: '+(genelTotal?.kalan_tl||0).toLocaleString('tr-TR',{maximumFractionDigits:0})+' ₺\n\n--- ÜRÜN BAZLI ---';
  genelRows.forEach(r=>{ctx+='\n'+r.urun+': %'+(r.tl_pct?.toFixed(1)||0)+' (Hedef: '+(r.hedef_tl/1000).toFixed(0)+'K, Satış: '+(r.satis_tl/1000).toFixed(0)+'K)';});
  if(IMS&&IMS.length){
    const imsGrps=[...new Set(IMS.filter(r=>r.ttt===ttt).map(r=>r.ilac_grubu))];
    if(imsGrps.length){
      ctx+='\n\n--- PAZAR & RAKİP (IMS) ---';
      imsGrps.forEach(grp=>{
        const ownKey=OWN_IMS[grp];const ownRows=IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&r.ilac===ownKey);const mktRows=IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&r.is_mkt);
        if(!ownRows.length&&!mktRows.length) return;
        const ownTot=ownRows.reduce((s,r)=>s+r.toplam,0),mktTot=mktRows.reduce((s,r)=>s+r.toplam,0);
        const ppi=mktTot>0?(ownTot/mktTot*100).toFixed(1):'—';
        const rivals=IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&!r.is_mkt&&r.ilac!==ownKey).sort((a,b)=>b.toplam-a.toplam).slice(0,3);
        ctx+='\n['+( GRP_LBL[grp]||grp)+'] Kendi:'+fK(ownTot)+' | Pazar:'+fK(mktTot)+' | Pay:'+ppi+'%';
        if(rivals.length) ctx+='\n  Rakipler: '+rivals.map(r=>r.ilac+'('+fK(r.toplam)+')').join(' | ');
      });
    }
  }
  ctx+='\n\n--- BRICK (MI & GI) ---\nToplam Brick: '+migiRows.length+' | İlk 333: '+top333.length;
  const today=new Date().toISOString().slice(0,10);
  const cur=PERIODS.find(p=>today>=p.start&&today<=p.end);
  if(cur){const rem=workDays(today,cur.end);ctx+='\n\n--- SÜRE ---\nAktif dönem: '+cur.label+' ('+cur.months+')\nKalan iş günü: '+rem+' gün';}
  ctx+=buildEczaneContext(ttt);
  return ctx;
}

function buildEczaneContext(ttt){
  if(!eczaneLoaded||!ECZANE_RAW){
    if(!eczaneLoaded){fetch(GS_ECZANE_URL+'?v='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.text():Promise.reject('HTTP '+r.status)).then(csv=>{ECZANE_RAW=parseEczaneCSV(csv);eczaneLoaded=true;}).catch(e=>console.warn('[ECZANE BG]',e));}
    return '\n\n--- ECZANE ---\n(Henüz yüklenmedi)';
  }
  const data=ECZANE_RAW.filter(r=>r.ttt===ttt);if(!data.length) return '';
  const eczMap={};
  data.forEach(r=>{if(!eczMap[r.gln])eczMap[r.gln]={ad:r.ad,brick:r.brick,ocak:0,subat:0,uruns:new Set()};if(r.ay==='01/2026')eczMap[r.gln].ocak+=r.adet;if(r.ay==='02/2026')eczMap[r.gln].subat+=r.adet;eczMap[r.gln].uruns.add(r.urun);});
  const list=Object.values(eczMap).sort((a,b)=>(b.ocak+b.subat)-(a.ocak+a.subat));
  const top10=list.slice(0,10),dusen=list.filter(e=>e.subat<e.ocak&&e.subat>0).slice(0,5);
  let ctx='\n\n--- ECZANE (Oca-Şub 2026) ---\nToplam: '+list.length;
  ctx+='\nEn Çok Satan 10:';
  top10.forEach(e=>{ctx+='\n  '+e.ad+' ['+e.brick+']: Oca='+e.ocak+', Şub='+e.subat;});
  if(dusen.length){ctx+='\nDüşüş:';dusen.forEach(e=>{ctx+='\n  '+e.ad+': Oca='+e.ocak+'→Şub='+e.subat;});}
  return ctx;
}

function aiQuick(type){
  switchAiTab('chat');
  const prompts={
    genel:'Bu temsilcinin genel satış durumunu analiz et. Güçlü/zayıf yönleri ve acil durumları belirt.',
    risk:'Prim riski analizi yap. Kalan iş günü dikkate alarak hangi ürünler kritik, haftalık gereken satışı hesapla.',
    prim:'2026 İLKO prim sistemine göre dönemlik prim beklentisini hesapla.',
    brick:'İlk 333 brick bazında önceliklendirme yap. Hangi bricklere önce gitmeli?',
    strateji:'Kalan iş günlerine göre haftalık satış stratejisi öner. Günlük kutu/TL hedefleri ver.',
    eczane:'Eczane satış verilerini analiz et. Önerilen sipariş paketleri ver.',
    rakip:'IMS verilerini kullanarak rakip analizi yap. Savunma/saldırı stratejisi öner.',
  };
  sendAiMsgWithText(prompts[type]||type);
}

async function sendAiMsg(){const input=document.getElementById('aiInput');const text=input.value.trim();if(!text) return;input.value='';sendAiMsgWithText(text);}

async function sendAiMsgWithText(text){
  if(!selAiTTT&&engineSelTTT) selAiTTT=engineSelTTT;
  if(!selAiTTT){alert('Lütfen temsilci seçin.');return;}
  const chatArea=document.getElementById('aiChatArea'),statusEl=document.getElementById('aiStatus');
  chatArea.innerHTML+='<div class="ai-bubble-user"><strong>👤 Siz</strong><br>'+text+'</div>';
  requestAnimationFrame(()=>{chatArea.scrollTop=chatArea.scrollHeight;});
  const loadId='ai_loading_'+Date.now();
  chatArea.innerHTML+='<div id="'+loadId+'" class="ai-bubble-ai"><strong style="color:var(--c1)">🤖 AI Asistan</strong><br><span style="color:var(--dim)">⏳ Analiz ediliyor...</span></div>';
  requestAnimationFrame(()=>{chatArea.scrollTop=chatArea.scrollHeight;});
  statusEl.textContent='⏳ Düşünüyor...';
  const context=buildTTTContext(selAiTTT);
  const systemPrompt='Sen İLKO İlaç firmasının Samsun 2D bölgesi için çalışan uzman bir satış analisti ve stratejistsin.\n2026 İLKO TTT prim sistemi:\n- TL Real Primi: %91+ realizasyon, çarpan tablosu (baz: 55.000₺/dönem)\n- Portföy Primi: %91+ TL real VE %91+ prim puanı (+%20)\n- MI&GI Primi: %70+ TL real, matris katsayısı (baz: 14.000₺)\nYanıtlar: Net, somut sayılı, uygulanabilir Türkçe.';
  aiChatHistory.push({role:'user',content:context+'\n\nSoru: '+text});
  try{
    const AI_PROXY_URL=window.AI_PROXY_URL||'https://samsun.yilmazusta28.workers.dev';
    const response=await fetch(AI_PROXY_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:systemPrompt,messages:aiChatHistory.slice(-6)})});
    const data=await response.json();
    const reply=data.content?.[0]?.text||'Yanıt alınamadı.';
    aiChatHistory.push({role:'assistant',content:reply});
    const formatted=reply.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    const loadEl=document.getElementById(loadId);
    if(loadEl) loadEl.innerHTML='<strong style="color:var(--c1)">🤖 AI Asistan</strong><br><div style="margin-top:6px;line-height:1.6">'+formatted+'</div>';
    statusEl.textContent='✅ Hazır';
  }catch(err){
    const loadEl=document.getElementById(loadId);
    if(loadEl) loadEl.innerHTML='<strong style="color:#DC2626">⚠️ Hata</strong><br><div style="margin-top:6px;font-size:11px">'+err.message+'</div>';
    statusEl.textContent='❌ Hata';
  }
  requestAnimationFrame(()=>{chatArea.scrollTop=chatArea.scrollHeight;});
}

function loadProxyUrl(){const DEFAULT='https://samsun.yilmazusta28.workers.dev';window.AI_PROXY_URL=DEFAULT;try{const saved=sessionStorage.getItem('ai_proxy_url')||DEFAULT;const inp=document.getElementById('proxyUrlInput');if(inp) inp.value=saved;window.AI_PROXY_URL=saved;updateProxyStatus(saved);}catch(e){updateProxyStatus(DEFAULT);}}
function saveProxyUrl(){const val=document.getElementById('proxyUrlInput')?.value?.trim();if(val&&val.startsWith('http')){window.AI_PROXY_URL=val;try{sessionStorage.setItem('ai_proxy_url',val);}catch(e){}updateProxyStatus(val);}}
function updateProxyStatus(url){const el=document.getElementById('proxyStatus');if(!el)return;if(url&&!url.includes('YOUR-WORKER')){el.textContent='✅ Yapılandırıldı';el.style.background='#16A34A';el.style.color='#fff';}else{el.textContent='⚠️ Gerekli';el.style.background='#D97706';el.style.color='#fff';}}
async function testProxy(){const url=document.getElementById('proxyUrlInput')?.value?.trim();if(!url||!url.startsWith('http')){alert('Geçerli bir URL girin.');return;}const statusEl=document.getElementById('proxyStatus');statusEl.textContent='⏳ Test...';try{const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:10,messages:[{role:'user',content:'test'}]})});const data=await resp.json();if(data.content||data.type){window.AI_PROXY_URL=url;try{sessionStorage.setItem('ai_proxy_url',url);}catch(e){}statusEl.textContent='✅ Bağlandı!';statusEl.style.background='#16A34A';statusEl.style.color='#fff';document.getElementById('proxyInstructions').style.display='none';}else{throw new Error('Yanıt formatı hatalı');}}catch(err){statusEl.textContent='❌ Bağlanamadı';statusEl.style.background='#DC2626';statusEl.style.color='#fff';alert('Bağlantı hatası: '+err.message);}}

function showZamHesap(){
  const qp=document.getElementById('zamPanelQuick');
  if(qp) qp.style.display=qp.style.display==='none'?'block':'none';
  if(document.getElementById('zamInputsQ')&&document.getElementById('zamInputsQ').children.length===0) buildZamInputs(true);
}
function buildZamInputs(isQuick){
  const container=document.getElementById(isQuick?'zamInputsQ':'zamInputs');
  if(!container||container.children.length) return;
  container.innerHTML=URUN_ORDER.map(u=>'<div><label style="font-size:9px;font-weight:700;color:'+(URUN_CLR[u]||'var(--c1)')+';display:block;margin-bottom:3px">'+u+'</label><div style="display:flex;gap:4px;align-items:center"><input type="number" class="inp" id="zam_'+u.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'X')+(isQuick?'_q':'')+'" value="0" min="0" max="100" step="1" style="padding:5px 8px;font-size:11px" placeholder="Artış %"><span style="font-size:10px;color:var(--dim)">%</span></div></div>').join('');
}
function calcZam(isQuick){
  const ttt=selAiTTT||ALL_TTTS[0];if(!ttt) return;
  const getSuffix=u=>u.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'X');
  const rows=GENEL.filter(r=>r.ttt===ttt&&r.urun!=='GENEL TOPLAM'&&r.urun!=='DESTEVIT');
  let html='<div style="display:grid;gap:6px">',totOldH=0,totNewH=0,totS=0;
  rows.forEach(r=>{const id='zam_'+getSuffix(r.urun)+(isQuick?'_q':'');const zamPct=parseFloat(document.getElementById(id)?.value)||0;const newH=r.hedef_tl*(1+zamPct/100),newReal=newH>0?(r.satis_tl/newH*100):0,oldReal=r.tl_pct,diff=newReal-oldReal;totOldH+=r.hedef_tl;totNewH+=newH;totS+=r.satis_tl;html+='<div style="background:#F8FAFC;border-radius:7px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;color:'+(URUN_CLR[r.urun]||'var(--c1)')+'">'+r.urun+'</span><span style="font-size:11px"><span style="color:var(--dim)">'+oldReal.toFixed(1)+'%</span><span style="margin:0 6px;color:var(--dim)">→</span><span style="font-weight:700;color:'+(newReal>=91?'#16A34A':newReal>=70?'#D97706':'#DC2626')+'">'+newReal.toFixed(1)+'%</span>'+(zamPct>0?'<span style="font-size:9px;color:#DC2626;margin-left:4px">(-'+Math.abs(diff).toFixed(1)+'pp)</span>':'')+'</span></div>';});
  const totOldReal=totOldH>0?(totS/totOldH*100):0,totNewReal=totNewH>0?(totS/totNewH*100):0;
  html+='<div style="background:linear-gradient(135deg,rgba(79,0,140,.06),rgba(27,206,216,.04));border:1px solid rgba(79,0,140,.2);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;color:var(--c1)">GENEL TOPLAM</span><span style="font-size:13px;font-weight:800"><span style="color:var(--dim)">'+totOldReal.toFixed(1)+'%</span><span style="margin:0 6px;color:var(--dim)">→</span><span style="color:'+(totNewReal>=91?'#16A34A':totNewReal>=70?'#D97706':'#DC2626')+'">'+totNewReal.toFixed(1)+'%</span></span></div>';
  html+='</div>';
  const resultEl=document.getElementById(isQuick?'zamResultQ':'zamResult');
  if(resultEl) resultEl.innerHTML=html;
}

// ── GÖREV MOTORU ─────────────────────────────────────────────
function renderEngine(){
  const bar=document.getElementById('engineTttBar');if(!bar) return;
  const allT=['ŞENOL YILMAZ',...ALL_TTTS];
  if(!engineSelTTT&&ALL_TTTS.length) engineSelTTT=ALL_TTTS[0];
  bar.innerHTML=allT.map(t=>{const photoUrl=getTTTPhoto(t);const initials=t.split(' ').map(w=>w[0]).slice(0,2).join('');const avatarHtml=photoUrl?'<img src="'+photoUrl+'" onerror="this.style.display=\'none\'" crossorigin="anonymous">':'<div class="etb-avatar" style="background:#4F008C">'+initials+'</div>';return'<button class="engine-ttt-btn'+(t===engineSelTTT?' active':'')+'" onclick="setAiTTT(\''+t+'\')">'+avatarHtml+'<span>'+t+'</span></button>';}).join('');
  const today=new Date().toISOString().slice(0,10);
  const cur=PERIODS.find(p=>today>=p.start&&today<=p.end);
  const rem=cur?workDays(today,cur.end):'—';
  const gt=GENEL.find(r=>r.ttt===engineSelTTT&&r.urun==='GENEL TOPLAM');
  document.getElementById('emv_ttt').textContent=engineSelTTT.split(' ')[0];
  document.getElementById('emv_real').textContent=gt?fPct(gt.tl_pct):'—';
  const realEl=document.getElementById('emv_real');if(realEl) realEl.className='engine-meta-val '+(gt?.tl_pct>=91?'good':gt?.tl_pct>=70?'warn':'danger');
  document.getElementById('emv_gun').textContent=rem+' gün';
  document.getElementById('emv_kalan').textContent=gt?fTL(Math.max(0,gt.kalan_tl)):'—';
  document.getElementById('emv_donem').textContent=cur?cur.label:'—';
  document.getElementById('engineTttBadge').textContent=engineSelTTT;
}

function runEngine(){
  if(!engineSelTTT){alert('Temsilci seçin!');return;}
  const btn=document.getElementById('engineRunBtn');
  btn.disabled=true;btn.classList.add('running');btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Analiz ediliyor...';
  setTimeout(()=>{try{_runEngineCore();}catch(e){console.error('Engine error:',e);}btn.disabled=false;btn.classList.remove('running');btn.innerHTML='<i class="fas fa-bolt"></i> Motoru Çalıştır';},120);
}

function _runEngineCore(){
  const ttt=engineSelTTT;
  const today=new Date(),todayStr=today.toISOString().slice(0,10);
  const todayDisplay=today.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long'});
  const cur=PERIODS.find(p=>todayStr>=p.start&&todayStr<=p.end);
  const remDays=cur?workDays(todayStr,cur.end):0;
  const gt=GENEL.find(r=>r.ttt===ttt&&r.urun==='GENEL TOPLAM');
  const urunRows=GENEL.filter(r=>r.ttt===ttt&&r.urun!=='GENEL TOPLAM');
  const migiRows=(MIGI_TL_RAW||[]).filter(r=>r.ttt===ttt);
  const eczRows=(ECZANE_RAW||[]).filter(r=>r.ttt===ttt);
  const imsRows=(IMS||[]).filter(r=>r.ttt===ttt);
  const kalanTL=gt?Math.max(0,gt.kalan_tl):0;
  const totalReal=gt?gt.tl_pct:0;
  const urunKPI=urunRows.map(r=>{const p=IMS_TL_MAP[r.urun]||0;const kalan=Math.max(0,r.kalan_tl);const kalanKutu=p>0?Math.round(kalan/p):0;const gunlukKutu=remDays>0&&kalanKutu>0?Math.ceil(kalanKutu/remDays):0;return{...r,kalan,kalanKutu,gunlukKutu,imsFiyat:p};});
  const top333=migiRows.filter(r=>r.sira<=333);
  const riskBricks=top333.filter(r=>(r.mi||100)<90||(r.gi||100)<90).sort((a,b)=>a.sira-b.sira).slice(0,5);
  const oppBricks=top333.filter(r=>(r.mi||0)>=110&&(r.gi||0)>=100).sort((a,b)=>a.sira-b.sira).slice(0,5);
  const critBricks=riskBricks.slice(0,3);
  const aktifEcz=eczRows.filter(r=>(r.ocak||0)+(r.subat||0)>0);
  const topEcz=[...aktifEcz].sort((a,b)=>((b.ocak||0)+(b.subat||0))-((a.ocak||0)+(a.subat||0))).slice(0,4);
  const primPuan=gt?.prim_pct||calcPrimPuani(Object.fromEntries(urunRows.map(r=>[r.urun,r.tl_pct])),ttt);
  const carpan2=totalReal>=91?getCarpan(totalReal):0;
  const primTL=carpan2*55000,primPort=(totalReal>=91&&primPuan>=91)?11000:0;
  const miAvg2=migiRows.length?migiRows.reduce((s,r)=>s+(r.mi||100),0)/Math.max(1,migiRows.length):100;
  const giAvg2=migiRows.length?migiRows.reduce((s,r)=>s+(r.gi||100),0)/Math.max(1,migiRows.length):100;
  const migiKatsayi2=totalReal>=70?getMiGiKatsayi(Math.round(miAvg2),Math.round(giAvg2)):0;
  const primMIGI=migiKatsayi2*14000,toplamPrim=primTL+primPort+primMIGI;

  const brickTasks=critBricks.length?critBricks.map((b,i)=>'<div class="task-row"><div class="task-priority tp-'+(i===0?'1':i===1?'2':'3')+'">'+(i+1)+'</div><div class="task-text"><div class="task-main">'+b.brick+'</div><div class="task-detail"><span class="task-tag tt-brick">Sıra #'+b.sira+'</span>MI: '+(b.mi?.toFixed(0)||'—')+' · GI: '+(b.gi?.toFixed(0)||'—')+(b.mi<90?'<span class="task-tag tt-risk">MI Riski</span>':b.gi<90?'<span class="task-tag tt-risk">GI Riski</span>':'')+'</div></div></div>').join(''):'<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">İlk 333\'te risk brick yok 🎉</div>';
  const urunTasks=urunKPI.filter(r=>r.kalan>0).map(r=>'<div class="task-row"><div class="task-priority '+(r.tl_pct<70?'tp-1':r.tl_pct<91?'tp-2':'tp-ok')+'">'+(r.tl_pct<70?'!':r.tl_pct<91?'↑':'✓')+'</div><div class="task-text"><div class="task-main">'+r.urun+' <span style="font-size:10px;color:var(--dim)">%'+(r.tl_pct?.toFixed(0)||0)+'</span></div><div class="task-detail"><span class="task-tag tt-urun">Günlük '+r.gunlukKutu+' kutu</span>Kalan: '+fTL(r.kalan)+' · '+r.kalanKutu+' kutu</div></div></div>').join('')||'<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">Tüm ürünler hedefe ulaştı 🏆</div>';
  const eczTasks=topEcz.map((e,i)=>{const tot=(e.ocak||0)+(e.subat||0);return'<div class="task-row"><div class="task-priority tp-'+(i<2?'2':'3')+'">'+(i+1)+'</div><div class="task-text"><div class="task-main">'+(e.ad||'Eczane')+'</div><div class="task-detail"><span class="task-tag tt-brick">'+(e.brick||'—')+'</span>'+fK(tot)+' kutu</div></div></div>';}).join('')||'<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px">Eczane verisi yok</div>';
  const primTasks='<div class="task-row"><div class="task-priority '+(primTL>0?'tp-ok':'tp-1')+'">'+(primTL>0?'✓':'!')+'</div><div class="task-text"><div class="task-main">TL Real Primi</div><div class="task-detail"><span class="task-tag tt-prim">'+(primTL>0?fTL(primTL):'Henüz yok')+'</span> Eşik: %91 · Mevcut: %'+(totalReal?.toFixed(1)||0)+'</div></div></div><div class="task-row"><div class="task-priority '+(primPort>0?'tp-ok':'tp-2')+'">'+(primPort>0?'✓':'↑')+'</div><div class="task-text"><div class="task-main">Portföy Primi</div><div class="task-detail"><span class="task-tag tt-prim">'+(primPort>0?fTL(primPort):'Henüz yok')+'</span></div></div></div><div class="task-row"><div class="task-priority '+(primMIGI>0?'tp-ok':'tp-3')+'">'+(primMIGI>0?'✓':'↑')+'</div><div class="task-text"><div class="task-main">MI&GI Primi</div><div class="task-detail"><span class="task-tag tt-prim">'+fTL(Math.round(primMIGI))+'</span> Katsayı: '+migiKatsayi2+'x</div></div></div><div class="task-row" style="background:linear-gradient(90deg,rgba(79,0,140,.04),rgba(27,206,216,.02));border:1px solid rgba(79,0,140,.1)"><div class="task-priority" style="background:linear-gradient(135deg,#4F008C,#1BCED8)">Σ</div><div class="task-text"><div class="task-main" style="color:var(--c1)">Tahmini Toplam Prim</div><div class="task-detail" style="font-family:JetBrains Mono,monospace;font-weight:700;font-size:13px;color:var(--c2)">'+fTL(Math.round(toplamPrim))+'</div></div></div>';

  const out=document.getElementById('engineOutput');
  if(!out) return;
  out.style.display='block';
  out.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px"><div style="font-size:10px;font-weight:700;color:var(--c1);text-transform:uppercase;letter-spacing:1.5px">'+todayDisplay+' · '+remDays+' iş günü</div><span class="card-badge">'+Math.ceil(remDays/5)+' Hafta Kaldı</span></div><div class="task-grid" id="engineTaskGrid"></div><div class="risk-grid" style="margin-top:18px"><div class="risk-panel"><div class="risk-panel-title" style="color:#DC2626">⚠️ Risk Alanları</div><div id="engineRisks"></div></div><div class="risk-panel"><div class="risk-panel-title" style="color:#059669">🚀 Fırsatlar</div><div id="engineOpps"></div></div></div><div style="margin-top:18px"><div class="strategy-timeline" id="engineTimeline"></div></div><div id="enginePrimPanel" style="margin-top:18px"></div>';

  const taskGrid=document.getElementById('engineTaskGrid');
  if(taskGrid) taskGrid.innerHTML='<div class="task-card"><div class="task-card-header"><div class="task-card-icon" style="background:linear-gradient(135deg,rgba(79,0,140,.1),rgba(79,0,140,.05))">🗺️</div><div><div class="task-card-title">Bugün Git</div><div class="task-card-sub">Öncelikli Brick Rotası</div></div></div>'+brickTasks+'</div><div class="task-card"><div class="task-card-header"><div class="task-card-icon" style="background:linear-gradient(135deg,rgba(27,206,216,.1),rgba(27,206,216,.05))">💊</div><div><div class="task-card-title">Bugün Sat</div><div class="task-card-sub">Ürün Günlük Hedef</div></div></div>'+urunTasks+'</div><div class="task-card"><div class="task-card-header"><div class="task-card-icon" style="background:linear-gradient(135deg,rgba(217,119,6,.1),rgba(217,119,6,.05))">🏥</div><div><div class="task-card-title">Öncelikli Eczaneler</div></div></div>'+eczTasks+'</div><div class="task-card"><div class="task-card-header"><div class="task-card-icon" style="background:linear-gradient(135deg,rgba(5,150,105,.1),rgba(5,150,105,.05))">💰</div><div><div class="task-card-title">Prim Durumu</div></div></div>'+primTasks+'</div>';

  const riskHtml=[...riskBricks.slice(0,4).map(b=>'<div class="risk-item ri-danger"><div class="risk-item-name">⚠️ '+b.brick+'</div><div class="risk-item-detail">Sıra #'+b.sira+' · MI: '+(b.mi?.toFixed(0)||'—')+' · GI: '+(b.gi?.toFixed(0)||'—')+'</div></div>'),...urunKPI.filter(r=>r.tl_pct<70).map(r=>'<div class="risk-item ri-warn"><div class="risk-item-name">📉 '+r.urun+'</div><div class="risk-item-detail">%'+r.tl_pct?.toFixed(1)+'· Kalan: '+fTL(r.kalan)+'<br>Günlük: '+r.gunlukKutu+' kutu</div></div>')].join('')||'<div style="color:var(--good);font-size:12px;padding:12px;text-align:center">Risk tespit edilmedi 🎉</div>';
  const oppHtml=oppBricks.slice(0,4).map(b=>'<div class="risk-item ri-good"><div class="risk-item-name">🚀 '+b.brick+'</div><div class="risk-item-detail">Sıra #'+b.sira+' · MI: '+(b.mi?.toFixed(0)||'—')+' · GI: '+(b.gi?.toFixed(0)||'—')+'</div></div>').join('')||'<div style="color:var(--dim);font-size:12px;padding:12px;text-align:center">Daha fazla veri gerekli</div>';
  const re=document.getElementById('engineRisks'),oe=document.getElementById('engineOpps');
  if(re) re.innerHTML=riskHtml;if(oe) oe.innerHTML=oppHtml;

  const totalWeeks=Math.ceil(remDays/5);let cumDays=0;const wks=[];
  for(let w=0;w<Math.min(totalWeeks,4);w++){const wDays=Math.min(5,remDays-cumDays);const wKalan=kalanTL>0?Math.round(kalanTL*wDays/Math.max(1,remDays)):0;const dotCls=w===0?'danger':w===1?'warn':'good';const brickFocus=critBricks.slice(0,2+w).map(b=>b.brick).join(', ')||'Tüm brickler';const wKutu=urunKPI.map(r=>({urun:r.urun,kutu:Math.ceil((r.kalanKutu||0)*wDays/Math.max(1,remDays))}));wks.push('<div class="stl-item"><div class="stl-dot '+dotCls+'"></div><div class="stl-week">'+(w===0?'Bu Hafta':'Hafta '+(w+1))+' · '+wDays+' iş günü</div><div class="stl-content"><div class="stl-title">'+(w===0?'🔥 Kritik Görevler':w===1?'📈 Büyüme Hedefi':w===2?'🎯 Konsolidasyon':'🏁 Sprint Finish')+'</div><div class="stl-tasks"><b>TL Hedef:</b> '+fTL(wKalan)+'<br><b>Brick Fokus:</b> '+brickFocus+'<br><b>Ürün:</b> '+wKutu.filter(k=>k.kutu>0).map(k=>k.urun+': '+k.kutu+' kutu').join(' · ')+'</div></div></div>');cumDays+=wDays;}
  const tl=document.getElementById('engineTimeline');if(tl) tl.innerHTML=wks.join('');

  const gerekliKalanTL=gt&&gt.hedef_tl?gt.hedef_tl*0.91-gt.satis_tl:0;
  const pp=document.getElementById('enginePrimPanel');
  if(pp) pp.innerHTML='<div style="background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:14px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;color:#fff;flex-wrap:wrap;gap:10px"><div><div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:4px">Tahmini Dönem Toplam Prim</div><div style="font-family:JetBrains Mono,monospace;font-size:26px;font-weight:800">'+fTL(Math.round(toplamPrim))+'</div></div><div style="text-align:right"><div style="font-size:10px;opacity:.7;margin-bottom:3px">%91 hedefe ulaşıldığında</div><div style="font-size:11px;opacity:.85">'+(gerekliKalanTL>0?'Kalan: '+fTL(Math.round(gerekliKalanTL)):'Hedef aşıldı 🎉')+'</div></div></div>';
}
// ── PAGE 6: ECZANE ───────────────────────────────────────────
function getBrickTTTMap(){
  const map={};
  if(IMS&&IMS.length) IMS.forEach(r=>{if(r.brick&&r.ttt) map[r.brick.toUpperCase()]=r.ttt;});
  else if(MIGI_TL_RAW&&MIGI_TL_RAW.length) MIGI_TL_RAW.forEach(r=>{if(r.brick&&r.ttt) map[r.brick.toUpperCase()]=r.ttt;});
  return map;
}

async function renderEczane(){
  const statusEl=document.getElementById('eczaneLoadStatus');
  if(!eczaneLoaded){
    if(statusEl) statusEl.textContent='⏳ ECZANE.csv yükleniyor...';
    try{
      const resp=await fetch(GS_ECZANE_URL+'?v='+Date.now(),{cache:'no-store'});
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const csv=await resp.text();
      ECZANE_RAW=parseEczaneCSV(csv);
      eczaneLoaded=true;
      if(statusEl) statusEl.textContent='✅ '+ECZANE_RAW.length.toLocaleString('tr-TR')+' satış kaydı';
      console.log('[ECZANE] Loaded:',ECZANE_RAW.length,'records');
    }catch(err){if(statusEl) statusEl.textContent='❌ '+err.message;console.error('[ECZANE]',err);return;}
  }
  buildEczaneFilters();renderEczaneContent();
}

function buildEczaneFilters(){
  const brickTTT=getBrickTTTMap();
  if(ECZANE_RAW&&ECZANE_RAW.length&&Object.keys(brickTTT).length) ECZANE_RAW.forEach(r=>{if(!r.ttt&&r.brick) r.ttt=brickTTT[r.brick.toUpperCase()]||null;});
  const allT=[...ALL_TTTS];
  if(!selEczaneTTT&&allT.length) selEczaneTTT=allT[0];
  document.getElementById('eczaneTttBar').innerHTML=allT.map(t=>'<button class="tfb-sp'+(t===selEczaneTTT?' active':'')+'" onclick="selEczaneTTT=\''+t+'\';buildEczaneFilters();renderEczaneContent()">'+t.split(' ')[0]+'</button>').join('');
  const tttBricks=[...new Set(ECZANE_RAW.filter(r=>r.ttt===selEczaneTTT).map(r=>r.brick))].sort();
  document.getElementById('eczaneBrickBar').innerHTML=['TÜMÜ',...tttBricks].map(b=>'<button class="tfb-sp'+(b===selEczaneBrick?' active':'')+'" onclick="selEczaneBrick=\''+b.replace(/'/g,"\\'")+'\';buildEczaneFilters();renderEczaneContent()" style="font-size:9px;padding:4px 8px">'+b+'</button>').join('');
  const uruns=[...new Set(ECZANE_RAW.map(r=>r.urun))].sort();
  document.getElementById('eczaneUrunBar').innerHTML=['TÜMÜ',...uruns].map(u=>'<button class="tfb-sp'+(u===selEczaneUrun?' active':'')+'" onclick="selEczaneUrun=\''+u.replace(/'/g,"\\'")+'\';buildEczaneFilters();renderEczaneContent()" style="font-size:9px;padding:4px 8px">'+u+'</button>').join('');
  const aylar=[...new Set(ECZANE_RAW.map(r=>r.ay))].sort();
  const AY_LABELS={'01/2026':'Ocak 2026','02/2026':'Şubat 2026','03/2026':'Mart 2026','04/2026':'Nisan 2026','05/2026':'Mayıs 2026','06/2026':'Haziran 2026','07/2026':'Temmuz 2026','08/2026':'Ağustos 2026','09/2026':'Eylül 2026','10/2026':'Ekim 2026','11/2026':'Kasım 2026','12/2026':'Aralık 2026'};
  document.getElementById('eczaneAyBar').innerHTML=['TÜMÜ',...aylar].map(a=>'<button class="tfb-sp'+(a===selEczaneAy?' active':'')+'" onclick="selEczaneAy=\''+a+'\';buildEczaneFilters();renderEczaneContent()" style="font-size:9px;padding:4px 8px">'+(a==='TÜMÜ'?'Tümü':(AY_LABELS[a]||a))+'</button>').join('');
}

function getFilteredEczane(){
  return ECZANE_RAW.filter(r=>{
    if(selEczaneTTT&&r.ttt!==selEczaneTTT) return false;
    if(selEczaneBrick!=='TÜMÜ'&&r.brick!==selEczaneBrick) return false;
    if(selEczaneUrun!=='TÜMÜ'&&r.urun!==selEczaneUrun) return false;
    if(selEczaneAy!=='TÜMÜ'&&r.ay!==selEczaneAy) return false;
    return true;
  });
}

function renderEczaneContent(){
  const filtered=getFilteredEczane();
  const mevcutAylar=[...new Set(filtered.map(r=>r.ay))].sort();
  const eczMap={};
  filtered.forEach(r=>{if(!eczMap[r.gln]){const ayInit={};mevcutAylar.forEach(a=>{ayInit['ay_'+a]=0;});eczMap[r.gln]={gln:r.gln,ad:r.ad,brick:r.brick,ttt:r.ttt,toplam:0,tutar:0,iade:0,uruns:new Set(),...ayInit};}const e=eczMap[r.gln];e.toplam+=r.adet;e.tutar+=r.tutar;e['ay_'+r.ay]=(e['ay_'+r.ay]||0)+r.adet;e.uruns.add(r.urun);});
  const eczList=Object.values(eczMap);
  eczList.forEach(e=>{e.uruns=[...e.uruns];e.ocak=e['ay_01/2026']||0;e.subat=e['ay_02/2026']||0;});
  const totAdet=eczList.reduce((s,e)=>s+e.toplam,0),totTutar=eczList.reduce((s,e)=>s+e.tutar,0);
  const aktif=eczList.filter(e=>e.toplam>0).length,buyuyen=eczList.filter(e=>e.subat>e.ocak).length;
  document.getElementById('eczaneSummaryCards').innerHTML=[
    {icon:'🏥',label:'Toplam Eczane',val:eczList.length,color:'var(--c1)'},
    {icon:'✅',label:'Aktif Eczane',val:aktif,color:'#16A34A'},
    {icon:'📦',label:'Toplam Adet',val:fK(totAdet),color:'#0891B2'},
    {icon:'💰',label:'Toplam Tutar',val:fTL(totTutar),color:'#521FD1'},
    {icon:'📈',label:'Büyüyen Eczane',val:buyuyen,color:'#D97706'},
  ].map(c=>'<div style="background:#fff;border:1px solid var(--border);border-radius:9px;padding:10px 12px;text-align:center"><div style="font-size:16px">'+c.icon+'</div><div style="font-size:18px;font-weight:800;color:'+c.color+'">'+c.val+'</div><div style="font-size:9px;color:var(--dim);font-weight:600;text-transform:uppercase;margin-top:2px">'+c.label+'</div></div>').join('');
  _eczaneData=eczList;document.getElementById('eczaneTblBadge').textContent=eczList.length+' eczane';
  renderEczaneTable(eczList);renderEczaneCharts(filtered,eczList);
}

function filterEczaneTable(){_eczaneSearchFilter=(document.getElementById('eczaneSearch')?.value||'').toLowerCase();renderEczaneTable(_eczaneData);}
function sortEczane(key){if(eczaneSortKey===key) eczaneSortAsc=!eczaneSortAsc; else{eczaneSortKey=key;eczaneSortAsc=false;}renderEczaneTable(_eczaneData);}

function renderEczaneTable(data){
  let list=_eczaneSearchFilter?data.filter(e=>e.ad.toLowerCase().includes(_eczaneSearchFilter)||e.brick.toLowerCase().includes(_eczaneSearchFilter)||e.gln.includes(_eczaneSearchFilter)):[...data];
  list.sort((a,b)=>{let av=a[eczaneSortKey]||0,bv=b[eczaneSortKey]||0;if(typeof av==='string'){av=av.toLowerCase();bv=(bv||'').toLowerCase();}return eczaneSortAsc?(av>bv?1:-1):(av<bv?1:-1);});
  const MAX_ROWS=200,shown=list.slice(0,MAX_ROWS);
  document.getElementById('eczaneTblBadge').textContent=list.length+' eczane'+(list.length>MAX_ROWS?' (ilk '+MAX_ROWS+' gösteriliyor)':'');
  const _aylar=[...new Set(data.flatMap(e=>Object.keys(e).filter(k=>k.startsWith('ay_')).map(k=>k.slice(3))))].sort();
  const _AY_K={'01/2026':'Oca','02/2026':'Şub','03/2026':'Mar','04/2026':'Nis','05/2026':'May','06/2026':'Haz','07/2026':'Tem','08/2026':'Ağu','09/2026':'Eyl','10/2026':'Eki','11/2026':'Kas','12/2026':'Ara'};
  const theadEl=document.getElementById('eczaneThead');
  if(theadEl&&_aylar.length>0) theadEl.innerHTML='<th onclick="sortEczane(\'ad\')" style="cursor:pointer">Eczane ▾</th><th onclick="sortEczane(\'brick\')" style="cursor:pointer">Brick ▾</th>'+_aylar.map(a=>'<th onclick="sortEczane(\'ay_'+a+'\')" style="cursor:pointer">'+(_AY_K[a]||a)+' ▾</th>').join('')+'<th onclick="sortEczane(\'toplam\')" style="cursor:pointer">Toplam ▾</th><th onclick="sortEczane(\'tutar\')" style="cursor:pointer">Tutar ▾</th><th>Ürünler</th>';
  const sonAy=_aylar[_aylar.length-1];
  document.getElementById('eczaneTbody').innerHTML=shown.map(e=>{
    const urunBadges=e.uruns.map(u=>'<span style="background:'+(URUN_CLR[u]||'#64748B')+'22;color:'+(URUN_CLR[u]||'#64748B')+';border-radius:3px;padding:1px 5px;font-size:8px;font-weight:700">'+u+'</span>').join(' ');
    const ayTds=_aylar.map(a=>{const v=e['ay_'+a]||0;return'<td class="mono" style="'+(v>0?(a===sonAy?'font-weight:700':''):'color:#A0AEC0')+'">'+(v>0?fK(v):'—')+'</td>';}).join('');
    return'<tr><td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+e.ad+'">'+e.ad+'</td><td style="font-size:10px;color:var(--dim)">'+e.brick+'</td>'+ayTds+'<td class="mono" style="font-weight:700;color:var(--c1)">'+(e.toplam>0?fK(e.toplam):'—')+'</td><td class="mono" style="font-size:10px">'+(e.tutar>0?fTL(e.tutar):'—')+'</td><td>'+urunBadges+'</td></tr>';
  }).join('');
}

function renderEczaneCharts(filtered,eczList){
  const brickMap={};filtered.forEach(r=>{if(!brickMap[r.brick])brickMap[r.brick]=0;brickMap[r.brick]+=r.adet;});
  const brickSorted=Object.entries(brickMap).sort((a,b)=>b[1]-a[1]).slice(0,12);
  setTimeout(()=>{
    mkChart('eczaneBrickChart','bar',{labels:brickSorted.map(([b])=>b.length>16?b.substr(0,16)+'...':b),datasets:[{label:'Satış Adet',data:brickSorted.map(([,v])=>v),backgroundColor:'#4F008C44',borderColor:'#4F008C',borderWidth:2,borderRadius:4}]},{plugins:{title:{display:true,text:'Brick Bazlı Satış',font:{size:11}}},scales:{y:{ticks:{callback:v=>fK(v)}},x:{ticks:{font:{size:8},maxRotation:45}}}});
    const urunMap={};filtered.forEach(r=>{urunMap[r.urun]=(urunMap[r.urun]||0)+r.adet;});
    const urunEntries=Object.entries(urunMap).sort((a,b)=>b[1]-a[1]);
    mkChart('eczaneUrunChart','doughnut',{labels:urunEntries.map(([u])=>u),datasets:[{data:urunEntries.map(([,v])=>v),backgroundColor:urunEntries.map(([u])=>(URUN_CLR[u]||'#64748B')+'cc'),borderColor:urunEntries.map(([u])=>URUN_CLR[u]||'#64748B'),borderWidth:2}]},{plugins:{legend:{position:'bottom',labels:{font:{size:10}}},title:{display:true,text:'Ürün Dağılımı',font:{size:11}}}});
  },50);
}

// ── INIT ─────────────────────────────────────────────────────
const GS_IMS_URL='https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/IMS_TABLO.csv';
const GS_GENEL_URL='https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/GENEL_TABLO.csv';
const GS_ECZANE_URL='https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/ECZANE.csv';
const GITHUB_IMG_BASE='https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/images/';

async function initApp(){
  const loadMsg=document.getElementById('loadMsg'),loadDiv=document.getElementById('loading');
  try{
    if(loadMsg) loadMsg.textContent='⏳ Veriler yükleniyor…';
    await syncData();
    if(loadDiv) loadDiv.style.display='none';
  }catch(err){
    if(loadMsg){loadMsg.textContent='❌ CSV dosyaları yüklenemedi. GitHub reposunu kontrol edin.';loadMsg.style.color='#DC2626';loadMsg.style.maxWidth='320px';loadMsg.style.textAlign='center';}
    console.error('[initApp]',err);
    if(loadDiv){const btn=document.createElement('button');btn.textContent='🔄 Yeniden Dene';btn.style.cssText='margin-top:16px;padding:10px 24px;background:#4F008C;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif';btn.onclick=()=>location.reload();loadDiv.appendChild(btn);}
  }
}

window.addEventListener('DOMContentLoaded',()=>{
  const loadDiv=document.getElementById('loading');
  if(loadDiv) loadDiv.style.display='none';
  const loginInput=document.getElementById('loginUser');
  if(loginInput) loginInput.focus();
  window.addEventListener('resize',()=>{if(window.innerWidth>1024) closeSidebar();});
  if(window._pendingLogin){window._pendingLogin=false;initApp();}
});

// Helper: mg2 temsilci seçimi (onclick string kısıtlaması nedeniyle ayrı fonksiyon)
function selMg2Ttt(p){mg2_ttt=p;mg2_brick='TÜMÜ';initMigi2();}
