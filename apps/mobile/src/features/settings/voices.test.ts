import { describe, expect, it } from 'vitest';
import { languageTitle, voiceName, voiceQuality, voiceSample, voiceSections, type PhoneVoice } from './voices';

const voice = (name: string, language: string, extra: Partial<PhoneVoice> = {}): PhoneVoice => ({ identifier: `com.apple.voice.compact.${language}.${name}`, name, quality: 'Default', language, ...extra });

describe('voices', () => {
  it('names languages and regions', () => {
    expect(languageTitle('en-GB')).toBe('English (UK)');
    expect(languageTitle('ms-MY')).toBe('Malay (Malaysia)');
    expect(languageTitle('zh-TW')).toBe('Chinese (Taiwan)');
    expect(languageTitle('ja')).toBe('Japanese');
    expect(languageTitle('xx-YY')).toBe('xx-YY');
    expect(languageTitle('en-ZZ')).toBe('English (ZZ)');
  });

  it('keeps iOS voice names, and makes Android’s codes readable', () => {
    expect(voiceName({ name: 'Samantha' })).toBe('Samantha');
    expect(voiceName({ name: 'Eddy (English (US))' })).toBe('Eddy (English (US))');
    expect(voiceName({ name: 'en-us-x-sfg-local' })).toBe('Voice SFG');
    expect(voiceName({ name: 'en-us-x-iom#male_1-network' })).toBe('Voice IOM (male 1, online)');
    expect(voiceName({ name: 'cmn-cn-x-ccc-network' })).toBe('Voice CCC (online)');
    expect(voiceName({ name: '' })).toBe('');
  });

  it('marks the better downloads', () => {
    expect(voiceQuality({ identifier: 'com.apple.voice.premium.en-US.Zoe', quality: 'Default' })).toBe('Premium');
    expect(voiceQuality({ identifier: 'com.apple.voice.enhanced.en-GB.Daniel', quality: 'Enhanced' })).toBe('Enhanced');
    expect(voiceQuality({ identifier: 'com.apple.voice.compact.en-GB.Daniel', quality: 'Default' })).toBeNull();
  });

  it('groups by language, the phone’s first, better voices first, and searches', () => {
    const voices = [
      voice('Ting-Ting', 'zh-CN'),
      voice('Daniel', 'en-GB'),
      voice('Amira', 'ms-MY'),
      voice('Samantha', 'en-US'),
      voice('Ava', 'en-US', { identifier: 'com.apple.voice.premium.en-US.Ava' }),
      voice('Aaron', 'en-US'),
    ];
    const sections = voiceSections(voices, 'en-US');
    expect(sections.map((section) => section.language)).toEqual(['en-US', 'en-GB', 'zh-CN', 'ms-MY']);
    expect(sections[0]?.data.map((item) => item.name)).toEqual(['Ava', 'Aaron', 'Samantha']);
    expect(voiceSections(voices, 'ms-MY')[0]?.language).toBe('ms-MY');
    expect(voiceSections(voices, 'en-US', 'malay').map((section) => section.language)).toEqual(['ms-MY']);
    expect(voiceSections(voices, 'en-US', 'dan')[0]?.data).toHaveLength(1);
  });

  it('has a sample in the voice’s language, else English', () => {
    expect(voiceSample('ms-MY')).toContain('Helo');
    expect(voiceSample('zh_TW')).toContain('你好');
    expect(voiceSample('sv-SE')).toContain('Hello');
  });
});
