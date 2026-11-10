import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { descriptor, hydrateAttachments, extractDocument, readBounded, checkSignature } from "../supabase/functions/genapi/attachments.mjs";
import { createHandler } from "../supabase/functions/genapi/index.ts";

const userId="11111111-1111-4111-8111-111111111111", otherId="22222222-2222-4222-8222-222222222222", chatId="33333333-3333-4333-8333-333333333333", fileId="44444444-4444-4444-8444-444444444444";
const mimes={txt:"text/plain",csv:"text/csv",png:"image/png",pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
const tools={unzipLoader:()=>import("fflate"),pdfLoader:()=>import("unpdf")};
function file(ext,bytes,extra={}){return {name:`test.${ext}`,mime:mimes[ext],size:bytes.length,path:`${userId}/chat/${chatId}/${fileId}.${ext}`,...extra};}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});}
function setup(bytes,ext="txt",options={}){
 const calls=[];const attachment=file(ext,bytes);
 const fetcher=async(url,init)=>{calls.push({url,init});if(url.includes("/rest/v1/"))return response(options.denied?[]:[{id:chatId}]);return new Response(bytes,{status:options.deleted?404:200});};
 return {attachment,calls,args:{userId,supabaseUrl:"https://project.supabase.co",supabaseKey:"public",authorization:"Bearer user-session",fetcher,tools}};
}
function office(ext,xml,extras={}){const entry={docx:"word/document.xml",xlsx:"xl/worksheets/sheet1.xml",pptx:"ppt/slides/slide1.xml"}[ext];return zipSync({"[Content_Types].xml":strToU8("<Types/>"),[entry]:strToU8(xml),...extras});}
function pdfFixture(text="Invoice 123 Total 42"){
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Count 1 /Kids [3 0 R] >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
 const stream=`BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 let pdf="%PDF-1.4\n",offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const offset=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
 return strToU8(pdf);
}
test("rejects foreign users, traversal, forged MIME and excessive size",()=>{
 const a=file("txt",strToU8("hello"));
 for(const bad of [{...a,path:a.path.replace(userId,otherId)},{...a,path:a.path.replace("/chat/","/../")},{...a,mime:"text/html"},{...a,size:11*1024*1024}])assert.throws(()=>descriptor(bad,userId));
});
test("private download checks parent ownership before reading bytes",async()=>{
 const f=setup(strToU8("hello"),"txt",{denied:true});
 await assert.rejects(()=>hydrateAttachments([{role:"user",content:"analyse",attachments:[f.attachment]}],"gemini",f.args),/Нет доступа/);
 assert.equal(f.calls.length,1);
});
test("text/CSV extraction preserves structured input and handles a missing object",async()=>{
 for(const ext of["txt","csv"]){const f=setup(strToU8("name,total\nA,42"),ext);const out=await hydrateAttachments([{role:"user",content:"sum",attachments:[f.attachment]}],"deepseek",f.args);assert.match(out[0].content[1].text,/A,42/);assert.ok(f.calls.every(c=>c.init.headers.authorization==="Bearer user-session"));}
 const f=setup(strToU8("gone"),"txt",{deleted:true});await assert.rejects(()=>hydrateAttachments([{role:"user",content:"sum",attachments:[f.attachment]}],"gemini",f.args),/удалено/);
});
test("multiple images become inline Vision parts for all three models",async()=>{
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,...Array(16).fill(0)]);
 for(const model of["chatgpt","deepseek","gemini"]){const f=setup(png,"png");const second={...f.attachment,path:f.attachment.path.replace(fileId,"55555555-5555-4555-8555-555555555555")};const out=await hydrateAttachments([{role:"user",content:"compare",attachments:[f.attachment,second]}],model,f.args);assert.equal(out[0].content.filter(p=>p.type==="image_url").length,2);assert.match(out[0].content[1].image_url.url,/^data:image\/png;base64,/);assert.equal(f.calls.filter(c=>c.url.includes("/rest/v1/")).length,1);}
});
test("checks signatures and streams actual file size",async()=>{
 assert.throws(()=>checkSignature({...file("pdf",strToU8("fake")),ext:"pdf"},strToU8("fake")),/не соответствует/);
 await assert.rejects(()=>readBounded(new Response(strToU8("12345")),4),/размер/);
 const f=setup(strToU8("123"));f.attachment.size=2;await assert.rejects(()=>hydrateAttachments([{role:"user",content:"x",attachments:[f.attachment]}],"gemini",f.args),/Размер/);
});
test("extracts DOCX paragraphs, XLSX cell addresses/values and PPTX slides",async()=>{
 const cases=[
  ["docx",office("docx","<w:document><w:p><w:r><w:t>Договор &amp; сумма 42</w:t></w:r></w:p></w:document>"),/Договор & сумма 42/],
  ["xlsx",office("xlsx",'<worksheet><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1"><f>1+1</f></c></row></worksheet>',{"xl/sharedStrings.xml":strToU8("<sst><si><t>Доход</t></si></sst>")}),/A1 = Доход[\s\S]*B1 = 42[\s\S]*формула без/],
  ["pptx",office("pptx","<p:sld><a:p><a:r><a:t>Quarterly report</a:t></a:r></a:p></p:sld>"),/Слайд 1:[\s\S]*Quarterly report/],
 ];
 for(const[ext,bytes,expected]of cases){const data=descriptor(file(ext,bytes),userId);assert.match(await extractDocument(data,bytes,tools),expected);}
});
test("rejects Office macros, XML entities, wrong containers and oversized expanded entries",async()=>{
 const samples=[office("docx","<!DOCTYPE a [<!ENTITY b SYSTEM 'file:///etc/passwd'>]><w:t>&b;</w:t>"),office("docx","<w:t>x</w:t>",{"word/vbaProject.bin":strToU8("macro")}),office("xlsx","<worksheet/>"),office("docx","x".repeat(9*1024*1024))];
 for(const bytes of samples)await assert.rejects(()=>extractDocument(descriptor(file("docx",bytes),userId),bytes,tools));
});
test("extracts a real PDF for DeepSeek; sends native PDF to GPT/Gemini",async()=>{
 const bytes=pdfFixture();
 const extracted=await extractDocument(descriptor(file("pdf",bytes),userId),bytes,tools);assert.match(extracted,/Invoice 123 Total 42/);
 for(const model of["chatgpt","gemini"]){const f=setup(bytes,"pdf");const out=await hydrateAttachments([{role:"user",content:"analyse",attachments:[f.attachment]}],model,f.args);assert.equal(out[0].content[1].type,"file");assert.match(out[0].content[1].file.file_data,/^data:application\/pdf;base64,/);}
 const f=setup(bytes,"pdf");const out=await hydrateAttachments([{role:"user",content:"analyse",attachments:[f.attachment]}],"deepseek",f.args);assert.equal(out[0].content[1].type,"text");assert.match(out[0].content[1].text,/Invoice/);
});
test("scanned PDF cannot silently become empty context for a text-only file path",async()=>{
 const bytes=pdfFixture("");const f=setup(bytes,"pdf");await assert.rejects(()=>hydrateAttachments([{role:"user",content:"analyse",attachments:[f.attachment]}],"deepseek",f.args),/нет извлекаемого текста/);
});
test("gateway expands private attachments without exposing storage auth to GenAPI",async()=>{
 const bytes=strToU8("private document 42"),calls=[];
 const env={SUPABASE_URL:"https://project.supabase.co",SUPABASE_ANON_KEY:"public",GENAPI_API_KEY:"fake-provider-key",GENAPI_ALLOWED_USER_IDS:userId,GENAPI_ALLOWED_ORIGINS:"https://studio.example"};
 const handler=createHandler({env:n=>env[n],attachmentTools:tools,fetcher:async(url,init)=>{calls.push({url,init});if(url.endsWith("/auth/v1/user"))return response({id:userId});if(url.includes("/rest/v1/"))return response([{id:chatId}]);if(url.includes("/storage/v1/"))return new Response(bytes);return response({choices:[{message:{content:"42"}}]});}});
 const r=await handler(new Request("https://project.supabase.co/functions/v1/genapi",{method:"POST",headers:{Origin:"https://studio.example",Authorization:"Bearer user.jwt.token"},body:JSON.stringify({action:"chat",model:"gemini",messages:[{role:"user",content:"analyse",attachments:[file("txt",bytes)]}]})}));
 assert.equal(r.status,200);const upstream=calls.at(-1);assert.equal(upstream.init.headers.Authorization,"Bearer fake-provider-key");assert.match(upstream.init.body,/private document 42/);assert.ok(!upstream.init.body.includes("user.jwt.token"));assert.ok(!JSON.stringify(await r.json()).includes("fake-provider-key"));
});
