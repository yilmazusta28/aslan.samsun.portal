# Bağımlılık Haritası

```mermaid
graph TD
    CDN["Chart.js (CDN)"]
    
    subgraph CONFIG ["js/config/"]
        CONST["constants.js<br/>CARPAN_TABLE, MIGI_MATRIX,<br/>URUN_ORDER, PERIODS,<br/>HOLIDAYS, URL'ler,<br/>LOGIN sabitler"]
    end

    subgraph UTILS ["js/utils/"]
        FMT["formatters.js<br/>fTL, fK, fPct,<br/>pCls, barCls,<br/>drugLabel, getPazColor"]
        DATE["date-utils.js<br/>workDays()<br/>getCurrentPeriod()"]
        MATH["math-utils.js<br/>getCarpan()<br/>getMiGiKatsayi()<br/>calcPrimPuani()<br/>calcPrimForTTT()"]
    end

    subgraph DATA ["js/data/"]
        NORM["data-normalizer.js<br/>stripTR()<br/>normTTT()"]
        CSV["csv-parser.js<br/>detectSeparator()<br/>parseN()<br/>parseIMSCSV()<br/>parseGenelCSV()<br/>parseMiGiBrickCSV()<br/>parseEczaneCSV()"]
        STOR["storage.js<br/>loadProxyUrl()<br/>saveProxyUrl()<br/>testProxy()"]
    end

    subgraph RENDER ["js/render/"]
        CHARTS["charts.js<br/>mkChart()<br/>destroyChart()"]
        TABLES["tables.js<br/>(Phase 2)<br/>renderGenelTablo()<br/>renderTTTDetail()"]
        PHARMA["pharmacy-renderer.js<br/>(Phase 2)<br/>renderEczane()"]
        AIRNDR["ai-renderer.js<br/>(Phase 2)<br/>renderAiAsistan()"]
    end

    subgraph ENGINES ["js/engines/"]
        RR["runrate-engine.js<br/>(Phase 2)<br/>Projeksiyon"]
        PREM["premium-engine.js<br/>(Phase 2)<br/>calcPrim()"]
        MIGI["migi-engine.js<br/>(Phase 2)<br/>initMigi1/2()"]
    end

    subgraph AI ["js/ai/"]
        AIENG["ai-engine.js<br/>(Phase 3)<br/>sendAiMsg()<br/>runEngine()"]
    end

    MAIN["main.js<br/>(Phase 3)<br/>initApp()<br/>syncData()<br/>goPage()"]

    %% Dependencies
    CONST --> FMT
    CONST --> DATE
    CONST --> MATH
    CONST --> NORM
    CONST --> CSV
    CONST --> STOR

    FMT --> CHARTS
    FMT --> TABLES
    FMT --> PHARMA
    FMT --> AIRNDR
    FMT --> RR
    FMT --> PREM

    DATE --> RR
    DATE --> PREM
    DATE --> AIENG

    MATH --> PREM
    MATH --> AIENG

    NORM --> CSV
    CSV --> PHARMA

    CHARTS --> TABLES
    CHARTS --> PHARMA

    RR --> AIENG
    PREM --> AIENG
    MIGI --> AIENG

    TABLES --> AIRNDR
    PHARMA --> AIENG
    AIRNDR --> AIENG

    CDN --> CHARTS

    AIENG --> MAIN
    TABLES --> MAIN
    STOR --> MAIN

    style CONST fill:#4F008C,color:#fff
    style FMT fill:#0891B2,color:#fff
    style DATE fill:#0891B2,color:#fff
    style MATH fill:#0891B2,color:#fff
    style NORM fill:#059669,color:#fff
    style CSV fill:#059669,color:#fff
    style STOR fill:#059669,color:#fff
    style CHARTS fill:#D97706,color:#fff
    style TABLES fill:#94A3B8,color:#fff
    style PHARMA fill:#94A3B8,color:#fff
    style AIRNDR fill:#94A3B8,color:#fff
    style RR fill:#7C3AED,color:#fff
    style PREM fill:#7C3AED,color:#fff
    style MIGI fill:#7C3AED,color:#fff
    style AIENG fill:#DC2626,color:#fff
    style MAIN fill:#1E293B,color:#fff
```

## Efsane

| Renk | Katman | Phase |
|------|--------|-------|
| 🟣 Mor | Config | Phase 1 ✅ |
| 🔵 Mavi | Utils | Phase 1 ✅ |
| 🟢 Yeşil | Data | Phase 1 ✅ |
| 🟠 Turuncu | Render/Charts | Phase 1 ✅ |
| ⚫ Gri | Render/Tables | Phase 2 |
| 🟤 Mor açık | Engines | Phase 2 |
| 🔴 Kırmızı | AI Engine | Phase 3 |
| ⚫ Koyu | Main | Phase 3 |
