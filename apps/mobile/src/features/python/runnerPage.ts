import { inScript } from '@/markdown/webPages';

/**
 * Python's plots as pictures: matplotlib draws off screen, and `show()` (or a figure left open
 * when the code ends) prints each figure as a `data:image/png;base64,…` line, as the web prints
 * them. Runs in its own namespace, so your code's names stay yours.
 */
const PLOTS = `
import base64, io, os
os.environ["MPLBACKEND"] = "AGG"
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt

def show(*args, **kwargs):
    for number in plt.get_fignums():
        buffer = io.BytesIO()
        plt.figure(number).savefig(buffer, format="png", bbox_inches="tight")
        print("data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"))
    plt.close("all")

plt.show = show
`;

/**
 * The page that runs Python for the app: Pyodide loaded from `indexUrl` (the Open WebUI server's
 * own copy), one job at a time, each reporting what it printed, its errors and its last value.
 * `generation` is echoed in every message, so a page the app has replaced can't answer for the new one.
 */
export function pythonPage(indexUrl: string, generation: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  var INDEX = ${inScript(JSON.stringify(indexUrl))};
  var GENERATION = ${generation};
  var PLOTS = ${inScript(JSON.stringify(PLOTS))};
  var bridge = window.ReactNativeWebView;
  var post = function (message) { message.g = GENERATION; bridge.postMessage(JSON.stringify(message)); };
  var describe = function (error) { return String((error && error.message) || error); };
  // No dialogs from a hidden page.
  window.alert = window.confirm = window.prompt = function () { return null; };
  var stdout = '';
  var stderr = '';
  var pyodide = null;
  var plots = null;
  var queue = Promise.resolve();

  var ready = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = INDEX + 'pyodide.js';
    script.onerror = function () { reject(new Error('the server did not send Python (' + INDEX + 'pyodide.js)')); };
    script.onload = function () {
      loadPyodide({
        indexURL: INDEX,
        stdin: function () { return null; },
        stdout: function (line) { stdout += line + '\\n'; },
        stderr: function (line) { stderr += line + '\\n'; }
      }).then(resolve, reject);
    };
    document.head.appendChild(script);
  });

  ready.then(function (loaded) {
    pyodide = loaded;
    try { pyodide.FS.mkdirTree('/mnt/uploads'); } catch (error) {}
    post({ type: 'ready' });
  }, function (error) {
    post({ type: 'failed', error: describe(error) });
  });

  function save(file) {
    var binary = atob(file.base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    pyodide.FS.writeFile('/mnt/uploads/' + file.name, bytes);
  }

  function json(value) {
    return JSON.parse(JSON.stringify(value, function (key, item) {
      if (typeof item === 'bigint') return item.toString();
      if (item instanceof Map) return Object.fromEntries(item);
      if (item instanceof Set) return Array.from(item);
      if (ArrayBuffer.isView(item)) return Array.from(item);
      return item;
    }));
  }

  // The last line's value: plain values as they are, lists and dicts as JSON, anything else as Python shows it.
  function plain(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object' && typeof value !== 'function') return value;
    if (typeof value.toJs !== 'function') return json(value);
    var out;
    try {
      out = /^(dict|list|tuple|set|frozenset)$/.test(value.type)
        ? json(value.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false }))
        : String(pyodide.pyimport('builtins').repr(value));
    } catch (error) {
      out = String(value);
    }
    try { value.destroy(); } catch (error) {}
    return out;
  }

  async function run(job) {
    stdout = '';
    stderr = '';
    var result = null;
    try {
      await ready;
      (job.files || []).forEach(save);
      // The packages the code imports, from the server; quietly, and a failed one tried once more
      // (code importing a half-loaded package would break that package until Python starts again).
      var failed = [];
      var options = { messageCallback: function () {}, errorCallback: function (message) { failed.push(message); } };
      try {
        await pyodide.loadPackagesFromImports(job.code, options);
        if (failed.length) {
          failed = [];
          await pyodide.loadPackagesFromImports(job.code, options);
        }
      } catch (error) {
        failed.push(describe(error));
      }
      if (failed.length) stderr += 'Some packages could not be loaded: ' + failed.join(' ') + '\\n';
      var drawing = Boolean(pyodide.loadedPackages && pyodide.loadedPackages.matplotlib);
      if (drawing && !plots) {
        plots = pyodide.globals.get('dict')();
        await pyodide.runPythonAsync(PLOTS, { globals: plots });
      }
      post({ type: 'started', id: job.id });
      result = plain(await pyodide.runPythonAsync(job.code));
      if (plots) await pyodide.runPythonAsync('show()', { globals: plots });
    } catch (error) {
      stderr += describe(error);
    }
    post({ type: 'done', id: job.id, stdout: stdout, stderr: stderr, result: result });
  }

  window.mavieRun = function (job) {
    queue = queue.then(function () { return run(job); });
  };
})();
</script></body></html>`;
}
