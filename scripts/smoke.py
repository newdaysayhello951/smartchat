"""Black-box verification against a running Compose stack. No LLM key required."""
import argparse
import concurrent.futures
import json
import urllib.error
import urllib.request
import uuid

p = argparse.ArgumentParser()
p.add_argument("--url", default="http://localhost:8080")
args = p.parse_args()


def call(path, token="", body=None, raw=None, expected=200):
    headers = {"Authorization": "Bearer "+token}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if raw is not None:
        data = raw
        headers["Content-Type"] = "application/octet-stream"
    req = urllib.request.Request(args.url+"/api"+path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            code, content = response.status, response.read()
    except urllib.error.HTTPError as exc:
        code, content = exc.code, exc.read()
    assert code == expected, (path, code, content[:200])
    try:
        return json.loads(content)
    except (ValueError, UnicodeDecodeError):
        return content


suffix = uuid.uuid4().hex[:8]
accounts = [call("/register", body={"username": f"test_{suffix}_{i}", "password": "Test-password-2026"}) for i in range(3)]
a,b,c = accounts
ta,tb,tc = (x["token"] for x in accounts)
call("/friend-requests",ta,{"user_id":b["user"]["id"]})
f=call("/friend-requests",tb)[0]
call("/friend-requests",tb,{"action":"accept","id":f["id"]})
cid = call("/conversations", ta, {"user_id": b["user"]["id"]})["id"]
assert call("/conversations", tb, {"user_id": a["user"]["id"]})["id"] == cid
item = {"conversation_id":cid,"client_message_id":uuid.uuid4().hex,"content":"杭州旅行预算两千元"}
first = call("/messages", ta, item)
assert call("/messages", ta, item)["id"] == first["id"]
call("/messages", ta, dict(item, content="changed"), expected=409)
call(f"/messages?conversation_id={cid}", tc, expected=403)
assert call(f"/messages?conversation_id={cid}",tb)[0]["id"] == first["id"]
assert call(f"/messages?conversation_id={cid}&after={first['seq']}",tb) == []
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures = [pool.submit(call, "/messages", ta, dict(item, client_message_id=uuid.uuid4().hex, content=f"parallel {i}")) for i in range(12)]
    rows = [f.result() for f in futures]
assert len(set(r["seq"] for r in rows)) == 12
data = "杭州旅行攻略：住宿预算每人两千元。".encode()
file = call(f"/files?conversation_id={cid}&name=guide.txt", ta, raw=data)
assert call("/files?id="+file["id"],tb) == data
call("/files?id="+file["id"],tc,expected=403)
attachment=call(f"/files?conversation_id={cid}&name=archive.zip",ta,raw=b"test-archive")
assert call('/files?id='+attachment['id'],tb)==b'test-archive'
call(f"/files?conversation_id={cid}&name=..%2Fescape.txt",ta,raw=b"bad",expected=400)
call("/messages",ta,dict(item,client_message_id=uuid.uuid4().hex,content="附件",file_id=file["id"]))
job = call("/ai",ta,{"conversation_id":cid,"mode":"index"},expected=202)
call("/jobs?id="+job["id"],tc,expected=404)
call("/ai",tc,{"conversation_id":cid,"mode":"summary"},expected=403)
call("/logout", ta, {})
call("/conversations",ta,expected=401)
print("PASS: registration, login, pair uniqueness, persistence, dedup, conflict, catch-up, concurrency, file bytes, file/message/AI authorization, logout")
