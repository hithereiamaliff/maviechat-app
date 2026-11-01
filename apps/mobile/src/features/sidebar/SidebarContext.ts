import { createContext, useContext } from 'react';

export interface SidebarControls {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const SidebarContext = createContext<SidebarControls | null>(null);

export function useSidebar(): SidebarControls {
  const controls = useContext(SidebarContext);
  if (!controls) throw new Error('useSidebar must be used inside the app layout');
  return controls;
}
