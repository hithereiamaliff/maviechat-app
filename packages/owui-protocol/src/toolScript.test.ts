import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { toolScriptMessage, toolScriptPage, toolScriptSource, type ToolScriptMessage } from './toolScript';

/**
 * Runs the page's script in a sandbox standing in for the sealed page: its bridge collects the
 * messages, URL makes blob addresses, and a link element can be clicked.
 */
function runPage(code: string, run = 1) {
  const raw: string[] = [];
  let next = 0;
  class Anchor {
    href = '';
    download = '';
    click() {}
  }
  const sandbox: Record<string, unknown> = {
    Blob,
    btoa,
    setTimeout,
    HTMLAnchorElement: Anchor,
    URL: { createObjectURL: () => `blob:sealed/${(next += 1)}` },
    ReactNativeWebView: { postMessage: (message: string) => raw.push(message) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(toolScriptSource(code, run), sandbox);
  const settled = async () => {
    for (let tries = 0; tries < 100 && !raw.some((message) => /"type":"(done|error)"/.test(message)); tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    return raw.map((message) => toolScriptMessage(message, run)).filter((message): message is ToolScriptMessage => message !== null);
  };
  return { settled, raw };
}

describe('a tool’s JavaScript', () => {
  it('answers with what the code returns, as the web runs it (the body of an async function)', async () => {
    expect(await runPage('return 6 * 7;').settled()).toEqual([{ type: 'done', result: 42 }]);
    expect(await runPage('await new Promise((done) => setTimeout(done, 5)); return { list: [1, "two"], ok: true };').settled()).toEqual([{ type: 'done', result: { list: [1, 'two'], ok: true } }]);
  });

  it('answers null for nothing (or something JSON can’t carry), and words for what it can’t write out', async () => {
    expect(await runPage('const x = 1;').settled()).toEqual([{ type: 'done', result: null }]);
    expect(await runPage('return () => 1;').settled()).toEqual([{ type: 'done', result: null }]);
    expect(await runPage('const a = {}; a.self = a; return a;').settled()).toEqual([{ type: 'done', result: '[object Object]' }]);
  });

  it('says why when the code throws, or doesn’t even parse', async () => {
    expect(await runPage('throw new Error("nope");').settled()).toEqual([{ type: 'error', error: 'nope' }]);
    const [broken] = await runPage('return (;').settled();
    expect(broken?.type).toBe('error');
  });

  it('hands over a file the code offers as a download, before its answer', async () => {
    const messages = await runPage('const link = new HTMLAnchorElement(); link.href = URL.createObjectURL(new Blob(["hello"], { type: "text/plain" })); link.download = "hi.txt"; link.click(); return "saved";').settled();
    expect(messages).toEqual([
      { type: 'file', name: 'hi.txt', url: 'data:text/plain;base64,aGVsbG8=' },
      { type: 'done', result: 'saved' },
    ]);
  });

  it('passes on pages it opens (web addresses only)', async () => {
    const messages = await runPage('window.open("https://example.com/report"); window.open("javascript:alert(1)"); return 1;').settled();
    expect(messages).toEqual([
      { type: 'open', url: 'https://example.com/report' },
      { type: 'done', result: 1 },
    ]);
  });

  it('keeps code that mentions </script> inside the page’s script', () => {
    const page = toolScriptPage('return "</script><b>";', 3);
    expect(page.match(/<\/script>/g)).toHaveLength(1);
  });

  it('reads only its own run’s messages, of the kinds it knows', () => {
    expect(toolScriptMessage('{"r":2,"type":"done","result":"1"}', 1)).toBeNull();
    expect(toolScriptMessage('not json', 1)).toBeNull();
    expect(toolScriptMessage('{"r":1,"type":"file","name":"x","url":"https://e.test/x"}', 1)).toBeNull();
    expect(toolScriptMessage('{"r":1,"type":"open","url":"file:///etc/passwd"}', 1)).toBeNull();
    expect(toolScriptMessage('{"r":1,"type":"error"}', 1)).toEqual({ type: 'error', error: 'It failed without saying why.' });
  });
});
