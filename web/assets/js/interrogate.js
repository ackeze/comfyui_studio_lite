const PRESETS = {
  deepseek: ['DeepSeek', 'https://api.deepseek.com', 'deepseek-v4-flash-vision-exp'],
  qwen: ['Qwen · 百炼北京', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-vl-plus'],
  gemini: ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', ''],
  custom: ['自定义兼容接口', '', ''],
};

export function initInterrogate(applyPrompt) {
  const $ = id => document.getElementById(id);
  document.querySelector('#reverseView .reverse-layout').innerHTML = `
    <section class="surface reverse-panel reverse-settings">
      <span class="eyebrow">CONNECTION</span><h2>图片理解服务</h2>
      <label class="field">服务预设<select id="reversePreset"></select></label>
      <label class="field">API 根地址<input id="reverseBase" type="url" placeholder="https://服务地址/v1"></label>
      <label class="field">API Key<input id="reverseKey" type="password" autocomplete="off" placeholder="仅在本次页面中使用，不保存"></label>
      <label class="field">图片理解模型<input id="reverseModel" list="reverseModelList" placeholder="获取列表后选择或手动输入"><datalist id="reverseModelList"></datalist></label>
      <button class="secondary-button" id="reverseModels" type="button">获取模型列表</button>
      <p class="pose-strategy-hint">预设不包含密钥。Qwen 密钥需匹配地域，也可改用控制台的工作空间专属地址。模型列表不保证支持图片。</p>
      <p class="pose-strategy-hint">地址与型号自动保存在当前浏览器；API Key 不保存。开始后图片将发送至所配置服务，并可能产生 API 费用。</p>
    </section>
    <section class="reverse-workspace">
      <div class="surface reverse-panel">
        <div class="reverse-heading"><div><span class="eyebrow">IMAGE TO PROMPT</span><h2>图文反推库</h2></div><span id="reverseCount"></span></div>
        <label class="reverse-upload">拖入一张或多张图片，或点击选择<input id="reverseFile" type="file" multiple accept="image/png,image/jpeg,image/webp"><small>PNG / JPEG / WebP · 单张不超过 20 MB · 每次最多 30 张</small></label>
        <div class="camera-toolbar"><button class="primary-button" id="reverseRun" type="button">开始批量反推</button><button id="reverseStop" type="button" disabled>停止后续任务</button><button id="reverseExport" type="button">导出图文 JSON</button><button id="reverseClear" type="button">清空记录</button></div>
        <p id="reverseStatus" role="status" aria-live="polite">图文自动保存在当前浏览器，刷新不会丢失。清理浏览器数据会删除记录。</p>
        <p id="reverseStorage" role="status"></p>
      </div>
      <div id="reverseResults"></div>
    </section>`;
  const dialog=document.createElement('dialog'); dialog.className='reverse-dialog';
  document.body.append(dialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  function detail(item) {
    dialog.replaceChildren();
    const close=document.createElement('button');close.className='reverse-close';close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.setAttribute('aria-label','关闭');close.onclick=()=>dialog.close();
    const image=document.createElement('img');image.src=item.image;image.alt=item.name;
    const panel=document.createElement('section');panel.className='reverse-detail-text';
    const title=document.createElement('h2');title.textContent=item.name;
    const area=document.createElement('textarea');area.value=item.prompt || '';area.rows=14;area.setAttribute('aria-label','完整提示词');
    const saved=document.createElement('p');saved.className='pose-strategy-hint';saved.setAttribute('role','status');saved.textContent='可以编辑提示词，保存到本机图文记录。';
    area.oninput=()=>{item.prompt=area.value;saved.textContent='有未保存的修改';};
    const persist=async()=>{saved.textContent='正在保存…';const ok=await save(item);saved.textContent=ok?'已保存到本机':'保存失败，请复制提示词备份后重试';if(ok)render();};
    area.onchange=persist;
    const actions=document.createElement('div');actions.className='camera-toolbar';
    for(const [label,action] of [
      ['保存修改',persist],
      ['复制',async()=>{try{await navigator.clipboard.writeText(area.value);status('已复制');}catch{status('复制失败，请手动复制');}}],
      ['填入创作页',()=>{if(area.value.trim()){applyPrompt(area.value.trim());dialog.close();}}]
    ]) {const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=action;if(label==='保存修改')b.className='primary-button';actions.append(b);}
    panel.append(title,area,saved,actions);dialog.append(close,image,panel);dialog.showModal();
    dialog.onclose=()=>{save(item);render();};
  }
  let items = [], busy = false, loading = false, stop = false, modelBusy = false;
  const config = () => ({api_base:$('reverseBase').value.trim(), api_key:$('reverseKey').value.trim(), model:$('reverseModel').value.trim()});
  const status = text => { $('reverseStatus').textContent = text; };
  let db;
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open('anima-interrogate', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', {keyPath:'id'});
    request.onsuccess = () => { db=request.result; resolve(); };
    request.onerror = () => reject(request.error);
  });
  async function storage(mode, action) {
    await ready;
    return new Promise((resolve, reject) => {
      const tx=db.transaction('records',mode), request=action(tx.objectStore('records'));
      tx.oncomplete=()=>resolve(request?.result);
      tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  }
  async function save(item) {
    try { await storage('readwrite', store=>store.put({...item})); return true; }
    catch { $('reverseStorage').textContent='本地保存失败（可能空间不足），请先导出图文结果，当前页面仍可继续使用。'; return false; }
  }
  function saveConfig() {
    try { localStorage.setItem('anima-reverse-config',JSON.stringify({preset:$('reversePreset').value, api_base:$('reverseBase').value, model:$('reverseModel').value})); }
    catch { $('reverseStorage').textContent='浏览器禁止保存配置。'; }
  }
  for (const [id, preset] of Object.entries(PRESETS)) {
    const option=document.createElement('option'); option.value=id; option.textContent=preset[0]; $('reversePreset').append(option);
  }
  function preset() {
    const selected=PRESETS[$('reversePreset').value];
    $('reverseBase').value=selected[1]; $('reverseModel').value=selected[2];
    $('reverseKey').value=''; $('reverseModelList').replaceChildren(); saveConfig();
  }
  $('reversePreset').onchange=preset;
  $('reverseBase').onchange=()=>{ $('reverseKey').value=''; $('reverseModelList').replaceChildren(); saveConfig(); };
  $('reverseModel').onchange=saveConfig;
  $('reverseBase').value=PRESETS.deepseek[1]; $('reverseModel').value=PRESETS.deepseek[2];
  function controls() {
    $('reverseRun').disabled=busy || loading || modelBusy;
    $('reverseModels').disabled=busy || modelBusy;
    $('reverseStop').disabled=!busy || stop;
    $('reverseClear').disabled=busy || loading;
    $('reverseFile').disabled=busy || loading;
    for (const id of ['reversePreset','reverseBase','reverseKey','reverseModel']) $(id).disabled=busy || modelBusy;
  }
  function render() {
    $('reverseCount').textContent=items.filter(i=>i.state==='done').length+' / '+items.length+' 已完成';
    $('reverseResults').replaceChildren();
    if (!items.length) {
      const empty=document.createElement('p'); empty.className='reverse-empty'; empty.textContent='添加图片，建立你的 Anima 提示词参考库。'; $('reverseResults').append(empty);
    }
    for (const item of items) {
      const card=document.createElement('article'); card.className='surface reverse-card';
      const preview=document.createElement('button');preview.type='button';preview.className='reverse-card-preview';preview.setAttribute('aria-label','查看 '+item.name);preview.onclick=()=>detail(item);
      const image=document.createElement('img'); image.src=item.image; image.alt=item.name; image.loading='lazy';
      const overlay=document.createElement('span');overlay.className='reverse-card-overlay';
      const summary=document.createElement('span');summary.textContent=item.prompt || ({waiting:'等待反推',running:'正在分析图片…',error:item.error || '反推失败'})[item.state] || '点击查看详情';
      overlay.append(summary);preview.append(image,overlay);
      const content=document.createElement('div');content.className='reverse-card-content';
      const title=document.createElement('strong');title.textContent=item.name;
      const info=document.createElement('small');info.textContent=({waiting:'待反推',running:'正在分析…',done:'已完成',error:'失败'})[item.state] + (item.model?' · '+item.model:'');
      const actions=document.createElement('div');actions.className='camera-toolbar';
      for(const [label,callback] of [
        [item.state==='done'?'重新反推':'重试',()=>run([item])],
        ['删除',async()=>{try{await storage('readwrite',s=>s.delete(item.id));items=items.filter(i=>i!==item);render();}catch{status('删除失败，请重试');}}]
      ]) {const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=busy || loading || modelBusy;b.onclick=callback;actions.append(b);}
      content.append(title,info,actions);card.append(preview,content);$('reverseResults').append(card);
    }
    controls();
  }
  async function api(action, settings, image) {
    const response=await fetch('/launcher/interrogate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,action,image})});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  $('reverseModels').onclick=async()=>{
    if (busy || modelBusy) return;
    modelBusy=true; render(); status('正在获取模型…');
    try {
      const data=await api('models',config());
      $('reverseModelList').replaceChildren(...data.models.map(id=>{const o=document.createElement('option');o.value=id;return o;}));
      status('已获取 '+data.models.length+' 个模型，请选择支持图片理解的型号');
    } catch(e) {status(e.message);} finally {modelBusy=false;render();}
  };
  async function run(batch) {
    if (busy || loading || modelBusy) return;
    const settings=config();
    if (!settings.api_base || !settings.model) {status('请先填写 API 根地址与图片理解模型');return;}
    if (!batch.length) {status('没有待处理图片；可在卡片中重新反推。');return;}
    busy=true;stop=false;saveConfig();
    let completed=0,failed=0;
    for (const item of batch) {
      if (stop) break;
      item.state='running';item.error='';render();status('正在处理 '+(completed+failed+1)+' / '+batch.length);
      await save(item);
      try {
        const data=await api('caption',settings,item.image);
        if (typeof data.prompt!=='string' || !data.prompt.trim()) throw new Error('API 未返回提示词');
        item.prompt=data.prompt;item.state='done';item.model=settings.model;
      } catch(e) {item.state='error';item.error=e.message;failed++;}
      if(item.state==='done')completed++;
      await save(item);
    }
    busy=false;status((stop?'已停止后续任务。':'批次结束。')+'成功 '+completed+' 张，失败 '+failed+' 张。');render();
  }
  $('reverseRun').onclick=()=>run(items.filter(i=>i.state==='waiting' || i.state==='error'));
  $('reverseStop').onclick=()=>{stop=true;controls();status('当前图片完成后停止，不再发送后续图片。');};
  async function addFiles(files) {
    if (busy || loading) {status('请等待当前任务完成后再添加图片');return;}
    files=Array.from(files);if(!files.length)return;
    loading=true;controls();let rejected=0;const failures=[];
    try {
      for (const file of files.slice(0,30)) {
        try {
          if (file.size>20*1024*1024) throw new Error('图片超过 20 MB');
          const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
          const mime=file.type && file.type!=='application/octet-stream' ? file.type : types[file.name.split('.').pop().toLowerCase()];
          if (!['image/png','image/jpeg','image/webp'].includes(mime)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
          let bitmap;
          try { bitmap=await createImageBitmap(file.slice(0,file.size,mime)); }
          catch { throw new Error('无法读取图片，请下载到手机后重试，或转换为 JPEG'); }
          const scale=Math.min(1,768/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
          const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
          const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
          const item={id,name:file.name,image:canvas.toDataURL('image/jpeg',.85),prompt:'',state:'waiting',created:Date.now()};
          items.push(item);await save(item);
        } catch(error) {rejected++;failures.push(`${file.name}：${error.message || '添加失败'}`);}
      }
      status(`已添加 ${Math.min(files.length,30)-rejected} 张，${rejected+Math.max(0,files.length-30)} 张未添加。${failures.slice(0,3).join('；')}${failures.length?'。':''}点击开始才会发送到 API。`);
    } finally {loading=false;$('reverseFile').value='';render();}
  }
  $('reverseFile').onchange=event=>addFiles(event.target.files);
  const dropzone=document.querySelector('#reverseView .reverse-upload');
  let dragDepth=0;
  dropzone.addEventListener('dragenter',event=>{
    event.preventDefault();dragDepth++;
    if (!busy && !loading) dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragover',event=>{
    event.preventDefault();
    event.dataTransfer.dropEffect=busy || loading?'none':'copy';
  });
  dropzone.addEventListener('dragleave',()=>{
    dragDepth=Math.max(0,dragDepth-1);
    if (!dragDepth) dropzone.classList.remove('is-dragging');
  });
  dropzone.addEventListener('drop',event=>{
    event.preventDefault();event.stopPropagation();
    dragDepth=0;dropzone.classList.remove('is-dragging');
    addFiles(event.dataTransfer.files);
  });
  // Prevent file drops outside the upload area from navigating away.
  for (const type of ['dragover','drop']) $('reverseView').addEventListener(type,event=>{
    if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
  });
  $('reverseClear').onclick=async()=>{
    if (!confirm('删除此浏览器中的所有反推图文记录？此操作不可恢复，建议先导出。')) return;
    try {await storage('readwrite',s=>s.clear());items=[];render();status('已清空本地反推记录');} catch {status('清空失败，请重试');}
  };
  $('reverseExport').onclick=()=>{
    const blob=new Blob([JSON.stringify({format:'anima-interrogate',version:1,items},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='anima-prompts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  window.addEventListener('beforeunload',event=>{if(busy || loading){event.preventDefault();event.returnValue='';}});
  // Restore only non-secret settings.
  try {
    const saved=JSON.parse(localStorage.getItem('anima-reverse-config') || 'null');
    if(saved) { $('reversePreset').value=PRESETS[saved.preset]?saved.preset:'custom';$('reverseBase').value=saved.api_base || '';$('reverseModel').value=saved.model || ''; }
  } catch {}
  loading=true;render();
  storage('readonly',s=>s.getAll()).then(records=>{
    items=records.sort((a,b)=>a.created-b.created).map(i=>({...i,state:i.state==='running'?'waiting':i.state}));
  }).catch(()=>{$('reverseStorage').textContent='无法读取本地存储，本次结果请及时导出。';}).finally(()=>{loading=false;render();});
}
