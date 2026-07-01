// ══════════════════════════════════════════════════════════════════════
//  SAMSUN 2D PORTAL  ·  ai-context.js
//  Phase 2.0 extraction — index.html L507-685, L1468-1515
//
//  Sorumluluk:
//    • buildTTTContext(ttt)    — temsilci satış/IMS/brick özeti
//    • buildEczaneContext(ttt) — eczane satış özeti
//    • aiQuick(type)           — hızlı analiz tetikleyici
//
//  Global bağımlılıklar (index.html scope'tan okur, değiştirmez):
//    Veri    : GENEL, IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded
//    Sabitler: OWN_IMS, IMS_TL_MAP, OWN_DRUG_BY_GRP, GRP_LBL
//              URUN_ORDER, TR_SIRA_MAP, PERIODS, GS_ECZANE_URL
//    Utils   : workDays(), fK(), fTL(), parseEczaneCSV()
//    AI      : sendAiMsgWithText(), switchAiTab()
//
//  Yükleme sırası: constants.js, math-utils.js, date-utils.js SONRASI
//                  ai-service.js ÖNCESI
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded */
/* global OWN_IMS, IMS_TL_MAP, OWN_DRUG_BY_GRP, GRP_LBL, URUN_ORDER */
/* global TR_SIRA_MAP, PERIODS, GS_ECZANE_URL */
/* global workDays, fK, fTL, parseEczaneCSV, sendAiMsgWithText, switchAiTab */

function buildTTTContext(ttt) {
  // Temsilci verilerini özet olarak hazırla
  const genelRows = GENEL.filter(r=>r.ttt===ttt&&r.urun!=='GENEL TOPLAM');
  const genelTotal = GENEL.find(r=>r.ttt===ttt&&r.urun==='GENEL TOPLAM');
  // MI&GI brick verisini MIGI_BRICK_TL_RAW'dan derle
  const _mgSrc2 = (MIGI_BRICK_TL_RAW||[]).filter(r=>r.person===ttt);
  const _mgMap2 = {};
  _mgSrc2.forEach(r=>{ const k=r.brick; if(!_mgMap2[k]) _mgMap2[k]={brick:k,sira:r.sira,mi:[],gi:[]}; if(r.mi!=null) _mgMap2[k].mi.push(r.mi); if(r.bi!=null) _mgMap2[k].gi.push(r.bi); });
  const migiRows = Object.values(_mgMap2).map(b=>({brick:b.brick,sira:b.sira,ttt,mi:b.mi.length?b.mi.reduce((s,v)=>s+v,0)/b.mi.length:null,gi:b.gi.length?b.gi.reduce((s,v)=>s+v,0)/b.gi.length:null,panocer_mi:b.mi.length?b.mi[b.mi.length-1]:0})).filter(b=>b.sira);
  const top333 = migiRows.filter(r=>r.sira<=333);
  const trSira = TR_SIRA_MAP[ttt] || '?';

  // Dönem hesaplamaları
  const _now2 = new Date();
  const _pad2 = n => String(n).padStart(2,'0');
  const _todayStr2 = `${_now2.getFullYear()}-${_pad2(_now2.getMonth()+1)}-${_pad2(_now2.getDate())}`;
  const _curPeriod = PERIODS.find(p => _todayStr2 >= p.start && _todayStr2 <= p.end);
  const _remDays2  = _curPeriod ? workDays(_todayStr2, _curPeriod.end) : 0;
  const _totDays   = _curPeriod ? workDays(_curPeriod.start, _curPeriod.end) : 0;
  const _passedDays = Math.max(1, _totDays - _remDays2);

  // Projeksiyon hesabı — günlük run-rate × toplam dönem günü
  const _satisNow   = genelTotal?.satis_tl || 0;
  const _hedefTL    = genelTotal?.hedef_tl  || 0;
  const _runRateGunluk = _passedDays > 0 ? _satisNow / _passedDays : 0;
  const _projEOD    = Math.round(_runRateGunluk * _totDays); // dönem sonu tahmini (mevcut ivmeyle)
  const _projPct    = _hedefTL > 0 ? (_projEOD / _hedefTL * 100).toFixed(1) : '—';
  const _gunlukIhtiyac = _remDays2 > 0 ? Math.round((Math.max(0, _hedefTL * 0.91 - _satisNow)) / _remDays2) : 0;
  const _kalanGap91  = Math.max(0, _hedefTL * 0.91 - _satisNow);
  const _ihtiyacMevcut = _runRateGunluk > 0 ? (_gunlukIhtiyac / _runRateGunluk).toFixed(2) : '—';

  // Senaryo modeli
  const _senIyi    = Math.round(_satisNow + _runRateGunluk * 1.20 * _remDays2); // +%20 ivme artışı
  const _senOrta   = Math.round(_satisNow + _runRateGunluk * _remDays2);        // mevcut ivme
  const _senKotu   = Math.round(_satisNow + _runRateGunluk * 0.80 * _remDays2); // -%20 düşüş
  const _senIyiPct   = _hedefTL > 0 ? (_senIyi  /_hedefTL*100).toFixed(1) : '—';
  const _senOrtaPct  = _hedefTL > 0 ? (_senOrta /_hedefTL*100).toFixed(1) : '—';
  const _senKotuPct  = _hedefTL > 0 ? (_senKotu /_hedefTL*100).toFixed(1) : '—';

  let ctx = `=== SAMSUN 2D SATIŞ VERİLERİ ===
Temsilci: ${ttt} | TR Sırası: #${trSira}
Dönem: ${_curPeriod ? _curPeriod.label + ' (' + _curPeriod.months + ')' : '2026 Dönemi'}
Dönem aralığı: ${_curPeriod ? _curPeriod.start + ' → ' + _curPeriod.end : '—'}
Geçen iş günü: ${_passedDays} | Kalan iş günü: ${_remDays2} | Toplam: ${_totDays}

--- GENEL PERFORMANS (ANLИК) ---
Anlık Gerçekleşme: %${genelTotal?.tl_pct?.toFixed(2)||0}
Hedef TL: ${(_hedefTL||0).toLocaleString('tr-TR',{maximumFractionDigits:0})} ₺
Satış TL (bugüne kadar): ${(_satisNow||0).toLocaleString('tr-TR',{maximumFractionDigits:0})} ₺
Kalan TL: ${(genelTotal?.kalan_tl||0).toLocaleString('tr-TR',{maximumFractionDigits:0})} ₺

--- PROJEKSİYON ANALİZİ (ÖNEMLİ) ---
⚠️ ANLİK realizasyon dönem bitmeden değerlendirilemez. Aşağıdaki proyeksiyonları kullan:
Günlük satış ortalaması (run-rate): ${Math.round(_runRateGunluk).toLocaleString('tr-TR')} ₺/gün
Mevcut ivmeyle dönem sonu tahmini: ${_projEOD.toLocaleString('tr-TR')} ₺ → %${_projPct}
%91 hedefi için günlük ihtiyaç: ${_gunlukIhtiyac.toLocaleString('tr-TR')} ₺/gün
Mevcut oran/ihtiyaç oranı: ${_ihtiyacMevcut}x (1.0x = hedef rotasında, >1.0x = hedef aşılıyor)

DÖNEM SONU SENARYOLARI:
• İyi senaryo (+%20 ivme): ${_senIyi.toLocaleString('tr-TR')} ₺ → %${_senIyiPct}
• Baz senaryo (mevcut ivme): ${_senOrta.toLocaleString('tr-TR')} ₺ → %${_senOrtaPct}
• Kötü senaryo (-%20 ivme): ${_senKotu.toLocaleString('tr-TR')} ₺ → %${_senKotuPct}
%91 için kalan gap: ${Math.round(_kalanGap91).toLocaleString('tr-TR')} ₺ (${_remDays2} günde kapatılmalı)

--- ÜRÜN BAZLI PERFORMANS ---`;
  genelRows.forEach(r=>{
    ctx += `
${r.urun}: %${r.tl_pct?.toFixed(1)||0} (Hedef: ${(r.hedef_tl/1000).toFixed(0)}K, Satış: ${(r.satis_tl/1000).toFixed(0)}K)`;
  });

  // IMS pazar & rakip — ayrıntılı brick bazlı analiz
  if (IMS && IMS.length) {
    const imsGrps = [...new Set(IMS.filter(r=>r.ttt===ttt).map(r=>r.ilac_grubu))];
    if (imsGrps.length) {
      ctx += '\n\n--- PAZAR & RAKİP ANALİZİ (IMS) ---';
      imsGrps.forEach(grp => {
        const mktRows  = IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&r.is_mkt);
        const ownKey   = OWN_IMS[grp];
        const ownRows  = IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&r.ilac===ownKey);
        const allRows  = IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&!r.is_mkt);
        if (!ownRows.length && !mktRows.length) return;
        const ownTot   = ownRows.reduce((s,r)=>s+r.toplam,0);
        const mktTot   = mktRows.reduce((s,r)=>s+r.toplam,0);
        const ppi      = mktTot>0 ? (ownTot/mktTot*100).toFixed(1) : '—';
        const lbl      = GRP_LBL[grp]||grp;
        const imsPrice = IMS_TL_MAP[Object.values(OWN_DRUG_BY_GRP).find(o=>o.ilac_grubu===grp||OWN_IMS[grp]===o.ownIlac)?.urun||''] || 0;
        // Gerçek IMS fiyatı — ürün adına göre bul
        const ownUrunName = Object.entries(OWN_DRUG_BY_GRP).find(([g])=>g===grp)?.[1]?.urun || '';
        const imsFiyat = IMS_TL_MAP[ownUrunName] || 0;
        // Son 3 hafta trendi
        const wkKeys   = ['h7','h8','h9'];
        const ownWk3   = wkKeys.map(w=>ownRows.reduce((s,r)=>s+(r[w]||0),0));
        const validWk  = ownWk3.filter(v=>v>0);
        const trend3   = validWk.length>=2?(validWk[validWk.length-1]>validWk[0]?'📈':validWk[validWk.length-1]<validWk[0]?'📉':'→'):'—';
        // Güçlü rakipler
        const rivals   = IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&!r.is_mkt&&r.ilac!==ownKey)
                            .sort((a,b)=>b.toplam-a.toplam).slice(0,3);
        ctx += `\n\n[${lbl}] Kendi:${fK(ownTot)} kutu | Pazar:${fK(mktTot)} kutu | Pay:${ppi}% | Trend:${trend3}`;
        if (imsFiyat>0) {
          const hedefKutu = mktTot>0 ? Math.round(mktTot*0.10) : 0; // %10 pay hedefi örnek
          ctx += ` | IMS TL:${imsFiyat}₺/kutu`;
        }
        if (rivals.length) {
          ctx += `\n  Rakipler: ${rivals.map(r=>`${r.ilac}(${fK(r.toplam)},Pay:${mktTot>0?(r.toplam/mktTot*100).toFixed(0):0}%)`).join(' | ')}`;
        }
        // Brick bazlı analiz — rakibin güçlü, bizim zayıf olduğu brickler
        const bricks = [...new Set(allRows.map(r=>r.brick))];
        const riskBricks = [], firsatBricks = [];
        bricks.forEach(brick=>{
          const ownB    = ownRows.filter(r=>r.brick===brick).reduce((s,r)=>s+r.toplam,0);
          const mktB    = mktRows.filter(r=>r.brick===brick).reduce((s,r)=>s+r.toplam,0);
          const topRival= rivals[0] ? IMS.filter(r=>r.ttt===ttt&&r.ilac_grubu===grp&&r.ilac===rivals[0].ilac&&r.brick===brick).reduce((s,r)=>s+r.toplam,0) : 0;
          if (mktB>0) {
            const ppiB = (ownB/mktB*100);
            if (ppiB < 15 && mktB > 500) riskBricks.push({brick,ppiB:ppiB.toFixed(0),mktB,ownB,topRival});
            else if (ppiB > 25 && ownB > 0) firsatBricks.push({brick,ppiB:ppiB.toFixed(0),ownB});
          }
        });
        if (riskBricks.length>0) {
          ctx += `\n  ⚠️ Dikkat Gereken Brickler (pay<%15, pazar>500 kutu):`;
          riskBricks.slice(0,4).forEach(b=>{
            ctx += `\n    - ${b.brick}: Pay=${b.ppiB}%, Pazar=${fK(b.mktB)}, Bizim=${fK(b.ownB)}${b.topRival>0?', Rakip(1):'+fK(b.topRival):''}`;
          });
        }
        if (firsatBricks.length>0) {
          ctx += `\n  🚀 Güçlü Brickler (pay>%25):`;
          firsatBricks.slice(0,3).forEach(b=>{ ctx += `\n    - ${b.brick}: Pay=${b.ppiB}%, Kendi=${fK(b.ownB)}`; });
        }
      });
      // Kalan TL + Hedef kutu hesabı
      ctx += '\n\n--- KALAN HEDEF & IMS TL KUTU HESABI ---';
      const genelRec = GENEL.find(r=>r.ttt===ttt&&r.urun==='GENEL TOPLAM');
      if (genelRec) {
        ctx += `\nKalan TL: ${fTL(genelRec.kalan_tl)} | Gerçekleşme: %${genelRec.tl_pct?.toFixed(1)||0}`;
      }
      URUN_ORDER.forEach(urun=>{
        const r = GENEL.find(g=>g.ttt===ttt&&g.urun===urun);
        if (!r || r.kalan_tl<=0) return;
        const p = IMS_TL_MAP[urun]||0;
        if (p>0) {
          const kalanKutu = Math.round(r.kalan_tl / p);
          ctx += `\n  ${urun}: Kalan ${fTL(r.kalan_tl)} → ${fK(kalanKutu)} kutu gerekli (${p}₺/kutu)`;
        }
      });
    }
  }

  ctx += `

--- BRICK ANALİZİ (MI & GI) ---
Toplam Brick: ${migiRows.length} | İlk 333: ${top333.length}
Risk Brick (MI<90 veya GI<90): ${migiRows.filter(r=>r.mi<90||r.gi<90).length}
Fırsat Brick (İlk333 + MI≥110 + GI≥100): ${migiRows.filter(r=>r.sira<=333&&r.mi>=110&&r.gi>=100).length}`;

  if (top333.length) {
    ctx += '\n\nİlk 333 Brick Durumu:';
    top333.sort((a,b)=>a.sira-b.sira).forEach(r=>{
      ctx += `
  [#${r.sira}] ${r.brick}: MI=${r.mi.toFixed(0)}, GI=${r.gi.toFixed(0)}, PANOCER_MI=${r.panocer_mi.toFixed(0)}`;
    });
  }

  // Eczane verisi (yüklüyse)
  ctx += buildEczaneContext(ttt);

  // Kalan iş günleri — today dahil, lokal saat dilimi
  const _now = new Date();
  const _pad = n => String(n).padStart(2,'0');
  const todayStr = `${_now.getFullYear()}-${_pad(_now.getMonth()+1)}-${_pad(_now.getDate())}`;
  const periodEnd = PERIODS.find(p => todayStr >= p.start && todayStr <= p.end);
  let remainingWorkDays = 0;
  if (periodEnd) {
    // Süre bilgisi artık başlıkta mevcut — sadece ek notlar
    ctx += `\n\n--- SÜRE ÖZETI ---\nBugün: ${todayStr} | Aktif dönem: ${periodEnd.label} | Dönem sonu: ${periodEnd.end}`;
  }

  // Phase 3.0 — Sales Intelligence enrichment
  // buildTTTContext() çıktısına intelligence raporu EKLENİR — mevcut context silinmez.
  try {
    if (typeof buildSalesIntelligence === 'function' &&
        typeof formatIntelligenceForAI === 'function') {
      const _intel = buildSalesIntelligence(ttt);
      ctx += formatIntelligenceForAI(_intel);
    }
  } catch (_e) {
    // Intelligence modülü hata verse bile mevcut context bozulmaz
    console.warn('[ai-context] Intelligence enrichment hata (sessiz):', _e.message);
  }

  // Phase 3.1 — Predictive Forecast enrichment
  // Projeksiyon raporu Intelligence raporunun ARKASINA eklenir.
  // Rollback: bu try bloğunu sil — geri kalan context değişmeden kalır.
  try {
    if (typeof buildProjectionReport === 'function' &&
        typeof formatProjectionForAI  === 'function') {
      const _proj = buildProjectionReport(ttt);
      ctx += formatProjectionForAI(_proj);
    }
  } catch (_e) {
    // Predictive modülü hata verse bile mevcut context bozulmaz
    console.warn('[ai-context] Predictive enrichment hata (sessiz):', _e.message);
  }

  // Phase 3.2 — Smart Target Simulator enrichment
  // Simülasyon raporu Projeksiyon raporunun ARKASINA eklenir.
  // Rollback: bu try bloğunu sil.
  try {
    if (typeof buildFullSimulation === 'function' &&
        typeof formatSimulationForAI === 'function') {
      const _sim = buildFullSimulation(ttt);
      ctx += formatSimulationForAI(_sim);
    }
  } catch (_e) {
    console.warn('[ai-context] Simulator enrichment hata (sessiz):', _e.message);
  }

  // Phase 3.3 — Territory Optimization enrichment
  // Bölge optimizasyon raporu Simülatör raporunun ARKASINA eklenir.
  // Rollback: bu try bloğunu sil.
  try {
    if (typeof buildTerritoryStrategy === 'function' &&
        typeof formatTerritoryForAI  === 'function') {
      const _terr = buildTerritoryStrategy(ttt);
      ctx += formatTerritoryForAI(_terr);
    }
  } catch (_e) {
    console.warn('[ai-context] Territory enrichment hata (sessiz):', _e.message);
  }

  // Phase 3.4 — AI Sales Coach enrichment
  // Koçluk raporu tüm önceki raporların ARKASINA eklenir.
  // Rollback: bu try bloğunu sil.
  try {
    if (typeof buildSalesCoach === 'function' &&
        typeof formatCoachForAI === 'function') {
      const _coach = buildSalesCoach(ttt);
      ctx += formatCoachForAI(_coach);
    }
  } catch (_e) {
    console.warn('[ai-context] Coach enrichment hata (sessiz):', _e.message);
  }

  // Phase 4.1 — Unified Context enrichment blocks
  // Her blok bağımsız try/catch içinde — birinin hata vermesi diğerlerini etkilemez.
  ctx += buildForecastContext(ttt);
  ctx += buildPrimContext(ttt);
  ctx += buildSimulatorContext(ttt);
  ctx += buildTerritoryContext(ttt);

  // Phase 4.2 — AI Memory Layer enrichment
  try {
    if (typeof buildMemoryContext === 'function') ctx += buildMemoryContext(ttt);
  } catch (_me) {
    console.warn('[ai-context] Memory enrichment hata (sessiz):', _me.message);
  }

  // Phase 4.7 — Satış Şartları & Haber Takibi & Sipariş Analizi
  // Rollback: bu try bloğunu sil
  try {
    if (typeof buildSalesConditionsContext === 'function') {
      ctx += buildSalesConditionsContext(ttt);
    }
  } catch (_scErr) {
    console.warn('[ai-context] SalesConditions enrichment hata (sessiz):', _scErr.message);
  }

  return ctx;
}



function buildEczaneContext(ttt) {
  if (!eczaneLoaded || !ECZANE_RAW) {
    // Eczane yüklü değilse AI'a not düş, arka planda yükle
    // HOTFIX: eski tek-dosya ECZANE.csv artık repo'da yok (404) — PHASE 5.2
    // PharmacyDataManager (aylık dosyalar) üzerinden yükle.
    if (!eczaneLoaded) {
      if (window.PharmacyDataManager && typeof window.PharmacyDataManager.loadAll === 'function') {
        window.PharmacyDataManager.loadAll()
          .then(function (rows) {
            ECZANE_RAW = rows;
            eczaneLoaded = true;
            console.log('[ECZANE BG] Loaded:', ECZANE_RAW.length);
          })
          .catch(function (e) { console.warn('[ECZANE BG]', e); });
      } else {
        console.warn('[ECZANE BG] PharmacyDataManager yüklü değil — eczane verisi alınamadı');
      }
    }
    return '\n\n--- ECZANE VERİSİ ---\n(Eczane sayfası henüz yüklenmedi - bir sonraki soruda dahil edilecek)';
  }
  const data = ECZANE_RAW.filter(r=>r.ttt===ttt);
  if (!data.length) return '';

  const eczMap = {};
  data.forEach(r=>{
    if(!eczMap[r.gln]) eczMap[r.gln]={ad:r.ad,brick:r.brick,ocak:0,subat:0,iade:0,uruns:new Set()};
    if(r.ay==='01/2026') eczMap[r.gln].ocak+=r.adet;
    if(r.ay==='02/2026') eczMap[r.gln].subat+=r.adet;
    eczMap[r.gln].iade+=r.iade;
    eczMap[r.gln].uruns.add(r.urun);
  });

  const list = Object.values(eczMap).sort((a,b)=>(b.ocak+b.subat)-(a.ocak+a.subat));
  const top10 = list.slice(0,10);
  const dusen = list.filter(e=>e.subat<e.ocak&&e.subat>0).slice(0,5);
  const sifir = list.filter(e=>e.subat===0&&e.ocak>0).slice(0,5);

  let ctx = `\n\n--- ECZANE SATIŞ VERİSİ (Oca-Şub 2026) ---\nToplam Eczane: ${list.length} | Aktif: ${list.filter(e=>e.ocak+e.subat>0).length}`;
  ctx += `\n\nEn Çok Satan 10 Eczane:`;
  top10.forEach(e=>{ ctx += `\n  ${e.ad} [${e.brick}]: Oca=${e.ocak}, Şub=${e.subat} ${[...e.uruns].join('/')}`; });
  if (dusen.length) {
    ctx += `\n\nDüşüş Gösteren Eczaneler (Şub<Oca):`;
    dusen.forEach(e=>{ ctx += `\n  ${e.ad}: Oca=${e.ocak}→Şub=${e.subat}`; });
  }
  if (sifir.length) {
    ctx += `\n\nŞubatta Alış Yapmayan (Oca Alımlı):`;
    sifir.forEach(e=>{ ctx += `\n  ${e.ad} [${e.brick}]: Oca=${e.ocak}`; });
  }
  return ctx;
}


// ══════════════════════════════════════════════════════════════════════
//  PHASE 4.1 — UNIFIED AI CONTEXT ENGINE
//  Her fonksiyon null-safe: veri yoksa "" döner, asla crash olmaz.
// ══════════════════════════════════════════════════════════════════════

// ── 1. buildForecastContext(ttt) ──────────────────────────────────────
// Forecast Engine çıktısından AI-ready özet üretir.
function buildForecastContext(ttt) {
  try {
    if (!ttt) return '';
    var rr = (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : null;
    var fc = (typeof generateForecast  === 'function') ? generateForecast(ttt)  : null;
    if (!rr && !fc) return '';

    var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    if (!gt) return '';

    var hedefTL   = gt.hedef_tl || 0;
    var satisTL   = gt.satis_tl || 0;
    if (hedefTL === 0 && (gt.tl_pct || 0) > 0 && satisTL > 0) {
      hedefTL = Math.round(satisTL / ((gt.tl_pct || 1) / 100));
    }

    var projReal      = fc ? (fc.projectedReal || 0)      : (rr ? (rr.projectedRealization || 0) : 0);
    var projTL        = fc ? (fc.projectedTL   || 0)      : (rr ? (rr.projectedMonthEnd    || 0) : 0);
    var gap91         = Math.max(0, hedefTL * 0.91 - satisTL);
    var remaining     = rr ? (rr.remainingDays  || 0) : 0;
    var dailyReq      = remaining > 0 ? Math.round(gap91 / remaining) : 0;
    var weeklyReq     = dailyReq * 5;
    var methodology   = fc ? (fc.methodology || '—') : 'Run rate';
    var confidence    = rr ? (rr.confidence  || 0)   : 0;
    var riskLevel     = projReal >= 100 ? 'DÜŞÜK' : projReal >= 91 ? 'ORTA' : 'YÜKSEK';

    var fmt = function (v) { return '₺' + Math.round(v).toLocaleString('tr-TR'); };

    // FIX-CTX-02 (Problem A-01): explicate the gap between current and projected realization.
    // Prevents AI from treating projection as "already achieved" when real < projection.
    var currentReal = hedefTL > 0 ? Math.round((satisTL / hedefTL) * 1000) / 10 : 0;
    var projGap     = Math.round((projReal - currentReal) * 10) / 10;
    var projGapNote = projReal > currentReal
      ? '(tahmini +' + projGap + '% artış bekleniyor — henüz gerçekleşmedi)'
      : projReal < currentReal
        ? '(uyarı: forecast mevcut realizasyonun altında — ivme kaybı var)'
        : '(forecast mevcut realizasyonla aynı)';

    return [
      '',
      '--- FORECAST (Phase 4.1) ---',
      'Mevcut Realizasyon  : %' + currentReal + '  ← şu anki gerçek durum',
      'Tahmini Realizasyon : %' + projReal.toFixed(1) + '  ' + projGapNote,
      'Tahmini TL          : ' + fmt(projTL),
      'Gap (%91 için)      : ' + fmt(gap91),
      'Kalan Gün           : ' + remaining,
      'Günlük Hedef        : ' + fmt(dailyReq),
      'Haftalık Hedef      : ' + fmt(weeklyReq),
      'Risk Seviyesi       : ' + riskLevel,
      'Tahmin Kesinliği    : %' + confidence + ' (metodolojik — hedef başarısı değil)',
      'Metodoloji          : ' + methodology
    ].join('\n');

  } catch (e) {
    console.warn('[ai-context] buildForecastContext hata (sessiz):', e.message);
    return '';
  }
}

// ── 2. buildPrimContext(ttt) ───────────────────────────────────────────
// Prim durumu + %91 için gereken ek satışı özetler.
function buildPrimContext(ttt) {
  try {
    if (!ttt) return '';
    var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    if (!gt) return '';

    var realPct  = gt.tl_pct  || 0;
    var hedefTL  = gt.hedef_tl || 0;
    var satisTL  = gt.satis_tl || 0;
    if (hedefTL === 0 && realPct > 0 && satisTL > 0) hedefTL = Math.round(satisTL / (realPct / 100));

    var gap91    = Math.max(0, hedefTL * 0.91 - satisTL);
    var primPuani = gt.prim_pct || 0;

    // Prim hesabı
    var totalPrim = 0, tlRealPrim = 0, portfoyPrim = 0, migiPrim = 0;
    try {
      if (typeof calcPrimForTTT === 'function') totalPrim = calcPrimForTTT(ttt);
      if (typeof getCarpan === 'function' && realPct >= 91) {
        var carpan = getCarpan(realPct);
        tlRealPrim  = Math.round(carpan * 55000);
        portfoyPrim = (primPuani >= 91) ? Math.round(0.20 * 55000 * carpan) : 0;
      }
      var migiRows = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(function (r) { return r.ttt === ttt; });
      if (migiRows.length && typeof getMiGiKatsayi === 'function') {
        var miAvg = migiRows.reduce(function (s, r) { return s + (r.mi || 100); }, 0) / migiRows.length;
        var giAvg = migiRows.reduce(function (s, r) { return s + (r.gi || 100); }, 0) / migiRows.length;
        migiPrim  = Math.round(getMiGiKatsayi(Math.round(miAvg), Math.round(giAvg)) * 14000);
      }
    } catch (pe) { /* silent */ }

    var fmt = function (v) { return '₺' + Math.round(v).toLocaleString('tr-TR'); };

    return [
      '',
      '--- PRİM (Phase 4.1) ---',
      'TL Real             : %' + realPct.toFixed(1),
      'Portföy Puanı       : ' + (primPuani > 0 ? ('%' + primPuani.toFixed(1)) : 'Hesaplanmadı'),
      'TL Real Primi       : ' + fmt(tlRealPrim),
      'Portföy Primi       : ' + fmt(portfoyPrim),
      'MI&GI Primi         : ' + fmt(migiPrim),
      'Toplam Tahmini Prim : ' + fmt(totalPrim),
      '%91 İçin Kalan      : ' + fmt(gap91)
    ].join('\n');

  } catch (e) {
    console.warn('[ai-context] buildPrimContext hata (sessiz):', e.message);
    return '';
  }
}

// ── 3. buildSimulatorContext(ttt, [simInputs]) ────────────────────────
// Simülasyon sonucunu özetler.
// simInputs = { PANOCER: 300, ACIDPASS: 200 } gibi ek kutu girişleri
function buildSimulatorContext(ttt, simInputs) {
  try {
    if (!ttt) return '';

    // Aktif kullanıcı simülasyonu varsa kullan, yoksa temel simülasyonu çalıştır
    var simData = null;
    if (typeof buildFullSimulation === 'function') {
      try { simData = buildFullSimulation(ttt); } catch (se) { /* silent */ }
    }
    if (!simData) return '';

    var scenarios = simData.simulations || [];
    if (!scenarios.length) return '';

    var lines = [
      '',
      '--- SİMÜLATÖR (Phase 4.1) ---'
    ];

    // Kullanıcı tarafından girilen simülasyon değerleri
    if (simInputs && Object.keys(simInputs).length) {
      lines.push('Kullanıcı Girişi:');
      Object.keys(simInputs).forEach(function (urun) {
        lines.push('  ' + urun + ' +' + simInputs[urun] + ' kutu');
      });
    }

    // Senaryo sonuçları
    scenarios.forEach(function (s) {
      var icon = s.probability >= 80 ? '🟢' : s.probability >= 50 ? '🟡' : '🔴';
      lines.push(icon + ' %' + s.target + ': olasılık %' + s.probability +
        (s.requiredDailySales ? ' | günlük ₺' + s.requiredDailySales.toLocaleString('tr-TR') : ''));
    });

    // Best prim scenario
    if (simData.bestPrim) {
      var bp = simData.bestPrim;
      lines.push('En Karlı Hedef: %' + bp.realization +
        ' → ₺' + bp.prim.toLocaleString('tr-TR') + ' [' + bp.label + ']');
    }

    // Smart insights
    if (simData.smartInsights && simData.smartInsights.length) {
      lines.push('Simülasyon Görüşü: ' + simData.smartInsights[0]);
    }

    return lines.join('\n');

  } catch (e) {
    console.warn('[ai-context] buildSimulatorContext hata (sessiz):', e.message);
    return '';
  }
}

// ── 4. buildTerritoryContext(ttt) ─────────────────────────────────────
// Bölge analizi özetini ekler.
function buildTerritoryContext(ttt) {
  try {
    if (!ttt) return '';
    if (typeof buildTerritoryStrategy !== 'function') return '';

    var terr = buildTerritoryStrategy(ttt);
    if (!terr) return '';

    var lines = [
      '',
      '--- BÖLGE (Phase 4.1) ---'
    ];

    // Risk brickler
    if (terr.rescueBricks && terr.rescueBricks.length) {
      lines.push('Risk Brickler:');
      terr.rescueBricks.slice(0, 3).forEach(function (b) {
        lines.push('  🔴 ' + b.brick + (b.reason ? ': ' + b.reason : ''));
      });
    }

    // Güçlü brickler
    if (terr.topBricks && terr.topBricks.length) {
      lines.push('Güçlü Brickler:');
      terr.topBricks.slice(0, 3).forEach(function (b) {
        lines.push('  🚀 ' + b.brick + (b.reason ? ': ' + b.reason : ''));
      });
    }

    // Büyüme fırsatları
    if (terr.opportunities && terr.opportunities.length) {
      lines.push('Büyüme Fırsatları:');
      terr.opportunities.slice(0, 2).forEach(function (o) {
        lines.push('  💡 ' + o.brick + (o.reason ? ': ' + o.reason : ''));
      });
    }

    // Stratejik öncelikler
    if (terr.strategy && terr.strategy.length) {
      lines.push('Öneri:');
      terr.strategy.slice(0, 2).forEach(function (s) {
        lines.push('  ' + s.action);
      });
    }

    return lines.join('\n');

  } catch (e) {
    console.warn('[ai-context] buildTerritoryContext hata (sessiz):', e.message);
    return '';
  }
}

// ── 5. buildExecutiveContext([ttts]) ──────────────────────────────────
// Ekip geneli yönetici context'i — birden fazla TTT veya tüm ekip.
// Bu fonksiyon hem ŞENOL YILMAZ için hem de ekip genel analizinde kullanılır.
// Phase 4.2: memory context + behavior patterns + learning scores eklendi.
function buildExecutiveContext(ttts) {
  try {
    var lines = [];

    // Executive dashboard raporu
    var executive = (typeof buildExecutiveDashboard === 'function')
      ? buildExecutiveDashboard(ttts) : null;
    if (executive && typeof buildExecutiveReport === 'function') {
      lines.push(buildExecutiveReport(executive));
    }

    // Phase 4.2: her TTT için memory + behavior özeti
    var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);
    if (list.length && typeof buildMemoryContext === 'function') {
      var memLines = [
        '',
        '--- EKİP AI HAFIZASI (Phase 4.2) ---'
      ];
      list.slice(0, 5).forEach(function (ttt) { // ilk 5 temsilci (context uzunluğu)
        var mem = buildMemoryContext(ttt);
        if (mem && mem.trim()) {
          memLines.push('[ ' + ttt.split(' ')[0] + ' ]' + mem.trim());
        }
        // Öğrenme skoru
        if (typeof calculateLearningScore === 'function') {
          var ls = calculateLearningScore(ttt);
          if (ls > 0) memLines.push('  Öğrenme skoru: ' + ls + '/100');
        }
      });
      if (memLines.length > 2) lines.push(memLines.join('\n'));
    }

    return lines.join('\n');

  } catch (e) {
    console.warn('[ai-context] buildExecutiveContext hata (sessiz):', e.message);
    return '';
  }
}

// ── LOGIN ──────────────────────────────────────────────────


// ── aiQuick — hızlı analiz tetikleyici ────────────────────────
// Phase 4.1: artık buildExecutiveContext() ile zenginleştirilmiş context kullanır.
function aiQuick(type) {
  // NOT: "Sohbet" sekmesi kaldırıldı (bkz. UI geçmişi) — yanıt artık
  // Görev Motoru sekmesindeki engineAiChatArea'da gösteriliyor.
  if (typeof switchAiTab === 'function') switchAiTab('motor');
  // Phase 4.2 — strateji tipini kaydet
  try {
    var _aqTTT = (typeof selAiTTT !== 'undefined' ? selAiTTT : '');
    if (typeof recordStrategyCall === 'function') recordStrategyCall(type, _aqTTT);
  } catch (_aqe) { /* silent */ }
  var prompts = {
    genel: 'Bu temsilcinin genel satış durumunu analiz et. Güçlü ve zayıf yönleri, kalan iş günlerine göre acil durumları belirt. Şenol Yılmaz için tüm ekibi değerlendir.',
    risk: 'Bu temsilci için prim riski analizi yap. Kalan iş günü dikkate alarak hangi ürünler %91 hedefin altında, kaç iş günü kaldığı baz alınarak haftalık gereken satışı hesapla.',
    prim: '2026 İLKO prim sistemine göre dönemlik prim beklentisini hesapla. Kalan süre ve mevcut pace dikkate alarak TL Real, Portföy ve MI&GI primlerini değerlendir.',
    brick: 'İlk 333 brick bazında önceliklendirme yap. Kalan iş günü dikkate alarak hangi bricklere önce gitmeli, hangi eczaneler kritik? Somut adresler öner.',
    strateji: 'Kalan iş günlerine göre uygulanabilecek haftalık satış stratejisi öner. Günlük kutu/TL hedefleri ver, brick ve ürün önceliklerini belirt.',
    eczane: 'Bu temsilcinin eczane satış verilerini detaylı analiz et. Şu kuralları uygula:\n1) Her eczane için aylık tüketim ortalaması hesapla. Örnek: Oca=30, Mar=25 ise (Şub atlayan) ortalama=(30+25)/2=27.5 kutu/ay.\n2) Büyük tek alışları tespit et (kampanya). Bir ayda normal tüketimin 3x+ üzerinde alış varsa kampanya olarak işaretle; bir sonraki sipariş 3-6 ay veya daha uzun süre gecikebilir.\n3) Satış şartları: ACİDPASS:10+1,20+3,50+15,100+35 | PANOCER:10+3,30+12,50+25,100+60,165+135 | GRİPORT COLD:5+1,12+3,20+4,50+20,80+40 | MOKSEFEN:5+1,10+3,30+15\n4) Her aktif eczane için: tahmini aylık tüketim, kalan stok tahmini, önerilen sipariş paketi (en uygun satış şartı kombinasyonu), beklenen sipariş zamanı.\n5) Risk: Büyük alış yapıp uzun süre almayacak eczaneleri listele. Fırsat: Düzenli küçük alış yapan ve sipariş zamanı yaklaşan eczaneleri öne çıkar.',
    rakip: 'IMS verilerini kullanarak rakip analizi yap:\n1) Her ilaç grubu için rakip ürünlerin brick bazında pazar paylarını karşılaştır.\n2) Rakibin en güçlü olduğu brickler (bizim payımız <%15, rakip payı >%30) ve orada ne yapılabileceğini öner.\n3) Rakibin zayıf olduğu brickler (rakip payı <%20) ve büyüme fırsatlarını listele.\n4) Son 3 hafta trendine göre rakip büyüyen bricklerde savunma, rakip gerileyen bricklerde saldırı stratejisi öner.\n5) Brick bazında en kritik 5 öncelikli hedefi somut ziyaret planıyla açıkla.'
  };
  var msg = prompts[type] || type;
  sendAiMsgWithText(msg);
}
