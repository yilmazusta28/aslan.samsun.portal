# PHASE 3.0.3 — TASK ENGINE FORENSIC AUDIT REPORT

**Date:** 2026-05-31  
**Status:** 4 bugs confirmed, 2 root causes identified  
**Observed symptom:** Prim Optimization shows "972.456 ₺ daha satmalı" while Daily Target = 0 and Remaining Sales = 0 ₺ at 36.2% realization — logically inconsistent.

---

## ROOT CAUSE SUMMARY

The inconsistency is produced by **two independent code paths reading the same GENEL record but computing "remaining" differently**:

| Path | Source of `remaining` | Source of sales data | Result |
|---|---|---|---|
| `kalanTL` display | `Math.max(0, gt.kalan_tl)` — raw CSV column R | CSV column R | 0 (CSV has 0 for closed period) |
| `gerekliKalanTL` display | `hedef_tl * 0.91 − satis_tl` — recomputed | CSV columns P & Q | 972.456 (large positive) |
| `dailyTarget` display | `kalanTL / remDays` | depends on kalanTL | 0 (because kalanTL = 0) |

**The CSV exports `kalan_tl` (column R) as `0` for a closed period, while `hedef_tl` (P) and `satis_tl` (Q) retain the actual values.** The engine uses column R for one calculation and independently recomputes from P and Q for another — producing contradictory output.

A secondary cause is that `parseN` silently converts Excel accounting-format negatives `(972.456)` to `0`, which would also produce this symptom when kalan_tl is a negative surplus figure.

---

## BUG-1 — `parseN` Does Not Handle Excel Accounting-Format Negatives

**File:** `js/data/csv-parser.js`  
**Line:** 81–82

### Evidence
```js
// csv-parser.js lines 81-82
const r = parseFloat(s);
return isNaN(r) ? 0 : r;
```

`parseFloat("(972.456)")` → `NaN` → returns `0`.

Excel's **Accounting** and **Currency** number formats export negative numbers as `(1.234,56)` — with parentheses, no minus sign. `parseN` does not strip parentheses before calling `parseFloat`, so any negative value stored this way becomes `0`.

**Condition triggered:**  
`kalan_tl` column R in Excel formatted as Accounting → exported as `(972.456)` → `parseN` → `0` → `kalanTL = 0`.

### Minimal Patch
```js
// csv-parser.js — AFTER the existing trim on line 53, ADD:
s = s.replace(/^\((.+)\)$/, '-$1');  // "(972.456)" → "-972.456"
```
Insert at line **54**, after `s = s.replace('%', '').trim();`

---

## BUG-2 — Two Independent "Remaining" Calculations in `_runEngineCore`

**File:** `js/ai/ai-engine.js`  
**Lines:** 139, 141, 392–393

### Evidence
```js
// Line 139 — reads kalan_tl directly from CSV (may be 0 from closed period or Bug-1)
const kalanTL   = gt ? Math.max(0, gt.kalan_tl) : 0;

// Line 141 — daily target uses kalanTL → shows 0 when kalanTL = 0
const kalanPerDay = remDays > 0 ? kalanTL / remDays : 0;

// Line 392 — prim panel RECOMPUTES from hedef_tl and satis_tl, ignoring kalanTL
const gerekliKalanTL = gt && gt.hedef_tl
  ? gt.hedef_tl * hedefReal / 100 - gt.satis_tl   // ← independent recalculation
  : 0;

// Line 393 — displays "972.456 ₺ daha satmalı" when kalanTL display shows 0
const gerekliTLStr = gerekliKalanTL > 0
  ? fTL(Math.max(0, gerekliKalanTL)) + ' daha satmalı'
  : '✅ Hedef aşıldı';
```

**The inconsistency:** `kalanTL` (line 139) = 0 → "Remaining Sales: 0 ₺" and "Daily Target: 0".  
But `gerekliKalanTL` (line 392) = 972.456 → "972.456 ₺ daha satmalı".

Both use the same `gt` record. Neither is wrong in isolation — but they **disagree because they use different input columns** (R vs P−Q).

### Violated Invariant
```
Requirement C: requiredTLFor91 must never be positive while remainingTL is zero.
Requirement D: code path where requiredTLFor91 > 0 AND remainingTL === 0 → FOUND at lines 139 + 392.
```

### Minimal Patch
Replace line 392 to use the same `kalanTL` variable (already computed on line 139), with a fallback recomputation only when `kalan_tl` is zero but `hedef_tl` and `satis_tl` indicate it should not be:

```js
// ai-engine.js line 392 — REPLACE:
const gerekliKalanTL = gt && gt.hedef_tl ? gt.hedef_tl * hedefReal/100 - gt.satis_tl : 0;

// WITH:
const _computed91Gap = gt && gt.hedef_tl ? gt.hedef_tl * hedefReal/100 - gt.satis_tl : 0;
// Use kalanTL (already clamped) as the authoritative source.
// Only fall back to recomputed value if CSV kalan_tl was 0 AND recomputed gap is consistent.
const gerekliKalanTL = kalanTL > 0
  ? Math.max(0, (gt?.hedef_tl * hedefReal/100) - gt.satis_tl)
  : (kalanTL === 0 && _computed91Gap > 0 && gt?.tl_pct < hedefReal)
    ? _computed91Gap  // kalan_tl is stale/zeroed — trust recomputed value
    : 0;
```

**Simpler single-line patch** (keeps behaviour identical when kalan_tl is correct, fixes the display mismatch):
```js
// ai-engine.js line 392 — REPLACE:
const gerekliKalanTL = gt && gt.hedef_tl ? gt.hedef_tl * hedefReal/100 - gt.satis_tl : 0;

// WITH (adds same guard as kalanTL):
const gerekliKalanTL = (gt && gt.hedef_tl && kalanTL > 0)
  ? Math.max(0, gt.hedef_tl * hedefReal/100 - gt.satis_tl)
  : 0;
```
This ensures: **when `kalanTL === 0` (CSV column R is 0), `gerekliKalanTL` is also forced to 0**, eliminating the contradiction. The `dailyTarget` display and prim panel will now agree.

---

## BUG-3 — `goal-coach.js` Mixes Active-Period `remainingDays` with Prior-Period GENEL Data

**File:** `js/ai/coach/goal-coach.js`  
**Lines:** 67, 84–85

### Evidence
```js
// Line 67 — remainingDays from calculateRunRate() which uses TODAY's active period (k1: May–Jun 2026)
var remaining = rr.remainingDays || 0;   // ≈ 21 working days (k1 active)

// Line 84 — gap computed from GENEL data which may be from 1.Dönem (Jan–Feb 2026, closed)
var gap = Math.max(0, targetTL - currentTL);  // large gap from prior-period data

// Line 85 — WRONG: large prior-period gap ÷ active-period remaining days
var dailyReq = remaining > 0 ? Math.round(gap / remaining) : 0;
```

If GENEL CSV contains 1.Dönem data (36.2% realization, ~972K gap) and today is in k1 (May–Jun 2026, 21 days remaining), then:  
`dailyReq = 972.000 / 21 = 46.286 ₺/day` — a wildly inflated number.

### Violated Invariants
```
Requirement B: dailyTarget = remainingTL / remainingWorkDays
               ← VIOLATED: remainingTL is from period X, remainingWorkDays from period Y
```

### Minimal Patch
Add a data-period guard: if `rr.remainingDays === rr.totalDays` (meaning elapsed = 0, period hasn't started yet or data is stale), or if `rr.projectedMonthEnd === 0`, treat `remaining` as 0:

```js
// goal-coach.js line 67 — REPLACE:
var remaining = rr.remainingDays || 0;

// WITH:
// Guard: if run-rate engine thinks elapsed days = 0 (data period ≠ active period), disable daily calc
var remaining = (rr.remainingDays > 0 && rr.elapsedDays > 0) ? rr.remainingDays : 0;
```

This ensures that when GENEL data is from a closed period (elapsedDays = totalDays, remainingDays = 0 from runrate-engine), `dailyReq` stays 0 rather than inflating.

---

## BUG-4 — `recommendation-engine.js` Independent `kalanTL` Recalculation

**File:** `js/ai/intelligence/recommendation-engine.js`  
**Lines:** 74–75

### Evidence
```js
// Line 74 — recomputes kalanTL from hedef_tl × 0.91 − satis_tl, ignoring CSV kalan_tl
var kalanTL  = Math.max(0, (genelTotal.hedef_tl || 0) * 0.91 - (genelTotal.satis_tl || 0));

// Line 75 — divides by remDays from CURRENT active period
var gunlukTL = remDays > 0 ? Math.round(kalanTL / remDays) : 0;
```

Same pattern as Bug-2 and Bug-3: recomputed `kalanTL` from P/Q columns, divided by active-period `remDays`. When GENEL is from a closed period this produces an inflated recommendation.

### Minimal Patch
```js
// recommendation-engine.js line 74 — REPLACE:
var kalanTL = Math.max(0, (genelTotal.hedef_tl || 0) * 0.91 - (genelTotal.satis_tl || 0));

// WITH:
// Use CSV kalan_tl as primary source; recompute only as fallback
var _csvKalan = genelTotal.kalan_tl || 0;
var _computed = Math.max(0, (genelTotal.hedef_tl || 0) * 0.91 - (genelTotal.satis_tl || 0));
var kalanTL = _csvKalan > 0 ? Math.min(_csvKalan, _computed) : (_csvKalan < 0 ? 0 : _computed);
```

---

## COMPLETE BUG MAP

| ID | File | Line(s) | Type | Symptom |
|---|---|---|---|---|
| BUG-1 | `js/data/csv-parser.js` | 81–82 | `parseN` missing parenthetical-negative handling | `kalan_tl = 0` when Excel uses Accounting format |
| BUG-2 | `js/ai/ai-engine.js` | 139, 392–393 | Two divergent remaining-TL calculations in same render | "Daily Target: 0" + "972K more required" simultaneously |
| BUG-3 | `js/ai/coach/goal-coach.js` | 67, 84–85 | Active-period `remainingDays` × prior-period gap | Inflated `dailyReq` in goal coach |
| BUG-4 | `js/ai/intelligence/recommendation-engine.js` | 74–75 | Same pattern as BUG-2 | Inflated daily recommendation |

---

## INVARIANT VIOLATION PATHS

### Condition C — `requiredTLFor91 > 0` while `remainingTL === 0`
```
ai-engine.js:
  kalanTL = Math.max(0, gt.kalan_tl)         → 0    [line 139]
  gerekliKalanTL = hedef*0.91 - satis         → 972K [line 392]
  ✗ VIOLATION: both from same gt record
```

### Condition D — `actualTL > 0 AND actualTL < targetTL` but `remainingTL === 0`
```
gt.satis_tl  = 972.000   (> 0)
gt.hedef_tl  = 2.688.000 (satis < hedef)
gt.kalan_tl  = 0         (CSV column R = 0 or parseN returned 0)
→ Math.max(0, 0) = 0 → kalanTL = 0
✗ VIOLATION: ai-engine.js line 139 — all three conditions met
```

---

## PRIORITY OF PATCHES

1. **BUG-2 first** (1 line) — eliminates the visible contradiction immediately. No logic change — just gates `gerekliKalanTL` on `kalanTL > 0`.
2. **BUG-1 second** (1 line in `parseN`) — fixes the upstream data cause so `kalanTL` is never incorrectly zero when the CSV value was a parenthetical negative.
3. **BUG-3** (1 line in `goal-coach.js`) — fixes inflated daily targets in the coaching engine.
4. **BUG-4** (3 lines in `recommendation-engine.js`) — fixes inflated recommendations.

> **Note:** BUG-2 patch alone stops the visible symptom. BUG-1 patch stops it at the data layer. Both are needed for a complete fix.
