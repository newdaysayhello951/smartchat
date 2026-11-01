"""Bounded real-business concurrency regression; synthetic data only."""
import runpy,sys,concurrent.futures,time,json,uuid,statistics,threading,ctypes
from pathlib import Path
sys.argv=['product-smoke.py'];s=runpy.run_path(str(Path(__file__).with_name('product-smoke.py')))
import httpx
s['api'].__globals__['client']=httpx.Client(base_url='http://127.0.0.1:8081',timeout=120,limits=httpx.Limits(max_connections=600,max_keepalive_connections=600))
api=s['api'];token=s['tb'];cid=s['cid'];reports=[]
for workers in (128,256,512):
 ids=[uuid.uuid4().hex for _ in range(500)]; jobs=ids*3
 def send(mid):
  start=time.perf_counter()
  try:
   r=api('/messages',token,{'conversation_id':cid,'client_message_id':mid,'content':'synthetic concurrent '+mid});return mid,r['id'],(time.perf_counter()-start)*1000,None
  except Exception as e:
   chain=[];current=e
   while current is not None and len(chain)<5:
    chain.append({'type':type(current).__name__,'errno':getattr(current,'errno',None),'winerror':getattr(current,'winerror',None),'message':str(current)[:160]});current=current.__cause__
   return mid,None,(time.perf_counter()-start)*1000,chain
 start=time.perf_counter()
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:out=list(pool.map(send,jobs))
 groups={}
 for mid,serverid,_,error in out:
  if not error:groups.setdefault(mid,set()).add(serverid)
 latency=sorted(x[2] for x in out);errors=[x[3] for x in out if x[3]]
 report={'concurrency':workers,'requests':len(jobs),'seconds':round(time.perf_counter()-start,2),'p50_ms':round(statistics.median(latency),2),'p95_ms':round(latency[int(len(latency)*.95)-1],2),'errors':len(errors),'examples':errors[:3],'duplicate_id_conflicts':sum(len(v)!=1 for v in groups.values()),'unique_messages_acknowledged':len(groups)}
 rows=[];cursor='0'
 while True:
  page=api('/messages?conversation_id='+cid+'&after='+cursor,token)
  if not page:break
  rows.extend(page);cursor=str(page[-1]['seq'])
 matched=[r for r in rows if r.get('client_message_id') in set(ids)]
 report['persisted_rows']=len(matched)
 report['persisted_unique_client_ids']=len({r['client_message_id'] for r in matched})
 report['sequence_collisions']=len(rows)-len({r['seq'] for r in rows})
 report['post_load_health']=api('/health')
 reports.append(report);print(json.dumps(report),flush=True)
 if errors:break
Path('docs/stress-diagnostic-20261101.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')


# Persist diagnostics before signaling a failed acceptance run.
sys.exit(1 if any(r["errors"] or r["duplicate_id_conflicts"] or r["persisted_rows"] != 500 or r["persisted_unique_client_ids"] != 500 or r["sequence_collisions"] for r in reports) else 0)
