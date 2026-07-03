// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/visit-planner.js
//  Phase 3.3 — Territory Optimization Engine
//
//  Sorumluluk: Günlük ve haftalık ziyaret planı oluştur
//    • buildVisitPlan(ttt) → { monday…friday, weekly, monthly, summary }
//
//  Mantık:
//    1. rankBricks çıktısını kullan (öncelik skoru sıralı)
//    2. RESCUE brickler → Pazartesi (hafta başı acil)
//    3. OPPORTUNITY brickler → Salı-Çarşamba
//    4. Kapsama zayıfları → Perşembe
//    5. STABLE/takip → Cuma
//    6. Haftalık rotasyon: her hafta farklı brick grubu
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: brick-ranking-engine.js, coverage-engine.js,
//               date-utils.js (workDays), data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global rankBricks, analyzeCoverage, PERIODS, HOLIDAYS, workDays */

(function () {
  'use strict';

  // ── _todayStr ───────────────────────────────────────────────
  function _todayStr() {
    var d = new Date();
    var pad = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  }

  // ── _nextWorkdays ───────────────────────────────────────────
  // Bugünden itibaren n iş günü listesini döndürür.
  function _nextWorkdays(n) {
    var result = [];
    var d = new Date();
    var holidays = (typeof HOLIDAYS !== 'undefined') ? HOLIDAYS : new Set();
    while (result.length < n) {
      d.setDate(d.getDate() + 1);
      var dw = d.getDay();
      var ds = d.toISOString().slice(0,10);
      if (dw > 0 && dw < 6 && !holidays.has(ds)) {
        result.push({ date: ds, dayOfWeek: dw });
      }
    }
    return result;
  }

  // ── _dayLabel ───────────────────────────────────────────────
  var DAY_LABELS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  function _dayLabel(dw) { return DAY_LABELS[dw] || '?'; }

  // ── buildVisitPlan ────────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   monday: [], tuesday: [], wednesday: [], thursday: [], friday: [],
  //   weekly: [],    — bu haftanın öncelikli brick listesi
  //   monthly: [],   — bu dönemin bölge planı
  //   summary: string
  // }}
  function buildVisitPlan(ttt) {
    var EMPTY = {
      monday: [], tuesday: [], wednesday: [], thursday: [], friday: [],
      weekly: [], monthly: [], summary: 'Veri yetersiz — plan oluşturulamadı.'
    };
    if (!ttt) return EMPTY;

    try {
      // Veri kaynakları
      var ranked   = typeof rankBricks     === 'function' ? rankBricks(ttt)     : [];
      var coverage = typeof analyzeCoverage === 'function' ? analyzeCoverage(ttt) : [];

      if (!ranked.length) return EMPTY;

      // Sınıflara ayır
      var rescue      = ranked.filter(function(r){ return r.classification === 'RESCUE'; });
      var opportunity = ranked.filter(function(r){ return r.classification === 'OPPORTUNITY'; });
      var stable      = ranked.filter(function(r){ return r.classification === 'STABLE'; });
      var saturated   = ranked.filter(function(r){ return r.classification === 'SATURATED'; });
      var undercov    = coverage.filter(function(c){ return c.status === 'UNDER_COVERED' || c.status === 'UNTOUCHED'; });
        undercov = undercov.map(function(c){ return { brick: c.area, reason: c.detail }; });

      // ── Günlük plan (next 5 iş günü) ─────────────────────
      var nextDays = _nextWorkdays(5);
      var plan = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] };
      var dayKeys = ['monday','tuesday','wednesday','thursday','friday'];

      // Day 0 (Pazartesi benzeri) → RESCUE
      // Day 1 → OPPORTUNITY
      // Day 2 → OPPORTUNITY / UNDERCOV
      // Day 3 → UNDERCOV / STABLE
      // Day 4 → STABLE / SATURATED (maintenance)

      var dayAssign = [rescue, opportunity,
        opportunity.concat(undercov), undercov.concat(stable), stable.concat(saturated)];

      nextDays.forEach(function (nd, i) {
        var key     = dayKeys[i];
        var pool    = dayAssign[i] || stable;
        var sliced  = pool.slice(0, 4); // max 4 brick/gün
        plan[key] = sliced.map(function (b) {
          return {
            brick:  b.brick || b.area || '?',
            score:  b.score || null,
            reason: b.reason || b.detail || '',
            classification: b.classification || '',
            date:   nd.date,
            dayLabel: _dayLabel(nd.dayOfWeek)
          };
        });
      });

      // ── Haftalık plan (en iyi 8 brick bu hafta) ──────────
      var weekly = ranked.slice(0, 8).map(function(b, i) {
        return {
          priority:       i + 1,
          brick:          b.brick,
          score:          b.score,
          classification: b.classification,
          reason:         b.reason
        };
      });

      // ── Aylık/dönemsel plan ───────────────────────────────
      // Dönem içinde her brick en az 1 kez ziyaret planı
      var monthly = ranked.map(function(b, i) {
        // Haftaya ata (1-8 hafta dönem)
        var weekNo = Math.floor(i / 4) + 1;
        return {
          brick:          b.brick,
          score:          b.score,
          classification: b.classification,
          suggestedWeek:  'Hafta ' + weekNo,
          reason:         b.reason
        };
      });

      // ── Özet ─────────────────────────────────────────────
      var rescueCount = rescue.length;
      var oppCount    = opportunity.length;
      var undCount    = undercov.length;
      var summary     = '';
      if (rescueCount) summary += rescueCount + ' acil RESCUE brick var — hemen ziyaret. ';
      if (oppCount)    summary += oppCount + ' yüksek fırsatlı brick bu hafta öncelikli. ';
      if (undCount)    summary += undCount + ' yetersiz kapsanan alan ziyaret bekliyor.';
      if (!summary)    summary = ranked.length + ' brick planlandı. Stabıl bölge, düzenli ziyaret yeterli.';

      return {
        monday:    plan.monday,
        tuesday:   plan.tuesday,
        wednesday: plan.wednesday,
        thursday:  plan.thursday,
        friday:    plan.friday,
        weekly:    weekly,
        monthly:   monthly,
        summary:   summary.trim()
      };

    } catch (e) {
      console.warn('[visit-planner] buildVisitPlan hata:', e.message);
      return { monday:[], tuesday:[], wednesday:[], thursday:[], friday:[],
               weekly:[], monthly:[], summary:'Hata: ' + e.message };
    }
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.buildVisitPlan = buildVisitPlan;
  console.debug('[visit-planner] Phase 3.3 yüklendi.');

})();
