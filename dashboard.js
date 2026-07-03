/* ═══════════════════════════════════════════════════════════
   dashboard.js — DASHBOARD engine (v2)
   Streams: SaaS, Payment Processing, CAMP, Payroll
   Adds: weekly-rate health/uncollected, city/state + state filter,
   volume & take-rate, margins (top-line − fees − hardware),
   Excel export, single-restaurant focused page.
   Edit settings in config.js only.
═══════════════════════════════════════════════════════════ */

/* ---------- Password gate ---------- */
(function gate(){
  const pwWanted = (typeof CONFIG!=='undefined' && CONFIG.PASSWORD) || 'changeme';
  let authed=false; try{authed=sessionStorage.getItem('dash_ok')==='1';}catch(e){}
  const gateEl=document.getElementById('gate'), appEl=document.getElementById('app');
  function unlock(){gateEl.style.display='none';appEl.hidden=false;boot();}
  if(authed){unlock();return;}
  const input=document.getElementById('gateInput'),btn=document.getElementById('gateBtn'),errEl=document.getElementById('gateError');
  function attempt(){ if(input.value===pwWanted){try{sessionStorage.setItem('dash_ok','1');}catch(e){}unlock();}
    else{errEl.textContent='Incorrect password. Try again.';input.value='';input.focus();} }
  btn.addEventListener('click',attempt);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')attempt();});
  input.focus();
})();

/* ---------- state ---------- */
let ALL=[], ROWS=[], CHARTS={}, VIEW='overview', SEG_PICK=null, PREV_VIEW='overview';
const TAKE_RATE=0.025; // demo: volume = pp / take_rate
const STREAMS=[
  {key:'saas',label:'SaaS',color:'#5B4FE0'},
  {key:'pp',label:'Payment processing',color:'#B5790E'},
  {key:'camp',label:'CAMP',color:'#2E7D52'},
  {key:'payroll',label:'Payroll',color:'#3B7DD8'},
];
const PIE=['#5B4FE0','#B5790E','#2E7D52','#3B7DD8','#C0392B','#9B7BD4','#E0A458','#5BA37E'];

/* ---------- helpers ---------- */
const fmt=n=>'$'+Math.round(n).toLocaleString();
const sumK=(rows,k)=>rows.reduce((t,r)=>t+(+r[k]||0),0);
const uniq=a=>[...new Set(a)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function monthLabel(m){const [y,mo]=m.split('-');return new Date(+y,(+mo)-1).toLocaleString('default',{month:'short',year:'2-digit'});}

/* ---------- load ---------- */
async function loadData(){
  setSync(false,'Loading…'); hideErr();
  const cfg=(typeof CONFIG!=='undefined')?CONFIG:{};

  // 1) Supabase (preferred)
  if(cfg.SUPABASE_URL && cfg.SUPABASE_KEY){
    try{
      const base=cfg.SUPABASE_URL.replace(/\/$/,'');
      const table=cfg.TABLE||'revenue';
      const res=await fetch(`${base}/rest/v1/${table}?select=*&order=month.asc`,{
        headers:{apikey:cfg.SUPABASE_KEY,Authorization:'Bearer '+cfg.SUPABASE_KEY}
      });
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data=await res.json();
      if(!Array.isArray(data)||!data.length) throw new Error('Table returned no rows');
      ALL=data.map(mapSbRow).filter(r=>r.month&&r.restaurant);
      setSync(true,'Live');
      document.getElementById('psub').textContent='Live · updated '+new Date().toLocaleTimeString();
      afterLoad(); return;
    }catch(err){
      setSync(false,'Error');
      showErr('<b>Could not load from the database.</b> Showing demo data meanwhile. Check the Supabase URL/key in config.js and that the read policy is set.<br>Detail: '+err.message);
      ALL=demoData(); afterLoad(); return;
    }
  }

  // 2) Legacy CSV source (optional)
  if(cfg.SHEETS_CSV_URL){
    try{
      const res=await fetch(cfg.SHEETS_CSV_URL); if(!res.ok) throw new Error('HTTP '+res.status);
      const parsed=Papa.parse(await res.text(),{header:true,skipEmptyLines:true});
      ALL=parsed.data.map(mapRow).filter(r=>r.month&&r.restaurant);
      if(!ALL.length) throw new Error('No rows found');
      setSync(true,'Live'); document.getElementById('psub').textContent='Updated '+new Date().toLocaleTimeString(); afterLoad(); return;
    }catch(err){ setSync(false,'Error');
      showErr('<b>Could not load the CSV source.</b> Showing demo data.<br>Detail: '+err.message);
      ALL=demoData(); afterLoad(); return; }
  }

  // 3) Demo
  ALL=demoData(); setSync(true,'Demo data');
  document.getElementById('psub').textContent='Demo data — add your Supabase details in config.js'; afterLoad();
}

/* map a Supabase row (underscore columns) to the dashboard's shape */
function mapSbRow(r){
  const norm=s=>{s=String(s||'');const m=s.match(/(\d{4})-(\d{2})/);if(m)return m[1]+'-'+m[2];const d=new Date(s);return isNaN(d)?null:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
  const month=String(r.month||'').trim();
  const onM=norm(r.onboarding_date), caM=norm(r.cancelled_date);
  const partial=(onM&&onM===month)||(caM&&caM===month);
  return {
    month, restaurant:String(r.restaurant||'').trim(), status:String(r.status||'Active').trim(),
    platform:String(r.platform||'').trim(), city:String(r.city||'').trim(), state:String(r.state||'').trim().toUpperCase(),
    onboard:r.onboarding_date||'', cancel:r.cancelled_date||'', cycle:String(r.billing_cycle||'Weekly').trim(),
    gross:+r.gross_revenue||0, fees:+r.fees||0, net:+r.net_revenue||0, refunds:+r.refunds||0,
    platformFee:+r.platform_fee||0, pp:+r.payment_processing||0, saas:+r.saas||0,
    payroll:+r.payroll||0, camp:+r.camp||0, volume:+r.volume||0, hardware:+r.hardware_cost||0, partial:!!partial,
  };
}
const num=v=>{const n=parseFloat(String(v??'').replace(/[$,()]/g,''));return isNaN(n)?0:n;};
function mapRow(r){
  const pick=(...names)=>{for(const n of names){for(const k of Object.keys(r)){if(k.trim().toLowerCase()===n)return r[k];}}return '';};
  return {
    month:String(pick('month')||'').trim(),
    restaurant:String(pick('restaurant','restaurants')||'').trim(),
    status:String(pick('status')||'Active').trim(),
    platform:String(pick('platform')||'').trim(),
    city:String(pick('city')||'').trim(),
    state:String(pick('state')||'').trim().toUpperCase(),
    onboard:pick('onboarding date'), cancel:pick('paused/cancelled date'),
    cycle:String(pick('billing cycle')||'Weekly').trim(),
    gross:num(pick('gross revenue')), fees:num(pick('fees')), net:num(pick('net revenue')),
    refunds:num(pick('refunds')), platformFee:num(pick('platform fee')),
    pp:num(pick('payment processing')), saas:num(pick('saas')),
    payroll:num(pick('payroll')), camp:num(pick('camp')),
    volume:num(pick('volume')), hardware:num(pick('hardware cost','hardware')),
    partial:String(pick('partial')||'')==='1', // demo flag
  };
}

/* ---------- after load ---------- */
function afterLoad(){ buildPeriod(); buildStateFilter(); applyFilters(); }
function buildPeriod(){
  const months=uniq(ALL.map(r=>r.month)).sort();
  const sel=document.getElementById('period');
  sel.innerHTML='<option value="all">All time</option>'+months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
  sel.value=months.length?months[months.length-1]:'all';
}
function buildStateFilter(){
  const states=uniq(ALL.map(r=>r.state).filter(Boolean)).sort();
  const sel=document.getElementById('stateFilter');
  sel.innerHTML='<option value="all">All states</option>'+states.map(s=>`<option value="${s}">${s}</option>`).join('');
  sel.value='all';
}
function applyFilters(){
  const p=document.getElementById('period').value;
  const st=document.getElementById('stateFilter').value;
  ROWS=ALL.filter(r=>(p==='all'||r.month===p)&&(st==='all'||r.state===st));
  render();
}

/* ---------- aggregations ---------- */
function byRestaurant(rows){
  const m={};
  rows.forEach(r=>{
    if(!m[r.restaurant]) m[r.restaurant]={restaurant:r.restaurant,status:r.status,platform:r.platform,city:r.city,state:r.state,cycle:r.cycle,
      gross:0,saas:0,pp:0,camp:0,payroll:0,fees:0,refunds:0,volume:0,hardware:0,platformFee:r.platformFee,expected:0,partialAny:false};
    const o=m[r.restaurant];
    ['gross','saas','pp','camp','payroll','fees','refunds','volume','hardware'].forEach(k=>o[k]+=r[k]);
    o.expected+=expectedFor(r);
    if(r.partial) o.partialAny=true;
    if(r.platformFee) o.platformFee=r.platformFee;
    if(r.status) o.status=r.status;
  });
  return Object.values(m);
}
// expected charge for a SaaS-billed row: weekly→rate×4, monthly→rate×1; partial month→equals collected (no false delinquency)
function expectedFor(r){
  if(r.platformFee<=0) return 0;
  if(r.partial) return r.gross;
  return /month/i.test(r.cycle) ? r.platformFee*1 : r.platformFee*4;
}
function healthRows(rows){
  return byRestaurant(rows).filter(o=>o.platformFee>0||o.saas>0).map(o=>{
    const expected=o.expected||o.gross, collected=o.gross;
    const ratio=expected>0?clamp(collected/expected,0,1):1;
    const owed=Math.max(0,expected-collected);
    const churned=/churn/i.test(o.status);
    return {...o,expected,collected,ratio,owed,churned,hasPayroll:o.payroll>0};
  });
}
function totals(rows){return {
  saas:sumK(rows,'saas'),pp:sumK(rows,'pp'),camp:sumK(rows,'camp'),payroll:sumK(rows,'payroll'),
  fees:sumK(rows,'fees'),refunds:sumK(rows,'refunds'),gross:sumK(rows,'gross'),
  volume:sumK(rows,'volume'),hardware:sumK(rows,'hardware'),
};}
const topLine=t=>t.saas+t.pp+t.camp+t.payroll;
function healthColor(ratio,churned){ if(churned)return '#A6A6AE'; if(ratio>=0.95)return '#2E7D52'; if(ratio>=0.70)return '#B5790E'; return '#C0392B'; }

/* ---------- render dispatch ---------- */
function render(){
  ({overview:renderOverview,restaurants:renderHealth,processing:renderProcessing,
    margins:renderMargins,segments:renderSegments,forecast:renderForecast}[VIEW]||(()=>{}))();
}
function card(label,value,extra='',cls=''){return `<div class="card"><div class="card-l">${label}</div><div class="card-v ${cls}">${value}</div>${extra?`<div class="card-d ${extra.cls||''}">${extra.txt||extra}</div>`:''}</div>`;}
function upChart(id,cfg){if(CHARTS[id])CHARTS[id].destroy();const c=document.getElementById(id);if(c)CHARTS[id]=new Chart(c,cfg);}
function baseOpts({stacked}={}){return{responsive:true,maintainAspectRatio:false,
  plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,callbacks:{label:c=>' '+c.dataset.label+': '+(c.raw!=null?fmt(c.raw):'—')}}},
  scales:{x:{stacked:!!stacked,grid:{display:false},ticks:{color:'#73737E',font:{size:11}}},
    y:{stacked:!!stacked,grid:{color:'#EAEAE4'},ticks:{color:'#73737E',font:{size:11},callback:v=>'$'+(Math.abs(v)>=1000?(v/1000).toFixed(0)+'k':v)}}}};}

/* ---------- Overview ---------- */
function renderOverview(){
  const t=totals(ROWS), tl=topLine(t);
  const hr=healthRows(ROWS), owed=hr.reduce((s,r)=>s+r.owed,0);
  const restos=byRestaurant(ROWS);
  const active=restos.filter(r=>!/churn/i.test(r.status)).length, churn=restos.filter(r=>/churn/i.test(r.status)).length;
  document.getElementById('ov-cards').innerHTML=
    card('Top-line revenue',fmt(tl))+card('SaaS',fmt(t.saas))+card('Payment processing',fmt(t.pp))+
    card('CAMP + Payroll',fmt(t.camp+t.payroll))+card('Uncollected revenue',fmt(owed),'',owed>0?'owed':'good')+
    card('Active · churned',active+' · '+churn);

  const months=uniq(ALL.map(r=>r.month)).sort();
  const fr=(typeof window!=='undefined')?ROWS:ROWS;
  const st=document.getElementById('stateFilter').value;
  const mRows=m=>ALL.filter(r=>r.month===m&&(st==='all'||r.state===st));
  const ds=STREAMS.map(s=>({label:s.label,data:months.map(m=>Math.round(sumK(mRows(m),s.key))),backgroundColor:s.color,borderRadius:3,stack:'a'}));
  document.getElementById('ov-legend').innerHTML=STREAMS.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  upChart('ovChart',{type:'bar',data:{labels:months.map(monthLabel),datasets:ds},options:baseOpts({stacked:true})});

  const split=STREAMS.map(s=>({label:s.label,v:t[s.key],c:s.color})).filter(x=>x.v>0);
  upChart('ovSplit',{type:'doughnut',data:{labels:split.map(s=>s.label),datasets:[{data:split.map(s=>Math.round(s.v)),backgroundColor:split.map(s=>s.c),borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'bottom',labels:{boxWidth:9,padding:9,font:{size:11},color:'#73737E'}},tooltip:{callbacks:{label:c=>' '+c.label+': '+fmt(c.raw)}}}}});

  // by state
  const stateMap={};
  ROWS.forEach(r=>{const k=r.state||'—';stateMap[k]=(stateMap[k]||0)+r.saas+r.pp+r.camp+r.payroll;});
  const ents=Object.entries(stateMap).sort((a,b)=>b[1]-a[1]);
  document.getElementById('ov-state').innerHTML=ents.map(([s,v],i)=>
    `<div class="mini-item"><span class="nm"><span class="swatch" style="background:${PIE[i%PIE.length]}"></span><span class="t">${s}</span></span><span class="vl">${fmt(v)}</span></div>`).join('')||'<p class="note">No data.</p>';
}

/* ---------- Restaurant health ---------- */
function renderHealth(){
  const hr=healthRows(ROWS);
  document.getElementById('rh-cards').innerHTML=
    card('Weekly-billed restaurants',hr.length)+
    card('Expected',fmt(hr.reduce((s,r)=>s+r.expected,0)))+
    card('Collected',fmt(hr.reduce((s,r)=>s+r.collected,0)))+
    card('Uncollected revenue',fmt(hr.reduce((s,r)=>s+r.owed,0)),'',hr.some(r=>r.owed>0)?'owed':'good');
  drawHealthList(hr);
}
function drawHealthList(hr){
  const q=(document.getElementById('rh-search').value||'').toLowerCase();
  const sort=document.getElementById('rh-sort').value;
  let list=hr.filter(r=>r.restaurant.toLowerCase().includes(q));
  list.sort((a,b)=> sort==='health'?a.ratio-b.ratio : sort==='owed'?b.owed-a.owed : sort==='collected'?b.collected-a.collected : a.restaurant.localeCompare(b.restaurant));
  const el=document.getElementById('rh-list');
  if(!list.length){el.innerHTML='<p class="note" style="padding:14px 0">No restaurants match.</p>';return;}
  el.innerHTML=list.map(r=>{
    const col=healthColor(r.ratio,r.churned), pct=Math.round(r.ratio*100);
    const loc=[r.city,r.state].filter(Boolean).join(', ');
    const tags=[`<span class="tag">${r.platform||'—'}</span>`];
    if(r.hasPayroll) tags.push('<span class="tag pay">Payroll</span>');
    if(r.churned) tags.push('<span class="tag churn">Churned</span>');
    return `<div class="rh-row" onclick="openDetail('${escA(r.restaurant)}')">
      <div><div class="rh-name">${r.restaurant}</div>${loc?`<div class="rh-loc">${loc}</div>`:''}<div class="rh-tags">${tags.join('')}</div></div>
      <div><div class="bar-tr"><div class="bar-fl" style="width:${clamp(pct,3,100)}%;background:${col}"></div></div>
        <div class="bar-meta"><span>Payment health</span><b style="color:${col}">${pct}%</b></div></div>
      <div class="rh-right"><div class="rh-coll">${fmt(r.collected)}</div><div class="rh-exp">of ${fmt(r.expected)} expected</div>
        ${r.owed>0?`<div class="rh-owed">uncollected ${fmt(r.owed)}</div>`:`<div class="rh-paid">paid in full</div>`}</div>
    </div>`;
  }).join('');
}

/* ---------- Payment processing ---------- */
function renderProcessing(){
  const pr=byRestaurant(ROWS).filter(o=>o.pp>0).sort((a,b)=>b.pp-a.pp);
  const totRev=pr.reduce((s,r)=>s+r.pp,0), totVol=pr.reduce((s,r)=>s+r.volume,0);
  const take=totVol>0?(totRev/totVol*100):0;
  document.getElementById('pp-cards').innerHTML=
    card('Payment Processing Revenue',fmt(totRev))+card('Processed volume',fmt(totVol))+
    card('Effective take-rate',take.toFixed(2)+'%')+card('Restaurants',pr.length);
  const months=uniq(ALL.map(r=>r.month)).sort();
  const st=document.getElementById('stateFilter').value;
  upChart('ppChart',{type:'bar',data:{labels:months.map(monthLabel),datasets:[{label:'PP Revenue',
    data:months.map(m=>Math.round(sumK(ALL.filter(r=>r.month===m&&(st==='all'||r.state===st)),'pp'))),backgroundColor:'#B5790E',borderRadius:3}]},options:baseOpts()});
  document.getElementById('pp-list').innerHTML=pr.slice(0,15).map((r,i)=>{
    const tr=r.volume>0?(r.pp/r.volume*100).toFixed(2)+'%':'—';
    return `<div class="mini-item" style="cursor:pointer" onclick="openDetail('${escA(r.restaurant)}')">
      <span class="nm"><span class="swatch" style="background:${PIE[i%PIE.length]}"></span><span class="t">${r.restaurant}</span></span>
      <span class="vl">${fmt(r.pp)}</span>
      <span class="sub2">volume ${fmt(r.volume)} · take ${tr}</span></div>`;
  }).join('')||'<p class="note">No processing revenue in this period.</p>';
}

/* ---------- Margins ---------- */
function renderMargins(){
  const t=totals(ROWS), tl=topLine(t);
  const contribution=tl-t.fees-t.hardware;
  document.getElementById('mg-cards').innerHTML=
    card('Top-line revenue',fmt(tl))+card('Processor fees',fmt(t.fees),'',)+
    card('Hardware cost',fmt(t.hardware))+card('Contribution',fmt(contribution),'',contribution>=0?'good':'owed');
  const restos=byRestaurant(ROWS).map(o=>({...o,tl:o.saas+o.pp+o.camp+o.payroll,contrib:(o.saas+o.pp+o.camp+o.payroll)-o.fees-o.hardware}))
    .sort((a,b)=>b.tl-a.tl);
  const tb=document.querySelector('#mg-table tbody');
  tb.innerHTML=restos.map(o=>`<tr onclick="openDetail('${escA(o.restaurant)}')" style="cursor:pointer">
    <td>${o.restaurant}</td><td class="num">${fmt(o.tl)}</td><td class="num neg">${o.fees?'-'+fmt(o.fees):'$0'}</td>
    <td class="num neg">${o.hardware?'-'+fmt(o.hardware):'$0'}</td><td class="num ${o.contrib>=0?'pos':'neg'}">${fmt(o.contrib)}</td></tr>`).join('')+
    `<tr class="total"><td>Total</td><td class="num">${fmt(tl)}</td><td class="num neg">-${fmt(t.fees)}</td><td class="num neg">-${fmt(t.hardware)}</td><td class="num ${contribution>=0?'pos':'neg'}">${fmt(contribution)}</td></tr>`;
}

/* ---------- Segments ---------- */
function renderSegments(){
  const payrollOnly=document.getElementById('seg-payroll').checked;
  let restos=byRestaurant(ROWS); if(payrollOnly) restos=restos.filter(o=>o.payroll>0);
  const seg={both:[],saas:[],pp:[]};
  restos.forEach(o=>{const s=o.saas>0,p=o.pp>0; if(s&&p)seg.both.push(o);else if(s&&!p)seg.saas.push(o);else if(!s&&p)seg.pp.push(o);});
  const rev=a=>a.reduce((t,o)=>t+o.saas+o.pp+o.camp+o.payroll,0);
  const cell=(id,cls,txt,a)=>`<div class="mx-cell ${SEG_PICK===id?'sel':''}" data-seg="${id}"><span class="mx-pill ${cls}">${txt}</span><div class="mx-n">${a.length}</div><div class="mx-sub">restaurants · ${fmt(rev(a))}</div><div class="mx-eg">${a.slice(0,3).map(o=>o.restaurant).join(', ')||'—'}</div></div>`;
  document.getElementById('seg-matrix').innerHTML=
    `<div></div><div class="mx-h">Uses payment processing</div><div class="mx-h">No payment processing</div>
     <div class="mx-rl">Uses SaaS</div>${cell('both','mx-both','Both services',seg.both)}${cell('saas','mx-saas','SaaS only',seg.saas)}
     <div class="mx-rl">No SaaS</div>${cell('pp','mx-pp','Payment processing only',seg.pp)}
     <div class="mx-cell na"><span class="mx-pill mx-na">Not a customer</span><div class="mx-n" style="color:var(--faint)">—</div><div class="mx-sub">no active service</div></div>`;
  document.querySelectorAll('.mx-cell[data-seg]').forEach(c=>c.addEventListener('click',()=>{SEG_PICK=c.dataset.seg;renderSegments();}));
  const titles={both:'Both services',saas:'SaaS only',pp:'Payment processing only'};
  const listEl=document.getElementById('seg-list');
  if(SEG_PICK&&seg[SEG_PICK]){
    document.getElementById('seg-list-title').textContent=titles[SEG_PICK]+' — '+seg[SEG_PICK].length+' restaurants';
    listEl.innerHTML=seg[SEG_PICK].sort((a,b)=>(b.saas+b.pp)-(a.saas+a.pp)).map((o,i)=>
      `<div class="mini-item" style="cursor:pointer" onclick="openDetail('${escA(o.restaurant)}')"><span class="nm"><span class="swatch" style="background:${PIE[i%PIE.length]}"></span><span class="t">${o.restaurant}</span>${o.payroll>0?' <span class="tag pay">Payroll</span>':''}</span><span class="vl">${fmt(o.saas+o.pp+o.camp+o.payroll)}</span></div>`).join('');
  }else{ document.getElementById('seg-list-title').textContent='Select a segment above';
    listEl.innerHTML='<p class="note" style="padding:12px 0">Click a cell in the matrix to list its restaurants.</p>'; }
}

/* ---------- Forecast ---------- */
function renderForecast(){
  const months=uniq(ALL.map(r=>r.month)).sort();
  const series=months.map(m=>topLine(totals(ALL.filter(r=>r.month===m))));
  const n=series.length;
  document.getElementById('fc-legend').innerHTML='<span><i style="background:#5B4FE0"></i>Actual</span><span><i style="background:#C8C3F4"></i>Projected</span>';
  if(n<2){document.getElementById('fc-cards').innerHTML=card('Not enough data','Need 2+ months');upChart('fcChart',{type:'bar',data:{labels:[],datasets:[]},options:baseOpts()});return;}
  const xa=(n-1)/2, ya=series.reduce((a,b)=>a+b,0)/n; let num2=0,den=0;
  series.forEach((y,i)=>{num2+=(i-xa)*(y-ya);den+=(i-xa)**2;});
  const slope=den?num2/den:0, intc=ya-slope*xa, proj=i=>Math.max(0,Math.round(intc+slope*i));
  const labels=[...months.map(monthLabel)], actual=[...series.map(Math.round)], projected=series.map(()=>null);
  for(let p=1;p<=6;p++){const d=new Date();d.setMonth(d.getMonth()+p);labels.push(d.toLocaleString('default',{month:'short',year:'2-digit'}));actual.push(null);projected.push(proj(n+p-1));}
  const nextMo=proj(n), growth=(slope&&ya)?(slope/ya*100):0;
  document.getElementById('fc-cards').innerHTML=
    card('Next month',fmt(nextMo))+card('Next quarter',fmt(proj(n)+proj(n+1)+proj(n+2)))+
    card('Monthly growth',(growth>=0?'+':'')+growth.toFixed(1)+'%')+card('Annual run rate',fmt(nextMo*12));
  upChart('fcChart',{type:'bar',data:{labels,datasets:[
    {label:'Actual',data:actual,backgroundColor:'#5B4FE0',borderRadius:3},
    {label:'Projected',data:projected,backgroundColor:'#C8C3F4',borderRadius:3}]},options:baseOpts()});
}

/* ---------- Single-restaurant detail ---------- */
function escA(s){return String(s).replace(/'/g,"\\'");}
function openDetail(name){
  const rows=ALL.filter(r=>r.restaurant===name).sort((a,b)=>a.month.localeCompare(b.month));
  if(!rows.length) return;
  const o=byRestaurant(rows)[0];
  const tl=o.saas+o.pp+o.camp+o.payroll;
  const hr=healthRows(rows)[0];
  const loc=[o.city,o.state].filter(Boolean).join(', ');
  const services=[]; if(o.saas>0)services.push('SaaS'); if(o.pp>0)services.push('Payment processing'); if(o.camp>0)services.push('CAMP'); if(o.payroll>0)services.push('Payroll');
  const tags=[`<span class="tag">${o.platform||'—'}</span>`,`<span class="tag">${o.cycle||'—'}</span>`].concat(services.map(s=>`<span class="tag">${s}</span>`));
  if(/churn/i.test(o.status)) tags.push('<span class="tag churn">Churned</span>');
  const avgHealth=hr?Math.round(hr.ratio*100):'—';
  const take=o.volume>0?(o.pp/o.volume*100).toFixed(2)+'%':'—';

  const rowsHtml=rows.map(r=>{
    const exp=expectedFor(r), unc=Math.max(0,exp-r.gross), tlm=r.saas+r.pp+r.camp+r.payroll;
    return `<tr><td>${monthLabel(r.month)}</td><td class="num">${fmt(tlm)}</td><td class="num">${fmt(r.saas)}</td><td class="num">${fmt(r.pp)}</td>
      <td class="num">${r.camp?fmt(r.camp):'–'}</td><td class="num">${r.payroll?fmt(r.payroll):'–'}</td>
      <td class="num neg">${r.fees?'-'+fmt(r.fees):'$0'}</td><td class="num neg">${r.hardware?'-'+fmt(r.hardware):'$0'}</td>
      <td class="num ${unc>0?'neg':''}">${unc>0?fmt(unc):'–'}</td></tr>`;
  }).join('');

  document.getElementById('detail-content').innerHTML=`
    <div class="d-head"><div class="d-name">${o.restaurant}</div>${loc?`<div class="d-loc">${loc}</div>`:''}<div class="d-tags">${tags.join('')}</div></div>
    <div class="cards">
      ${card('Top-line (all time)',fmt(tl))}${card('Uncollected',fmt(o.expected-o.gross>0?o.expected-o.gross:0),'',(o.expected-o.gross>0)?'owed':'good')}
      ${card('Avg payment health',avgHealth+(avgHealth==='—'?'':'%'))}${card('Processed volume',fmt(o.volume))}
    </div>
    <div class="panel"><div class="panel-h"><span class="panel-t">Revenue by month</span></div><div class="cv"><canvas id="detailChart"></canvas></div></div>
    <div class="panel"><div class="panel-h"><span class="panel-t">Monthly detail</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Month</th><th class="num">Top-line</th><th class="num">SaaS</th><th class="num">PP</th><th class="num">CAMP</th><th class="num">Payroll</th><th class="num">Fees</th><th class="num">Hardware</th><th class="num">Uncollected</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div></div>`;

  const months=rows.map(r=>monthLabel(r.month));
  upChart('detailChart',{type:'bar',data:{labels:months,datasets:STREAMS.map(s=>({label:s.label,data:rows.map(r=>Math.round(r[s.key])),backgroundColor:s.color,borderRadius:3,stack:'a'}))},options:baseOpts({stacked:true})});

  DETAIL_NAME=name;
  document.getElementById('detail').hidden=false;
  window.scrollTo(0,0);
}
let DETAIL_NAME=null;
function closeDetail(){document.getElementById('detail').hidden=true;}

/* ---------- Export ---------- */
function exportCurrent(){
  let rows=[], name=VIEW;
  const det=!document.getElementById('detail').hidden;
  if(det && DETAIL_NAME){
    name=DETAIL_NAME;
    ALL.filter(r=>r.restaurant===DETAIL_NAME).sort((a,b)=>a.month.localeCompare(b.month)).forEach(r=>{
      const exp=expectedFor(r);
      rows.push({Month:r.month,'Top-line':r.saas+r.pp+r.camp+r.payroll,SaaS:r.saas,'Payment Processing':r.pp,CAMP:r.camp,Payroll:r.payroll,Fees:r.fees,Hardware:r.hardware,Uncollected:Math.max(0,exp-r.gross)});
    });
  } else if(VIEW==='restaurants'){
    healthRows(ROWS).forEach(r=>rows.push({Restaurant:r.restaurant,City:r.city,State:r.state,Platform:r.platform,Expected:r.expected,Collected:r.collected,Uncollected:r.owed,'Health %':Math.round(r.ratio*100)}));
  } else if(VIEW==='processing'){
    byRestaurant(ROWS).filter(o=>o.pp>0).sort((a,b)=>b.pp-a.pp).forEach(o=>rows.push({Restaurant:o.restaurant,City:o.city,State:o.state,'PP Revenue':o.pp,Volume:o.volume,'Take rate %':o.volume>0?+(o.pp/o.volume*100).toFixed(2):0}));
  } else if(VIEW==='margins'){
    byRestaurant(ROWS).forEach(o=>{const tl=o.saas+o.pp+o.camp+o.payroll;rows.push({Restaurant:o.restaurant,'Top-line':tl,Fees:o.fees,Hardware:o.hardware,Contribution:tl-o.fees-o.hardware});});
  } else if(VIEW==='segments'){
    byRestaurant(ROWS).forEach(o=>{const s=o.saas>0,p=o.pp>0;rows.push({Restaurant:o.restaurant,Segment:s&&p?'Both':s?'SaaS only':p?'PP only':'None',SaaS:o.saas,'Payment Processing':o.pp,Payroll:o.payroll});});
  } else { // overview / forecast
    byRestaurant(ROWS).forEach(o=>rows.push({Restaurant:o.restaurant,City:o.city,State:o.state,'Top-line':o.saas+o.pp+o.camp+o.payroll,SaaS:o.saas,'Payment Processing':o.pp,CAMP:o.camp,Payroll:o.payroll,Fees:o.fees}));
  }
  if(!rows.length){alert('Nothing to export in this view.');return;}
  const ws=XLSX.utils.json_to_sheet(rows), wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Export');
  const period=document.getElementById('period').value;
  XLSX.writeFile(wb,`dashboard_${name}_${period}.xlsx`);
}

/* ---------- UI ---------- */
function setSync(ok,txt){document.getElementById('dot').className='dot '+(ok?'ok':'err');document.getElementById('syncText').textContent=txt;}
function showErr(h){const e=document.getElementById('err');e.hidden=false;e.innerHTML=h;}
function hideErr(){document.getElementById('err').hidden=true;}
const TITLES={overview:'Overview',restaurants:'Restaurant health',processing:'Payment processing',margins:'Margins',segments:'Segments',forecast:'Forecast'};
function boot(){
  if(typeof CONFIG!=='undefined'&&CONFIG.BRAND){document.getElementById('brandName').textContent=CONFIG.BRAND;document.title=CONFIG.BRAND;}
  document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    b.classList.add('active'); VIEW=b.dataset.view;
    document.getElementById('v-'+VIEW).classList.add('active');
    document.getElementById('ptitle').textContent=TITLES[VIEW]; render();
  }));
  document.getElementById('period').addEventListener('change',applyFilters);
  document.getElementById('stateFilter').addEventListener('change',applyFilters);
  document.getElementById('refreshBtn').addEventListener('click',loadData);
  document.getElementById('rh-search').addEventListener('input',()=>drawHealthList(healthRows(ROWS)));
  document.getElementById('rh-sort').addEventListener('change',()=>drawHealthList(healthRows(ROWS)));
  document.getElementById('seg-payroll').addEventListener('change',renderSegments);
  document.getElementById('exportBtn').addEventListener('click',exportCurrent);
  document.getElementById('detailExport').addEventListener('click',exportCurrent);
  document.getElementById('detailBack').addEventListener('click',closeDetail);
  loadData();
}

/* ---------- demo data (May figures real; Jan–Apr simulated) ---------- */
function demoData(){
  const months=['2026-01','2026-02','2026-03','2026-04','2026-05'];
  const factor=[0.80,0.86,0.91,0.96,1.00];
  // onboard: 'pre' = before Jan; else 'YYYY-MM'. cancel: null or 'YYYY-MM'
  const base=[
    {n:'Flights Las Vegas',plat:'Stripe',on:'pre',pf:199,cy:'Weekly',gross:796,fees:19.54,pp:7176.41,saas:881.29,payroll:465,camp:4428.57,city:'Las Vegas',st:'NV',hw:900},
    {n:'Kyoto Palace',plat:'Adyen',on:'pre',pf:198,cy:'Weekly',gross:792,fees:0,pp:1106.43,saas:876.86,city:'Fremont',st:'CA',hw:600},
    {n:'20Twenty',plat:'Stripe',on:'pre',pf:99,cy:'Weekly',gross:396,fees:12.68,pp:265.17,saas:438.43,city:'San Jose',st:'CA',hw:450},
    {n:'RW Grill Los Altos',plat:'Adyen',on:'pre',pf:198,cy:'Weekly',gross:792,fees:0,pp:35.27,saas:876.86,city:'Los Altos',st:'CA',hw:600},
    {n:'Araujos Mexican Grill',plat:'Adyen',on:'pre',pf:75,cy:'Weekly',gross:300,fees:0,pp:1139.84,saas:332.14,city:'Hayward',st:'CA',hw:350},
    {n:'Con Azucar',plat:'Adyen',on:'pre',pf:198,cy:'Weekly',gross:792,fees:0,pp:642.47,saas:876.86,city:'Redwood City',st:'CA',hw:600},
    {n:'Tacos El Compa',plat:'Adyen',on:'pre',pf:75,cy:'Weekly',gross:225,fees:0,pp:41.61,saas:332.14,city:'San Jose',st:'CA',hw:350}, // delinquent 3/4
    {n:'Café Riace',plat:'Adyen',on:'pre',pf:99,cy:'Weekly',gross:396,fees:0,pp:255.58,saas:438.43,city:'Palo Alto',st:'CA',hw:450},
    {n:'Martha Catering Food Truck',plat:'Adyen',on:'pre',pf:75,cy:'Weekly',gross:300,fees:0,pp:215.86,saas:332.14,city:'Oakland',st:'CA',hw:350},
    {n:'T-Birds Pizza',plat:'Hubspot',on:'2026-02',pf:75,cy:'Weekly',gross:300,fees:4.64,pp:313.92,saas:332.14,city:'San Jose',st:'CA',hw:350},
    {n:'Kabul Mini Market - Livermore',plat:'Hubspot',on:'2026-03',pf:50,cy:'Weekly',gross:200,fees:3.12,pp:259.30,saas:221.43,city:'Livermore',st:'CA',hw:300},
    {n:'Ca Phe Viet - San Francisco',plat:'Hubspot',on:'2026-02',pf:99,cy:'Weekly',gross:297,fees:4.59,refunds:198,pp:247.60,saas:396,city:'San Francisco',st:'CA',hw:450}, // delinquent 3/4
    {n:'Nola Street Kitchen',plat:'Hubspot',on:'2026-04',pf:99,cy:'Weekly',gross:396,fees:6.12,pp:317.01,saas:438.43,city:'San Francisco',st:'CA',hw:450},
    {n:'360 Gourmet Burritos of Alameda',plat:'Hubspot',on:'2026-04',pf:79.20,cy:'Weekly',gross:316.80,fees:12.76,pp:889.13,saas:158.40,city:'Alameda',st:'CA',hw:400},
    {n:'Crema Coffee/Pier 402',plat:'Hubspot',on:'2026-04',pf:99,cy:'Weekly',gross:396,fees:6.12,pp:150.30,saas:438.43,city:'San Francisco',st:'CA',hw:450},
    {n:'Heritage',plat:'Adyen',on:'pre',pf:198,cy:'Weekly',gross:198,fees:0,saas:367.71,city:'San Francisco',st:'CA',hw:600,cancel:'2026-04'}, // churned, saas only
    {n:'Mr Hongs - Gilroy',plat:'Hubspot',on:'2026-04',pf:99,cy:'Weekly',gross:402,fees:6.20,refunds:501.50,saas:311.14,payroll:4.71,city:'Gilroy',st:'CA',hw:450,cancel:'2026-05'}, // churned, payroll
    {n:'Redwood Grill (Los Altos)',plat:'Hubspot',on:'2026-05',pf:75,cy:'Weekly',gross:300.50,fees:4.65,saas:332.14,payroll:6.64,city:'Los Altos',st:'CA',hw:350}, // payroll
    {n:'Mersea',plat:'Hubspot',on:'2026-05',pf:99,cy:'Weekly',gross:396,fees:15.64,pp:325.29,saas:438.43,payroll:4.93,city:'San Francisco',st:'CA',hw:450}, // payroll + pp
    {n:'Boloco',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:837.46,city:'Cambridge',st:'MA',hw:300},
    {n:'La Esquina Mexican Food',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:209.93,city:'Las Vegas',st:'NV',hw:300},
    {n:'LGCRC',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:881.00,city:'Las Vegas',st:'NV',hw:300},
    {n:'Maple House',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:601.31,city:'San Jose',st:'CA',hw:300},
    {n:'Elements',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:379.38,city:'San Francisco',st:'CA',hw:300},
    {n:'Crazy Pita (Henderson)',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:51.56,city:'Henderson',st:'NV',hw:300},
    {n:'Crazy Pita - Port St Lucie',plat:'Stripe',on:'pre',pf:0,cy:'Monthly',pp:12.23,city:'Port St Lucie',st:'FL',hw:300},
  ];
  const mi=m=>months.indexOf(m);
  const rows=[];
  base.forEach(b=>{
    const onIdx = b.on==='pre'?0:mi(b.on);
    const cancelIdx = b.cancel?mi(b.cancel):4;
    for(let i=onIdx;i<=cancelIdx;i++){
      const f=factor[i];
      const partial = (b.on!=='pre' && i===onIdx) || (b.cancel && i===cancelIdx); // first/last month partial
      const churned = b.cancel && i>=cancelIdx;
      const g=Math.round((b.gross||0)*f), saas=Math.round((b.saas||0)*f);
      rows.push({
        month:months[i], restaurant:b.n, status:churned?'Churned':'Active', platform:b.plat,
        city:b.city, state:b.st, onboard:b.on==='pre'?'Before Jan 2026':b.on, cancel:b.cancel||'',
        cycle:b.cy, platformFee:b.pf,
        gross:g, fees:Math.round((b.fees||0)*f), net:g-Math.round((b.fees||0)*f),
        refunds:i===4?Math.round(b.refunds||0):0,
        pp:Math.round((b.pp||0)*f), saas:saas, payroll:Math.round((b.payroll||0)*f), camp:Math.round((b.camp||0)*f),
        volume:b.pp?Math.round((b.pp*f)/TAKE_RATE):0,
        hardware:i===onIdx?(b.hw||0):0,
        partial,
      });
    }
  });
  return rows;
}
