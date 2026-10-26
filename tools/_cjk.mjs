import puppeteer from 'puppeteer-core';
const paths=['/en','/en/convert','/en/green','/en/docs','/en/convert/pdf-to-epub'];
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']});
for(const u of paths){
  const p=await b.newPage(); await p.goto('http://127.0.0.1:3100'+u,{waitUntil:'networkidle2'});
  const lines=await p.evaluate(()=>document.body.innerText.split('\n').filter(l=>/[\u4e00-\u9fff]/.test(l)));
  console.log('==',u,'cjk lines:',lines.length);
  console.log(lines.slice(0,10).map(l=>l.trim().slice(0,60)).join(' | '));
  await p.close();
}
await b.close();
