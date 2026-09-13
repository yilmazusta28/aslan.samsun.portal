// ══════════════════════════════════════════════════════════════
//  js/ui/tr-sira-panel.js — "Türkiye Geneli TR Sıralaması" paneli
//  "Genel Durum" (page0) sayfasında, mevcut "Ekip Performans Sıralaması"
//  kartının HEMEN ALTINA eklenir (bkz. index.html #anaGenelView).
//  Bağımlılık: js/data/tr-sira-loader.js (TR_SIRA_FULL, loadTrSiraData),
//              js/core/formatters.js (fTL, fPct)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

function renderTrSiraPanel() {
  const body  = document.getElementById('trSiraBody');
  const badge = document.getElementById('trSiraBadge');
  const warn  = document.getElementById('trSiraWarn');
  if (!body) return;

  if (window.TR_SIRA_LOAD_ERROR) {
    if (warn) { warn.style.display = ''; warn.textContent = '⚠️ ' + window.TR_SIRA_LOAD_ERROR; }
  } else if (warn) {
    warn.style.display = 'none';
  }

  const rows = window.TR_SIRA_FULL;
  if (!rows) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--dim);padding:24px">Veriler yükleniyor…</td></tr>';
    if (badge) badge.textContent = '—';
    return;
  }

  // NATIONAL her zaman en üstte sabit; geri kalanı SIRA'ya göre artan.
  const national = rows.filter(r => r.ttt === 'NATIONAL');
  const others = rows.filter(r => r.ttt !== 'NATIONAL').sort((a, b) => (a.sira || 999) - (b.sira || 999));
  const ordered = national.concat(others);

  if (badge) badge.textContent = (others.length) + ' Temsilci · Tüm Bölgeler';

  body.innerHTML = ordered.map(r => {
    const isNational = r.ttt === 'NATIONAL';
    const isSamsun = r.bolge === 'SAMSUN';
    // Samsun ekibinden biriyse (bölge=SAMSUN) satırı vurgula — kullanıcının
    // kendi bölgesini kalabalık listede kolayca fark etmesi için.
    const rowCls = isNational ? 'ytdtl-row-standard' : (isSamsun ? 'trsira-row-samsun' : '');
    const siraTxt = isNational ? '—' : ('#' + r.sira);
    return `<tr class="${rowCls}">
      <td style="font-weight:${isNational ? 800 : 600}">${siraTxt}</td>
      <td style="font-size:11px;${isSamsun ? 'font-weight:700;color:#0891B2' : 'color:var(--dim)'}">${r.bolge}</td>
      <td style="font-weight:${isNational ? 800 : 600}">${r.ttt}</td>
      <td class="mono">${typeof fTL === 'function' ? fTL(r.hedef) : r.hedef}</td>
      <td class="mono" style="font-weight:700">${typeof fTL === 'function' ? fTL(r.satis) : r.satis}</td>
      <td><span class="bdg ${typeof pCls === 'function' ? pCls(r.real) : ''}">${typeof fPct === 'function' ? fPct(r.real) : r.real + '%'}</span></td>
      <td>${typeof fPct === 'function' ? fPct(r.primPuani) : r.primPuani + '%'}</td>
      <td>${typeof fPct === 'function' ? fPct(r.pp) : r.pp + '%'}</td>
    </tr>`;
  }).join('');
}

async function initTrSiraPanel() {
  renderTrSiraPanel(); // "yükleniyor" durumunu anında göster
  await loadTrSiraData(false); // zaten yüklüyse tekrar fetch etmez (cache)
  renderTrSiraPanel();
}
