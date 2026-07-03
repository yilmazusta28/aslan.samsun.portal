// ══════════════════════════════════════════════════════════════════════
//  js/ui/role-visibility.js
//  FAZ 12.3 — Rol Bazlı Arayüz (Temsilci / Yönetici)
//
//  Sorumluluk:
//    Hangi rolün hangi sayfa/kartları gördüğünü belirler.
//    VERİ/HESAPLAMA KATMANINA DOKUNMAZ — sadece DOM görünürlük.
//    Mevcut hiçbir sayfa/motor SİLİNMEZ.
//
//  Rol Kaynağı: window.LOGGED_IN_USER
//    ŞENOL YILMAZ → YONETICI
//    Diğerleri    → TEMSILCI
//
//  Rol Kuralları:
//    TEMSILCI: snav5 (AI Analiz), snav6 (Eczane Yönetimi), kendi verisi
//    YONETICI: snav5, snav6, snav7 (Yönetici + Sayfa 3 / FAZ 12.2)
//
//  Public API:
//    getCurrentRole()      → 'TEMSILCI' | 'YONETICI'
//    applyRoleVisibility() → DOM'da role uymayan öğeleri gizler/gösterir
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._ROLE_VISIBILITY_LOADED) {
    console.warn('[role-visibility] Zaten yüklü — atlandı');
    return;
  }
  window._ROLE_VISIBILITY_LOADED = true;

  var MANAGER_USER = 'ŞENOL YILMAZ';

  function getCurrentRole() {
    var user = '';
    try { user = (window.LOGGED_IN_USER || '').toUpperCase().trim(); } catch (_e) {}
    return user === MANAGER_USER.toUpperCase() ? 'YONETICI' : 'TEMSILCI';
  }

  // Elements only Yönetici should see
  // AUDIT4 düzeltmesi: mtb7 (mobil alt tab bar) eklendi — masaüstü sidebar'da
  // (snav7) rol bazlı gizleme zaten vardı, ama mobil tab bar'da hem buton
  // hiç yoktu (index.html'de ayrıca eklendi) hem de burada unutulmuştu.
  // ntab7 de eklendi (tutarlılık için — o bar CSS'te her zaman gizli ama
  // ileride açılırsa rol kuralı hazır olsun).
  var YONETICI_ONLY_IDS = ['snav7', 'mtb7', 'ntab7'];

  function applyRoleVisibility() {
    var role = getCurrentRole();

    YONETICI_ONLY_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = (role === 'YONETICI') ? '' : 'none';
    });

    // Update sidebar role label if present
    var roleEl = document.getElementById('sidebarRole');
    if (roleEl) {
      roleEl.textContent = role === 'YONETICI' ? 'Bölge Müdürü' : 'Uzman Tıbbi Tanıtım Temsilcisi';
    }

    console.debug('[role-visibility] Rol uygulandı:', role);
  }

  window.RoleVisibility = {
    getCurrentRole:       getCurrentRole,
    applyRoleVisibility:  applyRoleVisibility,
    version:              '12.3'
  };

  window.getCurrentRole      = getCurrentRole;
  window.applyRoleVisibility = applyRoleVisibility;

  // Apply on load (after DOM is ready)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRoleVisibility);
  } else {
    applyRoleVisibility();
  }

  console.debug('[role-visibility] FAZ 12.3 yüklendi.');

})();
