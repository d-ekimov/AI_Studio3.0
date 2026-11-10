// One fixed destination for all text calls; credentials never appear in URLs.
export async function postGenapiChat(key,body,fetcher=fetch,timeout=90000) {
 return await fetcher("https://proxy.gen-api.ru/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+key,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:"error"});
}
