// ══════════════════════════════════════════════════════════════════════
//  js/ai/recommendation-memory.js
//  PHARMA VISION — Recommendation Memory System
//
//  Sorumluluk:
//    AI tarafından oluşturulan tüm önerileri localStorage'da saklar.
//
//  Public API (ES Module exports):
//    saveRecommendation(rec)                              → savedRec | null
//    getRecommendations()                                 → rec[]
//    getRecommendationById(id)                            → rec | null
//    updateRecommendationOutcome(id, outcome, outcomeValue) → rec | null
//    deleteOldRecommendations(maxItems = 500)             → deletedCount
//
//  Depolama anahtarı : pharma_recommendation_memory_v1
//  Max kayıt        : 500 (en eski silinir)
//  Bozuk veri       : otomatik sıfırla
//  Duplicate kontrolü: representative + action + brick + pharmacy + gün
//                       aynıysa yeni kayıt oluşturulmaz, mevcut kayıt döner.
//
//  Tasarım ilkeleri:
//    • Saf JavaScript — dış bağımlılık yok
//    • ES Module export (GitHub Pages + modern bundler uyumlu)
//    • Tüm public fonksiyonlar try/catch ile sarılı
//    • Unit test yazılabilecek şekilde bağımsız (side-effect yok)
//
//  Classic <script> köprüsü:
//    Bu dosya <script type="module"> ile yüklenir. Proje genelindeki
//    IIFE/classic scriptlerin (örn. autonomous-planning-engine.js)
//    aynı API'ye erişebilmesi için fonksiyonlar ayrıca
//    window.RecommendationMemory altında da sunulur (dosya sonu).
//    ES Module export'ları DEĞİŞMEDİ — bu sadece ek bir köprüdür.
// ══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'pharma_recommendation_memory_v1';
const DEFAULT_MAX = 500;

// ──────────────────────────────────────────────────────────────────────
//  İç yardımcılar
// ──────────────────────────────────────────────────────────────────────

/**
 * Benzersiz bir ID üretir.
 * Biçim: rec_<timestamp>_<4 rasgele hex karakter>
 * @returns {string}
 */
function _generateId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(16).slice(2, 6);
  return `rec_${ts}_${rnd}`;
}

/**
 * localStorage'dan kayıt listesini okur.
 * Parse hatası veya bozuk yapı durumunda boş dizi döner ve depolamayı sıfırlar.
 * @returns {Array}
 */
function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // Temel yapı doğrulaması
    if (!Array.isArray(parsed)) {
      console.warn('[recommendation-memory] Bozuk veri — sıfırlanıyor.');
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    return parsed;
  } catch (e) {
    console.warn('[recommendation-memory] localStorage okuma hatası:', e.message, '— sıfırlanıyor.');
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* sessiz */ }
    return [];
  }
}

/**
 * Kayıt listesini localStorage'a yazar.
 * Yazma hatası durumunda sessizce devam eder.
 * @param {Array} records
 */
function _save(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[recommendation-memory] localStorage yazma hatası:', e.message);
  }
}

/**
 * İki ISO tarihinin aynı takvim gününe (YYYY-MM-DD) ait olup olmadığını kontrol eder.
 * @param {string} isoA
 * @param {string} isoB
 * @returns {boolean}
 */
function _sameDay(isoA, isoB) {
  return typeof isoA === 'string' && typeof isoB === 'string' &&
         isoA.length >= 10 && isoB.length >= 10 &&
         isoA.slice(0, 10) === isoB.slice(0, 10);
}

/**
 * Aynı gün içinde representative + action + brick + pharmacy
 * kombinasyonu zaten kayıtlıysa o kaydı döndürür, yoksa null.
 *
 * Not: "pharmacy" ve "brick" null olabilir — null === null eşleşmesi
 * kasıtlıdır (örn. brick/eczane belirtilmeyen genel öneriler de
 * kendi içinde duplicate kontrolüne tabidir).
 *
 * @param {Array}  records  - Mevcut kayıt listesi
 * @param {Object} record   - _buildRecord() çıktısı (henüz kaydedilmemiş)
 * @returns {Object|null}
 */
function _findDuplicate(records, record) {
  return records.find(function(r) {
    return r.representative === record.representative &&
           r.recommendation && record.recommendation &&
           r.recommendation.action   === record.recommendation.action &&
           r.recommendation.brick    === record.recommendation.brick &&
           r.recommendation.pharmacy === record.recommendation.pharmacy &&
           _sameDay(r.createdAt, record.createdAt);
  }) || null;
}

/**
 * Bir önerinin zorunlu alanlarını doğrular.
 * @param {Object} rec
 * @returns {{ valid: boolean, reason?: string }}
 */
function _validate(rec) {
  if (!rec || typeof rec !== 'object') {
    return { valid: false, reason: 'rec bir nesne olmalı' };
  }
  if (typeof rec.representative !== 'string' || !rec.representative.trim()) {
    return { valid: false, reason: '"representative" zorunlu string alan' };
  }
  if (typeof rec.period !== 'string' || !rec.period.trim()) {
    return { valid: false, reason: '"period" zorunlu string alan' };
  }
  if (!rec.recommendation || typeof rec.recommendation !== 'object') {
    return { valid: false, reason: '"recommendation" nesne olmalı' };
  }
  if (typeof rec.recommendation.action !== 'string' || !rec.recommendation.action.trim()) {
    return { valid: false, reason: '"recommendation.action" zorunlu string alan' };
  }
  return { valid: true };
}

// ──────────────────────────────────────────────────────────────────────
//  Kayıt şablonu oluşturucu
// ──────────────────────────────────────────────────────────────────────

/**
 * Gelen ham öneri nesnesini tam kayıt yapısına dönüştürür.
 * Eksik alanlar varsayılan değerleriyle doldurulur.
 *
 * @param {Object} rec  - Kullanıcı tarafından sağlanan öneri nesnesi
 * @returns {Object}    - Tam kayıt yapısı
 *
 * Beklenen rec şeması (tümü opsiyonel, action zorunlu):
 * {
 *   id?            : string           // sağlanmazsa otomatik üretilir
 *   representative : string           // ZORunlu
 *   period         : string           // ZORunlu
 *   recommendation : {
 *     action            : string      // ZORunlu
 *     product?          : string|null
 *     brick?            : string|null
 *     pharmacy?         : string|null
 *     expectedImpactTL? : number|null
 *     confidence?       : number|null
 *   }
 *   contextSnapshot? : {
 *     tlPct?         : number
 *     primPct?       : number
 *     remainingDays? : number
 *     riskLevel?     : string
 *   }
 * }
 */
function _buildRecord(rec) {
  const rDetail = rec.recommendation || {};
  const ctx     = rec.contextSnapshot  || {};

  return {
    id            : (typeof rec.id === 'string' && rec.id.trim()) ? rec.id.trim() : _generateId(),
    createdAt     : new Date().toISOString(),
    representative: rec.representative.trim(),
    period        : rec.period.trim(),

    recommendation: {
      action           : rDetail.action.trim(),
      product          : (rDetail.product          !== undefined) ? rDetail.product          : null,
      brick            : (rDetail.brick            !== undefined) ? rDetail.brick            : null,
      pharmacy         : (rDetail.pharmacy         !== undefined) ? rDetail.pharmacy         : null,
      expectedImpactTL : (typeof rDetail.expectedImpactTL === 'number') ? rDetail.expectedImpactTL : null,
      confidence       : (typeof rDetail.confidence        === 'number') ? rDetail.confidence        : null
    },

    contextSnapshot: {
      tlPct        : (typeof ctx.tlPct         === 'number') ? ctx.tlPct         : 0,
      primPct      : (typeof ctx.primPct       === 'number') ? ctx.primPct       : 0,
      remainingDays: (typeof ctx.remainingDays === 'number') ? ctx.remainingDays : 0,
      riskLevel    : (typeof ctx.riskLevel     === 'string') ? ctx.riskLevel     : 'UNKNOWN'
    },

    outcome     : 'pending',
    outcomeValue: null,

    // ── FAZ 1.3: Outcome Tracker entegrasyonu ──────────────────────
    // Bu üç alan, js/ai/outcomes/outcome-tracker.js tarafından
    // evaluateOpenRecommendations() çalıştığında güncellenir
    // (bkz. markRecommendationEvaluated() altta). Mevcut "outcome" /
    // "outcomeValue" alanlarıyla ÇAKIŞMAZ — ayrı, ek bir takip katmanıdır.
    evaluated         : false,
    outcomeId         : null,
    lastEvaluationDate: null
  };
}

// ──────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────

/**
 * Yeni bir öneriyi hafızaya kaydeder.
 * Kayıt sayısı maxItems'ı aşarsa en eski kayıtlar otomatik silinir.
 *
 * @param {Object} rec  - Öneri nesnesi (şema için _buildRecord'a bak)
 * @returns {Object|null} Kaydedilen tam kayıt, hata durumunda null
 */
export function saveRecommendation(rec) {
  try {
    const validation = _validate(rec);
    if (!validation.valid) {
      console.warn('[recommendation-memory] Geçersiz kayıt:', validation.reason);
      return null;
    }

    const record  = _buildRecord(rec);
    const records = _load();

    // Aynı ID varsa üzerine yaz
    const existingIdx = records.findIndex(function(r) { return r.id === record.id; });
    if (existingIdx !== -1) {
      records[existingIdx] = record;
    } else {
      // YENİ: Aynı gün içinde representative + action + brick + pharmacy
      // kombinasyonu zaten varsa duplicate oluşturma — mevcut kaydı döndür.
      const duplicate = _findDuplicate(records, record);
      if (duplicate) {
        console.debug('[recommendation-memory] Duplicate öneri (bugün zaten kayıtlı) — atlandı:', duplicate.id);
        return duplicate;
      }
      records.push(record);
    }

    // Limit kontrolü
    deleteOldRecommendations(DEFAULT_MAX, records);  // in-memory trim; _save içinde çalışır

    _save(records);
    return (existingIdx !== -1) ? records[existingIdx] : record;
  } catch (e) {
    console.error('[recommendation-memory] saveRecommendation hatası:', e.message);
    return null;
  }
}

/**
 * Tüm kayıtlı önerileri döner (en yeniden en eskiye sıralı).
 *
 * @returns {Array} Kayıt dizisi (boş olabilir)
 */
export function getRecommendations() {
  try {
    const records = _load();
    // En yeni önce
    return records.slice().sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } catch (e) {
    console.error('[recommendation-memory] getRecommendations hatası:', e.message);
    return [];
  }
}

/**
 * Belirli bir ID'ye sahip öneriyi döner.
 *
 * @param {string} id
 * @returns {Object|null} Bulunan kayıt veya null
 */
export function getRecommendationById(id) {
  try {
    if (typeof id !== 'string' || !id.trim()) {
      console.warn('[recommendation-memory] getRecommendationById: geçersiz id');
      return null;
    }
    const records = _load();
    return records.find(function(r) { return r.id === id; }) || null;
  } catch (e) {
    console.error('[recommendation-memory] getRecommendationById hatası:', e.message);
    return null;
  }
}

/**
 * Bir önerinin sonucunu (outcome) günceller.
 *
 * @param {string}      id            - Güncellenecek kaydın ID'si
 * @param {string}      outcome       - Yeni durum: "achieved" | "partial" | "missed" | "cancelled"
 * @param {*}           outcomeValue  - Sonuç değeri (TL, oran, açıklama vb.) — herhangi bir tip
 * @returns {Object|null} Güncellenmiş kayıt veya null (bulunamazsa)
 */
export function updateRecommendationOutcome(id, outcome, outcomeValue) {
  try {
    if (typeof id !== 'string' || !id.trim()) {
      console.warn('[recommendation-memory] updateRecommendationOutcome: geçersiz id');
      return null;
    }

    const VALID_OUTCOMES = ['pending', 'achieved', 'partial', 'missed', 'cancelled'];
    if (typeof outcome !== 'string' || !VALID_OUTCOMES.includes(outcome)) {
      console.warn(
        '[recommendation-memory] updateRecommendationOutcome: geçersiz outcome —',
        outcome,
        '— geçerliler:', VALID_OUTCOMES.join(', ')
      );
      return null;
    }

    const records = _load();
    const idx     = records.findIndex(function(r) { return r.id === id; });

    if (idx === -1) {
      console.warn('[recommendation-memory] updateRecommendationOutcome: kayıt bulunamadı —', id);
      return null;
    }

    records[idx].outcome      = outcome;
    records[idx].outcomeValue = (outcomeValue !== undefined) ? outcomeValue : null;
    records[idx].updatedAt    = new Date().toISOString();

    _save(records);
    return records[idx];
  } catch (e) {
    console.error('[recommendation-memory] updateRecommendationOutcome hatası:', e.message);
    return null;
  }
}

/**
 * FAZ 1.3 — Outcome Tracker entegrasyonu.
 * Bir öneriyi "değerlendirildi" olarak işaretler ve ilgili outcome
 * kaydının ID'sini bağlar. js/ai/outcomes/outcome-tracker.js tarafından
 * evaluateOpenRecommendations() içinde çağrılır.
 *
 * Mevcut updateRecommendationOutcome() fonksiyonundan FARKLIDIR:
 * o fonksiyon "outcome"/"outcomeValue" (eski, manuel/serbest metin alanı)
 * günceller; bu fonksiyon ise "evaluated"/"outcomeId"/"lastEvaluationDate"
 * (yeni, otomatik Outcome Tracker alanı) günceller. İkisi birbirini
 * etkilemez.
 *
 * @param {string} id        - Güncellenecek önerinin ID'si
 * @param {string} outcomeId - outcome-tracker.js'in ürettiği outcome kaydının ID'si
 * @returns {Object|null} Güncellenmiş kayıt veya null (bulunamazsa)
 */
export function markRecommendationEvaluated(id, outcomeId) {
  try {
    if (typeof id !== 'string' || !id.trim()) {
      console.warn('[recommendation-memory] markRecommendationEvaluated: geçersiz id');
      return null;
    }

    const records = _load();
    const idx     = records.findIndex(function(r) { return r.id === id; });

    if (idx === -1) {
      console.warn('[recommendation-memory] markRecommendationEvaluated: kayıt bulunamadı —', id);
      return null;
    }

    records[idx].evaluated          = true;
    records[idx].outcomeId          = (typeof outcomeId === 'string' && outcomeId.trim()) ? outcomeId.trim() : null;
    records[idx].lastEvaluationDate = new Date().toISOString();

    _save(records);
    return records[idx];
  } catch (e) {
    console.error('[recommendation-memory] markRecommendationEvaluated hatası:', e.message);
    return null;
  }
}

/**
 * Kayıt sayısı maxItems'ı aşıyorsa en eski kayıtları siler.
 * Fonksiyon hem dışarıdan çağrılabilir hem de saveRecommendation tarafından kullanılır.
 *
 * @param {number} [maxItems=500]   - Tutulacak maksimum kayıt sayısı
 * @param {Array}  [_records]       - (iç kullanım) Zaten yüklenmiş dizi; sağlanmazsa _load() çağrılır
 * @returns {number} Silinen kayıt sayısı
 */
export function deleteOldRecommendations(maxItems, _records) {
  try {
    const limit = (typeof maxItems === 'number' && maxItems > 0) ? Math.floor(maxItems) : DEFAULT_MAX;

    // Dışarıdan _records verilmişse onu mutate et (saveRecommendation optimizasyonu),
    // verilmemişse yükle ve kaydet.
    const usingExternal = Array.isArray(_records);
    const records       = usingExternal ? _records : _load();

    if (records.length <= limit) return 0;

    // createdAt'a göre sırala (en eski önce)
    records.sort(function(a, b) {
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    const deleteCount = records.length - limit;
    records.splice(0, deleteCount);           // en eski N tanesi sil

    if (!usingExternal) {
      _save(records);
    }

    console.debug('[recommendation-memory]', deleteCount, 'eski kayıt silindi. Kalan:', records.length);
    return deleteCount;
  } catch (e) {
    console.error('[recommendation-memory] deleteOldRecommendations hatası:', e.message);
    return 0;
  }
}

// ──────────────────────────────────────────────────────────────────────
//  Ek yardımcı (opsiyonel kullanım)
// ──────────────────────────────────────────────────────────────────────

/**
 * Belirli bir temsilciye ait önerileri filtreler.
 *
 * @param {string} representative
 * @returns {Array}
 */
export function getRecommendationsByRepresentative(representative) {
  try {
    if (typeof representative !== 'string' || !representative.trim()) return [];
    const all = getRecommendations();
    return all.filter(function(r) { return r.representative === representative.trim(); });
  } catch (e) {
    console.error('[recommendation-memory] getRecommendationsByRepresentative hatası:', e.message);
    return [];
  }
}

/**
 * Belirli bir döneme ait önerileri filtreler.
 *
 * @param {string} period
 * @returns {Array}
 */
export function getRecommendationsByPeriod(period) {
  try {
    if (typeof period !== 'string' || !period.trim()) return [];
    const all = getRecommendations();
    return all.filter(function(r) { return r.period === period.trim(); });
  } catch (e) {
    console.error('[recommendation-memory] getRecommendationsByPeriod hatası:', e.message);
    return [];
  }
}

/**
 * localStorage'daki tüm öneri hafızasını temizler.
 * Dikkat: geri alınamaz.
 *
 * @returns {boolean} Başarılı mı
 */
export function clearAllRecommendations() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.info('[recommendation-memory] Tüm öneri hafızası temizlendi.');
    return true;
  } catch (e) {
    console.error('[recommendation-memory] clearAllRecommendations hatası:', e.message);
    return false;
  }
}

/**
 * Özet istatistikler döner (dashboard veya debug için).
 *
 * @returns {{ total: number, pending: number, achieved: number, partial: number, missed: number, cancelled: number }}
 */
export function getRecommendationStats() {
  try {
    const records = _load();
    const stats = { total: records.length, pending: 0, achieved: 0, partial: 0, missed: 0, cancelled: 0 };
    records.forEach(function(r) {
      if (stats.hasOwnProperty(r.outcome)) stats[r.outcome]++;
    });
    return stats;
  } catch (e) {
    console.error('[recommendation-memory] getRecommendationStats hatası:', e.message);
    return { total: 0, pending: 0, achieved: 0, partial: 0, missed: 0, cancelled: 0 };
  }
}

// ──────────────────────────────────────────────────────────────────────
//  Classic <script> köprüsü (window.RecommendationMemory)
//
//  Proje genelinde modüller IIFE/classic script olarak yüklenir
//  (örn. js/ai/autonomous-planning-engine.js). Bu dosya bir ES Module
//  olduğu için <script type="module"> ile yüklenir ve aynı fonksiyonlar
//  classic scriptlerin erişebilmesi için window.RecommendationMemory
//  üzerinden de sunulur. ES export'ları yukarıda DEĞİŞMEDİ.
// ──────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.RecommendationMemory = {
    saveRecommendation,
    getRecommendations,
    getRecommendationById,
    updateRecommendationOutcome,
    markRecommendationEvaluated,
    deleteOldRecommendations,
    getRecommendationsByRepresentative,
    getRecommendationsByPeriod,
    clearAllRecommendations,
    getRecommendationStats
  };
  console.debug('[recommendation-memory] window.RecommendationMemory hazır.');
}
