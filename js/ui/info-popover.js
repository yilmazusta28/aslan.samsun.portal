/**
 * js/ui/info-popover.js
 * ═══════════════════════════════════════════════════════════
 *  Kullanıcı isteği: bazı metrik/başlıklara ("TL NATIONAL PAYI",
 *  "TL BÖLGE PAYI", "Ekip Performans Sıralaması (Tümü)" tablosundaki
 *  Real %, Forecast %, Büyüme, Pazar Payı, Skor, Kategori, Tahmini Prim
 *  kolonları) tıklandığında ne anlama geldiğini anlatan küçük bir
 *  açıklama balonu (popover) eklendi.
 *
 *  Bağımsız, hafif bir bileşen — hiçbir mevcut motoru/veri akışını
 *  etkilemez. Sadece tıklanan elemente yakın bir konumda kısa bir
 *  başlık + açıklama metni gösterir.
 *
 *  Kullanım:
 *    <span class="info-pin" onclick="showInfoPopover(this,'Başlık','Açıklama metni…')">ⓘ</span>
 *  veya bir tablo başlığını tümüyle tıklanabilir yapmak için:
 *    <th class="info-th" onclick="showInfoPopover(this,'Real %','…')">Real % <span class="info-pin">ⓘ</span></th>
 *
 *  Dependencies: none (document.body kullanılır)
 *  Rollback: bu dosyayı ve index.html'deki <script> satırını silmek
 *            yeterli; showInfoPopover çağrıları güvenli şekilde no-op
 *            olur (fonksiyon tanımsız kalır, onclick hata verir ama
 *            sayfanın geri kalanını etkilemez) — o yüzden geri alınırken
 *            ilgili onclick’lerin de kaldırılması önerilir.
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  var _popEl = null;
  var _openAnchor = null;

  function _ensurePopEl() {
    if (_popEl && document.body.contains(_popEl)) return _popEl;
    _popEl = document.createElement('div');
    _popEl.className = 'info-popover';
    _popEl.innerHTML =
      '<div class="info-popover-arrow"></div>' +
      '<div class="info-popover-hd">' +
        '<span class="info-popover-title"></span>' +
        '<button type="button" class="info-popover-close" aria-label="Kapat">✕</button>' +
      '</div>' +
      '<div class="info-popover-body"></div>';
    document.body.appendChild(_popEl);
    _popEl.querySelector('.info-popover-close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideInfoPopover();
    });
    // Balonun içine tıklamak dışarı-tıklama kapatmasını tetiklemesin
    _popEl.addEventListener('click', function (e) { e.stopPropagation(); });
    return _popEl;
  }

  function _position(anchor) {
    var pop = _popEl;
    var r = anchor.getBoundingClientRect();
    var margin = 8;
    // Önce görünür yap ki genişlik/yükseklik ölçülebilsin
    pop.style.visibility = 'hidden';
    pop.style.display = 'block';
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;

    var top = r.bottom + margin;
    var placeAbove = false;
    if (top + ph > vh - 8 && r.top - ph - margin > 8) {
      top = r.top - ph - margin;
      placeAbove = true;
    }
    var left = r.left + (r.width / 2) - (pw / 2);
    left = Math.max(8, Math.min(left, vw - pw - 8));

    pop.style.top = Math.max(8, top) + 'px';
    pop.style.left = left + 'px';

    // Ok işaretini anchor'ın yatay ortasına hizala
    var arrow = pop.querySelector('.info-popover-arrow');
    var arrowLeft = Math.max(12, Math.min((r.left + r.width / 2) - left, pw - 12));
    arrow.style.left = arrowLeft + 'px';
    pop.classList.toggle('info-popover-above', placeAbove);

    pop.style.visibility = 'visible';
  }

  /**
   * Bir başlık + açıklama balonu göster.
   * @param {Element} anchor  Tıklanan eleman (konumlandırma referansı)
   * @param {string}  title
   * @param {string}  html    Açıklama metni (basit HTML olabilir)
   */
  window.showInfoPopover = function (anchor, title, html) {
    if (!anchor) return;
    var pop = _ensurePopEl();

    // Aynı anchor'a tekrar tıklanırsa balonu kapat (toggle davranışı)
    if (_openAnchor === anchor && pop.classList.contains('info-popover-open')) {
      hideInfoPopover();
      return;
    }

    pop.querySelector('.info-popover-title').textContent = title || '';
    pop.querySelector('.info-popover-body').innerHTML = html || '';
    _openAnchor = anchor;
    pop.classList.add('info-popover-open');
    _position(anchor);

    // Dışarı tıklama / kaydırma / ESC ile kapat
    setTimeout(function () {
      document.addEventListener('click', _onOutsideClick);
      window.addEventListener('resize', _onReposition);
      window.addEventListener('scroll', _onReposition, true);
      document.addEventListener('keydown', _onKeydown);
    }, 0);
  };

  window.hideInfoPopover = function () {
    if (!_popEl) return;
    _popEl.classList.remove('info-popover-open');
    _popEl.style.display = 'none';
    _openAnchor = null;
    document.removeEventListener('click', _onOutsideClick);
    window.removeEventListener('resize', _onReposition);
    window.removeEventListener('scroll', _onReposition, true);
    document.removeEventListener('keydown', _onKeydown);
  };

  function _onOutsideClick() { hideInfoPopover(); }
  function _onReposition() { if (_openAnchor) _position(_openAnchor); }
  function _onKeydown(e) { if (e.key === 'Escape') hideInfoPopover(); }

})();
