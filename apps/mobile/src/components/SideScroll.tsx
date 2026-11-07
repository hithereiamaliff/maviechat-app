import { createContext, use, useMemo, type ComponentRef, type Ref, type RefObject } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';

/**
 * The sidebar's swipe (`SpaceDrawer`), for the sideways scrollers on its screens. It opens the
 * sidebar from anywhere once a finger has moved a few points sideways, so on its own it takes over
 * every sideways scroll: a wide table, code, a row of chips.
 */
export const SidebarSwipeContext = createContext<RefObject<GestureType | undefined> | null>(null);

/** A gesture for a scroll view that the sidebar's swipe waits for: while the view scrolls, the sidebar stays put. */
function useScrollFirst() {
  const swipe = use(SidebarSwipeContext);
  return useMemo(() => (swipe ? Gesture.Native().disallowInterruption(true).shouldCancelWhenOutside(false).blocksExternalGesture(swipe) : null), [swipe]);
}

/**
 * A sideways scroller (a table, code, maths, a row of chips or tabs) that wins over the sidebar's
 * swipe, as on the web: a sideways swipe on it scrolls it. When everything in it fits, it has
 * nothing to scroll, and the same swipe opens (or closes) the sidebar as anywhere else.
 */
export function SideScroll({ ref, ...props }: ScrollViewProps & { ref?: Ref<ComponentRef<typeof ScrollView>> }) {
  const gesture = useScrollFirst();
  const scroller = <ScrollView ref={ref} horizontal alwaysBounceHorizontal={false} {...props} />;
  return gesture ? <GestureDetector gesture={gesture}>{scroller}</GestureDetector> : scroller;
}
