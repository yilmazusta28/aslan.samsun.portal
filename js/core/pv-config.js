// ══════════════════════════════════════════════════════════════════════
//  js/core/pv-config.js — SİZİN AYAR DOSYANIZ
//
//  Bu dosya güncelleme paketlerinde (zip) BİLEREK yer almaz: index.html'i güncellerken
//  bayrak eski değerine DÖNMESİN diye ayarlar buraya taşındı. Elle değiştirin, push edin.
//
//  PV_SERVER_AUTH:
//    true  → giriş worker'daki kişisel şifreyle yapılır (güvenli; Cloudflare PV_USERS/PV_JWT_SECRET gerekir)
//    false → eski ortak şifreyle yerel giriş (YALNIZ acil geri dönüş için)
// ══════════════════════════════════════════════════════════════════════
window.PV_SERVER_AUTH = true;
