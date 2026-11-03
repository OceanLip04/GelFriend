'use strict';
// Manual geometry comes first; marker assignments are saved with each lane.
let laneAnchorIndex=0,laneAnchorPreview=null;
const anchorNames=['第一个','第二个','最后一个'];
window.updateLaneSetup=function(){
 document.body.classList.toggle('gel-lane-setup',tab==='gel'&&(state.workflowStep==='lanes'||!state.laneSetupConfirmed));
 const boxes=state.laneAnchors||[],count=[0,1,2].filter(i=>boxes[i]).length,selecting=val('tool')==='laneAnchors';
 $('laneAnchorInfo').textContent=selecting?`正在框选${anchorNames[laneAnchorIndex]}泳道 · ${count}/3 已完成`:count===3?'3 个参考泳道已就绪':count?`${count}/3 已完成，可点击上方继续框选`:'选择三个参考泳道后生成等距泳道';
 $('startLaneAnchors').textContent=count?'重新框选':'开始框选';$('startLaneAnchors').classList.toggle('primary',count<3);
 $('cancelLaneAnchors').disabled=!selecting;
 for(const [i,id]of ['anchorFirst','anchorSecond','anchorLast'].entries()){
  const button=$(id);button.setAttribute('aria-pressed',String(selecting&&laneAnchorIndex===i));button.classList.toggle('is-complete',Boolean(boxes[i]));
  button.title=boxes[i]?`${anchorNames[i]}泳道已框选；点击可重选`:`框选${anchorNames[i]}泳道`;
 }
 updateAnchorPreview();
 const roster=$('laneRoster'),focused=roster.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;roster.replaceChildren();roster.classList.toggle('placeholder',!state.lanes.length);
 for(const l of state.lanes){
  const row=document.createElement('div');row.className='lane-roster-row'+(l.id===laneID?' selected':'');
  const selectLane=document.createElement('button');selectLane.textContent=l.id;selectLane.setAttribute('aria-label','选择泳道 '+l.id);selectLane.classList.toggle('active',l.id===laneID);
  selectLane.addEventListener('click',()=>{laneID=l.id;$('tool').value='select';updateSelectors();render();});
  const marker=document.createElement('select');marker.setAttribute('aria-label',l.id+' Marker');
  const sample=document.createElement('option');sample.value='';sample.textContent='样本 · 非 Marker';marker.append(sample);
  const choices=[...library];if(l.markerSpec&&!choices.some(m=>m.id===l.markerSpec.id))choices.push(l.markerSpec);
  for(const m of choices.filter(m=>!state.experimentType||!window.experimentsUnit||m.unit===experimentsUnit()||m.id===l.markerSpec?.id)){const o=document.createElement('option');o.value=m.id;o.textContent=m.name+' · '+m.unit+(state.experimentType&&window.experimentsUnit&&m.unit!==experimentsUnit()?' · 单位不兼容':'');marker.append(o);}
  marker.value=l.markerSpec?.id||'';
  marker.addEventListener('change',guard(()=>assignLaneMarker(l.id,marker.value)));
  const remove=document.createElement('button');remove.textContent='删除';remove.setAttribute('aria-label','删除泳道 '+l.id);remove.addEventListener('click',guard(()=>removeSetupLane(l.id)));
  const name=document.createElement('input');name.value=l.name||l.id;name.maxLength=100;name.setAttribute('aria-label',l.id+' 样本名称');name.addEventListener('change',()=>{l.name=name.value.trim()||l.id;history('命名样本',{lane:l.id,name:l.name});updateSelectors();render();});
  row.append(selectLane,name,marker,remove);roster.append(row);
 }
 if(!state.lanes.length)roster.textContent='生成泳道后，逐条删除空泳道并选择 Marker。';
 if(focused)Array.from(roster.querySelectorAll('[aria-label]')).find(el=>el.getAttribute('aria-label')===focused)?.focus({preventScroll:true});
 $('confirmLanes').disabled=!state.lanes.length;
 $('laneReviewInfo').textContent=`${state.lanes.length} 条泳道 · ${state.lanes.filter(l=>l.markerSpec).length} 条 Marker`+(state.laneSetupConfirmed?' · 已确认':' · 待确认');
 const showingLanes=state.workflowStep==='lanes'||!state.laneSetupConfirmed;$('laneSetupStep').hidden=!showingLanes;$('bandAnalysisStep').hidden=showingLanes;
 selectedOptions($('bandLane'),state.lanes,laneID);
 $('bandLaneSummary').textContent=`${state.lanes.length} 条泳道 · ${state.lanes.filter(l=>l.markerSpec).length} 条 Marker`;
 if(window.updateInterface)window.updateInterface();
};
function chooseLaneAnchor(index){ch();laneAnchorIndex=index;analysisPanning=false;$('tool').value='laneAnchors';polygon=[];drag=null;updateLaneSetup();$('canvasHint').textContent=`框选${anchorNames[index]}泳道的完整分析高度；前两个泳道必须相邻。`;drawImage();}
on('startLaneAnchors',()=>{ch();state.laneAnchors=[];state.laneAnchorAccepted=false;delete state.laneAnchorFrame;chooseLaneAnchor(0);});
on('cancelLaneAnchors',()=>{$('tool').value='select';drag=null;updateLaneSetup();drawImage();});
for(const [i,id]of ['anchorFirst','anchorSecond','anchorLast'].entries())on(id,()=>chooseLaneAnchor(i));
window.acceptLaneAnchor=function(region){
 const c=ch();if(region.w<2||region.h<2)throw Error('请拖动框选至少 2 × 2 像素');
 const frame=gelFrame(),r=C.rect(region,frame.width,frame.height);state.laneAnchorFrame=frame;state.laneAnchorAccepted=false;state.laneAnchors=state.laneAnchors||[];state.laneAnchors[laneAnchorIndex]=r;
 history('手动泳道参考框',{index:laneAnchorIndex,region:r});
 if(laneAnchorIndex<2)chooseLaneAnchor(laneAnchorIndex+1);else{$('tool').value='select';updateLaneSetup();drawImage();notify('已显示虚线泳道预览。数量不对可直接调整，确认后使用这些泳道。');}
};
function updateAnchorPreview(){
 laneAnchorPreview=null;const ready=[0,1,2].every(i=>state.laneAnchors?.[i]);
 $('laneAnchorPreviewControls').hidden=!ready;
 if(document.activeElement!==$('anchorLaneCount'))$('anchorLaneCount').value=state.laneAnchorCount||'';
 $('buildAnchoredLanes').disabled=true;
 if(!ready){$('buildAnchoredLanes').textContent='生成等距泳道';return;}
 if(state.laneAnchorAccepted===undefined&&state.lanes.length)state.laneAnchorAccepted=true;
 try{
  const frame=state.laneAnchorFrame||gelFrame(),layout=C.anchoredLaneLayout(state.laneAnchors,frame.width,frame.height,num('anchorAngle'),state.laneAnchorCount||0);
  if(frame.angle)for(const l of layout.lanes){l.frame={...frame};validateRawLane(l,ch());}
  laneAnchorPreview=layout;
  $('anchorLaneCount').placeholder='自动 · '+layout.count;
  $('anchorCountMinus').disabled=layout.count<=3;$('anchorCountPlus').disabled=layout.count>=200;
  $('laneAnchorPreviewInfo').textContent=state.laneAnchorAccepted?`已生成 ${state.lanes.length} 条泳道。要调整数量，修改上面的数字即可预览重排。`:`预览 ${layout.count} 条泳道 · 首末位置固定。`+(layout.uncertain&&!state.laneAnchorCount?' 数量可能有偏差，直接改数字，无需重画。':' 数量不对可直接修改。')+(layout.widthAdjusted?' 框偏宽，已收窄以避免相邻泳道重叠。':'')+(state.lanes.length?' 使用预览会替换现有泳道、Marker 分配与条带。':'');
  $('laneAnchorPreviewInfo').classList.remove('preview-error');
  $('buildAnchoredLanes').textContent=state.laneAnchorAccepted?'已生成泳道':`使用这 ${layout.count} 条泳道`;
  $('buildAnchoredLanes').disabled=Boolean(state.laneAnchorAccepted);
 }catch(e){$('laneAnchorPreviewInfo').textContent=e.message;$('laneAnchorPreviewInfo').classList.add('preview-error');$('buildAnchoredLanes').textContent='请先调整预览';$('anchorCountMinus').disabled=false;$('anchorCountPlus').disabled=false;}
}
window.drawLaneAnchors=function(ctx,scale){
 if(tab!=='gel'||state.laneSetupConfirmed)return;
 if(!state.laneAnchorAccepted&&laneAnchorPreview){ctx.save();ctx.lineWidth=1.3*scale;ctx.strokeStyle='#6ee6e3';ctx.setLineDash([6*scale,4*scale]);
  for(const l of laneAnchorPreview.lanes){drawLaneOutline(ctx,l,l.y0,l.y1);ctx.fillStyle='#6ee6e3';const p=C.rawPoint(l.frame,{x:l.xTop,y:l.y0-5*scale});ctx.fillText(l.id,p.x,p.y);}ctx.restore();
 }
 if(val('tool')!=='laneAnchors')return;
 for(const [i,r]of (state.laneAnchors||[]).entries())if(r){ctx.setLineDash([5*scale,3*scale]);drawRawPolygon(ctx,rectanglePoints(r).map(p=>C.rawPoint(state.laneAnchorFrame,p)),'#6ee6e3');ctx.setLineDash([]);ctx.fillStyle='#6ee6e3';const label=C.rawPoint(state.laneAnchorFrame,{x:r.x,y:r.y-4*scale});ctx.fillText(anchorNames[i],label.x,label.y);}
};
function changeAnchorCount(value){state.laneAnchorCount=value;state.laneAnchorAccepted=false;updateLaneSetup();drawImage();}
$('anchorLaneCount').addEventListener('input',guard(()=>{const text=val('anchorLaneCount');changeAnchorCount(text===''?0:Number(text));}));
for(const [id,delta]of [['anchorCountMinus',-1],['anchorCountPlus',1]])on(id,()=>{const count=laneAnchorPreview?.count||3;changeAnchorCount(C.clamp(count+delta,3,200));});
$('anchorAngle').addEventListener('change',()=>{state.laneAnchorAccepted=false;updateLaneSetup();drawImage();});
on('buildAnchoredLanes',()=>{
 updateAnchorPreview();if(!laneAnchorPreview||state.laneAnchorAccepted)throw Error('请先检查虚线泳道预览');
 reserveGelIDs();const lanes=freshGelLanes(laneAnchorPreview.lanes);state.lanes=lanes;state.bands={};state.laneAnchorAccepted=true;laneID=lanes[0].id;$('tool').value='select';
 newGeometry();history('三框等距泳道',{anchors:state.laneAnchors,angle:num('anchorAngle'),count:lanes.length,manualCount:state.laneAnchorCount||0});
 $('skewInfo').textContent='';notify(`已生成 ${lanes.length} 条泳道。可直接拖框调位置，删除空泳道并选择 Marker。`);
});
window.removeSetupLane=function(id){
 const l=state.lanes.find(l=>l.id===id);if(!l)throw Error('泳道不存在');
 reserveGelIDs();const index=state.lanes.indexOf(l);state.lanes=state.lanes.filter(a=>a.id!==id);
 for(const c of state.channels)delete state.bands[bandKey(c,l)];
 if(laneID===id)laneID=state.lanes[Math.min(index,state.lanes.length-1)]?.id||'';
 history('删除泳道',{id,name:l.name,marker:l.markerSpec||null});newGeometry();
};
function assignLaneMarker(id,markerID){
 const l=state.lanes.find(l=>l.id===id);if(!l)throw Error('泳道不存在');
 const m=library.find(m=>m.id===markerID)||(l.markerSpec?.id===markerID?l.markerSpec:null);
 if(markerID&&!m)throw Error('Marker 不存在');
 l.markerSpec=m?JSON.parse(JSON.stringify(C.validateMarker(m))):null;
 state.laneSetupConfirmed=false;state.workflowDone=(state.workflowDone||[]).filter(s=>s!=='lanes');invalidateCalibrations({size:true,quantity:false,western:false,allChannels:true});state.markerPairs=(state.markerPairs||[]).filter(p=>p.lane!==id);history('设置泳道 Marker',{lane:id,marker:l.markerSpec});render();
}
on('confirmLanes',()=>{lane();if(val('tool')==='laneAnchors')throw Error('请先完成或取消三框框选');state.laneSetupConfirmed=true;history('确认泳道配置',{lanes:state.lanes.map(l=>({id:l.id,marker:l.markerSpec||null}))});updateLaneSetup();$('tool').value='select';$('canvasHint').textContent='点击泳道或使用右侧列表选择，识别条带或切换到手动添加条带。';$('bandAnalysisStep').closest('.settings-card').scrollTop=0;notify('泳道已确认。下一步可识别或手动框选条带，然后核对 Marker 的条带对应。');});
on('reviewLanes',()=>{updateLaneSetup();$('laneSetupStep').closest('.settings-card').scrollTop=0;});
on('markersToCalibration',()=>{
 ch();const markers=state.lanes.filter(l=>l.markerSpec);if(!markers.length)throw Error('请先在泳道清单中给至少一条泳道选择 Marker');
 const units=new Set(markers.map(l=>l.markerSpec.unit));if(units.size!==1)throw Error('DNA（bp）与蛋白（kDa）Marker 不能放入同一分子量标定，请分别分析');
 const rows=[];
 for(const l of markers){const m=l.markerSpec,bands=[...(state.bands[bandKey(ch(),l)]||[])].sort((a,b)=>a.peakY-b.peakY);
  if(bands.length!==m.values.length)throw Error(`${l.id}（${m.name}）有 ${bands.length} 条带，标准有 ${m.values.length} 条。请先修正条带，或到分子量页手动填写对应。`);
  rows.push(...bands.map((b,i)=>`${l.id},${b.id},${m.values[i]}`));
 }
 $('mwPoints').value=rows.join('\n');$('mwUnit').value=[...units][0];goTab('calibration');history('从泳道 Marker 建立标准对应',{channel:channelID,lanes:markers.map(l=>l.id)});notify('已填入各 Marker 泳道的标准对应。请核对每一条带后点击“计算分子量”。');
});
updateLaneSetup();

$('tool').addEventListener('change',()=>{if(val('tool')==='laneAnchors')chooseLaneAnchor(0);else updateLaneSetup();});

on('manageLaneMarkers',()=>goTab('markers'));

$('bandLane').addEventListener('change',guard(()=>{laneID=val('bandLane');updateSelectors();render();}));
