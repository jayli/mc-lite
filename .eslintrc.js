module.exports = {
  env: {
    browser: true,
    es2021: true,
    worker: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  globals: {
    // 浏览器全局变量
    PerformanceObserver: 'readonly',
    // Three.js 相关（如果在全局使用）
    THREE: 'readonly',
    // 游戏全局实例
    game: 'writable'
  },
  rules: {
    // 未使用的变量，允许以下划线开头
    'no-unused-vars': ['warn', {
      varsIgnorePattern: '^_',
      argsIgnorePattern: '^_'
    }],
    // 使用 let/const 而非 var
    'no-var': 'warn',
    // 驼峰命名
    camelcase: 'warn',
    // 尾随空格
    'no-trailing-spaces': 'warn',
    // 空块语句
    'no-empty': ['warn', { allowEmptyCatch: true }]
  },
  ignorePatterns: [
    'node_modules/**',
    'src/tests/**'
  ]
};
