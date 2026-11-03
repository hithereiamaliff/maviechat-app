import type { PendingApproval } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { CodeBlock } from '@/markdown/CodeBlock';
import { fonts, radius, usePalette } from '@/theme';
import { Disclosure } from './Steps';

/**
 * A tool call waiting for your OK (tool permissions set to "Ask for approval"), as the web asks:
 * Allow runs it and the reply carries on; Deny tells the model it was refused.
 */
export function ApprovalCard({ call, onDecide }: { call: PendingApproval; onDecide?: (approve: boolean) => Promise<void> }) {
  const palette = usePalette();
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const decide = async (approve: boolean) => {
    if (!onDecide || busy) return;
    setBusy(approve ? 'allow' : 'deny');
    try {
      await onDecide(approve);
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <View style={styles.head}>
        <Icon name="shield-check" size={16} color={palette.textMuted} />
        <Text style={[styles.title, { color: palette.text }]}>{`Allow ${call.name}?`}</Text>
      </View>
      <Text style={[styles.note, { color: palette.textMuted }]}>The model wants to use this tool. The reply waits for your answer.</Text>
      {call.argumentsText ? (
        <Disclosure icon="code-bracket" label="What it will send" busy={false}>
          <CodeBlock code={call.argumentsText} lang="json" />
        </Disclosure>
      ) : null}
      {onDecide ? (
        <View style={styles.buttons}>
          <View style={styles.grow}>
            <Button label="Allow" onPress={() => void decide(true)} loading={busy === 'allow'} disabled={busy !== null} />
          </View>
          <View style={styles.grow}>
            <Button label="Deny" variant="secondary" onPress={() => void decide(false)} loading={busy === 'deny'} disabled={busy !== null} />
          </View>
        </View>
      ) : (
        <Text style={[styles.note, { color: palette.textMuted }]}>A temporary chat can&apos;t answer this here.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 8, marginVertical: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
