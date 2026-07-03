# PHASE 3.0.2 — AI PAGE DOM VALIDATION REPORT

## 1. MISSING ELEMENT IDs

| ID | Used In | File | Line | DOM Definition | Status |
|----|---------|------|------|----------------|--------|
| `aiTttBar` | `renderAiAsistan()` | `index.html` | 443 | **ABSENT** | 🔴 CRASH |
| `proxyStatus` | `testProxy()` | `index.html` | 499, 522, 530 | **ABSENT** | 🟠 CRASH (on user action) |

All other IDs used by the 4 target functions exist in DOM:

| ID | Function | Status |
|----|----------|--------|
| `engineTttBar` | `renderEngine` | ✅ EXISTS + null guard |
| `emv_ttt`, `emv_real`, `emv_gun`, `emv_kalan`, `emv_donem` | `renderEngine` | ✅ ALL EXIST |
| `engineTttBadge` | `renderEngine` | ✅ EXISTS |
| `engineRunBtn` | `runEngine` | ✅ EXISTS |
| `engineOutput`, `engineEmpty` | `_runEngineCore` | ✅ EXIST |
| `engineTaskGrid`, `engineRisks`, `engineOpps` | `_runEngineCore` | ✅ EXIST |
| `engineTimeline`, `engineWeekBadge` | `_runEngineCore` | ✅ EXIST |
| `enginePrimPanel`, `enginePrimBadge` | `_runEngineCore` | ✅ EXIST |
| `engineAiChatArea`, `engineAiOutput` | `renderEngine` | ✅ EXIST |
| `taskDateBadge` | `_runEngineCore` | ✅ EXISTS |
| `aiTab_motor`, `aiTab_chat`, `aiTab_quick` | `switchAiTab` | ✅ EXIST |
| `tab_motor`, `tab_chat`, `tab_quick` | `switchAiTab` | ✅ EXIST |

---

## 2. ROOT CAUSE ANALYSIS

### BUG-1 (Primary — The Reported Crash)
```
renderAiAsistan() → getElementById('aiTttBar') → null → .innerHTML = ... → TypeError
```

**Cause:** During Phase 2.x HTML restructuring, `aiTttBar` was removed from `page5`. The single TTT selection bar was consolidated into `engineTttBar` (inside the "Temsilci Seç" card), which is now populated by `renderEngine()`. The legacy `aiTttBar` write in `renderAiAsistan()` was not removed and now crashes unconditionally every time page 5 is opened.

**Nature:** The `aiTttBar` block in `renderAiAsistan()` is now redundant — `renderEngine()` (called two lines above) already writes the same TTT button list to `engineTttBar`. The crash fires on every `goPage(5)` call.

### BUG-2 (Secondary — Latent Crash)
```
testProxy() → getElementById('proxyStatus') → null → .textContent = ... → TypeError
```

**Cause:** `proxyStatus` element is missing from the proxy card in `aiTab_quick`. The card HTML contains `proxyUrlInput` and `proxyInstructions` but no `proxyStatus` badge. `updateProxyStatus()` already has a null guard (`if (!el) return;`), but `testProxy()` does not — it calls `.textContent` directly on the null reference, and also writes `.style.background` and `.style.color` inside the try/catch blocks.

**Trigger:** Only fires when user opens proxySetupCard (hidden by default) and clicks "Test Et".

---

## 3. RENAMED ELEMENT DETECTION (Phase 2.x)

During Phase 2.x, `aiTttBar` was **renamed/replaced** by `engineTttBar`. Evidence:

- `aiTttBar` appears only in JS (line 443), never in HTML → it was a pre-Phase-2 element ID.
- `engineTttBar` exists in HTML (line 4528) with class `engine-ttt-bar`, populated by `renderEngine()`.
- `renderEngine()` in `ai-engine.js` already has a null guard: `if (!bar) return;` — defensive code added anticipating this extraction.
- The comment block at index.html line 3821 explicitly documents: `renderEngine`'da `selAiTTT←→engineSelTTT` synchronization — confirming the bar was unified.

---

## 4. RENDER SEQUENCE ANALYSIS

```
goPage(5)
  └─ renderAiAsistan()          ← called synchronously
       ├─ renderEngine()
       │    └─ getElementById('engineTttBar')  ← page5 is in static HTML, always in DOM ✅
       │    └─ getElementById('emv_*')         ← same, always in DOM ✅
       └─ getElementById('aiTttBar')           ← DOES NOT EXIST → CRASH ❌
```

**No async/lifecycle issue.** All page5 elements are in static HTML — they exist in DOM regardless of whether the `.page` div has the `active` class. The crash is purely a missing element ID, not a timing issue.

`switchAiTab()` is called before `renderEngine()` and is safe — it only reads `aiTab_*` and `tab_*` IDs which all exist, and already has per-element null guards.

---

## 5. INVALID SELECTORS

None detected. All `getElementById` calls in the 4 target functions use valid string literals. No dynamic ID construction that could produce invalid selectors.

---

## 6. PATCH APPLIED (index_patched.html)

### FIX-1 — `renderAiAsistan()` · index.html line 443
**BEFORE:**
```js
const aiAll = ['ŞENOL YILMAZ', ...allTTTs];
document.getElementById('aiTttBar').innerHTML = aiAll.map(t =>
  `<button class="sp-btn${t===selAiTTT?' active':''}" onclick="setAiTTT('${t}')">${t==='ŞENOL YILMAZ'?'🏢 '+t:t}</button>`
).join('');
```
**AFTER:**
```js
// PATCH-3.0.2-FIX1: aiTttBar was removed from DOM during Phase 2.x extraction.
// engineTttBar (populated by renderEngine() above) is now the authoritative TTT bar.
// Guard retained to prevent crash if element is re-added in future.
const aiAll = ['ŞENOL YILMAZ', ...allTTTs];
const _aiTttBar = document.getElementById('aiTttBar');
if (_aiTttBar) {
  _aiTttBar.innerHTML = aiAll.map(t =>
    `<button class="sp-btn${t===selAiTTT?' active':''}" onclick="setAiTTT('${t}')">${t==='ŞENOL YILMAZ'?'🏢 '+t:t}</button>`
  ).join('');
}
```

### FIX-2 — `testProxy()` · index.html lines 499, 522–524, 530–532
**BEFORE:**
```js
const statusEl = document.getElementById('proxyStatus');
statusEl.textContent = '⏳ Test...';
// ... try block:
statusEl.textContent = '✅ Bağlandı!';
statusEl.style.background = '#16A34A';
statusEl.style.color = '#fff';
// ... catch block:
statusEl.textContent = '❌ Bağlanamadı';
statusEl.style.background = '#DC2626';
statusEl.style.color = '#fff';
```
**AFTER:**
```js
// PATCH-3.0.2-FIX2: proxyStatus missing from DOM — guard prevents crash.
const statusEl = document.getElementById('proxyStatus');
if (statusEl) statusEl.textContent = '⏳ Test...';
// ... try block:
if (statusEl) { statusEl.textContent = '✅ Bağlandı!'; statusEl.style.background = '#16A34A'; statusEl.style.color = '#fff'; }
// ... catch block:
if (statusEl) { statusEl.textContent = '❌ Bağlanamadı'; statusEl.style.background = '#DC2626'; statusEl.style.color = '#fff'; }
```

---

## 7. RECOMMENDED FOLLOW-UP (not applied — out of scope)

- **Add `id="proxyStatus"` to the proxy card HTML** (inside `proxySetupCard`, alongside `proxyUrlInput`) to restore proxy status display functionality. Currently the status is silently swallowed by the guard.
- **Remove the `aiTttBar` block from `renderAiAsistan()`** entirely in a future cleanup — it is dead code since `renderEngine()` handles the TTT bar. The guard prevents the crash but the block serves no purpose.
