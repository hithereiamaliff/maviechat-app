/**
 * Text prompts and action sheets on Android, where React Native has neither (`Alert.prompt` does
 * nothing there and `ActionSheetIOS` throws). The requests wait here in order, and
 * `DialogHost` shows the first. The shapes follow React Native's own, so a call reads the same
 * on both platforms; on iPhone, `components/dialogs.ts` hands them to iOS unchanged.
 */

/** React Native's `AlertButton`: `onPress` gets the text typed. */
export interface PromptButton {
  text?: string;
  onPress?: (value?: string) => unknown;
  isPreferred?: boolean;
  style?: 'default' | 'cancel' | 'destructive';
}

/** React Native's `ActionSheetIOSOptions`, the parts Android shows. */
export interface SheetOptions {
  title?: string;
  message?: string;
  options: readonly string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | readonly number[];
  disabledButtonIndices?: readonly number[];
}

export interface PromptRequest {
  kind: 'prompt';
  title: string;
  message: string | null;
  /** In the order they're shown: the cancel button first, as Android places it. */
  buttons: PromptButton[];
  /** What going back or tapping outside presses; nothing when there's no cancel button. */
  cancel: PromptButton | null;
  /** What the keyboard's return key presses: the last button that isn't cancel. */
  submit: PromptButton | null;
  secure: boolean;
  defaultValue: string;
  keyboardType: string | null;
}

export interface SheetRow {
  /** The option's index, as the callback receives it. */
  index: number;
  label: string;
  destructive: boolean;
  disabled: boolean;
}

export interface SheetRequest {
  kind: 'sheet';
  title: string | null;
  message: string | null;
  /** Every option but the cancel one. */
  rows: SheetRow[];
  /** The cancel option's label and index; going back or tapping outside picks it. */
  cancel: { index: number; label: string } | null;
  onPick(index: number): void;
}

export type DialogRequest = (PromptRequest | SheetRequest) & { id: number };

const text = (value: string | null | undefined) => (value ? value : null);

/**
 * A prompt as iOS would show it: a callback alone gets Cancel and OK, and runs on OK with the
 * text; given buttons, each gets the text.
 */
export function promptRequest(
  title: string | null | undefined,
  message?: string | null,
  callbackOrButtons?: ((value: string) => void) | readonly PromptButton[] | null,
  type?: string | null,
  defaultValue?: string,
  keyboardType?: string,
): PromptRequest {
  const given: PromptButton[] =
    typeof callbackOrButtons === 'function'
      ? [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', onPress: (value?: string) => callbackOrButtons(value ?? '') }]
      : (callbackOrButtons ?? []).filter((button) => button.text);
  const buttons: PromptButton[] = given.length ? given : [{ text: 'Cancel', style: 'cancel' }, { text: 'OK' }];
  const cancel = buttons.find((button) => button.style === 'cancel') ?? null;
  const others = buttons.filter((button) => button !== cancel);
  return {
    kind: 'prompt',
    title: title ?? '',
    message: text(message),
    buttons: cancel ? [cancel, ...others] : others,
    cancel,
    submit: others[others.length - 1] ?? null,
    secure: type === 'secure-text' || type === 'login-password',
    defaultValue: defaultValue ?? '',
    keyboardType: keyboardType ?? null,
  };
}

/** An action sheet: the options as rows, with the cancel option kept apart. */
export function sheetRequest(options: SheetOptions, onPick: (index: number) => void): SheetRequest {
  const destructive = options.destructiveButtonIndex;
  const isDestructive = (index: number) => (typeof destructive === 'number' ? destructive === index : (destructive ?? []).includes(index));
  const cancelIndex = options.cancelButtonIndex;
  const cancelLabel = cancelIndex === undefined ? undefined : options.options[cancelIndex];
  return {
    kind: 'sheet',
    title: text(options.title),
    message: text(options.message),
    rows: options.options
      .map((label, index) => ({ index, label, destructive: isDestructive(index), disabled: (options.disabledButtonIndices ?? []).includes(index) }))
      .filter((row) => row.index !== cancelIndex),
    cancel: cancelIndex === undefined || cancelLabel === undefined ? null : { index: cancelIndex, label: cancelLabel },
    onPick,
  };
}

/**
 * An alert's buttons as an action sheet, for Android, whose alert shows three buttons at most.
 * Going back or tapping outside presses the cancel button, as iOS's Cancel would.
 */
export function choiceRequest(title: string | null | undefined, message: string | null | undefined, buttons: readonly PromptButton[]): SheetRequest {
  const cancelIndex = buttons.findIndex((button) => button.style === 'cancel');
  return sheetRequest(
    {
      title: title ?? undefined,
      message: message ?? undefined,
      options: buttons.map((button) => button.text || 'OK'),
      cancelButtonIndex: cancelIndex === -1 ? undefined : cancelIndex,
      destructiveButtonIndex: buttons.flatMap((button, index) => (button.style === 'destructive' ? [index] : [])),
    },
    (index) => void buttons[index]?.onPress?.(),
  );
}

let queue: DialogRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Queues a dialog; it shows once those before it have closed. */
export function openDialog(request: PromptRequest | SheetRequest): void {
  queue = [...queue, { ...request, id: nextId++ }];
  changed();
}

/** Takes a dialog away (it was answered or dismissed). */
export function closeDialog(id: number): void {
  queue = queue.filter((request) => request.id !== id);
  changed();
}

/** The dialog to show now. */
export const currentDialog = (): DialogRequest | null => queue[0] ?? null;

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
