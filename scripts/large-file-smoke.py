"""Upload >50 MB with resume, then hash the streamed download; constant test memory."""
import argparse,hashlib,json,uuid
from pathlib import Path
import httpx
p=argparse.ArgumentParser();p.add_argument('--mb',type=int,default=64);p.add_argument('--share',action='store_true');args=p.parse_args()
assert 1<=args.mb<=1023
root=Path(__file__).resolve().parents[1];base=(root/'data/share-url.txt').read_text().strip() if args.share else 'http://127.0.0.1:8081'
client=httpx.Client(base_url=base,timeout=300)
if args.share:
 secret=json.loads((root/'data/share-access.json').read_text(encoding='utf-8-sig'))['password'];r=client.post('/_share/access',data={'password':secret},headers={'Origin':base});assert r.status_code==303
def api(path,token='',body=None):
 r=client.request('POST' if body is not None else 'GET','/api'+path,headers={'Authorization':'Bearer '+token} if token else {},json=body);assert r.is_success,(r.status_code,r.text[:200]);return r.json()
suffix=uuid.uuid4().hex[:8];a,b=[api('/register',body={'username':f'test_{suffix}_{i}','password':'Large-file-test-2026'}) for i in range(2)]
api('/friend-requests',a['token'],{'user_id':b['user']['id']});f=api('/friend-requests',b['token'])[0];api('/friend-requests',b['token'],{'action':'accept','id':f['id']});cid=api('/conversations',a['token'],{'user_id':b['user']['id']})['id']
CHUNK=4*1024*1024;total=args.mb*1024*1024+137;count=(total+CHUNK-1)//CHUNK
def part(index):return bytes([index%251+1])*min(CHUNK,total-index*CHUNK)
hashes=[];expected=hashlib.sha256()
for i in range(count):data=part(i);hashes.append(hashlib.sha256(data).hexdigest());expected.update(data)
meta={'conversation_id':cid,'name':'大文件续传验收.bin','size':total,'chunk_hashes':hashes}
task=api('/uploads/init',a['token'],meta)
for i in range(count):
 if i==2:
  resumed=api('/uploads/init',a['token'],meta);assert resumed['id']==task['id'] and len(resumed['parts'])==2
 r=client.post('/api/uploads/chunk',params={'id':task['id'],'part':i},headers={'Authorization':'Bearer '+a['token'],'Content-Type':'application/octet-stream'},content=part(i));assert r.status_code==200,(r.status_code,r.text[:100])
 if (i+1)%8==0:print('Uploaded chunks:',i+1,'/',count,flush=True)
file=api('/uploads/complete',a['token'],{'id':task['id']});received=hashlib.sha256();length=0
with client.stream('GET','/api/files',params={'id':file['id']},headers={'Authorization':'Bearer '+b['token']}) as response:
 assert response.status_code==200
 for data in response.iter_bytes(chunk_size=128*1024):received.update(data);length+=len(data)
assert length==total and received.digest()==expected.digest()
print('PASS',total,'bytes; resumed chunks, streamed download and SHA-256 match;', 'public HTTPS' if args.share else 'native',flush=True)
