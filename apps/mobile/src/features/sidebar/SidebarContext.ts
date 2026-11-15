import { createContext, useContext } from 'react';

export interface SidebarControls {
  /** The sidebar is showing: open over the content, or beside it on a wide window. */
  isOpen: boolean;
  /** It sits beside the content (a wide window, not hidden), instead of over it. */
  docked: boolean;
  /** Shows it: opens it over the content, or brings it back beside it on a wide window. */
  open: () => void;
  /** After choosing something in it: closes it over the content. Beside the content it stays. */
  close: () => void;
  /** Its own close button: closes it, or hides it from beside the content. */
  hide: () => void;
}

export const SidebarContext = createContext<SidebarControls | null>(null);

export function useSidebar(): SidebarControls {
  const controls = useContext(SidebarContext);
  if (!controls) throw new Error('useSidebar must be used inside the app layout');
  return controls;
}
