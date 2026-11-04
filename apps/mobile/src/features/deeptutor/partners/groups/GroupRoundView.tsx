import { canSummarise, type DtGroupMember, type DtGroupRound, type DtGroupSeat, type DtInvocation } from '@maviechat/deeptutor-protocol';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { DtReplyView, DtUserBubble } from '@/features/deeptutor/chat/DtReplyView';
import { fonts, radius, usePalette } from '@/theme';
import { PartnerFace } from '../PartnerFace';

export interface RoundActions {
  onApprove(invocation: DtInvocation): void;
  onReject(invocation: DtInvocation): void;
  /** Quote the answer into the message box. */
  onFollowUp(seat: DtGroupSeat): void;
  /** Have this member ask another something about its answer. */
  onAskAnother(seat: DtGroupSeat): void;
  onPin(seat: DtGroupSeat): void;
  onRetry(round: DtGroupRound, seat: DtGroupSeat): void;
  onSummarise(round: DtGroupRound): void;
}

const KIND_LABELS: Record<string, string> = { debate_rebuttal: 'Rebuttal', round_summary: 'Summary', invocation_reply: 'Answer' };

/** One round of a group discussion, as the web lays it out. */
export const GroupRoundView = memo(function GroupRoundView({
  round,
  members,
  baseUrl,
  busy,
  actions,
}: {
  round: DtGroupRound;
  members: DtGroupMember[];
  baseUrl: string;
  /** Something is running in the discussion: no new operations from here. */
  busy: boolean;
  actions: RoundActions;
}) {
  const palette = usePalette();
  const member = (id: string) => members.find((item) => item.id === id);
  const done = round.seats.filter((seat) => seat.state === 'done' || seat.state === 'error').length;
  const rebuttals = round.seats.some((seat) => seat.kind === 'debate_rebuttal');

  return (
    <View style={styles.round}>
      {round.user ? <DtUserBubble text={round.user.content} /> : null}
      {round.question ? (
        <View style={[styles.followUp, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <View style={styles.followUpHead}>
            <Icon name="chat-bubble-left-right" size={14} color={palette.textMuted} />
            <Text style={[styles.followUpTitle, { color: palette.textMuted }]} numberOfLines={1}>
              {`${round.question.authorName || 'A member'} asked ${member(round.question.mentions[0] ?? '')?.name ?? round.question.invocation?.targetName ?? 'another member'}`}
            </Text>
          </View>
          <Text style={[styles.followUpText, { color: palette.text }]}>{round.question.content}</Text>
        </View>
      ) : null}
      {round.live && round.user ? (
        <Text style={[styles.progress, { color: palette.textMuted }]}>{`${rebuttals ? 'Second round · ' : ''}${done} of ${round.seats.length} answered`}</Text>
      ) : null}
      {round.seats.map((seat) => (
        <SeatView key={seat.key} round={round} seat={seat} face={member(seat.partnerId)} baseUrl={baseUrl} busy={busy || round.live} actions={actions} />
      ))}
      {round.stopped ? <Text style={[styles.stopped, { color: palette.textFaint }]}>You stopped this round.</Text> : null}
      {canSummarise(round) && !busy ? (
        <Pressable accessibilityRole="button" onPress={() => actions.onSummarise(round)} style={({ pressed }) => [styles.summarise, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Icon name="list-bullet" size={15} color={palette.text} />
          <Text style={[styles.summariseText, { color: palette.text }]}>Sum Up This Round</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

function SeatView({ round, seat, face, baseUrl, busy, actions }: { round: DtGroupRound; seat: DtGroupSeat; face: DtGroupMember | undefined; baseUrl: string; busy: boolean; actions: RoundActions }) {
  const palette = usePalette();
  const kind = KIND_LABELS[seat.kind];
  const name = kind ? `${seat.name} · ${kind}` : seat.name;
  const avatar = <PartnerFace face={face ?? { name: seat.name }} size={22} />;
  const invocation = seat.message?.invocation;
  return (
    <View style={styles.seat}>
      {seat.state === 'waiting' ? (
        <View style={styles.waiting}>
          {avatar}
          <Text style={[styles.waitingName, { color: palette.text }]} numberOfLines={1}>
            {seat.name}
          </Text>
          <ActivityIndicator size="small" color={palette.textFaint} />
          <Text style={[styles.waitingText, { color: palette.textFaint }]}>Waiting its turn…</Text>
        </View>
      ) : (
        <DtReplyView reply={seat.reply} baseUrl={baseUrl} stateKey={seat.key} last={false} speaker={{ name, face: avatar }} />
      )}
      {seat.state === 'error' && !busy ? <SeatButton icon="arrow-path" label="Try Again" onPress={() => actions.onRetry(round, seat)} /> : null}
      {seat.state === 'done' && seat.message && !busy ? (
        <View style={styles.seatActions}>
          <SeatButton icon="chat-bubble-left" label="Follow Up" onPress={() => actions.onFollowUp(seat)} />
          {seat.kind !== 'round_summary' ? <SeatButton icon="users" label="Ask Another" onPress={() => actions.onAskAnother(seat)} /> : null}
          <SeatButton icon="bookmark" label="Pin" onPress={() => actions.onPin(seat)} />
        </View>
      ) : null}
      {invocation && invocation.status !== 'completed' ? <InvocationCard invocation={invocation} busy={busy} actions={actions} /> : null}
    </View>
  );
}

function SeatButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.seatButton, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Icon name={icon} size={13} color={palette.textMuted} />
      <Text style={[styles.seatButtonText, { color: palette.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** A member's proposal to ask another: waiting for you, or what became of it. */
function InvocationCard({ invocation, busy, actions }: { invocation: DtInvocation; busy: boolean; actions: RoundActions }) {
  const palette = usePalette();
  const status =
    invocation.status === 'approved'
      ? `Waiting for ${invocation.targetName}…`
      : invocation.status === 'rejected'
        ? 'You said not now.'
        : invocation.status === 'cancelled'
          ? 'Stopped.'
          : invocation.status === 'failed'
            ? `It didn’t work: ${invocation.error || 'no answer'}`
            : null;
  return (
    <View style={[styles.invocation, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <Text style={[styles.invocationTitle, { color: palette.textMuted }]}>{`${invocation.requesterName} wants to ask ${invocation.targetName}`}</Text>
      <Text style={[styles.invocationQuestion, { color: palette.text }]}>{invocation.question}</Text>
      {invocation.status === 'pending' ? (
        <View style={styles.invocationButtons}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => actions.onApprove(invocation)} style={[styles.approve, { backgroundColor: busy ? palette.surfaceStrong : palette.primary }]}>
            <Text style={[styles.approveText, { color: busy ? palette.textFaint : palette.onPrimary }]}>Let Them Discuss</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => actions.onReject(invocation)} hitSlop={6}>
            <Text style={[styles.reject, { color: palette.link }]}>Not Now</Text>
          </Pressable>
        </View>
      ) : status ? (
        <Text style={[styles.invocationStatus, { color: invocation.status === 'failed' ? palette.danger : palette.textFaint }]}>{status}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  round: { gap: 10, paddingTop: 8 },
  followUp: { gap: 4, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, marginTop: 8 },
  followUpHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followUpTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 12 },
  followUpText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  progress: { fontFamily: fonts.medium, fontSize: 12 },
  seat: { gap: 6 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  waitingName: { fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1 },
  waitingText: { fontFamily: fonts.regular, fontSize: 13 },
  seatActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seatButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  seatButtonText: { fontFamily: fonts.medium, fontSize: 12 },
  stopped: { fontFamily: fonts.regular, fontSize: 13, fontStyle: 'italic' },
  summarise: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  summariseText: { fontFamily: fonts.medium, fontSize: 14 },
  invocation: { gap: 6, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  invocationTitle: { fontFamily: fonts.medium, fontSize: 12 },
  invocationQuestion: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  invocationButtons: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  approve: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full },
  approveText: { fontFamily: fonts.semibold, fontSize: 14 },
  reject: { fontFamily: fonts.medium, fontSize: 14 },
  invocationStatus: { fontFamily: fonts.regular, fontSize: 13 },
});
