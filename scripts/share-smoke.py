"""Verify the real public HTTPS URL, access gate, APIs and WSS forwarding."""
import asyncio
import json
from pathlib import Path
import uuid
import httpx
import websockets

root=Path(__file__).resolve().parents[1]
url=(root/'data/share-url.txt').read_text(encoding='utf-8').strip()
password=json.loads((root/'data/share-access.json').read_text(encoding='utf-8-sig'))['password']
with httpx.Client(timeout=30,follow_redirects=False) as client:
    first=client.get(url)
    assert first.status_code==200 and '分享访问' in first.text,(first.status_code,first.text[:100])
    assert client.get(url+'/api/health').status_code==401
    denied=client.post(url+'/_share/access',data={'password':'incorrect'},headers={'Origin':url})
    assert denied.status_code==403
    login=client.post(url+'/_share/access',data={'password':password},headers={'Origin':url})
    assert login.status_code==303,login.text[:100]
    assert 'HttpOnly' in login.headers['set-cookie'] and 'Secure' in login.headers['set-cookie']
    assert client.get(url+'/api/health').json()['status']=='ok'
    home=client.get(url+'/')
    assert '青聊' in home.text and '/@vite/client' not in home.text
    assert "media-src 'self' blob:" in home.headers['content-security-policy']
    assert client.get(url+'/.env').status_code==404
    cookie='; '.join(f'{k}={v}' for k,v in client.cookies.items())
    suffix=uuid.uuid4().hex[:8]
    accounts=[]
    for name in ('a','b'):
        result=client.post(url+'/api/register',json={'username':'ws_'+name+'_'+suffix,'password':'Public-test-password-2026'})
        assert result.status_code==200,result.text
        accounts.append(result.json())
    a,b=accounts
    client.post(url+'/api/friend-requests',headers={'Authorization':'Bearer '+a['token']},json={'user_id':b['user']['id']}).raise_for_status()
    friend=client.get(url+'/api/friend-requests',headers={'Authorization':'Bearer '+b['token']}).json()[0]
    client.post(url+'/api/friend-requests',headers={'Authorization':'Bearer '+b['token']},json={'action':'accept','id':friend['id']}).raise_for_status()
    conversation=client.post(url+'/api/conversations',headers={'Authorization':'Bearer '+a['token']},json={'user_id':b['user']['id']}).json()
    async def websocket_test():
        async with websockets.connect(url.replace('https://','wss://')+'/ws?conversation_id='+conversation['id']+'&after=0',additional_headers={'Cookie':cookie},origin=url,open_timeout=30) as socket:
            await socket.send(json.dumps({'type':'auth','token':b['token']}))
            response=await asyncio.to_thread(client.post,url+'/api/messages',headers={'Authorization':'Bearer '+a['token']},json={'conversation_id':conversation['id'],'client_message_id':uuid.uuid4().hex,'content':'Public HTTPS and WSS check'})
            assert response.status_code==200,response.text
            message=json.loads(await asyncio.wait_for(socket.recv(),20))
            assert message['type']=='messages'
            assert any(row['content']=='Public HTTPS and WSS check' for row in message['data'])
    asyncio.run(websocket_test())
print('PASS real public HTTPS gate, invalid-password rejection, Secure/HttpOnly cookie, production assets, API, config-file isolation, account auth and WSS message delivery')
