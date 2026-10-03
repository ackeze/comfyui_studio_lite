const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const root=process.env.STUDIO_TEST_ROOT || path.resolve(__dirname,'../web');
const workspace=path.resolve(__dirname,'../../..');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   localStorage.setItem('comfy_studio_tutorial_seen_v1','true');
   window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)} close(){}};
 });
 await page.route('**/*',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/launcher/interrogate')return route.fulfill({json:route.request().postDataJSON().action==='models'?{models:['vision-test']}:{prompt:'masterpiece, best quality, score_7, 1girl, white hair'}});
  if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
  if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
  if(p==='/example.png')return route.fulfill({path:path.join(workspace,'output/CameraAudit_no_camera_00001_.png')});
  if(p.startsWith('/api/models/'))return route.fulfill({json:['anima-base-v1.0.safetensors']});
  if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
  if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['anima']]}}}}});
  return route.fulfill({json:{}});
 });
 await page.goto('http://127.0.0.1:19877/launcher#studio');
 await page.locator('#studioPrompt').fill('white hair, blue eyes, pink dress');
 await page.waitForTimeout(350);
 assert.equal(await page.locator('#prompt').inputValue(),'white hair, blue eyes, pink dress');
 await page.locator('#openPrompt').click();
 for(const width of [390,768,1600]){
  await page.setViewportSize({width,height:1000});
  await page.waitForTimeout(400);
  const alignment=await page.evaluate(()=>{
   const button=document.querySelector('#promptSheet .sheet-close').getBoundingClientRect();
   const icon=document.querySelector('#promptSheet .sheet-close svg').getBoundingClientRect();
   const title=document.querySelector('#promptSheet .sheet-head>div').getBoundingClientRect();
   const entry=getComputedStyle(document.querySelector('#openCamera'));
   return {x:Math.abs(icon.x+icon.width/2-button.x-button.width/2),y:Math.abs(icon.y+icon.height/2-button.y-button.height/2),title:Math.abs(title.y+title.height/2-button.y-button.height/2),entry:entry.alignItems};
  });
  assert.ok(alignment.x<1 && alignment.y<1 && alignment.title<1,JSON.stringify(alignment));
  assert.equal(alignment.entry,'center');
 }
 await page.locator('#prompt').fill('a peaceful garden');
 await page.locator('#applyPrompt').click();
 assert.equal(await page.locator('#studioPrompt').inputValue(),'a peaceful garden');
 await page.locator('.lora-summary[data-open-tab="lora"]').click();
 assert.equal(await page.locator('#parameterSheet').getAttribute('aria-hidden'),'false');
 await page.locator('#addLora').click();
 assert.equal(await page.locator('.lora-card').count(),1);
 await page.locator('#applyParams').click();
 await page.locator('#openCamera').click();
 assert.equal(await page.locator('#cameraDialog').isVisible(),true);
 await page.locator('[data-camera-field="enabled"]').check();
 assert.equal(await page.locator('.camera-viewport').isVisible(),true);
 await page.locator('#closeCamera').click();
 await page.locator('[data-pose-mode="img2img"]').click();
 await page.locator('[data-repair-mode="local"]').click();
 await page.locator('[data-repair-part][value="hands"]').check();
 await page.locator('[data-repair-part][value="body"]').check();
 assert.equal(await page.locator('[data-repair-part]:checked').count(),3);
 assert.equal(await page.locator('#studioPrompt').isVisible(),false);
 assert.equal(await page.locator('#repairHint').isVisible(),true);
 assert.equal(await page.locator('#img2imgDenoise').isVisible(),false);
 await page.locator('[data-repair-mode="normal"]').click();
 assert.equal(await page.locator('#studioPrompt').isVisible(),true);
 await page.locator('[data-pose-mode="normal"]').click();
 for (const width of [390,1600]) {
  await page.setViewportSize({width,height:1000});
  for (const theme of ['light','dark']) {
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for (const [dialogId,buttonId] of [['cameraDialog','closeCamera'],['artistDialog','artistClose']]) {
    await page.evaluate(id=>document.getElementById(id).showModal(),dialogId);
    const aligned=await page.evaluate(({dialogId,buttonId})=>{
     const dialog=document.getElementById(dialogId),button=document.getElementById(buttonId);
     const b=button.getBoundingClientRect(),s=button.querySelector('svg').getBoundingClientRect(),h=dialog.querySelector('h2').getBoundingClientRect();
     return Math.abs(b.x+b.width/2-s.x-s.width/2)<.5 && Math.abs(b.y+b.height/2-s.y-s.height/2)<.5 && Math.abs(h.y+h.height/2-b.y-b.height/2)<.5;
    },{dialogId,buttonId});
    assert.equal(aligned,true,`${dialogId} ${theme} ${width} alignment`);
    await page.locator('#'+buttonId).click();
   }
  }
 }
 await page.evaluate(()=>{const img=document.querySelector('#resultImage');img.src='/example.png';img.classList.add('visible');document.querySelector('#canvasPlaceholder').hidden=true;document.querySelector('#canvasActions').classList.add('visible')});
 await page.locator('#resultImage').evaluate(img=>img.decode());
 for(const width of [1600,1024,768,390,320]){
  await page.setViewportSize({width,height:width>=1024?1000:844});
  let geometry;
  for(const theme of ['light','dark']){
   await page.evaluate(t=>{document.documentElement.dataset.theme=t},theme);
   await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme} ${width} overflow`);
   const boxes=await page.evaluate(()=>['.stage-card','.composer-column','.bottom-nav','.generation-dock'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));
   if(geometry)assert.deepEqual(boxes,geometry,'theme must not affect geometry');
   geometry=boxes;
   if(width===1600||width===390)await page.screenshot({path:path.join(workspace,`temp/studio-${theme}-${width}.png`),fullPage:true});
  }
 }
 await page.locator('[data-size="1024x576"]').click();
 assert.equal(await page.locator('#width').inputValue(),'1024');
 assert.equal(await page.locator('#height').inputValue(),'576');
 await page.locator('[data-resolution="1536"]').click();
 assert.equal(await page.locator('#width').inputValue(),'1536');
 assert.equal(await page.locator('#height').inputValue(),'864');
 await page.locator('[data-size="768x1024"]').click();
 assert.equal(await page.locator('#width').inputValue(),'1152');
 assert.equal(await page.locator('#height').inputValue(),'1536');
 await page.locator('[data-resolution="1024"]').click();
 assert.equal(await page.locator('#width').inputValue(),'768');
 assert.equal(await page.locator('#height').inputValue(),'1024');
 for(const view of ['ai','gallery','presets','reverse','studio']){await page.locator(`[data-nav="${view}"]`).click();assert.equal(await page.locator(`.view.active[data-view="${view}"]`).count(),1)}
 await page.locator('[data-nav="reverse"]').click();
 await page.locator('#reverseBase').fill('https://example.invalid/v1');
 await page.locator('#reverseModels').click();
 await page.waitForFunction(()=>document.querySelector('#reverseModelList option'));
 assert.equal(await page.locator('#reverseModelList option').getAttribute('value'),'vision-test');
 await page.locator('#reverseModel').fill('vision-test');
 await page.locator('#reverseFile').setInputFiles(path.join(workspace,'output/CameraAudit_no_camera_00001_.png'));
 await page.waitForFunction(()=>document.querySelector('.reverse-card-preview'));
 await page.locator('#reverseRun').click();
 await page.waitForFunction(()=>document.querySelector('.reverse-card-overlay').textContent.includes('score_7'));
 await page.locator('.reverse-card-preview').first().click();
 await page.locator('.reverse-dialog button').filter({hasText:'填入创作页'}).click();
 assert.equal(await page.locator('#studioPrompt').inputValue(),'masterpiece, best quality, score_7, 1girl, white hair');
 await page.setViewportSize({width:1600,height:1000});
 await page.locator('#openSettings').click();
 for(const [width,height] of [[320,640],[390,844],[768,430],[820,1180],[1600,1000]]){
  await page.setViewportSize({width,height});
  await page.waitForTimeout(400);
  for(const category of ['ai','prompt','connection','appearance']){
   await page.locator('[data-settings-tab="'+category+'"]').click();
   assert.equal(await page.locator('[data-settings-page="'+category+'"]').isVisible(),true);
   assert.equal(await page.locator('.settings-category:visible').count(),1);
   assert.ok(await page.locator('#saveSettings').isVisible());
   const fits=await page.locator('#saveSettings').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1 && r.left>=0 && r.right<=innerWidth+1;});
   assert.ok(fits,'settings save button must stay on screen');
  }
  if(width===390 && process.env.SETTINGS_SCREENSHOT) await page.screenshot({path:process.env.SETTINGS_SCREENSHOT.replace('.png','-mobile.png')});
 }
 await page.setViewportSize({width:1600,height:1000});
 if(process.env.SETTINGS_SCREENSHOT) {await page.waitForTimeout(400);await page.screenshot({path:process.env.SETTINGS_SCREENSHOT});}
 await page.locator('[data-theme-choice="dark"]').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.keyboard.press('Escape');
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.locator('#openSettings').click();
 await page.locator('[data-theme-choice="system"]').click();
 await page.emulateMedia({colorScheme:'light'});
 await page.waitForTimeout(100);
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size}),true);
 for(const viewport of [{width:390,height:844},{width:768,height:430}]){
  await page.setViewportSize(viewport);
  await page.goto('http://127.0.0.1:19877/launcher?embedded=1#studio');
  assert.equal(await page.locator('.bottom-nav').isVisible(),false);
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.task-queue').isVisible(),false);
  const bubbles=await page.evaluate(()=>{const q=document.getElementById('mobileQueue').getBoundingClientRect(),g=document.getElementById('generationDock').getBoundingClientRect();return {round:Math.abs(q.width-q.height)<1,gap:g.left-q.right,bottom:innerHeight-g.bottom,aligned:Math.abs((q.top+q.bottom-g.top-g.bottom)/2)<1};});
  assert.ok(bubbles.round && bubbles.aligned && bubbles.gap>=10 && bubbles.bottom>=12,JSON.stringify(bubbles));
  await page.locator('#mobileQueue').click();
  assert.equal(await page.locator('#mobileQueueDialog .task-queue').isVisible(),true);
  await page.locator('#closeMobileQueue').click();
  assert.equal(await page.locator('.task-queue').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: prompt sync, LoRA, parameters, camera dialog, navigation; 320/390/768/1024/1600 layouts; identical theme geometry');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
