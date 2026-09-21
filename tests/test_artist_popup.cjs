const { chromium } = require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../web');
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.WebSocket = class { close() {} };
      window.popupCalls = [];
      window.open = (...args) => { window.popupCalls.push(args); return null; };
    });
    await page.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/scene.js')) return route.fulfill({contentType:'text/javascript',body:''});
      if (p.startsWith('/api/launcher/assets/')) {
        const file = path.join(root, p.replace('/api/launcher/',''));
        return fs.existsSync(file) ? route.fulfill({path:file}) : route.fulfill({status:404});
      }
      if (p === '/launcher') return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
      if (p.startsWith('/api/models/')) return route.fulfill({json:[]});
      return route.fulfill({json:{}});
    });
    await page.goto('http://127.0.0.1:19877/launcher');
    assert.equal(await page.locator('#sceneView, [data-nav="scene"]').count(), 0);
    assert.equal(await page.locator('script[src*="/scene.js"], link[href*="/scene.css"]').count(), 0);
    for (const view of ['ai', 'gallery', 'presets', 'studio']) {
      await page.locator(`[data-nav="${view}"]`).click();
      assert.equal(await page.locator(`.view.active[data-view="${view}"]`).count(), 1);
    }
    await page.evaluate(() => { location.hash = 'scene'; });
    await page.waitForFunction(() => location.hash === '');
    assert.equal(await page.locator('.view.active[data-view="studio"]').count(), 1);
    assert.equal(await page.locator('#artistFrame').getAttribute('src'), null);
    await page.locator('[data-open-artists]').first().click();
    assert.equal(await page.locator('#artistDialog').isVisible(), true);
    assert.equal(await page.locator('#artistFrame').getAttribute('src'), 'https://animadex.net/?mode=artists');
    assert.equal(await page.locator('#artistExpand').count(), 0);
    assert.equal(await page.locator('#artistDialog header button').count(), 1);
    await page.locator('#artistClose').click();
    await page.waitForFunction(() => !document.querySelector('#artistFrame').hasAttribute('src'));
    assert.equal(await page.locator('#artistFrame').getAttribute('src'), null);
    await page.locator('#openPrompt').click();
    const before = await page.locator('#prompt').inputValue();
    await page.locator('#promptSheet [data-open-artists]').click();
    const calls = await page.evaluate(() => window.popupCalls);
    assert.equal(calls.length, 0);
    assert.equal(await page.locator('#artistDialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#artistDialog').isVisible(), false);
    assert.equal(await page.locator('#prompt').inputValue(), before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: embedded modal, expand/close/Escape, lazy iframe, no external window, prompt unchanged, mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
