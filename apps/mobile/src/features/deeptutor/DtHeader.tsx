import { router } from 'expo-router';
import type { ReactNode } from 'react';
import type { MenuItem } from '@/components/Menu';
import { SpaceBar } from '@/features/sidebar/SpaceBar';
import { SwitchToOpenWebUIButton } from './SpaceSwitch';

/** DeepTutor's bar, laid out like Open WebUI's: the sidebar button and the switch to Open WebUI, title, extra buttons, new chat, menu. */
export function DtHeader({ title, menu, menuLabel, accessory }: { title?: string; menu?: MenuItem[]; menuLabel?: string; accessory?: ReactNode }) {
  return (
    <SpaceBar
      title={title}
      menu={menu}
      menuLabel={menuLabel}
      accessory={accessory}
      switchButton={<SwitchToOpenWebUIButton />}
      onNewChat={() => router.replace('/learn')}
    />
  );
}
