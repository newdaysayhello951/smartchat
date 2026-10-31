"""Run after compose up. Requires websockets==14.1; creates two test accounts."""
import argparse
import asyncio
import json
import urllib.request
import uuid
import websockets

parser=argparse.ArgumentParser()
parser.add_argument("--url",default="http://localhost:8080")
args=parser.parse_args()
def post(path,token="",**body):
    request=urllib.request.Request(args.url+"/api"+path,data=json.dumps(body).encode(),headers={"Content-Type":"application/json","Authorization":"Bearer "+token})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

async def receive(ws,expected):
    for _ in range(10):
        event=json.loads(await asyncio.wait_for(ws.recv(),10))
        if event["type"]=="messages" and any(row["id"]==expected for row in event["data"]):
            return
    raise AssertionError("message not delivered")

async def main():
    suffix=uuid.uuid4().hex[:8]
    a=await asyncio.to_thread(post,"/register",username="ws_a_"+suffix,password="Test-password-2026")
    b=await asyncio.to_thread(post,"/register",username="ws_b_"+suffix,password="Test-password-2026")
    await asyncio.to_thread(post,"/friend-requests",a["token"],user_id=b["user"]["id"])
    def requests():
        req=urllib.request.Request(args.url+"/api/friend-requests",headers={"Authorization":"Bearer "+b["token"]})
        with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
    friend=(await asyncio.to_thread(requests))[0]
    await asyncio.to_thread(post,"/friend-requests",b["token"],action="accept",id=friend["id"])
    c=await asyncio.to_thread(post,"/conversations",a["token"],user_id=b["user"]["id"])
    url=args.url.replace("http://","ws://").replace("https://","wss://")+"/ws?conversation_id="+c["id"]
    async with websockets.connect(url+"&after=0") as ws:
        await ws.send(json.dumps({"type":"auth","token":b["token"]}))
        first=await asyncio.to_thread(post,"/messages",a["token"],conversation_id=c["id"],client_message_id=uuid.uuid4().hex,content="实时消息")
        await receive(ws,first["id"])
    second=await asyncio.to_thread(post,"/messages",a["token"],conversation_id=c["id"],client_message_id=uuid.uuid4().hex,content="离线消息")
    async with websockets.connect(url+"&after="+first["seq"]) as ws:
        await ws.send(json.dumps({"type":"auth","token":b["token"]}))
        await receive(ws,second["id"])
        outgoing={"type":"chat","client_message_id":uuid.uuid4().hex,"content":"WebSocket 发送"}
        await ws.send(json.dumps(outgoing))
        for _ in range(10):
            event=json.loads(await asyncio.wait_for(ws.recv(),10))
            if event["type"]=="ack":
                assert event["status"]==200
                assert event["data"]["client_message_id"]==outgoing["client_message_id"]
                break
        else:
            raise AssertionError("missing ack")
    print("PASS: WebSocket authentication, real-time delivery, disconnect catch-up, send acknowledgment")

asyncio.run(main())
