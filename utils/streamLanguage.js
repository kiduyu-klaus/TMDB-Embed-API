const LANGUAGE_NAMES = [
  ['English', /\benglish\b/i],
  ['Hindi', /\bhindi\b/i],
  ['Bengali', /\bbengali\b|\bbangla\b/i],
  ['Tamil', /\btamil\b/i],
  ['Telugu', /\btelugu\b/i],
  ['Malayalam', /\bmalayalam\b/i],
  ['Kannada', /\bkannada\b/i],
  ['Marathi', /\bmarathi\b/i],
  ['Punjabi', /\bpunjabi\b/i],
  ['Gujarati', /\bgujarati\b/i],
  ['Urdu', /\burdu\b/i],
  ['Arabic', /\barabic\b/i],
  ['Persian', /\bpersian\b|\bfarsi\b/i],
  ['Spanish', /\bspanish\b|\bespañol\b/i],
  ['French', /\bfrench\b|\bfrançais\b/i],
  ['German', /\bgerman\b|\bdeutsch\b/i],
  ['Italian', /\bitalian\b|\bitaliano\b/i],
  ['Portuguese', /\bportuguese\b|\bportuguês\b/i],
  ['Russian', /\brussian\b/i],
  ['Ukrainian', /\bukrainian\b/i],
  ['Polish', /\bpolish\b/i],
  ['Dutch', /\bdutch\b|\bnederlands\b/i],
  ['Greek', /\bgreek\b/i],
  ['Turkish', /\bturkish\b/i],
  ['Hebrew', /\bhebrew\b/i],
  ['Japanese', /\bjapanese\b|\b日本語\b/i],
  ['Korean', /\bkorean\b|\b한국어\b/i],
  ['Chinese', /\bchinese\b|\bmandarin\b|\bcantonese\b|\b普通话\b/i],
  ['Thai', /\bthai\b/i],
  ['Vietnamese', /\bvietnamese\b/i],
  ['Indonesian', /\bindonesian\b|\bbahasa\b/i],
  ['Malay', /\bmalay\b/i],
  ['Filipino', /\bfilipino\b|\btagalog\b/i],
  ['Swedish', /\bswedish\b/i],
  ['Danish', /\bdanish\b/i],
  ['Norwegian', /\bnorwegian\b/i],
  ['Finnish', /\bfinnish\b/i],
  ['Czech', /\bczech\b/i],
  ['Hungarian', /\bhungarian\b/i],
  ['Romanian', /\bromanian\b/i],
  ['Bulgarian', /\bbulgarian\b/i],
  ['Serbian', /\bserbian\b/i],
  ['Croatian', /\bcroatian\b/i],
  ['Slovak', /\bslovak\b/i],
  ['Slovenian', /\bslovenian\b/i],
  ['Lithuanian', /\blithuanian\b/i],
  ['Latvian', /\blatvian\b/i],
  ['Estonian', /\bestonian\b/i],
  ['Icelandic', /\bicelandic\b/i],
];

const LANGUAGE_CODES = {
  en: 'English', eng: 'English', hi: 'Hindi', hin: 'Hindi', bn: 'Bengali', ben: 'Bengali',
  ta: 'Tamil', tam: 'Tamil', te: 'Telugu', tel: 'Telugu', ml: 'Malayalam', mal: 'Malayalam',
  kn: 'Kannada', kan: 'Kannada', mr: 'Marathi', mar: 'Marathi', pa: 'Punjabi', pan: 'Punjabi',
  gu: 'Gujarati', guj: 'Gujarati', ur: 'Urdu', ara: 'Arabic', ar: 'Arabic', fa: 'Persian', fas: 'Persian',
  es: 'Spanish', spa: 'Spanish', fr: 'French', fra: 'French', de: 'German', deu: 'German',
  it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian',
  ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', zho: 'Chinese',
  tr: 'Turkish', tur: 'Turkish', th: 'Thai', tha: 'Thai', vi: 'Vietnamese', vie: 'Vietnamese',
  id: 'Indonesian', ind: 'Indonesian', ms: 'Malay', msa: 'Malay', tl: 'Filipino', fil: 'Filipino',
};

function text(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
  if (typeof value === 'object') return text(value.language || value.lang || value.label || value.name || '');
  return String(value).trim();
}

function normalizeExplicit(value) {
  const raw = text(value);
  if (!raw) return '';
  const code = LANGUAGE_CODES[raw.toLowerCase()];
  if (code) return code;
  return raw;
}

function languagesFromText(value) {
  const raw = text(value);
  if (!raw) return [];
  const matches = [];
  for (const [name, pattern] of LANGUAGE_NAMES) {
    const match = pattern.exec(raw);
    if (match) matches.push({ name, index: match.index });
  }
  return matches.sort((a, b) => a.index - b.index).map(match => match.name);
}

function inferStreamLanguage(stream) {
  if (!stream || typeof stream !== 'object') return 'Original';

  for (const value of [stream.language, stream.languages, stream.audioLanguage, stream.audioLanguages, stream.lang]) {
    const explicit = normalizeExplicit(value);
    if (explicit && !/^(unknown|und|null|undefined)$/i.test(explicit)) return explicit;
  }

  const clues = [stream.title, stream.name, stream.label, stream.filename, stream.fileName, stream.file]
    .map(text)
    .filter(Boolean);
  const matches = languagesFromText(clues.join(' '));
  return [...new Set(matches)].join(' . ') || 'Original';
}

module.exports = { inferStreamLanguage, languagesFromText, normalizeExplicit };
