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
  await page.addInitScript(()=>{localStorage.setItem('comfy_studio_tutorial_seen_v1','true');window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)}close(){}};});
  let feature='camera',editAction='edit',submitted,state,posted,forked,branchNumber=0;
  let aiConfig={configured:true,model:'deepseek-v4-pro',api_base:'https://api.deepseek.com',vision_model:''},savedSettings;
  const sessions=new Map();
  const markdown=['## 创作方案','使用 **Anima**，保留 *柔和光线* 与 `1024 × 768`。','','- 检查模型','- 填写提示词','  - 保留用户设置','','> 调整完成后即可继续。','','| 项目 | 参数 |','| --- | --- |','| 步数 | 30 |','| CFG | 4 |','','```json','{ "prompt": "A peaceful afternoon", "width": 1024 }','```','','[官方说明](https://example.com/guide)','[危险链接](javascript:alert(1))','<img src=x onerror="window.markdownUnsafe=true">'].join('\n');
  await page.route('**/*',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
   if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
   if(p==='/launcher/ai/config')return route.fulfill({json:aiConfig});
   if(p==='/launcher/ai/settings'){savedSettings=request.postDataJSON();aiConfig={...aiConfig,...savedSettings};return route.fulfill({json:{...aiConfig,api_key_set:true}});}
   if(p==='/api/upload/image')return route.fulfill({json:{name:'chat-original.png',subfolder:'comfy_studio_agent',type:'input'}});
   if(p==='/launcher/agent/sessions' && request.method()==='POST'){
    posted=request.postDataJSON();
    const instruction=feature==='project_edit'?'修复配置读取逻辑\n\n确认修改 1 个文件（根目录：D:\\AI\\ComfyUI-aki-v1.4）。\n\n````diff\n--- a/custom_nodes/aki_launcher/install.py\n+++ b/custom_nodes/aki_launcher/install.py\n@@ -1,2 +1,2 @@\n-value = 1\n+value = 2\n <img src=x onerror="window.diffUnsafe=true">\n ```\n````\n\n确认前不会写入。':'调整并提交';
    state={id:'test',status:'waiting',events:[{type:'user',text:posted.text,message_index:1}],pending:{id:'call',feature,action:editAction,instruction}};sessions.set('test',state);
    return route.fulfill({json:state});
   }
   if(p==='/launcher/agent/sessions/test/messages' && request.method()==='POST'){
    posted=request.postDataJSON();
    state={...state,status:'done',pending:null,events:[...state.events,{type:'user',text:posted.text,message_index:4,images:posted.images?.map(()=>'/view?filename=chat-original.png&subfolder=comfy_studio_agent&type=input') || []}]};sessions.set('test',state);
    return route.fulfill({json:state});
   }
   if(p==='/launcher/agent/sessions')return route.fulfill({json:{sessions:[...sessions.values()].map(session=>({id:session.id,title:'测试会话',parent_id:session.parent_id}))}});
   if(p==='/launcher/agent/sessions/test/submit'){
    submitted=request.postDataJSON();state={...state,status:'done',pending:null,events:[...state.events,{type:'assistant',text:markdown,message_index:2,retryable:true},{type:'tool',text:'local_models',status:'done',arguments:{},result:{models:['anima']}}],jobs:[{prompt_id:'p1',status:'done',images:[{filename:'ComfyStudio_Agent_00001_.png',subfolder:'',type:'output'}]}]};sessions.set('test',state);return route.fulfill({json:state});
   }
   const fork=p.match(/^\/launcher\/agent\/sessions\/([^/]+)\/fork$/);
   if(fork){
    forked=request.postDataJSON();const source=sessions.get(fork[1]),index=forked.message_index;
    const events=source.events.filter(event=>index===undefined||event.message_index!==undefined&&event.message_index<(forked.action==='retry'?index:index+1)).map(event=>({...event}));
    if(forked.action==='edit')events.find(event=>event.message_index===index).text=forked.text;
    if(forked.action==='retry'||events.at(-1)?.type==='user')events.push({type:'assistant',text:'新分支回复',message_index:(index??4)+1,retryable:true});
    state={...structuredClone(source),id:'branch-'+(++branchNumber),parent_id:source.id,status:'done',error:null,events};sessions.set(state.id,state);
    return route.fulfill({json:state});
   }
   const selected=p.match(/^\/launcher\/agent\/sessions\/([^/]+)(?:\/outputs)?$/);
   if(selected&&sessions.has(selected[1]))return route.fulfill({json:sessions.get(selected[1])});
   if(p==='/api/view'||p==='/view')return route.fulfill({body:TINY_PNG,contentType:'image/png'});
   if(p.startsWith('/api/models/'))return route.fulfill({json:['anima.safetensors']});
   if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler']],scheduler:[['simple']]}}}}});
   if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['anima']]}}}}});
   return route.fulfill({json:{}});
  });
  await page.goto('http://127.0.0.1:19880/launcher');
  await page.locator('#openSettings').click();
  await page.locator('[data-settings-tab="ai"]').click();
  await page.locator('#aiVisionModel').fill('vision-with-tools');
  await page.locator('#saveSettings').click();
  await page.waitForFunction(()=>document.querySelector('#settingsSheet').getAttribute('aria-hidden')==='true');
  assert.equal(savedSettings.vision_model,'vision-with-tools');
  assert.equal(savedSettings.api_key,undefined);
  assert.equal(await page.locator('#aiVisionModel').inputValue(),'vision-with-tools');
  await page.locator('[data-nav="ai"]').click();
  for(feature of ['camera','pose']){
   if(feature==='pose')await page.getByRole('button',{name:'新建会话',exact:true}).click();
   await page.locator('.agent-compose > textarea').fill('调整'+feature);
   await page.locator('.agent-panel [data-action="start"]').click();
   assert.equal(await page.locator('.agent-user [data-message-action="edit"]').isDisabled(),true);
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
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedCode=text;}}}));
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
  await page.locator('.agent-compose > textarea').fill('用这张图做参考');
  await page.locator('.agent-panel [data-action="start"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-file')===null);
  assert.equal(posted.images.length,1);
  assert.deepEqual(posted.image_files,['comfy_studio_agent/chat-original.png']);
  assert.ok(posted.images[0].startsWith('data:image/jpeg;base64,'));
  await page.locator('.agent-user .agent-input-image').waitFor();
  await page.locator('.agent-input-image').click();
  await page.locator('.agent-viewer[open]').waitFor();
  assert.equal(await page.locator('.agent-viewer-name').textContent(),'chat-original.png');
  await page.locator('.agent-viewer [data-viewer="close"]').click();
  await page.evaluate(()=>{
   const transfer=new DataTransfer();
   transfer.setData('text/uri-list','/api/view?filename=gallery.png&type=output');
   document.querySelector('.agent-panel').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>document.querySelector('.agent-file em')?.textContent==='gallery.png');
  assert.equal(await page.locator('.agent-file').count(),1);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Attachments must not overflow on mobile');
  await page.locator('.agent-compose > textarea').fill('');
  await page.locator('.agent-file button').click();
  assert.equal(await page.locator('.agent-file').count(),0);
  await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
   const context=canvas.getContext('2d'),pixels=context.createImageData(2048,2048);
   for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=Math.random()*256;pixels.data[i+1]=Math.random()*256;pixels.data[i+2]=Math.random()*256;pixels.data[i+3]=255;}
   context.putImageData(pixels,0,0);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const transfer=new DataTransfer();transfer.items.add(new File([blob],'pasted.png',{type:'image/png'}));
   const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});
   document.querySelector('.agent-compose > textarea').dispatchEvent(event);window.imagePastePrevented=event.defaultPrevented;
  });
  assert.equal(await page.locator('.agent-file').count(),1);
  assert.equal(await page.evaluate(()=>window.imagePastePrevented),true);
  await page.locator('.agent-compose > textarea').fill('读取粘贴图片');
  await page.locator('.agent-panel [data-action="start"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-file')===null);
  const size=await page.evaluate(async url=>{const bitmap=await createImageBitmap(await (await fetch(url)).blob());return [bitmap.width,bitmap.height];},posted.images[0]);
  assert.deepEqual(size,[1536,1536]);
  assert.ok(posted.images[0].length<=2_000_000,'Detailed images fit the chat upload size limit');
  assert.equal(await page.locator('.agent-generation .agent-thumb').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Image messages fit mobile width');
  await page.locator('.agent-generation .agent-thumb').click();
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
  const original=structuredClone(sessions.get('test'));
  assert.equal(await page.locator('.agent-message-actions button').evaluateAll(buttons=>buttons.every(button=>!button.textContent.trim()&&button.querySelector('svg')&&button.getAttribute('aria-label')&&button.title)),true,'Message actions use labelled SVG icons');
  await page.locator('.agent-assistant [data-message-action="copy"]').click();
  assert.equal(await page.evaluate(()=>window.copiedCode),markdown);
  await page.locator('.agent-assistant [data-message-action="retry"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-assistant .agent-message-content')?.textContent==='新分支回复');
  assert.equal(forked.action,'retry');assert.equal(forked.message_index,2);
  assert.deepEqual(sessions.get('test'),original);
  assert.equal(await page.getByRole('button',{name:'返回原对话',exact:true}).isVisible(),true);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Branch buttons must fit mobile width');
  }
  await page.getByRole('button',{name:'返回原对话',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.agent-markdown h2')?.textContent==='创作方案');
  await page.locator('.agent-user [data-message-action="edit"]').first().click();
  assert.equal(await page.locator('.agent-message-editor[open] textarea').inputValue(),'调整pose');
  await page.locator('.agent-message-editor textarea').fill('改成夜景');
  await page.screenshot({path:path.resolve(__dirname,'../../../output/agent-message-edit.png'),fullPage:true});
  await page.getByRole('button',{name:'保存并重新生成',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.agent-message-editor[open]'));
  assert.equal(forked.action,'edit');assert.equal(forked.text,'改成夜景');
  assert.equal(await page.locator('.agent-user .agent-message-content').textContent(),'改成夜景');
  assert.deepEqual(sessions.get('test'),original);
  await page.locator('.agent-assistant [data-message-action="edit"]').click();
  await page.locator('.agent-message-editor textarea').fill('手动修订的回答');
  await page.getByRole('button',{name:'保存到新分支',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.agent-message-editor[open]'));
  assert.equal(await page.locator('.agent-assistant .agent-message-content').textContent(),'手动修订的回答');
  await page.locator('.agent-assistant [data-message-action="branch"]').click();
  await page.waitForFunction(()=>localStorage.getItem('comfy_agent_session')==='branch-4');
  assert.equal(forked.action,'branch');
  await page.reload();await page.locator('[data-nav="ai"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-assistant .agent-message-content')?.textContent==='手动修订的回答');
  assert.equal(await page.getByRole('button',{name:'返回原对话',exact:true}).isVisible(),true);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=command=>{window.lanCopy=document.querySelector('.agent-copy-buffer')?.value;return command==='copy';};});
  await page.locator('.agent-assistant [data-message-action="copy"]').click();
  assert.equal(await page.evaluate(()=>window.lanCopy),'手动修订的回答');
  assert.equal(await page.locator('.agent-copy-buffer').count(),0);
  if(await page.locator('[data-action="history"]').getAttribute('aria-expanded')==='false')await page.locator('[data-action="history"]').click();
  await page.waitForFunction(()=>document.querySelector('.agent-session-list').textContent.includes('分支 · 测试会话'));
  await page.getByRole('button',{name:'分支 · 测试会话',exact:true}).first().waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'分支 · 测试会话',exact:true}).count(),4);
  await page.locator('[data-action="history"]').click();
  await page.locator('.agent-history').waitFor({state:'hidden'});
  await page.screenshot({path:path.resolve(__dirname,'../../../output/agent-branch-mobile.png'),fullPage:true});
  const failed=sessions.get('branch-4');failed.status='error';failed.error='测试连接失败';
  await page.reload();await page.locator('[data-nav="ai"]').click();
  await page.getByRole('button',{name:'重试回复',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.locator('.agent-status').textContent(),'测试连接失败');
  await page.getByRole('button',{name:'重试回复',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('comfy_agent_session')==='branch-5');
  assert.equal(forked.action,'retry');assert.equal(forked.message_index,undefined);
  feature='project_edit';
  for(editAction of ['edit','undo']){
   await page.getByRole('button',{name:'新建会话',exact:true}).click();
   await page.locator('.agent-compose > textarea').fill(editAction==='edit'?'检查自动安装并提议修复':'撤销上一次修复');
   await page.locator('.agent-panel [data-action="start"]').click();
   const confirm=page.getByRole('button',{name:editAction==='edit'?'确认修改':'确认撤销',exact:true});
   await confirm.waitFor({state:'visible'});
   assert.equal(await page.getByRole('button',{name:'打开编辑器',exact:true}).count(),0);
   assert.ok((await page.locator('.agent-pending code').textContent()).includes('+value = 2'));
   assert.ok((await page.locator('.agent-pending code').textContent()).includes('```'));
   assert.equal(await page.locator('.agent-pending img,.agent-pending script').count(),0);
   assert.equal(await page.evaluate(()=>window.diffUnsafe),undefined);
   for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await page.locator('.agent-pending').evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished));});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Diff confirmation must fit mobile and desktop');
    const visible=await confirm.evaluate(button=>{const a=button.getBoundingClientRect(),b=button.closest('.agent-pending').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;});
    assert.ok(visible,'Approval stays visible while the diff scrolls');
   }
   if(editAction==='edit')await page.screenshot({path:path.resolve(__dirname,'../../../output/project-agent-confirmation.png'),fullPage:true});
   await confirm.click();
   await page.waitForFunction(()=>!document.querySelector('.agent-pending button'));
   assert.deepEqual(submitted,{id:'call',result:{approved:true}});
  }
  await page.getByRole('button',{name:'新建会话',exact:true}).click();
  await page.locator('.agent-compose > textarea').fill('取消修复');
  await page.locator('.agent-panel [data-action="start"]').click();
  await page.getByRole('button',{name:'取消此操作',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.agent-pending button'));
  assert.deepEqual(submitted,{id:'call',result:{cancelled:true}});
  assert.deepEqual(errors,[]);
  console.log('PASS: Agent editors, Markdown, XSS blocking, themes, mobile, dropped images, image viewer, message copy/edit/retry, independent branches, LAN copy, reload persistence, project diff approval/undo/cancellation');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
