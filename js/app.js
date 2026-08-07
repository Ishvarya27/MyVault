/* =========================================================
   app.js — MyVault application logic
   ---------------------------------------------------------
   Everything here (state, calculations, chart drawing, view
   rendering, and event wiring) is unchanged from the original
   single-file build — only its location moved. It relies on
   db.js being loaded first (see index.html) for all storage.
   ========================================================= */

/* ---------- helpers ---------- */
const CATS = [
  {id:'groceries', label:'Groceries', icon:'🛒', color:'#4F9C82'},
  {id:'fashion', label:'Fashion', icon:'👗', color:'#C1614A'},
  {id:'housing', label:'Rent / Housing', icon:'🏠', color:'#C9A15C'},
  {id:'utilities', label:'Utilities', icon:'💡', color:'#7CA6C9'},
  {id:'transport', label:'Transport', icon:'🚗', color:'#9C7FC9'},
  {id:'entertainment', label:'Entertainment', icon:'🎬', color:'#C99C4F'},
  {id:'health', label:'Health', icon:'💊', color:'#5CC9A8'},
  {id:'other', label:'Other', icon:'🧾', color:'#8B9791'},
];
const INV_TYPES = [
  {id:'fd', label:'Fixed Deposit', icon:'🏦'},
  {id:'rd', label:'Recurring Deposit', icon:'🔁'},
  {id:'stocks', label:'Stocks / MF', icon:'📈'},
  {id:'gold', label:'Gold', icon:'🟡'},
  {id:'other', label:'Other', icon:'＋'},
];
function catInfo(id){ return CATS.find(c=>c.id===id) || CATS[CATS.length-1]; }
function fmt(n){ n = Math.round(Number(n)||0); return n.toLocaleString('en-IN'); }
function monthId(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function monthLabel(id){
  const [y,m] = id.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 1800);
}

// In-app confirmation modal. We use this instead of window.confirm() because native
// browser dialogs (confirm/alert/prompt) can be silently blocked in a sandboxed
// preview, which made delete buttons look broken with no visible popup at all.
function showConfirm(message, onConfirm, confirmLabel='Delete'){
  const root = document.getElementById('confirmModalRoot');
  root.innerHTML = `
  <div class="modal-backdrop" id="confirmBackdrop">
    <div class="modal">
      <div class="modal-head"><h3>Are you sure?</h3><button class="modal-close" id="confirmCloseBtn">&times;</button></div>
      <p style="font-size:13.5px; color:var(--muted); line-height:1.5; margin:6px 0 4px;">${message}</p>
      <div class="row-actions">
        <button class="btn ghost full" id="confirmCancelBtn">Cancel</button>
        <button class="btn danger full" id="confirmOkBtn">${confirmLabel}</button>
      </div>
    </div>
  </div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('confirmCloseBtn').onclick = close;
  document.getElementById('confirmCancelBtn').onclick = close;
  document.getElementById('confirmBackdrop').onclick = (e)=>{ if(e.target.id==='confirmBackdrop') close(); };
  document.getElementById('confirmOkBtn').onclick = async ()=>{ close(); await onConfirm(); };
}

/* ---------- state ---------- */
let state = {
  currentMonth: monthId(new Date()),
  months: {},      // id -> {id, salary, investments:{fd,rd,stocks,gold,other}, expenses:[{id,cat,amount,note,date}]}
  goals: [],        // {id,name,target,targetDate,linkType,manual:[{id,amount,date}]}
  holdings: [],     // {id,type,label,amount,startDate,closeDate,notes} — already-made investments with a maturity date
  reminders: [],    // {id,label,monthDay:'MM-DD',before,after} — recurring annual reminders (ITR, TDS form, etc)
};

const DEFAULT_REMINDERS = [
  {id:'itr', label:'File your ITR', monthDay:'07-01', before:30, after:15, builtin:true},
  {id:'tds', label:'Renew TDS Form 12BB', monthDay:'03-31', before:30, after:10, builtin:true},
];

async function loadHoldings(){
  state.holdings = await idbGetAll('holdings');
}
async function loadReminders(){
  // reminders are stored individually in the 'meta' store under key 'reminder:<id>'
  const all = await idbGetAll('meta');
  const stored = all.filter(x=> x.key && x.key.startsWith('reminder:')).map(x=> x.value);
  if(stored.length === 0){
    for(const r of DEFAULT_REMINDERS){ await idbPut('meta', {key:'reminder:'+r.id, value:r}); }
    state.reminders = DEFAULT_REMINDERS.slice();
  } else {
    state.reminders = stored;
  }
}
async function saveReminder(r){
  await idbPut('meta', {key:'reminder:'+r.id, value:r});
  const i = state.reminders.findIndex(x=>x.id===r.id);
  if(i>=0) state.reminders[i] = r; else state.reminders.push(r);
}
async function deleteReminder(id){
  await idbDelete('meta', 'reminder:'+id);
  state.reminders = state.reminders.filter(x=>x.id!==id);
}

function emptyMonth(id){
  return {id, salary:0, investments:{fd:0, rd:0, stocks:0, gold:0, other:0}, expenses:[]};
}
async function getMonth(id){
  if(state.months[id]) return state.months[id];
  let m = await idbGet('months', id);
  if(!m) m = emptyMonth(id);
  state.months[id] = m;
  return m;
}
async function saveMonth(m){
  state.months[m.id] = m;
  await idbPut('months', m);
}
async function loadAllMonths(){
  const all = await idbGetAll('months');
  all.forEach(m=> state.months[m.id] = m);
}
async function loadGoals(){
  state.goals = await idbGetAll('goals');
}

/* ---------- computed ---------- */
// Combines a month's manually-entered investments with any "already-made investments"
// (holdings) whose start date falls in that month, so holdings auto-populate the
// month they belong to without needing to duplicate the number by hand.
function effectiveInvestments(id){
  const m = state.months[id];
  const result = {fd:0, rd:0, stocks:0, gold:0, other:0};
  if(m && m.investments){
    INV_TYPES.forEach(t=>{ result[t.id] = Number(m.investments[t.id])||0; });
  }
  state.holdings.forEach(h=>{
    if(h.startDate && h.startDate.slice(0,7) === id){
      const type = INV_TYPES.some(t=>t.id===h.type) ? h.type : 'other';
      result[type] = (result[type]||0) + (Number(h.amount)||0);
    }
  });
  return result;
}
// All month ids that have either a saved monthly record or a holding started in them —
// used so investment charts/history include months even if "Save month" was never pressed.
function monthsWithDataSorted(){
  const set = new Set(Object.keys(state.months));
  state.holdings.forEach(h=>{ if(h.startDate) set.add(h.startDate.slice(0,7)); });
  return Array.from(set).sort();
}
function holdingsStartedInMonth(id){
  return state.holdings.filter(h=> h.startDate && h.startDate.slice(0,7)===id)
    .reduce((s,h)=> s+(Number(h.amount)||0), 0);
}

function monthTotals(m){
  const investments = effectiveInvestments(m.id);
  const invested = Object.values(investments).reduce((a,b)=>a+(Number(b)||0),0);
  const spent = (m.expenses||[]).reduce((a,e)=>a+(Number(e.amount)||0),0);
  // "Remaining" is cash actually available to spend: salary minus spending only.
  // Investments are tracked separately so putting money into FD/RD/Gold never makes this look like a deficit.
  const remaining = (Number(m.salary)||0) - spent;
  const afterInvestments = remaining - invested;
  return {invested, spent, remaining, afterInvestments, investments};
}

/* ---------- holdings (already-made investments with a maturity/close date) ---------- */
async function saveHolding(h){
  await idbPut('holdings', h);
  const i = state.holdings.findIndex(x=>x.id===h.id);
  if(i>=0) state.holdings[i]=h; else state.holdings.push(h);
}
async function deleteHolding(id){
  await idbDelete('holdings', id);
  state.holdings = state.holdings.filter(x=>x.id!==id);
}
function daysUntil(dateStr){
  const target = new Date(dateStr+'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((target-today)/(1000*60*60*24));
}
function holdingsSorted(){
  return state.holdings.slice().sort((a,b)=> (a.closeDate||'9999').localeCompare(b.closeDate||'9999'));
}
function urgencyColor(days){
  if(days < 0) return 'var(--rust)';
  if(days <= 7) return 'var(--rust)';
  if(days <= 30) return 'var(--brass)';
  return 'var(--emerald)';
}

/* ---------- annual reminders (ITR, TDS form, etc) ---------- */
function nextOccurrence(monthDay){
  const [mm, dd] = monthDay.split('-').map(Number);
  const today = new Date(); today.setHours(0,0,0,0);
  let year = today.getFullYear();
  let occ = new Date(year, mm-1, dd);
  return occ;
}
function reminderStatus(r){
  const today = new Date(); today.setHours(0,0,0,0);
  const [mm, dd] = r.monthDay.split('-').map(Number);
  let occ = new Date(today.getFullYear(), mm-1, dd);
  let days = Math.round((occ-today)/(1000*60*60*24));
  // if it's more than `after` days in the past, roll to next year's occurrence
  if(days < -(r.after||0)){
    occ = new Date(today.getFullYear()+1, mm-1, dd);
    days = Math.round((occ-today)/(1000*60*60*24));
  }
  const active = days <= (r.before||30) && days >= -(r.after||0);
  return {days, active, date:occ};
}
function catBreakdown(m){
  const map = {};
  CATS.forEach(c=> map[c.id]=0);
  (m.expenses||[]).forEach(e=> map[e.cat] = (map[e.cat]||0) + (Number(e.amount)||0));
  return map;
}
function allMonthsSorted(){
  return Object.values(state.months).sort((a,b)=> a.id.localeCompare(b.id));
}
function totalInvestedAllTime(type){
  return monthsWithDataSorted().reduce((sum,id)=> sum + (Number(effectiveInvestments(id)[type])||0), 0);
}

/* ---------- goal progress ---------- */
function goalProgress(g){
  let current = 0;
  if(g.linkType === 'manual'){
    current = (g.manual||[]).reduce((a,c)=>a+(Number(c.amount)||0),0);
  } else {
    current = totalInvestedAllTime(g.linkType);
  }
  const pct = g.target > 0 ? Math.min(100, Math.round((current/g.target)*100)) : 0;
  return {current, pct};
}

/* =========================================================
   RENDERING
   ========================================================= */
/* =========================================================
   Lightweight built-in charts — no external library.
   Chart.js was loaded from a CDN, which can be blocked by the
   network, an ad-blocker, or a sandboxed preview (as happened
   here) — leaving all chart-dependent screens permanently
   broken with no way to recover. These hand-drawn SVG charts
   need nothing but the browser, so they always render.
   ========================================================= */
function svgEl(tag, attrs){
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for(const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function emptyChartMsg(container, msg='Nothing to show yet.'){
  container.innerHTML = `<div class="empty" style="padding:30px 10px;"><p>${msg}</p></div>`;
}
// Stacked bar chart: labels along x-axis, each dataset is one stacked color band.
function renderBarChart(containerId, labels, datasets){
  const container = document.getElementById(containerId);
  if(!container) return;
  container.innerHTML = '';
  const hasData = labels.length && datasets.some(ds=> ds.data.some(v=> Number(v)>0));
  if(!hasData){ emptyChartMsg(container); return; }

  const W = 640, H = 220, padL = 6, padR = 6, padT = 10, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = labels.length;
  const barSlot = plotW / n;
  const barW = Math.max(6, Math.min(34, barSlot*0.55));
  const totals = labels.map((_,i)=> datasets.reduce((s,ds)=> s+(Number(ds.data[i])||0), 0));
  const max = Math.max(1, ...totals);

  const svg = svgEl('svg', {viewBox:`0 0 ${W} ${H}`, width:'100%', preserveAspectRatio:'xMidYMid meet'});
  svg.style.display = 'block';
  for(let g=0; g<=3; g++){
    const y = padT + plotH - (g/3)*plotH;
    svg.appendChild(svgEl('line', {x1:padL, x2:W-padR, y1:y, y2:y, stroke:'#2A3A34', 'stroke-width':1}));
  }
  labels.forEach((lab,i)=>{
    const x = padL + i*barSlot + (barSlot-barW)/2;
    let yCursor = padT + plotH;
    datasets.forEach(ds=>{
      const v = Number(ds.data[i])||0;
      if(v<=0) return;
      const h = (v/max)*plotH;
      yCursor -= h;
      const rect = svgEl('rect', {x:x.toFixed(2), y:yCursor.toFixed(2), width:barW.toFixed(2), height:Math.max(1,h).toFixed(2), fill:ds.color, rx:2});
      const title = svgEl('title', {}); title.textContent = `${ds.label} — ${lab}: ₹${fmt(v)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    const showEvery = n>8 ? Math.ceil(n/8) : 1;
    if(i % showEvery === 0){
      const text = svgEl('text', {x:(x+barW/2).toFixed(2), y:H-12, 'text-anchor':'middle', fill:'#8B9791', 'font-size':10, 'font-family':'Inter,sans-serif'});
      text.textContent = lab;
      svg.appendChild(text);
    }
  });
  container.appendChild(svg);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px 16px; justify-content:center; margin-top:12px;';
  datasets.forEach(ds=>{
    if(!ds.data.some(v=>Number(v)>0)) return;
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:11.5px; color:#8B9791;';
    item.innerHTML = `<span style="width:9px;height:9px;border-radius:2px;background:${ds.color};display:inline-block;flex-shrink:0;"></span>${ds.label}`;
    legend.appendChild(item);
  });
  container.appendChild(legend);
}
// Pie / doughnut chart with a bottom legend showing amounts.
function renderPieChart(containerId, labels, values, colors, {doughnut=false}={}){
  const container = document.getElementById(containerId);
  if(!container) return;
  container.innerHTML = '';
  const total = values.reduce((a,b)=>a+(Number(b)||0),0);
  if(total<=0){ emptyChartMsg(container); return; }

  const size = 200, r = 84, cx = size/2, cy = size/2, inner = doughnut ? r*0.58 : 0;
  const svg = svgEl('svg', {viewBox:`0 0 ${size} ${size}`, width:180, height:180, style:'display:block; margin:6px auto;'});
  let angle = -Math.PI/2;
  const activeCount = values.filter(v=>Number(v)>0).length;
  labels.forEach((lab,i)=>{
    const v = Number(values[i])||0;
    if(v<=0) return;
    const frac = v/total;
    let path;
    if(activeCount===1){
      // full circle (or ring) — arc math degenerates for a single 360° slice
      if(inner>0){
        path = svgEl('circle', {cx, cy, r:(r+inner)/2, fill:'none', stroke:colors[i%colors.length], 'stroke-width':r-inner});
      } else {
        path = svgEl('circle', {cx, cy, r, fill:colors[i%colors.length]});
      }
    } else {
      const nextAngle = angle + frac*Math.PI*2;
      const x1 = cx + r*Math.cos(angle), y1 = cy + r*Math.sin(angle);
      const x2 = cx + r*Math.cos(nextAngle), y2 = cy + r*Math.sin(nextAngle);
      const large = (nextAngle-angle) > Math.PI ? 1 : 0;
      let d;
      if(inner>0){
        const ix1 = cx + inner*Math.cos(angle), iy1 = cy + inner*Math.sin(angle);
        const ix2 = cx + inner*Math.cos(nextAngle), iy2 = cy + inner*Math.sin(nextAngle);
        d = `M ${ix1.toFixed(2)} ${iy1.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z`;
      } else {
        d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      }
      path = svgEl('path', {d, fill:colors[i%colors.length]});
      angle = nextAngle;
    }
    path.setAttribute('stroke', '#152420');
    path.setAttribute('stroke-width', 2);
    const title = svgEl('title', {}); title.textContent = `${lab}: ₹${fmt(v)}`;
    path.appendChild(title);
    svg.appendChild(path);
  });
  container.appendChild(svg);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px 16px; justify-content:center; margin-top:10px;';
  labels.forEach((lab,i)=>{
    if(Number(values[i])<=0) return;
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:12px; color:#EDE6D6;';
    item.innerHTML = `<span style="width:9px;height:9px;border-radius:50%;background:${colors[i%colors.length]};display:inline-block;flex-shrink:0;"></span>${lab}: ₹${fmt(values[i])}`;
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

let charts = {};

async function renderMonthPill(){
  document.getElementById('monthLabel').textContent = monthLabel(state.currentMonth);
  document.getElementById('salaryMonthLabel').textContent = monthLabel(state.currentMonth);
}

async function renderDashboard(){
  const m = await getMonth(state.currentMonth);
  const t = monthTotals(m);
  document.getElementById('heroRemaining').textContent = fmt(t.remaining);
  document.getElementById('statSalary').textContent = '₹'+fmt(m.salary);
  document.getElementById('statInvested').textContent = '₹'+fmt(t.invested);
  document.getElementById('statSpent').textContent = '₹'+fmt(t.spent);
  const heroEl = document.getElementById('heroRemaining');
  heroEl.parentElement.querySelector('.cur').style.color = t.remaining < 0 ? 'var(--rust)' : 'var(--brass)';
  heroEl.style.color = t.remaining < 0 ? 'var(--rust)' : 'var(--paper)';

  const heroSub = document.getElementById('heroSub');
  if(t.afterInvestments < 0){
    heroSub.innerHTML = `Salary minus spending. <span style="color:var(--brass);">After this month's ₹${fmt(t.invested)} in investments, you're using ₹${fmt(Math.abs(t.afterInvestments))} from savings.</span>`;
  } else {
    heroSub.textContent = 'Salary minus spending — investments are tracked separately below.';
  }

  // ---- reminder banners (stack: monthly salary nudge, holding maturities, annual reminders) ----
  const today = new Date();
  const reminderSlot = document.getElementById('reminderSlot');
  const thisMonthId = monthId(today);
  const thisMonth = await getMonth(thisMonthId);
  let banners = [];

  if(today.getDate() <= 5 && (!thisMonth.salary || thisMonth.salary === 0)){
    banners.push({
      html: `<p>New month — <strong>log your ${monthLabel(thisMonthId)} salary</strong> and how much you're investing.</p>
             <button class="btn small" id="bannerLogBtn">Log now</button>`,
      after: (el)=>{ el.querySelector('#bannerLogBtn').onclick = ()=>{ state.currentMonth = thisMonthId; renderAll(); switchView('salary'); }; }
    });
  }

  holdingsSorted().forEach(h=>{
    if(!h.closeDate) return;
    const days = daysUntil(h.closeDate);
    if(days <= 30 && days >= -7){
      const when = days === 0 ? 'today' : days > 0 ? `in ${days} day${days===1?'':'s'}` : `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} ago`;
      banners.push({
        html: `<p><strong>${h.label || (INV_TYPES.find(t=>t.id===h.type)?.label)}</strong> (₹${fmt(h.amount)}) matures ${when} — ${new Date(h.closeDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}.</p>
               <button class="btn small secondary" data-goto-holding="${h.id}">View</button>`,
        after: (el)=>{ el.querySelector('[data-goto-holding]').onclick = ()=> switchView('salary'); }
      });
    }
  });

  state.reminders.forEach(r=>{
    const {days, active} = reminderStatus(r);
    if(active){
      const when = days === 0 ? 'today' : days > 0 ? `in ${days} day${days===1?'':'s'}` : `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`;
      banners.push({
        html: `<p>📌 <strong>${r.label}</strong> — due ${when}.</p>
               <button class="btn small ghost" data-goto-settings="1">Manage</button>`,
        after: (el)=>{ el.querySelector('[data-goto-settings]').onclick = ()=> switchView('settings'); }
      });
    }
  });

  if(banners.length === 0){
    reminderSlot.innerHTML = '';
  } else {
    reminderSlot.innerHTML = banners.map(()=> `<div class="banner"></div>`).join('');
    const els = reminderSlot.querySelectorAll('.banner');
    banners.forEach((b,i)=>{ els[i].innerHTML = b.html; if(b.after) b.after(els[i]); });
  }

  // investments card (manual month entries + any holdings started this month)
  const investCard = document.getElementById('investCard');
  if(t.invested === 0){
    investCard.innerHTML = `<div class="empty"><div class="big">🏦</div><p>No investments logged for this month yet.</p></div>`;
  } else {
    const rowsHtml = INV_TYPES.filter(it=> (t.investments[it.id]||0) > 0).map(it=>{
      const val = t.investments[it.id]||0;
      const pct = t.invested>0 ? Math.round((val/t.invested)*100) : 0;
      return `<div class="cat-row">
        <div class="cat-icon" style="background:var(--panel-2);">${it.icon}</div>
        <div class="cat-info">
          <div class="cat-name"><span>${it.label}</span><span class="cat-amt mono">₹${fmt(val)}</span></div>
          <div class="cat-track"><div class="cat-fill" style="width:${pct}%; background:var(--brass);"></div></div>
        </div>
      </div>`;
    }).join('');
    const fromHoldings = holdingsStartedInMonth(m.id);
    const noteHtml = fromHoldings > 0
      ? `<p style="font-size:11px; color:var(--muted); margin:10px 0 0;">Includes ₹${fmt(fromHoldings)} from investments logged with a start date in ${monthLabel(m.id)}.</p>`
      : '';
    investCard.innerHTML = rowsHtml + noteHtml;
  }

  // category card
  const breakdown = catBreakdown(m);
  const catCard = document.getElementById('catCard');
  const spentTotal = t.spent;
  if(spentTotal === 0){
    catCard.innerHTML = `<div class="empty"><div class="big">🧾</div><p>No expenses logged yet this month. Tap "Add expense" to start tracking.</p></div>`;
  } else {
    catCard.innerHTML = CATS.filter(c=> breakdown[c.id] > 0).sort((a,b)=>breakdown[b.id]-breakdown[a.id]).map(c=>{
      const val = breakdown[c.id];
      const pct = spentTotal>0 ? Math.round((val/spentTotal)*100) : 0;
      return `<div class="cat-row">
        <div class="cat-icon" style="background:var(--panel-2);">${c.icon}</div>
        <div class="cat-info">
          <div class="cat-name"><span>${c.label}</span><span class="cat-amt mono">₹${fmt(val)}</span></div>
          <div class="cat-track"><div class="cat-fill" style="width:${pct}%; background:${c.color};"></div></div>
        </div>
      </div>`;
    }).join('');
  }

  // goals preview (top 2)
  const goalPreview = document.getElementById('goalPreview');
  if(state.goals.length === 0){
    goalPreview.innerHTML = `<div class="card"><div class="empty" style="padding:20px 10px;"><p>No goals yet. Set one from the Goals tab to track your progress.</p></div></div>`;
  } else {
    goalPreview.innerHTML = state.goals.slice(0,2).map(g=> renderGoalCard(g)).join('');
  }
}

function ringSvg(pct, size=58, stroke=6, color='var(--emerald)'){
  const r = (size-stroke)/2;
  const c = 2*Math.PI*r;
  const off = c - (pct/100)*c;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--line)" stroke-width="${stroke}" fill="none"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round"/>
  </svg>`;
}

function renderGoalCard(g){
  const {current, pct} = goalProgress(g);
  const typeLabel = g.linkType === 'manual' ? 'Manual savings' : INV_TYPES.find(t=>t.id===g.linkType)?.label;
  let dateNote = '';
  if(g.targetDate){
    const d = new Date(g.targetDate);
    const now = new Date();
    const months = Math.max(0, (d.getFullYear()-now.getFullYear())*12 + (d.getMonth()-now.getMonth()));
    dateNote = ` · by ${d.toLocaleDateString('en-IN',{month:'short', year:'numeric'})}`;
  }
  const color = pct >= 100 ? 'var(--emerald)' : (pct >= 60 ? 'var(--brass)' : 'var(--rust)');
  return `<div class="card goal-card" data-goal="${g.id}">
    <div class="ring">${ringSvg(pct, 58, 6, color)}<div class="pct">${pct}%</div></div>
    <div class="goal-body">
      <div class="goal-name">${g.name}</div>
      <div class="goal-meta"><span class="brass mono">₹${fmt(current)}</span> of ₹${fmt(g.target)} · ${typeLabel}${dateNote}</div>
    </div>
  </div>`;
}

async function renderGoalsView(){
  const list = document.getElementById('goalsList');
  if(state.goals.length === 0){
    list.innerHTML = `<div class="empty"><div class="big">🎯</div><p>Set a goal — like "₹2,00,000 in Stocks by Dec 2026" — and MyVault will track how close you are, month by month.</p></div>`;
    return;
  }
  list.innerHTML = state.goals.map(g=>{
    return `<div style="position:relative;">
      ${renderGoalCard(g)}
      <div style="display:flex; gap:8px; margin:-6px 0 14px;">
        ${g.linkType==='manual' ? `<button class="btn small secondary" data-contribute="${g.id}">+ Add contribution</button>` : ''}
        <button class="btn small ghost" data-delgoal="${g.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-delgoal]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-delgoal');
      showConfirm('Delete this goal?', async ()=>{
        await idbDelete('goals', id);
        state.goals = state.goals.filter(g=>g.id!==id);
        renderGoalsView(); renderDashboard();
      });
    };
  });
  list.querySelectorAll('[data-contribute]').forEach(btn=>{
    btn.onclick = ()=> openContributeModal(btn.getAttribute('data-contribute'));
  });
}

function openGoalModal(){
  const root = document.getElementById('goalModalRoot');
  root.innerHTML = `
  <div class="modal-backdrop" id="goalBackdrop">
    <div class="modal">
      <div class="modal-head"><h3>New goal</h3><button class="modal-close" id="closeGoalModal">&times;</button></div>
      <label>Goal name</label>
      <input type="text" id="goalName" placeholder="e.g. Emergency fund">
      <label>Target amount (₹)</label>
      <input type="number" id="goalTarget" class="mono" placeholder="0">
      <label>Target date (optional)</label>
      <input type="date" id="goalDate">
      <label>Track progress using</label>
      <div class="chip-row" id="goalTypeChips">
        ${INV_TYPES.map(t=>`<div class="chip" data-type="${t.id}">${t.icon} ${t.label}</div>`).join('')}
        <div class="chip" data-type="manual">✍️ Manual entries</div>
      </div>
      <div class="row-actions">
        <button class="btn full" id="saveGoalBtn">Save goal</button>
      </div>
    </div>
  </div>`;
  let chosenType = 'stocks';
  const chips = root.querySelectorAll('#goalTypeChips .chip');
  chips.forEach(c=> c.onclick = ()=>{ chips.forEach(x=>x.classList.remove('active')); c.classList.add('active'); chosenType = c.getAttribute('data-type'); });
  chips[2].classList.add('active');
  document.getElementById('closeGoalModal').onclick = ()=> root.innerHTML='';
  document.getElementById('goalBackdrop').onclick = (e)=>{ if(e.target.id==='goalBackdrop') root.innerHTML=''; };
  document.getElementById('saveGoalBtn').onclick = async ()=>{
    const name = document.getElementById('goalName').value.trim();
    const target = Number(document.getElementById('goalTarget').value);
    const date = document.getElementById('goalDate').value;
    if(!name || !target){ showToast('Add a name and target amount'); return; }
    const g = {id:uid(), name, target, targetDate:date||null, linkType:chosenType, manual:[]};
    await idbPut('goals', g);
    state.goals.push(g);
    root.innerHTML='';
    renderGoalsView(); renderDashboard();
    showToast('Goal saved');
  };
}

function openContributeModal(goalId){
  const g = state.goals.find(x=>x.id===goalId);
  const root = document.getElementById('goalModalRoot');
  root.innerHTML = `
  <div class="modal-backdrop" id="contribBackdrop">
    <div class="modal">
      <div class="modal-head"><h3>Add to "${g.name}"</h3><button class="modal-close" id="closeContribModal">&times;</button></div>
      <label>Amount (₹)</label>
      <input type="number" id="contribAmount" class="mono" placeholder="0">
      <div class="row-actions"><button class="btn full" id="saveContribBtn">Add</button></div>
    </div>
  </div>`;
  document.getElementById('closeContribModal').onclick = ()=> root.innerHTML='';
  document.getElementById('contribBackdrop').onclick=(e)=>{ if(e.target.id==='contribBackdrop') root.innerHTML='';};
  document.getElementById('saveContribBtn').onclick = async ()=>{
    const amt = Number(document.getElementById('contribAmount').value);
    if(!amt){ showToast('Enter an amount'); return; }
    g.manual = g.manual || [];
    g.manual.push({id:uid(), amount:amt, date:new Date().toISOString()});
    await idbPut('goals', g);
    root.innerHTML='';
    renderGoalsView(); renderDashboard();
    showToast('Contribution added');
  };
}

/* ---------- Add / expenses view ---------- */
let selectedCat = 'groceries';
function renderExpenseCatChips(){
  const el = document.getElementById('expCatChips');
  el.innerHTML = CATS.map(c=>`<div class="chip ${c.id===selectedCat?'active':''}" data-cat="${c.id}">${c.icon} ${c.label}</div>`).join('');
  el.querySelectorAll('.chip').forEach(chip=>{
    chip.onclick = ()=>{ selectedCat = chip.getAttribute('data-cat'); renderExpenseCatChips(); };
  });
}

async function renderExpenseList(){
  const m = await getMonth(state.currentMonth);
  const list = document.getElementById('expenseList');
  const items = (m.expenses||[]).slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  if(items.length===0){
    list.innerHTML = `<div class="empty"><div class="big">📭</div><p>No expenses logged for ${monthLabel(state.currentMonth)} yet.</p></div>`;
    return;
  }
  list.innerHTML = items.map(e=>{
    const c = catInfo(e.cat);
    const d = e.date ? new Date(e.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '';
    return `<div class="exp-item">
      <div class="exp-left">
        <div class="cat-icon" style="width:30px;height:30px;background:var(--panel-2); border-radius:8px; display:flex; align-items:center; justify-content:center;">${c.icon}</div>
        <div>
          <div class="exp-cat">${c.label}</div>
          <div class="exp-note">${e.note ? e.note+' · ' : ''}${d}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <div class="exp-amt">−₹${fmt(e.amount)}</div>
        <button class="exp-del" data-del="${e.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-del');
      const item = (m.expenses||[]).find(x=>x.id===id);
      const desc = item ? `${catInfo(item.cat).label} — ₹${fmt(item.amount)}` : 'this expense';
      showConfirm(`Delete ${desc}?`, async ()=>{
        try{
          m.expenses = m.expenses.filter(x=>x.id!==id);
          await saveMonth(m);
          renderExpenseList(); renderDashboard();
        }catch(err){
          console.error('Delete expense failed:', err);
          showToast('Could not delete — please try again');
        }
      });
    };
  });
}

/* ---------- Salary/investment view ---------- */
async function renderSalaryView(){
  const m = await getMonth(state.currentMonth);
  document.getElementById('salaryInput').value = m.salary || '';
  document.getElementById('inv_fd').value = m.investments?.fd || '';
  document.getElementById('inv_rd').value = m.investments?.rd || '';
  document.getElementById('inv_stocks').value = m.investments?.stocks || '';
  document.getElementById('inv_gold').value = m.investments?.gold || '';
  document.getElementById('inv_other').value = m.investments?.other || '';
  // Data lists render first, unconditionally — chart drawing (which can fail if
  // Chart.js hasn't loaded, e.g. on a flaky connection) must never block them.
  renderHoldingTypeChips();
  renderHoldingsList();
  renderInvestHistoryChart();
}

function renderInvestHistoryChart(){
  try{
    const monthIds = monthsWithDataSorted().slice(-12);
    const labels = monthIds.map(id=> monthLabel(id).split(' ')[0]+" '"+id.slice(2,4));
    const datasets = INV_TYPES.map((t,i)=>({
      label:t.label,
      data: monthIds.map(id=> effectiveInvestments(id)[t.id]||0),
      color: ['#C9A15C','#4F9C82','#7CA6C9','#E8C766','#8B9791'][i],
    }));
    renderBarChart('investHistoryChart', labels, datasets);
  }catch(err){ console.error('renderInvestHistoryChart failed:', err); }
}

/* ---------- Holdings (already-made investments) UI ---------- */
let selectedHoldingType = 'fd';
function renderHoldingTypeChips(){
  const el = document.getElementById('holdingTypeChips');
  el.innerHTML = INV_TYPES.map(t=>`<div class="chip ${t.id===selectedHoldingType?'active':''}" data-htype="${t.id}">${t.icon} ${t.label}</div>`).join('');
  el.querySelectorAll('.chip').forEach(chip=>{
    chip.onclick = ()=>{ selectedHoldingType = chip.getAttribute('data-htype'); renderHoldingTypeChips(); };
  });
}
function renderHoldingsList(){
  const list = document.getElementById('holdingsList');
  const items = holdingsSorted();
  if(items.length===0){
    list.innerHTML = `<div class="empty"><div class="big">📄</div><p>No existing investments logged yet. Add an FD, RD, or gold purchase above to track its maturity date.</p></div>`;
    return;
  }
  list.innerHTML = items.map(h=>{
    const it = INV_TYPES.find(t=>t.id===h.type) || INV_TYPES[INV_TYPES.length-1];
    const days = h.closeDate ? daysUntil(h.closeDate) : null;
    const color = days===null ? 'var(--muted)' : urgencyColor(days);
    const dayText = days===null ? 'No close date' : (days>=0 ? `${days} day${days===1?'':'s'} left` : `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`);
    const monthNote = h.startDate ? `counted in ${monthLabel(h.startDate.slice(0,7))}` : 'no start date — not counted in totals';
    return `<div class="exp-item">
      <div class="exp-left">
        <div class="cat-icon" style="width:30px;height:30px;background:var(--panel-2); border-radius:8px; display:flex; align-items:center; justify-content:center;">${it.icon}</div>
        <div>
          <div class="exp-cat">${h.label || it.label}</div>
          <div class="exp-note">₹${fmt(h.amount)} · matures ${h.closeDate ? new Date(h.closeDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'} · ${monthNote}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:11px; color:${color}; font-family:'IBM Plex Mono',monospace; white-space:nowrap;">${dayText}</span>
        <button class="exp-del" data-delholding="${h.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-delholding]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-delholding');
      const h = state.holdings.find(x=>x.id===id);
      const label = h ? (h.label || (INV_TYPES.find(t=>t.id===h.type)?.label)) : 'this investment';
      showConfirm(`Delete "${label}"? This can't be undone.`, async ()=>{
        try{
          await deleteHolding(id);
          renderHoldingsList();
          renderDashboard();
          showToast('Investment deleted');
        }catch(err){
          console.error('Delete failed:', err);
          showToast('Could not delete — please try again');
        }
        renderInvestHistoryChart();
      });
    };
  });
}
document.getElementById('saveHolding').onclick = async ()=>{
  const amount = Number(document.getElementById('holdingAmount').value);
  const label = document.getElementById('holdingLabel').value.trim();
  const start = document.getElementById('holdingStart').value;
  const close = document.getElementById('holdingClose').value;
  if(!amount){ showToast('Enter an amount'); return; }
  try{
    await saveHolding({id:uid(), type:selectedHoldingType, label, amount, startDate:start||null, closeDate:close||null});
    document.getElementById('holdingAmount').value='';
    document.getElementById('holdingLabel').value='';
    document.getElementById('holdingStart').value='';
    document.getElementById('holdingClose').value='';
    renderHoldingsList();
    renderDashboard();
    showToast(start ? `Investment saved to ${monthLabel(start.slice(0,7))}` : 'Investment saved');
  }catch(err){
    console.error('Save investment failed:', err);
    showToast('Could not save — please try again');
  }
  renderInvestHistoryChart();
};

/* ---------- Insights view ---------- */
let insightRange = 'month';

async function renderInsights(){
  // category pie
  let breakdown = {};
  CATS.forEach(c=>breakdown[c.id]=0);
  if(insightRange==='month'){
    const m = await getMonth(state.currentMonth);
    breakdown = catBreakdown(m);
  } else {
    allMonthsSorted().forEach(m=>{
      const b = catBreakdown(m);
      CATS.forEach(c=> breakdown[c.id]+=b[c.id]);
    });
  }
  const activeCats = CATS.filter(c=>breakdown[c.id]>0);
  try{
    renderPieChart('catChart', activeCats.map(c=>c.label), activeCats.map(c=>breakdown[c.id]), activeCats.map(c=>c.color), {doughnut:true});
  }catch(err){ console.error('category chart failed:', err); }

  // month-wise trend (stacked spending by category)
  try{
    const months = allMonthsSorted().slice(-12);
    const labels = months.map(m=> monthLabel(m.id).split(' ')[0]+" '"+m.id.slice(2,4));
    const trendDatasets = CATS.map(c=>({
      label:c.label,
      data: months.map(m=> catBreakdown(m)[c.id]||0),
      color:c.color,
    }));
    renderBarChart('trendChart', labels, trendDatasets);
  }catch(err){ console.error('trend chart failed:', err); }

  // investment mix (all time — includes both manual monthly entries and holdings)
  // Computed unconditionally so renderInvestAllTimeChart's data (below) is never
  // skipped just because this pie chart failed to draw.
  const invTotals = INV_TYPES.map(t=> totalInvestedAllTime(t.id));
  try{
    renderPieChart('investChart', INV_TYPES.map(t=>t.label), invTotals, ['#C9A15C','#4F9C82','#7CA6C9','#E8C766','#8B9791']);
  }catch(err){ console.error('investment mix chart failed:', err); }

  renderInvestAllTimeChart(invTotals);
}

// Full, uncapped investment history — every month that has any investment data, not just the last 12.
function renderInvestAllTimeChart(invTotals){
  // Grand-total summary card renders first and unconditionally — this is real
  // data the user entered, and must show up regardless of whether the chart
  // below it manages to draw.
  const summary = document.getElementById('investAllTimeSummary');
  const grandTotal = invTotals.reduce((a,b)=>a+b,0);
  if(grandTotal === 0){
    summary.innerHTML = `<div class="empty" style="padding:20px 10px;"><p>No investments logged yet.</p></div>`;
  } else {
    const rows = INV_TYPES.filter((t,i)=> invTotals[i] > 0).map((t,i0)=>{
      const i = INV_TYPES.indexOf(t);
      const val = invTotals[i];
      const pct = grandTotal>0 ? Math.round((val/grandTotal)*100) : 0;
      return `<div class="cat-row">
        <div class="cat-icon" style="background:var(--panel-2);">${t.icon}</div>
        <div class="cat-info">
          <div class="cat-name"><span>${t.label}</span><span class="cat-amt mono">₹${fmt(val)}</span></div>
          <div class="cat-track"><div class="cat-fill" style="width:${pct}%; background:var(--brass);"></div></div>
        </div>
      </div>`;
    }).join('');
    summary.innerHTML = rows + `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:14px; border-top:1px solid var(--line);">
      <span style="font-size:12.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em;">Total invested, all time</span>
      <span class="mono" style="font-size:16px; color:var(--brass); font-weight:600;">₹${fmt(grandTotal)}</span>
    </div>`;
  }

  try{
    const monthIds = monthsWithDataSorted();
    const labels = monthIds.map(id=> monthLabel(id).split(' ')[0]+" '"+id.slice(2,4));
    const datasets = INV_TYPES.map((t,i)=>({
      label:t.label,
      data: monthIds.map(id=> effectiveInvestments(id)[t.id]||0),
      color: ['#C9A15C','#4F9C82','#7CA6C9','#E8C766','#8B9791'][i],
    }));
    renderBarChart('investAllTimeChart', labels, datasets);
  }catch(err){ console.error('investAllTime chart failed:', err); }
}

/* ---------- Settings: annual reminders ---------- */
function renderRemindersList(){
  const list = document.getElementById('remindersList');
  if(state.reminders.length===0){
    list.innerHTML = `<div class="empty" style="padding:14px;"><p>No reminders set.</p></div>`;
    return;
  }
  list.innerHTML = state.reminders.map(r=>{
    const [mm,dd] = r.monthDay.split('-');
    const dateForInput = `2000-${mm}-${dd}`;
    const {days} = reminderStatus(r);
    return `<div class="exp-item">
      <div class="exp-left">
        <div class="cat-icon" style="width:30px;height:30px;background:var(--panel-2); border-radius:8px; display:flex; align-items:center; justify-content:center;">📌</div>
        <div>
          <div class="exp-cat">${r.label}</div>
          <div class="exp-note">Every ${new Date(2000,Number(mm)-1,Number(dd)).toLocaleDateString('en-IN',{month:'long', day:'numeric'})} · next in ${days} day${days===1?'':'s'}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="date" value="${dateForInput}" data-editreminder="${r.id}" style="width:130px; padding:6px 8px; font-size:12px;">
        <button class="exp-del" data-delreminder="${r.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-editreminder]').forEach(inp=>{
    inp.onchange = async ()=>{
      const id = inp.getAttribute('data-editreminder');
      const r = state.reminders.find(x=>x.id===id);
      const [,mm,dd] = inp.value.split('-');
      r.monthDay = `${mm}-${dd}`;
      await saveReminder(r);
      renderRemindersList(); renderDashboard();
      showToast('Reminder updated');
    };
  });
  list.querySelectorAll('[data-delreminder]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-delreminder');
      const r = state.reminders.find(x=>x.id===id);
      showConfirm(`Delete the reminder "${r ? r.label : ''}"?`, async ()=>{
        await deleteReminder(id);
        renderRemindersList(); renderDashboard();
      });
    };
  });
}
document.getElementById('addReminderBtn').onclick = async ()=>{
  const label = document.getElementById('newReminderLabel').value.trim();
  const date = document.getElementById('newReminderDate').value;
  if(!label || !date){ showToast('Add a label and date'); return; }
  const [,mm,dd] = date.split('-');
  await saveReminder({id:uid(), label, monthDay:`${mm}-${dd}`, before:30, after:7});
  document.getElementById('newReminderLabel').value='';
  document.getElementById('newReminderDate').value='';
  renderRemindersList(); renderDashboard();
  showToast('Reminder added');
};

/* =========================================================
   VIEW SWITCHING
   ========================================================= */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.getElementById('view-'+name).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.getAttribute('data-view')===name));
  if(name==='insights') renderInsights();
  if(name==='salary') renderSalaryView();
  if(name==='add'){ renderExpenseCatChips(); renderExpenseList(); document.getElementById('expDate').value = new Date().toISOString().slice(0,10); }
  if(name==='goals') renderGoalsView();
  if(name==='settings') renderRemindersList();
}

async function renderAll(){
  await renderMonthPill();
  await renderDashboard();
}

/* =========================================================
   EVENTS
   ========================================================= */
document.querySelectorAll('.tab').forEach(t=> t.onclick = ()=> switchView(t.getAttribute('data-view')));

document.getElementById('prevMonth').onclick = ()=>{
  const [y,m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m-2, 1);
  state.currentMonth = monthId(d);
  renderAll();
};
document.getElementById('nextMonth').onclick = ()=>{
  const [y,m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  state.currentMonth = monthId(d);
  renderAll();
};

document.getElementById('saveSalary').onclick = async ()=>{
  try{
    const m = await getMonth(state.currentMonth);
    m.salary = Number(document.getElementById('salaryInput').value)||0;
    m.investments = {
      fd: Number(document.getElementById('inv_fd').value)||0,
      rd: Number(document.getElementById('inv_rd').value)||0,
      stocks: Number(document.getElementById('inv_stocks').value)||0,
      gold: Number(document.getElementById('inv_gold').value)||0,
      other: Number(document.getElementById('inv_other').value)||0,
    };
    await saveMonth(m);
    showToast('Saved '+monthLabel(state.currentMonth));
    await renderAll();
  }catch(err){
    console.error('Save month failed:', err);
    showToast('Could not save — please try again');
  }
  renderInvestHistoryChart();
};

document.getElementById('saveExpense').onclick = async ()=>{
  const amount = Number(document.getElementById('expAmount').value);
  if(!amount){ showToast('Enter an amount'); return; }
  try{
    const date = document.getElementById('expDate').value || new Date().toISOString().slice(0,10);
    const monthOfExpense = date.slice(0,7);
    const m = await getMonth(monthOfExpense);
    m.expenses = m.expenses || [];
    m.expenses.push({id:uid(), cat:selectedCat, amount, note:document.getElementById('expNote').value.trim(), date});
    await saveMonth(m);
    document.getElementById('expAmount').value='';
    document.getElementById('expNote').value='';
    showToast('Expense added');
    if(monthOfExpense===state.currentMonth) renderExpenseList();
    renderDashboard();
  }catch(err){
    console.error('Save expense failed:', err);
    showToast('Could not save — please try again');
  }
};

document.getElementById('quickAddExpense').onclick = ()=> switchView('add');
document.getElementById('quickEditSalary').onclick = ()=> switchView('salary');
document.getElementById('addGoalBtn').onclick = openGoalModal;

document.querySelectorAll('.seg button').forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll('.seg button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    insightRange = b.getAttribute('data-range');
    renderInsights();
  };
});

document.getElementById('exportBtn').onclick = async ()=>{
  const data = {months: Object.values(state.months), goals: state.goals, holdings: state.holdings, reminders: state.reminders, exportedAt: new Date().toISOString()};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `myvault-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
};
document.getElementById('importBtn').onclick = ()=> document.getElementById('importFile').click();
document.getElementById('importFile').onchange = async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    if(Array.isArray(data.months)){
      for(const m of data.months){ await idbPut('months', m); state.months[m.id]=m; }
    }
    if(Array.isArray(data.goals)){
      for(const g of data.goals){ await idbPut('goals', g); }
      state.goals = await idbGetAll('goals');
    }
    if(Array.isArray(data.holdings)){
      for(const h of data.holdings){ await idbPut('holdings', h); }
      state.holdings = await idbGetAll('holdings');
    }
    if(Array.isArray(data.reminders)){
      for(const r of data.reminders){ await saveReminder(r); }
    }
    showToast('Backup imported');
    renderAll();
  }catch(err){
    showToast('Could not read that file');
  }
  e.target.value = '';
};
document.getElementById('resetBtn').onclick = ()=>{
  showConfirm('This will permanently erase all MyVault data on this device. Continue?', async ()=>{
    await idbClear('months');
    await idbClear('goals');
    await idbClear('holdings');
    await idbClear('meta');
    state.months = {};
    state.goals = [];
    state.holdings = [];
    await loadReminders();
    renderAll();
    showToast('All data erased');
  }, 'Erase everything');
};

/* =========================================================
   PWA install support (manifest + service worker, best-effort)
   ========================================================= */
function setupManifest(){
  const manifest = {
    name:"MyVault — Personal Finance Ledger",
    short_name:"MyVault",
    start_url:".",
    display:"standalone",
    background_color:"#0E1A16",
    theme_color:"#0E1A16",
    icons:[{src:iconDataUrl(192), sizes:"192x192", type:"image/png"},{src:iconDataUrl(512), sizes:"512x512", type:"image/png"}]
  };
  const blob = new Blob([JSON.stringify(manifest)], {type:'application/json'});
  document.getElementById('manifestLink').href = URL.createObjectURL(blob);
}
function iconDataUrl(size){
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size*0.35,size*0.3,4,size*0.5,size*0.5,size*0.7);
  grad.addColorStop(0,'#C9A15C'); grad.addColorStop(1,'#8E7440');
  ctx.fillStyle='#0E1A16'; ctx.fillRect(0,0,size,size);
  ctx.fillStyle=grad; ctx.beginPath(); ctx.roundRect(size*0.1,size*0.1,size*0.8,size*0.8,size*0.18); ctx.fill();
  ctx.strokeStyle='#0E1A16'; ctx.lineWidth=size*0.05;
  ctx.beginPath(); ctx.arc(size/2,size/2,size*0.18,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#0E1A16'; ctx.beginPath(); ctx.arc(size/2,size/2,size*0.04,0,Math.PI*2); ctx.fill();
  return c.toDataURL('image/png');
}

if('serviceWorker' in navigator){
  try{
    const swCode = `
      const CACHE='myvault-v1';
      self.addEventListener('install', e=> self.skipWaiting());
      self.addEventListener('activate', e=> self.clients.claim());
      self.addEventListener('fetch', e=>{
        e.respondWith(fetch(e.request).catch(()=> caches.match(e.request)));
      });
    `;
    const swBlob = new Blob([swCode], {type:'application/javascript'});
    const swUrl = URL.createObjectURL(swBlob);
    navigator.serviceWorker.register(swUrl).catch(()=>{});
  }catch(err){}
}

/* =========================================================
   INIT
   ========================================================= */
(async function init(){
  try{
    setupManifest();
    await openDB();
    await loadAllMonths();
    await loadGoals();
    await loadHoldings();
    await loadReminders();
    await renderAll();
  }catch(err){
    console.error('MyVault failed to start:', err);
    document.getElementById('reminderSlot').innerHTML =
      `<div class="banner" style="border-color:var(--rust);"><p>Something went wrong loading your data. Try reloading the page. If it keeps happening, export a backup from Settings on a device where it does work.</p></div>`;
  }
})();
