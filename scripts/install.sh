#!/bin/sh
set -e

REPO="jellydn/tiny-coding-agent"
BINARY_NAME="tiny-agent"
INSTALL_DIR="${TINY_AGENT_INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  OS="linux" ;;
  Darwin*) OS="darwin" ;;
  *)       echo "Unsupported OS: $OS"; exit 1 ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

ARTIFACT="tiny-agent-${OS}-${ARCH}"
echo "Detected: $OS-$ARCH"

# Get latest release URL
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
RELEASE_DATA=$(curl -fsSL "$LATEST_URL")
DOWNLOAD_URL=$(echo "$RELEASE_DATA" | grep "browser_download_url.*${ARTIFACT}\"" | cut -d '"' -f 4 | head -n 1)
CHECKSUM_URL=$(echo "$RELEASE_DATA" | grep "browser_download_url.*checksums.txt\"" | cut -d '"' -f 4 | head -n 1)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not find download URL for $ARTIFACT"
  exit 1
fi

echo "Downloading from: $DOWNLOAD_URL"

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download binary
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"

# Verify checksum if available
if [ -n "$CHECKSUM_URL" ]; then
  echo "Verifying checksum..."
  CHECKSUMS=$(curl -fsSL "$CHECKSUM_URL")
  EXPECTED=$(echo "$CHECKSUMS" | grep "$ARTIFACT" | awk '{print $1}')

  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "${INSTALL_DIR}/${BINARY_NAME}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "${INSTALL_DIR}/${BINARY_NAME}" | awk '{print $1}')
    else
      echo "Warning: No sha256sum or shasum found, skipping verification"
      ACTUAL="$EXPECTED"
    fi

    if [ "$EXPECTED" != "$ACTUAL" ]; then
      echo "Error: Checksum verification failed!"
      echo "Expected: $EXPECTED"
      echo "Actual:   $ACTUAL"
      rm -f "${INSTALL_DIR}/${BINARY_NAME}"
      exit 1
    fi
    echo "Checksum verified ✓"
  fi
fi

chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

echo ""
echo "✓ Installed $BINARY_NAME to ${INSTALL_DIR}/${BINARY_NAME}"

# Check if in PATH (POSIX-compliant)
case ":$PATH:" in
  *:"$INSTALL_DIR":*)
    ;;
  *)
    echo ""
    echo "Add to your PATH by adding this to your shell config:"
    echo ""
    echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
    echo ""
    ;;
esac

echo "Run 'tiny-agent --help' to get started!"
