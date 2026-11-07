import { lexMarkdown } from '@maviechat/owui-markdown';
import { describe, expect, it } from 'vitest';
import { FADE_MS, fadeAlpha, fadingTail, nextFade, withAlpha, type StreamFade } from './streamFade';

describe('fading in a reply as it is written', () => {
  it('hides text not yet seen, then fades each arrival in over 100 ms', () => {
    let fade: StreamFade = { seen: 5, arrivals: [], now: 0 };
    // "Hello" was there; " world" arrives.
    expect(fadeAlpha(fade, 2)).toBe(1);
    expect(fadeAlpha(fade, 7)).toBe(0);
    fade = nextFade(fade, 11, 1000);
    expect(fade.arrivals).toEqual([{ start: 5, at: 1000 }]);
    expect(fadeAlpha(fade, 7)).toBe(0);
    fade = nextFade(fade, 11, 1000 + FADE_MS / 2);
    expect(fadeAlpha(fade, 7)).toBeCloseTo(0.5);
    expect(fadeAlpha(fade, 2)).toBe(1);
    fade = nextFade(fade, 11, 1000 + FADE_MS);
    expect(fadeAlpha(fade, 7)).toBe(1);
    expect(fade.arrivals).toEqual([]);
  });

  it('starts again when the text is replaced rather than added to', () => {
    expect(nextFade({ seen: 40, arrivals: [{ start: 30, at: 5 }], now: 5 }, 12, 9)).toEqual({ seen: 12, arrivals: [], now: 9 });
  });

  it('finds where new words arrive: the end of the last paragraph or list item', () => {
    const source = 'Intro\n\n- one\n- two and **more** words';
    const tail = fadingTail(lexMarkdown(source), source);
    expect(tail?.token.raw).toBe(' words');
    expect(source.slice(tail!.start)).toBe(' words');
    const bold = 'Some **bold end**';
    expect(fadingTail(lexMarkdown(bold), bold)?.token.raw).toBe('bold end');
  });

  it('fades nothing while a code block or a table is being written', () => {
    const code = 'Text\n\n```js\nconst a = 1';
    expect(fadingTail(lexMarkdown(code), code)).toBeNull();
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(fadingTail(lexMarkdown(table), table)).toBeNull();
  });

  it('writes colours at an opacity', () => {
    expect(withAlpha('#171717', 0.5)).toBe('#17171780');
    expect(withAlpha('#abc', 1)).toBe('#aabbccff');
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)');
  });
});
