"""Real C++ API tests for call permissions, busy/reject, range, read cursor and search."""
import argparse
import json
import urllib.request
import urllib.error
import uuid
p=argparse.ArgumentParser();p.add_argument('--url',default='http://localhost:8080');args=p.parse_args()
def call(path,token='',body=None,raw=None,expected=200,headers=None):
    req=urllib.request.Request(args.url+'/api'+path,data=json.dumps(body).encode() if body is not None else raw,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json' if body is not None else 'application/octet-stream',**(headers or {})})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:status,data,response_headers=r.status,r.read(),r.headers
    except urllib.error.HTTPError as e:status,data,response_headers=e.code,e.read(),e.headers
    assert status==expected,(path,status,data[:200])
    if 'application/json' in response_headers.get('Content-Type',''):return json.loads(data)
    return data,response_headers
suffix=uuid.uuid4().hex[:8]
a,b,c=[call('/register',body={'username':'feature_'+n+suffix,'password':'test-password-2026'}) for n in 'abc']
call('/friend-requests',a['token'],{'user_id':b['user']['id']})
f=call('/friend-requests',b['token'])[0]
call('/friend-requests',b['token'],{'action':'accept','id':f['id']})
cid=call('/conversations',a['token'],{'user_id':b['user']['id']})['id']
message=call('/messages',a['token'],{'conversation_id':cid,'client_message_id':uuid.uuid4().hex,'content':'关键词杭州预算'})
assert call('/search?conversation_id='+cid+'&q=%E6%9D%AD%E5%B7%9E',b['token'])[0]['id']==message['id']
call('/read',b['token'],{'conversation_id':cid,'seq':message['seq']})
assert call('/conversations',b['token'])[0]['unread']=='0'
data=b'0123456789';f=call('/files?conversation_id='+cid+'&name=sample.mp4',a['token'],raw=data)
part,head=call('/files?id='+f['id'],b['token'],expected=206,headers={'Range':'bytes=2-5'});assert part==b'2345' and head['Content-Range']=='bytes 2-5/10'
part,head=call('/files?id='+f['id'],b['token'],expected=206,headers={'Range':'bytes=-3'});assert part==b'789'
call('/files?id='+f['id'],b['token'],expected=416,headers={'Range':'bytes=100-200'})
assert call('/attachments?conversation_id='+cid,b['token'])[0]['id']==f['id']
offer={'type':'offer','sdp':'test-only-sdp'}
invite=call('/calls',a['token'],{'conversation_id':cid,'kind':'audio','offer':offer},expected=201)
call('/calls?id='+invite['id'],c['token'],expected=404)
call('/calls',b['token'],{'conversation_id':cid,'kind':'audio','offer':offer},expected=409)
call('/calls',a['token'],{'action':'accept','call_id':invite['id'],'answer':{'type':'answer','sdp':'test'}},expected=409)
call('/calls',c['token'],{'action':'candidate','call_id':invite['id'],'candidate':{}},expected=404)
call('/calls',b['token'],{'action':'reject','call_id':invite['id']})
assert call('/calls?id='+invite['id'],a['token'])['status']=='rejected'
events=call('/events?after=0',a['token']);assert events[-1]['event']=='end'
call('/ai',c['token'],{'conversation_id':cid,'mode':'agent','question':'hello'},expected=403)
print('PASS real search, unread cursor, attachments, byte ranges, calls, role checks, busy, rejection, event isolation, Agent authorization')
