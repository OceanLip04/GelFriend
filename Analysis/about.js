'use strict';
// About is a local, dismissible layer. The document and its camera stay in place.
document.body.insertAdjacentHTML('beforeend',`<dialog id="gelAbout" aria-labelledby="gelAboutTitle"><button id="closeGelAbout" class="icon-button about-close" aria-label="关闭关于">${gelIcon('close')}</button><div class="about-art"><img src="AboutGel.png" alt="透明胶块上，一位手绘小人攀着文字搭成的梯子，另一位在测量条带"><span class="about-art-caption">让每一道微光，都被看见。</span></div><div class="about-story"><div class="about-eyebrow">给认真做实验的你</div><h1 id="gelAboutTitle">胶个朋友<span id="gelAboutVersion">2.4.0</span></h1><p class="about-poem">一张胶，几条带。<br>那些微小的发现，<br>值得被清楚地看见。</p><p class="about-description">从观察到标定，从条带到记录。<br>把繁杂的操作放轻一点，<br>把注意力留给实验本身。</p><div class="about-details"><span>大图查看</span><i></i><span>条带分析</span><i></i><span>Marker 标定</span></div><p class="about-local">数据留在本机，原始像素始终保留。</p><div class="about-actions"><button id="gelAboutMethods" class="text-button">使用与方法</button><button id="continueGelAbout" class="primary">继续探索 →</button></div></div></dialog>`);
let aboutPreviousFocus=null;
window.showGelAbout=function(packet={}){
 if(typeof packet.version==='string'&&packet.version.length<30)$('gelAboutVersion').textContent=packet.version;
 const dialog=$('gelAbout');if(dialog.open)return;
 aboutPreviousFocus=document.activeElement;document.body.classList.add('gel-about-open');
 if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 $('continueGelAbout').focus({preventScroll:true});
};
function closeGelAbout(){const dialog=$('gelAbout');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');document.body.classList.remove('gel-about-open');aboutPreviousFocus?.focus?.({preventScroll:true});}
on('closeGelAbout',closeGelAbout);on('continueGelAbout',closeGelAbout);on('gelAboutMethods',()=>{closeGelAbout();native('help');});
$('gelAbout').addEventListener('cancel',e=>{e.preventDefault();closeGelAbout();});
$('gelAbout').addEventListener('click',e=>{if(e.target!==$('gelAbout'))return;const r=$('gelAbout').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeGelAbout();});
document.addEventListener('keydown',e=>{if(!$('gelAbout').open)return;
 if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeGelAbout();}
 if(e.key==='Tab'){const controls=[...$('gelAbout').querySelectorAll('button:not(:disabled)')],first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
},true);
