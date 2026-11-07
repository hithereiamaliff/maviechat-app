/*
 * The phone's voices for Read Aloud, grouped by language for the voice list, with a short sample
 * line in the voice's own language where we have one (English otherwise).
 */

export interface PhoneVoice {
  identifier: string;
  name: string;
  /** "Default" or "Enhanced", as expo-speech reports it. */
  quality: string;
  language: string;
}

export interface VoiceSection {
  language: string;
  title: string;
  data: PhoneVoice[];
}

/** Language names for the voice list (Hermes has no `Intl.DisplayNames`). */
const LANGUAGES: Record<string, string> = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fa: 'Persian',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  kn: 'Kannada',
  ko: 'Korean',
  ms: 'Malay',
  nb: 'Norwegian',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  wuu: 'Shanghainese',
  yue: 'Cantonese',
  zh: 'Chinese',
};

const REGIONS: Record<string, string> = {
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CN: 'China mainland',
  ES: 'Spain',
  FR: 'France',
  GB: 'UK',
  HK: 'Hong Kong',
  IE: 'Ireland',
  IN: 'India',
  MX: 'Mexico',
  MY: 'Malaysia',
  NL: 'Netherlands',
  NZ: 'New Zealand',
  PT: 'Portugal',
  SG: 'Singapore',
  TW: 'Taiwan',
  US: 'US',
  ZA: 'South Africa',
};

/** "English (UK)" for `en-GB`; the tag itself for a language we have no name for. */
export function languageTitle(tag: string): string {
  const [language = '', region] = tag.split(/[-_]/);
  const name = LANGUAGES[language.toLowerCase()];
  if (!name) return tag;
  if (!region) return name;
  return `${name} (${REGIONS[region.toUpperCase()] ?? region.toUpperCase()})`;
}

/**
 * The name to show. iOS names its voices ("Samantha"); Android gives codes such as
 * `en-us-x-sfg-local` or `en-us-x-iom#male_1-network`, which read here as "Voice SFG" and
 * "Voice IOM (male 1, online)".
 */
export function voiceName(voice: Pick<PhoneVoice, 'name'>): string {
  const match = /^[a-z]{2,3}(?:-[a-z0-9]{2,4})?-x-([a-z0-9]+)(?:#([a-z0-9_]+))?-(local|network)$/i.exec(voice.name);
  if (!match) return voice.name;
  const [, code = '', variant, where] = match;
  const notes = [variant?.replace(/_/g, ' '), where === 'network' ? 'online' : null].filter(Boolean);
  return `Voice ${code.toUpperCase()}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

/** Enhanced and premium voices are downloads that sound better: say so in the list. */
export function voiceQuality(voice: Pick<PhoneVoice, 'identifier' | 'quality'>): string | null {
  if (voice.identifier.includes('.premium.')) return 'Premium';
  if (voice.quality === 'Enhanced' || voice.identifier.includes('.enhanced.')) return 'Enhanced';
  return null;
}

/**
 * The voices by language: the phone's own language first, then by name; in each, the better
 * downloads first, then by name. `query` keeps the voices whose name or language matches.
 */
export function voiceSections(voices: PhoneVoice[], phoneLocale: string, query = ''): VoiceSection[] {
  const wanted = query.trim().toLowerCase();
  const groups = new Map<string, PhoneVoice[]>();
  for (const voice of voices) {
    const title = languageTitle(voice.language);
    if (wanted && !voice.name.toLowerCase().includes(wanted) && !title.toLowerCase().includes(wanted)) continue;
    const group = groups.get(voice.language) ?? [];
    group.push(voice);
    groups.set(voice.language, group);
  }
  const mine = phoneLocale.split(/[-_]/)[0]?.toLowerCase() ?? '';
  const rank = (voice: PhoneVoice) => (voiceQuality(voice) === 'Premium' ? 0 : voiceQuality(voice) === 'Enhanced' ? 1 : 2);
  return [...groups.entries()]
    .map(([language, data]) => ({ language, title: languageTitle(language), data: data.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      const aMine = a.language.toLowerCase().startsWith(mine) ? 0 : 1;
      const bMine = b.language.toLowerCase().startsWith(mine) ? 0 : 1;
      return aMine - bMine || (a.language === phoneLocale ? -1 : b.language === phoneLocale ? 1 : 0) || a.title.localeCompare(b.title);
    });
}

const SAMPLES: Record<string, string> = {
  ar: 'مرحبًا! هكذا ستُقرأ ردودك.',
  de: 'Hallo! So werden deine Antworten vorgelesen.',
  en: 'Hello! This is how your replies will sound.',
  es: '¡Hola! Así se leerán tus respuestas.',
  fr: 'Bonjour ! Voici comment vos réponses seront lues.',
  hi: 'नमस्ते! आपके जवाब इस तरह पढ़े जाएँगे।',
  id: 'Halo! Begini balasan Anda akan dibacakan.',
  it: 'Ciao! Ecco come verranno lette le tue risposte.',
  ja: 'こんにちは。返信をこのように読み上げます。',
  ko: '안녕하세요. 답변을 이렇게 읽어 드립니다.',
  ms: 'Helo! Beginilah balasan anda akan dibacakan.',
  nl: 'Hallo! Zo worden je antwoorden voorgelezen.',
  pt: 'Olá! É assim que as suas respostas serão lidas.',
  ru: 'Здравствуйте! Так будут звучать ваши ответы.',
  ta: 'வணக்கம்! உங்கள் பதில்கள் இப்படி வாசிக்கப்படும்.',
  th: 'สวัสดี นี่คือเสียงที่จะอ่านคำตอบของคุณ',
  yue: '你好！我會用呢把聲讀出你嘅回覆。',
  zh: '你好！我会用这个声音朗读回复。',
};

/** A line for a voice to say in its own language (English where we have none). */
export function voiceSample(language: string): string {
  const primary = language.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return SAMPLES[primary] ?? (SAMPLES.en as string);
}
