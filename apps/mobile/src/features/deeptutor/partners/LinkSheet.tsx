import { createLinkCode, listPartnerLinks, removePartnerLink, type DtLinkCode, type DtPartnerLink } from '@maviechat/deeptutor-protocol';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { channelLabel, shortWhen } from './labels';

/**
 * Ties one of your chat-app accounts to your DeepTutor account through a partner, as the web's
 * Link dialog does: a code to send it there in a direct message, and the accounts linked so far.
 */
export function LinkSheet({ visible, partnerId, name, channels, onClose }: { visible: boolean; partnerId: string; name: string; channels: string[] | null; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Links partnerId={partnerId} name={name} channels={channels} onClose={onClose} /> : null}
    </Modal>
  );
}

function Links({ partnerId, name, channels, onClose }: { partnerId: string; name: string; channels: string[] | null; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const links = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'links', partnerId], queryFn: () => listPartnerLinks(client, partnerId) });
  const [code, setCode] = useState<DtLinkCode | null>(null);
  const [busy, setBusy] = useState(false);

  const getCode = async () => {
    setBusy(true);
    try {
      setCode(await createLinkCode(client, partnerId));
    } catch (error) {
      toast(`Couldn’t get a code: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const unlink = (link: DtPartnerLink) =>
    Alert.alert('Unlink this account?', `${channelLabel(link.channel)} · ${link.senderId} talks to ${name} as a stranger again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: () =>
          void removePartnerLink(client, partnerId, link.key).then(
            () => void links.refetch(),
            (error: unknown) => toast(`Couldn’t unlink it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Link a Chat App
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.body, { color: palette.textMuted }]}>
          {`Talk to ${name} from a chat app it’s in, as you: those conversations join your history here and use your library and memory. Get a code, then send it to ${name} in a direct message in that app.`}
        </Text>
        {channels && !channels.length ? (
          <Text style={[styles.warn, { color: palette.warning }]}>{`${name} isn’t in any chat app yet. Set one up on DeepTutor’s web page first.`}</Text>
        ) : null}
        {code ? (
          <View style={[styles.code, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.codeRow}>
              <Text style={[styles.command, { color: palette.text }]} selectable>
                {code.command}
              </Text>
              <IconButton icon="clipboard-document" label="Copy the command" size={18} onPress={() => void Clipboard.setStringAsync(code.command).then(() => toast('Copied'))} />
            </View>
            <Text style={[styles.hint, { color: palette.textFaint }]}>{`Works once, for 15 minutes${code.expiresAt ? ` (until ${new Date(code.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}. A new code replaces this one.`}</Text>
          </View>
        ) : null}
        <Button label={code ? 'New Code' : 'Get a Link Code'} variant={code ? 'secondary' : 'primary'} loading={busy} onPress={() => void getCode()} />

        <Text style={[styles.section, { color: palette.textMuted }]} accessibilityRole="header">
          Linked Accounts
        </Text>
        {links.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {links.isError ? <Text style={[styles.hint, { color: palette.textMuted }]}>{`Couldn’t load them: ${describeError(links.error)}`}</Text> : null}
        {links.data && !links.data.length ? <Text style={[styles.hint, { color: palette.textFaint }]}>None yet.</Text> : null}
        {links.data?.length ? (
          <View style={[styles.group, { borderColor: palette.border }]}>
            {links.data.map((link, index) => (
              <View key={link.key} style={[styles.link, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
                <View style={styles.linkText}>
                  <Text style={[styles.linkName, { color: palette.text }]}>{`${channelLabel(link.channel)} · ${link.senderId}`}</Text>
                  {link.linkedAt ? <Text style={[styles.hint, { color: palette.textFaint }]}>{`Linked ${shortWhen(link.linkedAt)}`}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => unlink(link)} hitSlop={8}>
                  <Text style={[styles.unlink, { color: palette.danger }]}>Unlink</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  warn: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  code: { gap: 6, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  command: { flex: 1, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 1 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 12, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  linkText: { flex: 1, gap: 2 },
  linkName: { fontFamily: fonts.regular, fontSize: 15 },
  unlink: { fontFamily: fonts.medium, fontSize: 14 },
});
