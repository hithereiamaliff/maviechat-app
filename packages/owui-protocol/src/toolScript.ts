/*
 * A tool's JavaScript: an `execute` request, where the server asks the browser to run some code
 * and waits for its answer (the web runs it in its own page). Here it runs in a sealed page of
 * its own, a fresh one each time: nothing of MavieChat's is in it (no sign-in, no chats, no
 * storage), and what it sends back is only ever read as data. Its answer is what the code
 * returns, made JSON as a socket would send it. Files it offers as downloads, and pages it opens,
 * come out as messages of their own, for the app to offer to the person.
 */

/** How long the code may run before it's stopped (the server waits for an answer). */
export const TOOL_SCRIPT_LIMIT_MS = 60_000;

export type ToolScriptMessage =
  | { type: 'done'; result: unknown }
  | { type: 'error'; error: string }
  | { type: 'file'; name: string; url: string }
  | { type: 'open'; url: string };

type Tree = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A page's message for run `run`, or null for anything else (another run's, or not one at all). */
export function toolScriptMessage(raw: string, run: number): ToolScriptMessage | null {
  let message: Tree;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    message = parsed as Tree;
  } catch {
    return null;
  }
  if (message.r !== run) return null;
  switch (message.type) {
    case 'done': {
      let result: unknown = null;
      try {
        result = JSON.parse(text(message.result) || 'null');
      } catch {
        result = null;
      }
      return { type: 'done', result };
    }
    case 'error':
      return { type: 'error', error: text(message.error) || 'It failed without saying why.' };
    case 'file':
      return /^data:/i.test(text(message.url)) ? { type: 'file', name: text(message.name), url: text(message.url) } : null;
    case 'open':
      return /^https?:\/\//i.test(text(message.url)) ? { type: 'open', url: text(message.url) } : null;
    default:
      return null;
  }
}

/** A string as a script literal that can't end the page's <script> early. */
const forScript = (value: string): string => JSON.stringify(value).replace(/</g, '\\x3c');

/**
 * The script that runs the code, as the web runs it (the code is the body of an async
 * function; what it returns is the answer). Links it clicks to a blob or data address come out as
 * files, and pages it opens as `open`; it waits for files being read before it answers.
 */
export function toolScriptSource(code: string, run: number): string {
  return `(function () {
  var RUN = ${run};
  var CODE = ${forScript(code)};
  var bridge = window.ReactNativeWebView;
  var post = function (message) { message.r = RUN; bridge.postMessage(JSON.stringify(message)); };
  var reading = 0;
  var blobs = {};
  var makeUrl = URL.createObjectURL;
  URL.createObjectURL = function (blob) { var url = makeUrl.call(URL, blob); blobs[url] = blob; return url; };
  var offer = function (href, name) {
    href = String(href || '');
    if (/^data:/i.test(href)) return post({ type: 'file', name: String(name || ''), url: href });
    var blob = blobs[href];
    if (blob) {
      reading += 1;
      blob.arrayBuffer().then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 32768));
        post({ type: 'file', name: String(name || ''), url: 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary) });
      }).catch(function () {}).then(function () { reading -= 1; });
      return;
    }
    if (/^https?:\\/\\//i.test(href)) post({ type: 'open', url: href });
  };
  if (typeof HTMLAnchorElement !== 'undefined') HTMLAnchorElement.prototype.click = function () { offer(this.href, this.download); };
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node.tagName !== 'A') node = node.parentNode;
      if (node && node.href) { event.preventDefault(); offer(node.href, node.download); }
    }, true);
  }
  window.open = function (url) { if (url) offer(url, ''); return null; };
  var settle = function (message) {
    var tries = 0;
    (function wait() {
      if (reading > 0 && tries < 100) { tries += 1; return setTimeout(wait, 30); }
      post(message);
    })();
  };
  var finish = function (value) {
    var answer;
    try { answer = JSON.stringify(value === undefined ? null : value); } catch (error) { answer = JSON.stringify(String(value)); }
    settle({ type: 'done', result: answer === undefined ? 'null' : answer });
  };
  var fail = function (error) { settle({ type: 'error', error: String((error && error.message) || error) }); };
  try { Promise.resolve(new Function('return (async () => { ' + CODE + '\\n})()')()).then(finish, fail); } catch (error) { fail(error); }
})();`;
}

/** The sealed page the code runs in: the script and nothing else. */
export function toolScriptPage(code: string, run: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${toolScriptSource(code, run)}</script></body></html>`;
}

/** What the server is told when the code doesn't run or fails: the shape it uses for its own errors. */
export const toolScriptRefusal = (why: string): { error: string } => ({ error: why });
