#!/usr/bin/env python3
"""Opt-in integration against an isolated, enabled QA application; uses synthetic fixtures only."""
import argparse, base64, hashlib, json, os, socket, stat, struct, subprocess, sys, tempfile, zlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',required=True);p.add_argument('--socket',default=f'/tmp/gelfriend-{os.getuid()}/agent.sock');p.add_argument('--fixture',default='/tmp/gel240-input.gelproject');a=p.parse_args();checks=0

def check(value,label):
 global checks
 assert value,label
 checks+=1;print('PASS '+label,flush=True)
def rpc(method,params=None,expect_error=None):
 out=subprocess.run([a.cli,'--socket',a.socket,'call',method,json.dumps(params or {},ensure_ascii=False)],capture_output=True,text=True,timeout=100)
 r=json.loads(out.stdout)
 if expect_error:
  assert 'error' in r,(method,r)
  code=r['error'].get('data',{}).get('code',r['error'].get('code'))
  assert code==expect_error,(method,code,r)
  return r
 assert 'result' in r,(method,r,out.stderr)
 return r['result']
def state():return rpc('workspace.state')
def write(method,params=None,expect_error=None):
 s=state();return rpc(method,{'expectedDocumentId':s['documentId'],'expectedRevision':s['revision'],**(params or {})},expect_error)

def mcp(older=False):
 version='2024-11-05' if older else '2025-06-18'
 msgs=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':version,'capabilities':{},'clientInfo':{'name':'GelFriend integration','version':'1'}}},{'jsonrpc':'2.0','method':'notifications/initialized'},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'gelfriend_workspace_state','arguments':{}}},{'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'gelfriend_view_set','arguments':{'angle':8}}}]
 msgs.append({'jsonrpc':'2.0','id':5,'method':'tools/call','params':{'name':'gelfriend_document_preview','arguments':{'annotated':False}}})
 r=subprocess.run([a.cli,'--socket',a.socket,'--stdio'],input='\n'.join(json.dumps(m) for m in msgs)+'\n',capture_output=True,text=True,timeout=100)
 lines=[json.loads(line) for line in r.stdout.splitlines()];assert len(lines)==5,lines
 check(lines[0]['result']['protocolVersion']==version,'MCP 协议协商 '+version)
 check(len(lines[1]['result']['tools'])>=25,'MCP tools/list 返回接口清单')
 check(lines[2]['result']['isError'] is False,'MCP tools/call 实际读取当前工作区')
 check(lines[3]['result']['isError'] is True,'MCP 写入错误返回 isError，不伪装成功')
 image=next(c for c in lines[4]['result']['content'] if c['type']=='image');check(base64.b64decode(image['data']).startswith(b'\x89PNG\r\n\x1a\n'),'MCP 返回可读取的胶图图片内容')
 if not older:check('data' not in lines[4]['result']['structuredContent'],'MCP 预览元数据不重复携带图片 base64')
 if older:check('structuredContent' not in lines[2]['result'],'旧 MCP 协议使用兼容文本结果')
 else:check('documentId' in lines[2]['result']['structuredContent'],'MCP 结构化结果包含当前文档 token')

with tempfile.TemporaryDirectory(prefix='gelfriend-agent-test-') as temp:
 root=Path(temp);s=state();check(s['agentEnabled'] is True,'原生接口开启并响应')
 check(stat.S_IMODE(os.stat(a.socket).st_mode)==0o600,'Unix socket 权限为 0600')
 check(stat.S_IMODE(os.stat(Path(a.socket).parent).st_mode)==0o700,'接口目录权限为 0700')
 rpc('eval',{'code':'anything'},'METHOD_NOT_FOUND');check(True,'任意执行方法被拒绝')
 rpc('view.set',{'angle':1},'INVALID_PARAMS');check(True,'写入缺少上下文被拒绝')
 original=hashlib.sha256(Path(a.fixture).read_bytes()).hexdigest()
 opened=write('document.open',{'path':str(Path(a.fixture).resolve()),'discardChanges':True});check(len(opened['channels'])==2,'原生解析和 Web 工作区导入项目')
 preview=rpc('document.preview',{'annotated':False});check(base64.b64decode(preview['data']).startswith(b'\x89PNG\r\n\x1a\n') and max(preview['width'],preview['height'])<=1600 and preview['transform']['rawWidth']==240,'预览返回 PNG、受控尺寸和原始坐标转换')
 token=state();write('view.set',{'angle':5,'display':{'gamma':1.3,'inverted':True}})
 rpc('view.set',{'angle':2,'expectedDocumentId':token['documentId'],'expectedRevision':token['revision']},'STALE_CONTEXT');check(True,'修改后旧修订不再允许写入')
 write('document.open',{'path':str(Path(a.fixture).resolve())},'UNSAVED_CHANGES');check(True,'未保存项目不会被静默替换')
 output=root/'saved.gelproject';write('document.save',{'path':str(output)});check(output.is_file() and state()['unsaved'] is False,'Agent 保存完成并收到版本回执')
 digest=hashlib.sha256(output.read_bytes()).hexdigest();write('document.save',{'path':str(output)},'IO_ERROR');check(hashlib.sha256(output.read_bytes()).hexdigest()==digest,'默认不覆盖既有导出文件')
 write('document.exportImage',{'path':str(root/'gel.png'),'annotated':False});check((root/'gel.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n'),'导出可读取的 PNG')
 report=write('document.exportReport',{'directory':str(root)});html=Path(report['directory'],'报告.html').read_text();check('（草稿）' in html,'未核对的报告明确标为草稿')
 created=write('lanes.create',{'replaceExisting':True,'lanes':[{'xTop':x,'xBottom':x,'y0':20,'y1':245,'width':20,'name':'Sample '+str(i+1)} for i,x in enumerate([40,95,150,205])]});ids=created['laneIds'];check(len(ids)==4 and 'L1' not in ids,'创建新泳道不复用退役身份')
 write('lanes.confirm');write('bands.detect',{'scope':'lanes'});rows=rpc('results.read',{'limit':1000})['bands'];check(len(rows)==16 and not any(b['humanReviewed'] for b in rows),'原生全通路检测候选与人工核对状态分开')
 profile=rpc('profile.read',{'laneId':ids[0]});check(len(profile['raw'])==225 and all(abs(x-y-z)<1e-8 for x,y,z in zip(profile['raw'],profile['background'],profile['net'])),'积分曲线原始值/背景/净值一致')
 marker=write('markers.create',{'name':'Agent integration explicit standard','unit':'bp','values':[1000,750,500,250],'source':'Synthetic integration fixture only'})['marker'];write('lanes.setMarker',{'laneId':ids[0],'markerId':marker['id']});write('lanes.confirm');write('workflow.go',{'step':'marker'})
 b0=[b for b in rows if b['lane']==ids[0]]
 for value,band in zip(marker['values'],b0):write('markers.pair',{'laneId':ids[0],'value':value,'bandId':band['id']})
 write('calibration.fitSize',{'method':'piecewise'});check(any(b.get('mw') for b in rpc('results.read',{})['bands']),'显式 Marker 对应后完成大小标定')
 sample=[b for b in rows if b['lane']==ids[1]];write('calibration.fitQuantity',{'standards':[{'laneId':ids[1],'bandId':sample[0]['id'],'value':5},{'laneId':ids[1],'bandId':sample[2]['id'],'value':10}],'unit':'ng'});check(any(b.get('quantityUnit')=='ng' for b in rpc('results.read',{})['bands']),'独立已知量标准完成定量')
 write('workflow.go',{'step':'bands'});before=rpc('results.read',{})['bands'];rev=state()['revision'];write('bands.upsert',{'laneId':ids[1],'bandId':sample[0]['id'],'y0':105,'y1':115},'VALIDATION_ERROR');check(rpc('results.read',{})['bands']==before and state()['revision']==rev,'失败编辑保留全部条带和修订')
 write('bands.upsert',{'laneId':ids[1],'bandId':sample[0]['id'],'y0':45,'y1':55});write('bands.detect',{},'MANUAL_BANDS');check(True,'重新识别不静默覆盖手工条带')
 write('history.undo');write('history.redo');check(state()['undoAvailable'],'API 编辑可撤销及重做')
 invalid=root/'bad.gelproject';invalid.write_text('{}');identity=state()['documentId'];write('document.open',{'path':str(invalid),'discardChanges':True},'INVALID_PROJECT');check(state()['documentId']==identity,'无效项目导入失败保留当前文档')
 write('document.save',{'path':str(root/'final.gelproject')});reopened=write('document.open',{'path':str(root/'final.gelproject')});check(len(reopened['lanes'])==4,'Agent 保存项目可重新打开')
 source=root/'synthetic-reference.sgd';subprocess.run([sys.executable,str(Path(__file__).with_name('make_public_fixture.py')),str(source)],check=True);expected=json.loads(subprocess.check_output([str(Path(a.cli).with_name('SGDViewer')),'--inspect',str(source)]));write('document.open',{'path':str(source),'experiment':'dna','discardChanges':True});check(state()['channels'][0]['width']==expected['width'] and state()['channels'][0]['height']==expected['height'],'SGD 容器导入与既有解析结果一致')
 opaque=root/'source.png'
 def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
 opaque.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',3,2,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\0\x80\xff'*2))+chunk(b'IEND',b''))
 write('document.open',{'path':str(opaque),'experiment':'dna','discardChanges':True});write('document.exportImage',{'path':str(opaque),'overwrite':True},'SOURCE_PROTECTED');check(True,'原始输入 PNG 即使 overwrite 也受保护')
 check(hashlib.sha256(Path(a.fixture).read_bytes()).hexdigest()==original,'输入项目未被任何导出覆盖')
 mcp();mcp(True)
 # Clean QA state and leave a saved project so the test application can close normally.
 write('document.save',{'path':str(root/'clean.gelproject')})
print(str(checks)+' native agent checks passed')
