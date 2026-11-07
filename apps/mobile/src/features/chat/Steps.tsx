import type { DisplayItem, StepBlock } from '@maviechat/owui-protocol';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { CodeBlock } from '@/markdown/CodeBlock';
import { Markdown } from '@/markdown/Markdown';
import { fonts, usePalette } from '@/theme';
import { EmbedFrame } from './EmbedFrame';

/** "Thought for 4 seconds", "View result from web_search", …: the web app's step labels. */
export function stepLabel(step: StepBlock): string {
  switch (step.kind) {
    case 'reasoning':
      if (!step.done) return 'Thinking…';
      return step.durationSec !== null ? `Thought for ${formatDuration(step.durationSec)}` : 'Thought';
    case 'tool':
      if (step.waiting) return step.name === 'ask_user' ? 'Input needed' : `Waiting for your OK: ${step.name}`;
      if (step.rejected) return `Denied ${step.name}`;
      return step.done ? `View result from ${step.name}` : `Executing ${step.name}…`;
    case 'code':
      return step.done ? 'Analyzed' : 'Analyzing…';
    case 'search':
      return step.done ? `${step.label}${step.queries.length ? `: ${step.queries.join(', ')}` : ''}` : 'Searching…';
    default:
      return step.label;
  }
}

function stepIcon(step: StepBlock): IconName {
  switch (step.kind) {
    case 'reasoning':
      return 'light-bulb';
    case 'tool':
      return 'wrench-screwdriver';
    case 'code':
      return 'command-line';
    case 'search':
      return 'globe-alt';
    default:
      return 'sparkles';
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** A one-line step that opens to show its details. */
export function Disclosure({
  icon,
  label,
  busy,
  initiallyOpen = false,
  children,
}: {
  icon: IconName;
  label: string;
  busy: boolean;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.step}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        hitSlop={6}
        style={styles.stepHeader}>
        {busy ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name={icon} size={16} color={palette.textMuted} />}
        <Text style={[styles.stepLabel, { color: palette.textMuted }]} numberOfLines={open ? undefined : 1}>
          {label}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
      {open ? <View style={[styles.stepBody, { borderLeftColor: palette.border }]}>{children}</View> : null}
    </View>
  );
}

function StepContent({ step }: { step: StepBlock }) {
  const palette = usePalette();
  switch (step.kind) {
    case 'reasoning':
      return step.text ? <Markdown text={step.text} muted /> : <Text style={[styles.empty, { color: palette.textFaint }]}>No details.</Text>;
    case 'tool':
      return (
        <>
          {step.argumentsText ? <CodeBlock code={step.argumentsText} lang="json" title="Input" /> : null}
          {step.resultText !== null ? <CodeBlock code={step.resultText} title="Output" /> : null}
        </>
      );
    case 'code':
      return (
        <>
          <CodeBlock code={step.code} lang={step.lang} />
          {step.resultText ? <CodeBlock code={step.resultText} title="Output" /> : null}
        </>
      );
    case 'search':
      return step.queries.length ? <Markdown text={step.queries.map((query) => `- ${query}`).join('\n')} muted /> : null;
    default:
      return null;
  }
}

/**
 * `open`: starts opened (Open WebUI's "always expand details"). A tool that returned web content
 * shows that content under its name instead, unless it's in a group (the group shows it below).
 */
export function StepView({ step, open = false, grouped = false }: { step: StepBlock; open?: boolean; grouped?: boolean }) {
  const palette = usePalette();
  if (!grouped && step.kind === 'tool' && step.embeds?.length) {
    return (
      <View style={styles.step}>
        <View style={styles.stepHeader}>
          <Icon name="wrench-screwdriver" size={16} color={palette.textMuted} />
          <Text style={[styles.stepLabel, { color: palette.textMuted }]} numberOfLines={1}>
            {step.name}
          </Text>
        </View>
        <View style={styles.embeds}>
          {step.embeds.map((embed, index) => (
            <EmbedFrame key={index} embed={embed} args={step.argumentsText} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <Disclosure icon={stepIcon(step)} label={stepLabel(step)} busy={!step.done} initiallyOpen={open}>
      <StepContent step={step} />
    </Disclosure>
  );
}

/** Two or more consecutive steps, folded into one line ("Explored · 3 steps"). */
export function StepGroup({ item, open = false }: { item: Extract<DisplayItem, { kind: 'group' }>; open?: boolean }) {
  const busy = item.steps.some((step) => !step.done);
  const embeds = item.steps.flatMap((step) => (step.kind === 'tool' ? (step.embeds ?? []).map((embed) => ({ embed, args: step.argumentsText })) : []));
  return (
    <>
      <Disclosure icon="sparkles" label={busy ? `Exploring… · ${item.steps.length} steps` : `Explored · ${item.steps.length} steps`} busy={busy} initiallyOpen={open}>
        {item.steps.map((step) => (
          <StepView key={step.id} step={step} open={open} grouped />
        ))}
      </Disclosure>
      {embeds.length ? (
        <View style={styles.embeds}>
          {embeds.map((item, index) => (
            <EmbedFrame key={index} embed={item.embed} args={item.args} />
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  step: { marginVertical: 4 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  stepLabel: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  stepBody: { borderLeftWidth: 2, paddingLeft: 12, marginLeft: 7, marginTop: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14 },
  embeds: { gap: 8, marginTop: 4, marginBottom: 4 },
});
