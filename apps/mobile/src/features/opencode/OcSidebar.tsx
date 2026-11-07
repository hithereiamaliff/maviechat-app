import { deleteSession, renameSession, type Session } from '@maviechat/opencode-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { useAccountsSheet } from '@/features/accounts/AccountsSheet';
import { switchToDeepTutor, switchToOpenWebUI } from '@/features/deeptutor/switch';
import { SidebarAction, SidebarChatRow, SidebarNote, SidebarPanel, SidebarSearch, SidebarUser, sidebarStyles } from '@/features/sidebar/parts';
import { useSidebar } from '@/features/sidebar/SidebarContext';
import { DEVICE } from '@/lib/device';
import { useDebounced } from '@/lib/useDebounced';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useOcAuthed, useOpenCode } from '@/session/OpenCodeProvider';
import { useSession } from '@/session/SessionProvider';
import { usePalette } from '@/theme';
import { describeOcError } from './errors';
import { useOcProject, useProjectPicker } from './project';
import { folderName, ocKey, useOcSessions } from './queries';

/** OpenCode's sidebar: new session, the project in use, its sessions, and the account menu. */
export function OcSidebar() {
  const palette = usePalette();
  const sidebar = useSidebar();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session, accountId } = useOcAuthed();
  const openCode = useOpenCode();
  const owuiSignedIn = useSession().state.status === 'signed-in';
  const deepTutorSignedIn = useDeepTutor().state.status === 'signed-in';
  const project = useOcProject();
  const picker = useProjectPicker();
  const accountsSheet = useAccountsSheet('opencode');
  const [search, setSearch] = useState<string | null>(null);
  const query = useDebounced(search?.trim() ?? '', 300);
  const sessions = useOcSessions(project.directory, query);
  const pathname = usePathname();
  const currentId = pathname.startsWith('/code/s/') ? decodeURIComponent(pathname.slice('/code/s/'.length)) : null;
  const accountName = openCode.accounts.find((entry) => entry.id === accountId)?.name ?? session.machineName;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
  const newSession = () => {
    sidebar.close();
    router.replace('/code');
  };
  const open = (item: Session) => {
    sidebar.close();
    router.replace({ pathname: '/code/s/[id]', params: { id: item.id, dir: item.directory } });
  };

  const rowMenu = (item: Session): MenuItem[] => [
    {
      key: 'rename',
      label: 'Rename',
      icon: 'pencil',
      onPress: () =>
        showPrompt(
          'Rename Session',
          undefined,
          (title) => {
            if (title?.trim()) void renameSession(client, item.directory, item.id, title.trim()).then(refresh, (error: unknown) => toast(describeOcError(error), 'error'));
          },
          'plain-text',
          item.title,
        ),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash',
      destructive: true,
      onPress: () =>
        Alert.alert('Delete this session?', 'It is deleted on the machine too, for the terminal as well.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              void deleteSession(client, item.directory, item.id).then(
                () => {
                  refresh();
                  if (item.id === currentId) router.replace('/code');
                },
                (error: unknown) => toast(describeOcError(error), 'error'),
              ),
          },
        ]),
    },
  ];

  const userMenu: MenuItem[] = [
    {
      key: 'accounts',
      label: 'Machines',
      icon: 'computer-desktop',
      onPress: () => {
        sidebar.close();
        accountsSheet.open();
      },
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      onPress: () => {
        sidebar.close();
        router.push('/code/notifications');
      },
    },
    {
      key: 'owui',
      label: owuiSignedIn ? 'Switch to Open WebUI' : 'Connect Open WebUI',
      icon: owuiSignedIn ? 'arrows-right-left' : 'chat-bubble-left-right',
      onPress: () => {
        sidebar.close();
        if (owuiSignedIn) switchToOpenWebUI();
        else router.replace('/login');
      },
    },
    {
      key: 'deeptutor',
      label: deepTutorSignedIn ? 'Switch to DeepTutor' : 'Connect DeepTutor',
      icon: deepTutorSignedIn ? 'arrows-right-left' : 'academic-cap',
      onPress: () => {
        sidebar.close();
        switchToDeepTutor(deepTutorSignedIn);
      },
    },
    {
      key: 'signout',
      label: 'Remove This Machine',
      icon: 'arrow-right-start-on-rectangle',
      destructive: true,
      onPress: () =>
        Alert.alert(`Remove ${accountName}?`, `MavieChat forgets it on this ${DEVICE}, and the machine unpairs this ${DEVICE} once none of its accounts are left.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () =>
              void openCode.signOut().then((stillIn) => {
                router.replace(stillIn ? '/code' : owuiSignedIn ? '/' : deepTutorSignedIn ? '/learn' : '/welcome');
              }),
          },
        ]),
    },
  ];

  return (
    <SidebarPanel name={accountName} onNewChat={newSession}>
      <SidebarAction icon="pencil-square" label="New Session" onPress={newSession} />
      <SidebarAction
        icon="folder"
        label={project.directory ? folderName(project.directory) : 'Choose a Project'}
        hint={project.directory ?? 'Sessions belong to a project folder'}
        onPress={picker.open}
      />
      <SidebarSearch value={search} onChange={setSearch} placeholder="Search sessions" />
      <View style={sidebarStyles.list}>
        {!project.directory && project.ready ? <SidebarNote label="Pick a project to see its sessions." /> : null}
        {sessions.isError ? <SidebarNote label={describeOcError(sessions.error)} /> : null}
        <FlashList
          data={sessions.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <SidebarChatRow title={item.title || 'Untitled'} current={item.id === currentId} onOpen={() => open(item)} menu={rowMenu(item)} />}
          refreshing={false}
          onRefresh={refresh}
          ListFooterComponent={sessions.isLoading ? <ActivityIndicator style={sidebarStyles.more} color={palette.textMuted} /> : null}
          contentContainerStyle={sidebarStyles.listContent}
        />
      </View>
      <SidebarUser name={accountName} menu={userMenu} />
      {picker.element}
      {accountsSheet.element}
    </SidebarPanel>
  );
}
