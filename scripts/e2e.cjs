// Real native stack: no mocked HTTP or WebRTC. Fake camera/microphone devices only.
const {chromium}=require(require.resolve('playwright',{paths:[__dirname+'/../web']}));
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const base=process.env.APP_URL||'http://127.0.0.1:8080';
async function http(path,token,body){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(token||''),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert(response.ok,JSON.stringify(result));return result;}
(async()=>{
 const suffix=randomUUID().slice(0,8);
 const accounts=await Promise.all(['A','B','C'].map(n=>http('/register','',{username:'e2e_'+n+'_'+suffix,password:'test-password-2026'})));
 const [a,b,c]=accounts;
 await http('/friend-requests',a.token,{user_id:b.user.id});
 const friend=(await http('/friend-requests',b.token))[0];await http('/friend-requests',b.token,{action:'accept',id:friend.id});
 const conversation=await http('/conversations',a.token,{user_id:b.user.id});
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{
  const contexts=await Promise.all(accounts.slice(0,2).map(async session=>{const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['camera','microphone']});await context.addInitScript(value=>sessionStorage.setItem('im-session',JSON.stringify(value)),session);return context;}));
  const [pa,pb]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
  const failures=[];[pa,pb].forEach(p=>p.on('pageerror',e=>failures.push(e.message)));
  await Promise.all([pa.goto(base),pb.goto(base)]);
  await pa.locator('.conversation').filter({hasText:b.user.username}).click();
  await pb.locator('.conversation').filter({hasText:a.user.username}).click();
  await pa.getByPlaceholder('写点什么…').fill('杭州旅行预算每人两千元，周六早上出发。');
  await pa.getByRole('button',{name:'发送 ↑',exact:true}).click();
  await pb.locator('.bubble').filter({hasText:'杭州旅行预算每人两千元'}).waitFor();
  console.log('PASS real two-user text delivery');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz8AAAAASUVORK5CYII=','base64');
  await pa.locator('input[type=file][accept^="image/"]').setInputFiles({name:'test-image.png',mimeType:'image/png',buffer:png});
  const image=pb.getByRole('button',{name:'查看图片 test-image.png'});
  await image.waitFor();await image.click();await pb.getByRole('dialog',{name:'图片预览'}).waitFor();await pb.getByRole('dialog',{name:'图片预览'}).click();
  const rows=await http('/messages?conversation_id='+conversation.id,b.token);const media=rows.find(m=>m.content==='📎 test-image.png');assert(media);
  const bytes=await fetch(base+'/api/files?id='+media.file_id,{headers:{Authorization:'Bearer '+b.token}});assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png);
  const denied=await fetch(base+'/api/files?id='+media.file_id,{headers:{Authorization:'Bearer '+c.token}});assert.equal(denied.status,403);
  console.log('PASS real image upload, preview/lightbox, exact download bytes, authorization');
  const clip=await pa.evaluate(()=>new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(10);const media=new MediaRecorder(stream,{mimeType:'video/webm'});const parts=[];let n=0;const paint=setInterval(()=>{ctx.fillStyle='#467a57';ctx.fillRect(0,0,320,180);ctx.fillStyle='#e4f2df';ctx.font='24px sans-serif';ctx.fillText('QingLiao video '+n++,25,95);},100);media.ondataavailable=e=>parts.push(e.data);media.onstop=async()=>{clearInterval(paint);stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(await new Blob(parts,{type:'video/webm'}).arrayBuffer())));};media.start();setTimeout(()=>media.stop(),900);}));
  await pa.locator('input[type=file][accept^="video/"]').setInputFiles({name:'test-clip.webm',mimeType:'video/webm',buffer:Buffer.from(clip)});
  const recipientVideo=pb.locator('video[aria-label="test-clip.webm"]');await recipientVideo.waitFor();await recipientVideo.evaluate(v=>v.play());await pb.waitForFunction(()=>{const v=document.querySelector('video[aria-label="test-clip.webm"]');return v&&v.videoWidth===320&&v.currentTime>0;});console.log('PASS real video-file transfer, browser decoding and playback');
  await pa.getByTitle('录制语音消息',{exact:true}).click();await pa.getByTitle('停止录音并发送').waitFor();await pa.waitForTimeout(1200);await pa.getByTitle('停止录音并发送').click();await pb.locator('audio[aria-label="语音消息"]').waitFor();
  console.log('PASS real MediaRecorder voice-message upload and recipient audio element');
  for(const kind of ['语音通话','视频通话']){
   await pa.getByTitle(kind,{exact:true}).click();await pb.getByRole('dialog',{name:kind,exact:true}).waitFor();await pb.getByRole('button',{name:'☎ 接听'}).click();
   await Promise.all([pa.getByTestId('call-phase').filter({hasText:'通话中'}).waitFor({timeout:30000}),pb.getByTestId('call-phase').filter({hasText:'通话中'}).waitFor({timeout:30000})]);
   if(kind==='视频通话'){await pb.waitForFunction(()=>{const v=document.querySelector('.remote-video');return v&&v.videoWidth>0;},null,{timeout:15000});fs.mkdirSync('docs/screenshots',{recursive:true});await pa.screenshot({path:'docs/screenshots/windows-real-video-call.png'});}
   await pa.getByRole('button',{name:'切换麦克风'}).click();assert(await pa.getByText('取消静音',{exact:true}).isVisible());
   await pa.getByRole('button',{name:'☎ 挂断'}).click();await pb.getByRole('dialog',{name:kind,exact:true}).waitFor({state:'hidden',timeout:15000});
   console.log('PASS real '+kind+' peer connection, mute and hangup'+(kind==='视频通话'?' / remote video frames':''));
  }
  await pa.getByTitle('语音通话',{exact:true}).click();await pb.getByRole('dialog',{name:'语音通话',exact:true}).waitFor();await pb.getByRole('button',{name:'✕ 拒绝'}).click();await pa.getByRole('dialog',{name:'语音通话',exact:true}).waitFor({state:'hidden',timeout:15000});console.log('PASS reject call');
  await pa.getByTitle('打开智能助手').click();await pa.getByRole('button',{name:'Agent',exact:true}).click();await pa.getByPlaceholder('总结出行需求，结合攻略生成一份行程草案。').fill('总结预算并生成行程');
  fs.mkdirSync('docs/screenshots',{recursive:true});await pa.screenshot({path:'docs/screenshots/windows-real-chat.png',fullPage:true});
  await pa.setViewportSize({width:390,height:844});await pa.getByTitle('关闭助手').click();await pa.screenshot({path:'docs/screenshots/windows-real-mobile.png',fullPage:true});
  assert.deepEqual(failures,[]);console.log('PASS no uncaught frontend errors, RAG/Agent UI, desktop/mobile screenshots');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
