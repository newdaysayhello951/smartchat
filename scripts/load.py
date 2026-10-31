"""Bounded HTTP benchmark; report measured data only. Run against test accounts."""
import argparse
import concurrent.futures
import json
import math
import statistics
import time
import urllib.request

p=argparse.ArgumentParser()
p.add_argument("--url",default="http://localhost:8080")
p.add_argument("--requests",type=int,default=200)
p.add_argument("--concurrency",type=int,default=8)
args=p.parse_args()
def request(_):
    start=time.perf_counter()
    try:
        with urllib.request.urlopen(args.url+"/api/health",timeout=10) as r:
            r.read()
            ok=r.status==200
    except Exception:
        ok=False
    return (time.perf_counter()-start)*1000,ok
start=time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
    results=list(pool.map(request,range(args.requests)))
elapsed=time.perf_counter()-start
latencies=sorted(x[0] for x in results)
print(json.dumps({"endpoint":"/api/health","requests":args.requests,"concurrency":args.concurrency,"seconds":round(elapsed,3),"rps":round(args.requests/elapsed,2),"p50_ms":round(statistics.median(latencies),2),"p95_ms":round(latencies[math.ceil(len(latencies)*.95)-1],2),"errors":sum(not x[1] for x in results)},indent=2))
