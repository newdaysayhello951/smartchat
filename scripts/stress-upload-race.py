import runpy,sys,concurrent.futures,uuid,hashlib,json
from pathlib import Path
sys.argv=['product-smoke.py'];s=runpy.run_path(str(Path(__file__).with_name('product-smoke.py')));api=s['api'];token=s['tb'];cid=s['cid']
data=b'concurrent upload integrity\n'*40000;meta={'conversation_id':cid,'name':'race-'+uuid.uuid4().hex+'.zip','size':len(data),'chunk_hashes':[hashlib.sha256(data).hexdigest()]}
def parallel(fn):
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:return list(pool.map(fn,range(16)))
ids=parallel(lambda _:api('/uploads/init',token,meta)['id']);assert len(set(ids))==1
uid=ids[0];parallel(lambda _:api('/uploads/chunk?id='+uid+'&part=0',token,content=data))
completed=parallel(lambda _:api('/uploads/complete',token,{'id':uid})['id']);assert set(completed)=={uid}
r=api('/files?id='+uid,token);assert r.content==data
result={'parallel_requests_per_operation':16,'workers':8,'init_single_id':True,'concurrent_same_chunk':True,'complete_single_id':True,'download_sha256':hashlib.sha256(r.content).hexdigest()}
Path('docs/stress-upload-race-20261101.json').write_text(json.dumps(result,indent=2));print('PASS',result)
