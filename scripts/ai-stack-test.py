"""Real C++ + MySQL + FastAPI jobs and indexing with an explicitly fake local LLM.
Never changes the main app's model configuration or calls the real provider.
"""
import concurrent.futures
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
import uuid

root=Path(__file__).resolve().parents[1]
seen=[]
class MockLLM(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.append(body)
        assert self.path=='/v1/chat/completions'
        assert self.headers['Authorization']=='Bearer local-test-key'
        assert body['thinking']=={'type':'disabled'} and body['stream'] is False
        assert 'enable_thinking' not in body
        if body.get('tools') and body['messages'][-1]['role']!='tool':
            message={'role':'assistant','content':None,'tool_calls':[{'id':'local-search','type':'function','function':{'name':'search_conversation','arguments':json.dumps({'query':'杭州预算'})}}]}
        else:
            message={'role':'assistant','content':'杭州旅行预算为每人两千元 [1]。'}
        result=json.dumps({'choices':[{'message':message}]},ensure_ascii=False).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(result)));self.end_headers();self.wfile.write(result)
    def log_message(self,*args):pass

mock=http.server.ThreadingHTTPServer(('127.0.0.1',19000),MockLLM)
threading.Thread(target=mock.serve_forever,daemon=True).start()
env=os.environ.copy()
for line in (root/'.env').read_text(encoding='utf-8-sig').splitlines():
    if '=' in line and not line.startswith('#'):
        name,value=line.split('=',1);env[name]=value
env.pop('PROJECT_ENV_FILE',None)
env.update(DB_HOST='127.0.0.1',DB_PORT='3307',DB_NAME='smart_im',DB_USER='im',DB_PASSWORD=env['MYSQL_PASSWORD'],AI_HOST='127.0.0.1',AI_PORT='18000',SERVER_PORT='18081',BIND_HOST='127.0.0.1',FILE_DIR=str(root/'data/files'),INDEX_DIR=str(root/'data'/('test-index-'+uuid.uuid4().hex[:8])),DEEPSEEK_API_KEY='local-test-key',LLM_API_KEY='local-test-key',LLM_BASE_URL='http://127.0.0.1:19000/v1',PYTHONUTF8='1')
log=(root/'data/logs/ai-stack-test.log').open('w',encoding='utf-8')
processes=[]
def request(path,token='',body=None,raw=None,expected=200):
    req=urllib.request.Request('http://127.0.0.1:18081/api'+path,data=json.dumps(body).encode() if body is not None else raw,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json' if body is not None else 'application/octet-stream'})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:status,result=r.status,json.load(r)
    except urllib.error.HTTPError as error:status,result=error.code,json.load(error)
    assert status==expected,(path,status,result)
    return result
def await_job(id,token):
    for _ in range(100):
        state=request('/jobs?id='+id,token)
        if state['status']=='done':return state['result']
        assert state['status']!='failed',state
        time.sleep(.1)
    raise AssertionError('job timeout')
try:
    processes.append(subprocess.Popen([sys.executable,'-m','uvicorn','app:app','--app-dir','ai','--host','127.0.0.1','--port','18000'],cwd=root,env=env,stdout=log,stderr=log))
    processes.append(subprocess.Popen([str(root/'build/windows/Release/im_server.exe')],cwd=root,env=env,stdout=log,stderr=log))
    for _ in range(60):
        try:request('/health');break
        except Exception:time.sleep(.2)
    time.sleep(1)
    suffix=uuid.uuid4().hex[:8]
    a,b,c=[request('/register',body={'username':'ai_'+n+suffix,'password':'test-password-2026'}) for n in 'abc']
    token=a['token'];request('/friend-requests',token,{'user_id':b['user']['id']})
    friend=request('/friend-requests',b['token'])[0]
    request('/friend-requests',b['token'],{'action':'accept','id':friend['id']})
    cid=request('/conversations',token,{'user_id':b['user']['id']})['id']
    request('/messages',token,{'conversation_id':cid,'client_message_id':uuid.uuid4().hex,'content':'杭州预算每人两千元，周六出发。'})
    file=request('/files?conversation_id='+cid+'&name=guide.txt',token,raw='杭州预算每人两千元，住宿八百元。'.encode())
    task=request('/ai',token,{'conversation_id':cid,'mode':'index'},expected=202);await_job(task['id'],token)
    for mode in ('ask','summary','agent'):
        task=request('/ai',token,{'conversation_id':cid,'mode':mode,'question':'杭州预算'},expected=202)
        result=await_job(task['id'],token)
        assert '两千元' in result['answer']
        if mode in ('ask','agent'):assert result['citations'] and any(x['file_id']==file['id'] for x in result['citations'])
        if mode=='agent':assert result['steps'][0]['tool']=='search_conversation'
        request('/jobs?id='+task['id'],c['token'],expected=404)
    request('/ai',c['token'],{'conversation_id':cid,'mode':'agent','question':'杭州预算'},expected=403)
    assert len(seen)==5,len(seen)
    print('PASS real C++/MySQL/FastAPI: upload -> indexing -> RAG citations -> summary -> Agent tool loop -> persisted jobs/authorization; local MOCK LLM, no real API charge')
finally:
    for process in reversed(processes):
        process.terminate()
        try:process.wait(timeout=8)
        except subprocess.TimeoutExpired:process.kill();process.wait()
    mock.shutdown();mock.server_close();log.close()
