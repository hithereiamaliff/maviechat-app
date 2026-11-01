import { useColorScheme } from 'react-native';
import { useThemePreference } from './preference';
import { dark, light, oled, syntaxDark, syntaxLight, type Palette, type SyntaxColors } from './tokens';

export * from './tokens';

export function usePalette(): Palette {
  const scheme = useColorScheme();
  const preference = useThemePreference();
  if (scheme !== 'dark') return light;
  return preference === 'oled' ? oled : dark;
}

export function useSyntaxColors(): SyntaxColors {
  return useColorScheme() === 'dark' ? syntaxDark : syntaxLight;
}
