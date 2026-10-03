const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const TINY_PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const root=path.resolve(__dirname,'../web');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],prepared=[],manual=[],submissions=[];
    let session=null,history={},uploadCount=0,pendingOverrides={},sessionNumber=0;
    const cancelled=new Set(),queueActions=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('comfy_studio_tutorial_seen_v1','true');window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)}close(){}};});
    await page.route('**/*',async route=>{
      const request=route.request(),p=new URL(request.url()).pathname;
      if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
      if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
      const models={checkpoints:['image.safetensors'],diffusion_models:['anima-base-v1.0.safetensors','minimax_h3_fl2va_pruned_int8_convrot.safetensors','minimax_h3_ref2va_pruned_int8_convrot.safetensors'],text_encoders:['qwen_3_06b_base.safetensors','qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],vae:['qwen_image_vae.safetensors','minimax_h3_video_vae_fp16.safetensors','minimax_h3_audio_vae_fp32.safetensors'],loras:['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']};
      if(p.startsWith('/api/models/'))return route.fulfill({json:models[p.split('/').at(-1)]||[]});
      if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler','er_sde']],scheduler:[['simple']]}}}}});
      if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['stable_diffusion','minimax']]}}}}});
      if(p==='/api/upload/image')return route.fulfill({json:{name:'frame-'+(++uploadCount)+'.png',subfolder:'video-input',type:'input'}});
      if(p==='/api/launcher/video/workflow'){
        const settings=request.postDataJSON();prepared.push(settings);
        if(settings.mode==='frames'&&!settings.first_frame&&!settings.last_frame || settings.mode==='reference'&&!settings.reference_images?.length)return route.fulfill({status:400,json:{error:'请先上传当前视频模式所需的参考图'}});
        const n=Math.ceil(settings.duration*24),length=n+((5-n)%17+17)%17;
        return route.fulfill({json:{workflow:{1:{class_type:'SaveVideo',inputs:{format:'mp4'}}},settings:{...settings,media:'video',length,duration:length/24,seed:settings.seed===-1?42:settings.seed}}});
      }
      if(p==='/api/prompt'){manual.push(request.postDataJSON());return route.fulfill({json:{prompt_id:manual.at(-1).prompt_id}});}
      if(p==='/api/queue'&&request.method()==='POST'){const body=request.postDataJSON();queueActions.push(['queue',body]);body.delete?.forEach(id=>cancelled.add(id));return route.fulfill({json:{}});}
      if(p==='/api/interrupt'){queueActions.push(['interrupt',request.postDataJSON()]);return route.fulfill({json:{}});}
      if(p==='/api/queue')return route.fulfill({json:{queue_running:[],queue_pending:manual.filter(item=>!cancelled.has(item.prompt_id)).map(item=>[1,item.prompt_id])}});
      if(p.startsWith('/api/history/'))return route.fulfill({json:history});
      if(p==='/launcher/agent/sessions'&&request.method()==='POST'){
        const number=++sessionNumber;
        session={id:'video-editor-session-'+number,status:'waiting',events:[{type:'user',text:request.postDataJSON().text,message_index:1},{type:'tool',id:'video-editor-call-'+number,text:pendingOverrides.action==='configure'?'video_editor':'generate_from_editor',status:'waiting',message_index:2}],pending:{id:'video-editor-call-'+number,feature:'video',media:'video',auto_submit:true,prompt:'integrated_multimodal_description: [Shot 1] A boat drifts slowly.',...pendingOverrides}};
        return route.fulfill({json:session});
      }
      if(p.endsWith('/submit')){
        const body=request.postDataJSON();submissions.push(body);
        session={...session,status:'done',pending:null,events:[...session.events,{type:'assistant',text:body.result.workflows?'视频已入队':'设置已准备',message_index:4,retryable:true}],jobs:body.result.workflows?[{prompt_id:'agent-video',tool_call_id:body.id,status:'done',images:[],videos:[{filename:'agent.mp4',subfolder:'video',type:'output'}],settings:body.result.workflows[0].settings}]:[]};
        return route.fulfill({json:session});
      }
      if(p==='/launcher/agent/sessions')return route.fulfill({json:{sessions:session?[{id:session.id,title:'视频生成'}]:[]}});
      if(p.startsWith('/launcher/agent/sessions/'))return route.fulfill({json:session});
      if(p==='/view'||p==='/api/view'){
        if(new URL(request.url()).searchParams.get('type')==='input')return route.fulfill({body:TINY_PNG,contentType:'image/png'});
        if(process.env.STUDIO_VIDEO_PREVIEW){
          const media=fs.readFileSync(process.env.STUDIO_VIDEO_PREVIEW),range=request.headers().range?.match(/bytes=(\d+)-(\d*)/);
          if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):media.length-1;return route.fulfill({status:206,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${media.length}`},body:media.subarray(start,end+1)});}
          return route.fulfill({contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'},body:media});
        }
        return route.fulfill({body:'',contentType:'video/mp4'});
      }
      return route.fulfill({json:{}});
    });
    await page.goto('http://127.0.0.1:19881/launcher#video');
    await page.waitForFunction(()=>document.getElementById('videoModel').value.includes('fl2va'));
    assert.equal(await page.locator('#videoTiming').textContent(),'24 fps · 对齐后 124 帧 / 5.17 秒');
    assert.equal(await page.locator('.view.active').getAttribute('data-view'),'video');
    assert.ok(await page.locator('#generationDock').evaluate(el=>el.classList.contains('hidden')));
    assert.equal(manual.length,0,'Opening the video editor never queues a sample');
    assert.equal(await page.locator('#videoPrompt').inputValue(),'');
    await page.locator('#videoGenerate').click();
    await page.waitForFunction(()=>document.getElementById('videoError').textContent.includes('描述'));
    assert.equal(manual.length,0,'An empty prompt cannot submit the previous sample');
    await page.locator('#videoPrompt').fill('integrated_multimodal_description: [Shot 1] A boat drifts slowly.');
    await page.locator('#videoSeed').fill('123');await page.locator('#videoGenerate').click();
    await page.waitForFunction(()=>document.querySelector('#videoStatus').textContent.includes('入队'));
    assert.equal(manual.length,1);assert.equal(prepared[0].seed,123);assert.equal(prepared[0].audio,true);
    await page.reload();await page.waitForFunction(()=>document.getElementById('videoModel').value.includes('fl2va'));
    assert.equal(manual.length,1,'Reload queries the original task without resubmitting');
    const promptId=manual[0].prompt_id;
    history={[promptId]:{status:{status_str:'success'},outputs:{14:{images:[{filename:'test.mp4',subfolder:'video',type:'output'}],animated:[true]}}}};
    await page.waitForSelector('#videoPreview video');
    if(process.env.STUDIO_VIDEO_PREVIEW)await page.waitForFunction(()=>document.querySelector('#videoPreview video').readyState>=2);
    const completedVideo=await page.locator('#videoResults video').elementHandle();
    assert.equal(await page.locator('#videoResults a').getAttribute('download'),'test.mp4');
    await page.locator('#videoMode').selectOption('frames');await page.locator('#videoGenerate').click();
    await page.waitForFunction(()=>document.getElementById('videoError').textContent.includes('上传'));
    assert.equal(manual.length,1,'Missing frames do not queue a video');
    const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;return canvas.toDataURL('image/png').split(',')[1];}),'base64');
    await page.locator('#videoFirst').setInputFiles({name:'first.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.getElementById('videoFirstPreview').src.includes('frame-1'));
    await page.locator('#videoLast').setInputFiles({name:'last.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.getElementById('videoLastPreview').src.includes('frame-2'));
    await page.locator('#videoTurbo').check();await page.locator('#videoAudio').uncheck();
    assert.equal(await page.locator('#videoSteps').inputValue(),'8');assert.equal(await page.locator('#videoCfg').inputValue(),'1');
    await page.locator('[data-nav="ai"]').click();
    const firstAgentSubmit=page.waitForResponse(response=>response.url().endsWith('/submit')&&response.request().method()==='POST');
    await page.locator('.agent-compose > textarea').fill('按视频编辑器生成');await page.locator('[data-action="start"]').click();
    await firstAgentSubmit;
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    assert.equal(submissions.length,1);assert.equal(manual.length,1,'AI submits through the backend exactly once');
    const ai=submissions[0].result.workflows[0].settings;
    assert.equal(ai.mode,'frames');assert.equal(ai.first_frame,'video-input/frame-1.png');assert.equal(ai.last_frame,'video-input/frame-2.png');
    assert.equal(ai.steps,8);assert.equal(ai.cfg,1);assert.equal(ai.audio,false);assert.equal(ai.seed,123);
    assert.equal(ai.prompt,'integrated_multimodal_description: [Shot 1] A boat drifts slowly.');
    assert.ok(await page.locator('.agent-video').getAttribute('controls')!==null);
    assert.equal(await page.locator('.agent-generation a[download]').getAttribute('download'),'agent.mp4');
    await page.locator('[data-nav="video"]').click();await page.locator('#videoMode').selectOption('reference');
    assert.ok((await page.locator('#videoModel').inputValue()).includes('ref2va'));assert.ok(await page.locator('#videoTurbo').isDisabled());
    assert.equal(await page.locator('#videoSteps').inputValue(),'30');
    await page.locator('#videoReferences').setInputFiles([{name:'ref.png',mimeType:'image/png',buffer:png}]);
    await page.waitForSelector('#videoReferencePreviews img');await page.locator('#videoGenerate').click();
    await page.waitForFunction(()=>document.getElementById('videoStatus').textContent.includes('入队'));
    assert.deepEqual(prepared.at(-1).reference_images,['video-input/frame-3.png']);
    assert.equal(prepared.at(-1).first_frame,undefined,'Reference mode does not send hidden keyframes');
    assert.ok(await completedVideo.evaluate(video=>video.isConnected),'Queuing another job preserves the completed video player');
    await page.locator('#videoResults .video-result').first().getByRole('button',{name:'取消任务'}).click();
    await page.waitForFunction(()=>document.querySelector('#videoResults .video-result p').textContent==='已取消');
    assert.deepEqual(queueActions.slice(-2),[['queue',{delete:[manual.at(-1).prompt_id]}],['interrupt',{prompt_id:manual.at(-1).prompt_id}]]);
    const count=prepared.length;
    pendingOverrides={action:'configure',video:{mode:'frames',first_frame:'video-input/chat-original.png',last_frame:'video-input/chat-original.png',width:768,height:992,duration:5,audio:false,turbo:true,prompt:'A chair rocks gently.'}};
    await page.locator('[data-nav="ai"]').click();await page.locator('[data-action="new"]').click();
    await page.locator('.agent-compose > textarea').fill('用聊天图片设置首尾帧');await page.locator('[data-action="start"]').click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    const configured=submissions.at(-1).result;
    assert.equal(configured.workflows,undefined,'Configuring never builds or submits a workflow');
    assert.equal(prepared.length,count);assert.equal(configured.settings.first_frame,configured.settings.last_frame);
    assert.equal(configured.settings.width,768);assert.equal(configured.settings.height,992);
    assert.equal(configured.settings.steps,8);assert.equal(configured.settings.cfg,1);assert.equal(configured.settings.audio,false);
    assert.equal(configured.settings.actual_duration,124/24);assert.equal(configured.settings.last_frame_time,123/24);
    assert.equal(manual.length,2,'Configuration does not queue a sample or another video');
    pendingOverrides={auto_submit:false};
    await page.locator('[data-action="new"]').click();await page.locator('.agent-compose > textarea').fill('查看视频设置');await page.locator('[data-action="start"]').click();
    await page.waitForSelector('.agent-pending button');await page.getByRole('button',{name:'提交设置',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    assert.equal(submissions.at(-1).result.workflows,undefined,'Reviewing the editor submits settings only');
    assert.equal(prepared.length,count);
    pendingOverrides={prompt:'A chair rocks gently.'};
    await page.locator('[data-action="new"]').click();await page.locator('.agent-compose > textarea').fill('现在按这些设置生成');await page.locator('[data-action="start"]').click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    const applied=submissions.at(-1).result.workflows[0].settings;
    assert.equal(applied.first_frame,applied.last_frame);assert.equal(applied.width,768);assert.equal(applied.height,992);assert.equal(applied.steps,8);assert.equal(applied.audio,false);
    assert.equal(prepared.length,count+1,'The separate generation call builds exactly one workflow');
    await page.locator('[data-nav="video"]').click();
    if(process.env.STUDIO_VIDEO_PREVIEW){
      await page.locator('#videoPreview video').evaluate(async video=>{await video.play();await new Promise(resolve=>setTimeout(resolve,250));video.pause();});
      await page.waitForFunction(()=>document.querySelector('#videoResults video').readyState>=2);
    }
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.resolve(__dirname,'../../../output/video-studio-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile has no horizontal overflow');
    assert.ok(await page.locator('#videoPreview').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'Video player fits the mobile screen');
    assert.ok(await page.locator('#videoPreview video').evaluate(video=>Math.abs(video.getBoundingClientRect().height-video.parentElement.clientHeight)<2),'The player and controls fit the preview height');
    assert.equal(await page.locator('[data-nav="video"]').isVisible(),true);
    await page.screenshot({path:path.resolve(__dirname,'../../../output/video-studio-mobile.png')});
    assert.deepEqual(errors,[]);console.log('PASS: video UI, uploads, mode isolation, editor AI, playable results, reload and mobile layout');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
