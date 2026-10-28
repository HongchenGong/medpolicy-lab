import { randomBytes } from 'node:crypto';
import type { SeedConfig } from '../lib/seed-config';
export const MEMBERS:Array<[string,string]>=Array.from({length:12},(_,i)=>[i===0?'测试组长':'测试成员'+i,'0'+String(100000000+i)]);
export const memberPassword=randomBytes(18).toString('base64url');
export const testConfig:SeedConfig={members:MEMBERS,memberPassword};
