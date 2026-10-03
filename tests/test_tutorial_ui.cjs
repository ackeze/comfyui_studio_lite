const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const plugin=path.resolve(__dirname,'..');
const workspace=path.resolve(plugin,'../..');
const mobile=fs.existsSync(path.join(plugin,'mobile-app'))?path.join(plugin,'mobile-app'):path.join(workspace,'mobile-app');
const root=path.join(plugin,'web');
const seenKey='comfy_studio_tutorial_seen_v1';
const views=['ai','studio','video','gallery','presets','reverse','settings'];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],mutations=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)}close(){}};
   if(location.hostname==='localhost')localStorage.setItem('comfyui_server','http://127.0.0.1:19884');
  });
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname;
   if(request.method()==='POST')mutations.push(p);
   if(url.hostname==='localhost')return route.fulfill({path:path.join(mobile,'web',p==='/'?'index.html':p),contentType:p==='/'?'text/html':undefined});
   if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
   if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
   if(p==='/launcher/agent/sessions')return route.fulfill({json:{sessions:[]}});
   if(p==='/launcher/ai/config')return route.fulfill({json:{configured:false,model:'test',api_base:'',vision_model:''}});
   if(p.startsWith('/api/models/'))return route.fulfill({json:['test.safetensors']});
   if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
   if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['anima']]}}}}});
   return route.fulfill({json:{}});
  });
  await page.goto('http://127.0.0.1:19884/launcher');
  await page.locator('#tutorialDialog[open]').waitFor();
  assert.deepEqual(await page.locator('[data-nav]').evaluateAll(nodes=>nodes.map(node=>node.dataset.nav)),views.slice(0,-1));
  assert.equal(await page.locator('.view.active').getAttribute('data-view'),'ai');
  assert.equal(await page.locator('#tutorialBack').isDisabled(),true);
  await page.keyboard.press('Control+Enter');
  assert.equal(mutations.length,0,'The guide never starts generation');
  for(let i=0;i<views.length;i++){
   assert.equal(await page.locator('#tutorialProgress').textContent(),`页面指南 · ${i+1} / 7`);
   if(views[i]==='settings')assert.equal(await page.locator('#settingsSheet').getAttribute('aria-hidden'),'false');
   else assert.equal(await page.locator('.view.active').getAttribute('data-view'),views[i]);
   if(i<views.length-1)await page.locator('#tutorialNext').click();
  }
  await page.locator('#tutorialBack').click();
  assert.equal(await page.locator('.view.active').getAttribute('data-view'),'reverse');
  assert.equal(await page.locator('#settingsSheet').getAttribute('aria-hidden'),'true');
  await page.locator('#tutorialNext').click();
  await page.locator('#settingsSheet .settings-panel').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  await page.locator('.tutorial-card').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  await page.screenshot({path:path.join(workspace,'temp/tutorial-settings-desktop.png')});
  await page.getByRole('button',{name:'开始使用',exact:true}).click();
  assert.equal(await page.locator('#tutorialDialog').isVisible(),false);
  assert.equal(await page.locator('.view.active').getAttribute('data-view'),'ai');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),seenKey),'true');
  await page.reload();
  await page.locator('#openTutorial').waitFor();
  assert.equal(await page.locator('#tutorialDialog').isVisible(),false);
  await page.locator('[data-nav="studio"]').click();
  await page.reload();
  assert.equal(await page.locator('.view.active').getAttribute('data-view'),'studio','Explicit studio links survive reload');
  await page.locator('[data-nav="ai"]').click();
  await page.locator('#openTutorial').click();
  for(const [width,height] of [[1440,900],[768,430],[390,844],[320,640]]){
   await page.setViewportSize({width,height});
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.waitForTimeout(250);
    assert.ok(await page.locator('.tutorial-card').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}),`${width} ${theme}: guide stays inside screen`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(width===390||width===1440)await page.screenshot({path:path.join(workspace,`temp/tutorial-${theme}-${width}.png`)});
   }
  }
  await page.setViewportSize({width:390,height:844});
  for(let i=0;i<6;i++)await page.locator('#tutorialNext').click();
  await page.locator('#settingsSheet .settings-panel').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  await page.locator('.tutorial-card').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  assert.ok(await page.locator('#tutorialNext').evaluate(node=>{const r=node.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0}),'Settings guide actions remain on screen');
  await page.screenshot({path:path.join(workspace,'temp/tutorial-settings-mobile.png')});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#tutorialDialog').isVisible(),false);
  await page.waitForFunction(()=>document.activeElement.id==='openTutorial');
  await page.evaluate(key=>localStorage.removeItem(key),seenKey);
  await page.reload();
  await page.locator('#tutorialDialog[open]').waitFor();
  await page.locator('#tutorialNext').click();
  await page.locator('#tutorialSkip').click();
  assert.equal(await page.locator('.view.active').getAttribute('data-view'),'ai','Skipping returns to AI');
  await page.reload();
  assert.equal(await page.locator('#tutorialDialog').isVisible(),false);
  assert.equal(mutations.length,0,'Page introductions do not change backend configuration');

  await page.evaluate(key=>localStorage.removeItem(key),seenKey);
  await page.goto('http://localhost/');
  const frame=page.frameLocator('#mainFrame');
  await frame.locator('#tutorialDialog[open]').waitFor();
  await page.locator('#mainApp').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  assert.equal(await page.locator('.nav-item').first().getAttribute('data-tab'),'ai');
  for(const view of views){
   const tab=view==='studio'?'gen':view;
   await page.waitForFunction(tab=>document.querySelector('.nav-item.active')?.dataset.tab===tab,tab);
   assert.equal(await page.locator('.nav-item:disabled').count(),7);
   assert.equal(await frame.locator('#tutorialDialog').isVisible(),true);
   await frame.locator('#tutorialNext').click();
  }
  await page.waitForFunction(()=>document.querySelector('.nav-item.active')?.dataset.tab==='ai'&&!document.querySelector('.nav-item:disabled'));
  assert.equal(await frame.locator('#tutorialDialog').isVisible(),false);
  assert.equal(await frame.locator('.view.active').getAttribute('data-view'),'ai');
  await frame.locator('#openTutorial').click();
  await frame.locator('#tutorialNext').click();
  await page.waitForFunction(()=>document.querySelector('.nav-item.active')?.dataset.tab==='gen');
  await frame.locator('.tutorial-card').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished))});
  await page.screenshot({path:path.join(workspace,'temp/tutorial-android.png')});
  await frame.locator('#tutorialSkip').click();
  await page.locator('[data-tab="gen"]').click();
  await frame.locator('#studioView.active').waitFor();
  await page.locator('[data-tab="settings"]').click();
  assert.equal(await page.locator('#settingsView').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: first visit, 7 pages, back/skip/finish/reopen, keyboard, themes, layouts, deep links and Android navigation');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
