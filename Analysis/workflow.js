'use strict';
// Experiment routing, explicit standards and image-centred results.
const experiments={
 dna:{name:'核酸电泳',unit:'bp',icon:'lanes',description:'DNA 泳道、条带与片段大小',steps:['viewer','lanes','bands','marker','results']},
 protein:{name:'蛋白电泳',unit:'kDa',icon:'band',description:'蛋白条带、分子量与定量',steps:['viewer','lanes','bands','marker','results']},
 western:{name:'Western blot',unit:'kDa',icon:'western',description:'目标、内参及总蛋白归一化',steps:['viewer','lanes','bands','western','results']},
 colony:{name:'菌落计数',icon:'colony',description:'计数区域、候选与手动修正',steps:['viewer','region','count','results']},
 spots:{name:'Dot / Spot blot',icon:'spots',description:'斑点区域、背景与信号定量',steps:['viewer','regions','measure','results']}
};
const stepNames={viewer:'查看图像',lanes:'设置泳道',bands:'核对条带',marker:'Marker 标定',results:'查看结果',quantity:'定量比较',western:'目标与归一化',region:'设置计数区域',count:'核对菌落',regions:'设置斑点',measure:'核对积分',markers:'Marker 标准库'};
let workflowHome=true,pendingExperiment=null,pendingImport=null,pendingProject=null,homeIntent='import',resourceReturn='viewer',workflowNavigating=false,armedMarker=null,workflowPanelSignature='',workflowResultSignature='',workflowNavSignature='',workflowPreviousStep='',workflowHomeFocus=null;
const main=document.querySelector('main');
main.insertAdjacentHTML('afterbegin',`<section id="workflowHome" aria-label="实验类型选择"><div class="home-inner"><div class="home-kicker">胶个朋友 · 实验工作台</div><h1 id="homeTitle">今天，看看什么？</h1><p id="homeDescription">先选择实验类型，再打开图像。每个实验都有自己的步骤。</p><div class="experiment-cards" id="experimentCards"></div><details id="otherExperiments"><summary>其他实验</summary><div class="experiment-cards secondary-cards" id="secondaryCards"></div></details><div class="home-actions"><button id="homeOpenProject">继续已保存项目</button><button id="homeBatch">批量图像处理</button><button id="homeMarkers">Marker 标准库</button><button id="homeResume" hidden>返回当前实验</button></div><p class="home-footnote">SGD · TIFF · PNG　／　原始像素保留 · 本机处理</p></div></section>`);
for(const [id,spec]of Object.entries(experiments)){
 const button=document.createElement('button');button.className='experiment-card';button.dataset.experiment=id;button.innerHTML=gelIcon(spec.icon)+'<strong>'+spec.name+'</strong><span>'+spec.description+'</span><i>选择实验 <b>↗</b></i>';
 button.addEventListener('click',guard(()=>chooseExperiment(id)));$(id==='colony'||id==='spots'?'secondaryCards':'experimentCards').append(button);
}
$('gelNavigation').insertAdjacentHTML('afterbegin','<div id="projectExperiment"></div><nav id="workflowNav" aria-label="当前实验步骤"></nav><button id="workflowLibrary" class="workflow-resource">'+gelIcon('markers')+'<span>Marker 标准库</span></button><button id="workflowHomeButton" class="workflow-resource">'+gelIcon('back')+'<span>实验首页</span></button>');
$('gelStudio').querySelector('.studio-heading').insertAdjacentHTML('beforeend','<div id="workflowAction"><span id="workflowStepHint"></span><button id="workflowPrevious">上一步</button><button id="workflowNext" class="primary">下一步</button></div>');
$('analysisSettings').insertAdjacentHTML('afterbegin',`<section id="regionGuidePanel" hidden><h2>计数范围</h2><p class="hint">在胶图上拖动框选培养皿内部，排除标签和皿边。确认后再检测菌落。</p><button id="chooseCountingROI" class="full-width">框选计数区域</button><div id="countingROIInfo" class="fit-info"></div></section><section id="assayResultPanel" hidden><h2 id="assayResultTitle">分析结果</h2><div id="assayResultSummary"></div><button id="assayResultEdit" class="full-width">返回修正</button><button id="assayResultTable" class="full-width">展开详细结果</button></section><section id="markerPairPanel" hidden><div class="inspector-heading"><div><h2>核对 Marker</h2><p class="hint">点标准值，再点胶图或曲线上的条带；也可直接从列表选择。</p></div></div><label>标准泳道<select id="pairLane"></select></label><div id="pairMarkerName"></div><div id="markerPairRows"></div><p id="pairSummary" class="fit-info"></p><details class="inspector-disclosure"><summary>标定方式与范围</summary><div id="markerMethodControls"></div></details></section>
<section id="sampleResultPanel" hidden><div class="inspector-heading"><div><h2 id="sampleResultTitle">样本结果</h2><p class="hint">点击胶图、曲线或汇总行查看同一条带。</p></div></div><label>样本泳道<select id="resultLane"></select></label><label>条带<select id="resultBand"></select></label><div id="selectedResultCard"></div><div class="button-row"><button id="resultEditBand">调整这条带</button><button id="resultReviewMarker">检查标定</button></div><button id="resultSummary" class="full-width">展开样本汇总</button><button id="resultQuantity" class="full-width">定量比较 →</button><details id="calibrationQuality" class="inspector-disclosure"><summary>标定质量与来源</summary><div id="calibrationQualityContent"></div><canvas id="markerQualityPlot" width="500" height="220" aria-label="各 Marker 实际标定曲线"></canvas></details></section>
<section id="quantityPanel" hidden><h2>定量比较</h2><p class="hint">大小标准不等于含量标准。先选择要比较的信号。</p><label>参考条带<select id="relativeReference"></select></label><div id="relativeSummary" class="fit-info"></div><div class="section-divider"></div><h2>已知量标定</h2><p class="hint">选择标准条带，填写实际已知数量。</p><div id="quantityEditor"></div><button id="addQuantityStandard">＋ 添加量标准</button><div id="quantityMethodControls"></div><div id="quantityStatus" class="fit-info"></div></section>
<section id="westernPairPanel" hidden><h2>目标与参照</h2><p class="hint">逐样本选择条带，不要求各泳道处在相同高度。多通道图像须预先对齐。</p><div id="westernSharedControls"></div><label><input type="checkbox" id="westernAligned">我已核对目标与参照图像的位置对应</label><div id="westernPairRows"></div><p id="westernPairInfo" class="fit-info"></p></section>`);
// Reuse the validated algorithm controls, with separate size and amount panels.
for(const id of ['mwMethod','mwCombine','mwUnit','extrapolate'])$('markerMethodControls').append($(id).closest('label'));
for(const id of ['quantityMethod','quantityUnit'])$('quantityMethodControls').append($(id).closest('label'));
for(const id of ['targetChannel','referenceChannel','wbMethod','standardLane'])$('westernSharedControls').append($(id).closest('label'));
const rawStandards=document.querySelector('[data-panel="calibration"]');rawStandards.classList.add('legacy-calibration');
const technical=document.createElement('details');technical.id='technicalResultOptions';technical.innerHTML='<summary>数据字段</summary><label><input type="checkbox" id="showTechnicalResults">显示全部技术参数</label>';$('resultsDrawer').querySelector('.title-row').before(technical);
function experiment(){return experiments[state.experimentType]||null;}
function currentStep(){return state.workflowStep||'viewer';}
function completedSteps(){return state.workflowDone||(state.workflowDone=[]);}
function finishStep(step=currentStep()){if(!completedSteps().includes(step))completedSteps().push(step);}
function workflowMotion(el,kind='panel'){
 if(!el||reducedGelMotion()||!el.animate)return;
 const frames=kind==='selection'?[{boxShadow:'0 0 0 0 #1677f04d'},{boxShadow:'0 0 0 7px #1677f000'}]:[{opacity:.25,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}];
 el.animate(frames,{duration:kind==='selection'?320:210,easing:'cubic-bezier(.2,.75,.2,1)'});
}
function openExperimentHome(intent='import'){
 if(!workflowHome){captureGelCamera();workflowHomeFocus=document.activeElement;}
 workflowHome=true;homeIntent=intent;document.body.classList.remove('viewer-focus','analysis-focus','analysis-results-open');
 $('homeTitle').textContent=pendingProject?'为这个旧项目选择实验类型':pendingImport?'这张图，属于哪种实验？':intent==='batch'?'批量处理哪种图像？':'今天，看看什么？';
 $('homeDescription').textContent=pendingImport?'文件已准备好。选择类型后显示图像。':pendingProject?'选择一次，之后项目会记住实验类型。':'先选择实验类型，再打开图像。每个实验都有自己的步骤。';
 $('homeResume').hidden=!state.channels.length&&!pendingImport&&!pendingProject;updateWorkflow();workflowMotion($('workflowHome'));$('experimentCards').querySelector('button').focus({preventScroll:true});
}
function closeExperimentHome(){workflowHome=false;updateWorkflow();restoreGelCamera(gelPage);workflowHomeFocus?.focus?.({preventScroll:true});}
async function chooseExperiment(type){
 if(!experiments[type])throw Error('未知实验类型');
 if(pendingProject){const p=pendingProject;p.state.experimentType=type;pendingProject=null;await receiveTypedProject(p);return;}
 if(pendingImport){const packet=pendingImport;pendingExperiment=type;await receiveTypedChannels(packet);pendingImport=null;return;}
 if(homeIntent==='batch'){native('viewer');return;}
 pendingExperiment=type;native('import');$('homeDescription').textContent='已选择 '+experiments[type].name+'，请选择图像。';
}
const receiveRawChannels=window.receiveChannels;
async function receiveTypedChannels(packet){const type=packet.append?state.experimentType:pendingExperiment;if(!experiments[type]){pendingImport=packet;openExperimentHome();return;}
 await receiveRawChannels(packet);state.experimentType=type;pendingExperiment=null;state.workflowStep='viewer';workflowHome=false;armedMarker=null;workflowPanelSignature='';state.workflowDone=state.workflowDone||[];updateWorkflow();showGelViewer();native('rawLoaded',{append:Boolean(packet.append),name:packet.channels[0]?.source||packet.channels[0]?.name||'未命名实验'});
}
window.receiveChannels=guard(receiveTypedChannels);
const receiveRawProject=window.receiveProject;
async function receiveTypedProject(p){
 if(p?.format!=='GelScopeProject'||p.version!==1||!p.state)throw Error('不是有效的胶图项目');
 if(!p.state.experimentType){pendingProject=p;openExperimentHome();return;}
 if(!experiments[p.state.experimentType])throw Error('项目实验类型不受支持');
 if(p.state.workflowDone&&(!Array.isArray(p.state.workflowDone)||p.state.workflowDone.some(s=>!Object.hasOwn(stepNames,s))))throw Error('项目步骤状态无效');
 if(p.state.markerPairs&&(!Array.isArray(p.state.markerPairs)||p.state.markerPairs.length>2000||p.state.markerPairs.some(p=>!p||typeof p.channel!=='string'||typeof p.lane!=='string'||typeof p.band!=='string'||!Number.isFinite(p.value)||p.value<=0)))throw Error('Marker 对应记录无效');
 if(p.state.amountPairs&&(!Array.isArray(p.state.amountPairs)||p.state.amountPairs.length>2000||p.state.amountPairs.some(p=>!p||typeof p.band!=='string'||typeof p.value!=='string')))throw Error('量标准记录无效');
 const step=p.state.workflowStep||'viewer';if(![...experiments[p.state.experimentType].steps,'quantity','marker'].includes(step))throw Error('项目步骤无效');
 await receiveRawProject(p);workflowHome=false;armedMarker=null;workflowPanelSignature='';selectWorkflowStep(step,{restore:true});native('projectLoaded');
}
window.receiveProject=guard(receiveTypedProject);
// Native menu/import entry points cannot bypass experiment selection.
for(const id of ['import','viewerOpen'])$(id).addEventListener('click',e=>{e.stopImmediatePropagation();pendingImport=null;pendingProject=null;openExperimentHome();},true);
$('showViewer').addEventListener('click',e=>{e.stopImmediatePropagation();openExperimentHome('batch');},true);
on('homeBatch',()=>openExperimentHome('batch'));on('homeOpenProject',()=>native('openProject'));on('homeResume',()=>{pendingImport=null;pendingProject=null;closeExperimentHome();});on('workflowHomeButton',()=>{if(tab!=='markers')openExperimentHome();});
on('homeMarkers',()=>{resourceReturn='home';workflowHome=false;workflowNavigating=true;goTab('markers');workflowNavigating=false;updateWorkflow();});
on('workflowLibrary',()=>{resourceReturn=currentStep();workflowNavigating=true;goTab('markers');workflowNavigating=false;updateWorkflow();});
on('homeResume',()=>{if(!state.channels.length)openExperimentHome();});
const baseGoTab=goTab;
goTab=function(name){if(workflowNavigating){baseGoTab(name);return;}
 if(name==='markers'){resourceReturn=currentStep();workflowNavigating=true;baseGoTab(name);workflowNavigating=false;updateWorkflow();return;}
 const route={gel:state.laneSetupConfirmed?'bands':'lanes',calibration:'marker',western:'western',colony:'count',spots:'regions'};selectWorkflowStep(route[name]||'viewer');
};
function canEnterStep(step){const type=state.experimentType;if(!experiment())return false;if(step==='viewer')return true;if(!state.channels.length)return false;
 if(['lanes','region','regions'].includes(step))return true;if(['bands','marker','western'].includes(step))return state.lanes.length>0&&state.laneSetupConfirmed;
 if(step==='quantity')return state.laneSetupConfirmed&&!['colony','spots'].includes(type)&&allBandRows().length>0;
 if(step==='results')return type==='colony'?Boolean(state.colony):type==='spots'?Boolean(state.spotResults?.length):type==='western'?Boolean(state.wb?.length):state.laneSetupConfirmed&&allBandRows().length>0;
 return ['count','measure'].includes(step);
}
function selectWorkflowStep(step,{restore=false}={}){
 if(!state.channels.length){openExperimentHome();return;}
 if(!restore&&!canEnterStep(step))throw Error(step==='marker'?'请先确认泳道并核对条带':'请先完成前面的设置');
 captureGelCamera();if(step==='results'){profileSelection=null;$('resultBand').value='';}if(step==='results'&&state.lanes.find(l=>l.id===laneID)?.markerSpec)laneID=state.lanes.find(l=>!l.markerSpec)?.id||laneID;workflowHome=false;armedMarker=null;state.workflowStep=step;workflowPanelSignature='';document.body.classList.remove('analysis-results-open');workflowNavigating=true;
 try{if(step==='viewer')showGelViewer();else{
 // Revisiting a step does not modify confirmed data.
 // Confirmation is changed by edits and explicit confirmation, not by navigation.
 const target=step==='marker'||step==='quantity'?'calibration':step==='western'?'western':state.experimentType==='colony'?'colony':state.experimentType==='spots'?'spots':'gel';
 baseGoTab(target);
 }}finally{workflowNavigating=false;}
 if(step==='region'){$('tool').value='roi';analysisPanning=false;}
 if(step==='regions'){$('tool').value='ellipse';analysisPanning=false;}
 if(step==='results'&&state.experimentType==='western')tab='western';
 if(['lanes','marker','quantity','western','region','count','regions','measure','results'].includes(step))document.body.classList.remove('analysis-inspector-hidden');updateWorkflow();restoreGelCamera(gelPage);if(step==='results'&&!['colony','spots'].includes(state.experimentType)){const lid=val('resultLane'),bid=val('resultBand');if(lid&&bid)selectResultBand(lid,bid);}refreshAnalysisSize();workflowMotion(document.querySelector('.studio-heading'));if(!document.body.classList.contains('analysis-inspector-hidden'))workflowMotion($('analysisSettings'));
}
function updateWorkflow(){
 document.body.classList.toggle('workflow-home',workflowHome);$('workflowHome').hidden=!workflowHome;
 const exp=experiment(),step=currentStep(),resource=tab==='markers'&&!workflowHome;
 document.body.classList.toggle('workflow-resource-mode',resource);document.body.dataset.experiment=state.experimentType||'';document.body.dataset.step=resource?'markers':step;
 $('projectExperiment').textContent=exp?.name||'实验工作台';$('projectExperiment').title=exp?.name||'';
 $('workflowLibrary').hidden=Boolean(exp&&['colony','spots'].includes(state.experimentType));$('workflowLibrary').classList.toggle('active',resource);
 const steps=exp?effectiveGelSteps():[],navKey=JSON.stringify([steps,step,completedSteps(),resource,state.channels.length,state.lanes.length,state.laneSetupConfirmed,state.calibrationDirty,state.mwSpec,Boolean(state.colony),state.spotResults?.length,state.wb?.length,allBandRows().length]);
 if(navKey!==workflowNavSignature){workflowNavSignature=navKey;$('workflowNav').replaceChildren();for(const [i,s]of steps.entries()){
 const b=document.createElement('button');b.className='workflow-nav-step';b.dataset.step=s;const done=completedSteps().includes(s),dirty=s==='marker'&&state.calibrationDirty?.size;b.innerHTML='<span class="workflow-step-number">'+(done&&!dirty?'✓':i+1)+'</span><span>'+stepNames[s]+'</span>'+(dirty?'<small>待更新</small>':'');b.disabled=!canEnterStep(s);b.classList.toggle('active',!resource&&s===step);if(!resource&&s===step)b.setAttribute('aria-current','step');b.addEventListener('click',guard(()=>selectWorkflowStep(s)));$('workflowNav').append(b);
 }}
 for(const b of document.querySelectorAll('#tabs button,#sidebarViewer'))b.hidden=true;
 $('workflowHomeButton').hidden=workflowHome;
 if(workflowHome)return;
 $('saveProject').hidden=!state.channels.length;$('report').hidden=!state.channels.length;$('append').hidden=!state.channels.length;
 $('startAnalysis').textContent=exp&&['colony','spots'].includes(state.experimentType)?'开始设置区域':'开始分析';
 $('gelStudio').querySelector('.workflow-steps').hidden=true;
 $('pageTitle').textContent=resource?'Marker 标准库':stepNames[step]||'分析';
 $('workflowAction').hidden=resource;
 const index=steps.indexOf(step);$('workflowPrevious').disabled=step==='viewer';$('workflowPrevious').textContent=step==='quantity'?'返回结果':'上一步';
 const nextLabels={lanes:'确认泳道 →',bands:state.experimentType==='western'?'选择目标与参照 →':state.lanes.some(l=>l.markerSpec)?'核对 Marker →':'查看条带结果 →',marker:'确认标定，查看结果 →',results:'导出结果',quantity:state.quantityMode==='absolute'?(state.calibrationDirty?.quantity?'更新定量结果':'计算已知量'):'应用比较，返回结果 →',western:'计算归一化 →',region:'确认计数区域 →',count:state.colony?'确认计数，查看结果 →':'检测菌落',regions:'确认斑点，核对积分 →',measure:'确认积分，查看结果 →'};
 $('workflowNext').textContent=nextLabels[step]||'下一步';$('workflowNext').disabled=step==='lanes'?!state.lanes.length:step==='bands'?!allBandRows().length:step==='marker'?!state.lanes.some(l=>l.markerSpec):false;
 $('workflowStepHint').textContent=step==='results'?(state.calibrationDirty?.size&&state.mwSpec?'大小标定需要更新':'点击条带查看结果'):step==='marker'?'缺失的标准带可跳过':step==='bands'?'胶图与曲线均可编辑':'';
 const custom=['marker','quantity','western','results','region'].includes(step);
 for(const panel of document.querySelectorAll('#analysisSettings > .panel'))panel.hidden=resource?panel.dataset.panel!=='markers':custom||panel.dataset.panel!==tab;
 $('regionGuidePanel').hidden=resource||step!=='region';$('assayResultPanel').hidden=resource||step!=='results'||!['colony','spots'].includes(state.experimentType);
 if(step==='region')$('countingROIInfo').textContent=state.roi?'区域 '+Math.round(state.roi.w)+' × '+Math.round(state.roi.h)+' px':'请框选区域';
 if(step==='results'&&['colony','spots'].includes(state.experimentType)){const colony=state.experimentType==='colony';$('assayResultTitle').textContent=colony?'菌落计数':'斑点结果';$('assayResultSummary').innerHTML='<div class="result-main-value">'+(colony?(state.colony?.items.length||0):state.spots.length)+'<small> '+(colony?'个菌落':'个斑点')+'</small></div><p class="hint">'+(colony?'计数包含手动修正；可返回图像继续核对。':'各通道净积分分别计算，点击详细结果查看。')+'</p>';}
 for(const [id,s]of [['markerPairPanel','marker'],['sampleResultPanel','results'],['quantityPanel','quantity'],['westernPairPanel','western']])$(id).hidden=resource||step!==s||id==='sampleResultPanel'&&['colony','spots'].includes(state.experimentType);
 if(workflowPreviousStep!==step||resource){if(['lanes','marker','quantity','western','region','count','regions','measure','results'].includes(step))document.body.classList.remove('analysis-inspector-hidden');workflowPreviousStep=step;}
 // No lane curve in colony/spot experiments; no unrelated drawing tools.
 $('profilePanel').hidden=Boolean(exp&&['colony','spots'].includes(state.experimentType))||resource||step==='lanes';
 const allowed=state.experimentType==='colony'?['roi','colonyAdd','colonyDelete']:state.experimentType==='spots'?['roi','select','rect','ellipse','polygon','background']:['roi','select','band','laneAnchors','lane'];
 for(const option of $('tool').options){option.hidden=!allowed.includes(option.value);option.disabled=option.hidden;}
 const readOnly=['marker','results','quantity','western'].includes(step);$('analysisSelect').hidden=readOnly;$('analysisBandEdit').hidden=readOnly||Boolean(exp&&['colony','spots'].includes(state.experimentType));$('laneEditUndo').hidden=readOnly;$('analysisExtraTools').hidden=resource||readOnly;$('analysisLanes').hidden=Boolean(exp&&['colony','spots'].includes(state.experimentType));
 if(resource){$('workflowLibrary').hidden=false;$('workflowHomeButton').innerHTML=gelIcon('back')+'<span>返回'+(resourceReturn==='home'?'首页':'实验')+'</span>';}
 else $('workflowHomeButton').innerHTML=gelIcon('back')+'<span>实验首页</span>';
 if(step==='results')$('canvasHint').textContent='点击条带查看结果 · 拖动移动 · 滚轮缩放 · 修改请点击“调整这条带”';if(step==='marker')$('canvasHint').textContent='先点标准值，再点对应条带完成配对 · Esc 取消配对';
 if(step==='marker'&&!resource){renderMarkerPairs();$('profileSelectionInfo').textContent=armedMarker?'点击对应峰完成配对':'点标准值后，点击对应峰配对';}if(step==='results'&&!resource)renderSampleResults();if(step==='quantity'&&!resource)renderQuantityEditor();if(step==='western'&&!resource)renderWesternPairs();
 if(state.experimentType==='spots'){document.querySelector('[data-panel=spots]').append($('quantityMethodControls'));}else $('quantityPanel').append($('quantityMethodControls'));
 $('analysisInspector').setAttribute('aria-pressed',String(!document.body.classList.contains('analysis-inspector-hidden')));syncGelSegments();
}
$('workflowHomeButton').addEventListener('click',()=>{if(tab==='markers'){if(resourceReturn==='home')openExperimentHome();else selectWorkflowStep(resourceReturn,{restore:true});}});
const oldInterface=window.updateInterface;window.updateInterface=function(){oldInterface();updateWorkflow();};
const oldRender=render;render=function(){oldRender();updateWorkflow();};
// Route existing button and menu handlers through the same step transitions.
$('startAnalysis').addEventListener('click',e=>{e.stopImmediatePropagation();if(!experiment()){openExperimentHome();return;}selectWorkflowStep(state.experimentType==='colony'?'region':state.experimentType==='spots'?'regions':'lanes');},true);
$('backToViewer').addEventListener('click',e=>{e.stopImmediatePropagation();selectWorkflowStep('viewer');},true);
$('sidebarViewer').addEventListener('click',()=>{state.workflowStep='viewer';updateWorkflow();});
$('confirmLanes').addEventListener('click',()=>{if(state.laneSetupConfirmed){finishStep('lanes');selectWorkflowStep('bands');}});
$('reviewLanes').addEventListener('click',()=>selectWorkflowStep('lanes'));
$('markersToCalibration').addEventListener('click',e=>{e.stopImmediatePropagation();selectWorkflowStep('marker');},true);
$('workflowLanes').addEventListener('click',e=>{e.stopImmediatePropagation();selectWorkflowStep('lanes');},true);
$('workflowBands').addEventListener('click',e=>{e.stopImmediatePropagation();selectWorkflowStep('bands');},true);
$('workflowCalibration').addEventListener('click',e=>{e.stopImmediatePropagation();selectWorkflowStep('marker');},true);
on('workflowPrevious',()=>{const step=currentStep(),steps=effectiveGelSteps();if(step==='quantity')selectWorkflowStep('results');else selectWorkflowStep(steps[Math.max(0,steps.indexOf(step)-1)],{restore:true});});
on('workflowNext',()=>{
 const step=currentStep();if(step==='lanes'){$('confirmLanes').click();if(state.laneSetupConfirmed){finishStep('lanes');selectWorkflowStep('bands');}}
 else if(step==='bands'){finishStep();selectWorkflowStep(state.experimentType==='western'?'western':state.lanes.some(l=>l.markerSpec)?'marker':'results');}
 else if(step==='marker'){fitMarkerPairs();finishStep();selectWorkflowStep('results');}
 else if(step==='results')openExportReview();else if(step==='quantity'){if(state.quantityMode==='absolute')fitAmountPairs();else if(!state.relativeReference||!getBand(channelID,...state.relativeReference.split('|'))||getBand(channelID,...state.relativeReference.split('|')).netVolume<=0)throw Error('请选择正净信号的参考条带');finishStep('quantity');selectWorkflowStep('results');}
 else if(step==='western'){calculateWesternPairs();finishStep();selectWorkflowStep('results');}
 else if(step==='region'){finishStep();selectWorkflowStep('count');}
 else if(step==='count'){if(!state.colony){$('countColonies').click();}else{finishStep();selectWorkflowStep('results');}}
 else if(step==='regions'){if(!state.spots.length)throw Error('请先建立斑点区域');measureSpots();finishStep();selectWorkflowStep('measure');}
 else if(step==='measure'){measureSpots();finishStep();selectWorkflowStep('results');}
});
function pairKey(lid){return channelID+'|'+lid;}
function pairsForLane(l){state.markerPairs=state.markerPairs||[];return state.markerPairs.filter(p=>p.channel===channelID&&p.lane===l.id);}
function seedMarkerPairs(){
 if(Array.isArray(state.markerPairs))return;state.markerPairs=[];
 if(state.mwSpec)for(const row of state.mwSpec.rows||[]){const l=state.lanes.find(l=>l.id===row[0]);if(!l?.markerSpec)continue;const value=Number(row[2]);if(l.markerSpec.values.includes(value)&&!state.markerPairs.some(p=>p.channel===state.mwSpec.channel&&p.lane===l.id&&p.value===value))state.markerPairs.push({channel:state.mwSpec.channel,lane:l.id,value,band:row[1]});}
}
function renderMarkerPairs(){
 seedMarkerPairs();const markers=state.lanes.filter(l=>l.markerSpec);selectedOptions($('pairLane'),markers,markers.some(l=>l.id===laneID)?laneID:val('pairLane'));
 const l=markers.find(l=>l.id===laneID);if(!l){$('pairMarkerName').textContent=(state.lanes.find(l=>l.id===laneID)?.name||laneID)+' · 样本泳道';$('markerPairRows').textContent='当前泳道未设置为 Marker。可用上方泳道切换查看其他泳道；需要标定时请选择标为 M 的标准泳道。';$('pairSummary').textContent='样本泳道可直接查看曲线，不参与 Marker 对应。';workflowPanelSignature='';return;}
 const list=[...(state.bands[pairKey(l.id)]||[])].sort((a,b)=>a.peakY-b.peakY),pairs=pairsForLane(l),sig=JSON.stringify([channelID,l.id,l.markerSpec,pairs,list,armedMarker]);
 $('pairMarkerName').textContent=l.markerSpec.name+' · '+l.markerSpec.unit;
 if(sig!==workflowPanelSignature){workflowPanelSignature=sig;const focus=document.activeElement?.getAttribute('aria-label');$('markerPairRows').replaceChildren();
 for(const [i,value]of l.markerSpec.values.entries()){
 const row=document.createElement('div');row.className='marker-pair-row';row.dataset.value=String(value);const p=pairs.find(p=>p.value===value),exists=list.some(b=>b.id===p?.band);row.classList.toggle('paired',exists);row.classList.toggle('armed',armedMarker?.lane===l.id&&armedMarker?.value===value);
 const button=document.createElement('button');button.className='marker-value';button.textContent=value+' '+l.markerSpec.unit;button.setAttribute('aria-pressed',String(row.classList.contains('armed')));button.addEventListener('click',()=>{laneID=l.id;updateSelectors();armedMarker=armedMarker?.lane===l.id&&armedMarker?.value===value?null:{lane:l.id,value};render();if(armedMarker)notify('点击胶图或曲线中对应 '+value+' '+l.markerSpec.unit+' 的条带；Esc 取消');});
 const select=document.createElement('select');select.setAttribute('aria-label',l.id+' 标准 '+value+' 对应条带');
 const choices=[{id:'',name:p?.band&&!exists?'原条带已改变，请重选':'选择实际条带'},{id:'skip',name:'此标准带未出现 / 不使用'},...list.map(b=>({id:b.id,name:b.id+' · '+Math.round(b.peakY)+' px'+(b.saturated?' · 饱和':'' )}))];selectedOptions(select,choices,p?.band||'');
 select.addEventListener('change',guard(()=>{assignMarkerPair(l.id,value,select.value);workflowMotion(row,'selection');}));row.append(button,select);$('markerPairRows').append(row);
 }
 if(focus)Array.from($('markerPairRows').querySelectorAll('[aria-label]')).find(e=>e.getAttribute('aria-label')===focus)?.focus({preventScroll:true});}
 const used=pairs.filter(p=>list.some(b=>b.id===p.band)).length,skipped=pairs.filter(p=>p.band==='skip').length;
 $('pairSummary').textContent=`已配对 ${used} / ${l.markerSpec.values.length} · 已排除 ${skipped}\n未配对项不参与计算；每条参与的 Marker 泳道至少需要两个有效点。`;
 $('mwUnit').value=experiment()?.unit||l.markerSpec.unit;$('mwUnit').disabled=true;
}
function assignMarkerPair(lid,value,bid){
 const l=state.lanes.find(l=>l.id===lid);if(!l?.markerSpec?.values.includes(value))throw Error('标准值不属于当前 Marker');
 if(bid&&bid!=='skip'&&!getBand(channelID,lid,bid))throw Error('条带不存在');
 state.markerPairs=state.markerPairs||[];if(bid&&bid!=='skip'&&state.markerPairs.some(p=>p.channel===channelID&&p.lane===lid&&p.value!==value&&p.band===bid))throw Error('这条带已对应另一标准值，请先解除原配对');
 state.markerPairs=state.markerPairs.filter(p=>!(p.channel===channelID&&p.lane===lid&&p.value===value));if(bid)state.markerPairs.push({channel:channelID,lane:lid,value,band:bid});
 invalidateCalibrations({size:true,quantity:false,western:false});armedMarker=null;laneID=lid;updateSelectors();render();if(bid&&bid!=='skip')selectResultBand(lid,bid);workflowMotion(Array.from($('markerPairRows').children).find(r=>r.dataset.value===String(value)),'selection');history('核对 Marker 对应',{channel:channelID,lane:lid,value,band:bid});
}
$('pairLane').addEventListener('change',()=>{laneID=val('pairLane');armedMarker=null;updateSelectors();render();});
function fitMarkerPairs(){
 const markers=state.lanes.filter(l=>l.markerSpec);if(!markers.length)throw Error('请先给标准泳道指定 Marker');
 if(new Set(markers.map(l=>l.markerSpec.unit)).size!==1||markers[0].markerSpec.unit!==experiment().unit)throw Error('Marker 单位与当前实验类型不一致，请返回泳道设置修正');
 const rows=[];for(const l of markers){const pairs=pairsForLane(l).filter(p=>p.band&&p.band!=='skip'&&l.markerSpec.values.includes(p.value));if(!pairs.length)continue;if(pairs.length<2)throw Error(l.id+' 至少需要两个有效对应点');for(const p of pairs){if(!getBand(channelID,l.id,p.band))throw Error(l.id+' 的已配对条带已改变，请重新对应');rows.push([l.id,p.band,String(p.value)]);}}
 if(!rows.length)throw Error('请配对至少两个标准条带');
 const spec={channel:channelID,rows,method:val('mwMethod'),combine:val('mwCombine'),unit:experiment().unit,extrapolate:checked('extrapolate')};fitMW(spec);state.mwSpec=spec;state.calibrationDirty={...state.calibrationDirty,size:false};$('mwPoints').value=rows.map(r=>r.join(',')).join('\n');applyCalibrations();history('确认 Marker 标定',{spec});render();
}
// A click can pair a standard with a band without moving the image or editing geometry.
for(const canvas of [$('image'),$('profile')]){
 let pairingPointer=null;
 canvas.addEventListener('pointerdown',guard(e=>{if(currentStep()!=='marker'||!armedMarker)return;e.stopImmediatePropagation();pairingPointer={x:e.clientX,y:e.clientY};}),true);
 canvas.addEventListener('pointermove',e=>{if(pairingPointer)e.stopImmediatePropagation();},true);
 canvas.addEventListener('pointerup',guard(e=>{if(!pairingPointer||!armedMarker)return;const start=pairingPointer;pairingPointer=null;e.stopImmediatePropagation();if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)return;
 const l=state.lanes.find(l=>l.id===armedMarker.lane),list=state.bands[pairKey(l.id)]||[];let y;
 if(canvas.id==='profile')y=profileCoordinate(e,l);else{const p=C.framePoint(l.frame,canvasPoint(e)),bounds=C.laneBounds(l,p.y,l.frame?.width||ch().width);if(p.x<bounds[0]||p.x>bounds[1])throw Error('请点击当前 Marker 泳道中的条带');y=p.y;}
 const b=list.find(b=>y>=b.y0&&y<=b.y1);if(!b)throw Error('此处还没有条带，请先返回核对条带并框选');assignMarkerPair(l.id,armedMarker.value,b.id);
 }),true);
 canvas.addEventListener('pointercancel',()=>{pairingPointer=null;});
}
function sizeStatus(b,cid=channelID){if(calibrationFor(cid)?.mwSpec&&calibrationFor(cid)?.calibrationDirty?.size)return '标定需要更新';if(!calibrationFor(cid)?.mwSpec)return '未进行大小标定';if(b.mw===null||!Number.isFinite(b.mw))return '超出标定范围';
 const l=state.lanes.find(l=>l.id===(b.lane||laneID)),models=calibrationFor(cid)?.mwModels||[];if(calibrationFor(cid)?.mwSpec?.extrapolate&&l){const inside=C.multiMW(models,C.laneCenter(l,(l.y0+l.y1)/2),b.rf,calibrationFor(cid).mwSpec.combine,false);if(inside===null)return '外推估计';}return b.saturated?'信号饱和':'已标定';}
function selectResultBand(lid,bid){laneID=lid;updateSelectors();drawProfile();window.profileSelection={key:channelID+'|'+lid,id:bid};drawImage();drawProfile();renderSampleResults();}
function renderSampleResults(){
 if(['colony','spots'].includes(state.experimentType))return;
 const samples=state.lanes;selectedOptions($('resultLane'),samples,laneID);const l=samples.find(l=>l.id===val('resultLane'))||samples[0],list=l?state.bands[pairKey(l.id)]||[]:[];
 selectedOptions($('resultBand'),list,window.profileSelection?.key===pairKey(l?.id)?profileSelection.id:val('resultBand'));
 const b=list.find(b=>b.id===val('resultBand'));$('sampleResultTitle').textContent=l?.markerSpec?'Marker 条带':state.experimentType==='western'?'归一化结果':'样本结果';
 if(!l||!b){$('selectedResultCard').innerHTML='<p class="hint">'+(samples.length?'请选择有条带的样本泳道。':'当前仅有 Marker 泳道。可返回设置泳道，将样本设为非 Marker。')+'</p>';}
 else{const row={...b,lane:l.id},status=sizeStatus(row),wb=state.wb?.find(r=>r.lane===l.id);$('selectedResultCard').innerHTML='<div class="result-card-name">'+esc(l.name||l.id)+' · '+esc(b.id)+'</div><div class="result-main-value">'+(state.experimentType==='western'?wb?fmt(wb.fold,3)+'<small> 倍</small>':'待归一化':Number.isFinite(b.mw)?fmt(b.mw,experiment()?.unit==='bp'?0:1)+'<small> '+esc(b.mwUnit)+'</small>':'—')+'</div><div class="result-state">'+esc(state.experimentType==='western'?(wb?.warning||'相对参考样本'):status)+'</div><dl class="result-metrics"><dt>'+(wb?'目标净积分':'净积分')+'</dt><dd>'+fmt(wb?wb.target:b.netVolume,0)+'</dd>'+(b.quantity!==undefined?'<dt>已知量标定</dt><dd>'+fmt(b.quantity,2)+' '+esc(b.quantityUnit)+'</dd>':'')+(wb?'<dt>目标 / 参照</dt><dd>'+fmt(wb.ratio,4)+'</dd>':'')+'</dl>';
 }
 $('resultEditBand').disabled=!b;$('resultReviewMarker').hidden=state.experimentType==='western'&&!state.lanes.some(l=>l.markerSpec);$('resultQuantity').hidden=state.experimentType==='western';
 renderCalibrationQuality();
}
function renderCalibrationQuality(){
 const models=state.mwModels||[];let html='';if(!state.mwSpec)html='<p class="hint">未进行大小标定。可以查看净积分，或返回泳道为标准指定 Marker。</p>';
 else if(state.calibrationDirty?.size)html='<p class="hint">上游数据已修改。返回 Marker 对应页面核对并更新。</p>';
 else{html='<p class="hint">'+esc({nearest:'采用最近的标准泳道',average:'采用标准结果平均',interpolate:'采用横向插值'}[state.mwSpec.combine])+' · '+(state.mwSpec.method==='piecewise'?'分段插值':'对数线性')+'</p>';
 for(const model of models){const l=state.lanes.find(l=>l.id===model.lane),points=model.model.points;html+='<div class="quality-lane"><b>'+esc(model.lane+' · '+(l?.markerSpec?.name||'标准'))+'</b><p>'+points.length+' 个匹配点 · '+fmt(points.at(-1).value,0)+'–'+fmt(points[0].value,0)+' '+esc(state.mwSpec.unit)+'</p><p>对数回归 R² '+fmt(model.model.regression.r2,4)+'（不等于测量准确度）</p>'+table([['标准值','value'],['模型预测',p=>fmt(C.molecularWeight(model.model,p.rf,true),1)],['相对偏差',p=>fmt((C.molecularWeight(model.model,p.rf,true)/p.value-1)*100,2)+'%']],points)+'</div>';}}
 $('calibrationQualityContent').innerHTML=html;$('markerQualityPlot').hidden=!models.length||Boolean(state.calibrationDirty?.size);if(models.length&&!state.calibrationDirty?.size)plotMarkerModels(models);
}
function plotMarkerModels(models){const canvas=$('markerQualityPlot'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const points=models.flatMap(m=>m.model.points),min=Math.min(...points.map(p=>Math.log10(p.value))),max=Math.max(...points.map(p=>Math.log10(p.value))),x=v=>48+v*(w-70),y=v=>h-34-(v-min)/Math.max(.001,max-min)*(h-65);ctx.strokeStyle='#e3e9f1';ctx.strokeRect(48,20,w-70,h-54);ctx.font='11px -apple-system';ctx.fillStyle='#7d8593';ctx.fillText('log₁₀('+state.mwSpec.unit+')',8,12);ctx.fillText('迁移比例 Rf  0 → 1',w-150,h-8);
 models.forEach((m,k)=>{ctx.strokeStyle=['#1677f0','#ca7a44','#7c61b4','#399679'][k%4];ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();const a=m.model.points[0].rf,b=m.model.points.at(-1).rf;for(let i=0;i<=100;i++){const rf=a+(b-a)*i/100,v=Math.log10(C.molecularWeight(m.model,rf,true));i?ctx.lineTo(x(rf),y(v)):ctx.moveTo(x(rf),y(v));}ctx.stroke();for(const p of m.model.points){ctx.beginPath();ctx.arc(x(p.rf),y(Math.log10(p.value)),3,0,Math.PI*2);ctx.fill();}ctx.fillText(m.lane,55+k*60,31);});}
$('resultLane').addEventListener('change',()=>{laneID=val('resultLane');updateSelectors();drawProfile();const b=(state.bands[pairKey(laneID)]||[])[0];if(b)selectResultBand(laneID,b.id);else renderSampleResults();});
$('resultBand').addEventListener('change',()=>selectResultBand(val('resultLane'),val('resultBand')));
on('resultEditBand',()=>{const lid=val('resultLane'),bid=val('resultBand');selectWorkflowStep('bands');selectResultBand(lid,bid);setGelInteractionMode('band');});
on('resultReviewMarker',()=>selectWorkflowStep('marker'));on('resultQuantity',()=>selectWorkflowStep('quantity'));on('resultSummary',()=>{$('analysisResults').click();});
// Results remain linked to the source without exposing every technical column.
const legacyRenderResults=renderResults;renderResults=function(){
 const summary=['results','quantity'].includes(currentStep())&&!checked('showTechnicalResults');
 if(!summary){legacyRenderResults();return;}
 if(state.experimentType==='colony'||state.experimentType==='spots'||state.experimentType==='western'){
 legacyRenderResults();if(state.experimentType==='western'){$('results').innerHTML=table([['样本',r=>r.laneName||r.lane],['目标净积分',r=>fmt(r.target,0)],['参照净积分',r=>fmt(r.loading,0)],['目标 / 参照',r=>fmt(r.ratio,4)],['相对倍数',r=>fmt(r.fold,3)],['状态',r=>r.warning||'已归一化']],state.wb||[]);}return;
 }
 const rows=allBandRows().filter(r=>!state.lanes.find(l=>l.id===r.lane)?.markerSpec),columns=[['样本',r=>r.laneName||r.lane],['通道','channel'],['条带','id'],['大小',r=>Number.isFinite(r.mw)?fmt(r.mw,experiment()?.unit==='bp'?0:1)+' '+r.mwUnit:'—'],['净积分',r=>fmt(r.netVolume,0)],['状态',r=>sizeStatus(r,r.channelID)]];
 if(state.quantitySpec)columns.push(['数量',r=>fmt(r.quantity,2)+' '+(r.quantityUnit||'')]);
 $('resultsTitle').textContent='样本结果 · '+rows.length+' 条带';$('results').innerHTML=table(columns,rows);
 [...$('results').querySelectorAll('tbody tr')].forEach((tr,i)=>{tr.tabIndex=0;tr.classList.add('linked-result-row');const select=()=>{channelID=rows[i].channelID;selectResultBand(rows[i].lane,rows[i].id);};tr.addEventListener('click',select);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});});
};
$('showTechnicalResults').addEventListener('change',renderResults);
// Selecting an existing band in the results never alters its measured range.
for(const canvas of [$('image'),$('profile')])canvas.addEventListener('pointerdown',guard(e=>{
 if(currentStep()!=='results'||['colony','spots','western'].includes(state.experimentType)||e.altKey||e.button!==0)return;
 if(canvas.id==='profile')return;const p=canvasPoint(e);for(const l of state.lanes.filter(l=>!l.markerSpec)){const q=C.framePoint(l.frame,p),bounds=C.laneBounds(l,q.y,l.frame?.width||ch().width);if(q.x<bounds[0]||q.x>bounds[1])continue;const b=(state.bands[pairKey(l.id)]||[]).find(b=>q.y>=b.y0&&q.y<=b.y1);if(b)selectResultBand(l.id,b.id);}
}),true);
$('profile').addEventListener('pointerup',()=>{if(currentStep()==='results')renderSampleResults();});
function sampleBandChoices(){return allBandRows().map(r=>({id:r.lane+'|'+r.id,name:(r.laneName||r.lane)+' / '+r.id+' · '+r.channel,channel:r.channelID})).filter(r=>r.channel===channelID);}
function renderQuantityEditor(){
 const choices=sampleBandChoices();selectedOptions($('relativeReference'),[{id:'',name:'选择参考条带'},...choices],state.relativeReference||'');const ref=state.relativeReference?.split('|'),b=ref&&getBand(channelID,ref[0],ref[1]);$('relativeSummary').textContent=b&&b.netVolume>0?'参考净积分 '+fmt(b.netVolume,0)+'；样本相对信号 = 样本净积分 / 参考净积分。':'选择正净信号参考后，样本汇总可查看相对比例。';
 state.amountPairs=state.amountPairs||[];const sig=JSON.stringify([choices,state.amountPairs]);if(sig!==workflowPanelSignature){workflowPanelSignature=sig;$('quantityEditor').replaceChildren();for(const [i,p]of state.amountPairs.entries()){
 const row=document.createElement('div');row.className='amount-standard-row';const select=document.createElement('select');select.setAttribute('aria-label','量标准 '+(i+1)+' 条带');selectedOptions(select,[{id:'',name:'选择标准条带'},...choices],p.band);select.addEventListener('change',()=>{p.band=select.value;markQuantityDraft();});const input=document.createElement('input');input.type='number';input.min='0';input.step='any';input.placeholder='已知量';input.value=p.value;input.setAttribute('aria-label','量标准 '+(i+1)+' 已知量');input.addEventListener('change',()=>{p.value=input.value;markQuantityDraft();});const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','删除量标准 '+(i+1));remove.addEventListener('click',()=>{state.amountPairs.splice(i,1);markQuantityDraft();renderQuantityEditor();});row.append(select,input,remove);$('quantityEditor').append(row);
 }}$('quantityStatus').textContent=state.calibrationDirty?.quantity&&state.quantitySpec?'量标准需要更新':$('quantityFitInfo').textContent;
}
on('addQuantityStandard',()=>{state.amountPairs=state.amountPairs||[];state.amountPairs.push({band:'',value:'',channel:channelID});markQuantityDraft();renderQuantityEditor();});
$('relativeReference').addEventListener('change',()=>{state.relativeReference=val('relativeReference');state.relativeReferenceChannel=channelID;renderQuantityEditor();renderResults();});
function fitAmountPairs(){if((state.amountPairs||[]).some(p=>p.channel&&p.channel!==channelID))throw Error('量标准属于其他通道，请在当前通道重新选择');const rows=(state.amountPairs||[]).map(p=>{const fields=p.band.split('|');if(fields.length!==2||!p.value.trim())throw Error('请选择标准条带并填写已知量');return [...fields,String(C.finite(p.value))];});if(!rows.length)throw Error('请添加独立的已知量标准；只做相对比较可直接返回结果');const unique=new Set(rows.map(r=>r[0]+'|'+r[1]));if(unique.size!==rows.length)throw Error('同一条带不能重复作为量标准');const spec={channel:channelID,rows,method:val('quantityMethod'),unit:val('quantityUnit').trim(),extrapolate:false};if(!spec.unit)throw Error('请填写数量单位');fitQuantity(spec);state.quantityDraft=false;state.quantitySpec=spec;state.calibrationDirty={...state.calibrationDirty,quantity:false};$('quantityPoints').value=rows.map(r=>r.join(',')).join('\n');applyCalibrations();history('确认已知量标定',{spec});render();}
function renderWesternPairs(){
 const samples=state.lanes.filter(l=>!l.markerSpec);selectedOptions($('standardLane'),samples,val('standardLane'));state.wbAssignments=state.wbAssignments||{};const total=val('wbMethod')==='total',target=val('targetChannel'),reference=val('referenceChannel');$('westernAligned').closest('label').hidden=target===reference;$('westernAligned').checked=Boolean(state.wbAligned);
 const sig=JSON.stringify([samples.map(l=>[l.id,l.name]),target,reference,total,state.wbAssignments,allBandRows().map(b=>[b.channelID,b.lane,b.id,b.peakY])]);if(sig===workflowPanelSignature)return;workflowPanelSignature=sig;$('westernPairRows').replaceChildren();
 for(const l of samples){const row=document.createElement('div');row.className='western-pair-row';const title=document.createElement('button');title.className='text-button';title.textContent=l.name||l.id;title.addEventListener('click',()=>{laneID=l.id;updateSelectors();drawProfile();drawImage();});row.append(title);const assignment=state.wbAssignments[l.id]||(state.wbAssignments[l.id]={});
 for(const [role,cid]of [['target',target],['reference',reference]]){if(role==='reference'&&total)continue;const label=document.createElement('label');label.textContent=role==='target'?'目标条带':'内参条带';const select=document.createElement('select');select.setAttribute('aria-label',l.id+' '+label.textContent);const bands=state.bands[cid+'|'+l.id]||[];selectedOptions(select,[{id:'',name:'选择条带'},...bands.map(b=>({id:b.id,name:b.id+' · '+Math.round(b.peakY)+' px'}))],assignment[role]||'');select.addEventListener('change',()=>{assignment[role]=select.value;state.wb=[];state.wbDirty=true;});label.append(select);row.append(label);}if(total){const note=document.createElement('p');note.className='hint';note.textContent='参照：整个泳道的总蛋白净信号';row.append(note);}$('westernPairRows').append(row);
 }
 $('westernPairInfo').textContent='设置 '+samples.length+' 个样本；选择参考样本后计算相对倍数。';
}
for(const id of ['targetChannel','referenceChannel','wbMethod','standardLane'])$(id).addEventListener('change',()=>{state.wb=[];state.wbDirty=true;if(id==='targetChannel'||id==='referenceChannel'){state.wbAligned=false;$('westernAligned').checked=false;}workflowPanelSignature='';renderWesternPairs();});
function calculateWesternPairs(){
 compatibleLaneFrames();const target=state.channels.find(c=>c.id===val('targetChannel')),reference=state.channels.find(c=>c.id===val('referenceChannel')),total=val('wbMethod')==='total';if(target!==reference&&!checked('westernAligned'))throw Error('请先核对并确认两个通道的位置对应');
 const rows=state.lanes.filter(l=>!l.markerSpec).map(l=>{const p=state.wbAssignments?.[l.id],tb=p&&getBand(target.id,l.id,p.target),rb=total?{y0:l.y0,y1:l.y1}:p&&getBand(reference.id,l.id,p.reference);if(!tb||!rb)throw Error((l.name||l.id)+' 尚未选择目标或参照条带');const t=C.measureBand(C.profile(target,l,options(target)),tb,l),r=C.measureBand(C.profile(reference,l,options(reference)),rb,l);return {lane:l.id,laneName:l.name,target:t.netVolume,loading:r.netVolume,ratio:r.netVolume>0?t.netVolume/r.netVolume:null,saturated:t.saturated+r.saturated};});
 const standard=val('standardLane'),ref=rows.find(r=>r.lane===standard);if(!ref)throw Error('参考泳道必须是样本，不能是 Marker');if(ref.saturated)throw Error('参考样本存在饱和信号，请重新选择有效范围或样本');
 state.wb=C.normalise(rows,standard).map(r=>r.saturated?{...r,factor:null,normalised:null,fold:null,warning:'目标或参照信号饱和，待核对'}:r);state.wbDirty=false;state.wbSpec={target:target.id,reference:reference.id,method:total?'total':'band',standard,assignments:JSON.parse(JSON.stringify(state.wbAssignments)),aligned:target===reference||checked('westernAligned')};history('逐样本 Western 归一化',{spec:state.wbSpec});render();
}
// A demo is explicitly labelled and remains available without changing source data.
$('demo').addEventListener('click',()=>{state.experimentType=pendingExperiment||'dna';pendingExperiment=null;workflowHome=false;state.workflowStep='viewer';state.workflowDone=[];updateWorkflow();});
// Preserve a project's chosen type for app-menu commands that act on the current image.
const typedViewerCommand=window.viewerCommand;window.viewerCommand=function(command){if(workflowHome&&state.channels.length)closeExperimentHome();typedViewerCommand(command);};
openExperimentHome();
window.experimentsUnit=()=>experiment()?.unit;
window.bandDisplayLabel=function(b,l){if(currentStep()!=='results'||l.markerSpec)return b.id;const selected=profileSelection?.key===bandKey(ch(),l)&&profileSelection?.id===b.id;return selected&&Number.isFinite(b.mw)?'≈ '+fmt(b.mw,experiment()?.unit==='bp'?0:1)+' '+b.mwUnit:b.id;};
// Read-only result selection on the curve; editing has an explicit return action.
$('profile').addEventListener('pointerdown',guard(e=>{if(currentStep()!=='results')return;e.stopImmediatePropagation();const l=lane(),y=profileCoordinate(e,l),b=(state.bands[pairKey(l.id)]||[]).find(b=>y>=b.y0&&y<=b.y1);if(b)selectResultBand(l.id,b.id);}),true);
function workflowRelativeValue(row){if(state.relativeReferenceChannel&&row.channelID!==state.relativeReferenceChannel)return null;const p=state.relativeReference?.split('|'),reference=p&&getBand(row.channelID,p[0],p[1]);return reference?.netVolume>0?row.netVolume/reference.netVolume:null;}
const basicResultRenderer=renderResults;renderResults=function(){basicResultRenderer();if(!['results','quantity'].includes(currentStep())||checked('showTechnicalResults')||!state.relativeReference||['western','colony','spots'].includes(state.experimentType))return;const rows=allBandRows().filter(r=>!state.lanes.find(l=>l.id===r.lane)?.markerSpec),header=$('results').querySelector('thead tr');if(!header)return;const th=document.createElement('th');th.textContent='相对参考信号';header.append(th);[...$('results').querySelectorAll('tbody tr')].forEach((tr,i)=>{const td=document.createElement('td');td.textContent=fmt(workflowRelativeValue(rows[i]),3);tr.append(td);});};
// Each report describes one experiment, including the standards and validity state.
report=function(){
 prepareGelProject();ch();const exp=experiment();if(!exp)throw Error('请先选择实验类型');
 if(state.mwSpec)renderCalibrationQuality();const bands=allBandRows(),samples=bands.filter(r=>!state.lanes.find(l=>l.id===r.lane)?.markerSpec),details={format:'GelFriendAnalysisReport',version:2,application:'胶个朋友 2.4.0',generated:new Date().toISOString(),experiment:state.experimentType,experimentName:exp.name,workflowStep:currentStep(),validity:state.calibrationDirty||{},channelAnalyses:state.analysisByChannel,review:gelExportIssues(),draft:gelExportIssues().length>0,sources:state.channels.map(({data,raw,...c})=>c),lanes:state.lanes,mwStandards:state.mwSpec,markerPairs:state.markerPairs,mwModels:state.mwModels,quantityStandards:state.quantitySpec,relativeReference:state.relativeReference,relativeReferenceChannel:state.relativeReferenceChannel,wbSpec:state.wbSpec,spots:state.spots,colony:state.colony,settings:settings(),results:{bands,western:state.wb||[],spots:state.spotResults||[]},history:state.history};
 let content='',files=[];
 if(state.experimentType==='colony'){const rows=state.colony?.items||[],cols=[['菌落','id'],['X','x'],['Y','y'],['面积 px²','area'],['人工修正',r=>r.manual?'是':'否']];content='<h2>菌落计数：'+rows.length+'</h2>'+table(cols,rows);files.push({name:'菌落.csv',contents:csv(cols,rows)});}
 else if(state.experimentType==='spots'){const rows=state.spotResults||[],cols=[['通道','channel'],['斑点','id'],['净积分','netVolume'],['数量','quantity'],['单位','unit'],['饱和像素','saturated']];content='<h2>斑点结果</h2>'+table(cols,rows);files.push({name:'斑点.csv',contents:csv(cols,rows)});}
 else if(state.experimentType==='western'){const rows=state.wb||[],cols=[['样本',r=>r.laneName||r.lane],['目标净积分','target'],['参照净积分','loading'],['目标/参照','ratio'],['相对倍数','fold'],['状态',r=>r.warning||'已归一化']];content='<h2>归一化结果</h2>'+table(cols,rows);files.push({name:'Western.csv',contents:csv(cols,rows)},{name:'完整条带.csv',contents:csv(bandColumns(),bands)});}
 else{const cols=[['样本',r=>r.laneName||r.lane],['通道','channel'],['条带','id'],['大小','mw'],['单位','mwUnit'],['净积分','netVolume'],['大小状态',r=>sizeStatus(r,r.channelID)],['数量','quantity'],['数量单位','quantityUnit'],['相对信号',workflowRelativeValue]];content='<h2>样本结果</h2>'+table(cols,samples);files.push({name:'样本.csv',contents:csv(cols,samples)},{name:'完整条带.csv',contents:csv(bandColumns(),bands)});}
 const notice='显示调整不改变原始积分。大小与含量使用独立标准；待更新、范围外及饱和结果须按状态核对。独立研究辅助算法，尚未与 GeneTools 做一致性验证。';
 const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>胶个朋友 · '+esc(exp.name)+'</title><style>body{font:13px -apple-system,sans-serif;max-width:1150px;margin:40px auto;padding:0 25px;color:#25334a}h1{font-size:28px}h2{margin-top:30px}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border-bottom:1px solid #e0e6ef;padding:9px;text-align:left}th{background:#f4f7fc}img{max-width:100%;max-height:850px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;background:#f6f8fb;padding:15px}.note{color:#7f8a9a;font-size:11px;line-height:1.7}@media print{tr{break-inside:avoid}body{margin:15px}}</style><h1>'+esc(exp.name)+' · 分析报告'+(details.draft?'（草稿）':'')+'</h1><p class="note">'+esc(details.generated)+'<br>'+notice+'</p><img alt="当前胶图完整标注" src="'+$('image').toDataURL('image/png')+'">'+content+(state.mwSpec?'<h2>Marker 标定核对</h2>'+($('calibrationQualityContent').innerHTML||'<p>详见参数与对应点记录。</p>'):'')+'<h2>数据来源、标准、参数与记录</h2><pre>'+esc(JSON.stringify(details,null,2))+'</pre></html>';
 native('report',{files:[{name:'报告.html',contents:html},...files,{name:'参数与结果.json',contents:JSON.stringify(details,null,2)}]});history('导出当前实验报告',{experiment:state.experimentType});
};

window.workflowPairingActive=()=>currentStep()==='marker'&&Boolean(armedMarker);
window.pickWorkflowResult=function(e){if(currentStep()!=='results'||['colony','spots'].includes(state.experimentType)||e.altKey||e.button!==0)return;const p=interactionRaw(e);for(const l of state.lanes.filter(l=>!l.markerSpec)){const q=C.framePoint(l.frame,p),bounds=C.laneBounds(l,q.y,l.frame?.width||ch().width);if(q.x<bounds[0]||q.x>bounds[1])continue;const b=(state.bands[pairKey(l.id)]||[]).find(b=>q.y>=b.y0&&q.y<=b.y1);if(b)selectResultBand(l.id,b.id);}};
$('report').addEventListener('click',guard(e=>{e.stopImmediatePropagation();openExportReview();}),true);

$('westernAligned').addEventListener('change',()=>{state.wbAligned=checked('westernAligned');});

on('chooseCountingROI',()=>{$('tool').value='roi';analysisPanning=false;drawImage();});
on('assayResultEdit',()=>selectWorkflowStep(state.experimentType==='colony'?'count':'regions'));
on('assayResultTable',()=>{$('analysisResults').click();});
for(const id of ['detectBands','countColonies','measureSpots'])$(id).classList.remove('primary');

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&armedMarker){armedMarker=null;render();}});
