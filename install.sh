#!/bin/sh
# Installer for the lsec CLI (https://github.com/gendosu/lsec).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | sh
#
# Environment variables:
#   LSEC_INSTALL_DIR  install destination directory (default: ~/.local/bin)
#   LSEC_VERSION      release tag to install, e.g. v0.3.0 (default: latest)
set -eu

REPO="gendosu/lsec"
INSTALL_DIR="${LSEC_INSTALL_DIR:-"$HOME/.local/bin"}"
VERSION="${LSEC_VERSION:-latest}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    echo "lsec: unsupported OS: $(uname -s) (supported: macOS, Linux)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *)
    echo "lsec: unsupported CPU architecture: $(uname -m) (supported: arm64, x86_64)" >&2
    exit 1
    ;;
esac

asset="lsec-${os}-${arch}"

if [ "$VERSION" = "latest" ]; then
  base_url="https://github.com/${REPO}/releases/latest/download"
else
  base_url="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmpdir=""
placing=false
cleanup() {
  trap '' INT TERM
  if [ -n "$tmpdir" ]; then
    rm -rf "$tmpdir"
  fi
}
interrupt() {
  trap '' INT TERM
  if [ "$placing" = true ] && [ -n "${!:-}" ]; then
    kill -TERM "$!" 2>/dev/null || :
    wait "$!" 2>/dev/null || :
  fi
  exit "$1"
}
trap cleanup EXIT
trap 'interrupt 130' INT
trap 'interrupt 143' TERM

# Stage on the destination filesystem, which may differ from or allow execution unlike TMPDIR.
mkdir -p "$INSTALL_DIR"
tmpdir="$(mktemp -d "${INSTALL_DIR}/.lsec-install.XXXXXX")"

echo "Downloading ${asset} (${VERSION}) ..."
curl -fsSL -o "${tmpdir}/lsec" "${base_url}/${asset}"
curl -fsSL -o "${tmpdir}/SHA256SUMS" "${base_url}/SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "${tmpdir}/SHA256SUMS")"
if [ -z "$expected" ]; then
  echo "lsec: no checksum entry for ${asset} in SHA256SUMS" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmpdir}/lsec")"
else
  actual="$(shasum -a 256 "${tmpdir}/lsec")"
fi
actual="${actual%% *}"
if [ "$expected" != "$actual" ]; then
  echo "lsec: SHA256 checksum mismatch for ${asset}" >&2
  echo "  expected: ${expected}" >&2
  echo "  actual:   ${actual}" >&2
  exit 1
fi

chmod +x "${tmpdir}/lsec"

# Validate before replacing the working installation.
"${tmpdir}/lsec" --version > /dev/null

if [ -d "${INSTALL_DIR}/lsec" ]; then
  echo "lsec: install target is a directory: ${INSTALL_DIR}/lsec" >&2
  exit 1
fi
# Use the final basename and its parent so mv cannot descend into an existing lsec/.
# An interruptible wait lets the signal handler stop and reap mv before cleanup.
placing=true
mv -f "${tmpdir}/lsec" "${INSTALL_DIR}/" &
wait "$!"
placing=false

echo "Installed: ${INSTALL_DIR}/lsec"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${INSTALL_DIR} is not on your PATH. Add it in your shell profile, e.g.:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac
