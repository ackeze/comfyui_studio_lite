import { renderMarkdown } from './markdown.js';

export function initAgent(editor, snapshot) {
  const host=document.createElement('section');host.className='agent-panel surface';
  host.innerHTML=`<header class="agent-top"><span>✦ 创作助手</span><div><button type="button" data-action="new">新建会话</button><button type="button" data-action="history" aria-expanded="true" aria-controls="agentHistory">对话目录</button></div></header><div class="agent-workspace"><div class="agent-main"><div class="agent-events" aria-live="polite"></div><div class="agent-pending"></div><div class="agent-compose"><textarea rows="2" aria-label="对话消息" placeholder="描述你的想法，或让我帮你操作工作台…"></textarea><div class="agent-files" hidden></div><div class="agent-compose-actions"><label class="agent-attach" tabindex="0">＋ 图片<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label><span class="agent-spacer"></span><button type="button" data-action="stop" hidden>停止</button><button type="button" class="primary-button" data-action="start" aria-label="发送消息">↑</button></div></div><p class="agent-status" role="status"></p></div><aside id="agentHistory" class="agent-history" aria-label="对话目录"><h3>最近对话</h3><div class="agent-session-list"></div></aside></div><div class="agent-drop" aria-hidden="true">松开即可附上图片</div><dialog class="agent-viewer" aria-label="图片查看"><div class="agent-viewer-bar"><span class="agent-viewer-name"></span><div><button type="button" data-viewer="out" aria-label="缩小">−</button><button type="button" data-viewer="in" aria-label="放大">＋</button><button type="button" data-viewer="reset" aria-label="重置">1:1</button><button type="button" data-viewer="download">下载</button><button type="button" data-viewer="close" aria-label="关闭">✕</button></div></div><div class="agent-viewer-stage"><img alt="生成结果大图"></div></dialog>`;
  document.querySelector('#aiView .page-head').after(host);
  const pageHead=document.querySelector('#aiView .page-head');
  host.querySelector('.agent-top > span').replaceWith(pageHead.querySelector('.ai-head-actions'));
  pageHead.remove();
  const reset=host.querySelector('[data-action="new"]');
  const composer=host.querySelector('textarea'),imageInput=host.querySelector('input[type=file]'),attachmentList=host.querySelector('.agent-files'),attachments=[];
  composer.before(attachmentList);
  composer.placeholder='随心输入，或拖入图片…';
  const attachmentUrls=[];
  const choices={camera:null,artist:''};
  const choiceList=document.createElement('div');choiceList.className='agent-choices';composer.before(choiceList);
  function renderChoices(){
    choiceList.replaceChildren();
    for(const [key,value] of Object.entries(choices)){
      if(!value)continue;
      const chip=document.createElement('button');chip.type='button';chip.textContent=(key==='camera'?'已指定机位':value)+' ×';chip.title='移除'+(key==='camera'?'机位':'画师');chip.onclick=()=>{choices[key]=key==='camera'?null:'';renderChoices();};choiceList.append(chip);
    }
  }
  const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.className='agent-compose-option';cameraButton.textContent='机位';
  cameraButton.onclick=async()=>{try{await editor({feature:'camera'},async()=>{const result=await snapshot({feature:'camera'});choices.camera={...result.settings.cameraControl,enabled:true};renderChoices();});}catch(error){setNote(error.message);}};
  const artistButton=document.createElement('button');artistButton.type='button';artistButton.className='agent-compose-option';artistButton.textContent='画师';
  host.querySelector('.agent-attach').after(cameraButton,artistButton);
  const artistPicker=document.createElement('dialog');artistPicker.className='agent-editor-dialog';artistPicker.setAttribute('aria-label','指定画师');
  const artistTitle=document.createElement('h3');artistTitle.textContent='指定画师';
  const artistInput=document.createElement('input');artistInput.type='text';artistInput.className='agent-search';artistInput.placeholder='输入或粘贴画师名称 / 标签';artistInput.setAttribute('aria-label','画师名称或标签');artistInput.maxLength=500;
  const artistHint=document.createElement('p');artistHint.textContent='可从画师参考页复制标签，再粘贴到这里。';
  const browse=document.createElement('button');browse.type='button';browse.textContent='浏览画师';browse.onclick=()=>editor({feature:'artists'},()=>{});
  const choose=document.createElement('button');choose.type='button';choose.className='primary-button';choose.textContent='应用画师';choose.onclick=()=>{choices.artist=artistInput.value.trim();renderChoices();artistPicker.close();};
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>artistPicker.close();
  artistPicker.append(artistTitle,artistInput,artistHint,browse,choose,cancel);host.append(artistPicker);
  artistButton.onclick=()=>{artistInput.value=choices.artist;artistPicker.showModal();artistInput.focus();};
  composer.rows=1;
  function resizeComposer(){composer.style.height='auto';composer.style.height=Math.min(140,Math.max(36,composer.scrollHeight))+'px';}
  composer.addEventListener('input',resizeComposer);
  const events=host.querySelector('.agent-events'), pending=host.querySelector('.agent-pending'), status=host.querySelector('.agent-status');
  host.querySelector('.agent-compose').before(status);
  const workspace=host.querySelector('.agent-workspace');
  function fitWorkspace(){
    if(!host.getClientRects().length)return;
    const viewport=window.visualViewport;
    let bottom=viewport?viewport.height+viewport.offsetTop:innerHeight;
    const nav=document.querySelector('.bottom-nav');
    if(innerWidth<1024&&nav?.getClientRects().length)bottom=Math.min(bottom,nav.getBoundingClientRect().top);
    workspace.style.height=Math.max(160,bottom-workspace.getBoundingClientRect().top-10)+'px';
  }
  new ResizeObserver(fitWorkspace).observe(host.querySelector('.agent-top'));
  window.addEventListener('resize',fitWorkspace);
  window.visualViewport?.addEventListener('resize',fitWorkspace);
  let identity=localStorage.getItem('comfy_agent_session') || '', timer, current, rendered='';
  let stream=null,streamIdentity='',streamFailed='';
  function syncStream(session){
    if(stream&&(streamIdentity!==identity||session.status!=='running')){stream.close();stream=null;}
    if(session.status!=='running'||stream||streamFailed===identity)return;
    const selected=identity;
    streamIdentity=selected;stream=new EventSource('/launcher/agent/sessions/'+selected+'/stream');
    stream.onmessage=event=>{if(identity===selected)show(JSON.parse(event.data));};
    stream.onerror=()=>{streamFailed=selected;stream?.close();stream=null;};
  }
  const note={text:'',until:0};
  function setNote(text,duration=5000){note.text=text;note.until=Date.now()+duration;status.textContent=text;}
  function statusText(state){return note.until>Date.now()?note.text:(({running:'正在处理任务…',waiting:'等待你调整并提交',done:'本轮完成',cancelled:'Agent 已停止',error:state.error})[state] || '');}
  let revision=0;
  const messageNodes=new Map();
  let messageSession='';
  const history=host.querySelector('.agent-session-list');
  const search=document.createElement('input');search.type='search';search.placeholder='搜索对话';search.className='agent-search';search.setAttribute('aria-label','搜索对话');history.before(search);
  function filterHistory(){for(const button of history.querySelectorAll('button'))button.hidden=!button.textContent.toLowerCase().includes(search.value.trim().toLowerCase());}
  search.addEventListener('input',filterHistory);
  const exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent='导出';exportButton.title='导出当前对话为 Markdown';host.querySelector('.agent-top > div').prepend(exportButton);
  exportButton.onclick=()=>{
    if(!current?.events?.length){setNote('当前还没有可导出的消息');return;}
    const content=current.events.filter(event=>['user','assistant'].includes(event.type)).map(event=>'## '+(event.type==='user'?'你':'创作助手')+'\n\n'+(event.text || '')).join('\n\n---\n\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='Comfy-Studio-chat.md';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const latest=document.createElement('button');latest.type='button';latest.className='agent-latest';latest.textContent='↓ 最新消息';latest.hidden=true;events.after(latest);
  events.addEventListener('scroll',()=>{latest.hidden=events.scrollHeight-events.scrollTop-events.clientHeight<120;});
  latest.onclick=()=>events.scrollTo({top:events.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  composer.addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.items || []).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();addFiles(files);}});
  async function refreshHistory(){
    try{
      const data=await api('');history.replaceChildren();
      for(const item of data.sessions || []){
        const button=document.createElement('button');button.type='button';button.textContent=item.title;button.title=item.title;button.classList.toggle('active',item.id===identity);
        button.onclick=()=>{revision++;clearTimeout(timer);identity=item.id;localStorage.setItem('comfy_agent_session',identity);rendered='';pending.dataset.id='';pending.replaceChildren();poll();if(innerWidth<700)setHistory(false);};history.append(button);
      }
      if(!history.childElementCount)history.textContent='还没有对话';
      filterHistory();
    }catch(error){setNote(error.message,8000);}
  }
  function setHistory(open){host.classList.toggle('history-hidden',!open);host.querySelector('[data-action="history"]').setAttribute('aria-expanded',String(open));host.querySelector('.agent-history').inert=!open;}
  host.querySelector('[data-action="history"]').onclick=()=>setHistory(host.classList.contains('history-hidden'));
  setHistory(innerWidth>=700);
  const submittedSnapshots=new Map();
  async function capture(request){
    const key=identity+'/'+request.id;
    if(!submittedSnapshots.has(key))submittedSnapshots.set(key,await snapshot(request));
    return submittedSnapshots.get(key);
  }
  async function api(path,body) {
    const response=await fetch('/launcher/agent/sessions'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error || `请求失败 ${response.status}`);return data;
  }
  function show(session) {
    current=session;
    syncStream(session);
    host.dataset.status=session.status;
    status.textContent=statusText(session.status);
    host.querySelector('[data-action="start"]').disabled=['running','waiting'].includes(session.status);
    host.querySelector('[data-action="stop"]').hidden=!['running','waiting'].includes(session.status);
    const signature=JSON.stringify([session.events,session.jobs]);
    if(signature!==rendered){
      rendered=signature;const stick=events.scrollHeight-events.scrollTop-events.clientHeight<90;
      if(messageSession!==identity){messageNodes.clear();events.replaceChildren();messageSession=identity;}
      events.querySelector('.agent-welcome')?.remove();
      const retained=new Set();
      for(const [index,event] of (session.events || []).entries()){
        const key='event:'+index;retained.add(key);
        let card=messageNodes.get(key);
        if(!card){card=document.createElement('article');card.className='agent-event agent-'+event.type+' agent-arrive';card.addEventListener('animationend',()=>card.classList.remove('agent-arrive'),{once:true});messageNodes.set(key,card);}
        const eventSignature=JSON.stringify(event);
        if(card.dataset.signature!==eventSignature){
          const expanded=card.querySelector('details')?.open;
          card.dataset.signature=eventSignature;card.dataset.state=event.status || '';card.replaceChildren();
          const title=document.createElement('strong');title.textContent=({user:'你',assistant:'创作助手',tool:'工具调用',submitted:'操作结果'})[event.type] || event.type;
          const text=document.createElement('div');text.className='agent-message-content';
          if(event.type==='assistant')renderMarkdown(text,event.text);else text.textContent=event.text;
          card.append(title,text);
          if(event.type==='assistant'||event.type==='user'){
            const actions=document.createElement('div');actions.className='agent-message-actions';
            const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.onclick=async()=>{try{await navigator.clipboard.writeText(event.text || '');setNote('已复制消息');}catch{setNote('复制失败，请选中文字复制');}};actions.append(copy);
            if(event.type==='user'){const reuse=document.createElement('button');reuse.type='button';reuse.textContent='再次编辑';reuse.onclick=()=>{composer.value=event.text || '';resizeComposer();composer.focus();};actions.append(reuse);}
            card.append(actions);
          }
          if(event.type==='tool'){
            const detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');detail.open=Boolean(expanded);
            summary.textContent=({running:'执行中…',waiting:'等待确认',done:'已完成',error:'执行失败'})[event.status] || '调用记录';
            pre.textContent=JSON.stringify({参数:event.arguments,结果:event.result},null,2);detail.append(summary,pre);card.append(detail);
          }
        }
        if(card.parentElement!==events)events.append(card);
      }
      for(const job of session.jobs || []){
        const key='job:'+job.prompt_id;retained.add(key);
        let card=messageNodes.get(key);if(!card){card=document.createElement('article');card.className='agent-event agent-generation';messageNodes.set(key,card);}
        const jobSignature=JSON.stringify(job);if(card.dataset.signature===jobSignature)continue;
        card.dataset.signature=jobSignature;card.replaceChildren();
        const label=document.createElement('p');label.className='agent-job-state';label.dataset.state=job.status;
        label.textContent=({queued:job.position?'排队中，前面还有 '+job.position+' 个任务':'已入队，等待开始',running:'正在生成…',unknown:'提交状态待确认，请勿重复生成',failed:'生成失败，请检查工具详情',done:'生成完成'})[job.status] || job.status;card.append(label);
        for(const file of job.images || []){
          const url='/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder || '',type:'output'});
          const thumb=document.createElement('button'),img=document.createElement('img');
          thumb.type='button';thumb.className='agent-thumb';thumb.title='点击查看大图';
          img.src=url;img.alt='Agent 生成结果';img.loading='lazy';
          thumb.append(img);thumb.onclick=()=>openViewer(url,file.filename);card.append(thumb);
        }
        if(card.parentElement!==events)events.append(card);
      }
      for(const [key,node] of messageNodes){if(!retained.has(key)){node.remove();messageNodes.delete(key);}}
      if(!events.childElementCount)events.innerHTML='<div class="agent-welcome"><span>✦</span><h2>从一个想法开始</h2><p>对话、看图，或一起完成一次创作。</p><small>描述需求，即可自动填写参数并生成。</small></div>';
      if(stick)events.scrollTop=events.scrollHeight;
      latest.hidden=events.scrollHeight-events.scrollTop-events.clientHeight<120;
    }
    reset.disabled=['running','waiting'].includes(session.status);
    if(pending.dataset.id!==(session.pending?.id || '')){
      pending.replaceChildren();pending.dataset.id=session.pending?.id || '';
      if(session.pending){
        const request=session.pending,download=request.feature==='download';
        const text=document.createElement('div');renderMarkdown(text,request.instruction || '请确认操作');pending.append(text);
        const actions=[];
        const submit=async()=>{const result=await capture(request);show(await api('/'+identity+'/submit',{id:request.id,result}));poll();};
        if(!download)actions.push(['打开编辑器',()=>editor(request,submit)]);
        actions.push([download?'确认下载':'提交给 AI',async()=>{
          const result=download?{approved:true}:await capture(request);
          show(await api('/'+identity+'/submit',{id:request.id,result}));poll();
        }],['取消此操作',async()=>{show(await api('/'+identity+'/submit',{id:request.id,result:{cancelled:true}}));poll();}]);
        for(const [label,action] of actions){const b=document.createElement('button');b.className='secondary-button';b.type='button';b.textContent=label;b.onclick=async()=>{for(const button of pending.querySelectorAll('button'))button.disabled=true;try{await action();}catch(error){setNote(error.message,8000);}finally{for(const button of pending.querySelectorAll('button'))button.disabled=false;}};pending.append(b);}
      }
    }
  }
  const pendingStates=['queued','running','unknown'];
  const hasPending=session=>Boolean(session?.jobs?.some(job=>pendingStates.includes(job.status)));
  async function poll(){
    clearTimeout(timer);
    if(!identity){refreshHistory();timer=setTimeout(poll,15000);return;}
    const selected=identity,version=revision;
    try{
      const session=await api('/'+selected+(hasPending(current)?'/outputs':''));
      if(selected!==identity||version!==revision)return;
      show(session);
      if(current.status==='running'||hasPending(current))timer=setTimeout(poll,1200);
      else{refreshHistory();timer=setTimeout(poll,8000);}
    }catch(error){
      if(version===revision)setNote(error.message,8000);
      timer=setTimeout(poll,8000);
    }
  }
  host.querySelector('[data-action="start"]').onclick=async()=>{
    const button=host.querySelector('[data-action="start"]');button.disabled=true;
    try{
      const body={text:host.querySelector('textarea').value,system_prompt:document.getElementById('systemPrompt').value};
      const selected=[];
      if(choices.camera)selected.push('指定机位：生成时将以下参数传入 generate_image 的 camera 字段：'+JSON.stringify(choices.camera));
      if(choices.artist)selected.push('指定画师：'+choices.artist+'。请将该画师风格用于本次生成提示词。');
      if(selected.length)body.text+='\n\n'+selected.join('\n');
      if(attachments.length)body.images=await Promise.all(attachments.map(encodeImage));
      const session=await api(identity && current?.status==='done'?'/'+identity+'/messages':'',body);identity=session.id;localStorage.setItem('comfy_agent_session',identity);composer.value='';resizeComposer();imageInput.value='';attachments.length=0;syncAttachments();show(session);refreshHistory();poll();
    }catch(error){setNote(error.message,8000);button.disabled=false;}
  };
  host.querySelector('[data-action="stop"]').onclick=async()=>{if(!identity)return;try{clearTimeout(timer);show(await api('/'+identity+'/stop',{}));}catch(error){setNote(error.message,8000);}};
  reset.onclick=()=>{revision++;clearTimeout(timer);identity='';submittedSnapshots.clear();localStorage.removeItem('comfy_agent_session');attachments.length=0;syncAttachments();show({status:'done',events:[],pending:null});refreshHistory();};
  host.querySelector('textarea').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();host.querySelector('[data-action="start"]').click();}};
  function syncAttachments(){
    attachmentUrls.splice(0).forEach(url=>URL.revokeObjectURL(url));
    attachmentList.hidden=!attachments.length;
    attachmentList.replaceChildren(...attachments.map((file,index)=>{
      const chip=document.createElement('span');chip.className='agent-file';
      const preview=document.createElement('img');preview.src=URL.createObjectURL(file);preview.alt=file.name;attachmentUrls.push(preview.src);chip.append(preview);
      const name=document.createElement('em');name.textContent=file.name;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+file.name);
      remove.onclick=()=>{attachments.splice(index,1);syncAttachments();};
      chip.append(name,remove);return chip;
    }));
  }
  function addFiles(list){
    let rejected=0;
    for(const file of list || []){
      if(!(file.type || '').startsWith('image/') || attachments.length>=4){rejected++;continue;}
      attachments.push(file);
    }
    syncAttachments();
    if(rejected)setNote('只支持图片，最多同时附 4 张，已忽略多余的 '+rejected+' 个文件',6000);
    else if(attachments.length)setNote('已附上 '+attachments.length+' 张图片，写上需求再发送',6000);
  }
  async function encodeImage(file){
    if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MB');
    const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,768/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    return canvas.toDataURL('image/jpeg',.85);
  }
  imageInput.onchange=event=>{addFiles(event.target.files);imageInput.value='';};
  host.querySelector('.agent-attach').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();imageInput.click();}};
  let dragDepth=0;
  const transferTypes=event=>Array.from(event.dataTransfer?.types || []);
  const draggingFiles=event=>transferTypes(event).includes('Files');
  const draggingImages=event=>draggingFiles(event) || transferTypes(event).includes('text/uri-list');
  const pageImageUrl=event=>{const value=(event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();if(!value)return '';const url=new URL(value,location.href);return url.origin===location.origin && url.pathname.endsWith('/view') ? url.href : '';};
  async function attachImageUrl(url){
    const response=await fetch(url);
    if(!response.ok)throw new Error('图片读取失败');
    const blob=await response.blob();
    if(!blob.type.startsWith('image/'))throw new Error('该地址不是图片');
    addFiles([new File([blob],new URL(url).searchParams.get('filename') || 'page-image.jpg',{type:blob.type})]);
  }
  host.addEventListener('dragenter',event=>{if(!draggingImages(event))return;event.preventDefault();dragDepth++;host.classList.add('agent-dragging');});
  host.addEventListener('dragover',event=>{if(!draggingImages(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';});
  host.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)host.classList.remove('agent-dragging');});
  host.addEventListener('drop',async event=>{
    if(!draggingImages(event))return;
    event.preventDefault();dragDepth=0;host.classList.remove('agent-dragging');
    if(draggingFiles(event))addFiles(event.dataTransfer.files);
    else try{await attachImageUrl(pageImageUrl(event));}catch(error){setNote(error.message,8000);}
    composer.focus();
  });
  for(const type of ['dragover','drop'])document.getElementById('aiView').addEventListener(type,event=>{if(draggingImages(event))event.preventDefault();});
  const viewer=host.querySelector('.agent-viewer'),viewerImage=viewer.querySelector('img'),viewerName=viewer.querySelector('.agent-viewer-name'),viewerStage=viewer.querySelector('.agent-viewer-stage');
  const view={scale:1,x:0,y:0,drag:null};
  function applyView(){viewerImage.style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.scale+')';}
  function zoom(factor){view.scale=Math.min(8,Math.max(.2,view.scale*factor));applyView();}
  function resetView(){view.scale=1;view.x=0;view.y=0;view.drag=null;applyView();}
  function openViewer(url,name){resetView();viewerName.textContent=name || '';viewerImage.src=url;viewer.showModal();}
  viewer.addEventListener('close',()=>{viewerImage.removeAttribute('src');view.drag=null;});
  viewer.querySelectorAll('[data-viewer]').forEach(button=>button.onclick=async()=>{
    const action=button.dataset.viewer;
    if(action==='in')zoom(1.25);
    else if(action==='out')zoom(.8);
    else if(action==='reset')resetView();
    else if(action==='close')viewer.close();
    else if(action==='download'){
      button.disabled=true;
      try{
        const response=await fetch(viewerImage.src);
        const blob=await response.blob();
        const link=document.createElement('a');
        link.href=URL.createObjectURL(blob);link.download=viewerName.textContent || 'comfyui.png';
        document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(link.href),1000);
      }catch(error){setNote('下载失败：'+error.message,6000);}
      finally{button.disabled=false;}
    }
  });
  viewerStage.addEventListener('pointerdown',event=>{view.drag={id:event.pointerId,x:event.clientX,y:event.clientY};viewerStage.setPointerCapture(event.pointerId);event.preventDefault();});
  viewerStage.addEventListener('pointermove',event=>{if(!view.drag||view.drag.id!==event.pointerId)return;view.x+=event.clientX-view.drag.x;view.y+=event.clientY-view.drag.y;view.drag.x=event.clientX;view.drag.y=event.clientY;applyView();});
  const endViewDrag=()=>{view.drag=null;};
  viewerStage.addEventListener('pointerup',endViewDrag);viewerStage.addEventListener('pointercancel',endViewDrag);
  viewerStage.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1.12:.9);},{passive:false});
  viewerStage.addEventListener('dblclick',()=>{if(view.scale>1.05)resetView();else{view.scale=2;applyView();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible' && identity)poll();});
  show({status:'done',events:[],pending:null});refreshHistory();poll();
}
