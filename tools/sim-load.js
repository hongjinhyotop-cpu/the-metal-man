// 개발용: index.html 의 전투 규칙 스크립트(그리기·입력·화면 제외)를 Node vm 으로 읽어 TMM 을 돌려준다.
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
module.exports=function(){
  const html=fs.readFileSync(ROOT+'/index.html','utf8');
  const srcs=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]).filter(s=>!/render\/|ui\/|input|main\.js/.test(s));
  const ctx={window:{},console,Math,performance:{now:()=>Date.now()},Map,Set};
  ctx.window=ctx; vm.createContext(ctx);
  for(const s of srcs) vm.runInContext(fs.readFileSync(ROOT+'/'+s,'utf8'),ctx,{filename:s});
  return ctx.TMM;
};
