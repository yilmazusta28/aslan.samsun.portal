// ══════════════════════════════════════════════════════════════
//  js/ui/ytd-tl-page.js — "YTD TL" Sayfası (Satış Takibi'nden sonra)
//  Bağımlılık: js/data/ytd-tl-loader.js (YTD_TL_* sabitleri, loadYtdTlData,
//              parseYtdTlCSV), js/core/formatters.js (fTL, fPct)
//  Sorumluluk: Dönem / Ürün / Temsilci filtrelerini çizer ve seçime göre
//              YTD_TL_DATA'dan tabloyu render eder.
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ─── FİLTRE STATE ─────────────────────────────────────────────
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

// ─── FİLTRE BARI ÇİZİMİ ─────────────────────────────────────────
function renderYtdTlFilterBar() {
  const el = document.getElementById('ytdTlFilterBar');
  if (!el) return;

  const periodChips = YTD_TL_PERIOD_ORDER.map(p => {
    const label = YTD_TL_PERIOD_LABELS[p] || p;
    const active = p === ytdTlPeriod ? ' active' : '';
    return `<button class="ytdtl-chip${active}" onclick="selectYtdTlPeriod('${p}')">${label}</button>`;
  }).join('');

  const urunChips = YTD_TL_PRODUCT_KEYS.map(k => {
    const label = YTD_TL_PRODUCT_LABELS[k] || k;
    const active = k === ytdTlUrun ? ' active' : '';
    return `<button class="ytdtl-chip${active}" onclick="selectYtdTlUrun('${k}')">${label}</button>`;
  }).join('');

  const standardChips = YTD_TL_STANDARD_ROWS.map(name => {
    const cls = name === 'ŞENOL YILMAZ' ? 'sel-senol' : 'sel-national';
    return `<button class="ytdtl-chip locked ${cls}" title="Bu satır her filtrede standart olarak gösterilir" disabled>${name} <span class="lock-ic">🔒</span></button>`;
  }).join('');

  const temsilciChips = YTD_TL_TEMSILCILER.map(name => {
    const active = ytdTlSelTemsilci.has(name) ? ' active' : '';
    return `<button class="ytdtl-chip${active}" onclick="toggleYtdTlTemsilci('${name.replace(/'/g, "\\'")}')">${name}</button>`;
  }).join('');

  el.innerHTML = `
    <div class="ytdtl-filter-group">
      <div class="ytdtl-filter-label"><i class="fas fa-calendar-alt"></i> Dönem</div>
      <div class="ytdtl-chip-row">${periodChips}</div>
    </div>
    <div class="ytdtl-filter-group">
      <div class="ytdtl-filter-label"><i class="fas fa-pills"></i> Ürün</div>
      <div class="ytdtl-chip-row">${urunChips}</div>
    </div>
    <div class="ytdtl-filter-group">
      <div class="ytdtl-filter-label"><i class="fas fa-user-tie"></i> Temsilci
        <span style="margin-left:auto;display:flex;gap:8px;font-weight:600;text-transform:none;letter-spacing:0">
          <a href="javascript:void(0)" onclick="ytdTlSelectAllTemsilci()" style="color:var(--c1)">Tümünü Seç</a>
          <a href="javascript:void(0)" onclick="ytdTlClearTemsilci()" style="color:var(--dim)">Temizle</a>
        </span>
      </div>
      <div class="ytdtl-chip-row">${standardChips}${temsilciChips}</div>
    </div>
  `;
}

// ─── FİLTRE OLAYLARI ────────────────────────────────────────────
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

// ─── TABLO ÇİZİMİ ────────────────────────────────────────────────
function renderYtdTlTable() {
  const body  = document.getElementById('ytdTlBody');
  const badge = document.getElementById('ytdTlBadge');
  const summaryEl = document.getElementById('ytdTlSummary');
  if (!body) return;

  if (window.YTD_TL_LOAD_ERROR) {
    const warnEl = document.getElementById('ytdTlWarn');
    if (warnEl) { warnEl.style.display = ''; warnEl.textContent = '⚠️ ' + window.YTD_TL_LOAD_ERROR; }
  } else {
    const warnEl = document.getElementById('ytdTlWarn');
    if (warnEl) warnEl.style.display = 'none';
  }

  if (!window.YTD_TL_DATA) {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--dim);padding:24px">Veriler yükleniyor…</td></tr>';
    if (badge) badge.textContent = '—';
    return;
  }

  const blockRows = window.YTD_TL_DATA.data[ytdTlPeriod] || [];
  const byName = {};
  blockRows.forEach(r => { byName[r.personel] = r.products[ytdTlUrun] || { hedef: 0, satis: 0, real: 0 }; });

  // Görüntülenecek satır sırası: National, Şenol Yılmaz (STANDART) + seçili temsilciler (CSV sırasıyla)
  const order = [
    ...YTD_TL_STANDARD_ROWS,
    ...YTD_TL_TEMSILCILER.filter(n => ytdTlSelTemsilci.has(n))
  ];

  if (badge) badge.textContent = (YTD_TL_PERIOD_LABELS[ytdTlPeriod] || ytdTlPeriod) + ' · ' + (YTD_TL_PRODUCT_LABELS[ytdTlUrun] || ytdTlUrun);

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
      <td>${typeof fTL === 'function' ? fTL(d.hedef) : d.hedef}</td>
      <td>${typeof fTL === 'function' ? fTL(d.satis) : d.satis}</td>
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
        <div class="ytdtl-stat-val">${typeof fTL === 'function' ? fTL(sumHedef) : sumHedef}</div>
      </div>
      <div class="ytdtl-stat">
        <div class="ytdtl-stat-label">Seçili Temsilciler — Satış / Gerç.%</div>
        <div class="ytdtl-stat-val">${typeof fTL === 'function' ? fTL(sumSatis) : sumSatis} <span class="${ytdTlPctClass(pctToplam)}" style="font-size:12px">(${pctToplam.toFixed(1)}%)</span></div>
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
  await loadYtdTlData(false);
  renderYtdTlTable();
}
