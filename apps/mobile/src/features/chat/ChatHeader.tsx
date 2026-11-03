import { router } from 'expo-router';
import type { ReactNode } from 'react';
import type { MenuItem } from '@/components/Menu';
import { SwitchToDeepTutorButton } from '@/features/deeptutor/SpaceSwitch';
import { SpaceBar } from '@/features/sidebar/SpaceBar';

/** Phone layout of the web app's navbar: sidebar button and the switch to DeepTutor, title, extra buttons, new chat, chat menu. */
export function ChatHeader({ title, menu, accessory }: { title?: string; menu?: MenuItem[]; accessory?: ReactNode }) {
  return <SpaceBar title={title} menu={menu} accessory={accessory} switchButton={<SwitchToDeepTutorButton />} onNewChat={() => router.replace('/')} />;
}
