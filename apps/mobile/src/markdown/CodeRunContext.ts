import { createContext } from 'react';

/** What running a code block gave: printed text, errors, the last line's value, and pictures it printed. */
export interface CodeRun {
  stdout: string;
  stderr: string;
  /** Null when the last line had no value. */
  result: unknown;
  /** Plots and other pictures, as `data:image/…` addresses. */
  images: string[];
}

/**
 * Given by an Open WebUI chat where the admin allows running code: a Python block's Run runs it
 * there (the server's Jupyter, or Python on the phone as the web runs it in the browser).
 */
export const CodeRunContext = createContext<((code: string) => Promise<CodeRun>) | null>(null);
