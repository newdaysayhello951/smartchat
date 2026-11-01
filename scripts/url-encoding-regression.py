"""Raw HTTP URL-escape regression against a running native server."""
import argparse,socket,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8081);args=p.parse_args();results=[]
for value,expected in [('%',400),('%2',400),('%+1',400),('%GG',400),('%2G',400),('%41',200),('%2b',200),('%E4%B8%AD',200),('a+b',200)]:
 with socket.create_connection(('127.0.0.1',args.port),timeout=10) as s:
  s.settimeout(10);s.sendall(('GET /api/health?probe='+value+' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n').encode());response=s.recv(4096);status=int(response.split(b' ',2)[1]);assert status==expected,(value,status,expected);results.append({'input':value,'status':status})
print(json.dumps(results,indent=2));Path('docs/url-encoding-regression.json').write_text(json.dumps(results,indent=2))
