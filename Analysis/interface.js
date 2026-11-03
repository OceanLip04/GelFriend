'use strict';
const pageDescriptions={gel:'框选参考泳道，检查空泳道，再设置 Marker。',calibration:'核对标准条带，再进行标定。',western:'选择目标和内参。',colony:'检查培养皿中的菌落。',spots:'建立斑点区域并核对积分。',markers:'管理个人 Marker 标准。'};
window.updateInterface=function(){
 const gel=activeModule==='gel',view=gel&&gelPage==='viewer';document.body.classList.toggle('marker-library-mode',gel&&!view&&tab==='markers');
 $('gelNavigation').hidden=!gel;
 $('sidebarViewer').classList.toggle('active',view);if(view)$('sidebarViewer').setAttribute('aria-current','page');else $('sidebarViewer').removeAttribute('aria-current');
 for(const button of document.querySelectorAll('[data-module]'))button.setAttribute('aria-pressed',String(button.dataset.module===activeModule));
 for(const button of document.querySelectorAll('[data-tab]')){button.classList.toggle('active',gel&&!view&&button.dataset.tab===tab);if(gel&&!view&&button.dataset.tab===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 const confirmed=Boolean(state.laneSetupConfirmed),phase=tab==='gel'?(confirmed?'bands':'lanes'):'calibration';
 for(const [id,name]of [['workflowLanes','lanes'],['workflowBands','bands'],['workflowCalibration','calibration']]){const button=$(id),current=name===phase;button.classList.toggle('current',current);button.classList.toggle('complete',name==='lanes'&&confirmed||name==='bands'&&phase==='calibration'&&confirmed);if(current)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
 $('workflowBands').disabled=!confirmed;$('workflowCalibration').disabled=!confirmed;
 $('gelStudio').querySelector('.workflow-steps').hidden=!['gel','calibration'].includes(tab);
 if(tab==='gel')$('pageTitle').textContent=confirmed?'条带分析':'泳道设置';
 $('analysisSubtitle').textContent=tab==='gel'&&confirmed?'识别并核对条带，选择背景，再进入标定。':pageDescriptions[tab]||'';
};
document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.toolbar-menu[open]'))if(!menu.contains(e.target)||e.target.closest('button'))menu.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('.toolbar-menu[open]'))menu.open=false;});
$('viewerAdjust').setAttribute('aria-expanded',String(!$('viewerAdjustments').hidden));
updateInterface();

on('analysisLeft',()=>setGelRotation(gelRotation()-90));on('analysisRight',()=>setGelRotation(gelRotation()+90));on('analysisResetAngle',()=>setGelRotation(0));$('analysisAngle').addEventListener('change',guard(()=>setGelRotation(num('analysisAngle'))));

on('sidebarViewer',()=>showGelViewer());
on('workflowLanes',()=>{goTab('gel');$('reviewLanes').click();});
on('workflowBands',()=>{if(state.laneSetupConfirmed)goTab('gel');});
on('workflowCalibration',()=>{if(state.laneSetupConfirmed)goTab('calibration');});
