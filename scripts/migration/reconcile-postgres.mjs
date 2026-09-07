#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

export function parseTableName(value) {
  const parts = String(value).split('.');
  if (parts.length !== 2 || parts.some((part) => !IDENTIFIER.test(part))) {
    throw new Error(`Table must be schema.table with safe identifiers: ${value}`);
  }
  return parts;
}

export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.tables) || manifest.tables.length === 0) {
    throw new Error('Reconciliation manifest must be version 1 with at least one table.');
  }
  const seen = new Set();
  for (const entry of manifest.tables) {
    parseTableName(entry.source);
    parseTableName(entry.target);
    if (!Array.isArray(entry.keys) || entry.keys.length === 0) throw new Error(`Missing keys for ${entry.source}`);
    entry.keys.forEach((key) => quoteIdentifier(key));
    const signature = `${entry.source}->${entry.target}`;
    if (seen.has(signature)) throw new Error(`Duplicate table mapping: ${signature}`);
    seen.add(signature);
  }
  return manifest;
}

export function buildKeyQuery(table, keys) {
  const [schema, name] = parseTableName(table);
  const columns = keys.map(quoteIdentifier).join(', ');
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  return `select ${columns} from ${qualified} order by ${columns}`;
}

function canonicalScalar(value) {
  if (value === null) return ['null', null];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (Buffer.isBuffer(value)) return ['buffer', value.toString('hex')];
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  return [typeof value, value];
}

export function keyToken(row, keys) {
  return JSON.stringify(keys.map((key) => canonicalScalar(row[key])));
}

export function compareKeyRows(sourceRows, targetRows, keys) {
  const sourceTokens = sourceRows.map((row) => keyToken(row, keys));
  const targetTokens = targetRows.map((row) => keyToken(row, keys));
  const sourceSet = new Set(sourceTokens);
  const targetSet = new Set(targetTokens);
  const sourceDuplicates = sourceTokens.length - sourceSet.size;
  const targetDuplicates = targetTokens.length - targetSet.size;
  const missingInTarget = [...sourceSet].filter((token) => !targetSet.has(token)).sort();
  const extraInTarget = [...targetSet].filter((token) => !sourceSet.has(token)).sort();
  const digest = (tokens) => createHash('sha256').update([...new Set(tokens)].sort().join('\n')).digest('hex');
  return {
    sourceCount: sourceRows.length,
    targetCount: targetRows.length,
    sourceDuplicateKeys: sourceDuplicates,
    targetDuplicateKeys: targetDuplicates,
    sourceKeyDigest: digest(sourceTokens),
    targetKeyDigest: digest(targetTokens),
    missingInTarget,
    extraInTarget,
    matches: sourceDuplicates === 0 && targetDuplicates === 0 && missingInTarget.length === 0 && extraInTarget.length === 0,
  };
}

export function assertDifferentDatabases(sourceUrl, targetUrl) {
  const normalize = (raw) => {
    const url = new URL(raw);
    return `${url.protocol}//${url.username}@${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
  };
  if (normalize(sourceUrl) === normalize(targetUrl)) {
    throw new Error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL resolve to the same database identity.');
  }
}

async function readKeys(client, table, keys) {
  const result = await client.query(buildKeyQuery(table, keys));
  return result.rows;
}

async function withReadOnlyTransaction(client, fn) {
  await client.query('begin transaction read only');
  try {
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export async function reconcile({ sourceClient, targetClient, manifest }) {
  validateManifest(manifest);
  const tables = [];
  for (const entry of manifest.tables) {
    try {
      const [sourceRows, targetRows] = await Promise.all([
        withReadOnlyTransaction(sourceClient, () => readKeys(sourceClient, entry.source, entry.keys)),
        withReadOnlyTransaction(targetClient, () => readKeys(targetClient, entry.target, entry.keys)),
      ]);
      tables.push({ ...entry, status: 'ok', ...compareKeyRows(sourceRows, targetRows, entry.keys) });
    } catch (error) {
      tables.push({ ...entry, status: 'error', matches: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const mismatches = tables.filter((table) => !table.matches);
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    tableCount: tables.length,
    matchingTableCount: tables.length - mismatches.length,
    mismatchCount: mismatches.length,
    matches: mismatches.length === 0,
    tables,
    excluded: manifest.excluded ?? [],
  };
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL; never commit credentials.');
  assertDifferentDatabases(sourceUrl, targetUrl);

  const manifestPath = process.env.RECONCILIATION_MANIFEST ?? 'scripts/migration/reconciliation-manifest.json';
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const { Client } = await import('pg');
  const sourceClient = new Client({ connectionString: sourceUrl, application_name: 'sea-n-shore-reconcile-source' });
  const targetClient = new Client({ connectionString: targetUrl, application_name: 'sea-n-shore-reconcile-target' });
  await Promise.all([sourceClient.connect(), targetClient.connect()]);
  try {
    const report = await reconcile({ sourceClient, targetClient, manifest });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (process.env.RECONCILIATION_OUTPUT) await writeFile(process.env.RECONCILIATION_OUTPUT, output, { mode: 0o600 });
    process.stdout.write(output);
    if (!report.matches) process.exitCode = 2;
  } finally {
    await Promise.allSettled([sourceClient.end(), targetClient.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
