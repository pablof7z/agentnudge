#!/bin/sh

set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: $0 TARGET VERSION OUTPUT_DIR BINARY" >&2
  exit 2
fi

target=$1
version=$2
output_dir=$3
binary=$4
archive="agentnudge-${target}.tar.gz"
package="agentnudge-${target}"

if [ ! -f "$binary" ]; then
  echo "binary does not exist: $binary" >&2
  exit 1
fi

case "$version" in
  ''|*[!0-9A-Za-z.+-]*)
    echo "invalid version: $version" >&2
    exit 1
    ;;
esac

mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/agentnudge-package.XXXXXX")

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$temporary_directory/$package"
install -m 0755 "$binary" "$temporary_directory/$package/agentnudge"
cp README.md LICENSE "$temporary_directory/$package/"
printf '%s\n' "$version" > "$temporary_directory/$package/VERSION"

tar -C "$temporary_directory" -czf "$output_dir/$archive" "$package"
printf '%s\n' "$output_dir/$archive"
