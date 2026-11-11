#!/bin/sh
# Copy the Pretendard web font (SIL OFL 1.1, Latin from Inter plus matching
# Hangul) into Answer's branding upload folder. theme/head.html links its
# stylesheet from there; Answer's content security policy only allows fonts
# from its own origin.
#
#   sh community/scripts/fetch-fonts.sh <answer data dir>
#
# Needs npm and tar. npm downloads the pinned package from the npm registry
# and checks it against the registry's checksum. Safe to re-run.
set -eu

data=${1:?usage: fetch-fonts.sh <answer data dir>}
version=1.3.9
dest="$data/uploads/branding/fonts/pretendard"
src=package/dist/web/variable

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$tmp" && npm pack "pretendard@$version" --silent >/dev/null)
tar -xzf "$tmp/pretendard-$version.tgz" -C "$tmp" \
  package/dist/LICENSE.txt \
  "$src/pretendardvariable-dynamic-subset.css" \
  "$src/woff2-dynamic-subset"

mkdir -p "$dest"
rm -rf "$dest/woff2-dynamic-subset"
cp -R "$tmp/$src/woff2-dynamic-subset" "$dest/"
cp "$tmp/$src/pretendardvariable-dynamic-subset.css" "$dest/pretendard.css"
cp "$tmp/package/dist/LICENSE.txt" "$dest/LICENSE.txt"
echo "Pretendard $version: $(ls "$dest/woff2-dynamic-subset" | wc -l | tr -d ' ') files in $dest"
