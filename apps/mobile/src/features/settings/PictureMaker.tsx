import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/*
 * Your profile picture, made on the phone as the web makes it in the browser: a photo cropped to
 * the middle square and shrunk to 250 × 250 (a JPEG of a few kilobytes), or your initials on a
 * colour. The app has no image library of its own, so a hidden web view's canvas does the drawing.
 */

export interface PictureMaker {
  /** A square JPEG data: URL, `size` across, from a picture (as a data: URL). */
  square(dataUrl: string, size?: number): Promise<string>;
  /** Initials in white on `colour`, as a PNG data: URL. */
  initials(text: string, colour: string): Promise<string>;
  /** The whole picture as a JPEG data: URL, shrunk to fit `maxWidth` × `maxHeight` (null: no limit that way; never enlarged). */
  fit(dataUrl: string, maxWidth: number | null, maxHeight: number | null): Promise<string>;
}

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>
(function () {
  function post(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  function canvas(size) { var c = document.createElement('canvas'); c.width = size; c.height = size; return c; }
  function load(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('unreadable')); };
      image.src = src;
    });
  }
  // The middle square, drawn at the largest power-of-two multiple of the size that fits (at most
  // 2048 across), then halved step by step for a smooth result.
  function square(image, size) {
    var side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('empty');
    var sx = (image.naturalWidth - side) / 2, sy = (image.naturalHeight - side) / 2;
    var step = size;
    while (step * 2 <= Math.min(side, 2048)) step *= 2;
    var current = canvas(step);
    var context = current.getContext('2d');
    // A JPEG has no transparency: what's see-through in the picture becomes white, not black.
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, step, step);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sx, sy, side, side, 0, 0, step, step);
    while (step > size) {
      var next = Math.max(size, Math.round(step / 2));
      var smaller = canvas(next);
      var nextContext = smaller.getContext('2d');
      nextContext.imageSmoothingQuality = 'high';
      nextContext.drawImage(current, 0, 0, step, step, 0, 0, next, next);
      current = smaller;
      step = next;
    }
    return current.toDataURL('image/jpeg', 0.85);
  }
  // The whole picture, shrunk (never enlarged) to fit maxW × maxH: drawn first at the largest
  // power-of-two multiple of that size the picture allows (at most 4096 across, within what a
  // phone's canvas holds), then halved step by step for a smooth result.
  function fit(image, maxW, maxH) {
    var w = image.naturalWidth, h = image.naturalHeight;
    if (!w || !h) throw new Error('empty');
    var scale = Math.min(1, maxW ? maxW / w : Infinity, maxH ? maxH / h : Infinity);
    var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    var factor = 1;
    while (Math.max(tw, th) * factor * 2 <= Math.min(Math.max(w, h), 4096)) factor *= 2;
    var current = document.createElement('canvas');
    current.width = tw * factor; current.height = th * factor;
    var context = current.getContext('2d');
    // A JPEG has no transparency: what's see-through in the picture becomes white, not black.
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, current.width, current.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, w, h, 0, 0, current.width, current.height);
    while (factor > 1) {
      factor /= 2;
      var next = document.createElement('canvas');
      next.width = tw * factor; next.height = th * factor;
      var nextContext = next.getContext('2d');
      nextContext.imageSmoothingQuality = 'high';
      nextContext.drawImage(current, 0, 0, current.width, current.height, 0, 0, next.width, next.height);
      current = next;
    }
    return current.toDataURL('image/jpeg', 0.82);
  }
  function initials(text, colour) {
    var c = canvas(250), context = c.getContext('2d');
    context.fillStyle = colour;
    context.fillRect(0, 0, 250, 250);
    context.fillStyle = '#FFFFFF';
    context.font = '600 104px -apple-system, Helvetica, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 125, 132);
    return c.toDataURL('image/png');
  }
  window.__job = function (job) {
    var work = job.kind === 'initials'
      ? Promise.resolve().then(function () { return initials(job.text, job.colour); })
      : job.kind === 'fit'
        ? load(job.src).then(function (image) { return fit(image, job.maxWidth, job.maxHeight); })
        : load(job.src).then(function (image) { return square(image, job.size); });
    work.then(
      function (url) { post({ id: job.id, url: url }); },
      function (error) { post({ id: job.id, error: String(error && error.message || error) }); }
    );
  };
  post({ ready: true });
})();
</script></body></html>`;

type JobInput = { kind: 'square'; src: string; size: number } | { kind: 'fit'; src: string; maxWidth: number | null; maxHeight: number | null } | { kind: 'initials'; text: string; colour: string };
type Job = JobInput & { id: number };

/** The maker and its hidden web view: render `element` once in the screen that uses it. */
export function usePictureMaker(): { maker: PictureMaker; element: ReactNode } {
  const view = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const queue = useRef<Job[]>([]);
  const waiting = useRef(new Map<number, { resolve: (url: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const nextId = useRef(1);

  const send = useCallback((job: Job) => {
    view.current?.injectJavaScript(`window.__job(${JSON.stringify(job)}); true;`);
  }, []);

  const run = useCallback(
    (job: JobInput) =>
      new Promise<string>((resolve, reject) => {
        const id = nextId.current++;
        const full: Job = { ...job, id };
        const timer = setTimeout(() => {
          waiting.current.delete(id);
          reject(new Error('Making the picture took too long.'));
        }, 30_000);
        waiting.current.set(id, { resolve, reject, timer });
        if (ready.current) send(full);
        else queue.current.push(full);
      }),
    [send],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: { ready?: boolean; id?: number; url?: string; error?: string };
      try {
        message = JSON.parse(event.nativeEvent.data) as typeof message;
      } catch {
        return;
      }
      if (message.ready) {
        ready.current = true;
        for (const job of queue.current.splice(0)) send(job);
        return;
      }
      const pending = message.id === undefined ? undefined : waiting.current.get(message.id);
      if (!pending || message.id === undefined) return;
      waiting.current.delete(message.id);
      clearTimeout(pending.timer);
      if (message.url && /^data:image\/(jpeg|png);base64,/.test(message.url)) pending.resolve(message.url);
      else pending.reject(new Error(message.error === 'unreadable' ? 'This picture can’t be read.' : 'The picture couldn’t be made.'));
    },
    [send],
  );

  const maker = useMemo<PictureMaker>(
    () => ({
      square: (dataUrl, size = 250) => run({ kind: 'square', src: dataUrl, size }),
      initials: (text, colour) => run({ kind: 'initials', text, colour }),
      fit: (dataUrl, maxWidth, maxHeight) => run({ kind: 'fit', src: dataUrl, maxWidth, maxHeight }),
    }),
    [run],
  );

  const element = (
    <WebView<object>
      ref={view}
      source={{ html: PAGE }}
      originWhitelist={['*']}
      incognito
      javaScriptEnabled
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url.startsWith('data:')}
      style={styles.hidden}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
  return { maker, element };
}

/** A colour for your initials, the same for the same name. */
export function initialsColour(name: string): string {
  const colours = ['#3B6FD8', '#7A4FCF', '#C2417A', '#D2622A', '#2F8F5B', '#1C8AA6', '#6B6F7B'];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return colours[hash % colours.length] as string;
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
