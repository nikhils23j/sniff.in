// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Forms hydrate once from fetched server data inside an effect (guarded, single setState).
      // Kept visible as a warning rather than an error; see CLAUDE.md conventions.
      'react-hooks/set-state-in-effect': 'warn',
      // False positives on TS enums re-exported by expo modules; TypeScript already validates these.
      'import/namespace': 'off',
    },
  },
  {
    ignores: ['dist/*', 'supabase/functions/**', 'supabase/tests/**', 'scripts/**', 'ios/**', 'android/**'],
  },
]);
