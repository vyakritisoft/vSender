export default [
  {
    files: ['extension/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        globalThis: 'readonly',
        FileReader: 'readonly',
        Uint8Array: 'readonly',
        console: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        MutationObserver: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        InputEvent: 'readonly',
        indexedDB: 'readonly',
        ResizeObserver: 'readonly',
        location: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        requestAnimationFrame: 'readonly'
      }
    },
    rules: {
      // Errors
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',

      // Best practices
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',

      // Style
      'semi': ['warn', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'indent': ['warn', 2, { SwitchCase: 1 }]
    }
  }
];
