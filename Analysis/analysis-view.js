'use strict';
// The editable source canvas keeps its intrinsic pixel geometry. CSS changes
// only its on-screen scale and position, which canvasViewPoint reads back.
let analysisScale=1,analysisPan={x:0,y:0},analysisViewMode='full',analysisPanning=false,analysisPanDrag=null,analysisViewData=null,analysisViewFrame='',analysisWasConfirmed=false,analysisPreviousFrame=null,lastAnalysisPaintScale=0,analysisPaintQueued=false;
function analysisRegion(){
 const f=gelFrame();if(analysisViewMode==='lanes'&&state.lanes.length){const pts=state.lanes.flatMap(l=>C.laneOutline(l).map(p=>C.framePoint(f,C.rawPoint(l.frame,p)))),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;return {x:x-w*.12,y:y-h*.08,w:Math.max(1,w*1.24),h:Math.max(1,h*1.16)};}
 return {x:0,y:0,w:f.width,h:f.height};
}
window.layoutAnalysisImage=function(){
 if(!state.channels.length||$('gelStudio').hidden||tab==='markers')return;
 const c=ch(),f=gelFrame(),stage=$('analysisViewport'),r=stage.getBoundingClientRect();if(r.width<1||r.height<1)return;
 if(analysisViewData!==state.channels[0].data){analysisViewData=state.channels[0].data;analysisViewMode='full';analysisWasConfirmed=Boolean(state.laneSetupConfirmed);}
 analysisWasConfirmed=Boolean(state.laneSetupConfirmed);
 const signature=f.width+'|'+f.height+'|'+f.angle;if(analysisPreviousFrame&&analysisViewFrame!==signature&&analysisViewMode==='manual'){const raw=C.rawPoint(analysisPreviousFrame,{x:analysisPreviousFrame.width/2-analysisPan.x/analysisScale,y:analysisPreviousFrame.height/2-analysisPan.y/analysisScale}),point=C.framePoint(f,raw);analysisPan={x:(f.width/2-point.x)*analysisScale,y:(f.height/2-point.y)*analysisScale};}analysisViewFrame=signature;analysisPreviousFrame=f;
 if(analysisViewMode!=='manual'){const region=analysisRegion();analysisScale=(analysisViewMode==='fill'?Math.max:Math.min)(Math.max(1,r.width-16)/region.w,Math.max(1,r.height-16)/region.h);analysisPan={x:(f.width/2-region.x-region.w/2)*analysisScale,y:(f.height/2-region.y-region.h/2)*analysisScale};}
 const canvas=$('image');canvas.style.width=f.width*analysisScale+'px';canvas.style.height=f.height*analysisScale+'px';canvas.style.left=(r.width-f.width*analysisScale)/2+analysisPan.x+'px';canvas.style.top=(r.height-f.height*analysisScale)/2+analysisPan.y+'px';
 $('analysisZoom').textContent=Math.round(analysisScale*100)+'%';$('analysisFit').setAttribute('aria-pressed',String(analysisViewMode==='full'));$('analysisFill').setAttribute('aria-pressed',String(analysisViewMode==='fill'));$('analysisLanes').setAttribute('aria-pressed',String(analysisViewMode==='lanes'));$('analysisLanes').disabled=!state.lanes.length;if(window.updateCanvasInteraction)window.updateCanvasInteraction();if(Math.abs(lastAnalysisPaintScale-analysisScale)>.00001){lastAnalysisPaintScale=analysisScale;if(!analysisPaintQueued){analysisPaintQueued=true;const paint=()=>{analysisPaintQueued=false;drawImage();};if(window.requestAnimationFrame)window.requestAnimationFrame(paint);else paint();}}
};
function analysisZoomBy(factor,point){ch();if(drag||polygon.length||window.gelInteractionActive?.())return;layoutAnalysisImage();const r=$('analysisViewport').getBoundingClientRect(),old=analysisScale,p=point||{x:r.width/2,y:r.height/2};analysisScale=C.clamp(old*factor,.02,40);const ratio=analysisScale/old;analysisPan={x:p.x-r.width/2-(p.x-r.width/2-analysisPan.x)*ratio,y:p.y-r.height/2-(p.y-r.height/2-analysisPan.y)*ratio};analysisViewMode='manual';layoutAnalysisImage();}
on('analysisFit',()=>{analysisViewMode='full';layoutAnalysisImage();});on('analysisLanes',()=>{analysisViewMode='lanes';layoutAnalysisImage();});on('analysisPlus',()=>analysisZoomBy(1.25));on('analysisMinus',()=>analysisZoomBy(.8));
on('analysisPan',()=>{analysisPanning=!analysisPanning;$('analysisPan').setAttribute('aria-pressed',String(analysisPanning));$('analysisViewport').classList.toggle('panning',analysisPanning);});
window.beginAnalysisPan=function(e){if(!(analysisPanning||e.button===1||e.altKey))return false;e.preventDefault();analysisPanDrag={x:e.clientX,y:e.clientY,pan:{...analysisPan}};$('image').setPointerCapture(e.pointerId);return true;};
window.moveAnalysisPan=function(e){if(!analysisPanDrag)return false;analysisPan={x:analysisPanDrag.pan.x+e.clientX-analysisPanDrag.x,y:analysisPanDrag.pan.y+e.clientY-analysisPanDrag.y};analysisViewMode='manual';layoutAnalysisImage();return true;};
window.endAnalysisPan=function(){const active=Boolean(analysisPanDrag);analysisPanDrag=null;return active;};
$('image').addEventListener('pointercancel',()=>{endAnalysisPan();drag=null;drawImage();});
$('analysisViewport').addEventListener('wheel',guard(e=>{e.preventDefault();const r=$('analysisViewport').getBoundingClientRect();analysisZoomBy(Math.exp(-C.clamp(e.deltaY,-150,150)*.005),{x:e.clientX-r.left,y:e.clientY-r.top});}),{passive:false});
on('analysisInspector',()=>{const hidden=document.body.classList.toggle('analysis-inspector-hidden');$('analysisInspector').setAttribute('aria-pressed',String(!hidden));refreshAnalysisSize();});
on('analysisFocus',()=>{const focus=document.body.classList.toggle('analysis-focus');$('analysisFocus').textContent=focus?'退出专注':'专注';$('analysisFocus').setAttribute('aria-pressed',String(focus));refreshAnalysisSize();});
on('analysisResults',()=>{const open=document.body.classList.toggle('analysis-results-open');$('analysisResults').setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gelPage==='analysis'){document.body.classList.remove('analysis-results-open','analysis-focus');$('analysisFocus').textContent='专注';$('analysisFocus').setAttribute('aria-pressed','false');$('analysisResults').setAttribute('aria-expanded','false');refreshAnalysisSize();}});
function refreshAnalysisSize(){layoutAnalysisImage();drawProfile();}
if(typeof ResizeObserver!=='undefined'){new ResizeObserver(refreshAnalysisSize).observe($('analysisViewport'));new ResizeObserver(()=>drawProfile()).observe($('profile'));}
window.addEventListener('resize',refreshAnalysisSize);
// Confirmation changes the layout without rebuilding the image canvas.
$('confirmLanes').addEventListener('click',()=>{if(state.laneSetupConfirmed)refreshAnalysisSize();});

on('analysisFill',()=>{analysisViewMode='fill';layoutAnalysisImage();});
