const $ = (sel, root=document) => root.querySelector(sel);
const lanes = { todo:$('#lane-todo'), doing:$('#lane-doing'), blocked:$('#lane-blocked'), done:$('#lane-done') };
let canManage=false, userShift=null, selectedShift=null, currentKind='', _currentAudit=null, currentUser=null;
const TOOL_VERIFY_TEMPLATE_IDS = new Set(['catalog:audit:screwdriver-and-drill-audit']);
const TOOL_VERIFY_CLASSIFICATIONS = ['manual','wired','wireless'];
const ACTIVE_BUILDING=(typeof window.getBuilding==='function'&&window.getBuilding())||localStorage.getItem('suite.building.v1')||'Bldg-350';
function confirmBuildingScope(actionLabel){
  const assigned=currentUser?.building||'';
  if(!assigned||assigned===ACTIVE_BUILDING) return true;
  return window.confirm(`You are assigned to ${assigned.replace('Bldg-','Building ')} but are about to ${actionLabel} in ${ACTIVE_BUILDING.replace('Bldg-','Building ')}. Continue?`);
}
let _templates=[], _checkedIds=new Set();

function esc(s){ return String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function kindBadge(kind){ const map={daily:'kind-daily',weekly:'kind-weekly',monthly:'kind-monthly'}; return `<span class="card-kind ${map[kind]||'kind-daily'}">${esc(kind)}</span>`; }
function csrf(){
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function api(url, opts={}){
  const method=(opts.method||'GET').toUpperCase();
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(['POST','PUT','PATCH','DELETE'].includes(method)) headers['X-CSRF-Token']=csrf();
  const r=await fetch(url,{credentials:'include',headers,...opts});
  if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.message||`HTTP ${r.status}`); }
  return r.status===204?null:r.json();
}

async function whoami(){
  try{
    const j=await api('/auth/whoami');
    currentUser = j.user || null;
    const role=(j.user?.role||'').toLowerCase();
    // Mirrors the backend writer set: routes/audits.js uses requireRole('admin','lead','management','coordinator').
    // Any mismatch here means the UI lets users try actions the server will 403.
    canManage=['admin','lead','management','coordinator'].includes(role);
    if(canManage && $('#btnNewTemplate')) $('#btnNewTemplate').style.display='';
    const techId=j.user?.techId||j.user?.id;
    if(techId){
      try{
        const emps=await api('/employees');
        const emp=(Array.isArray(emps)?emps:emps.items||[]).find(e=>String(e.id||e.techId||'')===String(techId));
        if(emp?.shift){ userShift=Number(emp.shift); selectedShift=userShift; }
      }catch{}
    }
    const badge=$('#shiftBadge');
    if(badge&&userShift){ badge.textContent=`Shift ${userShift}`; badge.style.display='inline-flex'; }
  }catch{}
}

function cardEl(t){
  const div=document.createElement('div');
  div.className='card'; div.dataset.id=t.id;
  div.setAttribute('role','button'); div.setAttribute('tabindex','0');
  // Only users the backend will accept for /audits/api/move get a draggable
  // card; everyone else sees a read-only card. This avoids a 403 on every
  // accidental drag for viewers/kiosk accounts and keeps the UI honest.
  if (canManage) {
    div.setAttribute('draggable','true');
    div.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',t.id); e.dataTransfer.effectAllowed='move'; div.classList.add('drag'); });
    div.addEventListener('dragend',()=>div.classList.remove('drag'));
  } else {
    div.style.cursor = 'pointer';
  }
  const meta=[t.shift?`Shift ${esc(t.shift)}`:'',t.dueDate?`due: ${esc(t.dueDate.slice(0,10))}`:''].filter(Boolean).join(' • ');
  div.innerHTML=`<div class="card-title">${esc(t.title)}${kindBadge(t.kind)}</div>${isToolVerifyAudit(t)?'<div class="card-tool-pill">Tool Verify</div>':''}<div class="card-meta">${meta||'&nbsp;'}</div>`;
  div.addEventListener('click',()=>openDetailPanel(t));
  div.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openDetailPanel(t); } });
  return div;
}

function setupDrops(){
  // Read-only roles skip drop wiring entirely. Leaving the listeners attached
  // would trigger a server 403 on every accidental drag from the keyboard or
  // touch devices, which is what produced the cluster of "POST /audits/api/move
  // 403" errors we saw in the console.
  if (!canManage) return;
  document.querySelectorAll('.col[data-bucket]').forEach(col=>{
    const bucket=col.dataset.bucket;
    ['dragenter','dragover'].forEach(ev=>col.addEventListener(ev,e=>{ e.preventDefault(); col.classList.add('drag-over'); }));
    ['dragleave','drop'].forEach(ev=>col.addEventListener(ev,()=>col.classList.remove('drag-over')));
    col.addEventListener('drop',async e=>{
      e.preventDefault();
      const id=e.dataTransfer.getData('text/plain');
      if(!id)return;
      try {
        await api('/audits/api/move',{method:'POST',body:JSON.stringify({id,bucket})});
      } catch (err) {
        // Most common failures: stale CSRF token (reload the page to refresh),
        // or the server decided this role can't mutate audits. Either way the
        // visual move needs to be undone and the user told what happened.
        const msg = String(err?.message || 'Move failed').toLowerCase();
        if (msg.includes('csrf') || msg.includes('403')) {
          alert('Could not move this audit — your session may have expired, or your role is not permitted to move audit tasks. Refreshing the board.');
        } else {
          alert(`Could not move this audit: ${err?.message || 'unknown error'}`);
        }
      } finally {
        // Always reload so the card snaps back to its authoritative lane
        // on failure (or reflects the server state on success).
        await load();
      }
    });
  });
}

let _firstLoad=true;
async function load(){
  const qs=new URLSearchParams({building:ACTIVE_BUILDING}); if(currentKind) qs.set('kind',currentKind);
  const data=await api(`/audits/api?${qs.toString()}`);
  Object.values(lanes).forEach(l=>{ if(l) l.innerHTML=''; });
  const counts={todo:0,doing:0,blocked:0,done:0};
  for(const t of data){
    const bucket=t.bucket||'todo';
    const lane=lanes[bucket];
    if(lane) lane.appendChild(cardEl(t));
    if(bucket in counts) counts[bucket]++;
  }
  document.querySelectorAll('[data-col-count]').forEach(el=>{ el.textContent=counts[el.dataset.colCount]||0; });
  Object.entries(counts).forEach(([bucket,count])=>{ const e=document.getElementById(`empty-${bucket}`); if(e) e.style.display=count===0?'flex':'none'; });
  if(_firstLoad){ _firstLoad=false; const sk=document.getElementById('board-skeleton'),bd=document.getElementById('board'); if(sk) sk.style.display='none'; if(bd) bd.style.display='grid'; }
}

function openGenerateModal(){
  _checkedIds=new Set();
  selectedShift=userShift||null;
  renderShiftPicker();
  const defaultOwner = currentUser?.name || currentUser?.username || currentUser?.id || '';
  if ($('#ownerInput')) $('#ownerInput').value = defaultOwner;
  loadTemplatesIntoModal();
  $('#generateModal').classList.add('open');
}
function closeGenerateModal(){ $('#generateModal').classList.remove('open'); }

function renderShiftPicker(){
  $('#shiftPicker').querySelectorAll('.shift-btn').forEach(btn=>{ btn.classList.toggle('active',Number(btn.dataset.shift)===selectedShift); });
  $('#shiftNote').textContent=selectedShift
    ?`Generating for Shift ${selectedShift}. Template selection is now unlocked for this shift.`
    :'Select a shift before choosing any audit tasks.';
}

async function loadTemplatesIntoModal(){
  $('#tplListWrap').innerHTML='<div style="font-size:.82rem;color:var(--fg-muted);text-align:center;padding:1.5rem">Loading templates...</div>';
  try{ _templates=await api('/audits/api/templates?catalogOnly=1'); }catch{ _templates=[]; }
  renderTemplateList();
}

function renderTemplateList(){
  const wrap=$('#tplListWrap');
  if(!selectedShift){
    wrap.innerHTML='<div class="empty-templates">Select Shift 1, Shift 2, or Shift 3 above to unlock audit task selection.</div>';
    updateSelectedCount();
    return;
  }
  if(!_templates.length){ wrap.innerHTML='<div class="empty-templates">No templates defined yet.<br>Use "+ New Template" to create some.</div>'; updateSelectedCount(); return; }
  const groups={daily:[],weekly:[],monthly:[]};
  for(const t of _templates){ const k=(t.kind||'daily').toLowerCase(); if(groups[k]) groups[k].push(t); else groups.daily.push(t); }
  const kindLabel={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};
  wrap.innerHTML='';
  for(const [kind,items] of Object.entries(groups)){
    if(!items.length) continue;
    const group=document.createElement('div'); group.className='tpl-group';
    const hd=document.createElement('div'); hd.className='tpl-group-hd';
    hd.innerHTML=`<span>${kindLabel[kind]}</span><span class="tpl-check-all" data-kind="${kind}">Select all</span>`;
    group.appendChild(hd);
    for(const tpl of items){
      const row=document.createElement('div'); row.className='tpl-row';
      const chk=document.createElement('input'); chk.type='checkbox'; chk.id=`tpl-chk-${tpl.id}`; chk.value=tpl.id;
      chk.checked=_checkedIds.has(tpl.id);
      chk.addEventListener('change',()=>{ if(chk.checked) _checkedIds.add(tpl.id); else _checkedIds.delete(tpl.id); updateSelectedCount(); });
      const lbl=document.createElement('label'); lbl.htmlFor=chk.id;
      lbl.innerHTML=`<div class="tpl-name">${esc(tpl.title)}</div>${tpl.description?`<div class="tpl-desc">${esc(tpl.description)}</div>`:''}${tpl.meta?.moduleToolLabel?`<div class="tpl-badges"><span class="tpl-badge">${esc(tpl.meta.moduleToolLabel)}</span></div>`:''}`;
      row.appendChild(chk); row.appendChild(lbl); group.appendChild(row);
    }
    wrap.appendChild(group);
  }
  wrap.querySelectorAll('.tpl-check-all').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const kind=btn.dataset.kind;
      const kindItems=_templates.filter(t=>(t.kind||'daily')===kind);
      const allChecked=kindItems.every(t=>_checkedIds.has(t.id));
      kindItems.forEach(t=>{ if(allChecked) _checkedIds.delete(t.id); else _checkedIds.add(t.id); });
      renderTemplateList();
    });
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(chk=>{ if(_checkedIds.has(chk.value)) chk.checked=true; });
  updateSelectedCount();
}

function updateSelectedCount(){ const el=$('#genSelectedCount'); if(el) el.textContent=`${_checkedIds.size} selected`; }
function parseSerialInput(raw=''){
  return [...new Set(String(raw).split(/[\s,;]+/).map(part=>String(part||'').trim().replace(/\u00A0/g,' ').replace(/[\s-]+/g,'').toUpperCase()).filter(Boolean))];
}
function isToolVerifyAudit(audit){
  return Boolean(
    audit?.meta?.moduleTool==='tool-verify' ||
    TOOL_VERIFY_TEMPLATE_IDS.has(String(audit?.meta?.templateInstance||'')) ||
    String(audit?.title||'').toLowerCase().includes('screwdriver and drill audit')
  );
}
function getSelectedToolVerifyClasses(){
  return Array.from(document.querySelectorAll('#toolVerifyClasses .chip.active')).map(btn=>btn.dataset.classification).filter(Boolean);
}
function updateToolVerifyCompleteButton(verification){
  const btn=$('#toolVerifyComplete');
  if(!btn) return;
  const canComplete=Boolean(verification?.allConfirmed && !verification?.completedAt);
  btn.disabled=!canComplete;
  btn.textContent=verification?.completedAt?'Audit Completed':'Complete Audit';
}
function renderToolVerifyResult(verification){
  const wrap=$('#toolVerifyResult');
  if(!wrap) return;
  if(!verification){
    wrap.innerHTML='Run verification to compare scanned tools against the expected inventory list.';
    updateToolVerifyCompleteButton(null);
    return;
  }
  const statusClass=verification.allConfirmed?'ok':'warn';
  const statusText=verification.allConfirmed
    ?'All expected tools were confirmed and no unexpected serials were found.'
    :'Verification found missing or unexpected serial numbers that need follow-up.';
  const listHtml=(title,items,formatter=v=>esc(v))=>`<div class="verify-list"><h4>${esc(title)} (${items.length})</h4>${items.length?`<ul>${items.map(item=>`<li>${formatter(item)}</li>`).join('')}</ul>`:'<div style="font-size:.8rem;color:var(--fg-muted)">None</div>'}</div>`;
  wrap.innerHTML=`
    <div class="verify-summary">
      <div class="verify-card"><strong>${verification.expectedCount}</strong><span>Expected inventory tools</span></div>
      <div class="verify-card"><strong>${verification.confirmedCount}</strong><span>Confirmed by scan</span></div>
      <div class="verify-card"><strong>${verification.missingCount}</strong><span>Missing from scan</span></div>
      <div class="verify-card"><strong>${verification.unexpectedCount}</strong><span>Not in inventory</span></div>
    </div>
    <div class="verify-status ${statusClass}">${esc(statusText)}</div>
    <div class="verify-list-wrap">
      ${listHtml('Missing', verification.missing||[])}
      ${listHtml('Not In Inventory', verification.unexpected||[])}
      ${listHtml('Confirmed', verification.confirmed||[])}
      ${listHtml('Duplicate Scans', verification.duplicateScans||[], item=>`${esc(item.serialNumber)} (${item.count}x)`)}
    </div>
    <div class="verify-meta">
      Checked for ${esc((verification.classifications||[]).join(', ') || TOOL_VERIFY_CLASSIFICATIONS.join(', '))} in ${esc(verification.building || ACTIVE_BUILDING)}.
      ${verification.scannedAt ? ` Last run: ${esc(new Date(verification.scannedAt).toLocaleString())}.` : ''}
      ${verification.completedAt ? ` Audit completed: ${esc(new Date(verification.completedAt).toLocaleString())}.` : ''}
    </div>
  `;
  updateToolVerifyCompleteButton(verification);
}
function syncToolVerifyModule(audit){
  const section=$('#toolVerifyModule');
  if(!section) return;
  const enabled=isToolVerifyAudit(audit);
  section.hidden=!enabled;
  if(!enabled){
    if($('#toolVerifyScans')) $('#toolVerifyScans').value='';
    renderToolVerifyResult(null);
    return;
  }
  const verification=audit?.meta?.toolVerify||null;
  if($('#toolVerifyScans')) $('#toolVerifyScans').value=(verification?.scannedSerials||[]).join('\n');
  document.querySelectorAll('#toolVerifyClasses .chip').forEach(btn=>{
    const activeClasses=verification?.classifications?.length?verification.classifications:TOOL_VERIFY_CLASSIFICATIONS;
    btn.classList.toggle('active', activeClasses.includes(btn.dataset.classification));
  });
  renderToolVerifyResult(verification);
}

$('#shiftPicker').addEventListener('click',e=>{
  const btn=e.target.closest('.shift-btn'); if(!btn)return;
  const s=Number(btn.dataset.shift);
  selectedShift=s;
  renderShiftPicker(); renderTemplateList();
});

$('#genModalSubmit').addEventListener('click',async()=>{
  if(!selectedShift){ alert('Select a shift before generating audit tasks.'); return; }
  if(!_checkedIds.size){ alert('Select at least one template.'); return; }

  const ownerRaw = ($('#ownerInput')?.value || '').trim();
  if(!confirmBuildingScope('generate audit tasks')) return;
  const btn=$('#genModalSubmit');
  btn.disabled=true;
  btn.textContent='Generating...';

  try{
    const body = {
      templateIds:[..._checkedIds],
      ...(selectedShift ? { shift:selectedShift } : {}),
      ownerId: ownerRaw,
      ownerName: ownerRaw,
      ownerLabel: ownerRaw,
      building: ACTIVE_BUILDING,
    };

    const result=await api('/audits/instantiate/selective',{
      method:'POST',
      body:JSON.stringify(body)
    });

    closeGenerateModal();
    await load();

    const msg=result?.created ? `${result.created} task(s) generated.` : 'All selected tasks already exist for this cycle.';
    if(window.notyf) window.notyf.success(msg); else alert(msg);
  }catch(err){
    alert(`Error: ${err.message}`);
  }finally{
    btn.disabled=false;
    btn.textContent='Generate Selected';
  }
});

$('#btnGenerate').addEventListener('click',openGenerateModal);
$('#genModalClose').addEventListener('click',closeGenerateModal);
$('#genModalCancel').addEventListener('click',closeGenerateModal);
$('#generateModal').addEventListener('click',e=>{ if(e.target===$('#generateModal')) closeGenerateModal(); });

function openNewTplModal(){
  $('#tplTitle').value=''; $('#tplDesc').value=''; $('#tplKind').value='daily';
  $('#tplShiftMode').value='once'; $('#tplWeekMode').value='weekly';
  $('#newTplErr').style.display='none'; toggleTplFields();
  $('#newTplModal').classList.add('open'); setTimeout(()=>$('#tplTitle').focus(),60);
}
function closeNewTplModal(){ $('#newTplModal').classList.remove('open'); }
function toggleTplFields(){ const k=$('#tplKind').value; $('#tplShiftModeWrap').style.display=k==='daily'?'':'none'; $('#tplWeekModeWrap').style.display=k==='weekly'?'':'none'; }
$('#tplKind').addEventListener('change',toggleTplFields);
$('#newTplSave').addEventListener('click',async()=>{
  const title=$('#tplTitle').value.trim();
  if(!title){ const el=$('#newTplErr'); el.textContent='Title is required.'; el.style.display='block'; return; }
  const kind=$('#tplKind').value;
  if(!confirmBuildingScope('create an audit template')) return;
  const body={title,description:$('#tplDesc').value.trim(),kind,building:ACTIVE_BUILDING};
  if(kind==='daily') body.shiftMode=$('#tplShiftMode').value;
  if(kind==='weekly') body.weekMode=$('#tplWeekMode').value;
  const btn=$('#newTplSave'); btn.disabled=true; btn.textContent='Saving...';
  try{
    await api('/audits/api/template',{method:'POST',body:JSON.stringify(body)});
    closeNewTplModal();
    if($('#generateModal').classList.contains('open')) loadTemplatesIntoModal();
  }catch(err){ const el=$('#newTplErr'); el.textContent=err.message; el.style.display='block'; }
  finally{ btn.disabled=false; btn.textContent='Create Template'; }
});
$('#btnNewTemplate').addEventListener('click',openNewTplModal);
$('#newTplClose').addEventListener('click',closeNewTplModal);
$('#newTplCancel').addEventListener('click',closeNewTplModal);
$('#newTplModal').addEventListener('click',e=>{ if(e.target===$('#newTplModal')) closeNewTplModal(); });

function openDetailPanel(audit){
  _currentAudit=audit;

  $('#dp-title').textContent=audit.title||'Audit Detail';
  $('#dp-kind').textContent=audit.kind||'�';
  $('#dp-shift').textContent=audit.shift?`Shift ${audit.shift}`:(audit.meta?.weekMode||'�');
  $('#dp-due').textContent=audit.dueDate?new Date(audit.dueDate+'T12:00:00').toLocaleDateString():'�';
  $('#dp-status').textContent=audit.bucket||'�';

  const desc=audit.description||audit.meta?.description||'';
  $('#dp-desc-wrap').style.display=desc?'':'none';
  $('#dp-desc').textContent=desc;

  $('#dp-notes').value=audit.meta?.notes||'';

  if ($('#dp-owner-view')) {
    $('#dp-owner-view').textContent =
      audit.ownerLabel || audit.ownerName || audit.ownerId || audit.meta?.ownerLabel || '�';
  }

  if ($('#dp-owner-input')) {
    $('#dp-owner-input').value =
      audit.ownerLabel || audit.ownerName || audit.ownerId || audit.meta?.ownerLabel || '';
  }

  if ($('#dp-initiated-by')) {
    $('#dp-initiated-by').textContent = audit.meta?.initiatedBy || audit.meta?.createdBy || '�';
  }

  syncToolVerifyModule(audit);
  $('#detailPanel').classList.add('open');
  $('#panelOverlay').classList.add('open');
}
function closePanel(){ $('#detailPanel').classList.remove('open'); $('#panelOverlay').classList.remove('open'); _currentAudit=null; }
$('#dp-close').addEventListener('click',closePanel);
$('#panelOverlay').addEventListener('click',closePanel);
$('#dp-save').addEventListener('click',async()=>{
  if(!_currentAudit)return;

  const owner = ($('#dp-owner-input')?.value || '').trim();

  await api(`/audits/api/${encodeURIComponent(_currentAudit.id)}`,{
    method:'PATCH',
    body:JSON.stringify({
      ownerId: owner,
      ownerName: owner,
      ownerLabel: owner,
      meta:{
        notes:$('#dp-notes').value
      }
    })
  });

  closePanel();
  await load();
});
$('#dp-delete').addEventListener('click',async()=>{
  if(!_currentAudit)return;
  if(!confirm(`Delete "${_currentAudit.title}"?`))return;
  await api(`/audits/api/${encodeURIComponent(_currentAudit.id)}`,{method:'DELETE'});
  closePanel(); await load();
});

$('#kindFilter').addEventListener('change',()=>{ currentKind=$('#kindFilter').value; load().catch(console.error); });
$('#toolVerifyClasses')?.addEventListener('click',e=>{
  const btn=e.target.closest('.chip');
  if(!btn) return;
  btn.classList.toggle('active');
  if(!getSelectedToolVerifyClasses().length) btn.classList.add('active');
});
$('#toolVerifyRun')?.addEventListener('click',async()=>{
  if(!_currentAudit)return;
  const serialNumbers=parseSerialInput($('#toolVerifyScans')?.value||'');
  const classifications=getSelectedToolVerifyClasses();
  if(!classifications.length){ alert('Select at least one tool classification.'); return; }
  const btn=$('#toolVerifyRun');
  btn.disabled=true;
  btn.textContent='Verifying...';
  try{
    const result=await api(`/audits/api/${encodeURIComponent(_currentAudit.id)}/tool-verify`,{
      method:'POST',
      body:JSON.stringify({ serialNumbers, classifications })
    });
    _currentAudit=result.task||_currentAudit;
    if(result?.verification?.scannedSerials && $('#toolVerifyScans')) $('#toolVerifyScans').value=result.verification.scannedSerials.join('\n');
    renderToolVerifyResult(result.verification);
  }catch(err){
    alert(`Error: ${err.message}`);
  }finally{
    btn.disabled=false;
    btn.textContent='Verify Scan';
  }
});
$('#toolVerifyComplete')?.addEventListener('click',async()=>{
  if(!_currentAudit) return;
  const verification=_currentAudit.meta?.toolVerify;
  if(!verification?.allConfirmed){
    alert('Run a successful verification before completing this audit.');
    return;
  }
  const btn=$('#toolVerifyComplete');
  btn.disabled=true;
  btn.textContent='Completing...';
  try{
    const updatedVerification={
      ...verification,
      completedAt:new Date().toISOString(),
      completedBy:currentUser?.name||currentUser?.username||currentUser?.id||''
    };
    const result=await api(`/audits/api/${encodeURIComponent(_currentAudit.id)}`,{
      method:'PATCH',
      body:JSON.stringify({
        bucket:'done',
        meta:{
          notes:$('#dp-notes')?.value||'',
          toolVerify:updatedVerification
        }
      })
    });
    _currentAudit=result.task||_currentAudit;
    closePanel();
    await load();
  }catch(err){
    alert(`Error: ${err.message}`);
    updateToolVerifyCompleteButton(verification);
  }
});
const socket=window.io?.();
socket?.on?.('auditUpdated',()=>load().catch(()=>{}));

await whoami();
setupDrops();
await load();
