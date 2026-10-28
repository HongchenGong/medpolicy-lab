import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const seedConfigSchema=z.object({
 members:z.array(z.tuple([z.string().min(1).max(50),z.string().regex(/^\d{10}$/)])).length(12),
 memberPassword:z.string().min(6).max(128)
}).refine(c=>new Set(c.members.map(m=>m[1])).size===12,'账号必须唯一');
export type SeedConfig=z.infer<typeof seedConfigSchema>;
export function loadSeedConfig():SeedConfig {
 const raw=process.env.SEED_CONFIG_JSON || readFileSync(path.resolve(process.env.SEED_CONFIG_FILE || './data/seed-config.private.json'),'utf8');
 return seedConfigSchema.parse(JSON.parse(raw));
}
