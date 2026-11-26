import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser, sourceType: 'module' } },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/no-v-html': 'error',
      'no-restricted-globals': ['error', { name: 'fetch', message: '应用代码不得发起网络请求（隐私约束）。' }],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: '禁止 sendBeacon（隐私约束）。' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='XMLHttpRequest']", message: '禁止 XHR（隐私约束）。' },
        { selector: "NewExpression[callee.name='WebSocket']", message: '禁止 WebSocket（隐私约束）。' },
        { selector: "NewExpression[callee.name='FormData']", message: '禁止 FormData（隐私约束）。' },
      ],
    },
  },
  {
    files: ['scripts/**', 'tests/**', 'e2e/**', '*.config.*'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-syntax': 'off' },
  },
]
