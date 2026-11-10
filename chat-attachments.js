/* Private attachment UI. Only metadata is stored in messages; bytes stay in Supabase Storage. */
(() => {
  const BUCKET = "chat-attachments", MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024;
  const MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", pdf:"application/pdf", txt:"text/plain", csv:"text/csv", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  const extension = name => name.toLowerCase().split(".").pop();
  function validate(file) {
    const ext = extension(file.name);
    if (!MIME[ext]) throw new Error(`«${file.name}»: этот формат не поддерживается.`);
    if (!file.size || file.size > MAX_FILE) throw new Error(`«${file.name}»: допустимый размер — от 1 байта до 10 МБ.`);
    if (file.name.length > 255) throw new Error("Название файла слишком длинное (максимум 255 символов).");
    // Some OSes provide an empty or generic MIME for valid Office/text files.
    if (file.type && ![MIME[ext], "application/octet-stream", "application/zip", "text/plain", "application/vnd.ms-excel"].includes(file.type)) throw new Error(`«${file.name}»: тип файла не соответствует расширению.`);
    return ext;
  }
  async function normalize(file) {
    const ext = validate(file);
    if (!MIME[ext].startsWith("image/")) return { blob:file, ext, note:"" };
    const header = new Uint8Array(await file.slice(0,16).arrayBuffer());
    const text = String.fromCharCode(...header);
    const valid = ext === "png" ? header.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v) :
      ["jpg","jpeg"].includes(ext) ? header[0]===255&&header[1]===216&&header[2]===255 :
      ext === "webp" ? text.startsWith("RIFF")&&text.slice(8,12)==="WEBP" : /^GIF8[79]a/.test(text);
    if(!valid)throw new Error(`«${file.name}»: содержимое не соответствует формату изображения.`);
    const url = URL.createObjectURL(file), image = new Image();
    try {
      await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=() => reject(new Error(`«${file.name}»: изображение не удалось прочитать.`)); image.src=url; });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw new Error("Изображение превышает 40 мегапикселей.");
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const context = canvas.getContext("2d");
      const outputExt = ext === "png" || ext === "gif" ? "png" : "jpg";
      if (outputExt === "jpg") { context.fillStyle="#fff"; context.fillRect(0,0,canvas.width,canvas.height); }
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,MIME[outputExt],0.9));
      if (!blob || blob.size > MAX_FILE) throw new Error("Подготовленное изображение слишком большое.");
      return { blob, ext:outputExt, note:ext === "gif" ? "GIF: отправляется первый кадр" : scale < 1 ? "Уменьшено до 2048 px" : "" };
    } finally { URL.revokeObjectURL(url); }
  }
  function create(supabase) {
    const storage = supabase.storage.from(BUCKET);
    function mount({ button, input, preview, status }) {
      const items=[]; let locked=false, preparing=0, pending=Promise.resolve();
      const message = text => { status.textContent=text; };
      const render = () => {
        preview.replaceChildren();
        for (const item of items) {
          const card=document.createElement("div"); card.className="attachment-card";
          if (item.blob.type.startsWith("image/")) { const image=document.createElement("img"); image.src=item.preview; image.alt=item.name; card.appendChild(image); }
          const info=document.createElement("span"); const name=document.createElement("strong"); name.textContent=item.name;
          const detail=document.createElement("small"); detail.textContent=`${extension(item.name).toUpperCase()} · ${Math.ceil(item.blob.size/1024)} КБ${item.note ? " · "+item.note : ""}`;
          info.append(name,detail); const remove=document.createElement("button"); remove.type="button"; remove.textContent="×"; remove.disabled=locked; remove.setAttribute("aria-label",`Удалить ${item.name}`);
          remove.addEventListener("click",async()=>{
            if (locked || remove.disabled) return;
            remove.disabled=true;
            try {
              if (item.metadata) { const {error}=await storage.remove([item.metadata.path]); if(error) throw error; }
              items.splice(items.indexOf(item),1); URL.revokeObjectURL(item.preview); render(); message("");
            } catch { remove.disabled=false; message("Не удалось удалить загруженное вложение. Попробуй ещё раз."); }
          });
          card.append(info,remove); preview.appendChild(card);
        }
      };
      button.addEventListener("click",()=>{if(!locked)input.click();});
      input.addEventListener("change",()=>{
        const selected=[...input.files]; input.value=""; preparing+=selected.length;
        pending=pending.then(async()=>{
          const errors=[];
          for (const file of selected) {
            try {
              if(items.length>=4)throw new Error("К сообщению можно добавить максимум четыре файла.");
              message(`Подготавливаем «${file.name}»…`);
              const prepared=await normalize(file);
              if(items.reduce((sum,item)=>sum+item.blob.size,0)+prepared.blob.size>MAX_TOTAL)throw new Error("Общий размер вложений превышает 20 МБ.");
              const blob=prepared.blob.type===MIME[prepared.ext] ? prepared.blob : new Blob([prepared.blob],{type:MIME[prepared.ext]});
              items.push({...prepared,blob,name:file.name,id:crypto.randomUUID(),preview:URL.createObjectURL(blob)}); render();
            } catch(error) { errors.push(error.message); }
            finally { preparing--; }
          }
          message(errors.join(" ") || (items.length ? `Файлов выбрано: ${items.length}. Они будут переданы GenAPI вместе с запросом.` : ""));
        });
      });
      return {
        count:()=>items.length+preparing,
        ready:()=>pending,
        lock(value){locked=value;button.disabled=value;input.disabled=value;render();},
        async upload(userId,kind,chatId) {
          await pending; const created=[];
          try {
            for(const [index,item] of items.entries()) {
              const path=`${userId}/${kind}/${chatId}/${item.id}.${item.ext}`;
              if(item.metadata?.path===path)continue;
              if(item.metadata)throw new Error("Вложения уже загружены в другой диалог. Удали их из списка и выбери снова.");
              message(`Загружаем файл ${index+1} из ${items.length}…`);
              const {error}=await storage.upload(path,item.blob,{contentType:MIME[item.ext],upsert:false});
              if(error)throw new Error("Не удалось загрузить файл в Supabase. Проверь соединение и настройку приватного Storage.");
              item.metadata={id:item.id,name:item.name,mime:MIME[item.ext],size:item.blob.size,path}; created.push(item);
            }
            message(items.length ? "Вложения загружены. Получаем ответ модели…" : "");
            return items.map(item=>({...item.metadata}));
          } catch(error) {
            if(created.length){const {error:cleanupError}=await storage.remove(created.map(item=>item.metadata.path));if(!cleanupError)created.forEach(item=>{item.metadata=null;});}
            message(error.message);throw error;
          }
        },
        clear(){for(const item of items)URL.revokeObjectURL(item.preview);items.length=0;render();message("");},
      };
    }
    function renderSaved(files,parent) {
      if(!Array.isArray(files)||!files.length)return;
      const list=document.createElement("div");list.className="saved-attachments";
      for(const file of files) {
        const card=document.createElement("div");card.className="attachment-card";
        const name=document.createElement("span");name.textContent=`${file.name} · ${Math.ceil(file.size/1024)} КБ`;
        const download=document.createElement("button");download.type="button";download.className="outline-btn";download.textContent="Скачать";
        download.addEventListener("click",async()=>{
          download.disabled=true;
          try { const {data,error}=await storage.download(file.path);if(error)throw error;const url=URL.createObjectURL(data);const link=document.createElement("a");link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000); }
          catch { name.textContent=`${file.name} · Файл недоступен или удалён`; }
          finally {download.disabled=false;}
        });
        if(file.mime?.startsWith("image/")) {
          const image=document.createElement("img");image.alt=file.name;image.loading="lazy";card.appendChild(image);
          storage.createSignedUrl(file.path,120).then(({data,error})=>{if(!error&&data?.signedUrl)image.src=data.signedUrl;else image.alt="Изображение недоступно";}).catch(()=>{image.alt="Изображение недоступно";});
        }
        card.append(name,download);list.appendChild(card);
      }
      parent.appendChild(list);
    }
    async function removeChatFiles(userId,kind,chatId) {
      const folder=`${userId}/${kind}/${chatId}`,paths=[];let complete=false;
      for(let offset=0;offset<10000;offset+=100){const {data,error}=await storage.list(folder,{limit:100,offset});if(error)throw new Error("Не удалось проверить вложения перед удалением чата.");for(const item of data||[])if(item.id)paths.push(`${folder}/${item.name}`);if((data||[]).length<100){complete=true;break;}}
      if(!complete)throw new Error("Чат содержит слишком много файлов для удаления одним действием.");
      for(let i=0;i<paths.length;i+=100){const {error}=await storage.remove(paths.slice(i,i+100));if(error)throw new Error("Не удалось удалить вложения чата.");}
    }
    async function removeAllChatFiles(userId,kind,table) {
      for(let offset=0;offset<100000;offset+=100){
        const {data,error}=await supabase.from(table).select("id").eq("user_id",userId).order("id").range(offset,offset+99);
        if(error)throw new Error("Не удалось проверить список чатов перед удалением файлов.");
        for(const chat of data||[])await removeChatFiles(userId,kind,chat.id);
        if((data||[]).length<100)return;
      }
      throw new Error("Слишком много диалогов для массового удаления.");
    }
    return {mount,renderSaved,removeChatFiles,removeAllChatFiles};
  }
  window.AIStudioAttachments={create,validate,normalize,MIME,MAX_FILE,MAX_TOTAL};
})();
