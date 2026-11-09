import { diffText, type DiffHunk, type DiffLine, type TextDiff } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';

/** What a version holds that a comparison shows. */
export interface VersionSide {
  content: string;
  name: string;
  tags: string[];
}

/** Rows drawn before Show All: enough for most prompts. */
const FIRST_ROWS = 300;

const linesLabel = (start: number, count: number) => (count <= 1 ? `Line ${start}` : `Lines ${start}–${start + count - 1}`);
const hunkLabel = (hunk: DiffHunk) => (hunk.afterCount > 0 ? linesLabel(hunk.afterStart, hunk.afterCount) : `${linesLabel(hunk.beforeStart, hunk.beforeCount)} of the earlier one`);
const tagsText = (tags: string[]) => (tags.length ? tags.join(', ') : 'none');

/**
 * What changed from one version to another, line by line: lines taken out (−) and put in (+),
 * with three unchanged lines around each change, and the name and tags where they changed too
 * (0.12's comparison of versions). Worked out on the phone, so a 0.11 server, whose own
 * comparison can't be reached, gets it as well.
 */
export function VersionChanges({ before, after, caption }: { before: VersionSide; after: VersionSide; caption: string }) {
  const changes = [
    ...(before.name !== after.name ? [`Name: “${before.name}” → “${after.name}”`] : []),
    ...(before.tags.join('\n') !== after.tags.join('\n') ? [`Tags: ${tagsText(before.tags)} → ${tagsText(after.tags)}`] : []),
  ];
  return <DiffView diff={diffText(before.content, after.content)} caption={caption} changes={changes} />;
}

/**
 * A comparison drawn: a caption, a line for each other change (a name, say), how many lines were
 * taken out and put in, then each stretch of changes (the first 300 lines, then Show All).
 */
export function DiffView({ diff, caption, changes = [] }: { diff: TextDiff; caption: string; changes?: string[] }) {
  const palette = usePalette();
  const [all, setAll] = useState(false);
  const rows = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  // Whole hunks, in order, while they fit in the first rows (always at least one).
  const shown: DiffHunk[] = [];
  let budget = all ? Infinity : FIRST_ROWS;
  for (const hunk of diff.hunks) {
    if (shown.length > 0 && hunk.lines.length > budget) break;
    shown.push(hunk);
    budget -= hunk.lines.length;
  }
  const shownRows = shown.reduce((sum, hunk) => sum + hunk.lines.length, 0);

  return (
    <View style={styles.box}>
      <Text style={[styles.caption, { color: palette.textMuted }]}>{caption}</Text>
      {changes.map((change) => (
        <Text key={change} style={[styles.meta, { color: palette.text }]}>
          {change}
        </Text>
      ))}
      <Text style={[styles.summary, { color: palette.text }]}>
        {diff.hunks.length ? `${diff.removed} ${diff.removed === 1 ? 'line' : 'lines'} taken out, ${diff.added} put in` : diff.lineEndingsOnly ? 'Only the line breaks differ.' : 'The text is the same.'}
      </Text>
      {shown.map((hunk, index) => (
        <View key={index} style={[styles.hunk, { borderColor: palette.border }]}>
          <Text style={[styles.hunkLabel, { color: palette.textFaint, backgroundColor: palette.surface }]}>{hunkLabel(hunk)}</Text>
          {hunk.lines.map((line, at) => (
            <Row key={at} line={line} />
          ))}
        </View>
      ))}
      {shownRows < rows ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={6} style={styles.more}>
          <Text style={[styles.moreText, { color: palette.link }]}>{`Show All ${rows} Lines`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({ line }: { line: DiffLine }) {
  const palette = usePalette();
  const color = line.kind === 'added' ? palette.success : line.kind === 'removed' ? palette.danger : palette.textFaint;
  const what = line.kind === 'added' ? 'Put in' : line.kind === 'removed' ? 'Taken out' : 'Unchanged';
  return (
    <View accessible accessibilityLabel={`${what}: ${line.text || 'an empty line'}`} style={[styles.line, line.kind !== 'same' && { backgroundColor: `${color}22` }]}>
      <Text style={[styles.number, { color: palette.textFaint }]}>{line.after ?? line.before ?? ''}</Text>
      <Text style={[styles.sign, { color }]}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</Text>
      <Text style={[styles.text, { color: palette.text }]}>{line.text || ' '}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  summary: { fontFamily: fonts.medium, fontSize: 13 },
  hunk: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  hunkLabel: { fontFamily: fonts.medium, fontSize: 11, paddingHorizontal: 10, paddingVertical: 3 },
  line: { flexDirection: 'row', paddingRight: 8 },
  number: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, width: 32, textAlign: 'right' },
  sign: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, width: 16, textAlign: 'center' },
  text: { flex: 1, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
  more: { alignSelf: 'flex-start', paddingVertical: 4 },
  moreText: { fontFamily: fonts.medium, fontSize: 13 },
});
