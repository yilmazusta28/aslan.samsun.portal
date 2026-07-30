export default {
  async fetch(request, env) {
    const ALLOWED = 'https://yilmazusta28.github.io';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': ALLOWED,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }});
    }

    // ── Rota planı GitHub senkron endpoint'i ───────────────────────────
    // PHARMA VISION > Saha Yönetimi > Ekip Haftalık Rota Planları
    if (url.pathname === '/rota-sync') {
      return handleRotaSync(request, env, ALLOWED);
    }

    // ── BUG DÜZELTMESİ (kod incelemesi bulgusu — bkz. Doküman İnceleme
    // Raporu): index.html dört adet daha worker senkron URL'i tanımlıyor
    // ve ilgili client kodları (saha-gozlem-store.js, sales-conditions.js)
    // bunlara fiilen POST atıyor — ama bu dört endpoint'in HİÇBİRİ eskiden
    // worker.js'de tanımlı DEĞİLDİ. Sonuç: bu istekler eşleşen bir route
    // bulamayıp aşağıdaki "AI proxy" dalına düşüyor, gövdeleri (ör.
    // {kategori, eczane, ttt, ...}) Anthropic'in beklediği {model,
    // messages} şemasına uymadığı için Anthropic 400 hatası döndürüyor,
    // worker bunu DEĞİŞTİRMEDEN ama HTTP 200 ile istemciye iletiyor — bu
    // yüzden istemcideki `if (!res.ok) console.warn(...)` kontrolü hiç
    // tetiklenmiyor ve senkron SESSİZCE başarısız oluyordu. Saha gözlemi,
    // satış şartları ve haber takibi verileri yalnızca tarayıcıdaki
    // IndexedDB/localStorage'da kalıyor, yöneticinin GitHub'daki
    // data/*.json dosyalarına hiç yazılmıyordu.
    if (url.pathname === '/gozlem-sync') {
      return handleAppendSync(request, env, ALLOWED, {
        path: 'data/saha_gozlemleri.json',
        listKey: 'gozlemler',
        requiredFields: ['eczane', 'ttt'],
        commitPrefix: 'gozlem',
      });
    }
    if (url.pathname === '/stok-sync') {
      return handleAppendSync(request, env, ALLOWED, {
        path: 'data/stok_girisleri.json',
        listKey: 'girisler',
        requiredFields: ['pharmacy'],
        commitPrefix: 'stok',
      });
    }
    if (url.pathname === '/sartlar-sync') {
      return handleOverwriteSync(request, env, ALLOWED, {
        path: 'data/satis_sartlari.json',
        commitPrefix: 'sartlar',
      });
    }
    if (url.pathname === '/haber-sync') {
      return handleOverwriteSync(request, env, ALLOWED, {
        path: 'data/piyasa_haberleri.json',
        commitPrefix: 'haber',
      });
    }

    // ── MEVCUT: AI (Claude API) proxy mantığı — DEĞİŞTİRİLMEDİ ────────
    const body = await request.json();
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED,
      }
    });
  }
};

// ── Ortak: GitHub Contents API'den mevcut dosyayı oku ────────────────────
async function _ghReadJson(apiBase, branch, ghHeaders, fallback) {
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (getRes.status === 200) {
    const meta = await getRes.json();
    const decoded = atob((meta.content || '').replace(/\n/g, ''));
    try {
      return { data: JSON.parse(decoded), sha: meta.sha };
    } catch (e) {
      return { data: fallback, sha: meta.sha };
    }
  }
  if (getRes.status === 404) {
    return { data: fallback, sha: null };
  }
  throw new Error('github read failed: ' + getRes.status);
}

// ── Ortak: GitHub Contents API'ye yaz (409 çakışmasında bir kez retry) ──
async function _ghWriteJson(apiBase, branch, ghHeaders, content, sha, message, retryOnConflict) {
  const newContentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  let putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: newContentB64, branch, ...(sha ? { sha } : {}) }),
  });

  if (putRes.status === 409 && retryOnConflict) {
    const { data: freshData, sha: freshSha } = await retryOnConflict();
    const retryB64 = btoa(unescape(encodeURIComponent(JSON.stringify(freshData, null, 2))));
    putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message + ' (retry)', content: retryB64, branch, sha: freshSha }),
    });
  }
  return putRes;
}

function _ghContext(env) {
  const OWNER = 'yilmazusta28';
  const REPO = 'aslan.samsun.portal';
  const BRANCH = 'main';
  return {
    BRANCH,
    ghHeaders: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'pharma-vision-worker',
    },
    apiBaseFor: (path) => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
  };
}

// ── /gozlem-sync ve /stok-sync: kayıt listesine EKLEME (append) ─────────
async function handleAppendSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }
  const missing = (cfg.requiredFields || []).filter((f) => !payload || !payload[f]);
  if (missing.length) {
    return new Response(JSON.stringify({ error: 'eksik alan(lar): ' + missing.join(', ') }), { status: 400, headers: corsHeaders });
  }

  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const fallback = { [cfg.listKey]: [], updatedAt: null };

  try {
    let { data: current, sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, fallback);
    if (!Array.isArray(current[cfg.listKey])) current[cfg.listKey] = [];
    current[cfg.listKey].push(Object.assign({}, payload, { syncedAt: new Date().toISOString() }));
    current.updatedAt = new Date().toISOString();

    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, current, sha,
      `${cfg.commitPrefix}: yeni kayıt eklendi`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, fallback).then(({ data, sha }) => {
        if (!Array.isArray(data[cfg.listKey])) data[cfg.listKey] = [];
        data[cfg.listKey].push(Object.assign({}, payload, { syncedAt: new Date().toISOString() }));
        data.updatedAt = new Date().toISOString();
        return { data, sha };
      })
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: errBody }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── /sartlar-sync ve /haber-sync: dosyanın TAMAMINI üzerine yaz (overwrite) ─
async function handleOverwriteSync(request, env, ALLOWED, cfg) {
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }

  const { BRANCH, ghHeaders, apiBaseFor } = _ghContext(env);
  const apiBase = apiBaseFor(cfg.path);
  const content = Object.assign({}, payload, { updatedAt: new Date().toISOString() });

  try {
    const { sha } = await _ghReadJson(apiBase, BRANCH, ghHeaders, {});
    const putRes = await _ghWriteJson(
      apiBase, BRANCH, ghHeaders, content, sha,
      `${cfg.commitPrefix}: güncellendi`,
      () => _ghReadJson(apiBase, BRANCH, ghHeaders, {}).then(({ sha }) => ({ data: content, sha }))
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return new Response(JSON.stringify({ error: 'github write failed', detail: errBody }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sync failed', detail: e && e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── Rota Senkron: GitHub Contents API ile data/rota_planlari.json güncelle ──
// (DEĞİŞTİRİLMEDİ — orijinal davranış aynen korundu)
async function handleRotaSync(request, env, ALLOWED) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED,
  };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN ortam değişkeni tanımlı değil' }), { status: 500, headers: corsHeaders });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }

  const { representative, weekday, bricks } = payload || {};
  if (!representative || !weekday || !Array.isArray(bricks)) {
    return new Response(JSON.stringify({ error: 'representative, weekday, bricks zorunlu' }), { status: 400, headers: corsHeaders });
  }

  const OWNER = 'yilmazusta28';
  const REPO = 'aslan.samsun.portal';
  const BRANCH = 'main';
  const PATH = 'data/rota_planlari.json';
  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const ghHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'pharma-vision-rota-sync',
  };

  // 1) Mevcut dosyayı oku (SHA gerekli — GitHub PUT için zorunlu)
  let current = { plans: {}, updatedAt: null };
  let sha = null;
  try {
    const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
    if (getRes.status === 200) {
      const meta = await getRes.json();
      sha = meta.sha;
      const decoded = atob((meta.content || '').replace(/\n/g, ''));
      current = JSON.parse(decoded);
      if (!current.plans) current.plans = {};
    } else if (getRes.status !== 404) {
      return new Response(JSON.stringify({ error: 'github read failed', status: getRes.status }), { status: 502, headers: corsHeaders });
    }
  } catch (e) {
    // dosya hiç yok / bozuk → sıfırdan başla
  }

  // 2) Güncelle: plans[representative][weekday] = bricks
  if (!current.plans[representative]) current.plans[representative] = {};
  current.plans[representative][weekday] = bricks;
  current.updatedAt = new Date().toISOString();

  const newContentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(current, null, 2))));

  // 3) GitHub'a yaz (yeni bir commit oluşur)
  let putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `rota: ${representative} gün ${weekday} güncellendi`,
      content: newContentB64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  // 409 çakışma (iki temsilci aynı anda kaydettiyse) → bir kez daha dener
  if (putRes.status === 409) {
    try {
      const retryGet = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
      if (retryGet.status === 200) {
        const meta2 = await retryGet.json();
        const decoded2 = JSON.parse(atob((meta2.content || '').replace(/\n/g, '')));
        if (!decoded2.plans) decoded2.plans = {};
        if (!decoded2.plans[representative]) decoded2.plans[representative] = {};
        decoded2.plans[representative][weekday] = bricks;
        decoded2.updatedAt = new Date().toISOString();
        const retryContentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(decoded2, null, 2))));
        putRes = await fetch(apiBase, {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `rota: ${representative} gün ${weekday} güncellendi (retry)`,
            content: retryContentB64,
            branch: BRANCH,
            sha: meta2.sha,
          }),
        });
      }
    } catch (e) { /* aşağıda genel hata olarak dönecek */ }
  }

  if (!putRes.ok) {
    const errBody = await putRes.text();
    return new Response(JSON.stringify({ error: 'github write failed', detail: errBody }), { status: 502, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
}
