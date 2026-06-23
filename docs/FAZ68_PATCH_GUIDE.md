# FAZ 6.8 — Team Learning: Uygulama Kılavuzu

**Tarih:** 2026-06-23  
**Durum:** Kod üretildi — aşağıdaki 3 adım uygulandıktan sonra aktif olur.

---

## Üretilen Dosya

```
js/ai/decision/team-learning.js   ← YENİ (bu dosya)
```

Başka hiçbir mevcut dosya değiştirilmiyor.

---

## Adım 1 — Dosyayı projeye ekle

```
js/ai/decision/
├── competitive-impact-engine.js   (FAZ 6.6 — mevcut)
├── opportunity-score-engine.js    (FAZ 6.5 — mevcut)
├── decision-engine.js             (FAZ 6.7 — mevcut)
└── team-learning.js               ← YENİ
```

---

## Adım 2 — index.html'e script etiketi ekle

`index.html`'de şu satırı bul:

```html
<script src="js/ai/decision/decision-engine.js"></script>
<!-- END FAZ 6.7 Decision Engine -->
```

Hemen ALTINA ekle:

```html
<!-- FAZ 6.8: Team Learning (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §8, §16)
     En başarılı temsilci davranışını öğrenir ve yöneticiye + diğer
     temsilcilere "ne işe yarıyor?" bilgisini sunar.
     LearningHub.getTeamBestPractices() (FAZ 6.2) × team-ranking-engine'i
     bağlar; her ikisini de DEĞİŞTİRMEZ.
     executive-engine.js'in buildExecutiveDashboard() çıktısına
     enrichExecutiveDashboard() ile teamLearning alanı ekler.
     Rollback: bu satırı silmek hiçbir şeyi KIRMAZ. -->
<script src="js/ai/decision/team-learning.js"></script>
<!-- END FAZ 6.8 Team Learning -->
```

---

## Adım 3 — ExecutiveDashboard'a Team Learning ekle (opsiyonel ama önerilen)

`js/ai/executive/executive-engine.js` dosyasında `buildExecutiveDashboard()` fonksiyonunu bulmak için aşağıya inin ve şu satırı bulun:

```javascript
    console.debug('[executive-engine] buildExecutiveDashboard OK.',
```

Bu satırın **hemen öncesine** (try bloğunun kapanış parantezinden önce) ekle:

```javascript
      // FAZ 6.8 — Team Learning zenginleştirmesi (TeamLearning opsiyonel)
      if (window.TeamLearning &&
          typeof window.TeamLearning.enrichExecutiveDashboard === 'function') {
        window.TeamLearning.enrichExecutiveDashboard(report);
      }
```

> executive-engine.js'de **başka hiçbir şey değişmez** — sadece bu 4 satır eklenir.

---

## API Özeti

```javascript
// Tüm ekip için en iyi uygulama içgörüleri
var insights = window.TeamLearning.getTeamLearningInsights(['TTT1','TTT2']);
// → TeamLearningInsight[] — type: 'TEAM_SUMMARY' | 'BEST_PRACTICE'

// Tek temsilciye kişisel koçluk ipuçları
var hints = window.TeamLearning.getPersonalCoachingHints('TTT1');
// → TeamLearningInsight[] — type: 'PERSONAL_COACHING'

// AI Context / Dashboard için yapısal özet
var ctx = window.TeamLearning.getTeamLearningContext();
// ctx → {
//   totalSamples, avgSuccessRate, practiceCount,
//   bestProduct: { name, successRate },
//   bestBrick: { name, sampleCount },
//   bestActionType: { name, successRate },
//   topInsights: [...],
//   dataAvailable: bool
// }

// Executive Dashboard'u yerinde zenginleştir
var dash = buildExecutiveDashboard();
window.TeamLearning.enrichExecutiveDashboard(dash);
// dash.teamLearning artık { context, insights } içeriyor
```

### TeamLearningInsight modeli

| Alan | Açıklama |
|------|----------|
| `type` | `BEST_PRACTICE` / `PERSONAL_COACHING` / `TEAM_SUMMARY` |
| `targetTTT` | Kişisel ipuçları için temsilci kodu, ekip için `null` |
| `brick` / `product` | Hangi bölge/ürün bağlamında |
| `insight` | Actionable, insan-okur cümle |
| `successRate` | 0-100 |
| `confidence` | `HIGH` / `MEDIUM` / `LOW` |

---

## Rollback

1. `index.html`'den `team-learning.js` script etiketini sil.
2. `executive-engine.js`'e eklenen 4 satırı (varsa) geri al.
3. `js/ai/decision/team-learning.js` dosyasını sil.

---

## Önemli Kısıtlama (tasarım kararı)

PatternLearningEngine'in IndexedDB index'leri temsilci (ttt) bazlı değil — brick/ürün/aksiyon tipi bazlı. Bu yüzden **"hangi temsilci başarılı çünkü X yapıyor"** sorusu doğrudan bu motordan cevaplanamıyor. Bunun yerine:

- **Hangi brick+ürün+aksiyon tipi** en yüksek başarı oranında? (PatternLearningEngine)
- **Hangi temsilci** o brick'te şu an zayıf performans gösteriyor? (OpportunityScoreEngine / team-ranking)
- İkisi çakışınca → o temsilciye o pattern önerilebilir.

Bu, kesin nedensellik iddiası değil — her insight `confidence` alanıyla beraber sunulur.

---

## Sıradaki Faz

**FAZ 6.9 — Yönetici ekranları yeniden tasarımı**  
Executive/Territory/Autonomous "headless" motorların gerçek UI kartlarına bağlanması.  
Bağımlılık: FAZ 6.0–6.8 — artık tümü hazır.
