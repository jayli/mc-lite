// ESLint 配置文件
// 项目: Minecraft-lite (基于 Three.js 的 3D 体素游戏)

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    // 全局忽略
    ignores: [
      'node_modules/**',
      'src/assets/**',
      'src/tests/**',
    ],
  },
  {
    // 主配置
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // 浏览器全局变量
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        Worker: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        URL: 'readonly',
        performance: 'readonly',
        // Three.js 全局 (如果通过 script 标签引入时使用)
        THREE: 'readonly',
        // 测试全局
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      // ====================
      // 命名规范 (Naming)
      // ====================
      // 强制使用 camelCase (发现项目中存在 snake_case 问题)
      'camelcase': ['warn', {
        properties: 'always',
        ignoreDestructuring: false,
        ignoreImports: false,
        ignoreGlobals: false,
      }],

      // ====================
      // 变量使用 (Variables)
      // ====================
      // 禁止未使用的变量 (发现项目中存在此问题)
      'no-unused-vars': ['warn', {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
      }],

      // ====================
      // 最佳实践 (Best Practices)
      // ====================
      // 禁止 console.log (生产代码中应移除)
      'no-console': ['off'], // 暂不开启，因为项目大量使用 console

      // 禁止 debugger
      'no-debugger': 'error',

      // 禁止重复 case 标签
      'no-duplicate-case': 'error',

      // 禁止空块语句
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // 禁止不必要的分号
      'no-extra-semi': 'warn',

      // 禁止不必要的括号
      'no-extra-parens': ['off'], // 有时括号用于提高可读性

      // 禁止重新赋值函数参数
      'no-param-reassign': ['warn', { props: false }],

      // 禁止不规则的空白
      'no-irregular-whitespace': 'error',

      // ====================
      // 代码风格 (Stylistic)
      // ====================
      // 一致的缩进 (2个空格)
      'indent': ['off'], // 不强制，由编辑器或 Prettier 处理

      // 一致的引号 (单引号)
      'quotes': ['off'], // 不强制

      // 分号
      'semi': ['off'], // 不强制

      // 逗号结尾
      'comma-dangle': ['off'],

      // 行尾空格
      'no-trailing-spaces': 'warn',

      // 文件末尾空行
      'eol-last': 'off',

      // ====================
      // ES6+ 特性
      // ====================
      // 优先使用 const/let
      'no-var': 'warn',

      // 优先使用解构
      'prefer-destructuring': 'off',

      // 优先使用模板字符串
      'prefer-template': 'off',

      // 优先使用箭头函数
      'prefer-arrow-callback': 'off',

      // 禁止重复导入
      'no-duplicate-imports': 'error',

      // ====================
      // 潜在问题 (Possible Errors)
      // ====================
      // 禁止不可达代码
      'no-unreachable': 'error',

      // 禁止无效的正则表达式
      'no-invalid-regexp': 'error',

      // 禁止在 return 语句中使用赋值
      'no-return-assign': ['warn', 'always'],

      // 禁止自我比较
      'no-self-compare': 'error',

      // 禁止未定义的变量
      'no-undef': 'error',

      // 禁止在条件中使用赋值
      'no-cond-assign': ['warn', 'always'],

      // 禁止修改 const 变量
      'no-const-assign': 'error',

      // ====================
      // 其他
      // ====================
      // 允许下划线作为标识符前缀 (用于私有方法)
      'no-underscore-dangle': 'off',
    },
  },
  {
    // 对 Worker 文件的额外配置
    files: ['src/workers/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        postMessage: 'readonly',
        onmessage: 'writable',
        importScripts: 'readonly',
      },
    },
  },
];
