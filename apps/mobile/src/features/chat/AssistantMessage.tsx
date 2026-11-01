import {
  errorText,
  groupSteps,
  latestStatus,
  messageBlocks,
  normalizeSources,
  plainText,
  type HistoryMessage,
} from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { BranchNav } from './BranchNav';
import { Sources } from './Sources';
import { StepGroup, StepView } from './Steps';

function usageSummary(usage: Record<string, unknown> | undefined): string | null {
  if (!usage) return null;
  const read = (...keys: string[]) => keys.map((key) => usage[key]).find((value) => typeof value === 'number') as number | undefined;
  const input = read('prompt_tokens', 'input_tokens');
  const output = read('completion_tokens', 'output_tokens');
  const total = read('total_tokens');
  const lines = [
    input !== undefined ? `Input tokens: ${input}` : null,
    output !== undefined ? `Output tokens: ${output}` : null,
    total !== undefined ? `Total tokens: ${total}` : null,
    typeof usage.cost === 'number' ? `Cost: ${usage.cost}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  modelLabel,
  branch,
  onStep,
  isLast,
  baseUrl,
  token,
}: {
  message: HistoryMessage;
  modelLabel: string;
  branch: { index: number; count: number };
  onStep: (step: -1 | 1) => void;
  isLast: boolean;
  baseUrl: string;
  token: string;
}) {
  const palette = usePalette();
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const items = useMemo(() => groupSteps(blocks), [blocks]);
  const sources = useMemo(() => normalizeSources(message.sources), [message.sources]);
  const status = latestStatus(message.statusHistory);
  const error = errorText(message.error);
  const streaming = message.done === false;
  const usage = usageSummary(message.usage);
  const showActions = isLast || revealed;

  return (
    <Pressable onPress={() => setRevealed((value) => !value)} style={styles.wrap} accessibilityHint="Shows message actions">
      <Text style={[styles.model, { color: palette.text }]} numberOfLines={1}>
        {modelLabel}
      </Text>

      {status ? (
        <View style={styles.status}>
          {status.done ? (
            <Icon name="check" size={14} color={palette.textMuted} strokeWidth={2} />
          ) : (
            <ActivityIndicator size="small" color={palette.textMuted} />
          )}
          <Text style={[styles.statusText, { color: palette.textMuted }]} numberOfLines={2}>
            {status.description}
          </Text>
        </View>
      ) : null}

      {items.map((item) =>
        item.kind === 'text' ? (
          <Markdown key={item.id} text={item.text} sources={sources} baseUrl={baseUrl} token={token} />
        ) : item.kind === 'group' ? (
          <StepGroup key={item.id} item={item} />
        ) : (
          <StepView key={item.id} step={item} />
        ),
      )}

      {streaming && items.length === 0 && !status ? <ActivityIndicator style={styles.pending} color={palette.textMuted} /> : null}

      {error ? (
        <View style={[styles.error, { borderColor: palette.danger }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Sources sources={sources} />

      {showActions && !streaming ? (
        <View style={styles.actions}>
          <BranchNav index={branch.index} count={branch.count} onStep={onStep} />
          <IconButton
            icon="clipboard-document"
            label="Copy response"
            size={18}
            color={palette.textMuted}
            onPress={() => {
              void Clipboard.setStringAsync(plainText(blocks)).then(() => toast('Copied to clipboard'));
            }}
          />
          {usage ? (
            <IconButton
              icon="information-circle"
              label="Usage"
              size={18}
              color={palette.textMuted}
              onPress={() => Alert.alert('Usage', usage)}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  model: { fontFamily: fonts.semibold, fontSize: 15, marginBottom: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  statusText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  pending: { alignSelf: 'flex-start', marginVertical: 8 },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginVertical: 8,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, marginLeft: -8 },
});
