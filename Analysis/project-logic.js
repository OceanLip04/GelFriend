'use strict';
// Project identity, channel-scoped calculations and document lifecycle.
const calibrationFields=['mwSpec','mwModels','quantitySpec','quantityModel','calibrationDirty','amountPairs','relativeReference','relativeReferenceChannel','quantityMode','quantityDraft'];
let calibrationOwner=null,calibrationChannel='',logicRestoring=false,documentRevision=0,savedRevision=0,recoveryTimer=null,documentName='未命名实验',undoEntries=[],redoEntries=[],editBaseline=null;
const cloneGel=value=>JSON.parse(JSON.stringify(value));
function effectiveGelSteps(){return experiment().steps.filter(s=>s!=='marker'||state.lanes.some(l=>l.markerSpec));}
function reserveGelIDs(){
 const ids=[...state.lanes,...Object.values(state.bands).flat(),...(state.markerPairs||[]).map(p=>({id:p.band})),...(state.amountPairs||[]).map(p=>({id:p.band?.split('|')[1]}))];
 state.idSequences=state.idSequences||{};
 for(const obj of ids){const m=/^([A-Za-z]+)(\d+)$/.exec(obj.id||'');if(m)state.idSequences[m[1]]=Math.max(state.idSequences[m[1]]||0,Number(m[2]));}
 for(const spec of [state.mwSpec,state.quantitySpec,...Object.values(state.analysisByChannel||{}).flatMap(a=>[a.mwSpec,a.quantitySpec])])for(const row of spec?.rows||[]){for(const id of row.slice(0,2)){const m=/^([A-Za-z]+)(\d+)$/.exec(id||'');if(m)state.idSequences[m[1]]=Math.max(state.idSequences[m[1]]||0,Number(m[2]));}}
}
window.allocateGelID=function(prefix,items=[]){reserveGelIDs();for(const obj of items){const n=Number(String(obj.id).slice(prefix.length));if(Number.isInteger(n))state.idSequences[prefix]=Math.max(state.idSequences[prefix]||0,n);}const n=(state.idSequences[prefix]||0)+1;state.idSequences[prefix]=n;return prefix+n;};
function freshGelLanes(lanes){return lanes.map(l=>({...l,id:allocateGelID('L',lanes)}));}
function storeCalibration(){if(calibrationOwner!==state||!calibrationChannel)return;state.analysisByChannel=state.analysisByChannel||{};const a=state.analysisByChannel[calibrationChannel]||(state.analysisByChannel[calibrationChannel]={});for(const key of calibrationFields){if(state[key]===undefined)delete a[key];else a[key]=state[key];}a.controls={mwMethod:val('mwMethod'),mwCombine:val('mwCombine'),extrapolate:checked('extrapolate'),quantityMethod:val('quantityMethod'),quantityUnit:val('quantityUnit')};}
function activateCalibration(){
 if(!state.channels.length)return;
 if(calibrationOwner===state&&calibrationChannel===channelID)return;
 if(calibrationOwner===state)storeCalibration();
 else {calibrationOwner=state;state.analysisByChannel=state.analysisByChannel||{};const legacy=state.mwSpec?.channel||state.quantitySpec?.channel||channelID;if(!state.analysisByChannel[legacy]){state.analysisByChannel[legacy]={};for(const key of calibrationFields)if(state[key]!==undefined)state.analysisByChannel[legacy][key]=state[key];}}
 calibrationChannel=channelID;const a=state.analysisByChannel[channelID]||(state.analysisByChannel[channelID]={});for(const key of calibrationFields){if(a[key]===undefined)delete state[key];else state[key]=a[key];}
 state.calibrationDirty=state.calibrationDirty||{};state.amountPairs=state.amountPairs||[];state.quantityMode=state.quantityMode||'relative';
 for(const p of state.amountPairs)p.channel=p.channel||channelID;
 const controls=a.controls||{mwMethod:a.mwSpec?.method||'loglinear',mwCombine:a.mwSpec?.combine||'nearest',extrapolate:a.mwSpec?.extrapolate||false,quantityMethod:a.quantitySpec?.method||'linear',quantityUnit:a.quantitySpec?.unit||'ng'};
 for(const [id,v]of Object.entries(controls)){if($(id).type==='checkbox')$(id).checked=Boolean(v);else $(id).value=v;}
 workflowPanelSignature='';workflowResultSignature='';
}
function calibrationFor(cid=channelID){if(cid===channelID)return state;return state.analysisByChannel?.[cid];}
const selectorsBeforeLogic=updateSelectors;updateSelectors=function(){activateCalibration();selectorsBeforeLogic();syncDisplayControls();};
window.applyChannelCalibrations=function(){
 activateCalibration();storeCalibration();
 for(const list of Object.values(state.bands))for(const b of list){delete b.mw;delete b.mwUnit;delete b.quantity;delete b.quantityUnit;}
 for(const [cid,a]of Object.entries(state.analysisByChannel||{})){
  a.calibrationDirty=a.calibrationDirty||{};
  for(const kind of ['size','quantity']){
   const spec=kind==='size'?a.mwSpec:a.quantitySpec;if(!spec||a.calibrationDirty[kind])continue;
   try{if(kind==='size'){
    a.mwModels=fitMW(spec);for(const l of state.lanes)for(const b of state.bands[cid+'|'+l.id]||[]){b.mw=C.multiMW(a.mwModels,C.laneCenter(l,(l.y0+l.y1)/2),b.rf,spec.combine,spec.extrapolate);b.mwUnit=spec.unit;}
   }else{
    a.quantityModel=fitQuantity(spec);for(const l of state.lanes)for(const b of state.bands[cid+'|'+l.id]||[]){const n=C.predict(a.quantityModel,b.netVolume,spec.extrapolate);b.quantity=n!==null&&n>=0?n:null;b.quantityUnit=spec.unit;}
   }}catch(e){a.calibrationDirty[kind]=true;delete a[kind==='size'?'mwModels':'quantityModel'];a.reason=e.message;}
  }
 }
 const a=state.analysisByChannel[channelID]||{};for(const key of calibrationFields)if(a[key]!==undefined)state[key]=a[key];else delete state[key];
 $('mwFitInfo').textContent=state.calibrationDirty?.size?'Marker 已修改，请核对后更新':state.mwModels?.map(m=>m.lane+' · '+m.model.points.length+' 个标准点').join('\n')||'';
 $('quantityFitInfo').textContent=state.calibrationDirty?.quantity?'量标准有修改，请更新定量结果':state.quantityModel?state.quantityModel.n+' 个标准点 · '+state.quantitySpec.unit:'';
};
window.invalidateGelDependencies=function(scope={size:true,quantity:true,western:true}){
 activateCalibration();storeCalibration();
 const targets=scope.targets,ids=targets?[...new Set(targets.map(t=>t.channel))]:scope.allChannels?Object.keys(state.analysisByChannel||{}):[channelID];
 for(const cid of ids){const a=state.analysisByChannel?.[cid];if(!a)continue;a.calibrationDirty={...a.calibrationDirty};
  for(const [kind,key]of [['size','mwSpec'],['quantity','quantitySpec']]){
   const spec=a[key];const affected=targets?(spec?.rows?.some(row=>targets.some(t=>t.channel===cid&&t.lane===row[0]&&(!t.band||t.band===row[1])))??Boolean(spec)):Boolean(scope[kind]);
   if(affected&&spec){a.calibrationDirty[kind]=true;delete a[kind==='size'?'mwModels':'quantityModel'];}
  }
 }
 if(scope.western!==false&&(!targets||!state.wbSpec||targets.some(t=>[state.wbSpec?.target,state.wbSpec?.reference].includes(t.channel)))){state.wb=[];state.wbDirty=Boolean(state.wbSpec);}
 const a=state.analysisByChannel?.[channelID];if(a)state.calibrationDirty=a.calibrationDirty;
 if(targets){state.bandReviews=state.bandReviews||{};for(const t of targets)delete state.bandReviews[t.channel+'|'+t.lane];state.workflowDone=(state.workflowDone||[]).filter(s=>!['bands','results'].includes(s));}
 applyChannelCalibrations();
};
function markQuantityDraft(){state.quantityDraft=true;state.calibrationDirty={...state.calibrationDirty,quantity:Boolean(state.quantitySpec)};if(state.quantitySpec){for(const [key,list] of Object.entries(state.bands))if(key.startsWith(channelID+'|'))for(const b of list){delete b.quantity;delete b.quantityUnit;}}storeCalibration();history('编辑量标准草稿');updateWorkflow();}
for(const id of ['quantityMethod','quantityUnit'])$(id).addEventListener('change',()=>{if(state.experimentType!=='spots')markQuantityDraft();});
for(const id of ['mwMethod','mwCombine','extrapolate'])$(id).addEventListener('change',()=>{invalidateCalibrations({size:true,quantity:false,western:false});history('修改大小标定方法');render();});
// Two distinct quantitative tasks; relative comparisons have a complete exit.
$('quantityPanel').insertAdjacentHTML('afterbegin','<label>比较方式<select id="quantityMode"><option value="relative">相对信号比较</option><option value="absolute">已知量标定</option></select></label>');
const amountControls=document.createElement('div');amountControls.id='absoluteQuantityControls';
for(const child of [...$('quantityPanel').children])if(child=== $('quantityEditor')||child=== $('addQuantityStandard')||child===$('quantityMethodControls')||child===$('quantityStatus')||child.tagName==='H2'&&child.textContent==='已知量标定'||child.tagName==='P'&&child.textContent==='选择标准条带，填写实际已知数量。')amountControls.append(child);
$('quantityPanel').append(amountControls);
$('quantityMode').addEventListener('change',()=>{state.quantityMode=val('quantityMode');history('切换定量任务');updateWorkflow();});
function syncQuantityMode(){if(!state.channels.length)return;$('quantityMode').value=state.quantityMode||'relative';$('absoluteQuantityControls').hidden=state.quantityMode!=='absolute';if(state.quantityMode==='absolute'&&$('quantityMethodControls').parentElement!==amountControls)amountControls.append($('quantityMethodControls'));}
// One display record per channel. Rendering never writes to raw pixels.
function displaySettings(c=ch()){
 if(!c.display){const sample=[];for(let i=0;i<c.data.length;i+=Math.max(1,Math.floor(c.data.length/8192)))sample.push(c.data[i]);const limit=2**c.bitDepth-1,low=C.clamp(Math.floor(C.quantile(sample,.01)),0,limit-1);c.display={low,high:C.clamp(Math.max(Math.ceil(C.quantile(sample,.995)),low+1),low+1,limit),gamma:1,inverted:false};}
 return c.display;
}
function syncDisplayControls(){if(!state.channels.length)return;const d=displaySettings();$('viewerBlack').value=d.low;$('viewerWhite').value=d.high;$('viewerGamma').value=d.gamma;$('viewerInvert').checked=d.inverted;$('invertPreview').checked=d.inverted;}
window.sharedGelImageLayer=function(){
 const sources=checked('overlay')?state.channels:[ch()],key=JSON.stringify([channelID,checked('overlay'),sources.map(c=>displaySettings(c))]);if(imageCache?.key===key)return imageCache.canvas;
 const c=ch(),canvas=document.createElement('canvas');canvas.width=c.width;canvas.height=c.height;const ctx=canvas.getContext('2d'),out=ctx.createImageData(c.width,c.height);
 const luts=sources.map(c=>{const d=displaySettings(c),lut=new Uint8Array(2**c.bitDepth);for(let v=0;v<lut.length;v++){let n=C.clamp((v-d.low)/(d.high-d.low),0,1)**(1/d.gamma);lut[v]=Math.round((d.inverted?1-n:n)*255);}return lut;});
 for(let i=0;i<c.data.length;i++){let rgb=[0,0,0];sources.forEach((s,k)=>{const v=luts[k][s.data[i]];if(sources.length===1)rgb=[v,v,v];else{const color=[[1,.15,.15],[.15,1,.2],[.2,.4,1],[1,.7,.1],[.8,.2,1],[.1,1,1]][k%6];rgb=rgb.map((x,j)=>Math.min(255,x+v*color[j]));}});for(let j=0;j<3;j++)out.data[i*4+j]=Math.round(rgb[j]);out.data[i*4+3]=255;}
 ctx.putImageData(out,0,0);imageCache={key,canvas};return canvas;
};
const viewerUpdateBeforeLogic=window.updateGelViewer;window.updateGelViewer=function(){const r=viewerUpdateBeforeLogic();if(state.channels.length){syncDisplayControls();viewerBitmap=null;drawViewer();}return r;};
function commitDisplay(){const c=ch(),low=num('viewerBlack'),high=num('viewerWhite'),gamma=num('viewerGamma');if(low<0||high<=low||high>2**c.bitDepth-1||gamma<.1||gamma>5){syncDisplayControls();throw Error('请设置有效的黑白点与 Gamma');}c.display={low,high,gamma,inverted:checked('viewerInvert')};imageCache=null;viewerBitmap=null;syncDisplayControls();drawImage();drawViewer();markGelDocumentChanged();}
for(const id of ['viewerBlack','viewerWhite','viewerGamma','viewerInvert'])$(id).addEventListener('change',guard(commitDisplay));
$('invertPreview').addEventListener('change',()=>{if(!state.channels.length)return;displaySettings().inverted=checked('invertPreview');imageCache=null;viewerBitmap=null;syncDisplayControls();drawImage();drawViewer();markGelDocumentChanged();});
for(const id of ['viewerAutoContrast','viewerReset'])$(id).addEventListener('click',()=>{if(!state.channels.length)return;delete ch().display;const d=displaySettings();if(id==='viewerReset')d.inverted=false;syncDisplayControls();imageCache=null;viewerBitmap=null;render();markGelDocumentChanged();});
// Project-wide history excludes raw pixels and view navigation; 8 MiB bounded in memory.
function editSnapshot(){storeCalibration();const {channels,history,viewCamera,viewAngle,workflowStep,idSequences,...data}=state;const perChannel=channels.map(({data,raw,display,...c})=>c);return JSON.stringify({state:data,channels:perChannel,settings:settings()});}
function resetGelHistory(){undoEntries=[];redoEntries=[];editBaseline=state.channels.length?editSnapshot():null;}
function recordGelEdit(action){if(logicRestoring||!state.channels.length)return;const next=editSnapshot();if(editBaseline&&editBaseline!==next){undoEntries.push({action,before:editBaseline,after:next});redoEntries=[];while(undoEntries.length>40||undoEntries.reduce((n,e)=>n+2*(e.before.length+e.after.length),0)>8*1024*1024)undoEntries.shift();}editBaseline=next;syncProjectHistory();}
function restoreGelEdit(serialized){const saved=JSON.parse(serialized),channels=state.channels,view={viewCamera:currentGelCamera(),viewAngle:gelRotation(),workflowStep:currentStep()},history=state.history,ids=state.idSequences;logicRestoring=true;
 try{state={...saved.state,channels:channels.map(c=>({...c,...saved.channels.find(s=>s.id===c.id)})),history,idSequences:ids,...view};calibrationOwner=null;for(const [id,value]of Object.entries(saved.settings))if($(id)){if($(id).type==='checkbox')$(id).checked=Boolean(value);else $(id).value=value;}activateCalibration();profileSelection=null;workflowPanelSignature='';updateSelectors();applyCalibrations();if(!state.laneSetupConfirmed&&['bands','marker','quantity','western'].includes(currentStep()))state.workflowStep='lanes';render();restoreGelCamera(gelPage);editBaseline=editSnapshot();markGelDocumentChanged();}finally{logicRestoring=false;syncProjectHistory();}}
function undoGelEdit(){const entry=undoEntries.pop();if(!entry)return;redoEntries.push(entry);restoreGelEdit(entry.before);notify('已撤销：'+entry.action);}
function redoGelEdit(){const entry=redoEntries.pop();if(!entry)return;undoEntries.push(entry);restoreGelEdit(entry.after);notify('已重做：'+entry.action);}
$('currentLaneBar').insertAdjacentHTML('beforeend','<div class="project-history"><button id="projectUndo" aria-label="撤销编辑">↶</button><button id="projectRedo" aria-label="重做编辑">↷</button></div>');
on('projectUndo',undoGelEdit);on('projectRedo',redoGelEdit);
for(const id of ['profileUndo','laneEditUndo'])$(id).addEventListener('click',e=>{e.stopImmediatePropagation();undoGelEdit();},true);
function syncProjectHistory(){if(!$('projectUndo'))return;$('projectUndo').disabled=!undoEntries.length;$('projectRedo').disabled=!redoEntries.length;$('projectUndo').title=undoEntries.length?'撤销：'+undoEntries.at(-1).action:'没有可撤销的编辑';$('projectRedo').title=redoEntries.length?'重做：'+redoEntries.at(-1).action:'没有可重做的编辑';$('profileUndo').disabled=!undoEntries.length;$('laneEditUndo').disabled=!undoEntries.length;}
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){e.preventDefault();e.stopImmediatePropagation();e.shiftKey?redoGelEdit():undoGelEdit();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();requestGelSave(e.shiftKey);}},true);
// Data changes publish an acknowledgement-aware revision to the native document.
function syncDocumentStatus(){const label=$('documentSaveState');if(label){label.hidden=!state.channels.length;label.textContent=documentName+(documentRevision!==savedRevision?' · 未保存':' · 已保存');}}
function markGelDocumentChanged(){if(logicRestoring||!state.channels.length)return;documentRevision++;native('documentEdited',{revision:documentRevision});syncDocumentStatus();clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{if(documentRevision!==savedRevision)native('recovery',{text:JSON.stringify(project()),revision:documentRevision});},1800);}
const historyBeforeLogic=history;history=function(action,detail={}){historyBeforeLogic(action,detail);if(logicRestoring||['导出当前实验报告','导出报告'].includes(action))return;if(['载入合成演示','导入通道','重新打开项目'].includes(action)){calibrationOwner=null;activateCalibration();reserveGelIDs();resetGelHistory();return;}if(!['统一显示旋转','导出当前实验报告','导出报告'].includes(action))recordGelEdit(action);markGelDocumentChanged();};
$('documentLabel').insertAdjacentHTML('afterend','<span id="documentSaveState" class="document-save-state"></span>');
window.requestGelSave=function(saveAs=false){if(!state.channels.length)return;const focused=document.activeElement;if(focused&&/^(INPUT|TEXTAREA)$/.test(focused.tagName)&&focused.dataset.committedValue!==undefined&&focused.dataset.committedValue!==focused.value)focused.dispatchEvent(new Event('change',{bubbles:true}));native('saveProject',{text:JSON.stringify(project(),null,2),revision:documentRevision,saveAs});};
$('saveProject').addEventListener('click',e=>{e.stopImmediatePropagation();requestGelSave();},true);
window.projectSaved=function(p){savedRevision=p.revision;documentName=p.name||documentName;syncDocumentStatus();};
window.documentReplacementReady=function(p={}){clearTimeout(recoveryTimer);documentRevision=0;savedRevision=p.saved?0:-1;documentName=p.name||'未命名实验';resetGelHistory();native('documentReady',{revision:documentRevision,saved:p.saved===true});syncDocumentStatus();if(!p.saved)markGelDocumentChanged();};
window.nativeProjectCommand=function(command){if(command==='save')requestGelSave();else if(command==='saveAs')requestGelSave(true);else if(command==='undo')undoGelEdit();else if(command==='redo')redoGelEdit();else if(command==='batch'){if(state.channels.length){const d=displaySettings();native('batchSettings',{...d,angle:gelRotation()});}else native('batchSettings');}};
window.prepareGelProject=function(){activateCalibration();storeCalibration();reserveGelIDs();state.viewCamera=currentGelCamera();};
const receiveProjectBeforeLogic=window.receiveProject;window.receiveProject=guard(async p=>{validateChannelAnalyses(p);await receiveProjectBeforeLogic(p);if(!pendingProject){calibrationOwner=null;activateCalibration();reserveGelIDs();applyCalibrations();render();}});
function validateChannelAnalyses(p){for(const marker of p?.markers||[])C.validateMarker(marker);for(const [id,value] of Object.entries(p?.settings||{})){const input=$(id);if(!input||!settingIDs.includes(id))continue;if(input.type==='number'&&value!==''&&!Number.isFinite(Number(value)))throw Error('项目数值设置无效');if(input.tagName==='SELECT'&&![...input.options].some(o=>o.value===String(value)))throw Error('项目选项设置无效');}const channels=p?.state?.channels?.map(c=>c.id)||[];for(const [cid,a]of Object.entries(p?.state?.analysisByChannel||{})){if(!channels.includes(cid)||!a||typeof a!=='object'||Array.isArray(a))throw Error('项目通道标定记录无效');for(const key of ['mwSpec','quantitySpec'])if(a[key]&&(a[key].channel!==cid||!Array.isArray(a[key].rows)||a[key].rows.length>2000||a[key].rows.some(row=>!Array.isArray(row)||row.length!==3)))throw Error('项目标准记录无效');if(a.amountPairs&&(!Array.isArray(a.amountPairs)||a.amountPairs.some(x=>typeof x.band!=='string'||typeof x.value!=='string'||x.channel&&x.channel!==cid)))throw Error('项目量标准通道无效');}for(const c of p?.state?.channels||[]){if(c.ceiling!==undefined&&(!Number.isFinite(c.ceiling)||c.ceiling<1||c.ceiling>2**c.bitDepth-1))throw Error('项目饱和值无效');}for(const c of p?.state?.channels||[])if(c.display&&(!Number.isFinite(c.display.low)||!Number.isFinite(c.display.high)||c.display.low<0||c.display.high<=c.display.low||c.display.high>2**c.bitDepth-1||!Number.isFinite(c.display.gamma)||c.display.gamma<.1||c.display.gamma>5))throw Error('项目显示设置无效');}
// Per-lane review is explicit, distinct from automated detection or hand edits.
$('bandDetectionControls').insertAdjacentHTML('beforeend','<button id="confirmCurrentBands">本泳道已核对</button>');
on('confirmCurrentBands',()=>{state.bandReviews=state.bandReviews||{};state.bandReviews[bandKey(ch(),lane())]=true;history('核对泳道条带',{channel:channelID,lane:laneID});render();});
const workflowBeforeLogic=updateWorkflow;updateWorkflow=function(){activateCalibration();workflowBeforeLogic();syncQuantityMode();if(state.channels.length){$('confirmCurrentBands').textContent=state.bandReviews?.[channelID+'|'+laneID]?'✓ 已核对':'本泳道已核对';}syncProjectHistory();syncDocumentStatus();};
const renderBeforeLogic=render;render=function(){activateCalibration();renderBeforeLogic();syncProjectHistory();};
// Export is reviewed in an overlay so the gel keeps its space.
document.body.insertAdjacentHTML('beforeend','<dialog id="exportReview" role="dialog" aria-modal="true" aria-labelledby="exportReviewTitle"><h2 id="exportReviewTitle">导出前，再看一眼</h2><p id="exportReviewSummary"></p><div id="exportReviewIssues"></div><p class="hint">结果表、完整数据、标注图与参数记录将保存到新文件夹。未完成内容标为草稿。</p><div class="button-row"><button id="cancelExportReview">返回胶图</button><button id="confirmExportReview" class="primary">导出报告</button></div></dialog>');
function gelExportIssues(){const issues=[];if(!['colony','spots'].includes(state.experimentType)&&!allBandRows().length)issues.push({step:state.lanes.length?'bands':'lanes',text:state.lanes.length?'尚未建立条带':'尚未设置泳道'});for(const c of state.channels){const a=calibrationFor(c.id)||{};for(const [kind,title]of [['size','大小标定'],['quantity','量标准']])if(a.calibrationDirty?.[kind]||kind==='quantity'&&a.quantityDraft)issues.push({channel:c.id,step:kind==='size'?'marker':'quantity',text:c.name+' · '+title+'有修改待更新'});for(const l of state.lanes){const bands=state.bands[c.id+'|'+l.id]||[];if(!bands.length)continue;if(!state.bandReviews?.[c.id+'|'+l.id])issues.push({channel:c.id,lane:l.id,step:'bands',text:(l.name||l.id)+' · '+c.name+' 条带待人工核对'});if(bands.some(b=>b.saturated))issues.push({channel:c.id,lane:l.id,step:'bands',text:(l.name||l.id)+' · 含饱和信号'});}}
 for(const p of state.markerPairs||[])if(p.band&&p.band!=='skip'&&!getBand(p.channel,p.lane,p.band))issues.push({channel:p.channel,lane:p.lane,step:'marker',text:p.lane+' · '+p.value+' 标准带已删除，请重新对应'});
 if(!state.laneSetupConfirmed&&state.lanes.length)issues.push({step:'lanes',text:'泳道有修改，尚未确认'});
 if(state.wbDirty)issues.push({step:'western',text:'归一化需要更新'});return issues;}
function openExportReview(){ch();const issues=gelExportIssues();$('exportReviewSummary').textContent=experiment().name+' · '+state.channels.length+' 个通道 · '+(issues.length?issues.length+' 项需要核对':'当前设置已核对');$('exportReviewIssues').replaceChildren();for(const issue of issues){const b=document.createElement('button');b.className='export-issue';b.textContent=issue.text+' →';b.addEventListener('click',()=>{closeExportReview();if(issue.channel){channelID=issue.channel;updateSelectors();}if(issue.lane)changeCurrentLane(issue.lane);selectWorkflowStep(issue.step,{restore:true});});$('exportReviewIssues').append(b);}$('confirmExportReview').textContent=issues.length?'导出草稿报告':'导出报告';if(typeof $('exportReview').showModal==='function')$('exportReview').showModal();else $('exportReview').setAttribute('open','');$('cancelExportReview').focus();}
function closeExportReview(){if(typeof $('exportReview').close==='function')$('exportReview').close();else $('exportReview').removeAttribute('open');}
on('cancelExportReview',closeExportReview);on('confirmExportReview',()=>{closeExportReview();report();});
$('exportReview').addEventListener('cancel',e=>{e.preventDefault();closeExportReview();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('exportReview').open){e.preventDefault();e.stopImmediatePropagation();closeExportReview();}},true);
$('demo').addEventListener('click',()=>documentReplacementReady({saved:false,name:'合成演示'}));
document.addEventListener('focusin',e=>{if(/^(INPUT|TEXTAREA)$/.test(e.target.tagName))e.target.dataset.committedValue=e.target.value;});
document.addEventListener('change',e=>{if(/^(INPUT|TEXTAREA)$/.test(e.target.tagName))e.target.dataset.committedValue=e.target.value;if(!state.channels.length||logicRestoring||['channel','viewerChannel','currentLane','lane','resultLane','resultBand','pairLane','bandLane','libraryMarker','bandDetectionScope','relativeReference'].includes(e.target.id))return;recordGelEdit('修改实验设置');markGelDocumentChanged();});
updateWorkflow();resetGelHistory();
