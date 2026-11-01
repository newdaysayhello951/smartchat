import socket,time,json,httpx
from pathlib import Path
sockets=[];results=[]
with httpx.Client(base_url='http://127.0.0.1:8081',timeout=15,trust_env=False) as c:
 for count in (32,128,300):
  try:
   for _ in range(count-len(sockets)):
    s=socket.create_connection(('127.0.0.1',8081),timeout=3);s.sendall(b'GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');sockets.append(s)
   start=time.perf_counter();r=c.get('/api/health');results.append({'partial_headers':count,'status':r.status_code,'latency_ms':round((time.perf_counter()-start)*1000,2)})
  except Exception as e:results.append({'partial_headers':count,'error':str(e)});break
 for s in sockets:s.close()
 time.sleep(2);results.append({'after_close_status':c.get('/api/health').status_code})
print(json.dumps(results,indent=2));Path('docs/stress-slow-20261101.json').write_text(json.dumps(results,indent=2))
