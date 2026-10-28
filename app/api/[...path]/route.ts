import { handle } from '@/lib/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function route(req:Request,ctx:{params:Promise<{path:string[]}>}){return handle(req,(await ctx.params).path);}
export {route as GET,route as POST,route as PATCH,route as DELETE};
