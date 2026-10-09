#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════
#  tools/make_users.py — PHARMA VISION kullanıcı hesapları + şifreler (Cloudflare PV_USERS için)
#
#  Ne yapar: her kullanıcı için rastgele güçlü bir şifre üretir, PBKDF2-SHA256 (100.000 tur, tuzlu)
#  özetini hesaplar (worker/worker.js ile birebir aynı algoritma) ve üç dosya yazar:
#    guvenlik_cikti/pv_users.json      → Cloudflare'de  PV_USERS  secret'ının DEĞERİ (tek satır JSON)
#    guvenlik_cikti/pv_jwt_secret.txt  → Cloudflare'de  PV_JWT_SECRET  secret'ının DEĞERİ
#    guvenlik_cikti/sifreler.txt       → kullanıcılara dağıtacağınız şifre listesi (YALNIZ SİZDE kalır)
#
#  Çalıştırma (Windows PowerShell, repo klasöründe):   python tools/make_users.py
#  Şifreleri KENDİNİZ belirlemek (hatırlanabilir):        python tools/make_users.py --elle
#  Tek kişiyi yenilemek (unutulan şifre):               python tools/make_users.py --yenile "AYKUT DİNLER"   (--elle ile birleşir)
#
#  ⚠ guvenlik_cikti/ klasörü .gitignore'dadır — ASLA GitHub'a göndermeyin. Düz şifreler yalnız
#    sifreler.txt'de durur; dağıtımdan sonra silin (şifre özeti worker'da kalır, düz şifre kalmaz).
# ══════════════════════════════════════════════════════════════════════
import argparse, base64, hashlib, json, os, secrets, sys

ITER = 100000                                   # worker/pv-auth-module ile aynı (Workers üst sınırı)
ALFABE = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # karışabilen karakterler (0/O, 1/l/I) yok
HESAPLAR = [                                    # index.html VALID_USERS'ın büyük harfli (kanonik) adları
    ('ŞENOL YILMAZ', 'admin'), ('ADMIN', 'admin'), ('YILMAZ USTA', 'manager'),
    ('AYKUT DİNLER', 'rep'), ('HAKAN YUMAK', 'rep'), ('KÜRŞAD KARADAĞ', 'rep'),
    ('MEHMET AKİF ÖZGEÇEN', 'rep'), ('MURAT KANDİŞ', 'rep'), ('SAMET ÇETİN', 'rep'), ('ENİS TOK', 'rep'),
]
CIKTI = 'guvenlik_cikti'

ESKI_ORTAK = {'ilko2030'}                       # sızmış eski ortak şifre — asla kabul edilmez
TR = str.maketrans('çğıöşüÇĞİÖŞÜ', 'cgiosuCGIOSU')

def ascii_kucuk(x):
    return x.translate(TR).lower()

def sifre_dogrula(ad, sifre):
    """Elle girilen şifre için kurallar. Sorun varsa Türkçe açıklama döner, yoksa None."""
    if len(sifre) < 10:
        return 'En az 10 karakter olmalı (şu an %d).' % len(sifre)
    if sifre != sifre.strip():
        return 'Başında/sonunda boşluk olmamalı.'
    if any(ord(c) > 127 for c in sifre):
        return 'Türkçe/özel harf (ç ğ ı ö ş ü …) kullanmayın: farklı telefon/klavyelerde giriş sorunu çıkarır. ASCII yazın (Kursad yerine Kursad, ğ yerine g gibi).'
    k = ascii_kucuk(sifre)
    if k in ESKI_ORTAK or 'ilko2030' in k:
        return 'Eski ortak şifre (ilko2030) ya da onu içeren şifre kullanılamaz.'
    for parca in ascii_kucuk(ad).replace('ı', 'i').split():
        if len(parca) >= 4 and parca in k:
            return 'Şifre kişinin adını/soyadını içermemeli (%s).' % parca
    if sifre.isdigit() or sifre.isalpha():
        return 'Yalnız rakam ya da yalnız harf olmamalı; en az bir rakam (veya işaret) ve harf karıştırın.'
    if len(set(sifre)) < 5:
        return 'Çok tekrarlı karakterler (ör. aaaa1111).'
    return None

def elle_sifre_sor(ad):
    import getpass
    while True:
        s1 = getpass.getpass('  %s için şifre (yazarken görünmez; Enter = rastgele üret): ' % ad)
        if s1 == '': return None
        sorun = sifre_dogrula(ad, s1)
        if sorun:
            print('   ✗', sorun); continue
        s2 = getpass.getpass('  Aynı şifreyi tekrar yazın: ')
        if s1 != s2:
            print('   ✗ İki giriş aynı değil, tekrar deneyin.'); continue
        return s1

def sifre_uret(n=12):
    return ''.join(secrets.choice(ALFABE) for _ in range(n))

def ozet(sifre, tuz_bytes):
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', sifre.encode('utf-8'), tuz_bytes, ITER, 32)).decode()

def oku_json(yol):
    try:
        with open(yol, encoding='utf-8') as f: return json.load(f)
    except FileNotFoundError:
        return {}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--yenile', action='append', default=[], help='yalnız bu kullanıcının şifresini yenile (birden çok kez verilebilir)')
    ap.add_argument('--elle', action='store_true', help='şifreleri kendiniz yazın (yazarken görünmez); boş bırakılan kişiye rastgele şifre üretilir')
    a = ap.parse_args()
    os.makedirs(CIKTI, exist_ok=True)
    yol_json = os.path.join(CIKTI, 'pv_users.json'); yol_txt = os.path.join(CIKTI, 'sifreler.txt')
    mevcut = oku_json(yol_json)
    hedef = [(n, r) for n, r in HESAPLAR if (not a.yenile or n in [x.upper() for x in a.yenile] or n in a.yenile)]
    if a.yenile and not hedef:
        sys.exit('Bulunamadı: ' + ', '.join(a.yenile) + '\nGeçerli adlar: ' + ', '.join(n for n, _ in HESAPLAR))
    yeni_sifreler = {}
    for ad, rol in hedef:
        sifre = elle_sifre_sor(ad) if a.elle else None
        elle = sifre is not None
        if not elle: sifre = sifre_uret()
        tuz = secrets.token_bytes(16)
        mevcut[ad] = {'salt': base64.b64encode(tuz).decode(), 'hash': ozet(sifre, tuz), 'role': rol}
        yeni_sifreler[ad] = (rol, sifre if not elle else None)      # elle girilen düz şifre HİÇBİR dosyaya yazılmaz
    with open(yol_json, 'w', encoding='utf-8') as f: json.dump(mevcut, f, ensure_ascii=False, separators=(',', ':'))
    yol_jwt = os.path.join(CIKTI, 'pv_jwt_secret.txt')
    if not os.path.exists(yol_jwt):                       # mevcut sır varsa DEĞİŞTİRME (herkesin oturumu düşmesin)
        with open(yol_jwt, 'w', encoding='utf-8') as f: f.write(base64.b64encode(secrets.token_bytes(32)).decode())
    # sifreler.txt: --yenile'de mevcut satırları koru, yalnız yenilenenleri GÜNCELLE (eski şifre satırı kalmasın)
    import re
    tum = {}
    if a.yenile and os.path.exists(yol_txt):
        with open(yol_txt, encoding='utf-8') as f:
            for satir in f:
                m = re.match(r'^(.+?)\s+\((\w+)\s*\)\s+(.+?)\s*$', satir)
                if m: tum[m.group(1).strip()] = (m.group(2), None if m.group(3).startswith('(elle') else m.group(3))
    tum.update(yeni_sifreler)
    with open(yol_txt, 'w', encoding='utf-8') as f:
        f.write('# PHARMA VISION kişisel şifreler — dağıtımdan sonra BU DOSYAYI SİLİN\n')
        for ad, rol in HESAPLAR:
            if ad in tum: f.write(f'{ad:24s} ({tum[ad][0]:7s})  {tum[ad][1] or "(elle belirlendi — dosyada saklanmaz)"}\n')
    print(f'\n✔ {len(yeni_sifreler)} hesap hazırlandı → {CIKTI}/')
    for ad, (rol, s) in yeni_sifreler.items(): print(f'   {ad:24s} {rol:8s} {s if s else "(elle belirlendi)"}')
    print(f'\nSıradaki adım: Cloudflare → Worker → Settings → Variables and Secrets:\n'
          f'   PV_USERS      = {yol_json} dosyasının TÜM içeriği (Secret)\n'
          f'   PV_JWT_SECRET = {yol_jwt} dosyasının içeriği (Secret)')

if __name__ == '__main__':
    main()
