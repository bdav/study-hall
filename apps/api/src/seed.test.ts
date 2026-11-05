import { spawnSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, projectRoot } from './test-helpers.js';

describe('the seed', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.cleanup();
  });

  it('refuses to run in production, leaving the database as it was', async () => {
    await database.prisma.user.create({
      data: { email: 'learner@example.com', passwordHash: 'unchanged' },
    });

    const seed = spawnSync('pnpm', ['db:seed'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: database.url,
      },
      encoding: 'utf8',
    });

    expect(seed.status).not.toBe(0);
    expect(seed.stderr).toContain('Refusing to seed');
    expect(seed.stderr).toContain('production');
    const users = await database.prisma.user.findMany();
    expect(users.map((user) => user.email)).toEqual(['learner@example.com']);
    expect(await database.prisma.deck.count()).toBe(0);
  }, 60_000);
});
