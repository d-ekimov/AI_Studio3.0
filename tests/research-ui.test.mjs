import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function fixture(search="?research_preview=1"){
 class Element{
  constructor(tag="div"){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.value="";this._text="";}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join("");}
  append(...children){this.children.push(...children);}appendChild(child){this.append(child);}replaceChildren(...children){this._text="";this.children=[...children];}
  setAttribute(name,value){this.attributes[name]=value;}addEventListener(name,fn){this.listeners[name]=fn;}before(element){this.previous=element;}
 }
 const storage=new Map(),calls=[];let ready=false;
 const document={createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element("#text");node.textContent=text;return node;}};
 const supabase={functions:{invoke:async(name,{body})=>{assert.equal(name,"research");calls.push(body);
  if(body.action==="create")return{data:{id:"research-id"}};
  if(body.action==="step"){ready=true;return{data:{accepted:true}};}
  if(body.action==="status")return{data:{status:ready?"ready":"queued",events:[{message:"Progress"}],sources:[{label:"S1",title:"Source",url:"https://example.org/"}],spent:ready?2:0,budget:2}};
  return{data:{status:"cancelled"}};
 }}};
 const sandbox={window:{location:{search}},document,URL,URLSearchParams,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setTimeout:fn=>{fn();return 1;}};
 vm.runInNewContext(readFileSync(new URL("../research-client.js",import.meta.url),"utf8"),sandbox);
 const ui=sandbox.window.AIStudioResearch.create(supabase),form=new Element("form"),composer=ui.mount(form,"chat","chat");
 return{ui,form,composer,calls,Element};
}
test("research composer persists the job link before advancing and reuses its saved request",async()=>{
 const f=fixture(),select=f.form.previous.children[0].children[0];select.value="web";
 let linked=0;const options={userId:"owner",chatId:"chat",messageId:"message",prompt:"Question",onCreated:async()=>{assert.ok(!f.calls.some(call=>call.action==="step")||linked>0);linked++;}};
 assert.equal(await f.composer.prepare(options),"research-id");assert.equal(await f.composer.prepare(options),"research-id");
 assert.equal(f.calls.filter(call=>call.action==="create").length,1);assert.equal(f.calls.filter(call=>call.action==="step").length,1);assert.equal(linked,2);
});
test("search controls stay hidden until live preview is explicitly enabled",()=>{assert.equal(fixture("").form.previous.hidden,true);assert.equal(fixture().form.previous.hidden,false);});

test("resume reuses the receipt while an explicitly paid retry does not create another search",async()=>{
 for(const index of[0,1]){
  const f=fixture(),received=[];f.composer.offerResume("saved-job",async(...args)=>received.push(args));
  const buttons=f.form.previous.children[2].children[2].children;
  await buttons[index].listeners.click();
  assert.deepEqual(received[0],["saved-job",index===1]);assert.equal(f.calls.length,0);
 }
});
test("citation rendering links only safe stored URLs and treats source content as text",()=>{
 const f=fixture(),container=new f.Element();f.ui.renderAnswer({content:"Claim [S1] <script>bad()</script> [S99]",citations:[{label:"S1",title:"Source",url:"https://example.org/",quote:"<img src=x onerror=bad()>"},{label:"S99",title:"Bad",url:"javascript:bad()",quote:"Not a URL"}]},container);
 const nodes=[];function walk(node){nodes.push(node);node.children.forEach(walk);}walk(container);
 const links=nodes.filter(node=>node.tag==="a");assert.ok(links.length>=1);assert.ok(links.every(link=>link.href==="https://example.org/"));assert.ok(links.every(link=>link.rel==="noopener noreferrer"));
 assert.ok(!nodes.some(node=>node.tag==="script"||node.tag==="img"));assert.match(container.textContent,/<script>/);
});
