import { router } from 'expo-router';
import type { ReactNode } from 'react';
import type { MenuItem } from '@/components/Menu';
import { SpaceSwitchButton } from '@/features/deeptutor/SpaceSwitch';
import { SpaceBar } from '@/features/sidebar/SpaceBar';

/** The top bar in OpenCode: the sidebar, the space switch, the title, and new session. */
export function OcHeader({ title, menu, accessory }: { title?: string; menu?: MenuItem[]; accessory?: ReactNode }) {
  return <SpaceBar title={title} menu={menu} menuLabel="Session options" accessory={accessory} switchButton={<SpaceSwitchButton current="opencode" />} onNewChat={() => router.replace('/code')} />;
}
