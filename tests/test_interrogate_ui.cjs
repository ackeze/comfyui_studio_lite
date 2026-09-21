const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.env.STUDIO_TEST_ROOT || path.resolve(__dirname,'../web');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let calls=0;
  await page.route('**/*',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/launcher/interrogate'){
    const body=route.request().postDataJSON();
    if(body.action==='models')return route.fulfill({json:{models:['vision-test']}});
    assert.ok(body.image.startsWith('data:image/jpeg;base64,'));
    assert.ok(Buffer.from(body.image.split(',')[1],'base64').length>0);
    calls++;
    if(calls===2)return route.fulfill({status:502,json:{error:'test upstream failure'}});
    return route.fulfill({json:{prompt:'masterpiece, best quality, score_7, single subject, detailed background'}});
   }
   if(p==='/interrogate.js')return route.fulfill({path:path.join(root,'assets/js/interrogate.js'),contentType:'text/javascript'});
   if(p==='/style.css')return route.fulfill({path:path.join(root,'assets/css/launcher.css'),contentType:'text/css'});
   return route.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/style.css"></head><body><section id="reverseView"><div class="reverse-layout"></div></section><script type="module">import {initInterrogate} from "/interrogate.js";initInterrogate(text=>window.applied=text);</script></body></html>'});
  });
  await page.goto('http://192.168.50.2:19879/');
  assert.equal(await page.evaluate(()=>isSecureContext),false);
  assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'undefined');
  await page.waitForFunction(()=>!document.getElementById('reverseFile')?.disabled);
  await page.locator('#reverseKey').fill('private-test-key');
  await page.locator('#reverseModel').fill('vision-test');
  await page.locator('#reverseModels').click();
  await page.waitForFunction(()=>document.querySelectorAll('#reverseModelList option').length===1);
  const buffer=fs.readFileSync(path.resolve(__dirname,'../../../output/CameraAudit_no_camera_00001_.png'));
  await page.locator('#reverseFile').setInputFiles([{name:'first.png',mimeType:'image/png',buffer},{name:'second.png',mimeType:'application/octet-stream',buffer}]);
  await page.waitForFunction(()=>document.querySelectorAll('.reverse-card').length===2);
  await page.locator('#reverseRun').click();
  await page.waitForFunction(()=>document.querySelector('#reverseStatus').textContent.includes('批次结束'));
  assert.equal(calls,2);
  assert.match(await page.locator('#reverseStatus').textContent(),/失败 1/);
  await page.locator('#reverseRun').click();
  await page.waitForFunction(()=>document.querySelector('#reverseCount').textContent==='2 / 2 已完成');
  assert.equal(calls,3);
  await page.locator('.reverse-card-preview').first().click();
  await page.locator('.reverse-dialog textarea').fill('edited Anima prompt');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已保存到本机'}).waitFor();
  assert.match(await page.locator('.reverse-card-overlay').first().textContent(),/edited Anima prompt/);
  await page.locator('.reverse-dialog button').filter({hasText:'填入创作页'}).click();
  assert.equal(await page.evaluate(()=>window.applied),'edited Anima prompt');
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.reverse-card').length===2);
  assert.equal(await page.locator('#reverseKey').inputValue(),'');
  assert.equal(await page.locator('#reverseModel').inputValue(),'vision-test');
  assert.match(await page.locator('.reverse-card-overlay').first().textContent(),/edited Anima/);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('private-test-key')),false);
  await page.locator('#reverseKey').fill('another-key');
  await page.locator('#reversePreset').selectOption('qwen');
  assert.equal(await page.locator('#reverseKey').inputValue(),'');
  assert.equal(await page.locator('#reverseModel').inputValue(),'qwen-vl-plus');
  for(const count of [1,2]){
   const transfer=await page.evaluateHandle(({bytes,count})=>{
    const data=new DataTransfer();
    for(let i=0;i<count;i++)data.items.add(new File([new Uint8Array(bytes)],'dropped-'+i+'.png',{type:'image/png'}));
    return data;
   },{bytes:Array.from(buffer),count});
   await page.locator('.reverse-upload').dispatchEvent('dragenter',{dataTransfer:transfer});
   assert.ok(await page.locator('.reverse-upload').evaluate(el=>el.classList.contains('is-dragging')));
   await page.locator('.reverse-upload').dispatchEvent('drop',{dataTransfer:transfer});
   await page.waitForFunction(expected=>document.querySelectorAll('.reverse-card').length===expected,count===1?3:5);
   assert.equal(await page.locator('.reverse-upload').evaluate(el=>el.classList.contains('is-dragging')),false);
   await transfer.dispose();
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('.reverse-card-preview').first().click();
   assert.ok(await page.locator('.reverse-dialog').isVisible());
   if(process.env.REVERSE_SCREENSHOT) {await page.waitForTimeout(400);await page.screenshot({path:process.env.REVERSE_SCREENSHOT.replace('.png','-'+width+'.png')});}
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS batch, retry, overlay, modal, persistence, secret isolation, mobile');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
