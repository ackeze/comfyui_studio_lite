const {chromium}=require('C:/Users/acke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../web');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],submissions=[],manual=[];
    let session=null,number=0,overrides={};
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),20)}close(){}};});
    await page.route('**/*',async route=>{
      const request=route.request(),p=new URL(request.url()).pathname;
      if(p.startsWith('/api/launcher/assets/'))return route.fulfill({path:path.join(root,p.replace('/api/launcher/',''))});
      if(p==='/launcher')return route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'});
      if(p==='/launcher/agent/sessions'&&request.method()==='POST'){
        const posted=request.postDataJSON();session={id:'editor-'+(++number),status:'waiting',events:[{type:'user',text:posted.text,message_index:1},{type:'tool',id:'generate-'+number,text:'generate_from_editor',status:'waiting',message_index:2}],pending:{id:'generate-'+number,feature:'generation',auto_submit:true,instruction:'正在按当前编辑器设置生成',...overrides}};
        return route.fulfill({json:session});
      }
      if(p.endsWith('/submit')){
        const submitted=request.postDataJSON();submissions.push(submitted);
        session={...session,status:'done',pending:null,events:[...session.events,{type:'assistant',text:submitted.result.error?submitted.result.message:'任务已入队',message_index:4,retryable:true}],jobs:(submitted.result.workflows||[]).map((item,i)=>({prompt_id:'job-'+number+'-'+i,status:'queued',settings:item.settings,images:[],tool_call_id:submitted.id}))};
        return route.fulfill({json:session});
      }
      if(p.endsWith('/fork')&&request.method()==='POST'){
        const posted=request.postDataJSON();assert.equal(posted.action,'retry');assert.equal(posted.message_index,4);
        const source=session;
        session={id:'editor-'+(++number),parent_id:source.id,status:'waiting',events:[{...source.events[0]},{type:'tool',id:'generate-'+number,text:'generate_from_editor',status:'waiting',message_index:2}],pending:{id:'generate-'+number,feature:'generation',auto_submit:true,...overrides}};
        return route.fulfill({json:session});
      }
      if(p==='/launcher/agent/sessions')return route.fulfill({json:{sessions:session?[{id:session.id,title:'编辑器生成'}]:[]}});
      if(p.startsWith('/launcher/agent/sessions/'))return route.fulfill({json:session});
      const models={checkpoints:['test.safetensors'],diffusion_models:['anima-base-v1.0.safetensors'],text_encoders:['qwen_3_06b_base.safetensors'],vae:['qwen_image_vae.safetensors'],loras:['user-style.safetensors','anima_pose_preview2.safetensors']};
      if(p.startsWith('/api/models/'))return route.fulfill({json:models[p.split('/').at(-1)]||[]});
      if(p.endsWith('/KSampler'))return route.fulfill({json:{KSampler:{input:{required:{sampler_name:[['euler','er_sde']],scheduler:[['simple']]}}}}});
      if(p.endsWith('/CLIPLoader'))return route.fulfill({json:{CLIPLoader:{input:{required:{type:[['stable_diffusion']]}}}}});
      for(const name of ['AnimaControlApply','CFGZeroStar','AnimaPoseRenderOfficial'])if(p.endsWith('/'+name))return route.fulfill({json:{[name]:{}}});
      if(p==='/api/upload/image')return route.fulfill({json:{name:'reference.png',subfolder:'',type:'input'}});
      if(p==='/api/prompt'){manual.push(request.postDataJSON());return route.fulfill({json:{prompt_id:'manual-job'}});}
      return route.fulfill({json:{}});
    });
    await page.goto('http://127.0.0.1:19880/launcher');
    await page.waitForFunction(()=>document.getElementById('unet').value==='anima-base-v1.0.safetensors');
    await page.evaluate(()=>{
      document.querySelector('[data-mode="unet"]').click();document.querySelector('[data-pose-mode="normal"]').click();
      for(const [id,value] of Object.entries({steps:41,cfg:5.5,seed:42,batchSize:2,width:768,height:1024})){
        const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      document.getElementById('addLora').click();
    });
    await page.locator('[data-lora-name]').selectOption('user-style.safetensors',{force:true});
    await page.locator('[data-lora-model]').evaluate(input=>{input.value='0.8';input.dispatchEvent(new Event('input',{bubbles:true}));});
    const generate=async text=>{
      if(number)await page.getByRole('button',{name:'新建会话',exact:true}).click();
      await page.locator('[data-nav="ai"]').click();
      await page.locator('.agent-compose > textarea').fill(text);
      const before=submissions.length;
      await page.locator('[data-action="start"]').click();
      await page.waitForFunction(text=>document.querySelector('.agent-panel').dataset.status==='done'&&document.querySelector('.agent-user .agent-message-content')?.textContent===text,text);
      assert.equal(submissions.length,before+1,'Editor operation is automatically submitted once');
      return submissions.at(-1).result;
    };
    overrides={prompt:'A city at sunset.',negative_prompt:'blurry'};
    const normal=await generate('按当前参数生成');
    assert.equal(normal.workflows.length,2);
    assert.equal(manual.length,0,'AI generation does not also enter the frontend queue');
    const item=normal.workflows[0];
    assert.equal(item.settings.unet,'anima-base-v1.0.safetensors');
    assert.equal(item.settings.loraStack[0].modelStr,.8);
    assert.equal(item.workflow['3'].inputs.steps,41);assert.equal(item.workflow['3'].inputs.cfg,5.5);
    assert.equal(item.workflow['6'].inputs.text,'A city at sunset.');
    assert.equal(item.workflow['7'].inputs.text,'blurry');
    assert.equal(item.settings.seed,'42');assert.equal(normal.workflows[1].settings.seed,'43');
    await page.reload();await page.locator('[data-nav="ai"]').click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    assert.equal(submissions.length,1,'Reload does not resubmit a completed editor operation');
    session={...session,status:'waiting',pending:{id:'restored-editor',feature:'generation',auto_submit:true}};
    await page.reload();await page.locator('[data-nav="ai"]').click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    assert.equal(submissions.length,2);
    assert.ok(submissions.at(-1).result.workflows,'Restored editor generation waits for settings/model initialization: '+JSON.stringify(submissions.at(-1).result));
    overrides={};
    await page.evaluate(()=>{document.querySelector('[data-pose-mode="pose"]').click();document.querySelector('[data-pose-template="sitting"]').click();});
    const pose=await generate('按我的骨架生成');
    assert.equal(pose.workflows[0].settings.pose.template,'sitting');
    assert.equal(pose.workflows[0].workflow['101'].class_type,'AnimaPoseRenderOfficial');
    assert.equal(pose.workflows[0].workflow['100'].inputs.lora_name,'anima_pose_preview2.safetensors');
    assert.ok(pose.workflows[0].workflow['101'].inputs.pose_json.length>100);
    await page.evaluate(()=>document.querySelector('[data-pose-mode="img2img"]').click());
    const missing=await generate('按参考图生成');
    assert.ok(missing.error);assert.ok(missing.message.includes('参考图'));
    await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const data=new DataTransfer();data.items.add(new File([blob],'reference.png',{type:'image/png'}));
      const input=document.getElementById('img2imgFile');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await page.waitForFunction(()=>!document.getElementById('img2imgPreview').hidden&&document.getElementById('img2imgInfo').textContent.includes('reference.png'));
    const img2img=await generate('用编辑器中的参考图生成');
    assert.equal(img2img.workflows[0].workflow['110'].class_type,'LoadImage');
    assert.equal(img2img.workflows[0].workflow['110'].inputs.image,'reference.png');
    assert.equal(img2img.workflows[0].settings.img2img.denoise,.45);
    await page.locator('[data-nav="studio"]').click();
    await page.locator('#generate').click();
    await page.waitForFunction(()=>document.querySelector('#dockStatus').textContent.includes('采样')||document.querySelector('#dockStatus').textContent.includes('提交')||document.querySelector('#dockStatus').textContent.includes('准备')||document.querySelector('#dockStatus').textContent.includes('生成'));
    await page.waitForTimeout(200);
    assert.equal(manual.length,1);
    assert.deepEqual(manual[0].prompt,img2img.workflows[0].workflow,'Manual and AI editor submissions use the same workflow');
    await page.locator('[data-nav="ai"]').click();
    const beforeRetry=submissions.length,oldId=session.id;
    await page.locator('.agent-assistant [data-message-action="retry"]').click();
    await page.waitForFunction(id=>document.querySelector('.agent-panel').dataset.status==='done'&&localStorage.getItem('comfy_agent_session')!==id,oldId);
    assert.equal(submissions.length,beforeRetry+1,'Clicking retry sends a new generation command once');
    assert.deepEqual(submissions.at(-1).result.workflows,img2img.workflows,'Retry preserves current editor settings and reference image');
    assert.equal(manual.length,1,'Retry does not also submit through the manual queue');
    await page.reload();await page.locator('[data-nav="ai"]').click();
    await page.waitForFunction(()=>document.querySelector('.agent-panel').dataset.status==='done');
    assert.equal(submissions.length,beforeRetry+1,'Reload after retry does not submit again');
    assert.deepEqual(errors,[]);
    console.log('PASS: Automatic editor submission, batching, settings/LoRA preservation, Pose, image-to-image, missing-input errors, reload deduplication and shared manual generation');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
