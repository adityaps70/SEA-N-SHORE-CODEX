"""Exact-SHA checkout on the bootstrap host from the runner's git bundle.

The repository is private and the bootstrap host holds no GitHub credentials, so the host never clones from GitHub.
On the runner, `bash scripts/aws/ci-checkout.sh publish <sha>` bundles the exact commit, uploads it to the private
migration bucket under a per-run key and records it in $RUNNER_TEMP/ci-checkout.json. The SSM command generators call
host_checkout() for the host shell lines that download that exact object version, delete it, check out the SHA from
the bundle and verify HEAD. Nothing secret goes into the SSM command text: the bucket, key and version id are not
credentials (the host reads the object with its own instance role).
"""
import json
import os
import re

BUCKET = 'sea-n-shore-staging-310356785722-migration'
REMOTE = 'https://github.com/adityaps70/SEA-N-SHORE-CODEX.git'
BRANCH = 'feat/aws-native-phase-0-1'
KEY_PATTERN = r'ci-checkouts/[0-9]+-[0-9]+-[A-Za-z0-9_-]+-[0-9]+-[0-9a-f]{40}'
S3 = 'aws s3api --region ap-south-1'


def _published(sha):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('expected an exact commit SHA')
    with open(os.path.join(os.environ['RUNNER_TEMP'], 'ci-checkout.json')) as handle:
        entry = json.load(handle)[-1]
    if entry['sha'] != sha or not re.fullmatch(KEY_PATTERN, entry['key']) or not entry['key'].endswith(sha):
        raise ValueError('the published checkout bundle is not for this SHA')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,1024}', entry['version']):
        raise ValueError('unexpected bundle version id')
    return entry


def _download(entry, bundle):
    obj = f'--bucket {BUCKET} --key {entry["key"]}.bundle --version-id {entry["version"]}'
    return [
        f'{S3} get-object {obj} {bundle} >/dev/null',
        # Deleted as soon as it is on disk; the runner's cleanup step deletes it too if the host never got this far.
        f'{S3} delete-object {obj} >/dev/null',
    ]


def host_checkout(dir_var, sha):
    """Shell lines: the exact SHA checked out in "<dir_var>/repo" (HEAD verified), working directory inside it."""
    if not re.fullmatch(r'\$[A-Z_]+', dir_var):
        raise ValueError('dir_var must be a shell variable such as $WORK_DIR')
    entry = _published(sha)
    bundle = f'"{dir_var}/repo.bundle"'
    refs = 'refs/ci-checkout'
    if entry['history']:
        refs += f' refs/remotes/origin/{BRANCH}:refs/remotes/origin/{BRANCH}'
    return '\n'.join([
        *_download(entry, bundle),
        f'git -c init.defaultBranch=checkout init --quiet "{dir_var}/repo"',
        f'cd "{dir_var}/repo"',
        # A depth-1 bundle: mark the commit shallow so git does not look for its parents.
        *([] if entry['history'] else [f'echo {sha} > .git/shallow']),
        f'git fetch --quiet --no-tags {bundle} {refs}',
        f'rm -f -- {bundle}',
        f'git checkout --quiet --detach {sha}',
        f'test "$(git rev-parse HEAD)" = "{sha}"',
        # Names the repository for the scripts' origin checks; nothing is ever fetched from it on the host.
        f'git remote add origin {REMOTE}',
        f'export SEA_N_SHORE_CHECKOUT_HEAD_KEY={entry["key"]}.head',
    ])


def host_update_worktree(path, sha):
    """Shell lines: the persistent worktree at <path> reset to the exact SHA from a full-history bundle."""
    if not re.fullmatch(r'/[A-Za-z0-9._/-]+', path):
        raise ValueError('unexpected worktree path')
    entry = _published(sha)
    if not entry['history']:
        raise ValueError('a persistent worktree needs a full-history bundle (publish --history)')
    return '\n'.join([
        'CHECKOUT_BUNDLE="$(mktemp /var/tmp/sea-n-shore-checkout.XXXXXXXX)"',
        """trap 'rm -f -- "$CHECKOUT_BUNDLE"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM""",
        *_download(entry, '"$CHECKOUT_BUNDLE"'),
        f'cd {path}',
        'git fetch --quiet --no-tags "$CHECKOUT_BUNDLE" refs/ci-checkout',
        f'git cat-file -e {sha}^{{commit}}',
        f'git reset --quiet --hard {sha}',
        f'test "$(git rev-parse HEAD)" = "{sha}"',
        f'export SEA_N_SHORE_CHECKOUT_HEAD_KEY={entry["key"]}.head',
    ])
