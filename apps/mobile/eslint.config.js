// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // iOS-only pieces of React Native, each with a version that works on Android too.
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Modal', 'ActionSheetIOS'],
              message: 'Use Modal from @/components/Modal and showActionSheet from @/components/dialogs, which also work on Android.',
            },
          ],
        },
      ],
      'no-restricted-properties': ['error', { object: 'Alert', property: 'prompt', message: 'Use showPrompt from @/components/dialogs: Alert.prompt does nothing on Android.' }],
    },
  },
]);
