/*
 * Wide and narrow windows (iPads and big Android screens). Kept free of React Native so the rules
 * can be tested on their own; `lib/layout.ts` reads the window.
 */

/** Windows at least this wide (an iPad in portrait, full screen) get the wide layout: the sidebar beside the content. */
export const WIDE_MIN_WIDTH = 768;

/** The widest a space's content gets on a wide window: the web app's chat column (58 rem). */
export const CONTENT_MAX_WIDTH = 928;

/** Sheets rising from the bottom (Android's menus and prompts) stop growing here on big screens. */
export const SHEET_MAX_WIDTH = 560;

/** The sign-in and pairing screens' column on big screens. */
export const FORM_MAX_WIDTH = 480;

/**
 * Whether a window this wide gets the wide layout. It follows the window, not the device: an
 * iPad's Split View or Slide Over, or Android's multi-window, can be as narrow as a phone.
 */
export function isWideWidth(width: number): boolean {
  return width >= WIDE_MIN_WIDTH;
}

/**
 * How a space's sidebar shows. On a wide window it sits beside the content (docked) unless you hid
 * it; otherwise it's an overlay, showing while open.
 */
export function sidebarMode(wide: boolean, hidden: boolean, open: boolean): { docked: boolean; visible: boolean } {
  const docked = wide && !hidden;
  return { docked, visible: docked || open };
}
