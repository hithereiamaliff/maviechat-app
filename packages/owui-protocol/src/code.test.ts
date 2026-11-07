import { describe, expect, it, vi } from 'vitest';
import { codeRunEngine, executeCode, isPythonBlock, pyodideIndexUrl, splitOutputImages } from './code';
import type { OwuiClient } from './http';

describe('running code', () => {
  it('runs where the server says', () => {
    expect(codeRunEngine({ features: { enable_code_execution: true }, code: { engine: 'pyodide' } })).toBe('pyodide');
    expect(codeRunEngine({ features: { enable_code_execution: true }, code: { engine: 'jupyter' } })).toBe('jupyter');
    expect(codeRunEngine({ features: { enable_code_execution: false }, code: { engine: 'jupyter' } })).toBeNull();
    // Not loaded yet, or an older server: the web's defaults (on, in the browser).
    expect(codeRunEngine(undefined)).toBe('pyodide');
  });

  it('finds Pyodide on the server', () => {
    expect(pyodideIndexUrl('https://chat.example.com/')).toBe('https://chat.example.com/pyodide/');
    expect(pyodideIndexUrl('https://example.com/owui')).toBe('https://example.com/owui/pyodide/');
  });

  it("reads the server's Jupyter answer", async () => {
    const post = vi.fn().mockResolvedValue({ stdout: 'hi\n', stderr: '', result: '3' });
    await expect(executeCode({ post } as unknown as OwuiClient, 'print("hi")\n1+2')).resolves.toEqual({ stdout: 'hi\n', stderr: '', result: '3' });
    expect(post).toHaveBeenCalledWith('/api/v1/utils/code/execute', { code: 'print("hi")\n1+2' });
    post.mockResolvedValue(null);
    await expect(executeCode({ post } as unknown as OwuiClient, 'pass')).resolves.toEqual({ stdout: '', stderr: '', result: null });
  });

  it('takes plots out of printed output', () => {
    expect(splitOutputImages('before\ndata:image/png;base64,iVBORw0KGgo=\nafter\n data:image/svg+xml;base64,PHN2Zz4= ')).toEqual({
      text: 'before\nafter',
      images: ['data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zz4='],
    });
    expect(splitOutputImages('print("data:image/png;base64,") with words')).toEqual({ text: 'print("data:image/png;base64,") with words', images: [] });
  });

  it('knows Python blocks', () => {
    expect(isPythonBlock('python', 'x = 1')).toBe(true);
    expect(isPythonBlock('Py', 'x = 1')).toBe(true);
    expect(isPythonBlock('javascript', 'import x from "y"')).toBe(false);
    expect(isPythonBlock('', 'import numpy as np\nprint(np.pi)')).toBe(true);
    expect(isPythonBlock(undefined, 'def area(r):\n    return 3.14 * r * r')).toBe(true);
    expect(isPythonBlock('', 'npm install\ncd app')).toBe(false);
  });
});
