import { renderMarkdown } from './markdown.js';

const messageIcons={
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  edit:'<path d="m14 5 5 5M4 20l4.5-1L20 7.5a2.1 2.1 0 0 0-3-3L5.5 16Z"/>',
  retry:'<path d="M4 10a8 8 0 1 1 .5 7M4 4v6h6"/>',
  branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M6 14h5a7 7 0 0 0 7-7"/>',
};

function messageButton(action,label){
  const button=document.createElement('button');button.type='button';button.dataset.messageAction=action;button.title=label;button.setAttribute('aria-label',label);
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+messageIcons[action]+'</svg>';
  return button;
}

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
  const artistPicker=document.createElement('dialog');artistPicker.className='agent-editor-dialog agent-artist-picker';artistPicker.setAttribute('aria-label','指定画师');
  const artistHeader=document.createElement('header');artistHeader.className='agent-editor-head';
  const artistTitle=document.createElement('h2');artistTitle.textContent='指定画师';
  const artistClose=document.createElement('button');artistClose.type='button';artistClose.textContent='×';artistClose.setAttribute('aria-label','关闭画师设置');artistClose.onclick=()=>artistPicker.close();artistHeader.append(artistTitle,artistClose);
  const artistInput=document.createElement('input');artistInput.type='text';artistInput.className='agent-search';artistInput.placeholder='输入或粘贴画师名称 / 标签';artistInput.setAttribute('aria-label','画师名称或标签');artistInput.maxLength=500;
  const artistHint=document.createElement('p');artistHint.textContent='使用 @画师名；多个画师用逗号分隔。自动补全 @、转小写，并将下划线转为空格。';
  const browse=document.createElement('button');browse.type='button';browse.className='secondary-button';browse.textContent='浏览画师 ↗';browse.onclick=()=>editor({feature:'artists'},()=>{});
  const choose=document.createElement('button');choose.type='button';choose.className='primary-button';choose.textContent='应用画师';choose.onclick=()=>{choices.artist=artistInput.value.split(/[,，;；\n]+/).map(name=>name.trim().replace(/^[@＠]+\s*/,'').replace(/_/g,' ').replace(/\s+/g,' ').trim().toLowerCase()).filter(Boolean).map(name=>'@'+name).join(', ');renderChoices();artistPicker.close();};
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='取消';cancel.onclick=()=>artistPicker.close();
  const artistFooter=document.createElement('footer');artistFooter.className='agent-editor-footer';
  const artistSpacer=document.createElement('span');artistSpacer.setAttribute('aria-hidden','true');artistFooter.append(browse,artistSpacer,cancel,choose);
  artistPicker.append(artistHeader,artistInput,artistHint,artistFooter);host.append(artistPicker);
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
  function statusText(session){return note.until>Date.now()?note.text:(({running:'正在处理任务…',waiting:'等待你调整并提交',done:'本轮完成',cancelled:'Agent 已停止',error:session.error})[session.status] || '');}
  let revision=0;
  const messageNodes=new Map();
  let messageSession='';
  const history=host.querySelector('.agent-session-list');
  const parentButton=document.createElement('button');parentButton.type='button';parentButton.textContent='返回原对话';parentButton.hidden=true;
  host.querySelector('.agent-top > div').prepend(parentButton);
  parentButton.onclick=()=>{if(current?.parent_id)selectSession(current.parent_id);};
  const retryButton=document.createElement('button');retryButton.type='button';retryButton.className='agent-retry';retryButton.textContent='重试回复';retryButton.hidden=true;status.after(retryButton);
  retryButton.onclick=()=>forkMessage('retry');
  let messageBusy=false;
  function selectSession(id){
    revision++;clearTimeout(timer);identity=id;current=null;localStorage.setItem('comfy_agent_session',identity);rendered='';pending.dataset.id='';pending.replaceChildren();poll();
    if(innerWidth<700)setHistory(false);
  }
  async function forkMessage(action,messageIndex,text){
    if(messageBusy||!identity)return;
    const selected=identity,version=revision;
    messageBusy=true;
    host.querySelector('[data-action="start"]').disabled=true;reset.disabled=true;
    host.querySelectorAll('[data-message-action]:not([data-message-action="copy"]),.agent-retry').forEach(button=>button.disabled=true);
    try{
      const session=await api('/'+selected+'/fork',{action,message_index:messageIndex,...(text===undefined?{}:{text})});
      if(identity!==selected||revision!==version){refreshHistory();return;}
      revision++;clearTimeout(timer);identity=session.id;localStorage.setItem('comfy_agent_session',identity);rendered='';streamFailed='';pending.dataset.id='';
      show(session);refreshHistory();poll();
      setNote(action==='retry'?(messageIndex===undefined?'正在恢复回复，保留已提交任务':'正在新分支重新执行这条请求'):action==='edit'?'已保存到新分支':'已创建对话分支');
      return session;
    }catch(error){setNote(error.message,8000);}
    finally{messageBusy=false;if(current)show(current);}
  }
  const messageEditor=document.createElement('dialog');messageEditor.className='agent-editor-dialog agent-message-editor';messageEditor.setAttribute('aria-label','编辑消息');
  messageEditor.innerHTML='<header class="agent-editor-head"><h2>编辑消息</h2><button type="button" aria-label="关闭消息编辑">×</button></header><p>保存后创建新分支，原对话会保留。消息附图也会保留。</p><textarea aria-label="编辑消息内容" maxlength="16000" rows="8"></textarea><footer class="agent-editor-footer"><span role="status"></span><button type="button" class="secondary-button" data-edit="cancel">取消</button><button type="button" class="primary-button" data-edit="save">保存并重新生成</button></footer>';
  host.append(messageEditor);
  let editing=null;
  const editText=messageEditor.querySelector('textarea'),editSave=messageEditor.querySelector('[data-edit="save"]'),editNote=messageEditor.querySelector('[role="status"]');
  const closeEdit=()=>messageEditor.close();
  messageEditor.querySelector('.agent-editor-head button').onclick=closeEdit;messageEditor.querySelector('[data-edit="cancel"]').onclick=closeEdit;
  messageEditor.addEventListener('close',()=>{editing=null;});
  function editMessage(event){
    editing={identity,index:event.message_index};editText.value=event.text || '';editNote.textContent='';editSave.disabled=false;
    editSave.textContent=event.type==='user'?'保存并重新生成':'保存到新分支';messageEditor.showModal();editText.focus();
  }
  editSave.onclick=async()=>{
    if(!editing||editing.identity!==identity){editNote.textContent='对话已切换，请重新打开消息';return;}
    if(!editText.value.trim()){editNote.textContent='消息不能为空';return;}
    editSave.disabled=true;
    const session=await forkMessage('edit',editing.index,editText.value);
    if(session)messageEditor.close();else editNote.textContent=note.text;
    editSave.disabled=false;
  };
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
        const button=document.createElement('button');button.type='button';button.textContent=(item.parent_id?'分支 · ':'')+item.title;button.title=button.textContent;button.classList.toggle('active',item.id===identity);
        button.onclick=()=>selectSession(item.id);history.append(button);
      }
      if(!history.childElementCount)history.textContent='还没有对话';
      filterHistory();
    }catch(error){setNote(error.message,8000);}
  }
  function setHistory(open){host.classList.toggle('history-hidden',!open);host.querySelector('[data-action="history"]').setAttribute('aria-expanded',String(open));host.querySelector('.agent-history').inert=!open;}
  host.querySelector('[data-action="history"]').onclick=()=>setHistory(host.classList.contains('history-hidden'));
  setHistory(innerWidth>=700);
  const submittedSnapshots=new Map();
  const editorSubmissions=new Set();
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
    status.textContent=statusText(session);
    parentButton.hidden=!session.parent_id;
    retryButton.hidden=!['error','cancelled'].includes(session.status);
    retryButton.disabled=messageBusy;
    host.querySelector('[data-action="start"]').disabled=messageBusy||['running','waiting'].includes(session.status);
    host.querySelector('[data-action="stop"]').hidden=!['running','waiting'].includes(session.status);
    const signature=JSON.stringify([session.events,session.jobs,session.status]);
    if(signature!==rendered){
      rendered=signature;const stick=events.scrollHeight-events.scrollTop-events.clientHeight<90;
      if(messageSession!==identity){messageNodes.clear();events.replaceChildren();messageSession=identity;}
      events.querySelector('.agent-welcome')?.remove();
      const retained=new Set();
      for(const [index,event] of (session.events || []).entries()){
        const key='event:'+index;retained.add(key);
        let card=messageNodes.get(key);
        if(!card){card=document.createElement('article');card.className='agent-event agent-'+event.type+' agent-arrive';card.addEventListener('animationend',()=>card.classList.remove('agent-arrive'),{once:true});messageNodes.set(key,card);}
        const eventSignature=JSON.stringify([event,session.status]);
        if(card.dataset.signature!==eventSignature){
          const expanded=card.querySelector('details')?.open;
          card.dataset.signature=eventSignature;card.dataset.state=event.status || '';card.replaceChildren();
          const title=document.createElement('strong');title.textContent=({user:'你',assistant:'创作助手',tool:'工具调用',submitted:'操作结果'})[event.type] || event.type;
          const text=document.createElement('div');text.className='agent-message-content';
          if(event.type==='assistant')renderMarkdown(text,event.text);else text.textContent=event.text;
          card.append(title,text);
          if(event.type==='user'){
            for(const [index,url] of (event.images || []).entries()){
              if(!url.startsWith('/view?')&&!url.startsWith('data:image/jpeg;base64,'))continue;
              const thumb=document.createElement('button'),img=document.createElement('img');
              thumb.type='button';thumb.className='agent-thumb agent-input-image';thumb.title='查看附图 '+(index+1);
              img.src=url;img.alt='附图 '+(index+1);img.loading='lazy';thumb.append(img);
              thumb.onclick=()=>openViewer(url,new URL(url,location.href).searchParams.get('filename') || 'chat-image-'+(index+1)+'.jpg');card.append(thumb);
            }
          }
          if(event.type==='assistant'||event.type==='user'){
            const actions=document.createElement('div');actions.className='agent-message-actions';
            const copy=messageButton('copy','复制');copy.onclick=async()=>{
              try{
                if(navigator.clipboard)await navigator.clipboard.writeText(event.text || '');
                else{
                  const area=document.createElement('textarea');area.value=event.text || '';area.className='agent-copy-buffer';host.append(area);area.select();
                  const copied=document.execCommand('copy');area.remove();if(!copied)throw new Error('复制失败');
                }
                setNote('已复制消息');
              }catch{setNote('复制失败，请选中文字复制');}
            };actions.append(copy);
            if(Number.isInteger(event.message_index)){
              for(const [action,label,callback] of [['edit','编辑',()=>editMessage(event)],['branch','创建分支',()=>forkMessage('branch',event.message_index)],...(event.type==='assistant'&&event.retryable?[['retry','重试',()=>forkMessage('retry',event.message_index)]]:[])]){
                const button=messageButton(action,label);
                button.title=action==='retry'?'在新分支重新执行这条请求，生成请求会重新提交':action==='edit'?'编辑消息并保存到新分支':'从这条消息创建分支';
                button.disabled=messageBusy||['running','waiting'].includes(session.status);button.onclick=callback;actions.append(button);
              }
            }
            card.append(actions);
          }
          if(event.type==='tool'){
            if(event.text==='cancel_generation'&&event.result?.cancel_requested)window.dispatchEvent(new CustomEvent('comfy-video-cancelled',{detail:event.result}));
            const detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');detail.open=Boolean(expanded);
            summary.textContent=({running:'执行中…',waiting:'等待确认',done:'已完成',error:'执行失败'})[event.status] || '调用记录';
            pre.textContent=JSON.stringify({参数:event.arguments,结果:event.result},null,2);detail.append(summary,pre);card.append(detail);
          }
        }
        if(card.parentElement!==events)events.append(card);
      }
      const eventList=session.events || [], jobList=session.jobs || [];
      const generateAt=[];
      for(let i=0;i<eventList.length;i++)if(eventList[i].type==='tool'&&['generate_image','generate_video','generate_from_editor'].includes(eventList[i].text))generateAt.push(i);
      for(const [index,job] of jobList.entries()){
        const key='job:'+job.prompt_id;retained.add(key);
        let card=messageNodes.get(key);if(!card){card=document.createElement('article');card.className='agent-event agent-generation';messageNodes.set(key,card);}
        const jobSignature=JSON.stringify(job);
        if(card.dataset.signature!==jobSignature){
          card.dataset.signature=jobSignature;card.replaceChildren();
          const label=document.createElement('p');label.className='agent-job-state';label.dataset.state=job.status;
          label.textContent=({queued:job.position?'排队中，前面还有 '+job.position+' 个任务':'已入队，等待开始',running:'正在生成…',cancelling:'正在取消指定任务…',cancelled:'任务已取消',unknown:'提交状态待确认，请勿重复生成',failed:'生成失败，请检查工具详情',done:'生成完成'})[job.status] || job.status;card.append(label);
          for(const file of job.images || []){
            const url='/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder || '',type:'output'});
            const thumb=document.createElement('button'),img=document.createElement('img');
            thumb.type='button';thumb.className='agent-thumb';thumb.title='点击查看大图';
            img.src=url;img.alt='Agent 生成结果';img.loading='lazy';
            thumb.append(img);thumb.onclick=()=>openViewer(url,file.filename);card.append(thumb);
          }
          for(const file of job.videos || []){
            const url='/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder || '',type:'output'});
            const video=document.createElement('video'),download=document.createElement('a');
            video.src=url;video.controls=true;video.playsInline=true;video.preload='metadata';video.className='agent-video';
            download.href=url;download.download=file.filename;download.textContent='下载视频';
            card.append(video,download);
          }
        }
        const linked=eventList.findIndex(event=>event.type==='tool'&&event.id===job.tool_call_id);
        const start=linked>=0?linked:(generateAt[index] ?? generateAt.at(-1) ?? eventList.length-1);
        let nextUser=eventList.length;
        for(let i=start+1;i<eventList.length;i++)if(eventList[i].type==='user'){nextUser=i;break;}
        const next=messageNodes.get('event:'+nextUser);
        if(next)events.insertBefore(card,next);
        else events.append(card);
      }
      for(const [key,node] of messageNodes){if(!retained.has(key)){node.remove();messageNodes.delete(key);}}
      if(!events.childElementCount)events.innerHTML='<div class="agent-welcome"><span>✦</span><h2>从一个想法开始</h2><p>对话、看图，或一起完成一次创作。</p><small>描述需求即可生图；缺模型或依赖也可以直接让我安装。</small></div>';
      if(stick)events.scrollTop=events.scrollHeight;
      latest.hidden=events.scrollHeight-events.scrollTop-events.clientHeight<120;
    }
    host.querySelectorAll('[data-message-action]:not([data-message-action="copy"])').forEach(button=>button.disabled=messageBusy||['running','waiting'].includes(session.status));
    reset.disabled=messageBusy||['running','waiting'].includes(session.status);
    if(pending.dataset.id!==(session.pending?.id || '')){
      pending.replaceChildren();pending.dataset.id=session.pending?.id || '';
      if(session.pending){
        const request=session.pending,download=request.feature==='download'||request.feature==='studio_install';
        const text=document.createElement('div');renderMarkdown(text,request.instruction || '请确认操作');pending.append(text);
        const actions=[];
        const submit=async()=>{const result=await capture(request);show(await api('/'+identity+'/submit',{id:request.id,result}));poll();};
        if(!download)actions.push(['打开编辑器',()=>editor(request,submit)]);
        actions.push([download?'确认下载':request.feature==='generation'?'提交生成':request.feature==='video'?'提交设置':'提交给 AI',async()=>{
          const result=download?{approved:true}:await capture(request);
          show(await api('/'+identity+'/submit',{id:request.id,result}));poll();
        }],['取消此操作',async()=>{show(await api('/'+identity+'/submit',{id:request.id,result:{cancelled:true}}));poll();}]);
        for(const [label,action] of actions){const b=document.createElement('button');b.className='secondary-button';b.type='button';b.textContent=label;b.onclick=async()=>{for(const button of pending.querySelectorAll('button'))button.disabled=true;try{await action();}catch(error){setNote(error.message,8000);}finally{for(const button of pending.querySelectorAll('button'))button.disabled=false;}};pending.append(b);}
      }
    }
    if(session.pending?.auto_submit){
      const request=session.pending,selected=identity,key=selected+'/'+request.id;
      if(!editorSubmissions.has(key)){
        editorSubmissions.add(key);
        pending.querySelectorAll('button').forEach(button=>button.disabled=true);
        (async()=>{
          let result;
          try{result=await capture(request);}
          catch(error){result={error:request.action==='configure'?'编辑器设置失败':'编辑器生成准备失败',message:error.message};}
          try{
            const next=await api('/'+selected+'/submit',{id:request.id,result});
            if(identity===selected){show(next);poll();}
          }catch(error){if(identity===selected)setNote(error.message,8000);}
          finally{if(identity===selected)pending.querySelectorAll('button').forEach(button=>button.disabled=false);}
        })();
      }
    }
  }
  const pendingStates=['queued','running','unknown','cancelling'];
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
      if(choices.artist)selected.push('指定画师标签：'+choices.artist+'。请将这些 @画师名 标签原样写入本次生成的正向 prompt，保留 @ 前缀，不要改写为 by 或仅描述风格。');
      if(selected.length)body.text+='\n\n'+selected.join('\n');
      if(attachments.length){
        const images=await Promise.all(attachments.map(async file=>{
          const preview=await encodeImage(file);
          const data=new FormData();data.append('image',file);data.append('type','input');data.append('subfolder','comfy_studio_agent');
          const response=await fetch('/api/upload/image',{method:'POST',body:data});
          if(!response.ok)throw new Error('聊天原图上传失败，请重试');
          const uploaded=await response.json();if(!uploaded.name)throw new Error('聊天原图上传失败');
          return {preview,name:uploaded.subfolder?uploaded.subfolder+'/'+uploaded.name:uploaded.name};
        }));
        body.images=images.map(image=>image.preview);body.image_files=images.map(image=>image.name);
      }
      const session=await api(identity && current&&!['running','waiting'].includes(current.status)?'/'+identity+'/messages':'',body);identity=session.id;localStorage.setItem('comfy_agent_session',identity);composer.value='';resizeComposer();imageInput.value='';attachments.length=0;syncAttachments();show(session);refreshHistory();poll();
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
    const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    let quality=.85,data=canvas.toDataURL('image/jpeg',quality);
    while(data.length>2_000_000&&quality>.5){quality-=.1;data=canvas.toDataURL('image/jpeg',quality);}
    return data;
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
