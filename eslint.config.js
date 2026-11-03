import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'config/ic/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/hmi/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
