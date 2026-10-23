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
date=$(date +%F)

# The release carries its notes: a section for the version in CHANGELOG.md.
# An Unreleased section is stamped; with neither, axle drafts one from the
# history; either way the notes are shown and confirmed before anything
# is committed.
undo() { git checkout package.json CHANGELOG.md; }
if grep -q "^## \[$version\]" CHANGELOG.md; then
  :
elif grep -q "^## Unreleased$" CHANGELOG.md; then
  perl -pi -e "s/^## Unreleased\$/## [$version] - $date/" CHANGELOG.md
elif command -v axle >/dev/null; then
  echo "CHANGELOG.md has no notes for $version; asking axle to draft them"
  axle -j jobs/changelog.job.yml --args "version=$version" "date=$date"
else
  undo
  echo "CHANGELOG.md has no notes for $version and axle is not installed to draft them: add a \"## Unreleased\" section" >&2
  exit 1
fi
notes=$(awk -v v="$version" '$0 ~ "^## \\[" v "\\]" { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md)
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  undo
  echo "CHANGELOG.md's section for $version is empty" >&2
  exit 1
fi
echo
echo "## [$version] - $date"
echo "$notes"
echo
read -r -p "Release v$version with these notes? [y/N] " answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  undo
  echo "aborted; nothing committed" >&2
  exit 1
fi

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
echo "tagged v$version — the workflow publishes to npm and creates the GitHub release; watch it with:"
echo "  gh run watch --exit-status \$(gh run list --workflow publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
