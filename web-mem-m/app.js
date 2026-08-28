/* TAM 记忆中枢 v2 · app.js
 * 面板 API 与页面同源：/api/v1/*（hub :8125）
 * 可选网关：语义检索 + 派送队列（X-Tam-Key）
 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(){ try { return JSON.parse(localStorage.getItem('tam2_cfg')) || {}; } catch { return {}; } },
  set(c){ localStorage.setItem('tam2_cfg', JSON.stringify(c)); }
};
const state = { cfg: store.get(), tab:'overview', taskSeg:'team', block:null, layer:'L0', blocks:null };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago = ts => {
  if(!ts) return '';
  const d = new Date(ts), diff = Date.now() - d.getTime(), m=6e4, h=36e5, day=864e5;
  if(diff < m) return '刚刚';
  if(diff < h) return (diff/m|0)+' 分钟前';
  if(diff < day) return (diff/h|0)+' 小时前';
  if(diff < 7*day) return (diff/day|0)+' 天前';
  return d.toLocaleDateString('zh-CN',{month:'short',day:'numeric'});
};
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2300); }

/* ── API ── */
async function panel(path, body={}){
  const c = state.cfg;
  const r = await fetch('/api/v1/'+path, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-tdai-service-id': c.sid||'default', 'x-tdai-user-key': c.key||'' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if(j.code !== 0) throw new Error(j.message || ('HTTP '+r.status));
  return j.data;
}
async function gateway(path, body, method='POST'){
  const c = state.cfg;
  const r = await fetch((c.gurl||'') + path, {
    method, headers:{ 'X-Tam-Key': c.gkey||'', 'Content-Type':'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if(j.code !== 0) throw new Error(j.message || ('HTTP '+r.status));
  return j.data;
}
const hasPanel = () => !!(state.cfg.key && state.cfg.team);
const hasGw = () => !!(state.cfg.gurl && state.cfg.gkey);

/* ── 首屏星座（agent=主星，记忆块=卫星，任务=琥珀点） ── */
const hero = (() => {
  const cvs = $('#constellation');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    || navigator.connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2);
  if(reduced || !cvs) return { setData(){} };
  let rebuild = null, data = { agents:0, blocks:0, tasks:0 };
  import('./three.module.min.js').then(m => init(m)).catch(()=>{});

  function init(THREE){
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(56, cvs.clientWidth/Math.max(cvs.clientHeight,1), .1, 100);
    camera.position.z = 26;
    const renderer = new THREE.WebGLRenderer({ canvas:cvs, alpha:true, antialias:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));

    const W = () => cvs.clientWidth, H = () => cvs.clientHeight;
    function resize(){ renderer.setSize(W(), H(), false); camera.aspect = W()/Math.max(H(),1); camera.updateProjectionMatrix(); }
    resize(); addEventListener('resize', resize);

    const dustN = W() < 420 ? 420 : 700;
    const dp = new Float32Array(dustN*3);
    for(let i=0;i<dustN*3;i++) dp[i] = (Math.random()-.5)*70;
    const dustG = new THREE.BufferGeometry();
    dustG.setAttribute('position', new THREE.BufferAttribute(dp,3));
    const dust = new THREE.Points(dustG, new THREE.PointsMaterial({ color:0x39506e, size:.14, transparent:true, opacity:.75 }));
    scene.add(dust);

    const group = new THREE.Group(); scene.add(group);
    const amberM = new THREE.MeshBasicMaterial({ color:0xeeb65f, transparent:true, opacity:.9 });
    const cyanM  = new THREE.MeshBasicMaterial({ color:0x6ee7f9 });
    const paleM  = new THREE.MeshBasicMaterial({ color:0x3d8ea6, transparent:true, opacity:.65 });
    const lineM  = new THREE.LineBasicMaterial({ color:0x1f4a5c, transparent:true, opacity:.5 });

    let nodes = null;
    rebuild = function(){
      if(nodes){ group.remove(nodes); nodes.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); }
      nodes = new THREE.Group(); group.add(nodes);
      const NA = Math.max(data.agents,1), NB = Math.max(data.blocks,NA), NT = Math.max(data.tasks,1);
      const rings = [];
      for(let a=0;a<NA;a++){
        const ang = a/NA*Math.PI*2;
        const p = new THREE.Vector3(Math.cos(ang)*4.2, Math.sin(ang)*2.6, (Math.random()-.5)*2);
        const star = new THREE.Mesh(new THREE.SphereGeometry(.55,16,16), cyanM);
        star.position.copy(p); nodes.add(star);
        const satR = 2.1, per = Math.max(Math.round(NB/NA),1);
        const sat = new THREE.Group(); sat.position.copy(p); nodes.add(sat); rings.push(sat);
        for(let b=0;b<per;b++){
          const m = new THREE.Mesh(new THREE.SphereGeometry(.16,10,10), paleM);
          const sa = b/per*Math.PI*2;
          m.position.set(Math.cos(sa)*satR, Math.sin(sa)*satR*.6, Math.sin(sa*2)*.5);
          sat.add(m);
        }
        const tl = new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(0,-.4,0)]);
        nodes.add(new THREE.Line(tl, lineM));
      }
      for(let t=0;t<Math.min(NT,24);t++){
        const ang = Math.random()*Math.PI*2, r = 9+Math.random()*7;
        const m = new THREE.Mesh(new THREE.SphereGeometry(.11,8,8), amberM);
        m.position.set(Math.cos(ang)*r, (Math.random()-.5)*7, Math.sin(ang)*r-4);
        nodes.add(m);
      }
      group.userData.rings = rings;
    };
    rebuild();

    let px=0, py=0, tx=0, ty=0;
    addEventListener('touchmove', e=>{ const t=e.touches[0]; tx=(t.clientX/innerWidth-.5); ty=(t.clientY/innerHeight-.5); }, {passive:true});
    addEventListener('mousemove', e=>{ tx=(e.clientX/innerWidth-.5); ty=(e.clientY/innerHeight-.5); }, {passive:true});

    let last = 0, visible = true, raf = 0;
    function loop(t){
      raf = requestAnimationFrame(loop);
      const dt = Math.min((t-last)/1000, .05); last = t;
      group.rotation.y += dt*.06;
      dust.rotation.y -= dt*.008;
      (group.userData.rings||[]).forEach((sat,i)=>{ sat.rotation.y += dt*(.24 + i*.03); });
      px += (tx-px)*.04; py += (ty-py)*.04;
      camera.position.x = px*5; camera.position.y = -py*3;
      camera.lookAt(0,0,0);
      renderer.render(scene,camera);
    }
    function stop(){ if(raf){ cancelAnimationFrame(raf); raf=0; } }
    document.addEventListener('visibilitychange', ()=>{ visible=!document.hidden; if(visible && !raf) loop(performance.now()); });
    new IntersectionObserver(es=>{ visible=es[0].isIntersecting; if(visible){ if(!raf) loop(performance.now()); } else stop(); }, {threshold:.02}).observe(cvs);

    $('#hero').classList.add('ready');
    loop(0);
  }
  return { setData(d){
    const changed = data.agents!==d.agents||data.blocks!==d.blocks||data.tasks!==d.tasks;
    Object.assign(data,d);
    if(rebuild && changed) rebuild();
  } };
})();

/* ── 概览 ── */
async function loadOverview(){
  const crumb = $('#crumb');
  if(!hasPanel()){ crumb.textContent='未连接，去设置'; renderAgentsPlaceholder('填入密钥与团队后开始'); return; }
  $('#connDot').classList.add('on');
  try{
    const [blocks, tasks] = await Promise.all([
      panel('chat-memory/my-agents',{ team_id: state.cfg.team }),
      panel('task/list-with-agents',{ team_id: state.cfg.team, limit:50 }).catch(()=>({items:[]}))
    ]);
    state.blocks = blocks.items || [];
    const running = (tasks.items||[]).filter(t=>t.status==='running'||t.status==='active').length;
    crumb.textContent = (state.cfg.teamName||state.cfg.team) + ' · ' + state.blocks.length + ' 块记忆';
    $('#heroStats').innerHTML = `
      <div class="stat"><b>${state.blocks.length}</b><span>记忆块</span></div>
      <div class="stat"><b>${(tasks.items||[]).length}</b><span>任务</span></div>
      <div class="stat amber"><b>${running}</b><span>进行中</span></div>`;
    hero.setData({ agents:new Set(state.blocks.map(b=>b.agent_id)).size, blocks:state.blocks.length, tasks:(tasks.items||[]).length });
    renderAgents(state.blocks);
  }catch(e){
    crumb.textContent='连接失败';
    renderAgentsPlaceholder(esc(e.message));
  }
}
function renderAgentsPlaceholder(msg){
  $('#agentCards').innerHTML = `<div class="empty"><span class="big">尚未就绪</span>${msg}</div>`;
  $('#blockList').innerHTML = `<div class="empty"><span class="big">尚未就绪</span>${msg}</div>`;
}
function renderAgents(blocks){
  $('#agentCards').innerHTML = blocks.map((b,i)=>`
    <div class="card agent-card list-card" style="animation-delay:${i*45}ms">
      <span class="scope ${b.scope==='private'?'private':''}">${b.scope==='private'?'私密':'团队'}</span>
      <div class="name">${esc(b.title||b.agent_id)}</div>
      <div class="sub mono">${esc(b.agent_id||'')} · ${ago(b.updated_at_ms)}</div>
      <div class="bar"><span class="mini">${esc(b.summary||'空闲')}</span></div>
    </div>`).join('') || '<div class="empty"><span class="big">没有记忆块</span>给 Agent 绑定记忆后来这里看</div>';
  $('#blockList').innerHTML = blocks.map((b,i)=>`
    <div class="card block-card list-card" data-id="${esc(b.id)}" data-title="${esc(b.title||b.agent_id)}" style="animation-delay:${i*45}ms">
      <div class="title">${esc(b.title||b.id)}</div>
      <div class="sum">${esc(b.summary||'')} · ${ago(b.updated_at_ms)}</div>
    </div>`).join('') || '<div class="empty"><span class="big">没有记忆块</span></div>';
}

/* ── 记忆详情 ── */
async function openDetail(id, title){
  state.block = id; state.layer = 'L0';
  $$('#layerPills .pill').forEach(p=>p.classList.toggle('active', p.dataset.l==='L0'));
  $('#detailTitle').textContent = title;
  $('#lQuery').value = '';
  $('#detailSheet').classList.add('open');
  loadLayer();
}
async function loadLayer(){
  const body = $('#detailBody');
  body.innerHTML = '<div class="empty">读取中…</div>';
  try{
    const d = await panel('chat-memory/layer',{ block_id: state.block, layer: state.layer, limit: 50 });
    renderItems(body, d.items||[]);
  }catch(e){ body.innerHTML = `<div class="empty"><span class="big">读取失败</span>${esc(e.message)}</div>`; }
}
async function searchLayer(q){
  const body = $('#detailBody');
  body.innerHTML = '<div class="empty">检索中…</div>';
  try{
    const d = await panel('chat-memory/search',{ block_id: state.block, layer: (state.layer==='L2'||state.layer==='L3')?'L1':state.layer, query:q, limit:30 });
    renderItems(body, d.items||d.results||[]);
  }catch(e){ body.innerHTML = `<div class="empty"><span class="big">检索失败</span>${esc(e.message)}</div>`; }
}
function renderItems(body, items){
  if(!items.length){ body.innerHTML = '<div class="empty"><span class="big">这里是空的</span>该层还没有内容</div>'; return; }
  body.innerHTML = items.map((it,i)=>`
    <div class="item list-card" style="animation-delay:${Math.min(i,8)*40}ms">
      <div class="top">
        ${it.role?`<span class="role ${esc(it.role)}">${esc(it.role)}</span>`:''}
        <span>${esc(it.title||'')}</span><span>${ago(it.created_at)}</span>
        ${typeof it.score==='number'?`<span class="score">${it.score.toFixed(2)}</span>`:''}
      </div>
      <div class="body clamp">${esc(it.body||it.content||'')}</div>
      <span class="more">展开</span>
    </div>`).join('');
}

/* ── 任务 ── */
async function loadTasks(){
  const list = $('#taskList');
  const seg = state.taskSeg;
  if(seg==='team'){
    if(!hasPanel()){ list.innerHTML='<div class="empty"><span class="big">未连接</span>先在设置里配置</div>'; return; }
    list.innerHTML = '<div class="skel"><i></i><i></i></div>';
    try{
      const d = await panel('task/list-with-agents',{ team_id: state.cfg.team, limit:50 });
      list.innerHTML = (d.items||[]).map((t,i)=>`
        <div class="card list-card" style="animation-delay:${i*40}ms">
          <div class="field-row"><span class="badge ${esc(t.status)}">${esc(t.status)}</span>
            <b style="font-size:14.5px">${esc(t.title)}</b></div>
          ${t.description?`<div style="font-size:12.5px;color:var(--dim);margin-top:6px">${esc(t.description)}</div>`:''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
            ${(t.agents||[]).map(a=>`<span class="mini">${esc(a.agent_id)}</span>`).join('')}
            <span class="mono">${ago(t.updated_at||t.created_at)}</span>
          </div>
        </div>`).join('') || '<div class="empty"><span class="big">暂无任务</span></div>';
    }catch(e){ list.innerHTML = `<div class="empty"><span class="big">加载失败</span>${esc(e.message)}</div>`; }
  } else {
    if(!hasGw()){ list.innerHTML='<div class="empty"><span class="big">未配置网关</span>设置里填入网关地址与密钥</div>'; return; }
    list.innerHTML = '<div class="skel"><i></i><i></i></div>';
    const to = seg==='inbox' ? (state.cfg.agent||'minis') : '';
    const st = seg==='sent' ? 'done' : 'queued';
    try{
      const d = await gateway('/api/v1/dispatch/list?to='+encodeURIComponent(to)+'&status='+encodeURIComponent(st)+'&limit=30', null, 'GET');
      const items = d.tasks || d.items || [];
      list.innerHTML = items.map((t,i)=>`
        <div class="card list-card" style="animation-delay:${i*40}ms">
          <div class="field-row"><span class="badge ${esc(t.status)}">${esc(t.status)}</span><span class="mono">${esc(t.id)}</span></div>
          <div style="font-size:14px;margin-top:7px">${esc(t.payload||t.title||'')}</div>
          <div class="mono" style="margin-top:6px">${esc(t.from_agent||'')} → ${esc(t.to_agent||'')} · ${ago(t.created_at)}</div>
        </div>`).join('') || '<div class="empty"><span class="big">队列是空的</span></div>';
    }catch(e){ list.innerHTML = `<div class="empty"><span class="big">加载失败</span>${esc(e.message)}</div>`; }
  }
}

/* ── 全局语义检索（网关） ── */
async function globalSearch(){
  const q = $('#gQuery').value.trim();
  if(!q) return;
  const box = $('#gResults');
  box.innerHTML = '<div class="empty">检索中…</div>';
  try{
    const d = await gateway('/v3/conversation/search',{ query:q, limit:20 });
    const items = d.messages || d.items || [];
    box.innerHTML = items.map((m,i)=>`
      <div class="item list-card" style="animation-delay:${Math.min(i,8)*40}ms">
        <div class="top"><span>${esc(m.session_id||'')}</span>
          ${typeof m.score==='number'?`<span class="score">${m.score.toFixed(2)}</span>`:''}</div>
        <div class="body clamp">${esc(m.content||'')}</div>
        <span class="more">展开</span>
      </div>`).join('') || '<div class="empty"><span class="big">没有命中</span></div>';
  }catch(e){ box.innerHTML = `<div class="empty"><span class="big">检索失败</span>${esc(e.message)}</div>`; }
}

/* ── 设置 ── */
function fillForm(){
  const c = state.cfg;
  $('#fKey').value = c.key||''; $('#fSid').value = c.sid||'default';
  $('#fGurl').value = c.gurl||''; $('#fGkey').value = c.gkey||''; $('#fAgent').value = c.agent||'minis';
  if(c.team) $('#fTeam').innerHTML = `<option value="${esc(c.team)}">${esc(c.teamName||c.team)}</option>`;
  $('#gsearchWrap').hidden = !hasGw();
}
async function loadTeams(){
  const key = $('#fKey').value.trim();
  if(!key){ toast('先填密钥'); return; }
  try{
    const d = await panel('meta/team/list',{ action:'team/list', user_key:key });
    const items = d.items||[];
    $('#fTeam').innerHTML = items.map(t=>`<option value="${esc(t.team_id)}" ${t.team_id===state.cfg.team?'selected':''}>${esc(t.name)} · ${esc(t.team_id)}</option>`).join('') || '<option value="">该密钥无团队</option>';
    toast('已加载 '+items.length+' 个团队');
  }catch(e){ toast('验证失败：'+e.message); }
}

/* ── 事件 ── */
$('#bottomNav').addEventListener('click', e=>{
  const btn = e.target.closest('.nav-item'); if(!btn) return;
  state.tab = btn.dataset.tab;
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n===btn));
  $$('.tabview').forEach(v=>v.hidden = v.id !== 'tab-'+state.tab);
  if(state.tab==='overview') loadOverview();
  if(state.tab==='task') loadTasks();
  if(state.tab==='memory'){ $('#gsearchWrap').hidden = !hasGw(); if(state.blocks) renderAgents(state.blocks); else loadOverview(); }
  if(state.tab==='set') fillForm();
  scrollTo({top:0});
});
$('#refreshBtn').addEventListener('click', ()=>{
  $('#refreshBtn').classList.add('spinning');
  const done = ()=>$('#refreshBtn').classList.remove('spinning');
  setTimeout(done, 700);
  if(state.tab==='task') loadTasks().then(done,done);
  else if(state.tab==='memory' && $('#gQuery').value && hasGw()) globalSearch().then(done,done);
  else loadOverview().then(done,done);
});
$('#taskSeg').addEventListener('click', e=>{
  const b = e.target.closest('.seg-btn'); if(!b) return;
  state.taskSeg = b.dataset.k;
  $$('#taskSeg .seg-btn').forEach(x=>x.classList.toggle('active', x===b));
  loadTasks();
});
$('#blockList').addEventListener('click', e=>{
  const c = e.target.closest('.block-card'); if(c) openDetail(c.dataset.id, c.dataset.title);
});
$('#detailBack').addEventListener('click', ()=>$('#detailSheet').classList.remove('open'));
$('#layerPills').addEventListener('click', e=>{
  const p = e.target.closest('.pill'); if(!p) return;
  state.layer = p.dataset.l;
  $$('#layerPills .pill').forEach(x=>x.classList.toggle('active', x===p));
  $('#lQuery').value=''; loadLayer();
});
$('#lGo').addEventListener('click', ()=>{ const q=$('#lQuery').value.trim(); q ? searchLayer(q) : loadLayer(); });
$('#gGo').addEventListener('click', globalSearch);
$('#gQuery').addEventListener('keydown', e=>{ if(e.key==='Enter') globalSearch(); });
$('#lQuery').addEventListener('keydown', e=>{ if(e.key==='Enter'){ const q=e.target.value.trim(); q?searchLayer(q):loadLayer(); } });
document.addEventListener('click', e=>{
  const m = e.target.closest('.more'); if(!m) return;
  const b = m.previousElementSibling;
  b.classList.toggle('clamp');
  m.textContent = b.classList.contains('clamp') ? '展开' : '收起';
});
$('#saveBtn').addEventListener('click', async ()=>{
  const teamSel = $('#fTeam');
  state.cfg = {
    key: $('#fKey').value.trim(), sid: $('#fSid').value.trim()||'default',
    team: teamSel.value||'', teamName: (teamSel.selectedOptions[0]?.text||'').split(' · ')[0]||'',
    gurl: $('#fGurl').value.trim().replace(/\/$/,''), gkey: $('#fGkey').value.trim(),
    agent: $('#fAgent').value
  };
  store.set(state.cfg);
  $('#gsearchWrap').hidden = !hasGw();
  toast(hasPanel() ? '已保存，连接就绪' : '已保存，还需选择团队');
  await loadOverview();
  $$('.nav-item')[0].click();
});
$('#clearBtn').addEventListener('click', ()=>{ localStorage.removeItem('tam2_cfg'); state.cfg={}; fillForm(); $('#connDot').classList.remove('on'); toast('已清除'); });
$('#fKey').addEventListener('blur', ()=>{ if($('#fKey').value.trim() && !$('#fTeam').value) loadTeams(); });
$('#fTeam').addEventListener('focus', ()=>{ if($('#fTeam').options.length===1 && !$('#fTeam').value && $('#fKey').value.trim()) loadTeams(); });

/* ── 启动 ── */
(async function boot(){
  fillForm();
  await loadOverview();
  if(!hasPanel()) setTimeout(()=>$$('.nav-item')[3].click(), 1000);
})();
