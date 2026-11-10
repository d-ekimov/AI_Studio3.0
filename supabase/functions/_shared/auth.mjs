// Shared user verification for the existing gateway and the research service.
export class AuthError extends Error { constructor(status,message){super(message);this.status=status;} }
export async function authenticatedUser(request,env,fetcher=fetch) {
 const authorization=request.headers.get("authorization")||"";
 if(!/^Bearer [\w.-]+$/.test(authorization))throw new AuthError(401,"Войди в аккаунт AI Studio.");
 const url=env("SUPABASE_URL"),key=env("SUPABASE_ANON_KEY");
 if(!url||!key)throw new AuthError(503,"Не настроено окружение Supabase.");
 const response=await fetcher(url+"/auth/v1/user",{headers:{authorization,apikey:key},signal:AbortSignal.timeout(10000),redirect:"error"});
 if(!response.ok)throw new AuthError(401,"Сессия истекла. Войди повторно.");
 const user=await response.json();if(!user.id)throw new AuthError(401,"Не удалось подтвердить пользователя.");
 if(!(env("GENAPI_ALLOWED_USER_IDS")||"").split(",").map(value=>value.trim()).includes(user.id))throw new AuthError(403,"Доступ к GenAPI ещё не включён для этого аккаунта.");
 if((user.factors||[]).some(f=>f.status==="verified")){
  let claims;try{const part=authorization.slice(7).split(".")[1];claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0))));}catch{throw new AuthError(401,"Некорректная сессия.");}
  if(claims.aal!=="aal2")throw new AuthError(403,"Подтверди вход кодом двухфакторной защиты.");
 }
 return {user,authorization,supabaseUrl:url,supabaseKey:key};
}
