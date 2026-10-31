const {chromium}=require(require.resolve('playwright',{paths:[__dirname+'/../web']}));
const fs=require('node:fs');
(async()=>{
 const url=fs.readFileSync('data/share-url.txt','utf8').trim();
 const password=JSON.parse(fs.readFileSync('data/share-access.json','utf8').replace(/^\uFEFF/,'')).password;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  page.on('pageerror',error=>console.log('Page error:',error.message));
  page.on('console',message=>{if(message.type()==='error')console.log('Browser error:',message.text());});
  await page.goto(url);
  await page.getByLabel('分享口令').fill(password);
  await page.getByRole('button',{name:'进入青聊',exact:true}).click();
  try{await page.getByLabel('用户名',{exact:true}).waitFor({timeout:15000});}catch(error){await page.screenshot({path:'data/share-browser-failure.png',fullPage:true});console.log('Location:',page.url());console.log('Page text:',(await page.locator('body').innerText()).slice(0,300));throw error;}
  if(!await page.evaluate(()=>window.isSecureContext&&!!navigator.mediaDevices?.getUserMedia))throw Error('Media secure context missing');
  await page.screenshot({path:'docs/screenshots/public-share-login.png',fullPage:true});
  console.log('PASS actual public HTTPS browser gate -> production React login; secure media context available');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
