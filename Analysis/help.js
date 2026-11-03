'use strict';
// A concise visual guide over the current workspace, with no document navigation.
document.body.insertAdjacentHTML('beforeend',`<dialog id="gelHelp" role="dialog" aria-modal="true" aria-labelledby="gelHelpTitle">
 <header class="guide-header"><div><span class="guide-eyebrow">胶个朋友 · 使用与方法</span><h1 id="gelHelpTitle">先看清，再分析。</h1></div><button id="closeGelHelp" class="icon-button" aria-label="关闭使用与方法">${gelIcon('close')}</button></header>
 <div class="guide-body">
  <section class="guide-intro"><img src="AboutGel.png" alt="透明胶块与观察条带的手绘小人"><div><p>从一张胶，到一份清楚的记录。</p><span>先选实验类型，再打开 SGD、TIFF 或 PNG。<br>只想看胶？停留在查看页就好。</span></div></section>
  <ol class="guide-flow" aria-label="胶图分析流程"><li><b>1</b>查看胶图</li><li><b>2</b>设置泳道</li><li><b>3</b>核对条带</li><li><b>4</b>Marker<small>可选</small></li><li><b>5</b>查看结果</li></ol>
  <div class="guide-cards">
   <section class="guide-card"><svg viewBox="0 0 300 76" role="img" aria-label="框选第一、第二及最后一条泳道，中间泳道按等距生成"><g fill="#edf4ff" stroke="#4189e4" stroke-width="1.5"><rect x="35" y="9" width="27" height="55" rx="5"/><rect x="86" y="9" width="27" height="55" rx="5"/><rect x="239" y="9" width="27" height="55" rx="5"/></g><g fill="none" stroke="#a9bdd7" stroke-dasharray="3 4"><rect x="137" y="9" width="27" height="55" rx="5"/><rect x="188" y="9" width="27" height="55" rx="5"/></g><g stroke="#7d91ab" stroke-width="4" stroke-linecap="round"><path d="M43 28h11M94 42h11M247 31h11"/></g></svg><h2>框好泳道</h2><p>框第一、第二和最后一条，核对总数后生成。拖框微调，删除空泳道，每条都可设为 Marker。</p></section>
   <section class="guide-card"><svg viewBox="0 0 300 76" role="img" aria-label="在积分曲线框住峰，可拖动整体或两侧边界"><path d="M32 62H274" stroke="#d8e1ee" fill="none"/><rect x="127" y="9" width="49" height="53" rx="5" fill="#e8f1ff"/><path d="M32 59c40 0 67 2 85-7s19-35 32-35 15 33 35 37 55 3 90 5" stroke="#4189e4" stroke-width="2.3" fill="none"/><g stroke="#75a8ed" stroke-width="1.5"><path d="M127 10v51M176 10v51"/></g><g fill="white" stroke="#4189e4" stroke-width="1.5"><circle cx="127" cy="36" r="4"/><circle cx="176" cy="36" r="4"/></g></svg><h2>核对每一道峰</h2><p>自动识别先给候选。在底部曲线拖选新增，拖整体或边界修改，选中后删除；完成后点“本泳道已核对”。</p></section>
  </div>
  <div class="guide-notes"><p><b>看得顺手</b><span>滚轮缩放，移动工具拖动胶图；旋转、反相跨页沿用。“专注查看”扩大画面，泳道随时切换。</span></p><p><b>标准与结果</b><span>Marker 先点标准值，再点实际条带；缺带可跳过。无 Marker 也能查看积分，相对比较和已知量标定分别选择。</span></p><p><b>保存与导出</b><span>⌘S 保存，⇧⌘S 另存为；⌘Z 撤销，⇧⌘Z 重做。导出前核对状态；批量入口用于图像处理与导出。</span></p></div>
  <details class="guide-other"><summary>其他实验</summary><p>Western blot：选择目标与参照条带，再归一化。菌落和斑点：设置区域、核对候选或积分，最后查看结果。</p></details>
 </div>
 <footer class="guide-footer"><span>显示调整不改变原始像素与积分。</span><button id="continueGelHelp" class="primary">回到胶图 →</button></footer>
</dialog>`);
let helpPreviousFocus=null;
window.showGelHelp=function(){const dialog=$('gelHelp');if(dialog.open)return;helpPreviousFocus=document.activeElement;if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');dialog.querySelector('.guide-body').scrollTop=0;$('continueGelHelp').focus({preventScroll:true});};
function closeGelHelp(){const dialog=$('gelHelp');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');helpPreviousFocus?.focus?.({preventScroll:true});}
on('closeGelHelp',closeGelHelp);on('continueGelHelp',closeGelHelp);
$('gelHelp').addEventListener('cancel',e=>{e.preventDefault();closeGelHelp();});
$('gelHelp').addEventListener('click',e=>{if(e.target!==$('gelHelp'))return;const r=$('gelHelp').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeGelHelp();});
document.addEventListener('keydown',e=>{if(!$('gelHelp').open)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeGelHelp();}else if(e.key==='Tab'){const controls=[...$('gelHelp').querySelectorAll('button,summary')],first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},true);
