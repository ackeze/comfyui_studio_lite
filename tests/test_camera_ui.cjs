const { chromium } = require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../web');
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('comfy_studio_tutorial_seen_v1','true'); window.WebSocket=class {constructor(){setTimeout(()=>this.onopen?.(),10);} close(){}}; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), p=url.pathname;
      if(p.endsWith('/scene.js')) return route.fulfill({contentType:'text/javascript',body:''});
      if(p.startsWith('/api/launcher/assets/')) {
        const file=path.join(root,p.replace('/api/launcher/',''));
        return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404});
      }
      if(p==='/launcher') return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
      if(p.startsWith('/api/models/')) return route.fulfill({json:['test.safetensors']});
      if(p.endsWith('/CLIPLoader')) return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['anima']]}}}}});
      if(p.endsWith('/KSampler')) return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
      return route.fulfill({json:{}});
    });
    await page.goto('http://127.0.0.1:19877/launcher#studio');
    const panel=page.locator('#cameraControlPanel');
    await panel.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.camera-viewport').isVisible(),false);
    await page.locator('[data-camera-field="enabled"]').check();
    assert.equal(await page.locator('.camera-advanced').getAttribute('open'),null);
    await page.locator('[data-camera-expand]').click();
    const preview=()=>page.locator('[data-camera-preview]').textContent();
    const before=await preview();
    const box=await page.locator('.camera-viewport').boundingBox();
    for(const button of ['right','middle']) {
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.down({button}); await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+30,{steps:5}); await page.mouse.up({button});
      assert.equal(await preview(),before);
    }
    await page.mouse.wheel(0,100); assert.equal(await preview(),before);
    await page.locator('[data-camera-reset-view]').click();
    const projectShot = (azimuth, elevation=0, distance=4) => {
      const a=38*Math.PI/180, e=28*Math.PI/180;
      const back=[Math.cos(e)*Math.sin(a), Math.sin(e), Math.cos(e)*Math.cos(a)];
      const rh=Math.hypot(back[2], back[0]), right=[back[2]/rh, 0, -back[0]/rh];
      const up=[back[1]*right[2]-back[2]*right[1], back[2]*right[0]-back[0]*right[2], back[0]*right[1]-back[1]*right[0]];
      const az=azimuth*Math.PI/180, el=elevation*Math.PI/180;
      const pos=[distance*Math.cos(el)*Math.sin(az), distance*Math.sin(el), distance*Math.cos(el)*Math.cos(az)];
      const offset=[pos[0]-back[0]*13, pos[1]-back[1]*13, pos[2]-back[2]*13];
      const depth=-(offset[0]*back[0]+offset[1]*back[1]+offset[2]*back[2]);
      const f=Math.min(box.width,box.height)*1.35;
      return {
        x: box.x+box.width/2+(offset[0]*right[0]+offset[1]*right[1]+offset[2]*right[2])*f/depth,
        y: box.y+box.height/2-(offset[0]*up[0]+offset[1]*up[1]+offset[2]*up[2])*f/depth
      };
    };
    const front=projectShot(0);
    await page.mouse.move(front.x,front.y); await page.mouse.down(); await page.mouse.move(front.x+140,front.y-130,{steps:8}); await page.mouse.up();
    assert.notEqual(await page.locator('[data-camera-field="azimuth"]').inputValue(),'0');
    await page.evaluate(() => {
      document.querySelector('[data-camera-reset]').click();
      document.querySelector('[data-camera-reset-view]').click();
      const az=document.querySelector('[data-camera-field="azimuth"]');
      az.value='180'; az.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.equal(await page.locator('[data-camera-field="azimuth"]').inputValue(),'180');
    const back=projectShot(180);
    await page.mouse.move(back.x,back.y); await page.mouse.down(); await page.mouse.move(back.x+140,back.y,{steps:8}); await page.mouse.up();
    const plusXAz=Number(await page.locator('[data-camera-field="azimuth"]').inputValue());
    assert.ok(plusXAz > 0 && plusXAz < 180, `expected +X / subject-left azimuth, got ${plusXAz}`);
    assert.match(await preview(), /左后方/);
    assert.match(await preview(), /from behind/);
    assert.match(await preview(), /facing left/);
    await page.evaluate(() => {
      document.querySelector('[data-camera-reset]').click();
      document.querySelector('[data-camera-reset-view]').click();
      const az=document.querySelector('[data-camera-field="azimuth"]');
      az.value='180'; az.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.mouse.move(back.x,back.y); await page.mouse.down(); await page.mouse.move(back.x-140,back.y,{steps:8}); await page.mouse.up();
    const minusXAz=Number(await page.locator('[data-camera-field="azimuth"]').inputValue());
    assert.ok(minusXAz < 0, `expected -X / subject-right azimuth, got ${minusXAz}`);
    assert.match(await preview(), /右后方/);
    assert.match(await preview(), /from behind/);
    assert.match(await preview(), /facing right/);
    await page.screenshot({path:path.join(root,'../../temp/camera-editor-test.png')});
    await page.locator('[data-camera-expand]').click();
    await page.locator('[data-pose-mode="img2img"]').click();
    assert.equal(await panel.isVisible(),false);
    await page.locator('[data-pose-mode="normal"]').click();
    assert.equal(await panel.isVisible(),true);
    await page.waitForTimeout(400);
    const saved=await page.locator('[data-camera-field="azimuth"]').inputValue();
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('[data-camera-field="enabled"]').checked);
    assert.equal(await page.locator('[data-camera-field="azimuth"]').inputValue(),saved);
    await page.setViewportSize({width:390,height:844});
    await panel.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.locator('[data-camera-field="enabled"]').uncheck();
    assert.equal(await page.locator('.camera-viewport').isVisible(),false);
    console.log('PASS: 3D dragging, independent view navigation, mode gating, persistence, mobile layout; no page errors');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
