import js from '@eslint/js';
import globals from 'globals';
import playwright from 'eslint-plugin-playwright';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'reports/', '.cache/', 'specs/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/expect-expect': [
        'error',
        { assertFunctionNames: ['expect'], assertFunctionPatterns: ['^expect\\.'] },
      ],
      'playwright/no-conditional-in-test': 'off', // data-driven tests branch on spec data
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
      'playwright/valid-title': ['error', { ignoreTypeOfDescribeName: true }],
    },
  },
  prettier,
];
