// Local-only browser verification server; never deployed with the website.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root=resolve(import.meta.dirname,"..");
const sources={"/source/index.ts":"supabase/functions/genapi/index.ts","/source/attachments.mjs":"supabase/functions/genapi/attachments.mjs"};
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".jpeg":"image/jpeg",".jpg":"image/jpeg",".svg":"image/svg+xml",".json":"application/json"};
const allowed=new Set(["index.html","auth.html","profile.html","app.js","genapi-client.js","genapi-media.js","ai-workflows.js","chat-attachments.js","enhancements.js","styles.css","enhancements.css","manifest.json","service-worker.js"]);
http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  if(sources[pathname]){res.setHeader("Content-Type","text/plain; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(await readFile(resolve(root,sources[pathname])));return;}
  if(pathname==="/__mock__/sdk.js"){res.setHeader("Content-Type","text/javascript");res.end(await readFile(resolve(root,"tests/browser-mock-sdk.js")));return;}
  const mock=pathname.startsWith("/__mock__/");const relative=pathname.replace(/^\/__mock__\//,"").replace(/^\//,"")||"index.html";
  if(!allowed.has(relative)&&!/^images\/(logos|podpiska)\/[\w.-]+$/.test(relative)&&relative!=="icons/icon.svg")throw new Error("not found");
  let data=await readFile(resolve(root,relative));
  if(mock&&relative==="index.html")data=Buffer.from(data.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/__mock__/sdk.js').replace('<script src="enhancements.js"></script>',''));
  res.setHeader("Content-Type",types[extname(relative)]||"application/octet-stream");res.setHeader("Cache-Control","no-store");res.end(data);
 }catch{res.statusCode=404;res.end("Not found");}
}).listen(4173,"127.0.0.1",()=>console.log("Local test server: http://127.0.0.1:4173/__mock__/index.html"));
