// Licence policy for anything the app ships: copyleft and Open WebUI-licensed code are not allowed.
export const FORBIDDEN = /\b(A?GPL|LGPL|SSPL|EUPL|OSL|CC-BY-NC)|open\s*webui/i;

const OPERATORS = new Set(['AND', 'OR', 'WITH', '(', ')']);

/**
 * Evaluates an SPDX expression: `A OR B` is acceptable when either side is,
 * `A AND B` only when both are; AND binds tighter than OR; parentheses group.
 * Words between operators form one identifier, so free-text licence names
 * such as "Open WebUI License" are judged as a whole.
 */
export function acceptable(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  const peek = () => tokens[index]?.toUpperCase();
  const atOperator = () => index >= tokens.length || OPERATORS.has(peek());
  function orExpr() {
    let ok = andExpr();
    while (peek() === 'OR') {
      index += 1;
      ok = andExpr() || ok;
    }
    return ok;
  }
  function andExpr() {
    let ok = factor();
    while (peek() === 'AND') {
      index += 1;
      ok = factor() && ok;
    }
    return ok;
  }
  function factor() {
    if (tokens[index] === '(') {
      index += 1;
      const ok = orExpr();
      index += 1; // ')'
      return ok;
    }
    const words = [];
    while (!atOperator()) words.push(tokens[index++]);
    let id = words.join(' ');
    if (peek() === 'WITH') {
      index += 1;
      const exception = [];
      while (!atOperator()) exception.push(tokens[index++]);
      id += ` WITH ${exception.join(' ')}`;
    }
    return id.length > 0 && !FORBIDDEN.test(id);
  }
  return orExpr();
}
