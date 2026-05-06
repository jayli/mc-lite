// src/tests/runner.js
/**
 * 测试运行器和报告器
 * 提供测试套件的注册、执行和结果报告功能
 */

/**
 * 测试运行器和报告器
 * 提供测试套件的注册、执行和结果报告功能
 */

import { AssertionError } from './assert.js';

// 全局测试状态
const testResults = {
  passed: 0,
  failed: 0,
  suites: []
};

// 当前测试套件
let currentSuite = null;

/**
 * 测试套件类
 */
class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  addTest(name, fn) {
    this.tests.push({ name, fn });
  }
}

/**
 * 定义一个测试套件
 * @param {string} name - 套件名称
 * @param {Function} fn - 套件函数，接收 test 参数
 */
export function describe(name, fn) {
  const suite = new TestSuite(name);
  currentSuite = suite;

  // 提供 test 函数给套件函数使用
  const test = (testName, testFn) => {
    suite.addTest(testName, testFn);
  };

  fn(test);
  testResults.suites.push(suite);
  currentSuite = null;
}

/**
 * 定义一个测试用例
 * @param {string} name - 测试名称
 * @param {Function} fn - 测试函数
 */
export function test(name, fn) {
  if (currentSuite) {
    currentSuite.addTest(name, fn);
  } else {
    // 如果没有套件，创建一个默认套件
    const suite = new TestSuite('Default Suite');
    suite.addTest(name, fn);
    testResults.suites.push(suite);
  }
}

/**
 * 运行单个测试
 * @param {Object} testObj - 测试对象 {name, fn}
 * @returns {Promise<Object>} 测试结果
 */
async function runSingleTest(testObj) {
  const startTime = performance.now();

  try {
    await testObj.fn();
    const endTime = performance.now();

    return {
      name: testObj.name,
      status: 'passed',
      duration: endTime - startTime,
      error: null
    };
  } catch (error) {
    const endTime = performance.now();

    return {
      name: testObj.name,
      status: 'failed',
      duration: endTime - startTime,
      error: error instanceof AssertionError ? error.message : error.toString()
    };
  }
}

/**
 * 运行测试套件
 * @param {TestSuite} suite - 测试套件
 * @param {Function} onTestComplete - 每个测试完成后的回调
 * @returns {Promise<Object>} 套件执行结果
 */
async function runSuite(suite, onTestComplete) {
  const results = {
    name: suite.name,
    tests: [],
    passed: 0,
    failed: 0,
    duration: 0
  };

  const suiteStartTime = performance.now();

  for (const testObj of suite.tests) {
    const result = await runSingleTest(testObj);
    results.tests.push(result);

    if (result.status === 'passed') {
      results.passed++;
    } else {
      results.failed++;
    }

    // 通知单个测试完成
    if (onTestComplete) {
      onTestComplete();
    }
  }

  results.duration = performance.now() - suiteStartTime;
  suite.passed = results.passed;
  suite.failed = results.failed;
  suite.results = results.tests;

  return results;
}

// 进度回调函数
let progressCallback = null;

/**
 * 设置进度回调
 * @param {Function} callback - 进度回调函数，接收 (current, total, currentTestName) 参数
 */
export function setProgressCallback(callback) {
  progressCallback = callback;
}

/**
 * 运行所有注册的测试
 * @returns {Promise<Object>} 总体测试结果
 */
export async function runAllTests() {
  // 重置结果
  testResults.passed = 0;
  testResults.failed = 0;

  const allResults = [];
  const totalStartTime = performance.now();

  // 计算总测试数
  let totalTests = 0;
  for (const suite of testResults.suites) {
    totalTests += suite.tests.length;
  }

  let currentTestIndex = 0;

  for (const suite of testResults.suites) {
    const suiteResults = await runSuite(suite, () => {
      currentTestIndex++;
      // 通知进度更新
      if (progressCallback) {
        progressCallback(currentTestIndex, totalTests, suite.name);
      }
    });
    allResults.push(suiteResults);
    testResults.passed += suiteResults.passed;
    testResults.failed += suiteResults.failed;
  }

  // 确保最终进度显示为 100%（避免快速测试导致视觉上的进度丢失）
  if (progressCallback) {
    progressCallback(totalTests, totalTests, testResults.suites[testResults.suites.length - 1]?.name || '完成');
  }

  const totalDuration = performance.now() - totalStartTime;

  return {
    suites: allResults,
    passed: testResults.passed,
    failed: testResults.failed,
    total: testResults.passed + testResults.failed,
    duration: totalDuration,
    passRate: testResults.passed + testResults.failed > 0
      ? ((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(2)
      : 0
  };
}

/**
 * 生成 HTML 格式的报告
 * @param {Object} results - 测试结果
 * @returns {string} HTML 字符串
 */
export function generateHTMLReport(results) {
  const statusColor = results.failed === 0 ? '#22c55e' : '#ef4444';
  const statusText = results.failed === 0 ? '全部通过' : `${results.failed} 个失败`;

  let html = `
    <div class="report-header">
      <h2>测试结果</h2>
      <div class="summary" style="background-color: ${statusColor}">
        <span>通过：${results.passed}/${results.total} (${results.passRate}%)</span>
        <span>耗时：${results.duration.toFixed(2)}ms</span>
        <span>${statusText}</span>
      </div>
    </div>
  `;

  for (const suite of results.suites) {
    html += `
      <div class="test-suite">
        <h3 class="suite-header">
          <span class="suite-name">${suite.name}</span>
          <span class="suite-stats">通过：${suite.passed} | 失败：${suite.failed} | 耗时：${suite.duration.toFixed(2)}ms</span>
        </h3>
        <ul class="test-list">
    `;

    for (const test of suite.tests) {
      const statusClass = test.status === 'passed' ? 'test-passed' : 'test-failed';
      const statusIcon = test.status === 'passed' ? '✓' : '✗';

      html += `
        <li class="test-item ${statusClass}">
          <span class="status-icon">${statusIcon}</span>
          <span class="test-name">${test.name}</span>
          <span class="test-duration">${test.duration.toFixed(2)}ms</span>
      `;

      if (test.error) {
        html += `<div class="test-error">${escapeHtml(test.error)}</div>`;
      }

      html += `</li>`;
    }

    html += `
        </ul>
      </div>
    `;
  }

  return html;
}

/**
 * 生成文本格式的报告
 * @param {Object} results - 测试结果
 * @returns {string} 文本报告
 */
export function generateTextReport(results) {
  let report = '\n=== 测试结果汇总 ===\n';
  report += `通过：${results.passed}/${results.total} (${results.passRate}%)\n`;
  report += `总耗时：${results.duration.toFixed(2)}ms\n\n`;

  for (const suite of results.suites) {
    report += `=== ${suite.name} ===\n`;

    for (const testResult of suite.tests) {
      const status = testResult.status === 'passed' ? '[PASS]' : '[FAIL]';
      report += `${status} ${testResult.name} (${testResult.duration.toFixed(2)}ms)\n`;

      if (testResult.error) {
        report += `  Error: ${testResult.error}\n`;
      }
    }

    report += `\n`;
  }

  return report;
}

/**
 * HTML 转义
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 将结果显示在页面上
 * @param {Object} results - 测试结果
 * @param {string} containerId - 容器元素 ID
 */
export function displayResults(results, containerId = 'test-results') {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = generateHTMLReport(results);
  }

  // 同时在控制台输出文本报告
  console.log(generateTextReport(results));
}

// 重置测试状态（用于多次运行）
export function resetTestResults() {
  testResults.passed = 0;
  testResults.failed = 0;
  // 重置每个套件的结果，但不删除套件本身
  for (const suite of testResults.suites) {
    suite.passed = 0;
    suite.failed = 0;
    suite.results = [];
  }
}

// 获取已注册的测试套件数量（用于调试）
export function getSuiteCount() {
  return testResults.suites.length;
}
