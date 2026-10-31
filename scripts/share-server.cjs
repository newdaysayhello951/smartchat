// Public-share gateway: serves only built assets and the public C++ API/WS.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Transform} = require('node:stream');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'web/dist');
const config=JSON.parse(fs.readFileSync(path.join(root,'data/share-access.json'),'utf8').replace(/^\uFEFF/,''));
const secret=crypto.createHash('sha256').update(config.password).digest();
const sessions=new Map(),rates=new Map();
const MAX=50*1024*1024;
const policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
function secure(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',policy);res.setHeader('Cache-Control','no-store');}
function respond(res,status,text,type='text/plain; charset=utf-8'){secure(res);res.writeHead(status,{'Content-Type':type});res.end(text);}
function allowed(req){const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('ql_share='));const token=cookie?.slice(9);return token&&sessions.get(token)>Date.now();}
function limit(req,label,max,period){const ip=req.headers['cf-connecting-ip']||req.socket.remoteAddress;const key=label+':'+ip;let value=rates.get(key);if(!value||value.until<Date.now()){value={count:0,until:Date.now()+period};rates.set(key,value);}return ++value.count<=max;}
function originOK(req){if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}}
function gate(res,message='输入分享口令后，进入青聊登录或注册。',status=200){respond(res,status,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>青聊 · 分享访问</title><style>body{margin:0;background:#edf2e9;font:15px "Segoe UI","Microsoft YaHei",sans-serif;color:#284435;display:grid;min-height:100vh;place-items:center}form{background:#fff;border-radius:16px;padding:40px;width:min(340px,75vw);box-shadow:0 20px 70px #354f3220}h1{font-size:28px}p{line-height:1.8;color:#7a8e75;font-size:13px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:15px;border-radius:7px;border:1px solid #d8e2d0;font:inherit}button{background:#438454;color:white;border:0;cursor:pointer}small{display:block;margin-top:25px;color:#99a58e;font-size:11px}</style><form method="post" action="/_share/access"><h1>青聊 · 分享访问</h1><p>${message}</p><label>分享口令<input name="password" type="password" required autofocus autocomplete="current-password" maxlength="100"></label><button>进入青聊</button><small>此电脑提供的临时分享服务 · 请勿转发给无关人员</small></form></html>`,'text/html; charset=utf-8');}
function proxy(req,res){
 const bulk=req.url.startsWith('/api/uploads/chunk')||req.url.startsWith('/api/files?');
 if(!limit(req,bulk?'bulk':'api',bulk?1200:300,60000)){respond(res,429,'Too many requests');return;}
 if(Number(req.headers['content-length']||0)>MAX){respond(res,413,'File too large');return;}
 const headers={...req.headers,host:'127.0.0.1:8081'};delete headers.cookie;delete headers['cf-access-jwt-assertion'];
 const upstream=http.request({hostname:'127.0.0.1',port:8081,path:req.url,method:req.method,headers},response=>{secure(res);res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 let size=0;const counter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>MAX)callback(new Error('body limit'));else callback(null,chunk);}});
 upstream.setTimeout(45000,()=>upstream.destroy(new Error('upstream timeout')));
 upstream.on('error',()=>{if(!res.headersSent)respond(res,502,'Backend unavailable');else res.destroy();});
 counter.on('error',()=>{upstream.destroy();if(!res.headersSent)respond(res,413,'File too large');});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(counter).pipe(upstream);
}
const server=http.createServer((req,res)=>{
 if(!originOK(req)){respond(res,403,'Origin denied');return;}
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/_share/access'&&req.method==='POST'){
  if(!limit(req,'login',8,15*60000)){gate(res,'尝试次数过多，请 15 分钟后重试。',429);return;}
  let text='';req.on('data',chunk=>{text+=chunk;if(text.length>512)req.destroy();});req.on('end',()=>{
   const password=new URLSearchParams(text).get('password')||'';const digest=crypto.createHash('sha256').update(password).digest();
   if(!crypto.timingSafeEqual(secret,digest)){gate(res,'口令不正确，请重新输入。',403);return;}
   if(sessions.size>=200){respond(res,503,'Too many share sessions');return;}
   const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*3600000);secure(res);res.writeHead(303,{'Set-Cookie':`ql_share=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`,'Location':'/'});res.end();
  });return;
 }
 if(!allowed(req)){if(url.pathname.startsWith('/api/'))respond(res,401,JSON.stringify({error:'分享访问已过期，请刷新网页输入分享口令'}),'application/json');else gate(res);return;}
 if(url.pathname.startsWith('/api/')){proxy(req,res);return;}
 if(!['GET','HEAD'].includes(req.method)){respond(res,405,'Method not allowed');return;}
 let filename;try{const decoded=decodeURIComponent(url.pathname);if(decoded.split('/').some(part=>part.startsWith('.'))){respond(res,404,'Not found');return;}filename=path.resolve(dist,'.'+decoded);}catch{respond(res,400,'Invalid URL');return;}
 if(filename!==dist&&!filename.startsWith(dist+path.sep)){respond(res,403,'Forbidden');return;}
 if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){if(path.extname(url.pathname)){respond(res,404,'Not found');return;}filename=path.join(dist,'index.html');}
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'}[path.extname(filename)]||'application/octet-stream';secure(res);res.writeHead(200,{'Content-Type':mime});if(req.method==='HEAD')res.end();else fs.createReadStream(filename).on('error',()=>res.destroy()).pipe(res);
});
let upgrades=0;
server.on('upgrade',(req,socket,head)=>{
 if(!req.url.startsWith('/ws?')||!allowed(req)||!originOK(req)||upgrades>=100){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
 upgrades++;let counted=true;function release(){if(counted){counted=false;upgrades--;}}socket.on('close',release);socket.on('error',()=>socket.destroy());
 const headers={...req.headers,host:'127.0.0.1:8081'};delete headers.cookie;
 const upstream=http.request({hostname:'127.0.0.1',port:8081,path:req.url,method:'GET',headers});upstream.setTimeout(10000,()=>upstream.destroy());
 upstream.on('upgrade',(response,peer,upstreamHead)=>{upstream.setTimeout(0);socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(upstreamHead.length)socket.write(upstreamHead);if(head.length)peer.write(head);peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());peer.on('close',()=>socket.destroy());socket.pipe(peer).pipe(socket);});upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();
});
server.requestTimeout=360000;server.headersTimeout=15000;server.maxConnections=150;
setInterval(()=>{for(const [k,v]of rates)if(v.until<Date.now())rates.delete(k);for(const[k,v]of sessions)if(v<Date.now())sessions.delete(k);},60000).unref();
server.listen(8787,'127.0.0.1',()=>console.log('Password-protected production share gateway listening on 127.0.0.1:8787'));
