'use strict';
// One current lane for the image, profile, standards and results. Never hidden in an inspector.
main.insertAdjacentHTML('afterbegin',`<section id="currentLaneBar" class="current-lane-bar" aria-label="泳道切换与条带识别" hidden><div class="lane-switch"><span class="lane-switch-label">当前泳道</span><button id="previousLane" aria-label="上一个泳道">‹</button><select id="currentLane" aria-label="当前泳道"></select><button id="nextLane" aria-label="下一个泳道">›</button><span id="currentLanePosition"></span></div><div id="bandDetectionControls" class="band-detection-controls"><select id="bandDetectionScope" aria-label="自动识别范围"><option value="current">当前泳道</option><option value="lanes">当前通道全部泳道</option><option value="channels">全部通道全部泳道</option></select><button id="detectVisibleBands" class="primary">自动识别条带</button><button id="visibleBandParameters">识别参数</button></div><div id="bandDetectionConfirmation" hidden><span>范围内有手工调整的条带，重新识别会替换它们。</span><button id="confirmBandDetection">替换并识别</button><button id="cancelBandDetection">保留</button></div></section>`);
let laneOptionsSignature='',pendingBandDetection=null;
function syncCurrentLane(){
 const relevant=state.channels.length&&state.lanes.length&&!workflowHome&&!['colony','spots'].includes(state.experimentType);
 $('currentLaneBar').hidden=!relevant;
 if(!relevant){pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;return;}
 const signature=JSON.stringify(state.lanes.map(l=>[l.id,l.name,l.markerSpec?.name]));
 if(signature!==laneOptionsSignature){laneOptionsSignature=signature;selectedOptions($('currentLane'),state.lanes.map(l=>({id:l.id,name:l.id+' · '+(l.name||l.id)+(l.markerSpec?' · M':'' )})),laneID);}
 $('currentLane').value=laneID;
 const index=state.lanes.findIndex(l=>l.id===laneID);$('previousLane').disabled=index<=0;$('nextLane').disabled=index>=state.lanes.length-1;$('currentLanePosition').textContent=(index+1)+' / '+state.lanes.length;
 $('bandDetectionControls').hidden=gelPage!=='analysis'||currentStep()!=='bands'||tab==='markers';
 if(pendingBandDetection&&(pendingBandDetection.channel!==channelID||pendingBandDetection.lane!==laneID||currentStep()!=='bands')){pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;}
 $('visibleBandParameters').setAttribute('aria-pressed',String(!document.body.classList.contains('analysis-inspector-hidden')));
}
function changeCurrentLane(id){
 if(!state.lanes.some(l=>l.id===id))throw Error('该泳道已不存在');
 if(drag||window.gelInteractionActive?.()||polygon.length)throw Error('请先完成当前拖动，再切换泳道');
 captureGelCamera();armedMarker=null;profileAddMode=false;profileSelection=null;laneID=id;pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;
 updateSelectors();render();
 if(currentStep()==='results'&&gelPage==='analysis'){const b=(state.bands[bandKey(ch(),lane())]||[])[0];if(b)selectResultBand(laneID,b.id);}
 restoreGelCamera(gelPage);syncCurrentLane();
}
$('currentLane').addEventListener('change',guard(()=>changeCurrentLane(val('currentLane'))));
for(const [id,delta]of [['previousLane',-1],['nextLane',1]])on(id,()=>{const index=state.lanes.findIndex(l=>l.id===laneID),l=state.lanes[index+delta];if(l)changeCurrentLane(l.id);});
function bandDetectionTargets(){
 const scope=val('bandDetectionScope'),channels=scope==='channels'?state.channels:[ch()],lanes=scope==='current'?[lane()]:state.lanes;
 return channels.flatMap(c=>lanes.map(l=>({c,l,key:bandKey(c,l)})));
}
function detectVisibleBands(confirmed=false){
 if(currentStep()!=='bands'||!state.laneSetupConfirmed)throw Error('请先确认泳道，再核对条带');
 if(drag||window.gelInteractionActive?.())throw Error('请先完成当前编辑');
 const targets=bandDetectionTargets();
 if(!confirmed&&targets.some(t=>(state.bands[t.key]||[]).some(b=>b.manual))){pendingBandDetection={channel:channelID,lane:laneID,scope:val('bandDetectionScope')};$('bandDetectionConfirmation').hidden=false;return;}
 const detection=bandOptions(),measuring=targets.map(t=>({...t,bands:C.findBands(C.profile(t.c,t.l,options(t.c)),t.l,detection)}));
 reserveGelIDs();for(const t of measuring)state.bands[t.key]=t.bands.map(b=>({...b,id:allocateGelID('b',t.bands)}));
 pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;profileSelection=null;profileAddMode=false;invalidateCalibrations({targets:targets.map(t=>({channel:t.c.id,lane:t.l.id}))});
 const count=measuring.reduce((n,t)=>n+t.bands.length,0);history('常驻工具栏识别条带',{scope:val('bandDetectionScope'),channel:channelID,lane:laneID,parameters:detection,count});render();syncCurrentLane();const scopeText=val('bandDetectionScope')==='current'?(lane().name||laneID):val('bandDetectionScope')==='lanes'?'当前通道的 '+state.lanes.length+' 条泳道':state.channels.length+' 个通道的全部泳道';notify(scopeText+' · 找到 '+count+' 条候选条带，请核对曲线。');
}
on('detectVisibleBands',()=>detectVisibleBands());
on('confirmBandDetection',()=>{if(!pendingBandDetection)return;if(pendingBandDetection.scope!==val('bandDetectionScope'))throw Error('识别范围已改变，请重新点击自动识别');detectVisibleBands(true);});
on('cancelBandDetection',()=>{pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;});
$('bandDetectionScope').addEventListener('change',()=>{pendingBandDetection=null;$('bandDetectionConfirmation').hidden=true;});
on('visibleBandParameters',()=>{const open=document.body.classList.contains('analysis-inspector-hidden');if(open)$('analysisInspector').click();else{$('analysisSettings').scrollTop=0;}syncCurrentLane();});
// Keep old API entry points synchronized when a lane is selected on the image or in a list.
const selectorsBeforeLaneBar=updateSelectors;updateSelectors=function(){selectorsBeforeLaneBar();syncCurrentLane();};
const workflowBeforeLaneBar=updateWorkflow;updateWorkflow=function(){workflowBeforeLaneBar();syncCurrentLane();};
const renderBeforeLaneBar=render;render=function(){renderBeforeLaneBar();syncCurrentLane();};
const resultBandBeforeLaneBar=selectResultBand;selectResultBand=function(lid,bid){resultBandBeforeLaneBar(lid,bid);syncCurrentLane();};
$('analysisInspector').addEventListener('click',syncCurrentLane);
for(const id of ['pairLane','resultLane','bandLane','lane'])$(id).addEventListener('change',syncCurrentLane);
// A stationary click in pan mode selects a lane; drags remain pans.
window.afterLaneGesture=function(e,g){if(g.type!=='pan'||g.moved||armedMarker||e.altKey||e.button!==0)return;const raw=interactionRaw(e),l=[...state.lanes].reverse().find(l=>{const p=C.framePoint(l.frame,raw);return C.inside({type:'polygon',points:C.laneOutline(l)},p.x,p.y);});if(l&&l.id!==laneID)changeCurrentLane(l.id);};
syncCurrentLane();
