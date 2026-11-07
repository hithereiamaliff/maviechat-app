import type { MathSvg } from '@maviechat/owui-markdown/src/math';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { SideScroll } from '@/components/SideScroll';
import { fonts, radius, usePalette } from '@/theme';

type Convert = (tex: string, display: boolean) => MathSvg | null;
let convert: Convert | null = null;

/**
 * TeX as SVG. MathJax is large, so it loads with the first formula rather than at launch; if it
 * can't run, the TeX shows as written.
 */
function mathSvg(tex: string, display: boolean): MathSvg | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    convert ??= (require('@maviechat/owui-markdown/src/math') as { texToSvg: Convert }).texToSvg;
    return convert(tex, display);
  } catch {
    return null;
  }
}

/** MathJax lays out in ex, half the font size: 8 px for the 16 px body text. */
const exFor = (fontSize: number) => fontSize / 2;

/** Display maths, centred; wide formulas scroll sideways instead of shrinking. */
export const BlockMath = memo(function BlockMath({ tex, color }: { tex: string; color: string }) {
  const palette = usePalette();
  const math = mathSvg(tex, true);
  if (!math) {
    return (
      <View style={[styles.fallback, { backgroundColor: palette.surface }]}>
        <Text selectable style={[styles.fallbackText, { color }]}>
          {tex}
        </Text>
      </View>
    );
  }
  const ex = exFor(16);
  return (
    <SideScroll showsHorizontalScrollIndicator={false} style={styles.block} contentContainerStyle={styles.blockContent}>
      <SvgXml xml={math.svg} width={math.width * ex} height={math.height * ex} color={color} accessibilityLabel={tex} />
    </SideScroll>
  );
});

/**
 * Inline maths, drawn inside the sentence (an inline view sits on the text baseline, so it's
 * lowered by the formula's depth below it).
 */
export const InlineMath = memo(function InlineMath({ tex, color, display = false, fontSize = 16 }: { tex: string; color: string; display?: boolean; fontSize?: number }) {
  const math = mathSvg(tex, display);
  if (!math) return <Text style={styles.inlineFallback}>{tex}</Text>;
  const ex = exFor(fontSize);
  const width = math.width * ex;
  const height = math.height * ex;
  return (
    <View style={{ width, height, transform: [{ translateY: -math.verticalAlign * ex }] }} accessibilityLabel={tex}>
      <SvgXml xml={math.svg} width={width} height={height} color={color} />
    </View>
  );
});

const styles = StyleSheet.create({
  block: { marginVertical: 8 },
  blockContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 2 },
  fallback: { borderRadius: radius.md, padding: 12, marginVertical: 8 },
  fallbackText: { fontFamily: fonts.mono, fontSize: 14, textAlign: 'center' },
  inlineFallback: { fontFamily: fonts.mono, fontSize: 14 },
});
