// Browser tests only: synthetic account, local storage, no external requests or provider charges.
(() => {
  const KEY="aistudio_browser_fixture_v1";
  const state=JSON.parse(localStorage.getItem(KEY)||'{"rows":{},"files":{}}');
  const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
  const user={id:"11111111-1111-4111-8111-111111111111",email:"fixture@example.test",user_metadata:{profile_name:"Тестовый аккаунт"}};
  function query(table){
    let mode="select",payload,filters=[],sort=null,ascending=true,max=Infinity,offset=0;
    const execute=()=>{
      state.rows[table]||=[];
      if(mode==="insert"){const added=(Array.isArray(payload)?payload:[payload]).map(row=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...row}));state.rows[table].push(...added);save();return{data:added};}
      let data=state.rows[table].filter(row=>filters.every(fn=>fn(row)));
      if(mode==="update"){data.forEach(row=>Object.assign(row,payload));save();}
      if(mode==="delete"){state.rows[table]=state.rows[table].filter(row=>!data.includes(row));save();}
      if(sort)data=[...data].sort((a,b)=>(String(a[sort]).localeCompare(String(b[sort])))*(ascending?1:-1));
      return{data:data.slice(offset,offset+max)};
    };
    const builder={select(){return builder;},insert(value){mode="insert";payload=value;return builder;},update(value){mode="update";payload=value;return builder;},delete(){mode="delete";return builder;},eq(key,value){filters.push(row=>row[key]===value);return builder;},in(key,values){filters.push(row=>values.includes(row[key]));return builder;},order(key,opts={}){sort=key;ascending=opts.ascending!==false;return builder;},limit(value){max=value;return builder;},range(a,b){offset=a;max=b-a+1;return builder;},async single(){return{data:execute().data[0]};},async maybeSingle(){return{data:execute().data[0]||null};},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
    return builder;
  }
  const storage={
    async upload(path,blob){const bytes=new Uint8Array(await blob.arrayBuffer());let str="";for(const b of bytes)str+=String.fromCharCode(b);state.files[path]={data:btoa(str),type:blob.type};save();return{data:{path}};},
    async createSignedUrl(path){const file=state.files[path];return file?{data:{signedUrl:`data:${file.type};base64,${file.data}`}}:{error:{message:"missing"}};},
    async download(path){const file=state.files[path];return file?{data:new Blob([Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))],{type:file.type})}:{error:{message:"missing"}};},
    async remove(paths){for(const path of paths)delete state.files[path];save();return{data:[]};},
    async list(folder,{limit=100,offset=0}={}){return{data:Object.keys(state.files).filter(p=>p.startsWith(folder+"/")).slice(offset,offset+limit).map(p=>({id:p,name:p.slice(folder.length+1)}))};},
  };
  const client={from:query,auth:{async getSession(){return{data:{session:{user}}};},mfa:{async getAuthenticatorAssuranceLevel(){return{data:{currentLevel:"aal1",nextLevel:"aal1"}};}}},storage:{from:()=>storage},functions:{async invoke(_name,{body}){if(body.action==="health")return{data:{ready:true}};return{data:{content:`Тест интерфейса: ${body.model}. Файлов в контексте: ${body.messages.reduce((sum,m)=>sum+(m.attachments?.length||0),0)}.`,model:body.model}};}}};
  window.supabase={createClient:()=>client};
})();
