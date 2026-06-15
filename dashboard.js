/* ═══════════════════════════════════════════════════════════
   dashboard.js — DASHBOARD engine
   Reads the consolidated Google Sheet (CSV), computes the four
   revenue streams, restaurant health, owed/discount, segments,
   and forecast. All computation is client-side.
   You never edit this file — settings live in config.js.
═══════════════════════════════════════════════════════════ */

/* ---------- 0. Password gate ---------- */
(function gate(){
  const pwWanted = (typeof CONFIG !== 'undefined' && CONFIG.PASSWORD) || 'changeme';
  let authed = false;
  try { authed = sessionStorage.getItem('dash_ok') === '1'; } catch(e){}

  const gateEl = document.getElementById('gate');
  const appEl  = document.getElementById('app');

  function unlock(){
    gateEl.style.display = 'none';
    appEl.hidden = false;
    boot();
  }
  if (authed) { unlock(); return; }

  const input = document.getElementById('gateInput');
  const btn   = document.getElementById('gateBtn');
  const errEl = document.getElementById('gateError');
  function attempt(){
    if (input.value === pwWanted){
      try { sessionStorage.setItem('dash_ok','1'); } catch(e){}
      unlock();
    } else {
      errEl.textContent = 'Incorrect password. Try again.';
      input.value = ''; input.focus();
    }
  }
  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  input.focus();
})();

/* ---------- shared state ---------- */
let ALL = [];        // every row, all months
let ROWS = [];       // rows in selected period
let CHARTS = {};
let VIEW = 'overview';
let SEG_PICK = null;

const STREAMS = [
  { key:'saas',     label:'SaaS',               color:'#5B4FE0' },
  { key:'pp',       label:'Payment processing', color:'#B5790E' },
  { key:'camp',     label:'CAMP',               color:'#2E7D52' },
  { key:'payroll',  label:'Payroll',            color:'#3B7DD8' },
];
const PIE = ['#5B4FE0','#B5790E','#2E7D52','#3B7DD8','#C0392B','#9B7BD4','#E0A458','#5BA37E'];

/* ---------- helpers ---------- */
const fmt   = n => '$' + Math.round(n).toLocaleString();
const fmt1  = n => '$' + (Math.round(n*10)/10).toLocaleString(undefined,{minimumFractionDigits:0});
const sumK  = (rows,k) => rows.reduce((t,r)=>t+(+r[k]||0),0);
const uniq  = a => [...new Set(a)];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

function monthLabel(m){
  const [y,mo] = m.split('-');
  return new Date(+y,(+mo)-1).toLocaleString('default',{month:'short',year:'2-digit'});
}

/* ---------- 1. Load ---------- */
async function loadData(){
  setSync(false,'Loading…');
  hideErr();
  const url = (typeof CONFIG!=='undefined' && CONFIG.SHEETS_CSV_URL) ? CONFIG.SHEETS_CSV_URL : '';

  if (!url){
    ALL = demoData();
    setSync(true,'Demo data');
    document.getElementById('psub').textContent = 'Demo data — add your Sheet URL in config.js';
    afterLoad();
    return;
  }
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const text = await res.text();
    const parsed = Papa.parse(text,{header:true,skipEmptyLines:true});
    ALL = parsed.data.map(mapRow).filter(r=>r.month && r.restaurant);
    if(!ALL.length) throw new Error('No rows found');
    setSync(true,'Live');
    document.getElementById('psub').textContent = 'Updated ' + new Date().toLocaleTimeString();
    afterLoad();
  }catch(err){
    setSync(false,'Error');
    showErr('<b>Could not load your Google Sheet.</b> Check the URL in config.js is published as CSV (File → Share → Publish to web → CSV). Showing demo data meanwhile. <br>Detail: '+err.message);
    ALL = demoData();
    afterLoad();
  }
}

const num = v => { const n = parseFloat(String(v??'').replace(/[$,()]/g,'')); return isNaN(n)?0:n; };
function mapRow(r){
  const g = k => r[k] ?? r[k?.toLowerCase?.()] ?? '';
  const pick = (...names) => { for(const n of names){ for(const key of Object.keys(r)){ if(key.trim().toLowerCase()===n) return r[key]; } } return ''; };
  return {
    month:    String(pick('month')||'').trim(),
    refId:    pick('reference id','reference id – hubspot','refrence id – hubspot'),
    restaurant: String(pick('restaurant','restaurants')||'').trim(),
    status:   String(pick('status')||'Active').trim(),
    platform: String(pick('platform')||'').trim(),
    onboard:  pick('onboarding date'),
    cancel:   pick('paused/cancelled date'),
    gross:    num(pick('gross revenue')),
    fees:     num(pick('fees')),
    net:      num(pick('net revenue')),
    refunds:  num(pick('refunds')),
    platformFee: num(pick('platform fee')),
    perDay:   num(pick('per day')),
    days:     num(pick('no of days in month','days in month')),
    pp:       num(pick('payment processing')),
    saas:     num(pick('saas','saas ')),
    payroll:  num(pick('payroll')),
    camp:     num(pick('camp')),
  };
}

/* ---------- 2. After load ---------- */
function afterLoad(){
  buildPeriodOptions();
  applyPeriod();
}

function buildPeriodOptions(){
  const months = uniq(ALL.map(r=>r.month)).sort();
  const sel = document.getElementById('period');
  sel.innerHTML = '<option value="all">All time</option>' +
    months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
  sel.value = months.length ? months[months.length-1] : 'all';
}

function applyPeriod(){
  const p = document.getElementById('period').value;
  ROWS = (p==='all') ? ALL.slice() : ALL.filter(r=>r.month===p);
  render();
}

/* ---------- 3. Aggregations ---------- */
// group selected-period rows by restaurant, summing streams
function byRestaurant(rows){
  const m = {};
  rows.forEach(r=>{
    if(!m[r.restaurant]) m[r.restaurant] = {restaurant:r.restaurant,status:r.status,platform:r.platform,
      gross:0,saas:0,pp:0,camp:0,payroll:0,fees:0,refunds:0};
    const o=m[r.restaurant];
    o.gross+=r.gross; o.saas+=r.saas; o.pp+=r.pp; o.camp+=r.camp; o.payroll+=r.payroll;
    o.fees+=r.fees; o.refunds+=r.refunds;
    if(r.status) o.status=r.status;
  });
  return Object.values(m);
}

// health applies to weekly-billed (has SaaS expected). expected=saas accrued, collected=gross
function healthRows(rows){
  return byRestaurant(rows)
    .filter(o=>o.saas>0)
    .map(o=>{
      const expected=o.saas, collected=o.gross;
      const ratio = expected>0 ? clamp(collected/expected,0,1.5) : 1;
      const owed = Math.max(0, expected-collected);
      const churned = /churn/i.test(o.status);
      return {...o,expected,collected,ratio,owed,churned,hasPayroll:o.payroll>0};
    });
}

function totals(rows){
  return {
    saas:sumK(rows,'saas'), pp:sumK(rows,'pp'), camp:sumK(rows,'camp'), payroll:sumK(rows,'payroll'),
    fees:sumK(rows,'fees'), refunds:sumK(rows,'refunds'), gross:sumK(rows,'gross'),
    accrued: rows.reduce((t,r)=>t + (r.perDay*r.days || 0),0),
  };
}
const totalRevenue = t => t.saas + t.pp + t.camp + t.payroll;

function healthColor(ratio,churned){
  if(churned) return '#A6A6AE';
  if(ratio>=0.95) return '#2E7D52';
  if(ratio>=0.70) return '#B5790E';
  return '#C0392B';
}

/* ---------- 4. Render dispatch ---------- */
function render(){
  if(VIEW==='overview')    renderOverview();
  if(VIEW==='restaurants') renderHealth();
  if(VIEW==='processing')  renderProcessing();
  if(VIEW==='segments')    renderSegments();
  if(VIEW==='forecast')    renderForecast();
}

function card(label,value,extra='',cls=''){
  return `<div class="card"><div class="card-l">${label}</div><div class="card-v ${cls}">${value}</div>${extra?`<div class="card-d ${extra.cls||''}">${extra.txt||extra}</div>`:''}</div>`;
}
function upChart(id,cfg){ if(CHARTS[id])CHARTS[id].destroy(); const c=document.getElementById(id); if(c)CHARTS[id]=new Chart(c,cfg); }

/* ---------- 5. Overview ---------- */
function renderOverview(){
  const t = totals(ROWS);
  const rev = totalRevenue(t);
  const hr = healthRows(ROWS);
  const owed = hr.reduce((s,r)=>s+r.owed,0);
  const restos = byRestaurant(ROWS);
  const active = restos.filter(r=>!/churn/i.test(r.status)).length;
  const churn = restos.filter(r=>/churn/i.test(r.status)).length;

  document.getElementById('ov-cards').innerHTML =
    card('Total revenue',fmt(rev)) +
    card('SaaS',fmt(t.saas)) +
    card('Payment processing',fmt(t.pp)) +
    card('CAMP + Payroll',fmt(t.camp+t.payroll)) +
    card('Effectively owed',fmt(owed),'',owed>0?'owed':'') +
    card('Active · churned',active+' · '+churn);

  // revenue by month stacked
  const months = uniq(ALL.map(r=>r.month)).sort();
  const ds = STREAMS.map(s=>({
    label:s.label,
    data:months.map(m=>Math.round(sumK(ALL.filter(r=>r.month===m),s.key))),
    backgroundColor:s.color, borderRadius:3, stack:'a',
  }));
  document.getElementById('ov-legend').innerHTML = STREAMS.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  upChart('ovChart',{type:'bar',data:{labels:months.map(monthLabel),datasets:ds},
    options:baseOpts({stacked:true})});

  // split donut
  const split = STREAMS.map(s=>({label:s.label,v:t[s.key],c:s.color})).filter(x=>x.v>0);
  upChart('ovSplit',{type:'doughnut',
    data:{labels:split.map(s=>s.label),datasets:[{data:split.map(s=>Math.round(s.v)),backgroundColor:split.map(s=>s.c),borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
      plugins:{legend:{position:'bottom',labels:{boxWidth:9,padding:9,font:{size:11},color:'#73737E'}},
      tooltip:{callbacks:{label:c=>' '+c.label+': '+fmt(c.raw)}}}}});
}

/* ---------- 6. Restaurant health ---------- */
function renderHealth(){
  const hr = healthRows(ROWS);
  const totExp = hr.reduce((s,r)=>s+r.expected,0);
  const totColl = hr.reduce((s,r)=>s+r.collected,0);
  const totOwed = hr.reduce((s,r)=>s+r.owed,0);
  document.getElementById('rh-cards').innerHTML =
    card('Weekly-billed restaurants',hr.length) +
    card('Expected',fmt(totExp)) +
    card('Collected',fmt(totColl)) +
    card('Owed (discounted)',fmt(totOwed),'',totOwed>0?'owed':'');
  drawHealthList(hr);
}
function drawHealthList(hr){
  const q = (document.getElementById('rh-search').value||'').toLowerCase();
  const sort = document.getElementById('rh-sort').value;
  let list = hr.filter(r=>r.restaurant.toLowerCase().includes(q));
  list.sort((a,b)=>{
    if(sort==='health') return a.ratio-b.ratio;
    if(sort==='owed')   return b.owed-a.owed;
    if(sort==='collected') return b.collected-a.collected;
    return a.restaurant.localeCompare(b.restaurant);
  });
  const el = document.getElementById('rh-list');
  if(!list.length){ el.innerHTML='<p class="note" style="padding:14px 0">No restaurants match.</p>'; return; }
  el.innerHTML = list.map(r=>{
    const col = healthColor(r.ratio,r.churned);
    const pct = Math.round(r.ratio*100);
    const tags = [`<span class="tag">${r.platform||'—'}</span>`];
    if(r.hasPayroll) tags.push('<span class="tag pay">Payroll</span>');
    if(r.churned) tags.push('<span class="tag churn">Churned</span>');
    return `<div class="rh-row">
      <div><div class="rh-name">${r.restaurant}</div><div class="rh-tags">${tags.join('')}</div></div>
      <div>
        <div class="bar-tr"><div class="bar-fl" style="width:${clamp(pct,3,100)}%;background:${col}"></div></div>
        <div class="bar-meta"><span>Payment health</span><b style="color:${col}">${pct}%</b></div>
      </div>
      <div class="rh-right">
        <div class="rh-coll">${fmt(r.collected)}</div>
        <div class="rh-exp">of ${fmt(r.expected)} expected</div>
        ${r.owed>0?`<div class="rh-owed">owes ${fmt(r.owed)}</div>`:`<div class="rh-paid">paid in full</div>`}
      </div>
    </div>`;
  }).join('');
}

/* ---------- 7. Payment processing ---------- */
function renderProcessing(){
  const pr = byRestaurant(ROWS).filter(o=>o.pp>0).sort((a,b)=>b.pp-a.pp);
  const tot = pr.reduce((s,r)=>s+r.pp,0);
  const ppOnly = pr.filter(o=>o.saas===0).length;
  document.getElementById('pp-cards').innerHTML =
    card('Commission (period)',fmt(tot)) +
    card('Restaurants on processing',pr.length) +
    card('Processing-only',ppOnly) +
    card('Avg per restaurant',pr.length?fmt(tot/pr.length):'$0');

  const months = uniq(ALL.map(r=>r.month)).sort();
  upChart('ppChart',{type:'bar',
    data:{labels:months.map(monthLabel),datasets:[{label:'Commission',
      data:months.map(m=>Math.round(sumK(ALL.filter(r=>r.month===m),'pp'))),
      backgroundColor:'#B5790E',borderRadius:3}]},
    options:baseOpts({})});

  document.getElementById('pp-list').innerHTML = pr.slice(0,12).map((r,i)=>
    `<div class="mini-item"><span class="nm"><span class="swatch" style="background:${PIE[i%PIE.length]}"></span>${r.restaurant}</span><span class="vl">${fmt(r.pp)}</span></div>`
  ).join('') || '<p class="note" style="padding:12px 0">No processing revenue in this period.</p>';
}

/* ---------- 8. Segments ---------- */
function renderSegments(){
  const payrollOnly = document.getElementById('seg-payroll').checked;
  let restos = byRestaurant(ROWS);
  if(payrollOnly) restos = restos.filter(o=>o.payroll>0);

  const seg = {both:[],saas:[],pp:[]};
  restos.forEach(o=>{
    const s=o.saas>0, p=o.pp>0;
    if(s&&p) seg.both.push(o); else if(s&&!p) seg.saas.push(o); else if(!s&&p) seg.pp.push(o);
  });
  const rev = arr => arr.reduce((t,o)=>t+o.saas+o.pp+o.camp+o.payroll,0);

  const cell = (id,pillCls,pillTxt,arr) =>
    `<div class="mx-cell ${SEG_PICK===id?'sel':''}" data-seg="${id}">
      <span class="mx-pill ${pillCls}">${pillTxt}</span>
      <div class="mx-n">${arr.length}</div>
      <div class="mx-sub">restaurants · ${fmt(rev(arr))}</div>
      <div class="mx-eg">${arr.slice(0,3).map(o=>o.restaurant).join(', ')||'—'}</div>
    </div>`;

  document.getElementById('seg-matrix').innerHTML =
    `<div></div><div class="mx-h">Uses payment processing</div><div class="mx-h">No payment processing</div>
     <div class="mx-rl">Uses SaaS</div>
     ${cell('both','mx-both','Both services',seg.both)}
     ${cell('saas','mx-saas','SaaS only',seg.saas)}
     <div class="mx-rl">No SaaS</div>
     ${cell('pp','mx-pp','Payment processing only',seg.pp)}
     <div class="mx-cell na"><span class="mx-pill mx-na">Not a customer</span><div class="mx-n" style="color:var(--faint)">—</div><div class="mx-sub">no active service</div></div>`;

  document.querySelectorAll('.mx-cell[data-seg]').forEach(c=>c.addEventListener('click',()=>{
    SEG_PICK = c.dataset.seg; renderSegments();
  }));

  const titles = {both:'Both services',saas:'SaaS only',pp:'Payment processing only'};
  const listEl = document.getElementById('seg-list');
  if(SEG_PICK && seg[SEG_PICK]){
    document.getElementById('seg-list-title').textContent = titles[SEG_PICK]+' — '+seg[SEG_PICK].length+' restaurants';
    listEl.innerHTML = seg[SEG_PICK].sort((a,b)=>(b.saas+b.pp)-(a.saas+a.pp)).map((o,i)=>
      `<div class="mini-item"><span class="nm"><span class="swatch" style="background:${PIE[i%PIE.length]}"></span>${o.restaurant}${o.payroll>0?' <span class="tag pay">Payroll</span>':''}</span><span class="vl">${fmt(o.saas+o.pp+o.camp+o.payroll)}</span></div>`
    ).join('');
  } else {
    document.getElementById('seg-list-title').textContent = 'Select a segment above';
    listEl.innerHTML = '<p class="note" style="padding:12px 0">Click a cell in the matrix to list its restaurants.</p>';
  }
}

/* ---------- 9. Forecast ---------- */
function renderForecast(){
  const months = uniq(ALL.map(r=>r.month)).sort();
  const series = months.map(m=>{ const t=totals(ALL.filter(r=>r.month===m)); return totalRevenue(t); });
  const n = series.length;
  document.getElementById('fc-legend').innerHTML = '<span><i style="background:#5B4FE0"></i>Actual</span><span><i style="background:#C8C3F4"></i>Projected</span>';
  if(n<2){ document.getElementById('fc-cards').innerHTML = card('Not enough data','Need 2+ months'); upChart('fcChart',{type:'bar',data:{labels:[],datasets:[]},options:baseOpts({})}); return; }

  const xa=(n-1)/2, ya=series.reduce((a,b)=>a+b,0)/n;
  let num2=0,den=0; series.forEach((y,i)=>{num2+=(i-xa)*(y-ya);den+=(i-xa)**2;});
  const slope=den?num2/den:0, intc=ya-slope*xa;
  const proj=i=>Math.max(0,Math.round(intc+slope*i));

  const labels=[...months.map(monthLabel)], actual=[...series.map(Math.round)], projected=series.map(()=>null);
  for(let p=1;p<=6;p++){ const d=new Date(); d.setMonth(d.getMonth()+p);
    labels.push(d.toLocaleString('default',{month:'short',year:'2-digit'})); actual.push(null); projected.push(proj(n+p-1)); }

  const nextMo=proj(n), nextQ=proj(n)+proj(n+1)+proj(n+2), growth=(slope&&ya)?(slope/ya*100):0;
  document.getElementById('fc-cards').innerHTML =
    card('Next month',fmt(nextMo)) +
    card('Next quarter',fmt(nextQ)) +
    card('Monthly growth',(growth>=0?'+':'')+growth.toFixed(1)+'%','',growth>=0?{cls:'up',txt:'trend'}:{cls:'down',txt:'trend'}) +
    card('Annual run rate',fmt(nextMo*12));

  upChart('fcChart',{type:'bar',data:{labels,datasets:[
    {label:'Actual',data:actual,backgroundColor:'#5B4FE0',borderRadius:3},
    {label:'Projected',data:projected,backgroundColor:'#C8C3F4',borderRadius:3},
  ]},options:baseOpts({})});
}

/* ---------- chart base ---------- */
function baseOpts({stacked}){
  return {responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,
      callbacks:{label:c=>' '+c.dataset.label+': '+(c.raw!=null?fmt(c.raw):'—')}}},
    scales:{x:{stacked:!!stacked,grid:{display:false},ticks:{color:'#73737E',font:{size:11}}},
      y:{stacked:!!stacked,grid:{color:'#EAEAE4'},ticks:{color:'#73737E',font:{size:11},
        callback:v=>'$'+(Math.abs(v)>=1000?(v/1000).toFixed(0)+'k':v)}}}};
}

/* ---------- UI wiring ---------- */
function setSync(ok,txt){ document.getElementById('dot').className='dot '+(ok?'ok':'err'); document.getElementById('syncText').textContent=txt; }
function showErr(h){ const e=document.getElementById('err'); e.hidden=false; e.innerHTML=h; }
function hideErr(){ document.getElementById('err').hidden=true; }

const TITLES={overview:'Overview',restaurants:'Restaurant health',processing:'Payment processing',segments:'Segments',forecast:'Forecast'};

function boot(){
  if(typeof CONFIG!=='undefined' && CONFIG.BRAND){
    document.getElementById('brandName').textContent=CONFIG.BRAND;
    document.title=CONFIG.BRAND;
  }
  document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    b.classList.add('active');
    VIEW=b.dataset.view;
    document.getElementById('v-'+VIEW).classList.add('active');
    document.getElementById('ptitle').textContent=TITLES[VIEW];
    render();
  }));
  document.getElementById('period').addEventListener('change',applyPeriod);
  document.getElementById('refreshBtn').addEventListener('click',loadData);
  document.getElementById('rh-search').addEventListener('input',()=>drawHealthList(healthRows(ROWS)));
  document.getElementById('rh-sort').addEventListener('change',()=>drawHealthList(healthRows(ROWS)));
  document.getElementById('seg-payroll').addEventListener('change',renderSegments);
  loadData();
}

/* ---------- demo data ---------- */
function demoData(){
  const months=['2026-01','2026-02','2026-03','2026-04','2026-05'];
  const defs=[
    // bundled: saas + camp + payroll
    {name:'Flights Las Vegas',plat:'Stripe',saas:881,camp:4429,payroll:465,pp:7176,pay:1.0},
    // both saas + pp
    {name:'Kyoto Palace',plat:'Adyen',saas:877,pp:1106,pay:1.0},
    {name:'20Twenty',plat:'Stripe',saas:438,pp:265,pay:0.87},
    {name:'RW Grill Los Altos',plat:'Adyen',saas:877,pp:35,pay:1.0},
    {name:'Araujos Mexican Grill',plat:'Adyen',saas:332,pp:1140,pay:1.0},
    {name:'Con Azucar',plat:'Adyen',saas:877,pp:642,pay:1.0},
    {name:'Tacos El Compa',plat:'Adyen',saas:332,pp:42,pay:1.0},
    {name:'360 Gourmet Burritos',plat:'Hubspot',saas:158,pp:889,pay:0.66},
    {name:'Nola Street Kitchen',plat:'Hubspot',saas:438,pp:317,pay:1.0},
    {name:'T-Birds Pizza',plat:'Hubspot',saas:332,pp:314,pay:0.98},
    {name:'Kabul Mini Market',plat:'Hubspot',saas:221,pp:259,pay:0.9},
    {name:'Ca Phe Viet – SF',plat:'Hubspot',saas:297,pp:248,pay:0.6},
    {name:'Crema Coffee/Pier 402',plat:'Hubspot',saas:438,pp:150,pay:1.0},
    // saas only
    {name:'Mr Hongs – Gilroy',plat:'Hubspot',saas:311,pp:0,pay:0.0,churn:true},
    {name:'Café Riace',plat:'Adyen',saas:438,pp:0,pay:1.0},
    {name:'Heritage',plat:'Adyen',saas:368,pp:0,pay:1.0,churn:true},
    {name:'Lajevard Eats & Co.',plat:'Hubspot',saas:0,pp:0,pay:0},
    // pp only
    {name:'Boloco',plat:'Stripe',saas:0,pp:837,pay:1.0},
    {name:'Maple House',plat:'Stripe',saas:0,pp:601,pay:1.0},
    {name:'La Esquina Mexican Food',plat:'Stripe',saas:0,pp:210,pay:1.0},
    {name:'LGCRC',plat:'Stripe',saas:0,pp:881,pay:1.0},
    {name:'Haleh Pastry',plat:'Stripe',saas:0,pp:380,pay:1.0},
    {name:'Elements',plat:'Stripe',saas:0,pp:379,pay:1.0},
    {name:'The Posh Bagel',plat:'Stripe',saas:0,pp:250,pay:1.0},
    {name:'Rendezvous',plat:'Stripe',saas:0,pp:254,pay:1.0},
    {name:'Kati Rolls',plat:'Stripe',saas:0,pp:238,pay:1.0},
    {name:'Crazy Pita (Henderson)',plat:'Stripe',saas:0,pp:52,pay:1.0},
    {name:'Constance',plat:'Stripe',saas:0,pp:62,pay:1.0},
  ];
  const rows=[];
  defs.forEach((d,idx)=>{
    months.forEach((m,mi)=>{
      const growth = 1 + (mi*0.03) + (Math.random()*0.06-0.03);
      const saasAcc = Math.round(d.saas*growth);
      // collected = pay-rate of expected (introduces owed for low payers)
      const payRate = d.churn && mi>=3 ? 0 : (d.pay + (Math.random()*0.06-0.03));
      const grossColl = Math.round(saasAcc * clamp(payRate,0,1.05));
      const fees = Math.round(grossColl*0.022);
      rows.push({
        month:m, refId:230000000+idx, restaurant:d.name,
        status: d.churn && mi>=3 ? 'Churned':'Active',
        platform:d.plat, onboard:'Before Jan 2026', cancel: d.churn&&mi===3?'Apr-26':'',
        gross:grossColl, fees, net:grossColl-fees, refunds:0,
        platformFee:Math.round(saasAcc*0.2), perDay:+(saasAcc/30).toFixed(2), days:30,
        pp:Math.round((d.pp||0)*growth), saas:saasAcc,
        payroll:Math.round((d.payroll||0)*growth), camp:Math.round((d.camp||0)*growth),
      });
    });
  });
  return rows;
}
