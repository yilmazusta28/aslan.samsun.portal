# vendor/ — kendi sunucumuzdan servis edilen üçüncü taraf kütüphaneler

Eskiden `cdnjs.cloudflare.com`'dan yükleniyordu (SRI yok → CDN ele geçirilirse tüm uygulama etkilenir).
Artık npm paketlerinin birebir dosyaları repoda; `SHA256SUMS.txt` ile doğrulanabilir.

| Dosya | Paket | Sürüm | Lisans |
|---|---|---|---|
| chart.umd.min.js | chart.js (`dist/chart.umd.js`) | 4.4.1 | MIT |
| papaparse.min.js | papaparse | 5.4.1 | MIT |
| xlsx.full.min.js | xlsx (SheetJS) | 0.18.5 | Apache-2.0 |

Güncelleme: `npm pack <paket>@<sürüm>` → dosyayı kopyala → `sha256sum *.js > SHA256SUMS.txt` → index.html'deki `?v=` değerini artır.
Not: xlsx 0.18.5 için bilinen açıklar (CVE-2023-30533, CVE-2024-22363) var; uygulama yalnızca DIŞA AKTARMA
kullanıyor (güvenilmeyen xlsx dosyası okumuyor) — okuma eklenirse 0.20.x'e geçilmeli.
