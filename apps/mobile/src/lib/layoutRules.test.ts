import { describe, expect, it } from 'vitest';
import { CONTENT_MAX_WIDTH, isWideWidth, sidebarMode, WIDE_MIN_WIDTH } from './layoutRules';

describe('wide and narrow windows', () => {
  it('gives phones and narrow iPad windows the phone layout, and iPads full screen the wide one', () => {
    expect(isWideWidth(440)).toBe(false); // the widest iPhone
    expect(isWideWidth(744)).toBe(false); // iPad mini in portrait
    expect(isWideWidth(507)).toBe(false); // half of an iPad in Split View
    expect(isWideWidth(WIDE_MIN_WIDTH)).toBe(true);
    expect(isWideWidth(820)).toBe(true); // iPad Air in portrait
    expect(isWideWidth(1376)).toBe(true); // the 13-inch iPad Pro sideways
  });

  it('keeps the content column at the web’s chat width, wider than any phone', () => {
    expect(CONTENT_MAX_WIDTH).toBeGreaterThan(440);
    expect(CONTENT_MAX_WIDTH).toBe(928);
  });

  it('docks the sidebar on a wide window until hidden, and overlays it on a narrow one', () => {
    expect(sidebarMode(true, false, false)).toEqual({ docked: true, visible: true });
    expect(sidebarMode(true, true, false)).toEqual({ docked: false, visible: false });
    expect(sidebarMode(true, true, true)).toEqual({ docked: false, visible: true });
    expect(sidebarMode(false, false, false)).toEqual({ docked: false, visible: false });
    expect(sidebarMode(false, false, true)).toEqual({ docked: false, visible: true });
    // Hiding it on a wide window doesn't carry over as "closed" rules on a narrow one.
    expect(sidebarMode(false, true, true)).toEqual({ docked: false, visible: true });
  });
});
