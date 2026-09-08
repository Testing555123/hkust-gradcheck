import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tailwind from 'eslint-plugin-tailwindcss'
import tseslint from 'typescript-eslint'

// tailwind-api-utils 在 Windows 下无法从相对路径解析 tailwindcss，必须给绝对路径
const configDir = path.dirname(fileURLToPath(import.meta.url))

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { tailwindcss: tailwind },
    settings: { tailwindcss: { config: path.resolve(configDir, 'tailwind.config.js') } },
    rules: {
      // PR1 阶段性设为 warn：PR2 完成魔法值清理后升级为 error
      'tailwindcss/no-arbitrary-value': 'warn',
      'tailwindcss/no-contradicting-classname': 'warn',
      'tailwindcss/classnames-order': 'warn',
    },
  },
)
