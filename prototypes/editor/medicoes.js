(async () => {
  if ((await (await fetch('/__run-flag', {cache:'no-store'})).text()) !== '1') return;
  const transcript = await (await fetch('/media/transcript.json', {cache:'no-store'})).json();
  const result = {agent:navigator.userAgent, started:new Date().toISOString(), screen:[], seeks:[], drags:[], frames:[], errors:[]};
  const state = () => ({focus:document.hasFocus(), visibility:document.visibilityState, width:innerWidth, height:innerHeight});
  const save = async () => fetch('/__run-results',{method:'POST',body:JSON.stringify(result)});
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const p95 = a => [...a].sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
  const event = (target,name,timeout=20000) => new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+name)),timeout);target.addEventListener(name,()=>{clearTimeout(timer);resolve()},{once:true})});
  async function media(name,cold) {
    v.pause(); let loaded=event(v,'loadedmetadata');
    v.src='/media/'+name+(cold?'?cold='+Date.now():''); v.load(); await loaded;
    $('source').value=name; result.screen.push({phase:'media '+name+' '+(cold?'cold':'warm'), ...state()});
  }
  async function oneSeek(target) {
    const at=performance.now(), snapshot=state();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('seek timeout '+target)),10000);
      v.requestVideoFrameCallback(function onframe(now,m){
        if(Math.abs(m.mediaTime-target)>.05){v.requestVideoFrameCallback(onframe);return}
        clearTimeout(timer);resolve({pedido:target,quadro:m.mediaTime,latenciaMs:performance.now()-at,erroMs:(m.mediaTime-target)*1000,...snapshot,...{focusEnd:document.hasFocus(),visibilityEnd:document.visibilityState}});
      });
      v.currentTime=target;
    });
  }
  const targets=Array.from({length:30},(_,i)=>((i*17)%30+.19+(i%7)*.071)*(7198/30));
  async function sweep(name,cache,record=true) {
    let entries=[];for(let i=0;i<targets.length;i++){ $('benchResult').textContent=`${name}: ${cache} ${i+1}/30`; entries.push(await oneSeek(targets[i])); }
    if(record){let lat=entries.map(e=>e.latenciaMs);result.seeks.push({name,cache,mean:mean(lat),p95:p95(lat),entries});await save()}
  }
  async function drift() {
    await media('proxy.mp4',false); v.muted=true; $('start').value=0;$('end').value=65;
    const seeked=event(v,'seeked');v.currentTime=0;await seeked;
    await v.play(); const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('60s playback timeout')),100000);function sample(now,m){const active=document.querySelector('#caption .word.active');result.frames.push({mediaTime:m.mediaTime,word:active?.textContent??null,index:active?Number(active.dataset.wordIndex):null,focus:document.hasFocus(),visibility:document.visibilityState,now});if(m.mediaTime<60)v.requestVideoFrameCallback(sample);else{clearTimeout(timer);resolve()}}v.requestVideoFrameCallback(sample)});await done;v.pause();
    let seen=new Set(), delays=[];for(const f of result.frames){if(f.index===null||seen.has(f.index)||!transcript[f.index])continue;seen.add(f.index);delays.push({index:f.index,word:f.word,expected:transcript[f.index].text,start:transcript[f.index].start,observed:f.mediaTime,delayMs:(f.mediaTime-transcript[f.index].start)*1000})};result.drift={entries:delays,mean:mean(delays.map(x=>x.delayMs)),p95:p95(delays.map(x=>x.delayMs)),count:delays.length};await save();
  }
  async function dragTest(name,kind){
    await media(name,false); const doneSeek=event(v,'seeked');v.currentTime=120;await doneSeek; $('start').value=120;$('end').value=180;$('zoom').value=40;draw();
    const old=rail.setPointerCapture;rail.setPointerCapture=()=>{};const rect=rail.getBoundingClientRect();let count=0,decoded=0,active=true,focusFrames=0,visibleFrames=0,first=performance.now();let before=state();
    function videoFrame(){if(!active)return;decoded++;v.requestVideoFrameCallback(videoFrame)}v.requestVideoFrameCallback(videoFrame);
    const target=kind==='trim'?$('left'):rail;
    rail.onpointerdown({target,pointerId:1,clientX:rect.left+rect.width*.3});
    await new Promise(resolve=>{function tick(now){count++;if(document.hasFocus())focusFrames++;if(document.visibilityState==='visible')visibleFrames++;let delta=(now-first)/10000;rail.onpointermove({clientX:rect.left+rect.width*(.3+.35*Math.min(delta,1)),pointerId:1});if(delta<1)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});
    active=false;rail.onpointerup();rail.setPointerCapture=old;let seconds=(performance.now()-first)/1000;result.drags.push({name,kind,seconds,rafFrames:count,rafFps:count/seconds,videoFrames:decoded,videoFps:decoded/seconds,focusFrames,visibleFrames,before,after:state(),method:'direct invocation of pointer handlers per rAF; synthetic events'});await save();
  }
  try {
    result.screen.push({phase:'initial',...state()});await save();
    for (const name of ['fonte.mp4','proxy.mp4']) {await media(name,true);await sweep(name,'primeira passagem URL nova no-store');await media(name,false);await sweep(name,'aquecimento',false);await sweep(name,'segunda passagem aquecida');}
    await drift();
    for(const name of ['fonte.mp4','proxy.mp4'])for(const kind of ['scrub','trim'])await dragTest(name,kind);
    result.finished=new Date().toISOString();$('benchResult').textContent='Medições concluídas';await save();
  } catch(e) { result.errors.push(String(e.stack||e));$('benchResult').textContent='Falha na medição: '+e;await save(); }
})();
