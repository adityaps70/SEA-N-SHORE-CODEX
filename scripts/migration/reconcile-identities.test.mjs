import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileIdentities } from './reconcile-identities.mjs';

test('matches Supabase auth IDs to Cognito subjects through Aurora identity accounts', () => {
  const report = reconcileIdentities({
    supabaseUsers: [{ id: 'profile-a', email: 'User@Example.com' }],
    cognitoUsers: [{ Username: 'subject-a', Attributes: [{ Name: 'email', Value: 'user@example.com' }, { Name: 'sub', Value: 'subject-a' }] }],
    identityAccounts: [{ profile_id: 'profile-a', provider: 'cognito', provider_subject: 'subject-a', email: 'user@example.com' }],
  });
  assert.equal(report.matches, true);
  assert.equal(report.blockingMismatchCount, 0);
});

test('reports missing Cognito and never emits raw email addresses', () => {
  const report = reconcileIdentities({
    supabaseUsers: [{ id: 'profile-a', email: 'private@example.com' }],
    cognitoUsers: [],
    identityAccounts: [],
  });
  assert.equal(report.matches, false);
  assert.equal(report.missingCognitoForSource.length, 1);
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
  assert.match(report.missingCognitoForSource[0].emailToken, /^[0-9a-f]{16}$/);
});

test('reports profile ID mismatch for an otherwise matching identity', () => {
  const report = reconcileIdentities({
    supabaseUsers: [{ id: 'expected-profile', email: 'a@example.com' }],
    cognitoUsers: [{ sub: 'subject-a', email: 'a@example.com' }],
    identityAccounts: [{ profile_id: 'wrong-profile', provider: 'cognito', provider_subject: 'subject-a', email: 'a@example.com' }],
  });
  assert.equal(report.profileIdMismatches.length, 1);
  assert.equal(report.matches, false);
});

test('duplicate source emails and account subjects are blocking', () => {
  const report = reconcileIdentities({
    supabaseUsers: [
      { id: 'one', email: 'same@example.com' },
      { id: 'two', email: 'same@example.com' },
    ],
    cognitoUsers: [{ sub: 'subject-a', email: 'same@example.com' }],
    identityAccounts: [
      { profile_id: 'one', provider: 'cognito', provider_subject: 'subject-a', email: 'same@example.com' },
      { profile_id: 'two', provider: 'cognito', provider_subject: 'subject-a', email: 'same@example.com' },
    ],
  });
  assert.equal(report.duplicateSourceEmails.length, 1);
  assert.equal(report.duplicateAccountSubjects.length, 1);
  assert.equal(report.matches, false);
});

test('Cognito-only users are non-blocking migration observations', () => {
  const report = reconcileIdentities({
    supabaseUsers: [],
    cognitoUsers: [{ sub: 'admin-subject', email: 'aws-only@example.com' }],
    identityAccounts: [],
  });
  assert.equal(report.cognitoOnly.length, 1);
  assert.equal(report.matches, true);
  assert.equal(JSON.stringify(report).includes('aws-only@example.com'), false);
});
