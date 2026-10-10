const { inferSubtitleMimeType } = require('./subtitles');

function normalizeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch (_) {
        return null;
    }
}

// Vidfast labels subtitle tracks with human-readable names ("English", "Hindi",
// "Spanish - Latin America", ...). Media3/Android expects a short ISO 639-1
// code, so map the common ones explicitly instead of guessing from length.
const LANGUAGE_MAP = {
    english: 'en', eng: 'en', en: 'en',
    hindi: 'hi', hin: 'hi', hi: 'hi',
    spanish: 'es', spa: 'es', es: 'es', castellano: 'es',
    latin: 'es', 'latin america': 'es', 'latam': 'es', 'español': 'es', espanol: 'es',
    french: 'fr', fre: 'fr', fra: 'fr', fr: 'fr', francais: 'fr',
    german: 'de', ger: 'de', deu: 'de', de: 'de', deutsch: 'de',
    portuguese: 'pt', por: 'pt', pt: 'pt', portugues: 'pt', brazilian: 'pt',
    russian: 'ru', rus: 'ru', ru: 'ru',
    japanese: 'ja', jpn: 'ja', ja: 'ja',
    korean: 'ko', kor: 'ko', ko: 'ko',
    chinese: 'zh', chi: 'zh', zho: 'zh', zh: 'zh', mandarin: 'zh', cantonese: 'zh',
    arabic: 'ar', ara: 'ar', ar: 'ar',
    turkish: 'tr', tur: 'tr', tr: 'tr',
    italian: 'it', ita: 'it', it: 'it',
    dutch: 'nl', dut: 'nl', nld: 'nl', nl: 'nl',
    polish: 'pl', pol: 'pl', pl: 'pl',
    swedish: 'sv', swe: 'sv', sv: 'sv',
    norwegian: 'no', nor: 'no', nb: 'no', nn: 'no',
    danish: 'da', dan: 'da', da: 'da',
    finnish: 'fi', fin: 'fi', fi: 'fi',
    czech: 'cs', ces: 'cs', cze: 'cs', cs: 'cs',
    hungarian: 'hu', hun: 'hu', hu: 'hu',
    romanian: 'ro', ron: 'ro', rum: 'ro', ro: 'ro',
    greek: 'el', gre: 'el', ell: 'el', el: 'el',
    thai: 'th', tha: 'th', th: 'th',
    indonesian: 'id', ind: 'id', id: 'id',
    malay: 'ms', may: 'ms', ms: 'ms',
    vietnamese: 'vi', vie: 'vi', vi: 'vi',
    ukrainian: 'uk', ukr: 'uk', uk: 'uk'
};

// Pull a 2-3 letter ISO code out of a filename segment such as "eng.vtt",
// "hindi.srt" or "/subs/en.m3u8". Falls back to null.
function languageFromFilename(url) {
    const pathname = String(url || '').split('?')[0];
    const segments = pathname.split('/');
    const last = segments[segments.length - 1] || '';
    const stem = last.replace(/\.[a-z0-9]+$/i, '');
    const direct = stem.match(/^([a-z]{2,3})$/i);
    if (direct) {
        const key = direct[1].toLowerCase();
        if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    }
    // e.g. "en-US", "en_US", "pt-BR"
    const regional = stem.match(/^([a-z]{2,3})[-_][a-z]{2}$/i);
    if (regional) {
        const key = regional[1].toLowerCase();
        if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    }
    return null;
}

// Resolve a display label into a Media3-friendly ISO 639-1 code.
function resolveLanguage(track, label, url) {
    const explicit = String((track && (track.language || track.lang || track.srclang)) || '').trim().toLowerCase();
    if (explicit) {
        if (LANGUAGE_MAP[explicit]) return LANGUAGE_MAP[explicit];
        if (/^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/.test(explicit)) return explicit;
    }
    // Labels can be decorated ("English [Default]", "Hindi - Dubbed"), so match
    // the longest known key as a whole word rather than requiring equality.
    const normalized = String(label || '').toLowerCase().replace(/[()[\]]/g, ' ');
    const keys = Object.keys(LANGUAGE_MAP).sort((a, b) => b.length - a.length);
    for (const key of keys) {
        if (new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, 'i').test(normalized)) {
            return LANGUAGE_MAP[key];
        }
    }
    return languageFromFilename(url);
}

// Normalize the decrypted stream payload's subtitle list. Vidfast uses
// `tracks: [{ file, label }]`, but tolerate the other shapes upstream has used
// (`subtitles`, `captions`, object maps) so this does not silently regress.
function extractSubtitles(payload, streamUrl, streamHeaders = {}) {
    const containers = [payload && payload.tracks, payload && payload.subtitles, payload && payload.captions];
    const entries = [];
    for (const container of containers) {
        if (Array.isArray(container)) {
            container.forEach(item => {
                if (typeof item === 'string') entries.push({ url: item });
                else if (item && typeof item === 'object') entries.push(item);
            });
        } else if (container && typeof container === 'object') {
            // Object map: { eng: "https://.../eng.vtt", spa: {...} }
            Object.entries(container).forEach(([key, value]) => {
                if (typeof value === 'string') entries.push({ url: value, label: key });
                else if (value && typeof value === 'object') entries.push({ ...value, label: value.label || key });
            });
        }
    }
    if (entries.length === 0) return [];

    const seen = new Set();
    const subs = [];
    for (const track of entries) {
        if (track.kind && !['subtitles', 'captions'].includes(String(track.kind).toLowerCase())) continue;
        // Resolve relative subtitle paths against the stream URL.
        const rawUrl = track.file || track.url || track.src || track.path || track.srcUrl || '';
        let url = normalizeHttpUrl(rawUrl);
        if (!url && rawUrl && streamUrl) {
            try {
                url = normalizeHttpUrl(new URL(String(rawUrl), streamUrl).href);
            } catch (_) {
                url = null;
            }
        }
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const rawLabel = String(track.label || track.name || track.title || track.language || track.lang || 'Subtitle').trim();
        subs.push({
            url,
            mimeType: inferSubtitleMimeType({ ...track, url, label: rawLabel }),
            language: resolveLanguage(track, rawLabel, url),
            label: rawLabel,
            headers: { ...streamHeaders, ...(track.headers && typeof track.headers === 'object' ? track.headers : {}) }
        });
    }
    return subs;
}


function fillMissingSubtitles(streams) {
    const subtitles = [...new Map(streams.flatMap(stream => stream.subtitles || []).map(sub => [sub.url, sub])).values()];
    return streams.map(stream => stream.subtitles?.length ? stream : { ...stream, subtitles });
}

module.exports = { extractSubtitles, resolveLanguage, fillMissingSubtitles };
