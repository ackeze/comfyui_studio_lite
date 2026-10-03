const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const plugin=path.resolve(__dirname,'..');
const workspace=path.resolve(plugin,'../..');
const mobile=fs.existsSync(path.join(plugin,'mobile-app'))?path.join(plugin,'mobile-app'):path.join(workspace,'mobile-app');
const child=`<!doctype html><meta charset="utf-8"><style>body{padding:80px}button,a{display:block;margin:24px;padding:16px}</style><button id="image">图片</button><a id="video" href="/api/view?filename=片段.mp4&type=output" download="片段.mp4">视频</a><button id="export">导出</button><script type="module">
import {initDownloads,requestNativeDownload} from '/download.js';
window.statuses=[];initDownloads((text,error)=>window.statuses.push({text,error}));
document.querySelector('#image').onclick=()=>{window.clicked=(window.clicked||0)+1;window.returned=requestNativeDownload('/api/view?filename=图片.png&type=output','图片.png');};
document.querySelector('#export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['中文导出'],{type:'text/plain'}));a.download='导出.txt';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(a.href);};
window.ready=true;</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.messages=[];window.addEventListener('message',event=>window.messages.push({type:event.data?.type,origin:event.origin,parent:event.source===window.parent,frame:event.source===document.querySelector('#mainFrame')?.contentWindow}));
   if(location.hostname!=='localhost')return;
   localStorage.setItem('comfyui_server','http://127.0.0.1:19880');
   window.saved=[];window.mode='success';window.busy=0;window.maxBusy=0;
   window.Capacitor={isNativePlatform:()=>true,Plugins:{StudioDownloads:{save:async file=>{
    window.saved.push(file);window.maxBusy=Math.max(window.maxBusy,++window.busy);
    await new Promise(resolve=>setTimeout(resolve,80));window.busy--;
    if(window.mode==='error')throw new Error('网络中断');
    return window.mode==='cancel'?{cancelled:true}:{bytes:123};
   }}}};
  });
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='localhost'&&url.pathname==='/')return route.fulfill({path:path.join(mobile,'web/index.html'),contentType:'text/html'});
   if(url.pathname==='/launcher')return route.fulfill({body:child,contentType:'text/html'});
   if(url.pathname==='/download.js')return route.fulfill({path:path.join(plugin,'web/assets/js/download.js'),contentType:'text/javascript'});
   return route.fulfill({json:{}});
  });
  await page.goto('http://localhost/');
  const frame=page.frameLocator('#mainFrame');
  await frame.locator('#image').waitFor();
  const childFrame=page.frames().find(frame=>frame.url().includes('/launcher'));
  await childFrame.waitForFunction(()=>window.messages.some(item=>item.type==='comfy-mobile-download-ready'));
  await page.locator('#mainApp').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished));});
  await frame.locator('#image').click();
  assert.equal(await childFrame.evaluate(()=>window.clicked),1,'Image click reaches the iframe');
  assert.equal(await childFrame.evaluate(()=>window.returned),true,'Native handshake is ready');
  await page.waitForFunction(()=>window.saved.length===1,{}, {timeout:5000});
  assert.equal((await page.evaluate(()=>window.saved[0])).filename,'图片.png');
  assert.ok((await page.evaluate(()=>window.saved[0])).url.includes('/api/view?filename='));
  await frame.locator('#video').click();
  await frame.locator('#export').click();
  await page.waitForFunction(()=>window.saved.length===3&&window.busy===0);
  const files=await page.evaluate(()=>window.saved);
  assert.equal(files[1].filename,'片段.mp4');assert.equal(files[1].base64,undefined,'Video streams from HTTP without copying into JS');
  assert.equal(Buffer.from(files[2].base64,'base64').toString(),'中文导出','Blob survives immediate URL revocation');
  assert.equal(await page.evaluate(()=>window.maxBusy),1,'Only one system save dialog is active');
  await childFrame.waitForFunction(()=>window.statuses.filter(item=>item.text==='文件已保存').length===3);
  await page.evaluate(()=>window.mode='cancel');await frame.locator('#image').click();
  await childFrame.waitForFunction(()=>window.statuses.some(item=>item.text==='已取消保存'));
  await page.evaluate(()=>window.mode='error');await frame.locator('#image').click();
  await childFrame.waitForFunction(()=>window.statuses.some(item=>item.error&&item.text.includes('网络中断')));
  const count=await page.evaluate(()=>window.saved.length);
  await childFrame.evaluate(()=>parent.postMessage({type:'comfy-mobile-download',id:'foreign',filename:'bad.txt',url:'http://example.com/secret'},'*'));
  await page.evaluate(()=>window.postMessage({type:'comfy-mobile-download',id:'forged',url:'http://127.0.0.1:19880/api/view'},'*'));
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.saved.length),count,'Wrong sender and external URLs never reach native saving');
  assert.deepEqual(errors,[]);
  console.log('PASS: Android iframe download handshake, image/video, revoked Blob export, sequential saving, cancellation, errors and origin checks');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
