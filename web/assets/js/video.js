import { api, imageUrl } from './core.js';

const key = 'comfy_studio_video_v1';
const jobKey = 'comfy_studio_video_jobs_v1';
const defaults = {
  mode: 'text', prompt: '',
  width: 1344, height: 768, duration: 5, steps: 30, cfg: 3, seed: -1, audio: true, turbo: false,
  sampler: 'euler', scheduler: 'simple', reference_images: [],
};

export function initVideo(switchView) {
  const $ = id => document.getElementById(id);
  const fields = {mode:'videoMode',model:'videoModel',prompt:'videoPrompt',width:'videoWidth',height:'videoHeight',duration:'videoDuration',steps:'videoSteps',cfg:'videoCfg',seed:'videoSeed',audio:'videoAudio',turbo:'videoTurbo',sampler:'videoSampler',scheduler:'videoScheduler',clip:'videoClip',vae:'videoVae',audio_vae:'videoAudioVae',turbo_lora:'videoTurboLora'};
  const read = (name, fallback) => { try { return JSON.parse(localStorage.getItem(name)) || fallback; } catch { return fallback; } };
  const saved = read(key, {});
  if(saved.prompt==='integrated_multimodal_description: [Shot 1] A small paper boat floats across a sunlit pond. Gentle ripples spread behind it as the camera slowly tracks alongside, ending with the boat beneath a willow branch.\noverall_soundscape: Soft water ripples and distant birds.\nnon_diegetic_music: N/A')saved.prompt='';
  const inputs = {first_frame:saved.first_frame || '',last_frame:saved.last_frame || '',reference_images:saved.reference_images || []};
  let jobs = read(jobKey, []).slice(0, 24), models = [], uploads = 0, submitting = false;
  const errors = error => { $('videoError').textContent=error?.message || ''; };
  const collect = () => {
    const settings = {};
    for (const [name,id] of Object.entries(fields)) {
      const element=$(id);
      settings[name]=element.type==='checkbox'?element.checked:element.type==='number'?Number(element.value):element.value;
    }
    if(settings.mode==='frames') { settings.first_frame=inputs.first_frame;settings.last_frame=inputs.last_frame; }
    if(settings.mode==='reference') settings.reference_images=[...inputs.reference_images];
    return settings;
  };
  const save = () => localStorage.setItem(key, JSON.stringify({...collect(),...inputs}));
  const options = (id, list, preferred) => {
    const element=$(id);element.replaceChildren();
    for(const name of list) {
      const option=document.createElement('option');option.value=name;option.title=name;
      option.textContent=id==='videoModel'?`MiniMax H3 · ${name.toLowerCase().includes('ref2va')?'参考图':'文生 / 首尾帧'}${name.toLowerCase().includes('int8')?' · INT8':''}`:name;
      element.append(option);
    }
    if(list.includes(preferred)) element.value=preferred;
  };
  const modelOptions = preferred => options('videoModel',models.filter(name=>name.toLowerCase().includes($('videoMode').value==='reference'?'minimax_h3_ref2va':'minimax_h3_fl2va')),preferred);
  const timing = () => {
    const n=Math.ceil(Number($('videoDuration').value)*24),length=n+((5-n)%17+17)%17;
    $('videoTiming').textContent=`24 fps · 对齐后 ${length} 帧 / ${(length/24).toFixed(2)} 秒`;
    $('videoRatio').value=Array.from($('videoRatio').options).some(option=>option.value===`${$('videoWidth').value}x${$('videoHeight').value}`)?`${$('videoWidth').value}x${$('videoHeight').value}`:'custom';
    $('videoFrameInputs').hidden=$('videoMode').value!=='frames';
    $('videoReferenceInputs').hidden=$('videoMode').value!=='reference';
    $('videoTurbo').disabled=$('videoMode').value==='reference';
  };
  const uploadPreviews = () => {
    for(const [field,id] of [['first_frame','videoFirstPreview'],['last_frame','videoLastPreview']]){
      const img=$(id);img.hidden=!inputs[field];
      if(inputs[field])img.src=imageUrl({filename:inputs[field],type:'input'});else img.removeAttribute('src');
      img.closest('label').classList.toggle('has-image',Boolean(inputs[field]));
      img.closest('label').querySelector('button').hidden=!inputs[field];
    }
    $('videoReferencePreviews').replaceChildren();
    inputs.reference_images.forEach((name,index)=>{
      const card=document.createElement('div'),img=document.createElement('img'),button=document.createElement('button');
      img.src=imageUrl({filename:name,type:'input'});img.alt=`参考图 ${index+1}`;
      button.type='button';button.textContent='×';button.title='移除参考图';button.setAttribute('aria-label',`移除参考图 ${index+1}`);
      button.onclick=()=>{inputs.reference_images.splice(index,1);uploadPreviews();save();};
      card.append(img,button);$('videoReferencePreviews').append(card);
    });
  };
  const upload = async (files, field) => {
    if(uploads) { errors(new Error('请等待当前图片上传完成'));return; }
    const selected=Array.from(files);
    if(!selected.length)return;
    if(field==='reference_images'&&inputs.reference_images.length+selected.length>4){errors(new Error('最多使用 4 张参考图'));return;}
    uploads++;errors();$('videoGenerate').disabled=true;
    try {
      for(const file of selected.slice(0,field==='reference_images'?4:1)) {
        if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请上传 PNG、JPEG 或 WebP 图片');
        const body=new FormData();body.append('image',file);body.append('type','input');
        const response=await fetch('/api/upload/image',{method:'POST',body});
        if(!response.ok)throw new Error('参考图上传失败');
        const data=await response.json();if(!data.name)throw new Error('参考图上传失败');
        const name=data.subfolder?`${data.subfolder}/${data.name}`:data.name;
        if(field==='first_frame'){
          const bitmap=await createImageBitmap(file);
          const ratio=bitmap.width/bitmap.height;
          let width=ratio>=1?768*ratio:768,height=ratio>=1?768:768/ratio;
          const scale=Math.min(1,Math.sqrt((1344*768)/(width*height)));
          $('videoWidth').value=Math.max(256,Math.round(width*scale/32)*32);$('videoHeight').value=Math.max(256,Math.round(height*scale/32)*32);
          if(Number($('videoWidth').value)*Number($('videoHeight').value)>1344*768){
            const axis=Number($('videoWidth').value)>Number($('videoHeight').value)?'videoWidth':'videoHeight';$(axis).value=Number($(axis).value)-32;
          }
          bitmap.close();timing();
        }
        if(field==='reference_images')inputs.reference_images.push(name);else inputs[field]=name;
        uploadPreviews();save();
      }
    } catch(error){errors(error);} finally {uploads--;$('videoGenerate').disabled=submitting;}
  };
  for(const [id,field] of [['videoFirst','first_frame'],['videoLast','last_frame'],['videoReferences','reference_images']]) {
    const element=$(id);element.onchange=()=>{upload(element.files,field);element.value='';};
    const label=element.closest('label');label.ondragover=event=>event.preventDefault();label.ondrop=event=>{event.preventDefault();upload(event.dataTransfer.files,field);};
  }
  document.querySelectorAll('[data-video-clear]').forEach(button=>button.onclick=event=>{event.preventDefault();inputs[button.dataset.videoClear]='';uploadPreviews();save();});
  for(const [name,id] of Object.entries(fields)) {
    const value=saved[name]??defaults[name];if(value!==undefined){if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;}
    $(id).addEventListener('input',()=>{
      if(name==='mode'){
        modelOptions();
        if($('videoMode').value==='reference'&&$('videoTurbo').checked){$('videoTurbo').checked=false;$('videoSteps').value=30;$('videoCfg').value=3;}
      }
      if(name==='turbo'){$('videoSteps').value=$('videoTurbo').checked?8:30;$('videoCfg').value=$('videoTurbo').checked?1:3;}
      timing();save();
    });
  }
  $('videoRatio').onchange=()=>{
    const values=$('videoRatio').value.split('x').map(Number);
    if(values.length===2){$('videoWidth').value=values[0];$('videoHeight').value=values[1];timing();save();}
  };
  $('videoAskAi').onclick=()=>{switchView('ai');document.querySelector('.agent-compose > textarea')?.focus();};
  const showVideo = file => {
    const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=imageUrl(file);
    $('videoPreview').replaceChildren(video);
  };
  const resultNodes = new Map();
  const render = () => {
    const list=$('videoResults');
    if(!jobs.length){const empty=document.createElement('p');empty.className='video-help';empty.textContent='完成的视频会保存在这里。';list.replaceChildren(empty);return;}
    list.querySelector('.video-help')?.remove();
    const retained=new Set();
    for(const [index,job] of jobs.entries()){
      retained.add(job.prompt_id);
      let card=resultNodes.get(job.prompt_id);
      if(!card){card=document.createElement('article');card.className='surface video-result';resultNodes.set(job.prompt_id,card);}
      if(list.children[index]!==card)list.insertBefore(card,list.children[index] || null);
      const signature=JSON.stringify(job);
      if(card.dataset.signature===signature)continue;
      card.dataset.signature=signature;card.replaceChildren();
      const label=document.createElement('p');
      label.textContent=({queued:'排队中',running:'正在生成',cancelling:'正在取消',cancelled:'已取消',unknown:'提交状态待确认',failed:'生成失败',done:'已完成'})[job.status] || job.status;card.append(label);
      for(const file of job.videos || []){
        const video=document.createElement('video');video.src=imageUrl(file);video.controls=true;video.playsInline=true;video.preload='metadata';card.append(video);
        const actions=document.createElement('div'),open=document.createElement('button'),download=document.createElement('a');
        open.type='button';open.className='secondary-button';open.textContent='查看';open.onclick=()=>{showVideo(file);$('videoPreview').scrollIntoView({behavior:'smooth',block:'center'});};
        download.href=imageUrl(file);download.download=file.filename;download.textContent='下载 MP4';actions.append(open,download);card.append(actions);
      }
      const details=document.createElement('small');details.textContent=`${job.settings.width}×${job.settings.height} · ${Number(job.settings.duration).toFixed(2)} 秒 · 种子 ${job.settings.seed}`;card.append(details);
      if(job.error){const error=document.createElement('small');error.className='video-error';error.textContent=job.error;card.append(error);}
      if(['queued','running','unknown'].includes(job.status)){
        const cancel=document.createElement('button');cancel.className='secondary-button';cancel.type='button';cancel.textContent='取消任务';
        cancel.onclick=async()=>{
          cancel.disabled=true;
          try{
            await api.post('/queue',{delete:[job.prompt_id]});
            await api.post('/interrupt',{prompt_id:job.prompt_id});
            job.cancel_requested=true;job.status='cancelling';persistJobs();poll();
          }catch(error){errors(error);cancel.disabled=false;}
        };
        card.append(cancel);
      }
    }
    for(const [id,card] of resultNodes)if(!retained.has(id)){card.remove();resultNodes.delete(id);}
  };
  const ready = (async()=>{
    try {
      const categories=['diffusion_models','text_encoders','vae','loras'];
      const results=await Promise.all(categories.map(category=>api.get('/models/'+category)));
      models=results[0];modelOptions(saved.model);
      options('videoClip',results[1].filter(name=>name.toLowerCase().includes('minimax_h3')),saved.clip);
      options('videoVae',results[2].filter(name=>name.toLowerCase().includes('minimax_h3_video_vae')),saved.vae);
      options('videoAudioVae',results[2].filter(name=>name.toLowerCase().includes('minimax_h3_audio_vae')),saved.audio_vae);
      options('videoTurboLora',results[3].filter(name=>name.toLowerCase().includes('minimax_h3_fl2v_turbo')),saved.turbo_lora);
      const info=await api.get('/object_info/KSampler');
      options('videoSampler',info.KSampler.input.required.sampler_name[0],saved.sampler||'euler');
      options('videoScheduler',info.KSampler.input.required.scheduler[0],saved.scheduler||'simple');
    } catch(error){errors(error);throw error;}
  })();
  // Keep a restored AI editor request waiting for initialization without an unhandled rejection.
  ready.catch(()=>{});
  const configure = async (values={}) => {
    await ready;
    if(uploads)throw new Error('请等待参考图上传完成');
    if((values.mode || $('videoMode').value)==='reference'&&values.turbo===true)throw new Error('参考图模式不支持当前 Turbo LoRA');
    if(values.mode!==undefined){$('videoMode').value=values.mode;modelOptions(values.model);}
    if(values.turbo!==undefined){$('videoTurbo').checked=values.turbo;$('videoSteps').value=values.turbo?8:30;$('videoCfg').value=values.turbo?1:3;}
    if($('videoMode').value==='reference'&&$('videoTurbo').checked){$('videoTurbo').checked=false;$('videoSteps').value=30;$('videoCfg').value=3;}
    for(const [name,value] of Object.entries(values)){
      if(fields[name]){
        const element=$(fields[name]);
        if(element.tagName==='SELECT'&&!Array.from(element.options).some(option=>option.value===value))throw new Error(`视频设置 ${name} 不可用：${value}`);
        if(element.type==='checkbox')element.checked=value;else element.value=value;
      }else if(name==='first_frame'||name==='last_frame')inputs[name]=value;
      else if(name==='reference_images')inputs.reference_images=[...value];
    }
    timing();uploadPreviews();save();
    const settings=collect(),frames=Math.ceil(settings.duration*24),length=frames+((5-frames)%17+17)%17;
    return {settings:{...settings,length,fps:24,actual_duration:length/24,last_frame_time:(length-1)/24},available_models:Object.fromEntries(['model','clip','vae','audio_vae','turbo_lora'].map(name=>[name,Array.from($(fields[name]).options).map(option=>option.value)])),jobs:jobs.map(job=>({prompt_id:job.prompt_id,status:job.status,settings:{mode:job.settings.mode,model:job.settings.model,width:job.settings.width,height:job.settings.height,duration:job.settings.duration,prompt:job.settings.prompt?.slice(0,500)}}))};
  };
  const prepare = async (values={}) => {
    await configure(values);
    const settings=collect();
    if(!settings.prompt.trim())throw new Error('请填写本次视频描述，不会自动生成示例视频');
    if(!settings.model||!settings.clip||!settings.vae||!settings.audio_vae)throw new Error('缺少 H3 模型或配套编码器 / VAE，请检查本地文件');
    if(!Number.isFinite(settings.seed)||!Number.isInteger(settings.seed))throw new Error('种子须为整数');
    return api.post('/launcher/video/workflow',settings);
  };
  const persistJobs = () => {localStorage.setItem(jobKey,JSON.stringify(jobs));render();};
  let polling=false;
  const poll = async () => {
    if(polling)return;
    const active=jobs.filter(job=>['queued','running','unknown','cancelling'].includes(job.status));
    if(!active.length)return;
    polling=true;
    try {
      const queue=await api.get('/queue');
      for(const job of active){
        const record=(await api.get('/history/'+job.prompt_id))[job.prompt_id];
        if(record){
          job.status=record.status?.status_str==='error'?(job.cancel_requested?'cancelled':'failed'):'done';
          job.videos=Object.values(record.outputs||{}).flatMap(output=>output.images||[]).filter(file=>file.type==='output'&&/\.(mp4|webm|mov|mkv)$/i.test(file.filename));
          if(job.videos.length&&jobs[0]===job)showVideo(job.videos[0]);
          if(job.status==='failed')job.error='ComfyUI 视频生成失败，请查看运行日志';
        } else if(queue.queue_running?.some(entry=>entry[1]===job.prompt_id))job.status=job.cancel_requested?'cancelling':'running';
        else if(queue.queue_pending?.some(entry=>entry[1]===job.prompt_id))job.status=job.cancel_requested?'cancelling':'queued';
        else job.status=job.cancel_requested?'cancelled':'unknown';
      }
      persistJobs();
      $('videoStatus').textContent=jobs.some(job=>job.status==='running')?'正在生成视频…':jobs.some(job=>job.status==='queued')?'视频任务已入队':jobs[0]?.status==='done'?'视频生成完成':'任务状态见视频作品';
    } catch(error){$('videoStatus').textContent='连接暂不可用，恢复后继续查询任务';}
    finally {polling=false;}
  };
  window.addEventListener('comfy-video-cancelled',event=>{
    const job=jobs.find(job=>job.prompt_id===event.detail.prompt_id);
    if(!job||['done','failed','cancelled'].includes(job.status))return;
    job.cancel_requested=true;job.status=event.detail.status;persistJobs();poll();
  });
  $('videoGenerate').onclick=async()=>{
    if(submitting)return;submitting=true;$('videoGenerate').disabled=true;errors();
    let job;
    try {
      const item=await prepare();
      const prompt_id=crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
      job={prompt_id,settings:item.settings,status:'unknown',videos:[]};jobs=[job,...jobs].slice(0,24);persistJobs();
      const response=await fetch('/api/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:item.workflow,prompt_id})});
      const data=await response.json();
      if(!response.ok){job.status='failed';throw new Error(data.error?.message || data.error || '视频工作流提交失败');}
      job.prompt_id=data.prompt_id || prompt_id;job.status='queued';persistJobs();$('videoStatus').textContent='视频任务已入队';poll();
    } catch(error){errors(error);if(job){job.error=error.message;persistJobs();}}
    finally{submitting=false;$('videoGenerate').disabled=Boolean(uploads);}
  };
  timing();uploadPreviews();render();
  const latest=jobs.find(job=>job.videos?.length);if(latest)showVideo(latest.videos[0]);
  poll();setInterval(poll,4000);
  return {prepare,configure,applyPrompt:prompt=>{$('videoPrompt').value=prompt;save();}};
}
