"""TCP connection burst diagnostic, no credentials or production writes."""
import concurrent.futures,socket,time,json,statistics
from pathlib import Path
reports=[]
for workers in (64,128,256,512):
 def probe(_):
  start=time.perf_counter()
  try:
   with socket.create_connection(('127.0.0.1',8081),timeout=10) as s:
    connected=time.perf_counter();s.sendall(b'GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');s.settimeout(15);response=b''
    while True:
     part=s.recv(4096)
     if not part:break
     response+=part
   return {'connect_ms':round((connected-start)*1000,2),'status':response.split(b'\r\n',1)[0].decode(errors='replace')}
  except OSError as e:return {'error':type(e).__name__,'errno':e.errno,'winerror':getattr(e,'winerror',None),'elapsed_ms':round((time.perf_counter()-start)*1000,2)}
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:rows=list(pool.map(probe,range(1500)))
 errors=[r for r in rows if 'error'in r];statuses={}
 for r in rows:
  if 'status'in r:statuses[r['status']]=statuses.get(r['status'],0)+1
 report={'workers':workers,'requests':len(rows),'errors':len(errors),'error_examples':errors[:5],'statuses':statuses};reports.append(report);print(json.dumps(report),flush=True)
 time.sleep(3)
Path('docs/stress-tcp-20261101.json').write_text(json.dumps(reports,indent=2))
