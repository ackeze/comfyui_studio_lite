const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const TINY_PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const path=require('node:path');
const root=path.resolve(__dirname,'../web');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)}close(){}};});
  let feature='camera',submitted,state,posted;
  const markdown=['## 创作方案','使用 **Anima**，保留 *柔和光线* 与 `1024 × 768`。','','- 检查模型','- 填写提示词','  - 保留用户设置','','> 调整完成后即可继续。','','| 项目 | 参数 |','| --- | --- |','| 步数 | 30 |','| CFG | 4 |','','```json','{ "prompt": "A peaceful afternoon", "width": 1024 }','```','','[官方说明](https://example.com/guide)','[危险链接](javascript:alert(1))','<img src=x onerror="window.markdownUnsafe=true">'].join('\n');
  await page.route('**/*',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
   if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
   if(p==='/launcher/agent/sessions' && request.method()==='POST'){
    posted=request.postDataJSON();
    state={id:'test',status:'waiting',events:[{type:'user',text:posted.text}],pending:{id:'call',feature,instruction:'调整并提交'}};
    return route.fulfill({json:state});
   }
   if(p==='/launcher/agent/sessions/test/messages' && request.method()==='POST'){
    posted=request.postDataJSON();
    state={...state,status:'done',pending:null,events:[...state.events,{type:'user',text:posted.text}]};
    return route.fulfill({json:state});
   }
   if(p==='/launcher/agent/sessions')return route.fulfill({json:{sessions:state?[{id:'test',title:'测试会话'}]:[]}});
   if(p==='/launcher/agent/sessions/test/submit'){
    submitted=request.postDataJSON();state={...state,status:'done',pending:null,events:[...state.events,{type:'assistant',text:markdown},{type:'tool',text:'local_models',status:'done',arguments:{},result:{models:['anima']}}],jobs:[{prompt_id:'p1',status:'done',images:[{filename:'ComfyStudio_Agent_00001_.png',subfolder:'',type:'output'}]}]};return route.fulfill({json:state});
   }
   if(p==='/launcher/agent/sessions/test'||p==='/launcher/agent/sessions/test/outputs')return route.fulfill({json:state});
   if(p==='/api/view'||p==='/view')return route.fulfill({body:TINY_PNG,contentType:'image/png'});
   if(p.startsWith('/api/models/'))return route.fulfill({json:['anima.safetensors']});
   if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
   if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['anima']]}}}}});
   return route.fulfill({json:{}});
  });
  await page.goto('http://127.0.0.1:19880/launcher');
  await page.locator('[data-nav="ai"]').click();
  for(feature of ['camera','pose']){
   if(feature==='pose')await page.getByRole('button',{name:'新建会话',exact:true}).click();
   await page.locator('.agent-panel textarea').fill('调整'+feature);
   await page.locator('.agent-panel [data-action="start"]').click();
   await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
   await page.locator('dialog[open] [data-agent-submit]').click();
   await page.waitForFunction(()=>document.querySelector('.agent-status').textContent==='本轮完成');
   assert.equal(submitted.id,'call');
   assert.equal(submitted.result.submitted,true);
   assert.ok(submitted.result.preview.startsWith('data:image/jpeg;base64,'));
   assert.ok(submitted.result.settings.cameraControl);
   assert.equal(await page.locator('dialog[open]').count(),0);
  }
  assert.equal(await page.locator('#poseControlPanel').count(),1);
  assert.equal(await page.locator('#chatMessages').count(),0);
  assert.equal(await page.locator('.agent-markdown h2').textContent(),'创作方案');
  assert.equal(await page.locator('.agent-markdown strong').textContent(),'Anima');
  assert.equal(await page.locator('.agent-markdown table tbody tr').count(),2);
  assert.equal(await page.locator('.agent-markdown ul ul').count(),1);
  assert.equal(await page.locator('.agent-markdown img,.agent-markdown script,.agent-markdown a[href^="javascript:"]').count(),0);
  assert.equal(await page.evaluate(()=>window.markdownUnsafe),undefined);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedCode=text;}}}));
  await page.getByRole('button',{name:'复制代码',exact:true}).click();
  assert.ok((await page.evaluate(()=>window.copiedCode)).includes('A peaceful afternoon'));
  await page.locator('.agent-tool summary').click();
  for(const width of [320,390,768,1600]){
   await page.setViewportSize({width,height:1000});
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const toggle=page.locator('[data-action="history"]');
    if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    await page.getByRole('button',{name:'测试会话',exact:true}).click();
    await page.waitForTimeout(450);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }
  }
  assert.equal(await page.locator('.agent-tool details').getAttribute('open'),'');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.agent-workspace').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.agent-events').evaluate(node=>node.scrollTop=0);
  await page.waitForTimeout(650);
  await page.screenshot({path:path.resolve(__dirname,'../../../output/agent-chat-layout.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForTimeout(650);
  await page.screenshot({path:path.resolve(__dirname,'../../../output/agent-chat-light.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(await page.locator('[data-action="history"]').getAttribute('aria-expanded')==='true')await page.locator('[data-action="history"]').click();
  await page.waitForTimeout(650);
  await page.screenshot({path:path.resolve(__dirname,'../../../output/agent-chat-mobile.png'),fullPage:true});
  const sendBounds=await page.locator('.agent-panel [data-action="start"]').boundingBox();
  const navBounds=await page.locator('.bottom-nav').boundingBox();
  assert.ok(sendBounds.y+sendBounds.height<navBounds.y,'Mobile send button must remain above navigation');
  await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
   const transfer=new DataTransfer();
   transfer.items.add(new File([blob],'drag-drop.jpg',{type:'image/jpeg'}));
   window.dropTransfer=transfer;
   document.querySelector('.agent-panel').dispatchEvent(new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  });
  assert.equal(await page.locator('.agent-drop').isVisible(),true,'Drag overlay must appear while dragging files');
  await page.evaluate(()=>document.querySelector('.agent-panel').dispatchEvent(new DragEvent('drop',{dataTransfer:window.dropTransfer,bubbles:true,cancelable:true})));
  assert.equal(await page.locator('.agent-drop').isVisible(),false);
  assert.equal(await page.locator('.agent-file').count(),1);
  await page.locator('.agent-panel textarea').fill('用这张图做参考');
  await page.locator('.agent-panel [data-action="start"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-file')===null);
  assert.equal(posted.images.length,1);
  assert.ok(posted.images[0].startsWith('data:image/jpeg;base64,'));
  await page.evaluate(()=>{
   const transfer=new DataTransfer();
   transfer.setData('text/uri-list','/api/view?filename=gallery.png&type=output');
   document.querySelector('.agent-panel').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>document.querySelector('.agent-file em')?.textContent==='gallery.png');
  assert.equal(await page.locator('.agent-file').count(),1);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Attachments must not overflow on mobile');
  await page.locator('.agent-panel textarea').fill('');
  await page.locator('.agent-file button').click();
  assert.equal(await page.locator('.agent-file').count(),0);
  assert.equal(await page.locator('.agent-thumb').count(),1);
  await page.locator('.agent-thumb').click();
  await page.waitForSelector('.agent-viewer[open]');
  assert.equal(await page.locator('.agent-viewer-name').textContent(),'ComfyStudio_Agent_00001_.png');
  await page.locator('.agent-viewer [data-viewer="in"]').click();
  assert.ok((await page.locator('.agent-viewer-stage img').evaluate(node=>node.style.transform)).includes('scale(1.25)'));
  const stage=await page.locator('.agent-viewer-stage').boundingBox();
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
  await page.mouse.down();
  await page.mouse.move(stage.x+stage.width/2+40,stage.y+stage.height/2+30,{steps:4});
  await page.mouse.up();
  assert.ok((await page.locator('.agent-viewer-stage img').evaluate(node=>node.style.transform)).includes('translate(40px, 30px)'));
  await page.evaluate(()=>{window.__downloads=[];const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__downloads.push(this.download);else original.call(this);};});
  await page.locator('.agent-viewer [data-viewer="download"]').click();
  await page.waitForFunction(()=>window.__downloads.length===1);
  assert.equal(await page.evaluate(()=>window.__downloads[0]),'ComfyStudio_Agent_00001_.png');
  await page.locator('.agent-viewer [data-viewer="close"]').click();
  assert.equal(await page.locator('.agent-viewer[open]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Agent editors, Markdown, nested lists/tables/code copy, XSS blocking, themes, mobile, persistent tool expansion, reduced motion, dropped images and image viewer');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
