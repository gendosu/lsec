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

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

echo "Downloading ${asset} (${VERSION}) ..."
curl -fsSL -o "${tmpdir}/${asset}" "${base_url}/${asset}"
curl -fsSL -o "${tmpdir}/SHA256SUMS" "${base_url}/SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "${tmpdir}/SHA256SUMS")"
if [ -z "$expected" ]; then
  echo "lsec: no checksum entry for ${asset} in SHA256SUMS" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmpdir}/${asset}" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "${tmpdir}/${asset}" | awk '{ print $1 }')"
fi
if [ "$expected" != "$actual" ]; then
  echo "lsec: SHA256 checksum mismatch for ${asset}" >&2
  echo "  expected: ${expected}" >&2
  echo "  actual:   ${actual}" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
chmod +x "${tmpdir}/${asset}"
mv -f "${tmpdir}/${asset}" "${INSTALL_DIR}/lsec"

# Smoke check: fails here (not later at first use) if the binary cannot run.
"${INSTALL_DIR}/lsec" --version > /dev/null

echo "Installed: ${INSTALL_DIR}/lsec"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${INSTALL_DIR} is not on your PATH. Add it in your shell profile, e.g.:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac
