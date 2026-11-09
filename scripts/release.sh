#!/usr/bin/env bash
# 带签名打包当前版本，上传到 GitHub 的草稿 Release。
# 发布页只放安装版、便携版和自动更新用的两个文件。步骤见 docs/operations.md「发布新版本」。
set -euo pipefail
cd "$(dirname "$0")/.."

repo="Zker67/vibe-atlas"
version=$(sed -n 's/^  version: "\(.*\)",\r\{0,1\}$/\1/p' mygo.config.ts)
tag="v$version"
key="${VIBE_ATLAS_UPDATE_KEY:-$APPDATA/mygo/update-keys/vibe-atlas/mygo-update.key}"

fail() { echo "release: $*" >&2; exit 1; }
[ -n "$version" ] || fail "读不到 mygo.config.ts 的 version"
[ -z "$(git status --porcelain)" ] || fail "工作区有没提交的改动"
git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null || fail "远端没有标签 $tag，先推送"
[ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse HEAD)" ] || fail "$tag 不是当前提交"
[ -f "$key" ] || fail "找不到更新私钥：$key"
notes=$(awk -v head="## $version" '{ sub(/\r$/, "") } $0 == head { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md)
[ -n "$(echo "$notes" | tr -d '[:space:]')" ] || fail "CHANGELOG.md 里没有 ## $version 这一节"

MYGO_UPDATER_PRIVATE_KEY="$(cat "$key")" bun run build

src="build/windows-amd64"
out="build/release"
setup="$out/Vibe-Atlas-$version-Setup.exe"
portable="$out/Vibe-Atlas-$version-Portable.zip"
archive="$src/vibe-atlas-$version-windows-amd64.tar.gz"
manifest="$src/update-windows-amd64.json"
[ -f "$archive" ] && [ -f "$manifest" ] || fail "没有生成更新包，检查私钥"

rm -rf "$out"
mkdir -p "$out/Vibe Atlas"
cp "$src/vibe-atlas-setup-$version-amd64.exe" "$setup"
cp "$src/Vibe Atlas.exe" "$src/icon.png" "$src/tray.png" "$out/Vibe Atlas/"
# Windows 自带的 tar 能打 zip（Git Bash 里的 tar 不能）。
(cd "$out" && "$SYSTEMROOT/System32/tar.exe" -a -c -f "$(basename "$portable")" "Vibe Atlas")
rm -rf "$out/Vibe Atlas"

body="**下载**：安装版 \`Vibe-Atlas-$version-Setup.exe\`（装在当前用户目录，不需要管理员权限）；便携版 \`Vibe-Atlas-$version-Portable.zip\`（解压后运行 \`Vibe Atlas.exe\`）。另外两个文件是程序自动更新用的，不用下载。

## 更新内容
$notes"

gh release create "$tag" --repo "$repo" --draft --verify-tag --title "Vibe Atlas $version" --notes "$body" \
  "$setup#安装版（推荐）" \
  "$portable#便携版（解压即用）" \
  "$archive#自动更新用，不用下载" \
  "$manifest#自动更新用，不用下载"

echo "草稿已创建。检查后发布：gh release edit $tag --repo $repo --draft=false --latest"
