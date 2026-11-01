import { useColorScheme } from 'react-native';
import { dark, light, syntaxDark, syntaxLight, type Palette, type SyntaxColors } from './tokens';

export * from './tokens';

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useSyntaxColors(): SyntaxColors {
  return useColorScheme() === 'dark' ? syntaxDark : syntaxLight;
}
