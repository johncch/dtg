#!/usr/bin/env bash
set -euo pipefail

level="${1:-}"
if [ -z "$level" ]; then
  echo "usage: pnpm run release <patch|minor|major|x.y.z>" >&2
  exit 1
fi

pkg_name=$(node -p "require('./package.json').name")

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "release from main, not $branch" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty" >&2
  exit 1
fi

git fetch --quiet origin main --tags
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "main is not in sync with origin/main" >&2
  exit 1
fi

pnpm test

version=$(npm version "$level" --no-git-tag-version)
version="${version#v}"

if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  git checkout package.json
  echo "tag v$version already exists" >&2
  exit 1
fi

if npm view "$pkg_name@$version" version >/dev/null 2>&1; then
  git checkout package.json
  echo "$pkg_name@$version is already published" >&2
  exit 1
fi

git commit -am "Release v$version"
git tag "v$version"

# Pushing the tag is what triggers the publish workflow; pushing main does not.
git push origin main "v$version"

echo
echo "tagged v$version — watch the publish with:"
echo "  gh run watch --exit-status \$(gh run list --workflow publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
