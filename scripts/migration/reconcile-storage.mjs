#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

export function normalizeSourceObject(object) {
  const bucket = normalizePath(object.bucket_id ?? object.bucket ?? '');
  const name = normalizePath(object.name ?? object.path ?? '');
  if (!bucket || !name) throw new Error('Source storage object requires bucket_id/bucket and name/path.');
  const size = object.size == null ? null : Number(object.size);
  if (size !== null && (!Number.isFinite(size) || size < 0)) throw new Error(`Invalid source object size: ${object.size}`);
  return { key: `${bucket}/${name}`, size };
}

export function normalizeTargetObject(object) {
  const key = normalizePath(object.key ?? object.Key ?? '');
  if (!key) throw new Error('Target S3 object requires key/Key.');
  const rawSize = object.size ?? object.Size ?? null;
  const size = rawSize == null ? null : Number(rawSize);
  if (size !== null && (!Number.isFinite(size) || size < 0)) throw new Error(`Invalid target object size: ${rawSize}`);
  return { key, size };
}

export function compareStorage(sourceObjects, targetObjects) {
  const source = new Map();
  const target = new Map();
  const duplicateSourceKeys = [];
  const duplicateTargetKeys = [];

  for (const raw of sourceObjects) {
    const item = normalizeSourceObject(raw);
    if (source.has(item.key)) duplicateSourceKeys.push(item.key);
    source.set(item.key, item);
  }
  for (const raw of targetObjects) {
    const item = normalizeTargetObject(raw);
    if (target.has(item.key)) duplicateTargetKeys.push(item.key);
    target.set(item.key, item);
  }

  const missingInTarget = [];
  const extraInTarget = [];
  const sizeMismatches = [];
  for (const [key, sourceItem] of source) {
    const targetItem = target.get(key);
    if (!targetItem) {
      missingInTarget.push(key);
      continue;
    }
    if (sourceItem.size !== null && targetItem.size !== null && sourceItem.size !== targetItem.size) {
      sizeMismatches.push({ key, sourceSize: sourceItem.size, targetSize: targetItem.size });
    }
  }
  for (const key of target.keys()) if (!source.has(key)) extraInTarget.push(key);

  missingInTarget.sort();
  extraInTarget.sort();
  duplicateSourceKeys.sort();
  duplicateTargetKeys.sort();
  sizeMismatches.sort((a, b) => a.key.localeCompare(b.key));

  return {
    sourceCount: sourceObjects.length,
    targetCount: targetObjects.length,
    duplicateSourceKeys,
    duplicateTargetKeys,
    missingInTarget,
    extraInTarget,
    sizeMismatches,
    retryKeys: [...new Set([...missingInTarget, ...sizeMismatches.map((item) => item.key)])].sort(),
    matches:
      duplicateSourceKeys.length === 0 &&
      duplicateTargetKeys.length === 0 &&
      missingInTarget.length === 0 &&
      sizeMismatches.length === 0,
  };
}

function extractArray(document, preferredKeys) {
  if (Array.isArray(document)) return document;
  for (const key of preferredKeys) if (Array.isArray(document?.[key])) return document[key];
  throw new Error(`Expected an array or one of: ${preferredKeys.join(', ')}`);
}

async function main() {
  const sourcePath = process.env.SOURCE_STORAGE_INVENTORY;
  const targetPath = process.env.TARGET_S3_INVENTORY;
  if (!sourcePath || !targetPath) {
    throw new Error('Set SOURCE_STORAGE_INVENTORY and TARGET_S3_INVENTORY to read-only JSON inventory files.');
  }
  const sourceDocument = JSON.parse(await readFile(sourcePath, 'utf8'));
  const targetDocument = JSON.parse(await readFile(targetPath, 'utf8'));
  const source = extractArray(sourceDocument, ['objects', 'sourceObjects']);
  const target = extractArray(targetDocument, ['objects', 'Contents', 'targetObjects']);
  const result = compareStorage(source, target);
  const report = { generatedAt: new Date().toISOString(), readOnly: true, ...result };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.STORAGE_RECONCILIATION_OUTPUT) {
    await writeFile(process.env.STORAGE_RECONCILIATION_OUTPUT, output, { mode: 0o600 });
  }
  process.stdout.write(output);
  if (!report.matches) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
