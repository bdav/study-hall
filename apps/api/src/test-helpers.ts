import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { createCards, type NewCard } from './services/cards.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
config({ path: `${projectRoot}.env` });

/**
 * Creates an isolated test database using a unique Postgres schema.
 * Each test suite gets its own schema that is dropped on teardown.
 */
export function createTestPrisma() {
  const schemaName = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const testUrl = `${baseUrl}?schema=${schemaName}`;

  // Create the schema and apply migrations
  execSync(`pnpm prisma migrate deploy`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  const adapter = new PrismaPg(
    { connectionString: baseUrl },
    { schema: schemaName },
  );
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    async cleanup() {
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
      );
      await prisma.$disconnect();
    },
  };
}

/**
 * Creates a deck with cards the way the app does: each card gets a primary
 * canonical answer and NEW card progress for the deck owner.
 */
export async function createDeckWithCards(
  prisma: PrismaClient,
  {
    userId,
    name = 'Test Deck',
    cards = [],
  }: { userId: string; name?: string; cards?: NewCard[] },
) {
  const deck = await prisma.deck.create({ data: { name, userId } });
  const created = await createCards(prisma, {
    deckId: deck.id,
    userId,
    cards,
  });
  return { ...deck, cards: created };
}
