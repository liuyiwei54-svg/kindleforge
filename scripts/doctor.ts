#!/usr/bin/env tsx
/**
 * KindleForge doctor — is this machine ready to convert?
 *
 * Checks Node, platform, optional engines (calibre / pandoc / tesseract),
 * the temp volume (2GB floor), that tmp files can be written 0600, and whether
 * the conversion engine module is present.
 *
 * Exit codes:
 *   0  hard requirements satisfied (missing optional engines are warnings)
 *   1  a hard requirement failed (Node too old, tmp unwritable, <2GB free)
 *   With --strict, missing optional engines or a missing engine module also
 *   exits 1 (CI/full-feature environments use this).
 *
 * Usage: npx tsx scripts/doctor.ts [--strict] [--json]
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_ENV_KEYS,
  config,
  humanBytes,
  humanDuration,
} from '../lib/server/config';
import { probeEngines, type EngineDetail } from '../lib/server/engines';
import { MIN_FREE_BYTES, TMP_ROOT, freeBytes, safeFileName } from '../lib/server/storage';

const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

interface Check {
  ok: boolean;
  hard: boolean;
  label: string;
  detail: string;
}

function gb(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'unknown';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function checkNode(): Promise<Check> {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 20;
  return {
    ok,
    hard: true,
    label: 'Node.js',
    detail: `${process.versions.node} (${process.platform}/${process.arch}) ${ok ? '' : '— need >= 20'}`,
  };
}

async function checkTmp(): Promise<{ check: Check; probe?: Check }> {
  const free = await freeBytes(TMP_ROOT);
  const spaceOk = free >= MIN_FREE_BYTES;
  const check: Check = {
    ok: spaceOk,
    hard: true,
    label: 'Temp volume',
    detail: `${TMP_ROOT} (${tmpdir()}) — ${gb(free)} free${spaceOk ? '' : ' — need >= 2 GB for uploads'}`,
  };

  let probe: Check | undefined;
  try {
    await mkdir(TMP_ROOT, { recursive: true, mode: 0o700 });
    const name = safeFileName(`.doctor-${process.pid}`, '.doctor');
    const file = join(TMP_ROOT, name);
    await writeFile(file, 'ok', { mode: 0o600 });
    await rm(file, { force: true });
    probe = { ok: true, hard: true, label: 'Temp writable', detail: 'created a 0600 file and removed it' };
  } catch (error) {
    probe = {
      ok: false,
      hard: true,
      label: 'Temp writable',
      detail: error instanceof Error ? error.message : 'write failed',
    };
  }
  return { check, probe };
}

function engineCheck(detail: EngineDetail): Check {
  return {
    ok: detail.available,
    hard: false,
    label: detail.id,
    detail: detail.available
      ? `${detail.version ?? 'present'} — \`${detail.bin} --version\``
      : `not found — install: ${detail.install[0]}`,
  };
}

function engineModuleCheck(): Check {
  const candidates = ['lib/engine/index.ts', 'lib/engine/index.tsx', 'lib/engine/index.js'];
  const found = candidates.find((candidate) => existsSync(candidate));
  return {
    ok: Boolean(found),
    hard: false,
    label: 'Engine module',
    detail: found
      ? `${found} present (builtin TXT/MD/HTML → EPUB available)`
      : 'lib/engine/index.ts missing — builtin conversions cannot run yet',
  };
}

function configRows(): Array<[string, string]> {
  const rate = `IP ${config.rateLimitPerHour}/h · direct/local ${config.rateLimitLocalPerHour}/h`;
  return [
    ['upload cap', `${humanBytes(config.maxUploadBytes)}  (${CONFIG_ENV_KEYS.maxUploadBytes})`],
    ['job TTL', `${humanDuration(config.jobTtlMs)}  (${CONFIG_ENV_KEYS.jobTtlMs})`],
    ['timeout', `${humanDuration(config.convertTimeoutMs)}  (${CONFIG_ENV_KEYS.convertTimeoutMs})`],
    ['workers', `${config.maxConcurrency}  (${CONFIG_ENV_KEYS.maxConcurrency})`],
    ['rate limit', `${rate}  (${CONFIG_ENV_KEYS.rateLimitPerHour})`],
    ['min free disk', `${humanBytes(config.minFreeBytes)}  (${CONFIG_ENV_KEYS.minFreeBytes})`],
    ['orphan sweep', `> ${humanDuration(config.orphanMaxAgeMs)}  (${CONFIG_ENV_KEYS.orphanMaxAgeMs})`],
    ['trust proxy', `${config.trustProxy ? 'on' : 'off'}  (${CONFIG_ENV_KEYS.trustProxy})`],
  ];
}

function printConfig(): void {
  console.log('Configuration (effective):');
  const width = Math.max(...configRows().map(([label]) => label.length));
  for (const [label, value] of configRows()) {
    console.log(`  ${label.padEnd(width)}  ${value}`);
  }
}

function printChecks(checks: Check[]): void {
  const width = Math.max(...checks.map((check) => check.label.length));
  for (const check of checks) {
    const icon = check.ok ? 'OK  ' : check.hard ? 'FAIL' : 'WARN';
    console.log(`  [${icon}] ${check.label.padEnd(width)}  ${check.detail}`);
  }
}

async function main(): Promise<number> {
  const node = await checkNode();
  const tmp = await checkTmp();
  const engines = await probeEngines(true);

  const checks: Check[] = [
    node,
    tmp.check,
    ...(tmp.probe ? [tmp.probe] : []),
    ...engines.map(engineCheck),
    engineModuleCheck(),
  ];

  const failures = checks.filter((check) => check.hard && !check.ok);
  const warnings = checks.filter((check) => !check.hard && !check.ok);
  const strictFailures = strict ? warnings : [];
  const exitCode = failures.length + strictFailures.length > 0 ? 1 : 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          strict,
          node: process.versions.node,
          platform: `${process.platform}/${process.arch}`,
          tmpRoot: TMP_ROOT,
          freeBytes: await freeBytes(TMP_ROOT),
          config,
          engines: engines.map((engine) => ({
            id: engine.id,
            available: engine.available,
            version: engine.version ?? null,
            install: engine.install,
          })),
          checks: checks.map(({ label, ok, hard, detail }) => ({ label, ok, hard, detail })),
        },
        null,
        2,
      ),
    );
    return exitCode;
  }

  const line = '─'.repeat(64);
  console.log(`KindleForge doctor\n${line}`);
  console.log(`  Node      ${process.versions.node}`);
  console.log(`  Platform  ${process.platform}/${process.arch}`);
  console.log(`  tmp root  ${TMP_ROOT}`);
  console.log(line);
  printConfig();
  console.log(`${line}\nChecks:`);
  printChecks(checks);
  console.log(line);

  const missing = engines.filter((engine) => !engine.available);
  if (missing.length > 0) {
    console.log('Optional engines missing — the app still runs; these formats degrade:');
    for (const engine of missing) {
      console.log(`  • ${engine.id}: ${engine.install.join('  |  ')}`);
    }
    console.log(line);
  }

  if (exitCode === 0) {
    console.log(
      warnings.length > 0
        ? `Doctor: PASS (${warnings.length} warning${warnings.length === 1 ? '' : 's'}; use --strict to fail on them)`
        : 'Doctor: PASS — this machine is ready.',
    );
  } else {
    const reasons = [...failures, ...strictFailures].map((check) => check.label).join(', ');
    console.log(`Doctor: FAIL — ${reasons}`);
  }
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('Doctor crashed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
