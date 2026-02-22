// src/tests/assert.js
/**
 * 基础断言工具函数
 * 轻量级断言库，用于游戏核心系统测试
 */

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * 断言两个值相等 (使用===)
 * @param {*} actual - 实际值
 * @param {*} expected - 期望值
 * @param {string} message - 错误消息
 */
export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected ${expected}, got ${actual}`);
  }
}

/**
 * 断言两个值不相等
 * @param {*} actual - 实际值
 * @param {*} expected - 期望值
 * @param {string} message - 错误消息
 */
export function assertNotEqual(actual, expected, message = '') {
  if (actual === expected) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected not equal to ${expected}`);
  }
}

/**
 * 断言值为 true
 * @param {*} value - 待验证的值
 * @param {string} message - 错误消息
 */
export function assertTrue(value, message = '') {
  if (value !== true) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected true, got ${value}`);
  }
}

/**
 * 断言值为 false
 * @param {*} value - 待验证的值
 * @param {string} message - 错误消息
 */
export function assertFalse(value, message = '') {
  if (value !== false) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected false, got ${value}`);
  }
}

/**
 * 断言值为 null
 * @param {*} value - 待验证的值
 * @param {string} message - 错误消息
 */
export function assertNull(value, message = '') {
  if (value !== null) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected null, got ${value}`);
  }
}

/**
 * 断言值为 undefined
 * @param {*} value - 待验证的值
 * @param {string} message - 错误消息
 */
export function assertUndefined(value, message = '') {
  if (value !== undefined) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected undefined, got ${value}`);
  }
}

/**
 * 断言函数抛出错误
 * @param {Function} fn - 待测试的函数
 * @param {string|Error} expected - 期望的错误消息或错误类型
 * @param {string} message - 错误消息
 */
export function assertThrows(fn, expected, message = '') {
  if (typeof fn !== 'function') {
    throw new AssertionError('assertThrows: first argument must be a function');
  }

  let threw = false;
  let error = null;

  try {
    fn();
  } catch (e) {
    threw = true;
    error = e;
  }

  if (!threw) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected function to throw an error`);
  }

  // 如果提供了期望的错误消息或类型，进行额外验证
  if (expected !== undefined) {
    if (typeof expected === 'string') {
      if (!error.message.includes(expected)) {
        throw new AssertionError(`Error message "${error.message}" does not include "${expected}"`);
      }
    } else if (expected instanceof Function) {
      if (!(error instanceof expected)) {
        throw new AssertionError(`Error is not an instance of ${expected.name}`);
      }
    }
  }

  return error;
}

/**
 * 断言值不为 null 或 undefined
 * @param {*} value - 待验证的值
 * @param {string} message - 错误消息
 */
export function assertNotNull(value, message = '') {
  if (value === null || value === undefined) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected value to not be null or undefined`);
  }
}

/**
 * 断言两个对象深度相等 (简单版本)
 * @param {Object} actual - 实际对象
 * @param {Object} expected - 期望对象
 * @param {string} message - 错误消息
 */
export function assertDeepEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);

  if (actualStr !== expectedStr) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected ${expectedStr}, got ${actualStr}`);
  }
}

/**
 * 断言数组包含指定元素
 * @param {Array} array - 待测试的数组
 * @param {*} element - 期望包含的元素
 * @param {string} message - 错误消息
 */
export function assertIncludes(array, element, message = '') {
  if (!Array.isArray(array)) {
    throw new AssertionError('assertIncludes: first argument must be an array');
  }

  if (!array.includes(element)) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected array to include ${element}`);
  }
}

/**
 * 断言字符串包含指定子串
 * @param {string} string - 待测试的字符串
 * @param {string} substring - 期望包含的子串
 * @param {string} message - 错误消息
 */
export function assertStringIncludes(string, substring, message = '') {
  if (typeof string !== 'string') {
    throw new AssertionError('assertStringIncludes: first argument must be a string');
  }

  if (!string.includes(substring)) {
    const msg = message ? `${message}: ` : '';
    throw new AssertionError(`${msg}Expected "${string}" to include "${substring}"`);
  }
}
