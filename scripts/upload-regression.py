"""Real Unicode filename round-trip and >30s upload regression; synthetic data only."""
import argparse
import http.client
import json
from pathlib import Path
import time
import urllib.parse
import uuid
import httpx

p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:8081');p.add_argument('--share',action='store_true');p.add_argument('--slow',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[1]
url=args.url
if args.share:url=(root/'data/share-url.txt').read_text().strip()
with httpx.Client(timeout=400,follow_redirects=False) as client:
    if args.share:
        password=json.loads((root/'data/share-access.json').read_text(encoding='utf-8-sig'))['password']
        auth=client.post(url+'/_share/access',data={'password':password},headers={'Origin':url})
        assert auth.status_code==303,auth.status_code
    def api(path,token='',body=None):
        r=client.request('POST' if body is not None else 'GET',url+'/api'+path,headers={'Authorization':'Bearer '+token} if token else {},json=body)
        assert r.is_success,(r.status_code,r.text[:120]);return r.json()
    suffix=uuid.uuid4().hex[:8]
    a,b=[api('/register',body={'username':f'test_{suffix}_{i}','password':'Upload-regression-2026'}) for i in range(2)]
    api('/friend-requests',a['token'],{'user_id':b['user']['id']})
    friend=api('/friend-requests',b['token'])[0]
    api('/friend-requests',b['token'],{'action':'accept','id':friend['id']})
    cid=api('/conversations',a['token'],{'user_id':b['user']['id']})['id']
    content='合成上传回归资料，不包含任何私人文件。'.encode()
    for name in ('plain.txt','中文资料.txt','报告😀.txt','𠮷字资料.txt','file space + # %.bin','相册🚀.PNG'):
        r=client.post(url+f'/api/files?conversation_id={cid}&name='+urllib.parse.quote(name,safe=''),headers={'Authorization':'Bearer '+a['token'],'Content-Type':'application/octet-stream'},content=content)
        assert r.status_code==200,(name,r.status_code,r.text[:180])
        file=r.json();assert file['name']==name
        downloaded=client.get(url+'/api/files?id='+file['id'],headers={'Authorization':'Bearer '+b['token']})
        assert downloaded.status_code==200,(name,downloaded.status_code)
        assert downloaded.content==content
        if name.endswith('.PNG'):assert downloaded.headers['content-type']=='image/png'
        api('/messages',a['token'],{'conversation_id':cid,'client_message_id':uuid.uuid4().hex,'content':'📎 '+name,'file_id':file['id']})
        print('PASS Unicode file upload/download/message:',name.encode('unicode_escape').decode(),flush=True)
    if args.slow:
        parsed=urllib.parse.urlsplit(url);assert parsed.scheme=='http','Run slow test against native HTTP listener'
        connection=http.client.HTTPConnection(parsed.hostname,parsed.port,timeout=400)
        connection.putrequest('POST',f'/api/files?conversation_id={cid}&name=slow-transfer.bin')
        connection.putheader('Authorization','Bearer '+a['token']);connection.putheader('Content-Type','application/octet-stream');connection.putheader('Content-Length','35840');connection.endheaders()
        started=time.monotonic()
        for _ in range(35):connection.send(b'x'*1024);time.sleep(1)
        response=connection.getresponse();data=response.read();assert response.status==200,(response.status,data[:120]);connection.close()
        print('PASS slow upload:',round(time.monotonic()-started,1),'seconds (> old 30s deadline)',flush=True)
print('PASS', 'public HTTPS gateway' if args.share else 'native C++ backend')
