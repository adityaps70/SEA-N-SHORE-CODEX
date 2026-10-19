import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync(new URL('../../infra/aws/bootstrap/main.tf', import.meta.url), 'utf8')
const reconcile = readFileSync(new URL('./github-deploy-iam.sh', import.meta.url), 'utf8')
const deploy = readFileSync(new URL('../../.github/workflows/aws-staging-deploy.yml', import.meta.url), 'utf8')
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
const ci = readFileSync(new URL('../../.github/workflows/aws-infra-ci.yml', import.meta.url), 'utf8')

// Round H: the deploy build pulls its node base image from Amazon ECR Public. Anonymous pulls from shared runner IPs
// failed twice with 429 "Data limit exceeded", so the deploy role may sign in to ECR Public, and nothing more.
test('the deploy role may get an ECR Public sign-in token and an ECR Public bearer token only', () => {
  assert.match(bootstrap, /Sid\s+= "EcrPublicPullAuth"\n\s+Effect\s+= "Allow"\n\s+Action\s+= \["ecr-public:GetAuthorizationToken"\]\n\s+Resource = "\*"\n/)
  assert.match(bootstrap, /Sid\s+= "EcrPublicBearerToken"\n\s+Effect\s+= "Allow"\n\s+Action\s+= \["sts:GetServiceBearerToken"\]\n\s+Resource = "\*"\n\s+Condition = \{\n\s+StringEquals = \{ "sts:AWSServiceName" = "ecr-public.amazonaws.com" \}/)

  assert.match(reconcile, /Sid: "EcrPublicPullAuth",\n\s+Effect: "Allow",\n\s+Action: \["ecr-public:GetAuthorizationToken"\],\n\s+Resource: "\*"\n/)
  assert.match(reconcile, /Sid: "EcrPublicBearerToken",\n\s+Effect: "Allow",\n\s+Action: \["sts:GetServiceBearerToken"\],\n\s+Resource: "\*",\n\s+Condition: \{StringEquals: \{"sts:AWSServiceName": "ecr-public.amazonaws.com"\}\}\n/)
  // Managed like the other reconciled statements: replaced, verified before and after, excluded from the drift check.
  for (const sid of ['EcrPublicPullAuth', 'EcrPublicBearerToken']) {
    assert.equal((reconcile.match(new RegExp(`\\.Sid != "${sid}"`, 'g')) || []).length, 3, sid)
  }
  assert.match(reconcile, /verify_ecr_public_pull_statements "\$CURRENT"\n/)
  assert.match(reconcile, /verify_ecr_public_pull_statements "\$VERIFIED" \|\| \{/)
  assert.match(reconcile, /change_required=[^ ]*EcrPublicPullAuth,EcrPublicBearerToken /)
  // No push, repository or other ECR Public rights.
  for (const source of [bootstrap, reconcile]) {
    assert.doesNotMatch(source, /ecr-public:(?!GetAuthorizationToken)/)
  }
})

test('the deploy build signs in to ECR Public before building, without logging the token', () => {
  // Round I: the default base image is still ECR Public; the deploy copies it to private ECR (node-base-image.test.mjs).
  assert.match(dockerfile, /^ARG NODE_BASE_IMAGE=public\.ecr\.aws\//m)
  const signIn = deploy.indexOf('- name: Sign in to Amazon ECR Public for the base image')
  const copy = deploy.indexOf('- name: Use our own copy of the node base image')
  const build = deploy.indexOf('- name: Build and push immutable application image')
  assert.ok(signIn > 0 && copy > signIn && build > copy, 'the sign-in step runs before the base image copy and the image build')
  const step = deploy.slice(signIn, copy)
  assert.match(step, /aws ecr-public get-login-password --region us-east-1 \| docker login --username AWS --password-stdin public\.ecr\.aws/)
  // The token never reaches the log or an environment variable.
  assert.doesNotMatch(step, /echo "\$\(aws ecr-public|--password [^-]|PASSWORD=/)
  // A failed sign-in warns and lets the build try an anonymous pull.
  assert.match(step, /::warning::Could not sign in to Amazon ECR Public/)
})

test('the CI image build pulls the base image first and falls back to the official image mirror', () => {
  const pull = ci.indexOf('- name: Pull the node base image')
  const build = ci.indexOf('- name: Build production image')
  assert.ok(pull > 0 && build > pull, 'the pull step runs right before the CI image build')
  const step = ci.slice(pull, build)
  // Round I: every FROM line uses NODE_BASE_IMAGE, and the build passes the reference the step pulled (the pinned
  // digest from ECR Public, or the same digest from mirror.gcr.io), so the build finds it locally.
  const froms = dockerfile.match(/^FROM \S+/gm)
  assert.ok(froms.length > 0)
  for (const from of froms) assert.equal(from, 'FROM ${NODE_BASE_IMAGE}')
  assert.match(step, /image="public\.ecr\.aws\/docker\/library\/node@\$NODE_BASE_DIGEST"\n/)
  assert.match(step, /image="mirror\.gcr\.io\/library\/node@\$NODE_BASE_DIGEST"\n\s+docker pull --quiet "\$image"\n/)
  assert.match(ci.slice(build, build + 300), /--build-arg NODE_BASE_IMAGE="\$NODE_BASE_IMAGE"/)
  // The build itself keeps the local image: no --pull.
  assert.doesNotMatch(ci.slice(build, build + 300), /--pull/)
})
