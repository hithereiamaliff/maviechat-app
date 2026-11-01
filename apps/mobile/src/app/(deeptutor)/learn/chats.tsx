import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { SessionList } from '@/features/deeptutor/SessionList';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { fonts, radius, usePalette } from '@/theme';

/** Your DeepTutor chats as a native list, to read one or bring it into an Open WebUI chat. */
export default function DeepTutorChats() {
  const palette = usePalette();
  return (
    <View style={styles.screen}>
      <SpaceHeader
        leading={<IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn'))} />}
        title="DeepTutor chats"
      />
      <SessionList
        rowHint="Opens the chat"
        empty="No DeepTutor chats yet."
        onOpen={(item) => router.push({ pathname: '/learn/[id]', params: { id: item.id } })}
        header={
          <View style={[styles.note, { backgroundColor: palette.surface }]}>
            <Text style={[styles.noteText, { color: palette.textMuted }]}>
              Open a chat to read it or to ask about it in Open WebUI.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  note: { marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: radius.md },
  noteText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
