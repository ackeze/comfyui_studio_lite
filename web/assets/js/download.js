let nativeReady=false;
let appOrigin='';
let report=()=>{};
let sequence=0;
const pending=new Set();
const appOrigins=new Set(['http://localhost','https://localhost','capacitor://localhost']);

export function requestNativeDownload(url, filename){
  if(!nativeReady)return false;
  const source=new URL(url,location.href);
  if(source.origin!==location.origin||!['http:','https:'].includes(source.protocol))return false;
  send({url:source.href,filename});
  return true;
}

function send(file){
  const id=String(Date.now())+'-'+(++sequence);
  pending.add(id);
  window.parent.postMessage({type:'comfy-mobile-download',id,...file},appOrigin);
  report('请选择文件保存位置');
}

export function initDownloads(onStatus){
  report=onStatus;
  if(window.parent===window)return;
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||!appOrigins.has(event.origin))return;
    if(event.data?.type==='comfy-mobile-download-ready'){nativeReady=true;appOrigin=event.origin;}
    if(event.data?.type==='comfy-mobile-download-result'&&pending.delete(event.data.id)){
      if(event.data.error)report('保存失败：'+event.data.error,true);
      else report(event.data.cancelled?'已取消保存':'文件已保存');
    }
  });
  window.parent.postMessage({type:'comfy-mobile-download-check'},'*');
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[download]');
    if(!link||!nativeReady)return;
    if(requestNativeDownload(link.href,link.download)){event.preventDefault();return;}
    if(!link.href.startsWith('blob:')&&!link.href.startsWith('data:'))return;
    event.preventDefault();
    // Start fetching before callers revoke their temporary object URL.
    fetch(link.href).then(response=>{
      if(!response.ok)throw new Error('无法读取导出文件');
      return response.blob();
    }).then(blob=>{
      if(blob.size>32*1024*1024)throw new Error('本地导出文件超过 32 MiB');
      const reader=new FileReader();
      reader.onload=()=>send({filename:link.download,mime:blob.type,base64:String(reader.result).split(',')[1]});
      reader.onerror=()=>report('保存失败：无法读取导出文件',true);
      reader.readAsDataURL(blob);
    }).catch(error=>report('保存失败：'+error.message,true));
  },true);
}
