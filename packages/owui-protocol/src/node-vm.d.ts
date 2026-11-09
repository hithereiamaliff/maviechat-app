// Node's vm, for the tests that run a page's script in a sandbox (this package has no Node types).
declare module 'node:vm' {
  export function createContext(sandbox: Record<string, unknown>): Record<string, unknown>;
  export function runInContext(code: string, context: Record<string, unknown>): unknown;
  const vm: { createContext: typeof createContext; runInContext: typeof runInContext };
  export default vm;
}
