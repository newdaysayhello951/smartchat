const {chromium}=require(require.resolve('playwright',{paths:[__dirname+'/../web']}));
const {randomUUID}=require('node:crypto');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const base='http://127.0.0.1:8080';const response=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ws_a_'+randomUUID().slice(0,8),password:'Rtc-probe-test-2026'})});assert(response.ok);const session=await response.json();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const ctx=await browser.newContext();await ctx.addInitScript(value=>sessionStorage.setItem('im-session',JSON.stringify(value)),session);const page=await ctx.newPage();await page.goto(base);await page.getByRole('button',{name:'音视频网络诊断',exact:true}).click();await page.getByRole('button',{name:'检查音视频网络',exact:true}).click();await page.locator('.rtc-diagnostics pre').waitFor({timeout:20000});const result=JSON.parse(await page.locator('.rtc-diagnostics pre').innerText());assert(result.secureContext&&result.mediaSupported);if(!result.turnConfigured)assert.equal(result.relayAllocation,false);fs.writeFileSync('docs/rtc-probe.json',JSON.stringify(result,null,2));console.log('PASS browser ICE probe; TURN configured:',result.turnConfigured,'relay allocation:',result.relayAllocation);}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
