#!/usr/bin/env node
/**
 * 使用 Playwright 在 headless 浏览器中运行 MC Lite 测试套件。
 *
 * 用法:
 *   node command/run-tests.js                    # 运行所有测试
 *   node command/run-tests.js --port 3000         # 指定端口 (默认 8080)
 *   node command/run-tests.js --verbose           # 输出详细结果
 *
 * 退出码:
 *   0 - 所有测试通过
 *   1 - 存在失败或运行异常
 */

const { chromium } = require('playwright');

// ── 参数解析 ──────────────────────────────────────────
const args = process.argv.slice(2);
const PORT = args.includes('--port') ? args[args.indexOf('--port') + 1] : '8080';
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const TEST_URL = `http://127.0.0.1:${PORT}/src/tests/index.html`;
const PAGE_LOAD_TIMEOUT = 15000;
const TEST_RUN_TIMEOUT = 120000; // 2 分钟（测试可能较多）

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. 加载测试页面
    console.log(`→ 正在加载 ${TEST_URL}`);
    await page.goto(TEST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // 2. 等待按钮可用（页面脚本会延迟 1 秒启用按钮）
    console.log('→ 等待测试运行器就绪...');
    await page.waitForSelector('#run-all-btn:not([disabled])', {
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // 3. 点击 "运行所有测试"
    console.log('→ 开始运行测试...');
    await page.click('#run-all-btn');

    // 4. 等待测试完成
    //    策略 A: 等待状态栏从 display:none 变为可见
    //    策略 B: 等待测试结果区域出现 .test-passed 或 .test-failed
    //    策略 C: 轮询等待测试数量稳定（兜底）
    console.log('→ 等待测试完成...');

    const completed = await Promise.race([
      // 等待状态栏变为可见（display: flex）
      page.waitForFunction(
        () => {
          const bar = document.getElementById('status-bar');
          return bar && bar.style.display !== 'none';
        },
        { timeout: TEST_RUN_TIMEOUT },
      ).then(() => true).catch(() => false),

      // 等待测试结果中出现测试结果
      page.waitForSelector('.test-passed, .test-failed', {
        timeout: TEST_RUN_TIMEOUT,
      }).then(() => true).catch(() => false),
    ]);

    if (!completed) {
      console.error('× 等待测试完成超时');
      await browser.close();
      process.exit(1);
    }

    // 兜底：再等一下确保结果稳定（防止最后一个测试还在跑）
    await page.waitForTimeout(2000);

    // 确认测试真的完成了（状态栏可见）
    const statusBarReady = await page.evaluate(() => {
      const bar = document.getElementById('status-bar');
      return bar && bar.style.display !== 'none';
    });

    // 如果状态栏还没出现，再等一会
    if (!statusBarReady) {
      await page.waitForFunction(
        () => {
          const bar = document.getElementById('status-bar');
          return bar && bar.style.display !== 'none';
        },
        { timeout: 10000 },
      ).catch(() => {});
    }

    // 5. 收集结果
    const passedCount = await page.locator('.test-passed').count();
    const failedCount = await page.locator('.test-failed').count();
    const total = passedCount + failedCount;

    const failedTests = await page.locator('.test-failed').evaluateAll((nodes) =>
      nodes.map((n) => ({
        name: n.querySelector('.test-name')?.textContent?.trim() || 'unknown',
        error: n.querySelector('.test-error')?.textContent?.trim() || '',
      }))
    );

    const statusBar = await page.$('#status-bar');
    let duration = '';
    if (statusBar) {
      duration = await statusBar
        .evaluate((el) => {
          const dur = el.querySelector('#duration');
          return dur ? dur.textContent : '';
        })
        .catch(() => '');
    }
    const passRate =
      total > 0 ? ((passedCount / total) * 100).toFixed(1) : 'N/A';

    // 6. 输出报告
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`  测试结果: ${passedCount}/${total} 通过 (${passRate}%) ${duration ? '| ' + duration : ''}`);
    console.log('═══════════════════════════════════════');

    if (failedTests.length > 0 && VERBOSE) {
      console.log('');
      console.log('── 失败详情 ──');
      failedTests.forEach((t, i) => {
        console.log(`\n  ${i + 1}. ${t.name}`);
        if (t.error) {
          console.log(`     ${t.error}`);
        }
      });
      console.log('');
    }

    // 简短输出（非 verbose 模式）
    if (!VERBOSE && failedTests.length > 0) {
      console.log('');
      console.log('── 失败用例 ──');
      failedTests.forEach((t) => console.log(`  ✗ ${t.name}`));
      console.log('');
      console.log('  使用 --verbose 查看详细错误信息');
    }

    // 7. 退出码
    await browser.close();
    process.exit(failedTests.length > 0 ? 1 : 0);
  } catch (err) {
    console.error('');
    console.error('× 测试运行异常:');
    console.error(`  ${err.message}`);
    await browser.close();
    process.exit(1);
  }
})();
