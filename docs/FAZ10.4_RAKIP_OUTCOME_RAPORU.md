# FAZ 10.4 — Rakip Intelligence ↔ Outcome İlişkilendirme Raporu

## Yeni Dosya: `js/ai/core/competitive-outcome-linker.js`

### Görev Ayrımı

| Modül | Kaynak | Soru |
|-------|--------|------|
| `competitive-impact-engine.js` (FAZ 6.6) | IMS pazar payı | "Rakip etkili oldu mu?" (istatistiksel) |
| `competitive-outcome-linker.js` (FAZ 10.4) | CSV kampanya + outcome-tracker | "Kampanya sırasında outcome ne oldu?" (gözlemsel) |

### API

```js
// Tek kampanya → outcome bağlantısı
CompetitiveOutcomeLinker.linkCampaignToOutcomes(campaign) → Promise<CampaignOutcomeLink>

// Tüm rakip kampanyaları → link listesi + PatternLearning beslemesi
CompetitiveOutcomeLinker.buildAllCampaignLinks(tttFilter?) → Promise<CampaignOutcomeLink[]>
```

### CampaignOutcomeLink Şeması

```js
{
  campaign:     { firma, ilacGrubu, kampanya, baslangic? },
  outcomes:     [],           // kampanya başlangıcından sonraki ilgili outcome'lar
  successCount: number,
  failCount:    number,
  impactScore:  number,       // 0-100 (başarı oranı × outcome hacmi bileşimi)
  note:         string        // Türkçe insan-okur özet
}
```

### Learning Loop Entegrasyonu

`buildAllCampaignLinks()` tamamlandıktan sonra:
1. Her link'teki outcome'lara `competitiveContext: { firma, ilacGrubu, impactScore }` eklenir
2. `PatternLearningEngine.updateLearningPatterns(enrichedOutcome)` çağrılır
3. Mevcut Pattern öğrenme mekanizması **DEĞİŞTİRİLMEDİ** — sadece yeni girdi

### Eşleşme Mantığı

- **Ürün eşleşmesi:** `outcome.product` veya `outcome.brick` içinde `campaign.ilacGrubu` geçiyorsa
- **Tarih filtresi:** `evaluatedAt` veya `recommendedAt` ≥ kampanya başlangıç tarihi
- **Sadece rakip kampanyaları:** `isOwn: false && kampanya: true`

## Değiştirilen Dosyalar
- `js/ai/core/competitive-outcome-linker.js` — YENİ
- `index.html` — `<script src="js/ai/core/competitive-outcome-linker.js">` eklendi
