// The code editor page the app shows in a web view (bundled by scripts/gen-code-editor.mjs).
// CodeMirror 6 (MIT) does the editing; this file sets it up for Python on a phone and talks to
// the app: the app sends the code, theme and commands; the page sends the code back when asked,
// and says when it changed and what undo and redo can do.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const post = (message) => {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
};

// Syntax colours for a light and a dark page; the page's own colours come from the app.
const SYNTAX = {
  light: { keyword: '#8b2fc9', string: '#0a7a3f', number: '#b4530a', comment: '#6b7280', fn: '#1d4ed8', type: '#9a3412', decorator: '#be185d' },
  dark: { keyword: '#d19cf5', string: '#7ddc9a', number: '#f7b267', comment: '#8b93a1', fn: '#8cb8ff', type: '#f4a77c', decorator: '#f58fc4' },
};

function themeFor(look) {
  const c = look.colors || {};
  // The app's own code colours when it sends them (as its code blocks show code), else these.
  const s = { ...(look.dark ? SYNTAX.dark : SYNTAX.light), ...(look.syntax || {}) };
  const mono = 'ui-monospace, Menlo, "SF Mono", monospace';
  return [
    EditorView.theme(
      {
        '&': { color: c.text, backgroundColor: c.background, height: '100%', fontSize: `${look.fontSize || 13}px` },
        '.cm-scroller': { fontFamily: mono, lineHeight: '1.55' },
        '.cm-content': { caretColor: c.text, padding: '8px 0 40vh' },
        '.cm-gutters': { backgroundColor: c.background, color: c.faint, border: 'none', paddingLeft: '2px' },
        '.cm-lineNumbers .cm-gutterElement': { minWidth: '28px', padding: '0 8px 0 4px' },
        '.cm-activeLine': { backgroundColor: c.activeLine },
        '.cm-activeLineGutter': { backgroundColor: c.activeLine, color: c.muted },
        '&.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-cursor': { borderLeftColor: c.text, borderLeftWidth: '2px' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: c.selection },
        '.cm-matchingBracket': { backgroundColor: c.selection, outline: 'none' },
        '.cm-searchMatch': { backgroundColor: c.match },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: c.selection },
        '.cm-selectionMatch': { backgroundColor: c.activeLine },
        '.cm-panels': { backgroundColor: c.surface, color: c.text, borderColor: c.border },
        '.cm-panels input, .cm-panels button': { fontSize: '15px' },
        '.cm-textfield': { backgroundColor: c.background, color: c.text, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '4px 6px' },
        '.cm-button': { backgroundImage: 'none', backgroundColor: c.background, color: c.text, border: `1px solid ${c.border}`, borderRadius: '6px' },
        '.cm-panel.cm-search label': { fontSize: '14px' },
      },
      { dark: Boolean(look.dark) },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.self], color: s.keyword },
        { tag: [t.string, t.special(t.string), t.docString], color: s.string },
        { tag: [t.number, t.bool, t.null, t.atom], color: s.number },
        { tag: [t.comment, t.lineComment], color: s.comment, fontStyle: 'italic' },
        { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: s.fn },
        { tag: [t.className, t.definition(t.className), t.typeName], color: s.type },
        { tag: [t.meta, t.annotation], color: s.decorator },
        { tag: [t.operator, t.punctuation, t.bracket], color: c.muted },
        { tag: t.invalid, color: '#dc2626' },
      ]),
    ),
  ];
}

const init = window.__mavieInit || {};
let look = { dark: Boolean(init.dark), colors: init.colors || {}, syntax: init.syntax || {}, fontSize: init.fontSize || 13 };
const themeSlot = new Compartment();
const wrapSlot = new Compartment();
const readOnlySlot = new Compartment();

let docTimer = null;
let lastHistory = '';
const sendHistory = (state) => {
  const now = `${undoDepth(state) > 0}:${redoDepth(state) > 0}`;
  if (now === lastHistory) return;
  lastHistory = now;
  post({ type: 'history', undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 });
};

const view = new EditorView({
  parent: document.getElementById('editor'),
  state: EditorState.create({
    doc: typeof init.value === 'string' ? init.value : '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      python(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, { key: 'Tab', run: indentMore }, { key: 'Shift-Tab', run: indentLess }]),
      // A phone keyboard shouldn't correct or capitalise code.
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' }),
      themeSlot.of(themeFor(look)),
      wrapSlot.of(init.wrap ? EditorView.lineWrapping : []),
      readOnlySlot.of(EditorState.readOnly.of(Boolean(init.readOnly))),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          post({ type: 'dirty' });
          if (docTimer) clearTimeout(docTimer);
          docTimer = setTimeout(() => post({ type: 'doc', value: update.state.doc.toString() }), 400);
        }
        if (update.docChanged || update.transactions.length) sendHistory(update.state);
      }),
    ],
  }),
});

// A selection (or nothing) indented by one step: four spaces at the cursor, or each selected line.
function tab() {
  const range = view.state.selection.main;
  if (range.empty) view.dispatch(view.state.replaceSelection('    '));
  else indentMore(view);
  view.focus();
}

window.mavieEditor = {
  /** The look and the switches (theme colours, dark, font size, wrapping, read-only). */
  set(options) {
    const effects = [];
    if (options.colors || options.syntax || options.dark !== undefined || options.fontSize) {
      look = { ...look, ...options, colors: options.colors || look.colors, syntax: options.syntax || look.syntax };
      effects.push(themeSlot.reconfigure(themeFor(look)));
    }
    if (options.wrap !== undefined) effects.push(wrapSlot.reconfigure(options.wrap ? EditorView.lineWrapping : []));
    if (options.readOnly !== undefined) effects.push(readOnlySlot.reconfigure(EditorState.readOnly.of(Boolean(options.readOnly))));
    if (effects.length) view.dispatch({ effects });
  },
  /** Replaces the code as one change (undo brings the old back), e.g. after formatting. */
  setValue(value) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  },
  /** Sends the code now, answering the app's request `id`. */
  flush(id) {
    if (docTimer) clearTimeout(docTimer);
    post({ type: 'doc', id, value: view.state.doc.toString() });
  },
  run(command) {
    if (command === 'undo') undo(view);
    else if (command === 'redo') redo(view);
    else if (command === 'tab') tab();
    else if (command === 'dedent') indentLess(view);
    else if (command === 'find') openSearchPanel(view);
    else if (command === 'focus') view.focus();
    sendHistory(view.state);
  },
};

// The keyboard coming up shrinks the page: keep the cursor in sight.
window.addEventListener('resize', () => {
  if (view.hasFocus) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: 48 }) });
});

post({ type: 'ready' });
