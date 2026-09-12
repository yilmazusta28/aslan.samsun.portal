// ══════════════════════════════════════════════════════════════
//  js/ui/ytd-tl-page.js — "YTD TL&KUTU" Sayfası (Satış Takibi'nden sonra)
//  Bağımlılık: js/data/ytd-tl-loader.js (YTD_TL_* / YTD_BIRIM_* sabitleri,
//              loadYtdTlData/loadYtdKutuData/loadYtdAllData, parseYtdTlCSV),
//              js/core/formatters.js (fTL, fK, fPct),
//              js/ui/drawer-system.js (toggleMfDrawer/closeMfDrawer)
//
//  Filtre GÖRÜNÜMÜ Eczane Satış sayfasıyla (buildEczaneFilters /
//  _buildEczaneDrawer) AYNI desendir: üstte kompakt "mf-select" kutuları
//  (Birim / Dönem / Ürün / Temsilci) + "Filtrele" butonu → sağdan açılan
//  drawer (.filter-drawer, drawer-group / drawer-btns / drawer-btn-item),
//  altta "Sıfırla" / "Uygula" aksiyonları ve aktif filtre chip satırı.
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ─── FİLTRE STATE ─────────────────────────────────────────────
let ytdTlBirim  = 'TL';     // 'TL' | 'KUTU'
let ytdTlPeriod = 'YTD';
let ytdTlUrun   = 'TOPLAM';
// Varsayılan: 8 temsilcinin tamamı seçili (National & Şenol Yılmaz zaten
// her zaman ayrıca gösterilir, bu sete dahil değildir).
let ytdTlSelTemsilci = new Set(YTD_TL_TEMSILCILER);

// ─── YARDIMCI: gerçekleşme % renk sınıfı ───────────────────────
function ytdTlPctClass(p) {
  if (p >= 95) return 'ytdtl-pct-good';
  if (p >= 80) return 'ytdtl-pct-warn';
  return 'ytdtl-pct-bad';
}

// ─── YARDIMCI: aktif birime göre veri seti / formatter / sütun etiketi ──
function _ytdTlActiveData()   { return ytdTlBirim === 'KUTU' ? window.YTD_KUTU_DATA : window.YTD_TL_DATA; }
function _ytdTlActiveError()  { return ytdTlBirim === 'KUTU' ? window.YTD_KUTU_LOAD_ERROR : window.YTD_TL_LOAD_ERROR; }
function _ytdTlValFmt(n)      { return ytdTlBirim === 'KUTU' ? (typeof fK === 'function' ? fK(n) : n) : (typeof fTL === 'function' ? fTL(n) : n); }
function _ytdTlColLabel()     { return ytdTlBirim === 'KUTU' ? 'Kutu' : 'TL'; }

// ─── ÜST FİLTRE BARI (mf-select kutuları) — Eczane ile aynı desen ───
function _updateYtdTlMfSelects() {
  const birimEl = document.getElementById('ytdTlMfBirimVal');
  if (birimEl) birimEl.textContent = YTD_BIRIM_LABELS[ytdTlBirim] || ytdTlBirim;

  const donemEl = document.getElementById('ytdTlMfDonemVal');
  if (donemEl) donemEl.textContent = YTD_TL_PERIOD_LABELS[ytdTlPeriod] || ytdTlPeriod;

  const urunEl = document.getElementById('ytdTlMfUrunVal');
  if (urunEl) urunEl.textContent = ytdTlUrun === 'TOPLAM' ? 'Tümü' : (YTD_TL_PRODUCT_LABELS[ytdTlUrun] || ytdTlUrun);

  const temsilciEl = document.getElementById('ytdTlMfTemsilciVal');
  if (temsilciEl) {
    const n = ytdTlSelTemsilci.size;
    temsilciEl.textContent = n === YTD_TL_TEMSILCILER.length ? 'Tümü (8)' : (n === 0 ? 'Seçilmedi' : n + ' / 8');
  }

  // active-box vurgusu: varsayılandan farklıysa kutuyu vurgula (Eczane'deki gibi)
  const birimBox = document.getElementById('ytdTlMfBirim');
  if (birimBox) birimBox.classList.toggle('active-box', ytdTlBirim !== 'TL');
  const donemBox = document.getElementById('ytdTlMfDonem');
  if (donemBox) donemBox.classList.toggle('active-box', ytdTlPeriod !== 'YTD');
  const urunBox = document.getElementById('ytdTlMfUrun');
  if (urunBox) urunBox.classList.toggle('active-box', ytdTlUrun !== 'TOPLAM');
  const temsilciBox = document.getElementById('ytdTlMfTemsilci');
  if (temsilciBox) temsilciBox.classList.toggle('active-box', ytdTlSelTemsilci.size !== YTD_TL_TEMSILCILER.length);

  const badge = document.getElementById('ytdTlBadge');
  if (badge) badge.textContent = (YTD_BIRIM_LABELS[ytdTlBirim] || ytdTlBirim) + ' · ' + (YTD_TL_PERIOD_LABELS[ytdTlPeriod] || ytdTlPeriod) + ' · ' + (YTD_TL_PRODUCT_LABELS[ytdTlUrun] || ytdTlUrun);

  // Aktif filtre chip satırı (Eczane'deki #eczaneChips ile aynı desen)
  const chips = document.getElementById('ytdTlChips');
  if (chips) {
    const parts = [];
    if (ytdTlBirim !== 'TL') parts.push(`<div class="filter-chip-tag">📐 ${YTD_BIRIM_LABELS[ytdTlBirim] || ytdTlBirim} <span class="fct-x" onclick="selectYtdTlBirim('TL')">✕</span></div>`);
    if (ytdTlPeriod !== 'YTD') parts.push(`<div class="filter-chip-tag">📅 ${YTD_TL_PERIOD_LABELS[ytdTlPeriod] || ytdTlPeriod} <span class="fct-x" onclick="selectYtdTlPeriod('YTD')">✕</span></div>`);
    if (ytdTlUrun !== 'TOPLAM') parts.push(`<div class="filter-chip-tag">💊 ${YTD_TL_PRODUCT_LABELS[ytdTlUrun] || ytdTlUrun} <span class="fct-x" onclick="selectYtdTlUrun('TOPLAM')">✕</span></div>`);
    if (ytdTlSelTemsilci.size !== YTD_TL_TEMSILCILER.length) parts.push(`<div class="filter-chip-tag">👤 ${ytdTlSelTemsilci.size} / 8 Temsilci <span class="fct-x" onclick="ytdTlSelectAllTemsilci()">✕</span></div>`);
    chips.innerHTML = parts.join('');
    chips.style.display = parts.length ? 'flex' : 'none';
  }

  // Tablo başlıklarını aktif birime göre güncelle
  const hHedef = document.getElementById('ytdTlColHedef');
  const hSatis = document.getElementById('ytdTlColSatis');
  const lbl = _ytdTlColLabel();
  if (hHedef) hHedef.textContent = 'Hedef (' + lbl + ')';
  if (hSatis) hSatis.textContent = 'Satış (' + lbl + ')';
}

// ─── DRAWER İÇERİĞİ (Eczane'nin _buildEczaneDrawer'ıyla aynı iskelet) ───
function _buildYtdTlDrawer() {
  const d = document.getElementById('ytdTlDrawer');
  if (!d) return;

  const birimBtns = YTD_BIRIM_OPTIONS.map(b =>
    `<button class="drawer-btn-item${b === ytdTlBirim ? ' active' : ''}" onclick="selectYtdTlBirim('${b}')">${YTD_BIRIM_LABELS[b] || b}</button>`
  ).join('');

  const donemBtns = YTD_TL_PERIOD_ORDER.map(p =>
    `<button class="drawer-btn-item${p === ytdTlPeriod ? ' active' : ''}" onclick="selectYtdTlPeriod('${p}')">${YTD_TL_PERIOD_LABELS[p] || p}</button>`
  ).join('');

  const urunBtns = YTD_TL_PRODUCT_KEYS.map(k =>
    `<button class="drawer-btn-item${k === ytdTlUrun ? ' active' : ''}" onclick="selectYtdTlUrun('${k}')">${YTD_TL_PRODUCT_LABELS[k] || k}</button>`
  ).join('');

  const standardBtns = YTD_TL_STANDARD_ROWS.map(name =>
    `<button class="drawer-btn-item active" style="opacity:.85;cursor:default;border-style:dashed" disabled title="Her filtrede standart olarak gösterilir">${name} 🔒</button>`
  ).join('');

  const temsilciBtns = YTD_TL_TEMSILCILER.map(name => {
    const esc = name.replace(/'/g, "\\'");
    return `<button class="drawer-btn-item${ytdTlSelTemsilci.has(name) ? ' active' : ''}" onclick="toggleYtdTlTemsilci('${esc}')">${name}</button>`;
  }).join('');

  d.innerHTML = `
    <div class="drawer-title"><i class="fas fa-chart-area"></i> YTD TL&amp;KUTU Filtresi</div>
    <div class="drawer-group">
      <label><i class="fas fa-ruler-combined" style="margin-right:5px"></i>Birim</label>
      <div class="drawer-btns">${birimBtns}</div>
    </div>
    <div class="drawer-group">
      <label><i class="fas fa-calendar" style="margin-right:5px"></i>Dönem</label>
      <div class="drawer-btns">${donemBtns}</div>
    </div>
    <div class="drawer-group">
      <label><i class="fas fa-pills" style="margin-right:5px"></i>Ürün</label>
      <div class="drawer-btns">${urunBtns}</div>
    </div>
    <div class="drawer-group">
      <label><i class="fas fa-user" style="margin-right:5px"></i>Temsilci
        <span style="font-size:9px;opacity:.6;text-transform:none;letter-spacing:0;font-weight:400"> (çoklu seçim — National ve Şenol Yılmaz her zaman gösterilir)</span>
      </label>
      <div class="drawer-btns" style="margin-bottom:6px">${standardBtns}</div>
      <div class="drawer-btns">${temsilciBtns}</div>
      <div style="display:flex;gap:12px;margin-top:8px">
        <a href="javascript:void(0)" onclick="ytdTlSelectAllTemsilci()" style="font-size:10px;font-weight:700;color:var(--c1)">Tümünü Seç</a>
        <a href="javascript:void(0)" onclick="ytdTlClearTemsilci()" style="font-size:10px;font-weight:700;color:var(--dim)">Temizle</a>
      </div>
    </div>
    <div class="drawer-actions">
      <button class="btn-drawer-clear" onclick="ytdTlResetFilters()">Sıfırla</button>
      <button class="btn-drawer-apply" onclick="closeMfDrawer('ytdTlDrawer')">Uygula</button>
    </div>
  `;
}

// ─── FİLTRE ÇUBUĞU + DRAWER'I BİRLİKTE GÜNCELLE ─────────────────
function renderYtdTlFilterBar() {
  _updateYtdTlMfSelects();
  _buildYtdTlDrawer();
}

// ─── FİLTRE OLAYLARI ────────────────────────────────────────────
function selectYtdTlBirim(b) {
  ytdTlBirim = b;
  if (typeof SoundFX !== 'undefined' && SoundFX.secim) { try { SoundFX.secim(); } catch (e) {} }
  renderYtdTlPage();
}
function selectYtdTlPeriod(p) {
  ytdTlPeriod = p;
  if (typeof SoundFX !== 'undefined' && SoundFX.secim) { try { SoundFX.secim(); } catch (e) {} }
  renderYtdTlPage();
}
function selectYtdTlUrun(u) {
  ytdTlUrun = u;
  if (typeof SoundFX !== 'undefined' && SoundFX.secim) { try { SoundFX.secim(); } catch (e) {} }
  renderYtdTlPage();
}
function toggleYtdTlTemsilci(name) {
  if (ytdTlSelTemsilci.has(name)) ytdTlSelTemsilci.delete(name);
  else ytdTlSelTemsilci.add(name);
  renderYtdTlPage();
}
function ytdTlSelectAllTemsilci() {
  ytdTlSelTemsilci = new Set(YTD_TL_TEMSILCILER);
  renderYtdTlPage();
}
function ytdTlClearTemsilci() {
  ytdTlSelTemsilci = new Set();
  renderYtdTlPage();
}
function ytdTlResetFilters() {
  ytdTlBirim = 'TL';
  ytdTlPeriod = 'YTD';
  ytdTlUrun = 'TOPLAM';
  ytdTlSelTemsilci = new Set(YTD_TL_TEMSILCILER);
  renderYtdTlPage();
}

// ─── TABLO ÇİZİMİ ────────────────────────────────────────────────
function renderYtdTlTable() {
  const body = document.getElementById('ytdTlBody');
  const summaryEl = document.getElementById('ytdTlSummary');
  if (!body) return;

  const activeErr = _ytdTlActiveError();
  const warnEl = document.getElementById('ytdTlWarn');
  if (activeErr) {
    if (warnEl) { warnEl.style.display = ''; warnEl.textContent = '⚠️ ' + activeErr; }
  } else if (warnEl) {
    warnEl.style.display = 'none';
  }

  const activeData = _ytdTlActiveData();
  if (!activeData) {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--dim);padding:24px">Veriler yükleniyor…</td></tr>';
    return;
  }

  const blockRows = activeData.data[ytdTlPeriod] || [];
  const byName = {};
  blockRows.forEach(r => { byName[r.personel] = r.products[ytdTlUrun] || { hedef: 0, satis: 0, real: 0 }; });

  // Görüntülenecek satır sırası: National, Şenol Yılmaz (STANDART) + seçili temsilciler (CSV sırasıyla)
  const order = [
    ...YTD_TL_STANDARD_ROWS,
    ...YTD_TL_TEMSILCILER.filter(n => ytdTlSelTemsilci.has(n))
  ];

  let html = '';
  let sumHedef = 0, sumSatis = 0;
  order.forEach(name => {
    const d = byName[name] || { hedef: 0, satis: 0, real: 0 };
    const isStandard = YTD_TL_STANDARD_ROWS.includes(name);
    const isSenol = name === 'ŞENOL YILMAZ';
    const isNational = name === 'NATIONAL';
    if (!isStandard) { sumHedef += d.hedef; sumSatis += d.satis; }
    const rowCls = isStandard ? 'ytdtl-row-standard' : '';
    const nameBadge = isNational ? '<span class="ytdtl-badge-national" style="padding:2px 8px;border-radius:6px;font-size:10px;margin-left:6px">ULUSAL</span>'
                     : isSenol ? '<span class="ytdtl-badge-senol" style="padding:2px 8px;border-radius:6px;font-size:10px;margin-left:6px">BÖLGE MÜDÜRÜ</span>' : '';
    html += `<tr class="${rowCls}">
      <td style="font-weight:${isStandard ? 800 : 600}">${name}${nameBadge}</td>
      <td>${_ytdTlValFmt(d.hedef)}</td>
      <td>${_ytdTlValFmt(d.satis)}</td>
      <td class="${ytdTlPctClass(d.real)}">${typeof fPct === 'function' ? fPct(d.real) : d.real + '%'}</td>
    </tr>`;
  });

  if (!order.length) {
    html = '<tr><td colspan="4" style="text-align:center;color:var(--dim);padding:24px">Temsilci seçilmedi — yukarıdan en az bir temsilci seçin.</td></tr>';
  }

  body.innerHTML = html;

  // Seçili temsilciler toplamı (National/Şenol hariç) — özet kutuları
  if (summaryEl) {
    const pctToplam = sumHedef > 0 ? (sumSatis / sumHedef * 100) : 0;
    const natD = byName['NATIONAL'] || { hedef: 0, satis: 0, real: 0 };
    const senolD = byName['ŞENOL YILMAZ'] || { hedef: 0, satis: 0, real: 0 };
    summaryEl.innerHTML = `
      <div class="ytdtl-stat">
        <div class="ytdtl-stat-label">National — Gerçekleşme</div>
        <div class="ytdtl-stat-val ${ytdTlPctClass(natD.real)}">${typeof fPct === 'function' ? fPct(natD.real) : natD.real + '%'}</div>
      </div>
      <div class="ytdtl-stat">
        <div class="ytdtl-stat-label">Şenol Yılmaz — Gerçekleşme</div>
        <div class="ytdtl-stat-val ${ytdTlPctClass(senolD.real)}">${typeof fPct === 'function' ? fPct(senolD.real) : senolD.real + '%'}</div>
      </div>
      <div class="ytdtl-stat">
        <div class="ytdtl-stat-label">Seçili Temsilciler — Hedef</div>
        <div class="ytdtl-stat-val">${_ytdTlValFmt(sumHedef)}</div>
      </div>
      <div class="ytdtl-stat">
        <div class="ytdtl-stat-label">Seçili Temsilciler — Satış / Gerç.%</div>
        <div class="ytdtl-stat-val">${_ytdTlValFmt(sumSatis)} <span class="${ytdTlPctClass(pctToplam)}" style="font-size:12px">(${pctToplam.toFixed(1)}%)</span></div>
      </div>
    `;
  }
}

// ─── SAYFA ANA GİRİŞ NOKTASI ────────────────────────────────────
function renderYtdTlPage() {
  renderYtdTlFilterBar();
  renderYtdTlTable();
}

async function initYtdTlPage() {
  renderYtdTlFilterBar();
  renderYtdTlTable(); // "yükleniyor" durumunu anında göster
  await loadYtdAllData(false); // TL + KUTU birlikte yüklenir; birim anında değiştirilebilsin diye
  renderYtdTlTable();
}
