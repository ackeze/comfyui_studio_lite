const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.STUDIO_TEST_ROOT || path.resolve(__dirname,'../web');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}), jobs=[], errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.WebSocket=class {constructor(){window.testSocket=this;setTimeout(()=>this.onopen?.(),20)}close(){}}});
  await page.route('**/*',route=>{
   const p=new URL(route.request().url()).pathname;
   if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
   if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
   if(p==='/api/prompt'){jobs.push(route.request().postDataJSON());return route.fulfill({json:{prompt_id:`job${jobs.length}`}})}
   if(p.startsWith('/api/history/')){const id=p.split('/').pop();return route.fulfill({json:{[id]:{outputs:{9:{images:[{filename:'test.png',type:'output',subfolder:''}]}}}}})}
   if(p.startsWith('/api/models/'))return route.fulfill({json:['anima-base-v1.0.safetensors']});
   if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
   return route.fulfill({json:{}});
  });
  await page.goto('http://127.0.0.1:19877/launcher');
  await page.waitForTimeout(300);
  const handle=page.locator('#panelResize'),before=await page.locator('.composer-column').boundingBox();
  await handle.focus(); await page.keyboard.press('ArrowLeft');
  const after=await page.locator('.composer-column').boundingBox();assert.equal(after.width,before.width+16);
  const box=await handle.boundingBox();await page.mouse.move(box.x+3,box.y+30);await page.mouse.down();await page.mouse.move(box.x-45,box.y+30);await page.mouse.up();
  assert.ok((await page.locator('.composer-column').boundingBox()).width>after.width);
  await page.locator('#seed').fill('100');
  await page.locator('#batchSize').fill('3');
  await page.locator('#generate').click();
  await page.waitForTimeout(150);
  assert.equal(jobs.length,1);assert.equal(await page.locator('[data-status="waiting"]').count(),2);
  await page.locator('#batchSize').fill('1');await page.locator('#generate').click();
  assert.equal(await page.locator('[data-status="waiting"]').count(),3);
  await page.locator('[data-queue-cancel]').last().click();
  assert.equal(await page.locator('[data-status="cancelled"]').count(),1);
  for(let i=1;i<=3;i++){
   await page.evaluate(id=>window.testSocket.onmessage({data:JSON.stringify({type:'executing',data:{prompt_id:id,node:null}})}),`job${i}`);
   await page.waitForTimeout(250);
  }
  assert.equal(jobs.length,3);assert.equal(await page.locator('[data-status="done"]').count(),3);
  const samplers=jobs.map(j=>Object.values(j.prompt).find(n=>n.class_type==='KSampler'));
  assert.deepEqual(samplers.map(n=>n.inputs.seed),[100,101,102]);
  assert.ok(jobs.every(j=>Object.values(j.prompt).filter(n=>n.inputs.batch_size!==undefined).every(n=>n.inputs.batch_size===1)));
  assert.deepEqual(errors,[]);
  console.log('PASS: resize keyboard/drag, 3-image serial batch, seed progression, enqueue while running, cancel waiting, completed thumbnails');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
