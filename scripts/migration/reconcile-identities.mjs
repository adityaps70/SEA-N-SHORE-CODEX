#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function emailToken(email) {
  const normalized = normalizeEmail(email);
  return normalized ? createHash('sha256').update(normalized).digest('hex').slice(0, 16) : null;
}

function normalizeSupabaseUser(row) {
  const id = String(row.id ?? '').trim();
  const email = normalizeEmail(row.email);
  if (!id) throw new Error('Supabase auth user is missing id.');
  return { id, email };
}

function normalizeCognitoUser(row) {
  const attributes = Array.isArray(row.Attributes) ? Object.fromEntries(row.Attributes.map((item) => [item.Name, item.Value])) : {};
  const subject = String(row.sub ?? row.subject ?? attributes.sub ?? row.Username ?? '').trim();
  const email = normalizeEmail(row.email ?? attributes.email);
  if (!subject) throw new Error('Cognito user is missing subject/Username.');
  return { subject, email };
}

function normalizeIdentityAccount(row) {
  const profileId = String(row.profile_id ?? row.profileId ?? '').trim();
  const subject = String(row.provider_subject ?? row.providerSubject ?? '').trim();
  const provider = String(row.provider ?? '').trim().toLowerCase();
  const email = normalizeEmail(row.email);
  if (!profileId || !subject || provider !== 'cognito') throw new Error('Aurora identity account must contain profile_id, cognito provider, and provider_subject.');
  return { profileId, subject, email };
}

function duplicateValues(items, selector) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const value = selector(item);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function reconcileIdentities({ supabaseUsers, cognitoUsers, identityAccounts }) {
  const source = supabaseUsers.map(normalizeSupabaseUser);
  const cognito = cognitoUsers.map(normalizeCognitoUser);
  const accounts = identityAccounts.map(normalizeIdentityAccount);

  const sourceByEmail = new Map(source.filter((u) => u.email).map((u) => [u.email, u]));
  const cognitoByEmail = new Map(cognito.filter((u) => u.email).map((u) => [u.email, u]));
  const accountBySubject = new Map(accounts.map((a) => [a.subject, a]));

  const duplicateSourceEmails = duplicateValues(source, (u) => u.email).map(emailToken);
  const duplicateCognitoEmails = duplicateValues(cognito, (u) => u.email).map(emailToken);
  const duplicateAccountSubjects = duplicateValues(accounts, (a) => a.subject);
  const duplicateAccountProfiles = duplicateValues(accounts, (a) => a.profileId);

  const missingCognitoForSource = [];
  const missingIdentityAccount = [];
  const profileIdMismatches = [];
  const emailMismatches = [];

  for (const user of source) {
    if (!user.email) continue;
    const cognitoUser = cognitoByEmail.get(user.email);
    if (!cognitoUser) {
      missingCognitoForSource.push({ sourceProfileId: user.id, emailToken: emailToken(user.email) });
      continue;
    }
    const account = accountBySubject.get(cognitoUser.subject);
    if (!account) {
      missingIdentityAccount.push({ sourceProfileId: user.id, cognitoSubject: cognitoUser.subject, emailToken: emailToken(user.email) });
      continue;
    }
    if (account.profileId !== user.id) {
      profileIdMismatches.push({ expectedProfileId: user.id, actualProfileId: account.profileId, cognitoSubject: cognitoUser.subject, emailToken: emailToken(user.email) });
    }
    if (account.email && account.email !== user.email) {
      emailMismatches.push({ profileId: user.id, cognitoSubject: cognitoUser.subject, sourceEmailToken: emailToken(user.email), accountEmailToken: emailToken(account.email) });
    }
  }

  const sourceEmails = new Set(sourceByEmail.keys());
  const cognitoOnly = cognito
    .filter((user) => user.email && !sourceEmails.has(user.email))
    .map((user) => ({ cognitoSubject: user.subject, emailToken: emailToken(user.email) }));
  const accountOnlySubjects = accounts
    .filter((account) => !cognito.some((user) => user.subject === account.subject))
    .map((account) => ({ profileId: account.profileId, cognitoSubject: account.subject, emailToken: emailToken(account.email) }));

  const failures = duplicateSourceEmails.length + duplicateCognitoEmails.length + duplicateAccountSubjects.length + duplicateAccountProfiles.length + missingCognitoForSource.length + missingIdentityAccount.length + profileIdMismatches.length + emailMismatches.length;

  return {
    generatedAt: new Date().toISOString(),
    piiSafe: true,
    sourceUserCount: source.length,
    cognitoUserCount: cognito.length,
    identityAccountCount: accounts.length,
    duplicateSourceEmails,
    duplicateCognitoEmails,
    duplicateAccountSubjects,
    duplicateAccountProfiles,
    missingCognitoForSource,
    missingIdentityAccount,
    profileIdMismatches,
    emailMismatches,
    cognitoOnly,
    accountOnlySubjects,
    blockingMismatchCount: failures,
    matches: failures === 0,
  };
}

async function loadArray(path, keys) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  for (const key of keys) if (Array.isArray(parsed?.[key])) return parsed[key];
  throw new Error(`Expected an array or one of ${keys.join(', ')} in ${path}`);
}

async function main() {
  const sourcePath = process.env.SUPABASE_AUTH_INVENTORY;
  const cognitoPath = process.env.COGNITO_USER_INVENTORY;
  const accountsPath = process.env.AURORA_IDENTITY_INVENTORY;
  if (!sourcePath || !cognitoPath || !accountsPath) {
    throw new Error('Set SUPABASE_AUTH_INVENTORY, COGNITO_USER_INVENTORY, and AURORA_IDENTITY_INVENTORY to read-only JSON exports.');
  }
  const [supabaseUsers, cognitoUsers, identityAccounts] = await Promise.all([
    loadArray(sourcePath, ['users']),
    loadArray(cognitoPath, ['Users', 'users']),
    loadArray(accountsPath, ['identity_accounts', 'rows']),
  ]);
  const report = reconcileIdentities({ supabaseUsers, cognitoUsers, identityAccounts });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.IDENTITY_RECONCILIATION_OUTPUT) await writeFile(process.env.IDENTITY_RECONCILIATION_OUTPUT, output, { mode: 0o600 });
  process.stdout.write(output);
  if (!report.matches) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
