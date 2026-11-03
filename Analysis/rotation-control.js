'use strict';
let rotationGesture=null;
window.syncRotationDials=function(){const angle=gelRotation();for(const prefix of ['viewer','analysis']){const dial=$(prefix+'RotationDial');dial.style.setProperty('--rotation',angle+'deg');dial.setAttribute('aria-valuenow',String(angle));dial.setAttribute('aria-valuetext',Math.abs(angle)<.05?'原始方向':angle>0?'顺时针旋转':'逆时针旋转');}};
function dialPointerAngle(dial,e){const r=dial.getBoundingClientRect();return Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2)*180/Math.PI;}
function previewRotation(angle){state.viewAngle=C.normalizeAngle(angle);syncGelRotation();drawImage();if(viewerFitMode)viewerFit();else drawViewer();}
for(const prefix of ['viewer','analysis']){
 const dial=$(prefix+'RotationDial');
 dial.addEventListener('pointerdown',guard(e=>{ch();if(e.button!==0||drag||polygon.length||gelInteractionActive())return;e.preventDefault();rotationGesture={dial,initial:gelRotation(),start:dialPointerAngle(dial,e)};dial.setPointerCapture?.(e.pointerId);dial.focus({preventScroll:true});}));
 dial.addEventListener('pointermove',guard(e=>{if(rotationGesture?.dial!==dial)return;const g=rotationGesture,delta=C.normalizeAngle(dialPointerAngle(dial,e)-g.start);previewRotation(Math.round((g.initial+delta)*10)/10);}));
 dial.addEventListener('pointerup',guard(e=>{if(rotationGesture?.dial!==dial)return;const g=rotationGesture;rotationGesture=null;const value=gelRotation();state.viewAngle=g.initial;setGelRotation(value);}));
 const cancel=()=>{if(rotationGesture?.dial!==dial)return;const g=rotationGesture;rotationGesture=null;previewRotation(g.initial);};
 dial.addEventListener('pointercancel',cancel);dial.addEventListener('lostpointercapture',cancel);
 dial.addEventListener('keydown',guard(e=>{if(e.key==='Escape'){cancel();return;}const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:1,ArrowDown:-1}[e.key];if(delta){e.preventDefault();setGelRotation(gelRotation()+delta*(e.shiftKey?5:.2));}else if(e.key==='Home'){e.preventDefault();setGelRotation(0);}}));
}
syncRotationDials();
document.addEventListener('click',e=>{for(const details of document.querySelectorAll('.rotation-precision[open]'))if(!details.contains(e.target))details.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const details of document.querySelectorAll('.rotation-precision[open]'))details.open=false;});
