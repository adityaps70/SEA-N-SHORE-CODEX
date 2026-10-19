#!/usr/bin/env bash
# Deploy image builds: keep our own copy of the node base image in private ECR, so a build never depends on Amazon
# ECR Public's pull limits (two deploys failed on 429 "Data limit exceeded"). Usage, after signing docker in to the
# private registry (and, when possible, to ECR Public):
#   bash scripts/aws/node-base-image.sh <registry>    e.g. 310356785722.dkr.ecr.ap-south-1.amazonaws.com
# Writes NODE_BASE_IMAGE=<reference> to $GITHUB_ENV (or stdout) for docker build --build-arg NODE_BASE_IMAGE.
# - Our copy holds the pinned digest: use it. A digest reference is content-addressed, so it is the same image.
# - Otherwise copy that one manifest from ECR Public with skopeo (digest preserved, nothing rebuilt) and use it.
# - If the copy fails (the repository is not created yet, or ECR Public refuses), warn and build from ECR Public at
#   the same digest, as before. Only reads and image pushes: never deletes or retags anything.
set -euo pipefail

REGISTRY="${1:-}"
[[ "$REGISTRY" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$ ]] || { echo "Usage: node-base-image.sh <private ECR registry>" >&2; exit 1; }
# shellcheck source=scripts/aws/node-base-image.env
source "$(dirname "$0")/node-base-image.env"
[[ "$NODE_BASE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "NODE_BASE_DIGEST must be a sha256 digest." >&2; exit 1; }

PUBLIC="public.ecr.aws/docker/library/node"
PRIVATE="$REGISTRY/$NODE_BASE_REPOSITORY"
COPY_TAG="$NODE_BASE_TAG-${NODE_BASE_DIGEST:7:12}"

emit() {
  if [[ -n "${GITHUB_ENV:-}" ]]; then echo "NODE_BASE_IMAGE=$1" >> "$GITHUB_ENV"; fi
  echo "NODE_BASE_IMAGE=$1"
}

if ! command -v skopeo >/dev/null 2>&1; then
  echo "::warning::skopeo is not installed; building from Amazon ECR Public at the pinned digest."
  echo "NODE_BASE_SOURCE=ecr-public"
  emit "$PUBLIC@$NODE_BASE_DIGEST"
  exit 0
fi

if skopeo inspect --raw "docker://$PRIVATE@$NODE_BASE_DIGEST" >/dev/null 2>&1; then
  echo "NODE_BASE_SOURCE=private-ecr"
  emit "$PRIVATE@$NODE_BASE_DIGEST"
  exit 0
fi

if skopeo copy --quiet --retry-times 2 --preserve-digests \
  "docker://$PUBLIC@$NODE_BASE_DIGEST" "docker://$PRIVATE:$COPY_TAG"; then
  skopeo inspect --raw "docker://$PRIVATE@$NODE_BASE_DIGEST" >/dev/null
  echo "NODE_BASE_COPIED=$NODE_BASE_REPOSITORY:$COPY_TAG"
  echo "NODE_BASE_SOURCE=private-ecr"
  emit "$PRIVATE@$NODE_BASE_DIGEST"
  exit 0
fi

echo "::warning::Could not copy the node base image to $NODE_BASE_REPOSITORY; building from Amazon ECR Public at the pinned digest."
echo "NODE_BASE_SOURCE=ecr-public"
emit "$PUBLIC@$NODE_BASE_DIGEST"
