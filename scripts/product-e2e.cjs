const {chromium}=require(require.resolve('playwright',{paths:[__dirname+'/../web']}));
const {randomUUID,createHash}=require('node:crypto');const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.env.APP_URL||'http://127.0.0.1:8080';
async function api(path,token,body){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert(r.ok,JSON.stringify(value));return value;}
(async()=>{
 const suffix=randomUUID().slice(0,8);const [a,b,c]=await Promise.all([0,1,2].map(i=>api('/register','',{username:`test_${suffix}_${i}`,password:'Browser-test-2026'})));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const pages=[];const failures=[];
 try{
  for(const session of [a,b]){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(value=>sessionStorage.setItem('im-session',JSON.stringify(value)),session);const page=await ctx.newPage();page.on('pageerror',e=>failures.push(e.message));await page.goto(base);pages.push(page);}
  const [pa,pb]=pages;
  await pa.locator('.product-buttons button').filter({hasText:'添加好友'}).click();await pa.getByLabel('查找用户').fill(b.user.username);await pa.getByRole('button',{name:'查找',exact:true}).click();await pa.locator('.person-row').filter({hasText:b.user.username}).getByRole('button',{name:'申请添加'}).click();
  await pb.locator('.product-buttons button').filter({hasText:'添加好友'}).click();await pb.locator('.request-row').filter({hasText:a.user.username}).getByRole('button',{name:'同意',exact:true}).click();
  await api('/friend-requests',a.token,{user_id:c.user.id});const f=(await api('/friend-requests',c.token))[0];await api('/friend-requests',c.token,{action:'accept',id:f.id});
  await pa.locator('.product-modal>header button').click();await pb.locator('.product-modal>header button').click();
  console.log('PASS browser friend search, request and acceptance');
  await pa.getByRole('button',{name:'♙ 新建群聊'}).click();await pa.getByLabel('群名称',{exact:true}).fill('浏览器验收群');await pa.getByLabel(b.user.username,{exact:true}).check();await pa.getByLabel(c.user.username,{exact:true}).check();await pa.getByRole('button',{name:/^创建群聊/}).click();await pa.locator('.chat-title').filter({hasText:'浏览器验收群'}).waitFor();
  await pb.locator('.conversation').filter({hasText:'浏览器验收群'}).click();
  await pa.getByPlaceholder('写点什么…').fill('这是一条将撤回的群消息');await pa.getByRole('button',{name:'发送 ↑',exact:true}).click();await pb.locator('.bubble').filter({hasText:'这是一条将撤回的群消息'}).waitFor();await pa.locator('.message').filter({hasText:'这是一条将撤回的群消息'}).getByRole('button',{name:'撤回',exact:true}).click();await pb.locator('.bubble').filter({hasText:'[消息已撤回]'}).waitFor();assert.equal(await pb.locator('.messages').getByText('这是一条将撤回的群消息',{exact:true}).count(),0);
  console.log('PASS browser group creation, delivery and live recall');
  const payload=Buffer.alloc(12*1024*1024+123,0x61);payload[payload.length-1]=0x62;let firstPartCount=0,partOneSeen=false;
  await pa.route('**/api/uploads/chunk?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('part')==='0')firstPartCount++;if(u.searchParams.get('part')==='1'&&!partOneSeen){partOneSeen=true;await new Promise(r=>setTimeout(r,2200));}try{await route.continue();}catch{}});
  await pa.locator('input[type=file]:not([accept])').setInputFiles({name:'分片验收.zip',mimeType:'application/zip',buffer:payload});await pa.waitForFunction(()=>document.querySelector('.composer-tools')?.textContent.includes('上传分片'));
  for(let i=0;i<60&&!partOneSeen;i++)await pa.waitForTimeout(100);
  assert(partOneSeen);await pa.getByRole('button',{name:'暂停',exact:true}).click();await pa.getByRole('button',{name:'继续上传',exact:true}).waitFor();await pa.unroute('**/api/uploads/chunk?*');await pa.getByRole('button',{name:'继续上传',exact:true}).click();await pb.locator('.file-card').filter({hasText:'分片验收.zip'}).waitFor({timeout:30000});assert.equal(firstPartCount,1);
  console.log('PASS browser upload pause/resume; first completed chunk not retransmitted');
  await pb.evaluate(async()=>{const directory=await navigator.storage.getDirectory();window.showSaveFilePicker=options=>directory.getFileHandle(options.suggestedName,{create:true});});
  let downloadPartSeen=false;
  await pb.route('**/api/files?*',async route=>{const range=route.request().headers()['range'];if(range?.startsWith('bytes=4194304-')&&!downloadPartSeen){downloadPartSeen=true;await new Promise(r=>setTimeout(r,2200));}try{await route.continue();}catch{}});
  await pb.locator('.message').filter({hasText:'分片验收.zip'}).getByRole('button',{name:'↓ 下载文件',exact:true}).click();for(let i=0;i<80&&!downloadPartSeen;i++)await pb.waitForTimeout(100);assert(downloadPartSeen);await pb.getByRole('button',{name:'暂停下载',exact:true}).click();await pb.waitForFunction(()=>document.querySelector('.notice')?.textContent.includes('下载已暂停'));await pb.unroute('**/api/files?*');await pb.locator('.message').filter({hasText:'分片验收.zip'}).getByRole('button',{name:'↓ 下载文件',exact:true}).click();await pb.waitForFunction(()=>document.querySelector('.notice')?.textContent.includes('文件下载完成'),null,{timeout:30000});
  const downloaded=await pb.evaluate(async()=>{const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle('分片验收.zip');const file=await handle.getFile();const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return {size:file.size,hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};});assert.equal(downloaded.size,payload.length);assert.equal(downloaded.hash,createHash('sha256').update(payload).digest('hex'));
  console.log('PASS browser streamed download pause/resume and exact final hash (real OPFS file handles)');
  await pa.getByRole('button',{name:'⚙ 修改密码'}).click();await pa.getByLabel('原密码',{exact:true}).fill('Browser-test-2026');await pa.getByLabel('新密码',{exact:true}).fill('Browser-new-2026');await pa.getByLabel('确认新密码',{exact:true}).fill('Browser-new-2026');await pa.getByRole('button',{name:'确认修改',exact:true}).click();await pa.locator('.product-modal').waitFor({state:'hidden'});await pa.waitForTimeout(1500);assert(await pa.locator('.rail').isVisible());const saved=await pa.evaluate(()=>JSON.parse(sessionStorage.getItem('im-session')));assert.notEqual(saved.token,a.token);
  fs.mkdirSync('docs/screenshots',{recursive:true});await pa.screenshot({path:'docs/screenshots/v2-groups-resume.png',fullPage:true});
  assert.deepEqual(failures,[]);console.log('PASS browser password change keeps new session; no uncaught frontend errors');
 }catch(error){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`data/product-ui-failure-${i}.png`,fullPage:true});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
