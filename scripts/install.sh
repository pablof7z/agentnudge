#!/bin/sh

set -eu

repository=${AGENTNUDGE_REPOSITORY:-pablof7z/agentnudge}
install_dir=${AGENTNUDGE_INSTALL_DIR:-"$HOME/.local/bin"}
version=${AGENTNUDGE_VERSION:-}
release_url=${AGENTNUDGE_RELEASE_URL:-}

if [ -z "$release_url" ]; then
  if [ -n "$version" ]; then
    case "$version" in
      v*) ;;
      *) version="v$version" ;;
    esac
    release_url="https://github.com/$repository/releases/download/$version"
  else
    release_url="https://github.com/$repository/releases/latest/download"
  fi
fi

case $(uname -s) in
  Darwin) operating_system=apple-darwin ;;
  Linux) operating_system=unknown-linux-gnu ;;
  *)
    echo "AgentNudge does not publish an installer for $(uname -s)." >&2
    exit 1
    ;;
esac

case $(uname -m) in
  arm64|aarch64) architecture=aarch64 ;;
  x86_64|amd64) architecture=x86_64 ;;
  *)
    echo "AgentNudge does not publish an installer for architecture $(uname -m)." >&2
    exit 1
    ;;
esac

target="$architecture-$operating_system"
archive="agentnudge-$target.tar.gz"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/agentnudge-install.XXXXXX")

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

download() {
  url=$1
  destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error "$url" --output "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet "$url" --output-document "$destination"
  else
    echo "Install curl or wget, then run this installer again." >&2
    exit 1
  fi
}

download "$release_url/$archive" "$temporary_directory/$archive"
download "$release_url/SHA256SUMS" "$temporary_directory/SHA256SUMS"

expected=$(awk -v archive="$archive" '$2 == archive || $2 == "*" archive { print $1; exit }' "$temporary_directory/SHA256SUMS")
if [ -z "$expected" ]; then
  echo "SHA256SUMS does not contain $archive." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary_directory/$archive" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$temporary_directory/$archive" | awk '{ print $1 }')
else
  echo "A SHA-256 tool (sha256sum or shasum) is required." >&2
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  echo "Checksum verification failed for $archive." >&2
  exit 1
fi

tar -C "$temporary_directory" -xzf "$temporary_directory/$archive"
mkdir -p "$install_dir"
install -m 0755 "$temporary_directory/agentnudge-$target/agentnudge" "$install_dir/agentnudge"

installed_version=$("$install_dir/agentnudge" --version)
printf 'Installed %s at %s\n' "$installed_version" "$install_dir/agentnudge"

case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to run agentnudge from any directory.\n' "$install_dir" ;;
esac
