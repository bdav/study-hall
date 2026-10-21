import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// The API runs from apps/api, but .env lives at the repo root.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
