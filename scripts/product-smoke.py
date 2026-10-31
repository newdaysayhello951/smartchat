"""Real upgrade acceptance: friends/groups/recall/password and chunk resume."""
import argparse
import hashlib
import json
import uuid
import httpx

p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:8081');args=p.parse_args()
client=httpx.Client(base_url=args.url,timeout=120)
def api(path,token='',body=None,content=None,expected=200,headers=None):
    r=client.request('POST' if body is not None or content is not None else 'GET','/api'+path,headers={**({'Authorization':'Bearer '+token} if token else {}),**(headers or {})},json=body,content=content)
    assert r.status_code==expected,(path,r.status_code,r.text[:300])
    return r.json() if 'application/json' in r.headers.get('content-type','') else r
suffix=uuid.uuid4().hex[:8]
a,b,c,d=[api('/register',body={'username':f'test_{suffix}_{i}','password':'Product-test-2026'}) for i in range(4)]
ta,tb,tc,td=[x['token'] for x in (a,b,c,d)]
api('/conversations',ta,{'user_id':b['user']['id']},expected=403)
for peer in (b,c):
    api('/friend-requests',ta,{'user_id':peer['user']['id'],'note':'synthetic test'})
    request=api('/friend-requests',peer['token'])[0]
    api('/friend-requests',ta,{'action':'accept','id':request['id']},expected=404)
    api('/friend-requests',peer['token'],{'action':'accept','id':request['id']})
assert len(api('/users',ta))==2
cid=api('/conversations',ta,{'user_id':b['user']['id']})['id']
group=api('/groups',ta,{'title':'合成验收群','user_ids':[b['user']['id'],c['user']['id']]},expected=201)
gid=group['id'];assert group['kind']=='group'
api('/messages?conversation_id='+gid,td,expected=403)
message=api('/messages',tb,{'conversation_id':gid,'client_message_id':uuid.uuid4().hex,'content':'群聊合成预算每人两千元'})
assert api('/messages?conversation_id='+gid,tc)[0]['id']==message['id']
api('/messages/recall',ta,{'id':message['id']},expected=403)
api('/messages/recall',tb,{'id':message['id']})
assert api('/message-events?conversation_id='+gid,tc)[0]['recalled']=='1'
assert api('/messages?conversation_id='+gid,tc)[0]['content']=='[消息已撤回]'
api('/group-members',tb,{'conversation_id':gid,'action':'rename','title':'not owner'},expected=403)
api('/group-members',ta,{'conversation_id':gid,'action':'rename','title':'新群名称'})
api('/group-members',ta,{'conversation_id':gid,'action':'remove','user_id':c['user']['id']})
api('/messages?conversation_id='+gid,tc,expected=403)
api('/group-members',ta,{'conversation_id':gid,'action':'transfer','user_id':b['user']['id']})
api('/group-members',ta,{'conversation_id':gid,'action':'leave'})
print('PASS friends, authorization, group chat, ownership, transfer/leave and recall events',flush=True)
data=b'a'*(4*1024*1024)+b'b'*(4*1024*1024)+b'last-part'
pieces=[data[i:i+4*1024*1024] for i in range(0,len(data),4*1024*1024)]
hashes=[hashlib.sha256(part).hexdigest() for part in pieces]
meta={'conversation_id':cid,'name':'续传验收😀.zip','size':len(data),'chunk_hashes':hashes}
task=api('/uploads/init',ta,meta)
api('/uploads/chunk?id='+task['id']+'&part=0',td,content=pieces[0],expected=404)
api('/uploads/chunk?id='+task['id']+'&part=0',ta,content=b'bad',expected=422)
api('/uploads/chunk?id='+task['id']+'&part=0',ta,content=pieces[0])
resumed=api('/uploads/init',ta,meta);assert resumed['id']==task['id'] and resumed['parts']==[{'part':'0'}]
api('/uploads/complete',ta,{'id':task['id']},expected=409)
for i in range(1,len(pieces)):api('/uploads/chunk?id='+task['id']+'&part='+str(i),ta,content=pieces[i])
result=api('/uploads/complete',ta,{'id':task['id']})
assert api('/uploads/complete',ta,{'id':task['id']})['id']==result['id']
file=api('/files?id='+result['id'],tb);assert file.content==data
part=api('/files?id='+result['id'],tb,expected=206,headers={'Range':'bytes=4194300-4194310'});assert part.content==data[4194300:4194311]
assert api('/file-info?id='+result['id'],tb)['manifest']==hashlib.sha256(b''.join(bytes.fromhex(h) for h in hashes)).hexdigest()
print('PASS chunk integrity, interruption/resume, idempotent completion, streamed download and ranges',flush=True)
api('/password',ta,{'old_password':'wrong','new_password':'New-product-2026'},expected=403)
new=api('/password',ta,{'old_password':'Product-test-2026','new_password':'New-product-2026'})
api('/conversations',ta,expected=401)
api('/conversations',new['token'])
api('/login',body={'username':a['user']['username'],'password':'Product-test-2026'},expected=401)
api('/login',body={'username':a['user']['username'],'password':'New-product-2026'})
print('PASS password change, old-session revocation, new-session continuity and new-password login',flush=True)
