import { chromium } from '../lib/tools.mjs';
import fs from 'fs'; import { PNG } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const KNOWN=/Instance dropped in popErrorScope/;
const isKnown=t=>KNOWN.test(String(t));
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},88000);
const lum=(r,g,b)=>0.2126*r+0.7152*g+0.0722*b;
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
/* NON-FINITE VALUES ARE MISSING MEASUREMENTS, NOT DARK ONES. A snap where
   the chosen manta was off screen used to poison the median for all three
   snaps, and then a condition failed on a NaN rather than on the picture. */
const med=a=>{const s=a.filter(v=>typeof v==='number'&&isFinite(v)).sort((p,q)=>p-q);
  return s.length?s[s.length>>1]:NaN;};
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});

/* WORLD TO PIXEL IS CAMERA-RELATIVE. It used to be (x/view.w+0.5)*W, which
   is only right while the camera sits on the world origin, and greybox
   stage 1 gave the camera to the player: it now follows the leader. Every
   sample in this file was landing that far from what it meant to measure,
   which is why conditions 2, 3 and 4 failed at all three tiers on a build
   whose look nothing had touched. */
let REEF_ZONE_R=1e9;           // set per frame: arenaR minus the halo's depth
function analyse(path,view,M,cam={x:0,z:0}){
  const png=PNG.sync.read(fs.readFileSync(path));
  const {width:W,height:H,data:d}=png;
  const at=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=W||y>=H)return null;const i=(y*W+x)*4;return [d[i],d[i+1],d[i+2]];};
  const px=(x,z)=>[((x-cam.x)/view.w+0.5)*W,((z-cam.z)/view.h+0.5)*H];
  /* THE UI IS NOT WATER. The chip top left, and now the leaderboard top
     right: both are text drawn over the canvas and both read as bright
     pixels, which is not what "the brightest crests of the seabed" means. */
  const chip=(x,z)=>{const[a,c]=px(x,z);
    return (a<620&&c<210) || (a>W-380&&c<540);};
  const s1=(x,z)=>{if(chip(x,z))return null;const[a,c]=px(x,z);const v=at(a,c);return v?lum(...v):null;};
  /* CONDITION 2's WATER ONLY: the reef zone is left out, by the architect's
     ruling in v1.11 — its glow is a danger marker, not moonlight, and 7.2's
     condition 2 is about the seabed and the caustics. Condition 3 keeps
     using s1, so a manta in the halo is still held to twice its water. */
  const s2=(x,z)=>(Math.hypot(x,z)>REEF_ZONE_R?null:s1(x,z));
  const disc=(x,z,rW)=>{const out=[];const[cx,cy]=px(x,z);const rp=rW/view.w*W;
    for(let a=-rp;a<=rp;a+=Math.max(1,rp/3))for(let c=-rp;c<=rp;c+=Math.max(1,rp/3)){
      if(a*a+c*c>rp*rp)continue;const v=at(cx+a,cy+c);if(v)out.push(lum(...v));}
    return med(out);};
  const ring=(m,lo,hi)=>{const out=[];
    for(let a=0;a<Math.PI*2;a+=0.18)for(const rr of [lo,(lo+hi)/2,hi]){
      const x=m.x+Math.cos(a)*m.size*rr,z=m.z+Math.sin(a)*m.size*rr;
      if(M.some(o=>o.i!==m.i&&Math.hypot(o.x-x,o.z-z)<o.size*1.1))continue;
      const v=s1(x,z); if(v!==null)out.push(v);}
    return med(out);};
  /* The median over the WHOLE silhouette, which is what section 7.2 asks for
     and what a 0.25-wingspan disc at the animal's centre is not: that disc
     never sees the pale wingtips and catches only the back of the shoulder
     patches, so it reads a marked manta as darker than it looks. The outline
     is known exactly, so the silhouette can be sampled from the inside
     instead of hunted for in the picture. */
  const sil=(m,SH)=>{
    const lead=a=>{
      if(a<=0.10) return 0.055-0.030*Math.sin(Math.PI*a/0.10);
      if(a<0.12)  return 0.055+(0.08-0.055)*(a-0.10)/0.02;
      for(let i=0;i<SH.STATIONS.length-1;i++){const[a0,f0]=SH.STATIONS[i],[a1,f1]=SH.STATIONS[i+1];
        if(a<=a1) return f0+(f1-f0)*(a-a0)/(a1-a0);}
      return SH.STATIONS[SH.STATIONS.length-1][1];};
    const trail=a=>{
      if(a<=0.12) return SH.BODY_BACK+(0.43-SH.BODY_BACK)*a/0.12;
      for(let i=0;i<SH.STATIONS.length-1;i++){const[a0,,b0]=SH.STATIONS[i],[a1,,b1]=SH.STATIONS[i+1];
        if(a<=a1) return b0+(b1-b0)*(a-a0)/(a1-a0);}
      return SH.STATIONS[SH.STATIONS.length-1][2];};
    const out=[]; const ch=Math.cos(m.h), sh2=Math.sin(m.h);
    /* Sampled INSIDE the outline, not up to it. High tier multisamples, so
       every edge pixel is a blend of the animal and the water behind it — and
       for a near-black wild manta over lit seabed that blend is much brighter
       than the animal. Measuring it put the same manta at 0.58 of its
       surroundings at high and 0.17 at medium, which is the antialiasing being
       measured and not the body. 7.2 says "a wild manta's BODY". */
    for(let k=-24;k<=24;k++){
      const a=Math.abs(k)/24*0.44;
      const f=lead(a), b2=trail(a);
      for(let j=1;j<=5;j++){
        const lx=Math.sign(k||1)*a, lz=SH.HEAD_FRONT+f+(b2-f)*(j/6);
        /* object space -> world: heading 0 points -Z, same as the shader. */
        const wx=m.x+(lx*ch+lz*sh2)*m.size, wz=m.z+(lz*ch-lx*sh2)*m.size;
        const v=s1(wx,wz); if(v!==null)out.push(v);}}
    return {med:med(out), n:out.length};};
  return {at,px,s1,s2,disc,ring,sil,W,H};
}

async function sample(q,label,snaps){
  const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2});
  const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  const errs=[],off=[],bad4=[];
  p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,250));});
  p.on('pageerror',e=>errs.push('pageerror: '+(e.stack||e.message).slice(0,350)));
  p.on('request',r=>{const u=r.url(); if(!u.startsWith(O)&&!/^(data|about|blob):/.test(u))off.push(u);});
  p.on('response',r=>{if(r.status()>=400)bad4.push(r.status()+' '+r.url().replace(O,''));});
  await p.goto(O+'/lab/manta/'+q,{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
  await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('  (no ready)'));
  /* 3A: every crash or cut set piece, where and when (scene clock) it fired,
     so condition 4 can skip a snapshot with a flash beside its samples. The
     same object follow.js calls, so nothing is missed or added. */
  await p.evaluate(()=>{const L=window.__lab; window.__flashes=[];
    if(L&&L.cut&&L.cut.trigger){const f=L.cut.trigger;
      L.cut.trigger=function(at){ if(at) window.__flashes.push({x:at.x,z:at.z,t:L.simTime()}); return f.apply(this,arguments); };}}).catch(()=>{});
  if (RADIUS!==null) await p.evaluate(r=>{
    const {SPEC}=window.__lab.params ? {SPEC:null} : {SPEC:null};
    const i=[...document.querySelectorAll('#drawerList .sname')].findIndex(n=>n.textContent==='bloom radius');
    const inp=document.querySelectorAll('#drawerList input')[i];
    inp.value=r; inp.dispatchEvent(new Event('input',{bubbles:true}));}, RADIUS);
  /* A cap is only worth setting where the condition is measured, so the
     sweep's value can be put back through this same measurement. */
  if (process.env.MOON) await p.evaluate(v=>{const L=window.__lab;
    L.params.P.moonlight=v; if(L.params.U&&L.params.U.moonlight) L.params.U.moonlight.value=v;},
    parseFloat(process.env.MOON));
  /* SET="plankton=5,snow=4": any parameter, so a proposed slider cap can be
     put through the same measurement that has to hold at it. */
  if (process.env.SET) await p.evaluate(pairs=>{const L=window.__lab;
    for (const [k,v] of pairs) { L.params.P[k]=v; if(L.params.U&&L.params.U[k]) L.params.U[k].value=v; }},
    process.env.SET.split(',').map(x=>{const [k,v]=x.split('='); return [k, parseFloat(v)];}));
  /* A TRAIN TO MEASURE. The player starts alone and the wild mantas are
     thinly spread, so a 40-unit radius gathers about one follower every
     three seconds — too slow to have a tail to measure by the time the snaps
     are taken. This widens the game's OWN recruit radius for three seconds
     and puts it back, so what is measured is a real train built by the real
     rule, not a train posed by the harness. */
  await p.evaluate(async () => { const L=window.__lab;
    if (!window.__sim) return;
    /* 3A: with the wild count bug fixed the whole ocean holds 20 wild
       mantas, not 120, and the widened radius found almost nothing: a train
       of one, freshly recruited and still in its wild colour, is not a train
       end to measure. Ten ordinary wild mantas are moved into water around
       you first; the real rule then recruits them. */
    { const S=window.__sim, y=S.you;
      const amb=S.wild.filter(q=>q&&q.alive&&!q.loose&&!(q.sinking>0))
        .sort((a,b)=>Math.hypot(a.x-y.x,a.z-y.z)-Math.hypot(b.x-y.x,b.z-y.z));
      for(let k=0;k<10&&k<amb.length;k++){ const a=k*2.4, d=180+k*30; amb[k].x=y.x+Math.cos(a)*d; amb[k].z=y.z+Math.sin(a)*d; } }
    L.params.P.recruitR = 600;
    await new Promise(r => setTimeout(r, 3000));
    L.params.P.recruitR = 40; }).catch(()=>{});
  await p.waitForTimeout(5000);
  const shots=[];
  for(let k=0;k<snaps;k++){
    if(k) await p.waitForTimeout(2600);
    /* 3A: with the wild count bug fixed there are 20 wild mantas in the
       whole ocean, not 120, so one is rarely on screen. The three nearest
       ordinary wild mantas are moved into water beside you before each
       snapshot; from there they swim by the real rules (the hash is rebuilt
       every step, so they stay collectable). */
    await p.evaluate(()=>{const S=window.__sim,L=window.__lab; if(!S) return;
      const c=L.camera.position, w=L.view.w, h=L.view.h;
      const amb=S.wild.filter(q=>q&&q.alive&&!q.loose&&!(q.sinking>0))
        .sort((a,b)=>Math.hypot(a.x-c.x,a.z-c.z)-Math.hypot(b.x-c.x,b.z-c.z));
      const spots=[[-0.24,-0.28],[0.24,-0.20],[-0.22,0.18]];
      for(let k=0;k<3&&k<amb.length;k++){amb[k].x=c.x+spots[k][0]*w; amb[k].z=c.z+spots[k][1]*h;}
    }).catch(()=>{});
    /* Wait until there is a wild manta on screen to measure. Stage 2 put 300
       of them in the buffer, so this is about the picture settling, not about
       one named instance arriving. */
    await p.waitForFunction(()=>{const L=window.__lab,a=L.mantas.aPos,c=L.camera.position,b=L.mantas.WILD_BASE;
      for(let i=b;i<L.mantas.count;i++)
        if(Math.abs(a.getX(i)-c.x)<L.view.w/2*0.7&&Math.abs(a.getZ(i)-c.z)<L.view.h/2*0.7) return true;
      return false;},null,{timeout:14000}).catch(()=>{});
    await p.evaluate(()=>window.__lab.pause()).catch(()=>{});
    await p.waitForTimeout(220);
    const info=await p.evaluate(()=>{const L=window.__lab,m=L.mantas,aP=m.aPos,aH=m.aHead,aS=m.aSize;
      const M=[];for(let i=0;i<(m.drawn||m.count);i++)M.push({i,x:aP.getX(i),z:aP.getZ(i),h:aH.getX(i),size:aS.getX(i),lv:(()=>{const W=window.__sim&&window.__sim.wild,j=i-m.WILD_BASE;return !!(W&&j>=0&&i<(m.SPILL_BASE||m.count)&&W[j]&&W[j].alive&&W[j].sinking>0);})()});
      const bases={train:m.TRAIN_MAX,rival:m.RIVAL_BASE,wild:m.WILD_BASE,spill:(m.SPILL_BASE||m.count),len:window.__sim?window.__sim.you.followers.length:4,
                   arenaR:window.__sim?window.__sim.params.arenaR:1e9};
      const rows={};const dts=[...document.querySelectorAll('#rows dt')],dds=[...document.querySelectorAll('#rows dd')];
      dts.forEach((d,i)=>rows[d.textContent]=dds[i].textContent);
      /* Flashes still in the light memory (it fades to about 5% in 3.8 s,
         so 4 s), and the glowing debris a contact bursts out. */
      const now=L.simTime(), flashes=(window.__flashes||[]).filter(f=>now-f.t<4.0);
      const debris=window.__sim?window.__sim.wild.filter(w=>w&&w.alive&&w.loose&&w.glow>0).map(w=>({x:w.x,z:w.z})):[];
      return {M,bases,view:{w:L.view.w,h:L.view.h},rows,shape:L.mantas.shape,flashes,debris,
              cam:{x:L.camera.position.x,z:L.camera.position.z},
              overflow:document.documentElement.scrollWidth-innerWidth};});
    const path=(process.env.MANTA_OUT || '/tmp')+'/h-'+label+'-'+k+'.png';
    await p.screenshot({path});
    shots.push({info,path});
    await p.evaluate(()=>window.__lab.resume()).catch(()=>{});
  }
  /* CONDITION 2 IS ABOUT MOONLIGHT, NOT LIFE. 7.2: "the seabed's and the
     caustics' brightest crests stay below the dimmest manta's median", and
     sparkle crests "may be as bright as they like". Measuring the brightest
     pixel of ordinary water counts the wake, which is life, and at medium
     tier that read 103 against a manta at 93 — a failure of the wrong thing.
     So the crests are measured on a frame with the life taken out: deposit
     to zero and the light memory faded to nothing, which leaves moonlight,
     the caustics and the seabed and nothing else. */
  /* Which colour this run rolled, and condition 1 for it. Read from the
     instance buffer, not from pixels: it is a property of the tints. */
  let gain=null, mine=null, deal=null;
  try{
    const c=await p.evaluate(()=>{const m=window.__lab.mantas;
      if(!m.colours) return null;
      return {mine:m.colours.mine.key, gain:m.gainFor(m.colours.mine.key), seed:m.seed,
              rivals:m.colours.rivals.map(x=>x.key), wilds:m.colours.wilds.map(x=>x.key)};});
    if(c){ gain=c.gain; mine=c.mine; deal=c;
      console.log('   rolled: '+c.mine+'  \u00b7  seed '+c.seed+'  \u00b7  rivals '+c.rivals.join(', ')+
                  '  \u00b7  wild '+c.wilds.join(', '));}
  }catch(e){}
  let clean=null;
  try{
    await p.evaluate(async()=>{const L=window.__lab; L.pause();
      const P=L.params.P, U=L.params.U;
      /* EVERY SOURCE OF LIFE OFF, not just the deposit. The first version of
         this frame turned off the deposit and faded the memory and still had
         the wake blazing across it in sparkle, and a manta's bloom halo
         reaching past the exclusion radius — which is how the low tier read
         103 for "moonlight" while high read 56. What condition 2 names is
         the seabed's and the caustics' crests, so what is left here is
         moonlight, the caustics, the seabed and the grain.
         The cloud goes too: a cloud only ever DIMS the moon, so the crest
         worth measuring is the one with no cloud over it, and leaving it in
         swung this measurement 30% with whatever phase the frame caught. */
      /* longMemory belongs here too, and did not until Nathan set it to 0.05:
         the slow light memory holds a minute of trails, so zeroing the
         deposit and fading the fast memory left it painting the water. At 0
         the whole pass is skipped rather than multiplied out, so this clears
         it in one frame. It read 167 as "moonlight" at the low tier. */
      const OFF = ['stamp','sparkle','plankton','snow','ribbon','whiteness','bloomStrength','cloud','longMemory'];
      P.__save = {}; for (const k of OFF) { P.__save[k] = P[k]; P[k] = 0; if (U && U[k]) U[k].value = 0; }
      /* RULING 3 OF 2B PART THREE: both light memories CLEARED and every
         manta hidden, so no wake and no animal can count as moonlight. A
         fade of 0 empties the fast memory in one render. The slow memory
         only renders while longMemory is on, so its pass is forced to run
         with fade 0 while its contribution to the water stays at 0. */
      P.__save.fade = P.fade; P.fade = 0;
      if (L.lm && L.lm.clearStamps) L.lm.clearStamps();
      if (L.lmSlow) { L.lmSlow.clearStamps(); L.lmSlow.setFade(0); P.longMemory = 1; }
      L.mantas.mesh.visible = false; if (L.mantas.shadowMesh) L.mantas.shadowMesh.visible = false;
      /* UI is not water: with ten bots a crash can put the death beat's card —
         a big white number — in the middle of the frame this measures. The
         chip and the leaderboard were already excluded for the same reason. */
      for (const id of ['beat','board','len','labels','radar']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }   // 3J: the name labels are interface too
      for(let i=0;i<24;i++) L.step(1/60);
      if (L.lmSlow) { L.lmSlow.setFade(0.9994); P.longMemory = 0; }
      /* A capture shows the frame before the last render: render again. */
      L.step(0); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); L.step(0);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const info=await p.evaluate(()=>{const L=window.__lab,m=L.mantas,aP=m.aPos,aH=m.aHead,aS=m.aSize;
      const M=[];for(let i=0;i<(m.drawn||m.count);i++)M.push({i,x:aP.getX(i),z:aP.getZ(i),h:aH.getX(i),size:aS.getX(i),lv:(()=>{const W=window.__sim&&window.__sim.wild,j=i-m.WILD_BASE;return !!(W&&j>=0&&i<(m.SPILL_BASE||m.count)&&W[j]&&W[j].alive&&W[j].sinking>0);})()});
      const bases={train:m.TRAIN_MAX,rival:m.RIVAL_BASE,wild:m.WILD_BASE,spill:(m.SPILL_BASE||m.count),len:window.__sim?window.__sim.you.followers.length:4,
                   arenaR:window.__sim?window.__sim.params.arenaR:1e9};
      return {M,bases,view:{w:L.view.w,h:L.view.h},shape:L.mantas.shape,
              cam:{x:L.camera.position.x,z:L.camera.position.z}};});
    const path=(process.env.MANTA_OUT || '/tmp')+'/h-'+label+'-clean.png';
    await p.screenshot({path});
    clean={info,path};
    await p.evaluate(()=>{const L=window.__lab, P=L.params.P, U=L.params.U;
      L.mantas.mesh.visible = true; if (L.mantas.shadowMesh) L.mantas.shadowMesh.visible = true;
      for (const k of Object.keys(P.__save)) { P[k] = P.__save[k]; if (U && U[k]) U[k].value = P.__save[k]; }});
  }catch(e){ console.log('  (clean-water frame failed: '+String(e.message||e).slice(0,120)+')'); }
  await ctx.close();
  return {shots,errs,off,bad4,clean,gain,mine,deal};
}

const TIERS=(process.env.TIERS||'high,medium,low').split(',');
const RADIUS=process.env.RADIUS?parseFloat(process.env.RADIUS):null;
for (const [q,label] of TIERS.map(t=>['?tier='+t+(process.env.PIN||'&seed=20261002'),t])) {   // 3K: one seed, so every run deals the same colours and ocean
  console.log('\n=== tier '+label+' ===');
  const r=await sample(q,label,3);
  const rows=[];
  for (const {info,path} of r.shots){
    REEF_ZONE_R=((info.bases&&info.bases.arenaR)||1e9)-800;
    const M=info.M, cam=info.cam||{x:0,z:0}, an=analyse(path,info.view,M,cam);
    const B=info.bases||{train:5,rival:5,wild:14,len:4};
    const train=M[0];
    /* YOUR TRAIN IS NOW THE LEADER PLUS WHAT IT HAS RECRUITED, not five fixed
       slots, and the rest of the train block is parked outside the arena. */
    const TRAIN=M.slice(0, 1 + Math.max(0, Math.min(B.len, B.train-1)));
    /* On screen, and more than a wingspan inside the reef line: the ruling
       exempts only a manta pressed against the line from condition 3. */
    const inside=q=>Math.hypot(q.x,q.z)<((B.arenaR||1e9)-q.size);
    const onScreen=q=>q&&inside(q)&&Math.abs(q.x-cam.x)<info.view.w/2*0.8&&Math.abs(q.z-cam.z)<info.view.h/2*0.8;
    const central=list=>list.filter(onScreen)
      .sort((a,c)=>Math.hypot(a.x-cam.x,a.z-cam.z)-Math.hypot(c.x-cam.x,c.z-cam.z))[0]||null;
    /* The wild manta nearest the middle of the screen, out of 300. */
    /* Fully present only (2B part five): a sinking manta is drawn dimming
       and shrinking away, and condition 3 is not about something leaving. */
    const wild=central(M.slice(B.wild,B.spill||undefined).filter(q=>!q.lv))||M[B.wild];
    /* ANY rival that is on screen, not just the three leaders. The box these
       wrap inside travels with the camera and is larger than the view, so a
       named leader is often outside it, and measuring a manta that is not in
       the picture measures water and calls it a manta. */
    /* A spill slot (2B part five) is a bot's follower past its eighth. */
    const rival=central(M.slice(B.rival, B.wild).concat(B.spill?M.slice(B.spill):[]));
    /* The wake: behind each train member, along its own heading, at 2 to 5
       wingspans, skipping anything that is a manta. */
    /* The wake, behind each train member along its own heading. Two things
       this had wrong. The train is spaced 1.1 wingspans apart, so a sample two
       wingspans back lands beside ANOTHER member — and a manta at 222 throws a
       bloom halo well past the one-wingspan exclusion this used, so the sample
       measured the halo. Once, at medium tier, that put the "wake" median at
       92.6 against a rival's 90.3, which is the train being measured and not
       the water. Exclusion widened to 1.6 wingspans to clear the halo, and the
       samples run further back so there are still enough of them. */
    const wake=[]; let dropped=0;
    for(const m of TRAIN){const nx=-Math.sin(m.h),nz=-Math.cos(m.h);
      for(const d of [2,3,4,5,6,7,8]){const x=m.x-nx*m.size*d,z=m.z-nz*m.size*d;
        if(M.some(o=>Math.hypot(o.x-x,o.z-z)<o.size*1.6)){dropped++;continue;}
        const v=an.s1(x,z); if(v!==null)wake.push(v);}}
    /* Background: far from every manta and every wake sample. */
    const bg=[];
    for(let gx=-0.45;gx<=0.45;gx+=0.045)for(let gz=-0.45;gz<=0.45;gz+=0.045){
      const x=cam.x+gx*info.view.w,z=cam.z+gz*info.view.h;
      if(M.some(m=>Math.hypot(m.x-x,m.z-z)<m.size*3.5))continue;
      const v=an.s2(x,z); if(v!==null)bg.push(v);}
    /* The end of a train must never be ambiguous for a cut: the wake just
       behind the last follower has to stay dimmer than the follower itself. */
    const tail=TRAIN[TRAIN.length-1], tnx=-Math.sin(tail.h), tnz=-Math.cos(tail.h);
    const behind=[], pts4=[{x:tail.x,z:tail.z}];
    for(const dd of [1.2,1.5,1.8,2.1]){const x=tail.x-tnx*tail.size*dd,z=tail.z-tnz*tail.size*dd;
      if(M.some(o=>o.i!==tail.i&&Math.hypot(o.x-x,o.z-z)<o.size*1.0))continue;
      const v=an.s1(x,z); if(v!==null){behind.push(v); pts4.push({x,z});}}
    const tailLum=an.disc(tail.x,tail.z,tail.size*0.25);
    /* 3A: a crash or cut flash, or a contact burst, within two wingspans of
       the sampled points makes the snapshot unfair to condition 4: skip it. */
    const near4=list=>(list||[]).filter(f=>pts4.some(q=>Math.hypot(f.x-q.x,f.z-q.z)<=2*tail.size)).length;
    const skip4=near4(info.flashes)?'a crash or cut flash':near4(info.debris)?'a contact burst of glowing debris':'';
    /* How far the train's glow reaches: water at 1.5 and 2.5 wingspans out
       from the leader, clear of every manta, against the background. */
    const glowAt=rr=>{const out=[];
      for(let a=0;a<Math.PI*2;a+=0.25){const x=train.x+Math.cos(a)*train.size*rr,z=train.z+Math.sin(a)*train.size*rr;
        if(M.some(o=>Math.hypot(o.x-x,o.z-z)<o.size*1.0))continue;
        const v=an.s1(x,z); if(v!==null)out.push(v);}
      return med(out);};
    const glow15=glowAt(1.5), glow25=glowAt(2.5);
    let nearTrain=1e9; for(const o of TRAIN)nearTrain=Math.min(nearTrain,Math.hypot(o.x-wild.x,o.z-wild.z)/wild.size);
    const SH=info.shape;
    const silW=an.sil(wild,SH), silR=rival?an.sil(rival,SH):{med:NaN,n:0}, silT=an.sil(train,SH);
    const bgSorted=bg.slice().sort((a,c)=>a-c);
    const brightWater=bgSorted.length?bgSorted[Math.floor(bgSorted.length*0.995)]:NaN;
    rows.push({brightWater, glow15, glow25, samples:wake.length, dropped, endWake:med(behind), endManta:tailLum, skip4, nearTrain,
      discW:an.disc(wild.x,wild.z,wild.size*0.25), silN:silW.n,
      silR:silR.med, silT:silT.med,
      bg:med(bg), wake:med(wake), wild:silW.med,
      ringW:an.ring(wild,1.6,2.8), ringR:rival?an.ring(rival,1.6,2.8):NaN, ringT:an.ring(train,1.6,2.8),
      rival:silR.med,
      train:silT.med, rows:info.rows, ov:info.overflow});
  }
  const f=v=>(typeof v!=='number'||!isFinite(v))?'  n/a':v.toFixed(1).padStart(6);
  console.log('   snap   background    wake    wild   ring    rival    train   wild/ring');
  /* Is the unattached manta sitting on a bright patch of moonlight? The
     caustic web is the brightest thing in the water now, so a manta on a
     crest is the hardest case for condition 3 after "beside the train". */
  const bright=med(rows.map(r2=>r2.bg))*1.35;
  const where=r2=>{const lift=r2.ringW-r2.bg;
    if(r2.ringW>=bright && r2.nearTrain>=2.5 && lift<5) return 'on a bright caustic crest';
    if(r2.nearTrain<2.5)return 'beside the train';
    if(lift>=5)return 'inside a wake';
    return 'clear water';};
  rows.forEach((r2,i)=>console.log('     '+i+'   '+f(r2.bg)+' '+f(r2.wake)+' '+f(r2.wild)+' '+f(r2.ringW)+' '+f(r2.rival)+' '+f(r2.train)+'     '+(r2.wild/r2.ringW).toFixed(2)+'x   '+
    (r2.nearTrain).toFixed(1)+'W from the train  ·  '+where(r2)+
    '   [silhouette from '+r2.silN+' points; a 0.25W disc would read '+r2.discW.toFixed(1)+']'));
  console.log('   wake samples kept per snapshot: '+rows.map(r2=>r2.samples).join('/')+
    '   (dropped for being too near a manta: '+rows.map(r2=>r2.dropped).join('/')+')');
  const situations=[...new Set(rows.map(where))];
  const darkest=Math.min(...rows.map(r2=>r2.ringW)), brightest=Math.max(...rows.map(r2=>r2.ringW));
  console.log('   the wild manta\u2019s surroundings ranged '+darkest.toFixed(1)+' to '+brightest.toFixed(1));
  console.log('   situations covered: '+situations.join(', '));
  console.log('   the train\u2019s glow: water at 1.5 wingspans '+rows.map(r2=>r2.glow15.toFixed(0)).join('/')+
    ', at 2.5 '+rows.map(r2=>r2.glow25.toFixed(0)).join('/')+', background '+rows.map(r2=>r2.bg.toFixed(0)).join('/'));
  const skipped4=rows.filter(r2=>r2.skip4);
  if(skipped4.length) console.log('   condition 4 skipped '+skipped4.length+' of '+rows.length+' snapshots: '+skipped4.map(r2=>r2.skip4).join('; '));
  else console.log('   condition 4 skipped 0 of '+rows.length+' snapshots');
  const ends=rows.filter(r2=>!r2.skip4&&isFinite(r2.endWake)&&isFinite(r2.endManta));
  const worstEnd=ends.length?Math.min(...ends.map(r2=>r2.endManta-r2.endWake)):NaN;
  console.log('   train end: last follower '+rows.map(r2=>r2.endManta.toFixed(0)).join('/')+
    '   wake just behind it '+rows.map(r2=>r2.endWake.toFixed(0)).join('/')+'   worst margin '+worstEnd.toFixed(1));
  const M2=k=>med(rows.map(r2=>r2[k]));
  /* Inverted: the WORST case for a dark animal is the brightest it gets
     relative to its surroundings. */
  /* Every manta, not just the wild one: the train leader sits in its own
     bright wake and a rival in its own, which are the hard cases. */
  const ringPairs=[];
  for(const r2 of rows){ ringPairs.push(['a wild manta',r2.wild/r2.ringW],
    ['a rival',r2.rival/r2.ringR], ['your train',r2.train/r2.ringT]); }
  const usable=ringPairs.filter(([,v])=>isFinite(v));
  const worst=usable.reduce((a,c)=>c[1]<a[1]?c:a, usable[0]||['none',NaN]);
  const worstRing=worst[1], worstWho=worst[0];
  const brightestWater=(()=>{
    if(!r.clean) return Math.max(...rows.map(r2=>r2.brightWater));
    const cam=r.clean.info.cam||{x:0,z:0};
    REEF_ZONE_R=((r.clean.info.bases&&r.clean.info.bases.arenaR)||1e9)-800;
    const an=analyse(r.clean.path,r.clean.info.view,r.clean.info.M,cam);
    const vals=[];
    for(let gx=-0.45;gx<=0.45;gx+=0.03)for(let gz=-0.45;gz<=0.45;gz+=0.03){
      const x=cam.x+gx*r.clean.info.view.w,z=cam.z+gz*r.clean.info.view.h;
      if(r.clean.info.M.some(m=>Math.hypot(m.x-x,m.z-z)<m.size*2.2))continue;
      const v=an.s2(x,z); if(v!==null)vals.push(v);}
    vals.sort((a,c)=>a-c);
    return vals.length?vals[Math.floor(vals.length*0.995)]:NaN;})();
  const bestWake=Math.max(...rows.map(r2=>r2.wake));
  console.log('   medians: bg '+f(M2('bg'))+'  wake '+f(M2('wake'))+'  wild '+f(M2('wild'))+'  rival '+f(M2('rival'))+'  train '+f(M2('train')));
  console.log('   conditions: wild/water '+worstRing.toFixed(3)+'x (bar 2.0)   rival/seabed '+
    (M2('rival')/Math.max(M2('bg'),0.01)).toFixed(2)+'x (bar 2.0)   train/rival '+
    (M2('train')/M2('rival')).toFixed(2)+'x (bar 1.8)   brightest water '+brightestWater.toFixed(1)+
    ' vs rival '+M2('rival').toFixed(1));
  /* THE FOUR CONDITIONS OF DOC v1.8's SECTION 7.2, which are not v1.7's.
     1.7 made wild mantas dark silhouettes and measured them for darkness;
     1.8 makes every manta bright and measures brightness, contrast and
     colour instead. Condition 1 is now a SAME-COLOUR test — your train
     against what its own colour measures at everyone else's level — because
     the seven hues are not equally bright and comparing a lime rival with an
     azure train measures the palette, not the hierarchy. */
  const seabed = M2('bg');
  const gain = r.gain;
  ok(label+' 1. your train burns at least 1.4x its own colour at the base level',
     gain!==null && gain>=1.4, gain===null?'not measured':gain.toFixed(2)+'x  ('+r.mine+')');
  /* Not a condition, but the doc's prose says your train burns hotter than
     any OTHER manta, and with hues this far apart in luminance that does not
     follow from condition 1. Reported so the number exists. */
  console.log('   your train vs the brightest other manta on screen: '+
    (M2('train')/Math.max(M2('rival'),M2('wild'),0.01)).toFixed(2)+'x'+
    (M2('train')>=Math.max(M2('rival'),M2('wild'))?'  (yours is brightest)':
     '  (ANOTHER MANTA IS BRIGHTER \u2014 see the report)'));
  const measured=['rival','wild','train'].map(k=>[k,M2(k)]).filter(([,v])=>isFinite(v));
  const dimmest=measured.length?Math.min(...measured.map(([,v])=>v)):NaN;
  ok(label+' 2. moonlight\u2019s brightest crests stay below the dimmest manta',
     measured.length>0&&brightestWater<dimmest,
     'brightest water '+brightestWater.toFixed(1)+' vs dimmest manta '+
     dimmest.toFixed(1)+(measured.length<3?'  (only '+measured.map(([k])=>k).join(' and ')+' were on screen)':'')+
     (r.clean?'  (life removed)':'  (NO CLEAN FRAME \u2014 wake included)'));
  ok(label+' 3. EVERY manta is at least twice its ring of water, worst case', worstRing>=2.0,
     worstRing.toFixed(2)+'x  ('+worstWho+')  over '+situations.join(', '));
  ok(label+' 4. the wake behind the last follower stays dimmer than that follower',
     ends.length>0&&ends.every(r2=>r2.endWake<r2.endManta),
     ends.length?'worst margin '+worstEnd.toFixed(1)+(ends.length<rows.length?
       '  ('+(rows.length-ends.length)+' of '+rows.length+' snaps had nothing sampleable behind the tail)':''):
       'no snap had clear water behind the tail to sample');
  console.log('   panel: tier='+rows[0].rows['tier']+'  scale='+rows[0].rows['render scale']+'  lm='+rows[0].rows['light memory']+'  draws='+rows[0].rows['draw calls']+'  passes='+rows[0].rows['render passes']);
  {const k=r.errs.filter(isKnown), real=r.errs.filter(t=>!isKnown(t));
   if(k.length) console.log('   (known environment artefact, '+k.length+'x: Instance dropped in popErrorScope)');
   ok(label+' no console errors', real.length===0, JSON.stringify([...new Set(real)]).slice(0,350));}
  ok(label+' no non-200', r.bad4.length===0, JSON.stringify(r.bad4));
  ok(label+' off-origin zero', r.off.length===0, JSON.stringify(r.off));
  ok(label+' no horizontal overflow', rows[0].ov<=0, String(rows[0].ov));
}
console.log('\nh failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
