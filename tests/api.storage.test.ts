import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TMP_ROOT, sweepOrphanJobDirs } from '../lib/server/storage';

const created: string[] = [];

async function makeDir(id: string = randomUUID(), ageMs = 0): Promise<string> {
  const dir = join(TMP_ROOT, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (ageMs > 0) {
    const at = new Date(Date.now() - ageMs);
    await utimes(dir, at, at);
  }
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('boot orphan sweep', () => {
  it('removes only directories older than the age threshold', async () => {
    const oldDir = await makeDir(randomUUID(), 25 * 60 * 60 * 1000);
    const freshDir = await makeDir(randomUUID(), 0);
    const now = Date.now();

    const result = await sweepOrphanJobDirs(24 * 60 * 60 * 1000, now);
    expect(result.removed).toContain(oldDir.split('/').pop());
    expect(result.removed).not.toContain(freshDir.split('/').pop());
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
  });

  it('never touches non-directories or protected active ids', async () => {
    const oldDir = await makeDir(randomUUID(), 30 * 60 * 60 * 1000);
    const protectedDir = await makeDir(randomUUID(), 30 * 60 * 60 * 1000);
    const strayFile = join(TMP_ROOT, `stray-${randomUUID()}.txt`);
    await writeFile(strayFile, 'not a job dir');

    try {
      const result = await sweepOrphanJobDirs(
        24 * 60 * 60 * 1000,
        Date.now(),
        [protectedDir.split('/').pop() ?? ''],
      );
      expect(result.removed).toContain(oldDir.split('/').pop());
      expect(result.removed).not.toContain(protectedDir.split('/').pop());
      expect(existsSync(protectedDir)).toBe(true);
      expect(existsSync(strayFile)).toBe(true);
      expect(result.scanned).toBeGreaterThan(0);
      expect(result.kept).toBeGreaterThan(0);
    } finally {
      await rm(strayFile, { force: true });
    }
  });

  it('also removes stale legacy (non-UUID) directories inside its own root', async () => {
    const legacyDir = await makeDir('legacy-old-job', 26 * 60 * 60 * 1000);
    const result = await sweepOrphanJobDirs(24 * 60 * 60 * 1000, Date.now());
    expect(result.removed).toContain('legacy-old-job');
    expect(existsSync(legacyDir)).toBe(false);
  });
});
