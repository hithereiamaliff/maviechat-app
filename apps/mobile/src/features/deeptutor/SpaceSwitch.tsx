import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { useSession } from '@/session/SessionProvider';
import type { Space } from '@/session/storage';
import { switchToDeepTutor, switchToOpenCode, switchToOpenWebUI } from './switch';

/**
 * Top left in each space: over to the other spaces you're signed in to. One other space is a
 * button; more make it a menu.
 */
export function SpaceSwitchButton({ current }: { current: Space }) {
  const owui = useSession().state.status === 'signed-in';
  const deepTutor = useDeepTutor().state.status === 'signed-in';
  const openCode = useOpenCode().state.status === 'signed-in';
  const others: MenuItem[] = [
    ...(current !== 'owui' && owui ? [{ key: 'owui', label: 'Open WebUI', icon: 'chat-bubble-left-right' as const, onPress: switchToOpenWebUI }] : []),
    ...(current !== 'deeptutor' && deepTutor ? [{ key: 'deeptutor', label: 'DeepTutor', icon: 'academic-cap' as const, onPress: () => switchToDeepTutor(true) }] : []),
    ...(current !== 'opencode' && openCode ? [{ key: 'opencode', label: 'OpenCode', icon: 'code-bracket' as const, onPress: () => switchToOpenCode(true) }] : []),
  ];
  const only = others.length === 1 ? others[0] : undefined;
  if (only) return <IconButton icon="arrows-right-left" label={`Switch to ${only.label}`} onPress={only.onPress} />;
  return others.length > 1 ? <MenuButton items={others} label="Switch space" icon="arrows-right-left" /> : null;
}

/** Top left in Open WebUI. */
export const SwitchToDeepTutorButton = () => <SpaceSwitchButton current="owui" />;

/** Top left in DeepTutor. */
export const SwitchToOpenWebUIButton = () => <SpaceSwitchButton current="deeptutor" />;
