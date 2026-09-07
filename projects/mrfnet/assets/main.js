/* ============================================================
   MRFNet project page — interactive modules
   ============================================================ */
'use strict';

/* ---------------- shared helpers ---------------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const DPR=()=>Math.min(window.devicePixelRatio||1,2);
function fitCanvas(cv,hCss){
  const w=cv.clientWidth||cv.parentElement.clientWidth, h=hCss;
  const d=DPR();
  cv.width=Math.round(w*d); cv.height=Math.round(h*d);
  cv.style.height=h+'px';
  const ctx=cv.getContext('2d');
  ctx.setTransform(d,0,0,d,0,0);
  return {ctx,w,h};
}

/* ============================================================
   §0 MOTIVATION — one virtual scene, five complementary references
   ============================================================ */
(function(){
  const target=$('#sim-target'), output=$('#sim-output');
  if(!target||!output) return;
  const refs=$$('.sim-ref');
  const status=$('#sim-status'), outputState=$('#sim-output-state'), outputNote=$('#sim-output-note');
  const selected=new Set();
  const specs=[
    {id:'1',color:'#b56b58',detail:'signboard lettering',focusZ:.24,patch:{x:.29,y:.445,w:.36,h:.14},view:{yaw:-.16,pitch:.02,zoom:1.04,dx:-.015,dy:.002,perspective:.78,light:{skyTop:'#dfe6e5',skyBottom:'#f1d8bd',wall:'#dfc3a1',wallAlt:'#c5a887',roof:'#a58768',ground:'#968b7c',window:'#d7dfd9',sign:'#d99a4d',signFrame:'#814d40',foliage:'#6d9a70',sun:'#ffd36d',glow:'rgba(255,211,109,.24)',wash:'rgba(238,147,76,.08)',shadow:'rgba(104,75,61,.16)'}}},
    {id:'2',color:'#3f77a8',detail:'left-angle windows',focusZ:.08,patch:{x:.115,y:.29,w:.22,h:.25},view:{yaw:-.30,pitch:-.015,zoom:1.03,dx:.018,dy:.004,perspective:.78,light:{skyTop:'#d4e2ea',skyBottom:'#d4e1e4',wall:'#b9c1bd',wallAlt:'#9ca8a6',roof:'#7d8787',ground:'#75848a',window:'#b7d5df',sign:'#c48d51',signFrame:'#66504a',foliage:'#558b77',sun:'#d8f2ff',glow:'rgba(180,230,255,.19)',wash:'rgba(76,144,186,.11)',shadow:'rgba(45,67,79,.2)'}}},
    {id:'3',color:'#8062a9',detail:'right-angle brickwork',focusZ:.02,patch:{x:.60,y:.23,w:.26,h:.24},view:{yaw:.28,pitch:.055,zoom:1.045,dx:-.012,dy:.015,perspective:.82,light:{skyTop:'#d5d8e2',skyBottom:'#e0d6d9',wall:'#c8bcc1',wallAlt:'#aa9aa0',roof:'#877b84',ground:'#7f8290',window:'#c8d0db',sign:'#c18e5d',signFrame:'#76504c',foliage:'#698a78',sun:'#f2e5ff',glow:'rgba(225,205,255,.18)',wash:'rgba(113,91,169,.12)',shadow:'rgba(72,58,83,.2)'}}},
    {id:'4',color:'#c27c20',detail:'low-angle lamp detail',focusZ:.20,patch:{x:.785,y:.32,w:.11,h:.31},view:{yaw:.22,pitch:-.12,zoom:1.055,dx:.025,dy:-.018,perspective:.86,light:{skyTop:'#e8e4d1',skyBottom:'#f4dcaa',wall:'#ead8ad',wallAlt:'#cfb77f',roof:'#b49c69',ground:'#9c977d',window:'#e4e8d0',sign:'#e1a04f',signFrame:'#87503e',foliage:'#78a46c',sun:'#ffe36e',glow:'rgba(255,219,83,.35)',wash:'rgba(255,210,86,.16)',shadow:'rgba(126,91,39,.1)'}}},
    {id:'5',color:'#4e8762',detail:'wide framing foliage',focusZ:.48,patch:{x:.66,y:.64,w:.23,h:.20},view:{yaw:-.21,pitch:.11,zoom:1.02,dx:-.025,dy:.025,perspective:.75,light:{skyTop:'#d7e5de',skyBottom:'#c7d9cd',wall:'#bbcab5',wallAlt:'#9daa91',roof:'#899274',ground:'#7e9288',window:'#c3d9d5',sign:'#c69a55',signFrame:'#6f5549',foliage:'#548a61',sun:'#d6f1c5',glow:'rgba(187,231,152,.22)',wash:'rgba(81,145,103,.12)',shadow:'rgba(55,81,64,.18)'}}}
  ];

  function setupCanvas(cv,aspect=9/16){
    const w=Math.max(220,Math.round(cv.getBoundingClientRect().width||cv.parentElement?.clientWidth||640));
    const h=Math.round(w*aspect), d=DPR();
    cv.width=Math.round(w*d); cv.height=Math.round(h*d); cv.style.height=h+'px';
    const ctx=cv.getContext('2d'); ctx.setTransform(d,0,0,d,0,0);
    return {ctx,w,h};
  }
  function rounded(ctx,x,y,w,h,r){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function windowBox(ctx,x,y,w,h){
    ctx.fillStyle='#d8e0df'; ctx.fillRect(x,y,w,h); ctx.fillStyle='#6f7e80'; ctx.fillRect(x,y,w,5);
    ctx.strokeStyle='#8a9694'; ctx.lineWidth=5; ctx.strokeRect(x+2.5,y+2.5,w-5,h-5);
    ctx.beginPath(); ctx.moveTo(x+w/2,y+4); ctx.lineTo(x+w/2,y+h-4); ctx.moveTo(x+4,y+h*.55); ctx.lineTo(x+w-4,y+h*.55); ctx.stroke();
  }
  function plant(ctx,x,y,s){
    ctx.strokeStyle='#5f6b58'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(x,y+42*s); ctx.lineTo(x+7*s,y); ctx.moveTo(x+7*s,y+42*s); ctx.lineTo(x+26*s,y+8*s); ctx.stroke();
    [[0,8],[8,0],[17,15],[28,4],[13,24]].forEach(([dx,dy])=>{ctx.fillStyle=dy%2?'#5c8a65':'#6d9a70';ctx.beginPath();ctx.ellipse(x+dx*s,y+dy*s,11*s,6*s,dy*.05,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#9b6d4e'; rounded(ctx,x-5*s,y+38*s,42*s,20*s,4*s); ctx.fill();
  }
  function drawBase(ctx,w,h){
    const s=Math.min(w/640,h/360), ox=(w-640*s)/2, oy=(h-360*s)/2;
    ctx.save(); ctx.translate(ox,oy); ctx.scale(s,s);
    const sky=ctx.createLinearGradient(0,0,0,360); sky.addColorStop(0,'#dfe9ed'); sky.addColorStop(1,'#f4e7d5');
    ctx.fillStyle=sky; ctx.fillRect(0,0,640,360);
    ctx.fillStyle='#f1c66e'; ctx.beginPath(); ctx.arc(92,62,28,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#7d8585'; ctx.fillRect(0,286,640,74);
    ctx.fillStyle='#cfc0aa'; ctx.fillRect(34,78,572,210);
    ctx.fillStyle='#b4a48f'; ctx.beginPath(); ctx.moveTo(18,78); ctx.lineTo(92,34); ctx.lineTo(574,34); ctx.lineTo(620,78); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#6a6870'; ctx.fillRect(24,72,592,14);
    ctx.strokeStyle='rgba(104,93,79,.28)'; ctx.lineWidth=2;
    for(let y=98;y<154;y+=15){ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(600,y);ctx.stroke();}
    for(let x=55;x<600;x+=48){ctx.beginPath();ctx.moveTo(x,88);ctx.lineTo(x,158);ctx.stroke();}
    windowBox(ctx,76,108,126,76); windowBox(ctx,443,101,132,82);
    ctx.fillStyle='#b8a58b'; ctx.fillRect(264,112,106,176); ctx.fillStyle='#8c7765'; ctx.fillRect(275,126,84,162);
    ctx.fillStyle='#b9c8c6'; ctx.fillRect(286,139,62,68); ctx.strokeStyle='#7e8c8c'; ctx.lineWidth=4; ctx.strokeRect(288,141,58,64);
    ctx.fillStyle='#824c40'; rounded(ctx,174,160,294,58,7); ctx.fill();
    ctx.fillStyle='#d8a25a'; rounded(ctx,184,168,274,42,4); ctx.fill();
    ctx.fillStyle='#654840'; ctx.font='700 29px Georgia,serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('ARCHIVE',321,190);
    ctx.strokeStyle='#e7c37c'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(198,203); ctx.lineTo(444,203); ctx.stroke();
    ctx.strokeStyle='#4e5b61'; ctx.lineWidth=7; ctx.beginPath(); ctx.moveTo(530,84); ctx.lineTo(530,265); ctx.stroke();
    ctx.fillStyle='#f2c45f'; ctx.beginPath(); ctx.arc(530,79,12,0,Math.PI*2); ctx.fill(); ctx.fillStyle='rgba(255,237,170,.6)'; ctx.beginPath(); ctx.arc(530,79,24,0,Math.PI*2); ctx.fill();
    plant(ctx,485,230,1.25); plant(ctx,554,242,.8);
    ctx.fillStyle='#4e595e'; ctx.fillRect(40,278,560,9); ctx.fillStyle='#d8c7ae'; ctx.fillRect(46,288,548,5);
    ctx.restore();
  }
  function projectPoint(x,y,z,view,w,h){
    const nx=(x-320)/320, ny=(y-180)/180, yaw=view.yaw||0, pitch=view.pitch||0;
    const cosY=Math.cos(yaw), sinY=Math.sin(yaw);
    const rotatedX=nx*cosY+z*sinY, rotatedZ=z*cosY-nx*sinY;
    const cosP=Math.cos(pitch), sinP=Math.sin(pitch);
    const rotatedY=ny*cosP+rotatedZ*sinP;
    const depth=1+rotatedZ*(view.perspective||.78), zoom=view.zoom||1;
    return {x:w/2+(rotatedX/depth)*w*.5*zoom+(view.dx||0)*w,y:h/2+(rotatedY/depth)*h*.5*zoom+(view.dy||0)*h};
  }
  function projectedPolygon(ctx,points,view,w,h,fill,stroke,lineWidth=1){
    const projected=points.map(([x,y,z=0])=>projectPoint(x,y,z,view,w,h));
    ctx.beginPath(); projected.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}
  }
  function projectedLine(ctx,x1,y1,x2,y2,z,view,w,h,stroke,lineWidth=1){
    const a=projectPoint(x1,y1,z,view,w,h), b=projectPoint(x2,y2,z,view,w,h);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();
  }
  function projectedRect(ctx,x,y,rw,rh,z,view,w,h,fill,stroke,lineWidth=1){
    projectedPolygon(ctx,[[x,y,z],[x+rw,y,z],[x+rw,y+rh,z],[x,y+rh,z]],view,w,h,fill,stroke,lineWidth);
  }
  function projectedEllipse(ctx,x,y,z,rx,ry,view,w,h,fill,alpha=1){
    const p=projectPoint(x,y,z,view,w,h), px=projectPoint(x+rx,y,z,view,w,h), py=projectPoint(x,y+ry,z,view,w,h);
    const sx=Math.max(1,Math.hypot(px.x-p.x,px.y-p.y)), sy=Math.max(1,Math.hypot(py.x-p.x,py.y-p.y));
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(px.y-p.y,px.x-p.x));ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(0,0,sx,sy,0,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function projectedWindow(ctx,x,y,rw,rh,z,view,w,h,light){
    projectedRect(ctx,x,y,rw,rh,z,view,w,h,light.window,'rgba(104,120,119,.72)',4);
    projectedLine(ctx,x+rw/2,y+4,x+rw/2,y+rh-4,z+.01,view,w,h,'rgba(119,133,132,.8)',4);
    projectedLine(ctx,x+4,y+rh*.55,x+rw-4,y+rh*.55,z+.01,view,w,h,'rgba(119,133,132,.8)',4);
  }
  function projectedPlant(ctx,x,y,scale,z,view,w,h,light){
    projectedLine(ctx,x,y+42*scale,x+7*scale,y,z,view,w,h,'#5f6b58',3*scale);
    projectedLine(ctx,x+7*scale,y+42*scale,x+26*scale,y+8*scale,z,view,w,h,'#5f6b58',3*scale);
    [[0,8],[8,0],[17,15],[28,4],[13,24]].forEach(([dx,dy],i)=>projectedEllipse(ctx,x+dx*scale,y+dy*scale,z+.02,11*scale,6*scale,view,w,h,i%2?'#5c8a65':light.foliage,.96));
    projectedRect(ctx,x-5*scale,y+38*scale,42*scale,20*scale,z+.03,view,w,h,'#9b6d4e');
  }
  function planeText(ctx,text,x,y,rw,rh,z,view,w,h,color,fontSize){
    const tl=projectPoint(x,y,z,view,w,h), tr=projectPoint(x+rw,y,z,view,w,h), bl=projectPoint(x,y+rh,z,view,w,h);
    ctx.save();ctx.setTransform((tr.x-tl.x)/rw,(tr.y-tl.y)/rw,(bl.x-tl.x)/rh,(bl.y-tl.y)/rh,tl.x,tl.y);ctx.fillStyle=color;ctx.font=`700 ${fontSize}px Georgia,serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,rw/2,rh/2);ctx.restore();
  }
  function drawPerspectiveBase(ctx,w,h,view){
    const light=view.light||{};
    ctx.clearRect(0,0,w,h);
    const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,light.skyTop||'#dfe9ed');sky.addColorStop(1,light.skyBottom||'#f4e7d5');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
    projectedEllipse(ctx,92,62,.02,28,28,view,w,h,light.sun||'#f2c45f',1); projectedEllipse(ctx,92,62,.02,48,48,view,w,h,light.glow||'rgba(255,237,170,.28)',.75);
    projectedPolygon(ctx,[[0,286,-.08],[640,286,-.08],[640,360,-.08],[0,360,-.08]],view,w,h,light.ground||'#7d8585');
    projectedRect(ctx,34,78,572,210,0,view,w,h,light.wall||'#cfc0aa');
    projectedPolygon(ctx,[[18,78,.03],[92,34,.10],[574,34,.10],[620,78,.03]],view,w,h,light.roof||'#b4a48f');
    projectedRect(ctx,24,72,592,14,.08,view,w,h,light.roofEdge||'#6a6870');
    for(let y=98;y<154;y+=15) projectedLine(ctx,40,y,600,y,.01,view,w,h,'rgba(104,93,79,.28)',2);
    for(let x=55;x<600;x+=48) projectedLine(ctx,x,88,x,158,.01,view,w,h,'rgba(104,93,79,.28)',2);
    projectedWindow(ctx,76,108,126,76,.08,view,w,h,light); projectedWindow(ctx,443,101,132,82,.08,view,w,h,light);
    projectedRect(ctx,264,112,106,176,.10,view,w,h,light.wallAlt||'#b8a58b'); projectedRect(ctx,275,126,84,162,.12,view,w,h,'#8c7765');
    projectedRect(ctx,286,139,62,68,.15,view,w,h,light.window||'#b9c8c6','rgba(126,140,140,.9)',4);
    projectedRect(ctx,174,160,294,58,.23,view,w,h,light.signFrame||'#824c40'); projectedRect(ctx,184,168,274,42,.25,view,w,h,light.sign||'#d8a25a');
    planeText(ctx,'ARCHIVE',184,168,274,42,.26,view,w,h,light.text||'#654840',29);
    projectedLine(ctx,198,203,444,203,.27,view,w,h,'rgba(255,225,145,.78)',2);
    projectedLine(ctx,530,84,530,265,.22,view,w,h,'#4e5b61',7);
    projectedEllipse(ctx,530,79,.24,12,12,view,w,h,light.sun||'#f2c45f',1); projectedEllipse(ctx,530,79,.24,24,24,view,w,h,light.glow||'rgba(255,237,170,.6)',.7);
    projectedPlant(ctx,485,230,1.25,.38,view,w,h,light); projectedPlant(ctx,554,242,.8,.42,view,w,h,light);
    projectedRect(ctx,40,278,560,9,-.01,view,w,h,'#4e595e'); projectedRect(ctx,46,288,548,5,-.01,view,w,h,'#d8c7ae');
    ctx.fillStyle=light.wash||'rgba(247,239,226,.08)';ctx.fillRect(0,0,w,h);
    projectedPolygon(ctx,[[34,78,.01],[264,78,.01],[264,288,.01],[34,288,.01]],view,w,h,light.shadow||'rgba(104,93,79,.08)');
  }
  function drawBlurred(ctx,w,h){
    ctx.clearRect(0,0,w,h);
    ctx.save();
    ctx.filter='blur(10px)';
    drawBase(ctx,w,h);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha=.18;
    ctx.filter='blur(3px)';
    ctx.translate(-7,1); drawBase(ctx,w,h);
    ctx.translate(14,-2); drawBase(ctx,w,h);
    ctx.restore();
    ctx.fillStyle='rgba(247,239,226,.18)'; ctx.fillRect(0,0,w,h);
  }
  function rectFor(p,w,h){return {x:p.x*w,y:p.y*h,w:p.w*w,h:p.h*h};}
  function drawOutput(ctx,w,h){
    drawBlurred(ctx,w,h);
    specs.forEach((spec,index)=>{
      const r=rectFor(spec.patch,w,h), active=selected.has(spec.id);
      if(active){ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();drawBase(ctx,w,h);ctx.restore();}
      ctx.save(); ctx.setLineDash(active?[]:[5,4]); ctx.strokeStyle=active?spec.color:'rgba(67,81,104,.46)'; ctx.lineWidth=active?2.5:1.4; ctx.strokeRect(r.x,r.y,r.w,r.h);
      ctx.setLineDash([]); ctx.fillStyle=active?spec.color:'rgba(67,81,104,.7)'; ctx.fillRect(r.x,r.y,26,18); ctx.fillStyle='#fff'; ctx.font='700 11px -apple-system,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(index+1),r.x+13,r.y+9); ctx.restore();
    });
  }
  function referenceCrop(spec){
    const center=projectPoint((spec.patch.x+spec.patch.w/2)*640,(spec.patch.y+spec.patch.h/2)*360,spec.focusZ||0,spec.view,640,360);
    const size=Math.min(.8,Math.max(spec.patch.w,spec.patch.h)*1.7);
    return {x:Math.max(0,Math.min(1-size,center.x/640-size/2)),y:Math.max(0,Math.min(1-size,center.y/360-size/2)),size};
  }
  function redraw(){
    const a=setupCanvas(target), b=setupCanvas(output); drawBlurred(a.ctx,a.w,a.h); drawOutput(b.ctx,b.w,b.h);
    const scene=document.createElement('canvas');scene.width=640;scene.height=360;const sceneCtx=scene.getContext('2d');
    refs.forEach((button,index)=>{
      const spec=specs[index], f=setupCanvas(button.querySelector('canvas'),1); drawPerspectiveBase(sceneCtx,640,360,spec.view);
      const crop=referenceCrop(spec); f.ctx.drawImage(scene,crop.x*640,crop.y*360,crop.size*640,crop.size*360,0,0,f.w,f.h);
    });
  }
  function update(){
    const chosen=specs.filter(spec=>selected.has(spec.id));
    status.textContent=`${chosen.length} / 5 references selected`;
    outputState.textContent=`${chosen.length} contribution${chosen.length===1?'':'s'}`;
    outputNote.textContent=chosen.length?chosen.map(spec=>`Ref ${spec.id} adds ${spec.detail}`).join(' · '):'Select a reference below to reveal the region it can help recover.';
    refs.forEach(button=>button.setAttribute('aria-pressed',String(selected.has(button.dataset.ref))));
    redraw();
  }
  refs.forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.ref;if(selected.has(id))selected.delete(id);else selected.add(id);update();}));
  $('#sim-all')?.addEventListener('click',()=>{specs.forEach(spec=>selected.add(spec.id));update();});
  $('#sim-reset')?.addEventListener('click',()=>{selected.clear();update();});
  window.addEventListener('resize',()=>requestAnimationFrame(redraw));
  if('ResizeObserver' in window) new ResizeObserver(()=>redraw()).observe(target.parentElement);
  update();
})();

/* ============================================================
   §1 REAL RESULT — zero vs four references comparison
   ============================================================ */
(function(){
  const stage=$('#recovery-stage'), range=$('#recovery-split'), after=$('#recovery-after'), divider=$('#recovery-divider'), right=$('#recovery-right');
  if(!stage||!range||!after||!divider||!right) return;
  const readout=$('#recovery-readout'), rightLabel=$('#recovery-right-label'), cap=$('#recovery-cap');
  const buttons={zero:$('#recovery-zero'),four:$('#recovery-four')};
  function update(){
    const p=Math.max(0,Math.min(100,Number(range.value)||0));
    after.style.clipPath=`inset(0 ${100-p}% 0 0)`; divider.style.left=p+'%';
    divider.setAttribute('aria-valuenow',String(p));
    readout.textContent='4 references ↔ 0 references'; rightLabel.textContent='0 references';
    buttons.zero?.classList.toggle('is-active',p===100);
    buttons.four?.classList.toggle('is-active',p===0);
    cap.innerHTML='<b>Real paper result.</b> Both sides use the same blurry frame. The four-reference restoration is on the left; moving right reveals the repository\'s zero-reference result, where the signboard lettering remains soft.';
  }
  function setFromPointer(clientX){
    const box=stage.getBoundingClientRect();
    range.value=String(Math.round(Math.max(0,Math.min(1,(clientX-box.left)/box.width))*100));
    update();
  }
  let dragging=false;
  stage.addEventListener('pointerdown',event=>{
    dragging=true; stage.classList.add('is-dragging'); stage.setPointerCapture?.(event.pointerId); setFromPointer(event.clientX); event.preventDefault();
  });
  stage.addEventListener('pointermove',event=>{if(dragging)setFromPointer(event.clientX);});
  stage.addEventListener('pointerup',event=>{dragging=false; stage.classList.remove('is-dragging'); stage.releasePointerCapture?.(event.pointerId);});
  stage.addEventListener('pointercancel',()=>{dragging=false;stage.classList.remove('is-dragging');});
  divider.addEventListener('keydown',event=>{
    const p=Number(range.value)||0;
    if(event.key==='ArrowLeft'||event.key==='ArrowDown'){range.value=String(Math.max(0,p-1));update();event.preventDefault();}
    if(event.key==='ArrowRight'||event.key==='ArrowUp'){range.value=String(Math.min(100,p+1));update();event.preventDefault();}
    if(event.key==='Home'){range.value='0';update();event.preventDefault();}
    if(event.key==='End'){range.value='100';update();event.preventDefault();}
  });
  range.addEventListener('input',update);
  buttons.zero?.addEventListener('click',()=>{range.value='100';update();});
  buttons.four?.addEventListener('click',()=>{range.value='0';update();});
  update();
})();

/* ---------------- misc: bib copy, reveal, nav ---------------- */
$('#bib-copy')?.addEventListener('click',function(){
  const t=$('#bibbox').innerText.replace(/^Copy\n?/,'');
  const done=()=>{this.textContent='Copied ✓';setTimeout(()=>this.textContent='Copy',1500);};
  if(navigator.clipboard?.writeText){navigator.clipboard.writeText(t).then(done,done);}
  else{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);
    ta.select();try{document.execCommand('copy')}catch(e){}ta.remove();done();}
});
$('#hero-bib')?.addEventListener('click',()=>location.hash='#cite');

const io=new IntersectionObserver(es=>es.forEach(e=>{
  if(e.isIntersecting){e.target.classList.add('vis');io.unobserve(e.target);}
}),{threshold:.2});
$$('.reveal').forEach(el=>io.observe(el));

const navIO=new IntersectionObserver(es=>es.forEach(e=>{
  const a=$(`nav.top a.item[href="#${e.target.id}"]`);
  if(a&&e.isIntersecting){$$('nav.top a.item').forEach(x=>x.classList.remove('on'));a.classList.add('on');}
}),{rootMargin:'-40% 0px -55% 0px'});
['why','demo','principle','cite'].forEach(id=>{
  const el=document.getElementById(id); if(el)navIO.observe(el);
});
