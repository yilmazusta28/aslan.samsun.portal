// ══════════════════════════════════════════════════════════════════════
//  js/ui/dosyalar-page.js
//  FAZ 20.0 — "Dosyalar" Sayfası (Sayfa 9) — GENİŞLETİLMİŞ SÜRÜM
//
//  FAZ 19.0'ın yerini alır. Artık TEK bir form yerine, orijinal
//  SAMSUN_AYLIK_MASRAF_DOSYASI.xlsx (3 sayfa) + Kongre_Katılımcı_Bilgileri.xlsx
//  yapısına birebir karşılık gelen 4 sekme var:
//
//    "Masraf Dosyası" (ana başlık)
//      ├─ Temsil Masraf Detay
//      ├─ Planlanan Merkez Ödeme
//      └─ Gerçekleşen Merkez Ödeme
//    "Kongre Katılımcı Bilgileri" (ana başlık, tek sekme)
//
//  Ortak otomatik alanlar (kullanıcı isteği, FAZ 20.0):
//    Bölge = SAMSUN, Grup = ASLAN (Kongre hariç), BM = ŞENOL YILMAZ
//    (Kongre hariç — Kongre'de "TTT Adı" tek başına yeterli),
//    TTT / Sunum Yapan-Yapacak Kişi / TTT Adı = giriş yapan kullanıcı
//    (LOGGED_IN_USER) — OTOMATİK, salt-okunur.
//    Brick / Brik = giriş yapan TTT'nin IMS'teki kendi brickleri
//    (+ her zaman ortak "333" seçeneği) — mevcut getTTTBricks() İLE AYNI.
//    Kongre'de ayrıca "İlk 333 Brick Sıra" seçilen bricke göre
//    MIGI_BRICK_TL_RAW (MI_GI-TL.csv) üzerinden OTOMATİK dolar.
//    Planlanan/Gerçekleşen'de "Kişi Başı" = Maliyet ÷ Katılımcı, OTOMATİK.
//
//  NOT (Kongre "Kongre Tarihi" alanı): orijinal Kongre_Katılımcı_Bilgileri.xlsx
//  dosyasında tarih sütunu yoktu. worker.js /dosyalar-sync endpoint'i HER
//  kayıt için ttt+tarih+brick alanlarını zorunlu tuttuğundan (bkz. worker.js
//  satır ~117) ve bu üçü GERÇEKTEN de "hangi kongre/ne zaman" sorusuna
//  faydalı bir cevap olduğundan, forma "Kongre Tarihi" eklendi. Bunun
//  dışında worker.js'de HİÇBİR değişiklik yapılmadı/gerekmedi — bu endpoint
//  zaten herhangi bir kayıt şeklini (record shape) kabul ediyor, sadece bu
//  3 alanın dolu olmasını istiyor.
//
//  Depolama: FAZ 19.0 ile AYNI — tek dosya (data/dosyalar_kayitlari.json),
//  tek "kayitlar" dizisi, artık her kayıtta bir "tip" alanı var
//  ('temsil' | 'planlanan' | 'gerceklesen' | 'kongre'). "tip" alanı
//  olmayan ESKİ (FAZ 19.0 döneminde girilmiş) kayıtlar geriye dönük
//  uyumluluk için 'gerceklesen' sekmesinde gösterilir (en yakın şema).
//
//  GitHub Pages compatible: classic script, no ES modules.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DOSYALAR_PAGE_LOADED) {
    console.warn('[dosyalar-page] Zaten yüklü — atlandı');
    return;
  }
  window._DOSYALAR_PAGE_LOADED = true;

  // ── Sabit seçenek listeleri (kullanıcı isteğiyle FAZ 20.0'da tanımlandı) ──
  var PRODUCT_OPTIONS      = ['ACİDPASS', 'PANOCER', 'FAMTREC', 'MOKSEFEN', 'GRİPORT COLD'];
  var BRANS_KLINIK_OPTIONS = ['A.HEK', 'DAHİLİYE', 'FTR', 'ORTOPEDİ', 'ACİL'];
  var SUNUM_TEMSIL_OPTIONS = ['K.K', 'NAKİT'];
  var YEMEK_OPTIONS        = ['ALKOLSÜZ ÖĞLE YEMEĞİ', 'ALKOLSÜZ AKŞAM YEMEĞİ', 'ALKOLLÜ AKŞAM YEMEĞİ'];
  var UNVAN_OPTIONS        = ['Pratisyen', 'Asistan', 'Uzman', 'Öğretim Üyesi', 'Doç.Dr.', 'Prof.Dr.'];
  var SINGLE_DOUBLE_OPTIONS = ['SINGLE', 'DOUBLE'];
  var AY_ADLARI = ['OCAK','ŞUBAT','MART','NİSAN','MAYIS','HAZİRAN','TEMMUZ','AĞUSTOS','EYLÜL','EKİM','KASIM','ARALIK'];

  // FAZ 27.0 — Sabit Formlar (kullanıcı isteğiyle GitHub'a yüklenen hazır
  // dosyalar): DAF (Değer Aktarım Formu), Medikal Talep Formu ve Kaza
  // Tespit Tutanağı. Bunlar
  // Masraf Dosyası/Kongre kayıt sistemiyle İLİŞKİSİZ — sadece indirilip
  // yazdırılacak statik şablonlar. raw.githubusercontent.com üzerinden
  // doğrudan repo kökünden servis ediliyor (dosya adları %-encode edilmiş
  // Türkçe karakter içerir, GitHub'ın kendi "Raw" bağlantısıyla BİREBİR
  // aynı — bkz. dosya sayfasındaki "Raw" linki).
  var FIXED_FORMS = [
    {
      key: 'daf',
      icon: '📝',
      label: 'DAF Formu',
      sub: 'Değer Aktarım Formu (.docx)',
      fileName: 'DEĞER AKTARIM FORMU.docx',
      url: 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/DEG%CC%86ER%20AKTARIM%20FORMU.docx'
    },
    {
      key: 'medikal',
      icon: '🩺',
      label: 'Medikal Talep',
      sub: 'Medikal Talep Formu (.xls)',
      fileName: 'MEDİKAL TALEP FORMU.xls',
      url: 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/MED%C4%B0KAL%20TALEP%20FORMU.xls'
    },
    {
      key: 'kaza',
      icon: '🚗',
      label: 'Kaza Tespit Tutanağı',
      sub: 'Kaza Tespit Tutanağı (.pdf)',
      fileName: 'Kaza Tespit Tutanağı.pdf',
      url: 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/kaza-tespit-tutanagi.pdf'
    }
  ];

  // BUG DÜZELTMESİ (kullanıcı bildirimi: "Medikal Talep dosyası inmiyor"):
  // raw.githubusercontent.com bu dosyaları "Content-Disposition: attachment"
  // BAŞLIĞI OLMADAN, content-type: application/octet-stream ile servis
  // ediyor (curl ile doğrulandı — dosyanın kendisi SAĞLAM, GitHub'daki
  // orijinaliyle bayt bayt AYNI). Bu durumda tarayıcılar CROSS-ORIGIN bir
  // <a download> linkinde "download" özniteliğini YOK SAYABİLİR (özellikle
  // bazı mobil/uygulama-içi tarayıcılarda) ve linki normal bir navigasyon
  // gibi ele alıp hiçbir şey yapmayabilir. Kalıcı çözüm: dosyayı fetch()
  // ile indirip (raw.githubusercontent.com "access-control-allow-origin: *"
  // gönderdiğinden CORS engeli YOK) bir Blob'a çevirip AYNI ORİJİNDEN
  // (data: değil, blob: — tüm modern tarayıcılarda çalışır) geçici bir
  // indirme linki oluşturuyoruz. Bu, tarayıcı/menşe farkı gözetmeksizin
  // her zaman gerçek bir "Farklı Kaydet" indirmesi tetikler.
  window._dsyDownloadForm = function (url, fileName, btnEl) {
    var originalHtml = btnEl ? btnEl.innerHTML : null;
    if (btnEl) { btnEl.innerHTML = '⏳ İndiriliyor…'; btnEl.disabled = true; }
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName || 'form';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 4000);
      })
      .catch(function (err) {
        console.warn('[dosyalar-page] form indirme hatası, sekmede açılıyor:', err.message);
        // Son çare: en azından yeni sekmede aç, kullanıcı oradan "Farklı
        // Kaydet" ile indirebilsin.
        window.open(url, '_blank');
      })
      .finally(function () {
        if (btnEl) { btnEl.innerHTML = originalHtml; btnEl.disabled = false; }
      });
  };

  // Tarayıcı .docx/.xls dosyalarını sayfa içinde gösteremediği için
  // "Yazdır", dosyayı Google Docs Viewer'da (tam araç çubuğu — içinde
  // kendi yazdır/indir ikonları var) yeni sekmede açar; kullanıcı oradan
  // yazdırabilir. Doğrudan window.print() ile ZORLA yazdırma, tarayıcının
  // binary Office dosyalarını render edememesi nedeniyle mümkün değil.
  window._dsyPrintForm = function (url) {
    // PDF: tarayıcı zaten kendi PDF görüntüleyicisiyle (yazdır ikonu dahil)
    // açabiliyor, Google Docs Viewer'a gerek yok — doğrudan yeni sekmede aç.
    if (/\.pdf($|\?)/i.test(url)) {
      window.open(url, '_blank');
      return;
    }
    window.open('https://docs.google.com/viewer?url=' + encodeURIComponent(url) + '&embedded=false', '_blank');
  };

  function _fixedFormsHtml() {
    return '<div class="card mb16" id="dsyFixedFormsCard"><div class="card-hd">' +
      '<span class="card-title">📄 Sabit Formlar</span>' +
      '<span class="card-badge" style="font-size:9px">İndir / Yazdır</span>' +
      '</div><div class="card-body">' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      FIXED_FORMS.map(function (f) {
        return '<div style="flex:1;min-width:220px;border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:18px">' + f.icon + '</span>' +
          '<div><div style="font-weight:700;font-size:12.5px">' + f.label + '</div>' +
          '<div style="font-size:10px;color:var(--dim)">' + f.sub + '</div></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
          '<button type="button" onclick="_dsyDownloadForm(\'' + f.url + '\',\'' + f.fileName.replace(/'/g, "\\'") + '\',this)"' +
          ' style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surf);font-size:11px;font-weight:600;color:var(--c1);cursor:pointer">📥 İndir</button>' +
          '<button type="button" onclick="_dsyPrintForm(\'' + f.url + '\')"' +
          ' style="flex:1;padding:7px 10px;border-radius:8px;border:none;background:linear-gradient(90deg,#7C3AED,#6D28D9);color:#fff;font-size:11px;font-weight:600;cursor:pointer">🖨️ Yazdır</button>' +
          '</div>' +
          '</div>';
      }).join('') +
      '</div></div></div>';
  }

  // Bölge/Grup/BM sabit — uygulama genelinde tek bölge (SAMSUN), tek grup
  // (ASLAN) ve tek Bölge Müdürü (ŞENOL YILMAZ) var. Değişirse SADECE
  // burayı güncelle.
  var BOLGE_ADI = (window.PV_DOSYALAR_BOLGE_ADI) || 'SAMSUN';
  var GRUP_ADI  = (window.PV_DOSYALAR_GRUP_ADI) || 'ASLAN';
  var BM_ADI    = 'ŞENOL YILMAZ';

  var STORAGE_KEY = 'pv_dosyalar_kayitlari_v1';
  var _RAW_URL     = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/data/dosyalar_kayitlari.json';
  var _remoteCache = null;
  var _workerSyncQueue = Promise.resolve();
  var DELETED_KEY = 'pv_dosyalar_silinen_v1';
  // FAZ 21.0: düzenleme durumu — tip başına düzenlenen kaydın id'si (null = yeni kayıt modu)
  var _editing = {};
  // düzenlenen kaydın orijinal enteredAt'ını korumak için anlık görüntü
  var _editingSnapshot = {};

  var TIPLER = ['temsil', 'planlanan', 'gerceklesen', 'kongre'];

  var TIP_LABELS = {
    temsil:      'Temsil Masraf Detay',
    planlanan:   'Planlanan Merkez Ödeme',
    gerceklesen: 'Gerçekleşen Merkez Ödeme',
    kongre:      'Kongre Katılımcı Bilgileri'
  };

  // ortak (Bölge/Grup/BM/TTT/Tarih) alanların her tipe göre etiketi
  var COMMON_LABELS = {
    temsil:      { ttt: 'TTT',                    tarih: 'Tarih',          showGrupBm: true  },
    planlanan:   { ttt: 'Sunum Yapacak Kişi',      tarih: 'Tarihi',         showGrupBm: true  },
    gerceklesen: { ttt: 'Sunum Yapan Kişi',        tarih: 'Tarih',          showGrupBm: true  },
    kongre:      { ttt: 'TTT Adı',                 tarih: 'Kongre Tarihi',  showGrupBm: false }
  };

  // tipe özel alanlar (Bölge/Grup/BM/TTT/Tarih/Brick hariç — onlar ortak/özel işlenir)
  var TIP_FIELDS = {
    temsil: [
      { key: 'urun',        label: 'Ürün',              type: 'select', options: PRODUCT_OPTIONS },
      { key: 'unite',       label: 'Ünite',              type: 'text' },
      { key: 'brick',       label: 'Bulunduğu Brick',    type: 'brick' },
      { key: 'hekimSayisi', label: 'Hekim Sayısı',       type: 'number' },
      { key: 'butce',       label: 'Bütçe (₺)',          type: 'number' },
      { key: 'brans',       label: 'Branş',              type: 'select', options: BRANS_KLINIK_OPTIONS },
      { key: 'sunumTemsil', label: 'Sunum / Temsil',     type: 'select', options: SUNUM_TEMSIL_OPTIONS }
    ],
    planlanan: [
      { key: 'urun',       label: 'Sunum Yapılacak Ürün', type: 'select', options: PRODUCT_OPTIONS },
      { key: 'unite',      label: 'Sunum Yapılacak Ünite', type: 'text' },
      { key: 'klinik',     label: 'Klinik',                type: 'select', options: BRANS_KLINIK_OPTIONS },
      { key: 'brick',      label: 'Bulunduğu Brik',        type: 'brick' },
      { key: 'katilimci',  label: 'Tahmini Katılımcı',     type: 'number', recalc: true },
      { key: 'maliyet',    label: 'Tahmini Maliyet (₺)',   type: 'number', recalc: true },
      { key: 'kisiBasi',   label: 'Kişi Başı (otomatik)',  type: 'computed' },
      { key: 'yemek',      label: 'Akşam/Öğle Yemeği',     type: 'select', options: YEMEK_OPTIONS }
    ],
    gerceklesen: [
      { key: 'urun',       label: 'Sunum Yapılan Ürün',    type: 'select', options: PRODUCT_OPTIONS },
      { key: 'unite',      label: 'Sunum Yapılan Ünite',   type: 'text' },
      { key: 'klinik',     label: 'Klinik',                type: 'select', options: BRANS_KLINIK_OPTIONS },
      { key: 'brick',      label: 'Bulunduğu Brik',        type: 'brick' },
      { key: 'katilimci',  label: 'Gerçekleşen Katılımcı', type: 'number', recalc: true },
      { key: 'maliyet',    label: 'Gerçekleşen Maliyet (₺)', type: 'number', recalc: true },
      { key: 'kisiBasi',   label: 'Kişi Başı (otomatik)',  type: 'computed' },
      { key: 'yemek',      label: 'Akşam/Öğle Yemeği',     type: 'select', options: YEMEK_OPTIONS }
    ],
    kongre: [
      { key: 'kisiSayisi',   label: 'Kişi Sayısı',                        type: 'number' },
      { key: 'singleDouble', label: 'Single/Double',                      type: 'select', options: SINGLE_DOUBLE_OPTIONS },
      { key: 'odaSayisi',    label: 'Oda Sayısı',                         type: 'number' },
      { key: 'unite',        label: 'Ünite',                              type: 'text' },
      { key: 'brick',        label: 'Brick',                              type: 'brick' },
      { key: 'ilk333Sira',   label: 'İlk 333 Brick Sıra',                 type: 'sira' },
      { key: 'unvan',        label: 'Unvan',                              type: 'select', options: UNVAN_OPTIONS },
      { key: 'adSoyad',      label: 'Ad-Soyad',                           type: 'text' },
      { key: 'tc',           label: 'TC',                                 type: 'text' },
      { key: 'dogumTarihi',  label: 'Doğum Tarihi',                       type: 'date' },
      { key: 'telefon',      label: 'Telefon',                            type: 'text' },
      { key: 'email',        label: 'Email',                              type: 'text' },
      { key: 'sicilNo',      label: 'Sicil No',                           type: 'text' },
      { key: 'hekiminIli',   label: 'Hekimin Bulunduğu İl',               type: 'text' },
      { key: 'ucakIli',      label: 'Uçağa Bineceği İl',                  type: 'text' },
      { key: 'notUcus',      label: 'Not / Talep Edilen Uçuş Bilgisi',    type: 'text' }
    ]
  };

  // dışa aktarımda görünecek sütunlar (sıra önemli — orijinal Excel sırası)
  var TABLE_COLS = {
    temsil: [
      { key: 'ttt', label: 'TTT', managerOnly: true },
      { key: 'bolge', label: 'Bölge' }, { key: 'grup', label: 'Grup' }, { key: 'urun', label: 'Ürün' },
      { key: 'tarih', label: 'Tarih' }, { key: 'unite', label: 'Ünite' }, { key: 'brick', label: 'Bulunduğu Brick' },
      { key: 'hekimSayisi', label: 'Hekim Sayısı' }, { key: 'butce', label: 'Bütçe', money: true },
      { key: 'brans', label: 'Branş' }, { key: 'sunumTemsil', label: 'Sunum/Temsil' }, { key: 'ay', label: 'AY' }
    ],
    planlanan: [
      { key: 'ttt', label: 'Sunum Yapacak Kişi', managerOnly: true },
      { key: 'bolge', label: 'Bölge' }, { key: 'grup', label: 'Grup' }, { key: 'urun', label: 'Ürün' },
      { key: 'tarih', label: 'Tarihi' }, { key: 'unite', label: 'Ünite' }, { key: 'klinik', label: 'Klinik' },
      { key: 'brick', label: 'Brik' }, { key: 'katilimci', label: 'Tahmini Katılımcı' },
      { key: 'kisiBasi', label: 'Kişi Başı', money: true }, { key: 'maliyet', label: 'Tahmini Maliyet', money: true },
      { key: 'yemek', label: 'Yemek' }
    ],
    gerceklesen: [
      { key: 'ttt', label: 'Sunum Yapan Kişi', managerOnly: true },
      { key: 'bolge', label: 'Bölge' }, { key: 'grup', label: 'Grup' }, { key: 'urun', label: 'Ürün' },
      { key: 'tarih', label: 'Tarih' }, { key: 'unite', label: 'Ünite' }, { key: 'klinik', label: 'Klinik' },
      { key: 'brick', label: 'Brik' }, { key: 'katilimci', label: 'Gerçekleşen Katılımcı' },
      { key: 'kisiBasi', label: 'Kişi Başı', money: true }, { key: 'maliyet', label: 'Gerçekleşen Maliyet', money: true },
      { key: 'yemek', label: 'Yemek' }
    ],
    kongre: [
      { key: 'ttt', label: 'TTT Adı', managerOnly: true },
      { key: 'kisiSayisi', label: 'Kişi Sayısı' }, { key: 'singleDouble', label: 'Single/Double' },
      { key: 'odaSayisi', label: 'Oda Sayısı' }, { key: 'bolge', label: 'Bölge' }, { key: 'unite', label: 'Ünite' },
      { key: 'brick', label: 'Brick' }, { key: 'ilk333Sira', label: 'İlk 333 Brick Sıra' }, { key: 'unvan', label: 'Unvan' },
      { key: 'adSoyad', label: 'Ad-Soyad' }, { key: 'tc', label: 'TC' }, { key: 'dogumTarihi', label: 'Doğum Tarihi' },
      { key: 'telefon', label: 'Telefon' }, { key: 'email', label: 'Email' }, { key: 'sicilNo', label: 'Sicil No' },
      { key: 'hekiminIli', label: 'Hekimin Bulunduğu İl' }, { key: 'ucakIli', label: 'Uçağa Bineceği İl' },
      { key: 'notUcus', label: 'Not / Talep Edilen Uçuş Bilgisi' }, { key: 'tarih', label: 'Kongre Tarihi' }
    ]
  };

  // ── Yerel (localStorage) okuma/yazma — FAZ 19.0 İLE AYNI ──────────────
  function _loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { return []; }
  }
  function _saveLocal(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); } catch (e) { /* yoksay */ }
  }

  // ── FAZ 21.0: silinen kayıt id'leri (uzak/GitHub tarafı henüz silmeyi
  // işlemeden önce, silinen kaydın bu tarayıcıda anında kaybolması için) ──
  function _loadDeleted() {
    try {
      var raw = localStorage.getItem(DELETED_KEY);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { return []; }
  }
  function _addDeleted(id) {
    var d = _loadDeleted();
    if (d.indexOf(id) === -1) {
      d.push(id);
      try { localStorage.setItem(DELETED_KEY, JSON.stringify(d)); } catch (e) { /* yoksay */ }
    }
  }

  function _fetchRemote() {
    return fetch(_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return (data && Array.isArray(data.kayitlar)) ? data.kayitlar : [];
      })
      .catch(function (e) {
        console.warn('[dosyalar-page] GitHub\'dan kayıtlar okunamadı (yerel önbellek kullanılacak):', e && e.message);
        return null;
      });
  }

  function _mergedRecords(remote) {
    var local = _loadLocal();
    var deleted = _loadDeleted();
    var byId = {};
    (remote || []).forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    local.forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    deleted.forEach(function (id) { delete byId[id]; });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    all.sort(function (a, b) { return (b.enteredAt || '').localeCompare(a.enteredAt || ''); });
    return all;
  }

  function _makeId(ttt) {
    return 'dsy_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '_' + (ttt || '').slice(0, 3);
  }

  // ── FAZ 22.0: senkron durumu (kayıt bazında) ──────────────────────────
  // ESKİ DAVRANIŞ: worker'a atılan POST "fire-and-forget"ti; hata SADECE
  // console.warn'a yazılıyordu. Kullanıcı "✓ Kaydedildi" görüyor, kayıt
  // localStorage'da duruyor ama GitHub'a HİÇ yazılmamış olabiliyordu —
  // bu yüzden Bölge Müdürü kayıtları göremiyordu. Artık her kaydın
  // yerel kopyasında `_sync` alanı var ('ok' | 'pending') ve başarısız
  // kayıtlar sayfanın üstündeki uyarı şeridinden tek tuşla tekrar
  // gönderilebiliyor.
  function _setSyncState(id, state) {
    var local = _loadLocal();
    var changed = false;
    local.forEach(function (r) { if (r && r.id === id) { r._sync = state; changed = true; } });
    if (changed) _saveLocal(local);
  }

  function _pendingRecords() {
    return _loadLocal().filter(function (r) { return r && r._sync === 'pending'; });
  }

  // worker'a gönderilecek temiz kopya — yalnızca istemciyi ilgilendiren
  // `_sync` alanı GitHub'daki JSON'a sızmasın diye ayıklanır.
  function _wireRecord(record) {
    var copy = {};
    Object.keys(record || {}).forEach(function (k) { if (k !== '_sync') copy[k] = record[k]; });
    return copy;
  }

  function _setStatus(statusEl, text, color) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = color || 'var(--dim)';
  }

  // Ortak POST — hem yeni kayıt hem güncelleme için. Promise döner.
  function _postToWorker(url, record, statusEl, etiket) {
    if (!url || !record) {
      _setStatus(statusEl, '⚠ Senkron adresi tanımlı değil — kayıt sadece bu cihazda.', '#D97706');
      return Promise.resolve(false);
    }
    _setSyncState(record.id, 'pending');
    _setStatus(statusEl, '⏳ GitHub\'a yazılıyor…');
    _workerSyncQueue = _workerSyncQueue.then(function () {
      return (typeof pvAuthHeaders === 'function' ? pvAuthHeaders() : Promise.resolve({}))
        .then(function (authHeaders) {
          return fetch(url, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
            body: JSON.stringify(_wireRecord(record))
          });
        })
        .then(function (res) {
          if (res && res.ok) {
            _setSyncState(record.id, 'ok');
            _setStatus(statusEl, '✓ ' + etiket + ' — GitHub\'a yazıldı (yönetici görebilir)', '#059669');
            setTimeout(function () { _setStatus(statusEl, ''); }, 4000);
            _renderSyncBanner();
            return true;
          }
          var kod = res ? res.status : '?';
          return (res ? res.text() : Promise.resolve('')).then(function (txt) {
            console.warn('[dosyalar-page] worker senkron HTTP hatası:', kod, txt);
            _setStatus(statusEl, '⚠ GitHub\'a YAZILAMADI (HTTP ' + kod + ') — kayıt bu cihazda duruyor, yukarıdaki "Tekrar Dene" ile gönder.', '#DC2626');
            _renderSyncBanner();
            return false;
          });
        })
        .catch(function (e) {
          console.warn('[dosyalar-page] worker senkron hatası:', e && e.message);
          _setStatus(statusEl, '⚠ GitHub\'a YAZILAMADI (ağ hatası) — kayıt bu cihazda duruyor, yukarıdaki "Tekrar Dene" ile gönder.', '#DC2626');
          _renderSyncBanner();
          return false;
        });
    });
    return _workerSyncQueue;
  }

  function _syncToWorker(record, statusEl) {
    return _postToWorker(window.DOSYALAR_SYNC_WORKER_URL, record, statusEl, 'Kaydedildi');
  }

  function _syncUpdateToWorker(record, statusEl) {
    return _postToWorker(window.DOSYALAR_UPDATE_WORKER_URL, record, statusEl, 'Güncellendi');
  }

  // ── FAZ 22.0: bekleyen (GitHub'a yazılamamış) kayıtları tekrar gönder ──
  window._dsyRetrySync = function () {
    var pending = _pendingRecords();
    if (!pending.length) { _renderSyncBanner(); return; }
    var banner = document.getElementById('dsySyncBannerMsg');
    if (banner) banner.textContent = '⏳ ' + pending.length + ' kayıt tekrar gönderiliyor…';
    var chain = Promise.resolve();
    pending.forEach(function (rec) {
      chain = chain.then(function () {
        // Kayıt GitHub'da olabilir de olmayabilir de → upsert yapan
        // /dosyalar-update kullanılır (id eşleşirse günceller, yoksa ekler).
        return _syncUpdateToWorker(rec, null);
      });
    });
    chain.then(function () {
      _renderSyncBanner();
      _renderAllTables();
      var b2 = document.getElementById('dsySyncBannerMsg');
      if (b2 && _pendingRecords().length === 0) b2.textContent = '✓ Tüm kayıtlar GitHub ile senkron.';
    });
  };

  function _renderSyncBanner() {
    var el = document.getElementById('dsySyncBanner');
    if (!el) return;
    var pending = _pendingRecords();
    if (!pending.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<div class="card mb16" style="border:1px solid #FCA5A5;background:#FEF2F2">' +
        '<div class="card-body" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
          '<span id="dsySyncBannerMsg" style="font-size:12px;font-weight:600;color:#DC2626">' +
            '⚠ ' + pending.length + ' kayıt GitHub\'a yazılamadı — şu an sadece bu cihazda duruyor, Bölge Müdürü göremez.' +
          '</span>' +
          '<button onclick="_dsyRetrySync()" style="padding:6px 14px;border-radius:8px;border:none;background:#DC2626;color:#fff;font-size:11px;font-weight:700;cursor:pointer">🔄 Tekrar Dene</button>' +
        '</div>' +
      '</div>';
  }

  function _syncDeleteToWorker(id, ttt) {
    if (!window.DOSYALAR_DELETE_WORKER_URL || !id) return;
    _workerSyncQueue = _workerSyncQueue.then(function () {
      return (typeof pvAuthHeaders === 'function' ? pvAuthHeaders() : Promise.resolve({}))
        .then(function (authHeaders) {
          return fetch(window.DOSYALAR_DELETE_WORKER_URL, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
            body: JSON.stringify({ id: id, ttt: ttt })
          });
        })
        .then(function (res) {
          if (res && !res.ok) console.warn('[dosyalar-page] silme senkron HTTP hatası:', res.status);
        })
        .catch(function (e) {
          console.warn('[dosyalar-page] silme senkron hatası (yoksayıldı, yerel silme geçerli):', e && e.message);
        });
    }).catch(function () {});
  }

  // ── Temsilcinin kendi brick'lerini bul (IMS verisinden) — FAZ 19.0 İLE AYNI ─
  function getTTTBricks(ttt) {
    var set = {};
    try {
      if (typeof IMS !== 'undefined' && Array.isArray(IMS)) {
        IMS.forEach(function (r) {
          if (r && r.ttt === ttt && r.brick) set[String(r.brick).trim()] = true;
        });
      }
    } catch (e) { /* IMS henüz yüklenmemiş olabilir */ }
    var list = Object.keys(set).sort();
    if (list.indexOf('333') === -1) list.push('333');
    return list;
  }

  // ── FAZ 20.0 YENİ: seçilen bricke ait "İlk 333 Brick Sıra" değerini
  // MIGI_BRICK_TL_RAW (MI_GI-TL.csv, brick-ranking-engine.js İLE AYNI
  // veri kaynağı) üzerinden bul. "333" ortak brick'i veya veri henüz
  // yüklenmemişse boş döner (kullanıcı gerekirse manuel bakar).
  function getBrickSira(ttt, brick) {
    if (!brick || brick === '333') return '';
    try {
      if (typeof MIGI_BRICK_TL_RAW === 'undefined' || !Array.isArray(MIGI_BRICK_TL_RAW)) return '';
      var rows = MIGI_BRICK_TL_RAW.filter(function (r) {
        return r && r.person === ttt && String(r.brick || '').trim().toUpperCase() === String(brick).trim().toUpperCase();
      });
      if (!rows.length) return '';
      function donemNum(d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; }
      var latest = rows.reduce(function (max, r) { return Math.max(max, donemNum(r.donem)); }, 0);
      var latestRows = rows.filter(function (r) { return donemNum(r.donem) === latest; });
      var sira = latestRows.reduce(function (min, r) { return (r.sira && r.sira < min) ? r.sira : min; }, 999999);
      return (sira && sira < 999999) ? sira : '';
    } catch (e) { return ''; }
  }

  function _ayFromTarih(tarih) {
    if (!tarih) return '';
    var m = parseInt(String(tarih).split('-')[1], 10);
    return (m >= 1 && m <= 12) ? AY_ADLARI[m - 1] : '';
  }

  function _currentTTT() {
    return (typeof LOGGED_IN_USER !== 'undefined' && LOGGED_IN_USER) ? LOGGED_IN_USER : (window.LOGGED_IN_USER || '');
  }
  function _isManager() {
    return _currentTTT() === 'ŞENOL YILMAZ';
  }

  // ── Form HTML yardımcıları ─────────────────────────────────────────
  function _optionsHtml(list, selected) {
    return list.map(function (o) {
      return '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
  }
  function _roField(label, value, id) {
    return '<div><label class="dsy-lbl">' + label + '</label>' +
      '<input type="text" class="inp" id="' + id + '" value="' + value + '" readonly ' +
      'style="width:100%;background:#F1F3F8;color:var(--dim);cursor:not-allowed"></div>';
  }
  function _val(tip, key) {
    var el = document.getElementById('dsy_' + tip + '_' + key);
    return el ? el.value : '';
  }

  function _fieldHtml(tip, f, ttt) {
    var id = 'dsy_' + tip + '_' + f.key;
    if (f.type === 'select') {
      return '<div><label class="dsy-lbl">' + f.label + '</label>' +
        '<select class="inp" id="' + id + '" style="width:100%">' + _optionsHtml(f.options) + '</select></div>';
    }
    if (f.type === 'brick') {
      var bricks = getTTTBricks(ttt);
      var onchange = (tip === 'kongre') ? ' onchange="_dsyBrickChanged(\'' + tip + '\')"' : '';
      return '<div><label class="dsy-lbl">' + f.label + '</label>' +
        '<select class="inp" id="' + id + '" style="width:100%"' + onchange + '>' + _optionsHtml(bricks) + '</select>' +
        '<div style="font-size:9px;color:var(--dim);margin-top:3px">Kendi brick\'lerin listelenir — 333 (ortak brick) her zaman seçenekler arasındadır.</div></div>';
    }
    if (f.type === 'computed' || f.type === 'sira') {
      return '<div><label class="dsy-lbl">' + f.label + '</label>' +
        '<input type="text" class="inp" id="' + id + '" value="" readonly style="width:100%;background:#F1F3F8;color:var(--dim);cursor:not-allowed"></div>';
    }
    var extra = f.recalc ? ' oninput="_dsyRecalcKisiBasi(\'' + tip + '\')"' : '';
    return '<div><label class="dsy-lbl">' + f.label + '</label>' +
      '<input type="' + f.type + '" min="0" class="inp" id="' + id + '" style="width:100%"' + extra + '></div>';
  }

  window._dsyRecalcKisiBasi = function (tip) {
    var k = parseFloat(_val(tip, 'katilimci')) || 0;
    var m = parseFloat(_val(tip, 'maliyet')) || 0;
    var out = document.getElementById('dsy_' + tip + '_kisiBasi');
    if (!out) return;
    out.value = k > 0 ? Math.round(m / k) : '';
  };
  window._dsyBrickChanged = function (tip) {
    var out = document.getElementById('dsy_' + tip + '_ilk333Sira');
    if (!out) return;
    out.value = getBrickSira(_currentTTT(), _val(tip, 'brick'));
  };

  function _buildTipFormHtml(tip, forcedTTT) {
    var ttt = forcedTTT || _currentTTT();
    var lbl = COMMON_LABELS[tip];
    var html = '' +
    '<div class="card mb16">' +
      '<div class="card-hd">' +
        '<span class="card-title" id="dsy_' + tip + '_cardTitle">➕ ' + TIP_LABELS[tip] + ' — Yeni Kayıt</span>' +
        '<span class="card-badge">' + ttt + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="section-h">Otomatik Bilgiler</div>' +
        '<div class="g2" style="gap:10px">' +
          _roField('Bölge', BOLGE_ADI, 'dsy_' + tip + '_bolge') +
          (lbl.showGrupBm ? _roField('Grup', GRUP_ADI, 'dsy_' + tip + '_grup') : '') +
          (lbl.showGrupBm ? _roField('BM', BM_ADI, 'dsy_' + tip + '_bm') : '') +
          _roField(lbl.ttt, ttt, 'dsy_' + tip + '_ttt') +
        '</div>' +
        '<div style="margin-top:10px">' +
          '<label class="dsy-lbl">' + lbl.tarih + '</label>' +
          '<input type="date" class="inp" id="dsy_' + tip + '_tarih" style="width:100%">' +
        '</div>' +
        '<div class="section-h" style="margin-top:14px">Kayıt Bilgileri</div>' +
        '<div class="g2" style="gap:10px">' +
          TIP_FIELDS[tip].map(function (f) { return _fieldHtml(tip, f, ttt); }).join('') +
        '</div>' +
        '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" id="dsy_' + tip + '_actions">' +
          '<button id="dsy_' + tip + '_submitBtn" onclick="_dsySubmit(\'' + tip + '\')" style="padding:8px 18px;border-radius:8px;border:none;background:var(--c1);color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Kaydet</button>' +
          '<span id="dsy_' + tip + '_status" style="font-size:11px;color:var(--dim)"></span>' +
        '</div>' +
      '</div>' +
    '</div>';
    return html;
  }

  // ── Kayıt gönder (yeni kayıt VEYA düzenleme modundaysa güncelleme) ──
  window._dsySubmit = function (tip) {
    var statusEl = document.getElementById('dsy_' + tip + '_status');
    // Düzenleme modunda TTT, kaydın orijinal sahibi olmalı — bu yüzden
    // salt-okunur TTT alanının DEĞERİNDEN okunuyor (o alan _dsyEdit
    // tarafından kaydın sahibiyle dolduruluyor), her zaman şu anki
    // giriş yapan kullanıcıdan değil.
    var editingId = _editing[tip] || null;
    var ttt = _val(tip, 'ttt') || _currentTTT();
    var tarih = _val(tip, 'tarih');
    var brick = _val(tip, 'brick');

    if (!tarih) { if (statusEl) statusEl.textContent = '⚠ ' + COMMON_LABELS[tip].tarih + ' seçilmedi.'; return; }
    if (!brick) { if (statusEl) statusEl.textContent = '⚠ Brick seçilmedi.'; return; }

    var record = {
      id: editingId || _makeId(ttt), tip: tip,
      bolge: BOLGE_ADI, ttt: ttt, brick: brick, tarih: tarih,
      enteredAt: (editingId && _editingSnapshot[tip] && _editingSnapshot[tip].enteredAt) || new Date().toISOString()
    };
    if (editingId) record.updatedAt = new Date().toISOString();
    if (COMMON_LABELS[tip].showGrupBm) { record.grup = GRUP_ADI; record.bm = BM_ADI; }

    var hataVar = false;
    TIP_FIELDS[tip].forEach(function (f) {
      if (f.key === 'brick') return;
      var raw = _val(tip, f.key);
      record[f.key] = (f.type === 'number') ? (parseFloat(raw) || 0) : raw;
    });

    if (tip === 'temsil') {
      record.ay = _ayFromTarih(tarih);
      if (!record.unite) { if (statusEl) statusEl.textContent = '⚠ Ünite alanı boş olamaz.'; hataVar = true; }
    }
    if (tip === 'planlanan' || tip === 'gerceklesen') {
      var k = parseFloat(record.katilimci) || 0, m = parseFloat(record.maliyet) || 0;
      record.kisiBasi = k > 0 ? (m / k) : 0;
      if (k <= 0) { if (statusEl) statusEl.textContent = '⚠ Katılımcı sayısı 0\'dan büyük olmalı.'; hataVar = true; }
    }
    if (tip === 'kongre') {
      if (!record.adSoyad) { if (statusEl) statusEl.textContent = '⚠ Ad-Soyad alanı boş olamaz.'; hataVar = true; }
    }
    if (hataVar) return;

    var local = _loadLocal();
    if (editingId) {
      var idx = -1;
      local.forEach(function (r, i) { if (r && r.id === editingId) idx = i; });
      if (idx >= 0) local[idx] = record; else local.push(record);
      _saveLocal(local);
      _syncUpdateToWorker(record, statusEl);
    } else {
      local.push(record);
      _saveLocal(local);
      _syncToWorker(record, statusEl);
    }
    // NOT: "✓ Kaydedildi" mesajı artık BURADA yazılmıyor — GitHub yanıtı
    // gelene kadar bekleniyor (bkz. _postToWorker). Eskiden yanıt
    // beklenmeden başarı yazıldığı için başarısız senkronlar fark
    // edilmiyordu.

    if (editingId) {
      // Düzenleme bitti — formu tamamen sıfırla ve normal (yeni kayıt) moda dön
      window._dsyCancelEdit(tip);
    } else {
      // Formu kısmen sıfırla (Bölge/Grup/BM/TTT/Brick/Tarih kalıcı kalabilir,
      // tekrarlayan girişte hız için sadece değişken alanlar temizlenir)
      TIP_FIELDS[tip].forEach(function (f) {
        if (f.type === 'brick' || f.type === 'computed' || f.type === 'sira') return;
        var el = document.getElementById('dsy_' + tip + '_' + f.key);
        if (el) el.value = '';
      });
      var kb = document.getElementById('dsy_' + tip + '_kisiBasi'); if (kb) kb.value = '';
    }

    _renderAllTables();
  };

  // ── FAZ 21.0: mevcut bir kaydı düzenlemeye başla ────────────────────
  window._dsyEdit = function (tip, id) {
    var all = _mergedRecords(_remoteCache);
    var rec = null;
    all.forEach(function (r) { if (r && r.id === id) rec = r; });
    if (!rec) { alert('Kayıt bulunamadı — senkronizasyon gecikmiş olabilir, sayfayı yenileyip tekrar dene.'); return; }

    var manager = _isManager();
    var me = _currentTTT();
    if (!manager && rec.ttt !== me) { alert('Sadece kendi kayıtlarını düzenleyebilirsin.'); return; }

    var wrap = document.getElementById('dsyFormWrap_' + tip);
    if (!wrap) return;

    // Formu kaydın SAHİBİ için yeniden kur (brick listesi doğru gelsin diye —
    // yönetici başka bir temsilcinin kaydını düzenlerken o temsilcinin
    // kendi brick'leri listelenmeli, yöneticininkiler değil).
    wrap.innerHTML = _buildTipFormHtml(tip, rec.ttt);
    wrap.style.display = '';

    var tarihEl = document.getElementById('dsy_' + tip + '_tarih'); if (tarihEl) tarihEl.value = rec.tarih || '';
    var brickEl = document.getElementById('dsy_' + tip + '_brick');
    if (brickEl) {
      var hasOpt = false;
      for (var i = 0; i < brickEl.options.length; i++) { if (brickEl.options[i].value === rec.brick) { hasOpt = true; break; } }
      if (!hasOpt && rec.brick) {
        var opt = document.createElement('option');
        opt.value = rec.brick;
        opt.textContent = rec.brick + ' (kayıtlı — güncel brick listesinde yok)';
        brickEl.insertBefore(opt, brickEl.firstChild);
      }
      brickEl.value = rec.brick || '';
    }
    TIP_FIELDS[tip].forEach(function (f) {
      if (f.key === 'brick') return;
      var el = document.getElementById('dsy_' + tip + '_' + f.key);
      if (el) el.value = (rec[f.key] == null ? '' : rec[f.key]);
    });
    if (tip === 'kongre') window._dsyBrickChanged(tip);
    if (tip === 'planlanan' || tip === 'gerceklesen') window._dsyRecalcKisiBasi(tip);

    _editing[tip] = id;
    _editingSnapshot[tip] = rec;
    _setFormModeUI(tip, true);

    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── FAZ 21.0: düzenlemeyi iptal et / kaydettikten sonra normal moda dön ─
  window._dsyCancelEdit = function (tip) {
    _editing[tip] = null;
    _editingSnapshot[tip] = null;
    var manager = _isManager();
    var wrap = document.getElementById('dsyFormWrap_' + tip);
    if (wrap) {
      wrap.innerHTML = _buildTipFormHtml(tip);
      wrap.style.display = manager ? 'none' : '';
    }
    var t = document.getElementById('dsy_' + tip + '_tarih');
    if (t && !t.value) t.value = new Date().toISOString().slice(0, 10);
    if (tip === 'kongre' && !manager) window._dsyBrickChanged(tip);
  };

  // ── FAZ 21.0: form başlığı/buton metnini yeni-kayıt ↔ düzenleme
  // moduna göre günceller, düzenleme modunda bir "İptal" butonu ekler ──
  function _setFormModeUI(tip, editing) {
    var titleEl = document.getElementById('dsy_' + tip + '_cardTitle');
    var btnEl = document.getElementById('dsy_' + tip + '_submitBtn');
    var actionsEl = document.getElementById('dsy_' + tip + '_actions');
    var cancelId = 'dsy_' + tip + '_cancelBtn';
    if (titleEl) titleEl.textContent = (editing ? '✏️ ' : '➕ ') + TIP_LABELS[tip] + (editing ? ' — Kaydı Düzenle' : ' — Yeni Kayıt');
    if (btnEl) btnEl.textContent = editing ? '💾 Güncelle' : '💾 Kaydet';
    var existingCancel = document.getElementById(cancelId);
    if (editing && !existingCancel && actionsEl) {
      var cancelBtn = document.createElement('button');
      cancelBtn.id = cancelId;
      cancelBtn.type = 'button';
      cancelBtn.textContent = '✖ İptal';
      cancelBtn.style.cssText = 'padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:12px;font-weight:600;cursor:pointer';
      cancelBtn.onclick = function () { window._dsyCancelEdit(tip); };
      actionsEl.appendChild(cancelBtn);
    } else if (!editing && existingCancel) {
      existingCancel.remove();
    }
  }

  // ── FAZ 21.0: kayıt sil ───────────────────────────────────────────────
  window._dsyDelete = function (tip, id) {
    var all = _mergedRecords(_remoteCache);
    var rec = null;
    all.forEach(function (r) { if (r && r.id === id) rec = r; });
    if (!rec) { alert('Kayıt bulunamadı.'); return; }

    var manager = _isManager();
    var me = _currentTTT();
    if (!manager && rec.ttt !== me) { alert('Sadece kendi kayıtlarını silebilirsin.'); return; }
    if (!window.confirm('Bu kaydı silmek istediğine emin misin? Bu işlem geri alınamaz.')) return;

    var local = _loadLocal().filter(function (r) { return r.id !== id; });
    _saveLocal(local);
    _addDeleted(id);
    _syncDeleteToWorker(id, rec.ttt);

    if (_editing[tip] === id) window._dsyCancelEdit(tip);

    _renderAllTables();
  };

  // ── Tablo + Excel export ────────────────────────────────────────────
  function _recordTip(r) { return r && r.tip ? r.tip : 'gerceklesen'; } // geriye dönük uyumluluk (FAZ 19.0 kayıtları)

  function _visibleRecordsForTip(tip, all) {
    var manager = _isManager();
    var ttt = _currentTTT();
    return all.filter(function (r) { return _recordTip(r) === tip; })
              .filter(function (r) { return manager || r.ttt === ttt; });
  }

  function _renderTipTable(tip, all) {
    var el = document.getElementById('dsyTableWrap_' + tip);
    if (!el) return;
    var manager = _isManager();
    var me = _currentTTT();
    var rows = _visibleRecordsForTip(tip, all);
    var cols = TABLE_COLS[tip].filter(function (c) { return manager || !c.managerOnly; });

    var head = '<tr>' + cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th>İşlemler</th></tr>';
    var body = rows.length === 0
      ? '<tr><td colspan="' + (cols.length + 1) + '" style="text-align:center;color:var(--dim);padding:14px">Henüz kayıt yok.</td></tr>'
      : rows.map(function (r) {
          var canEdit = manager || r.ttt === me;
          var actions = canEdit
            ? '<div style="display:flex;gap:6px;white-space:nowrap">' +
                '<button onclick="_dsyEdit(\'' + tip + '\',\'' + r.id + '\')" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surf);color:var(--c1);font-size:10px;font-weight:700;cursor:pointer">✏️ Düzenle</button>' +
                '<button onclick="_dsyDelete(\'' + tip + '\',\'' + r.id + '\')" style="padding:4px 9px;border-radius:6px;border:1px solid #FCA5A5;background:#FEF2F2;color:#DC2626;font-size:10px;font-weight:700;cursor:pointer">🗑️ Sil</button>' +
              '</div>'
            : '<span style="color:var(--dim);font-size:10px">—</span>';
          return '<tr>' + cols.map(function (c) {
            var v = r[c.key];
            if (c.money) v = (typeof fTL === 'function') ? fTL(v) : v;
            return '<td>' + (v == null || v === '' ? '—' : v) + '</td>';
          }).join('') + '<td>' + actions + '</td></tr>';
        }).join('');

    el.innerHTML = '<div style="overflow-x:auto"><table class="tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';

    var countEl = document.getElementById('dsyCount_' + tip);
    if (countEl) countEl.textContent = rows.length + ' kayıt' + (manager ? ' (tüm temsilciler)' : '');
  }

  function _renderAllTables() {
    _renderSyncBanner();
    var merged = _mergedRecords(_remoteCache);
    TIPLER.forEach(function (tip) { _renderTipTable(tip, merged); });
    _fetchRemote().then(function (remote) {
      if (remote) {
        _remoteCache = remote;
        var m2 = _mergedRecords(remote);
        TIPLER.forEach(function (tip) { _renderTipTable(tip, m2); });
      }
    });
  }

  // "Masraf Dosyası" → tek dosya, orijinal SAMSUN_AYLIK_MASRAF_DOSYASI.xlsx
  // düzeninde 3 sayfa (Temsil Masraf Detay / Planlanan Merkez Ödeme /
  // Gerçekleşen Merkez Ödeme).
  window.exportMasrafExcel = function () {
    if (typeof XLSX === 'undefined') { alert('Excel kütüphanesi yüklenemedi.'); return; }
    var manager = _isManager();
    var all = _mergedRecords(_remoteCache);
    var wb = XLSX.utils.book_new();

    ['temsil', 'planlanan', 'gerceklesen'].forEach(function (tip) {
      var rows = _visibleRecordsForTip(tip, all);
      var cols = TABLE_COLS[tip].filter(function (c) { return manager || !c.managerOnly; });
      var sheetData = rows.map(function (r) {
        var row = {};
        cols.forEach(function (c) { row[c.label] = r[c.key] == null ? '' : r[c.key]; });
        return row;
      });
      var ws = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, TIP_LABELS[tip]);
    });

    var fname = 'SAMSUN_AYLIK_MASRAF_DOSYASI_' + (manager ? 'TUM_TEMSILCILER' : _currentTTT().replace(/\s+/g, '_')) + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, fname);
  };

  window.exportKongreExcel = function () {
    if (typeof XLSX === 'undefined') { alert('Excel kütüphanesi yüklenemedi.'); return; }
    var manager = _isManager();
    var all = _mergedRecords(_remoteCache);
    var rows = _visibleRecordsForTip('kongre', all);
    var cols = TABLE_COLS.kongre.filter(function (c) { return manager || !c.managerOnly; });
    var sheetData = rows.map(function (r) {
      var row = {};
      cols.forEach(function (c) { row[c.label] = r[c.key] == null ? '' : r[c.key]; });
      return row;
    });
    var ws = XLSX.utils.json_to_sheet(sheetData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'kongre');
    XLSX.writeFile(wb, 'Kongre_Katilimci_Bilgileri_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  };

  // ── Sekme geçişleri (mevcut .eczsub-bar / .eczsub-tab deseniyle aynı —
  // bkz. Eczane Satış sayfası, style.css satır ~640) ────────────────────
  // Kullanıcı bildirimi: Dosyalar sayfası "tek sayfa" gibi duruyordu —
  // Sabit Formlar kartı sekmelerden BAĞIMSIZ her zaman en üstte görünüyor,
  // Masraf/Kongre arasında sadece görünürlük değişiyordu. Artık üçü de
  // (sabit/masraf/kongre) sidebar'daki 3 alt-öğeyle (navsub_dsy_*) birebir
  // eşleşen, aynı anda sadece BİRİ görünür olan ayrı alt-sayfalar.
  window._dsyShowMain = function (name) {
    var _mainEl = document.getElementById('main');
    if (_mainEl) _mainEl.scrollTop = 0;
    ['sabit', 'masraf', 'kongre'].forEach(function (n) {
      var sec = document.getElementById('dsyMain_' + n);
      var tab = document.getElementById('dsyMainTab_' + n);
      if (sec) sec.style.display = (n === name) ? '' : 'none';
      if (tab) tab.classList.toggle('active', n === name);
    });
    // Sidebar'daki (Dosyalar > Sabit Formlar/Masraf/Kongre) alt-öğe
    // vurgusunu senkronize et
    if (typeof window.pvSyncSubNav === 'function') window.pvSyncSubNav('navsub_dsy_' + name);
  };
  window._dsyShowSub = function (name) {
    ['temsil', 'planlanan', 'gerceklesen'].forEach(function (n) {
      var sec = document.getElementById('dsySub_' + n);
      var tab = document.getElementById('dsySubTab_' + n);
      if (sec) sec.style.display = (n === name) ? '' : 'none';
      if (tab) tab.classList.toggle('active', n === name);
    });
  };

  function _tipPanelHtml(tip, manager) {
    var html = '';
    if (manager) {
      html += '<div class="card mb16"><div class="card-body" style="font-size:12px;color:var(--dim)">' +
        '📋 Bölge Müdürü görünümü — bu sekmedeki tüm temsilci kayıtları aşağıda listelenir. ' +
        'Bir kaydı düzenlemek için satırdaki "✏️ Düzenle" butonunu kullan.</div></div>';
    }
    // Form her zaman DOM'da kurulu — temsilci için görünür (yeni kayıt),
    // yönetici için "✏️ Düzenle" tıklanana kadar gizli (FAZ 21.0).
    html += '<div id="dsyFormWrap_' + tip + '"' + (manager ? ' style="display:none"' : '') + '>' + _buildTipFormHtml(tip) + '</div>';
    html += '' +
      '<div class="card">' +
        '<div class="card-hd">' +
          '<span class="card-title">🗂️ ' + (manager ? 'Tüm Temsilci Kayıtları' : 'Girdiğim Kayıtlar') + '</span>' +
          '<span class="card-badge" id="dsyCount_' + tip + '">—</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div id="dsyTableWrap_' + tip + '"></div>' +
        '</div>' +
      '</div>';
    return html;
  }

  // ── Ana sayfa render (goPage(8) tarafından çağrılır) ────────────────
  window.renderDosyalarPage = function () {
    var page = document.getElementById('page8');
    if (!page) return;
    var manager = _isManager();

    var html = '';

    // FAZ 22.0 — GitHub'a yazılamamış kayıt uyarı şeridi (içeriği
    // _renderSyncBanner() doldurur; bekleyen kayıt yoksa gizli kalır).
    // Masraf/Kongre kayıtlarıyla ilgili olduğundan, hangi alt-sayfa açık
    // olursa olsun her zaman en üstte görünür kalır.
    html += '<div id="dsySyncBanner" style="display:none"></div>';

    // Ana başlıklar: Sabit Formlar / Masraf Dosyası / Kongre Katılımcı
    // Bilgileri — üçü gerçekten AYRI alt-sayfalar (aynı anda sadece biri
    // görünür). Kullanıcı isteği: bu sayfanın en üstünde sidebar'ı
    // tekrarlayan bağlantı şeridi kaldırıldı — giriş SADECE sol menüdeki
    // "Dosyalar" alt-öğelerinden (Sabit Formlar / Masraf Dosyası / Kongre
    // Katılımcı Bilgileri) yapılıyor. _dsyShowMain() hâlâ aynı şekilde
    // çalışıyor (sidebar'daki goDosyaSub() onu çağırıyor); dsyMainTab_*
    // elemanları artık DOM'da olmadığından o satırlar sessizce atlanıyor.

    // ── Sabit Formlar bölümü ──
    html += '<div id="dsyMain_sabit" style="display:none">' + _fixedFormsHtml() + '</div>';

    // ── Masraf Dosyası bölümü ──
    html += '<div id="dsyMain_masraf">';
    html += '<div class="eczsub-bar dsy-eczsub-bar">' +
      '<div class="eczsub-tab active" id="dsySubTab_temsil" onclick="_dsyShowSub(\'temsil\')">Temsil Masraf Detay</div>' +
      '<div class="eczsub-tab" id="dsySubTab_planlanan" onclick="_dsyShowSub(\'planlanan\')">Planlanan Merkez Ödeme</div>' +
      '<div class="eczsub-tab" id="dsySubTab_gerceklesen" onclick="_dsyShowSub(\'gerceklesen\')">Gerçekleşen Merkez Ödeme</div>' +
    '</div>';
    html += '<div class="card mb16"><div class="card-body">' +
      '<button onclick="exportMasrafExcel()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surf);font-size:11px;font-weight:600;cursor:pointer;color:var(--c1)">📥 Excel İndir (3 sayfa, tek dosya)</button>' +
    '</div></div>';
    html += '<div id="dsySub_temsil">' + _tipPanelHtml('temsil', manager) + '</div>';
    html += '<div id="dsySub_planlanan" style="display:none">' + _tipPanelHtml('planlanan', manager) + '</div>';
    html += '<div id="dsySub_gerceklesen" style="display:none">' + _tipPanelHtml('gerceklesen', manager) + '</div>';
    html += '</div>'; // /dsyMain_masraf

    // ── Kongre Katılımcı Bilgileri bölümü ──
    html += '<div id="dsyMain_kongre" style="display:none">';
    html += '<div class="card mb16"><div class="card-body">' +
      '<button onclick="exportKongreExcel()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surf);font-size:11px;font-weight:600;cursor:pointer;color:var(--c1)">📥 Excel İndir</button>' +
    '</div></div>';
    html += _tipPanelHtml('kongre', manager);
    html += '</div>'; // /dsyMain_kongre

    page.innerHTML = html;

    // Bugünün tarihi varsayılan olsun (form varsa)
    TIPLER.forEach(function (tip) {
      var t = document.getElementById('dsy_' + tip + '_tarih');
      if (t && !t.value) t.value = new Date().toISOString().slice(0, 10);
    });
    // Kongre bricki varsayılan seçiliyken sıra otomatik dolsun
    if (!manager) window._dsyBrickChanged('kongre');

    _renderAllTables();
  };

  // ── FAZ 22.1: Yönetici paneli (page7) için salt-okunur veri köprüsü ──
  // Amaç: "📁 Dosyalar Özeti" kartı (js/ui/dosyalar-manager-summary.js)
  // kayıtları AYNI kaynaktan ve AYNI birleştirme mantığıyla okusun —
  // GitHub (raw) + yerel localStorage + silinenler. Burada sadece mevcut
  // private fonksiyonlar dışarı açılıyor; hiçbir davranış değişmedi.
  window.PV_DOSYALAR_API = {
    fetchRemote: function () { return _fetchRemote(); },
    merged: function (remote) { return _mergedRecords(remote === undefined ? _remoteCache : remote); },
    setRemoteCache: function (r) { if (r) _remoteCache = r; },
    tipOf: function (r) { return _recordTip(r); },
    TIP_LABELS: TIP_LABELS,
    TIPLER: TIPLER
  };

  console.debug('[dosyalar-page] FAZ 20.0 yüklendi (Masraf Dosyası 3 sekme + Kongre Katılımcı Bilgileri).');
})();
