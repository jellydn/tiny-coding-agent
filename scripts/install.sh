#!/usr/bin/env bash
set -euo pipefail

REPO="jellydn/tiny-coding-agent"
INSTALL_DIR="${HOME}/.local/bin"
VERSION=""
FORCE_ARCH=""
FORCE_OVERWRITE=""

usage() {
	cat <<EOF
Usage: $0 [OPTIONS]

Install tiny-agent binary.

OPTIONS:
  -v, --version <version>  Specific version to install (default: latest)
  -d, --dir <path>        Installation directory (default: ~/.local/bin)
  -a, --arch <arch>       Force architecture: x64|arm64 (auto-detected)
  -f, --force             Overwrite existing installation
  -h, --help              Show this help

EXAMPLES:
  $0                      # Install latest version
  $0 -v v0.1.0            # Install specific version
  $0 -f                   # Overwrite existing

EOF
	exit 0
}

msg() { echo "[tiny-agent] $*"; }
warn() { echo "[tiny-agent] WARNING: $*" >&2; }
err() {
	echo "[tiny-agent] ERROR: $*" >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-v | --version)
		VERSION="$2"
		shift 2
		;;
	-d | --dir)
		INSTALL_DIR="$2"
		shift 2
		;;
	-a | --arch)
		FORCE_ARCH="$2"
		shift 2
		;;
	-f | --force)
		FORCE_OVERWRITE="1"
		shift
		;;
	-h | --help) usage ;;
	*) err "Unknown option: $1" ;;
	esac
done

detect_os() {
	case "$(uname -s)" in
	Linux*) echo "linux" ;;
	Darwin*) echo "macos" ;;
	*) err "Unsupported OS: $(uname -s)" ;;
	esac
}

detect_arch() {
	case "$(uname -m)" in
	x86_64 | amd64) echo "x64" ;;
	aarch64 | arm64) echo "arm64" ;;
	*) err "Unsupported architecture: $(uname -m)" ;;
	esac
}

get_download_url() {
	local os="$1"
	local arch="$2"
	local version="$3"

	local filename="tiny-agent-${os}-${arch}"
	echo "https://github.com/${REPO}/releases/download/${version}/${filename}"
}

get_checksum_url() {
	local version="$1"
	echo "https://github.com/${REPO}/releases/download/${version}/SHA256SUMS"
}

get_version() {
	if [[ -n "$VERSION" ]]; then
		echo "$VERSION"
		return
	fi

	local tag
	tag=$(curl -fsS "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
		grep '"tag_name"' | sed 's/.*": "//;s/",$//;s/"//')

	if [[ -z "$tag" ]]; then
		err "Failed to detect latest version"
	fi
	echo "$tag"
}

check_write_permission() {
	if [[ ! -d "$INSTALL_DIR" ]]; then
		if ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
			err "Cannot create ${INSTALL_DIR}. Check permissions or use -d to specify another directory."
		fi
		return 0
	fi

	if [[ ! -w "$INSTALL_DIR" ]]; then
		err "Cannot write to ${INSTALL_DIR}. Check permissions or use -d to specify another directory."
	fi
}

install() {
	local os arch version url checksum_url temp_dir binary_path

	os=$(detect_os)
	arch=$(detect_arch)
	version=$(get_version)

	if [[ -n "$FORCE_ARCH" ]]; then
		arch="$FORCE_ARCH"
	fi

	msg "Installing tiny-agent ${version} for ${os}-${arch}"
	msg "Repository: ${REPO}"

	if [[ -f "${INSTALL_DIR}/tiny-agent" && "${FORCE_OVERWRITE}" != "1" ]]; then
		warn "Existing installation found. Use -f to overwrite."
		err "Aborted."
	fi

	check_write_permission

	url=$(get_download_url "$os" "$arch" "$version")
	checksum_url=$(get_checksum_url "$version")

	temp_dir=$(mktemp -d)
	trap 'rm -rf "$temp_dir"' EXIT

	binary_path="${temp_dir}/tiny-agent"
	local checksum_path="${temp_dir}/SHA256SUMS"

	msg "Downloading binary from ${url}"
	if ! curl -fsSL -o "$binary_path" "$url"; then
		err "Failed to download binary. Check version and network connection."
	fi

	if curl -fsS -o "$checksum_path" "$checksum_url" 2>/dev/null; then
		local expected
		expected=$(grep "tiny-agent-${os}-${arch}$" "$checksum_path" | awk '{print $1}')
		if [[ -n "$expected" ]]; then
			local actual
			if command -v sha256sum >/dev/null 2>&1; then
				actual=$(sha256sum "$binary_path" | awk '{print $1}')
			else
				actual=$(shasum -a 256 "$binary_path" | awk '{print $1}')
			fi
			if [[ "$expected" != "$actual" ]]; then
				err "Checksum verification failed!"
			fi
			msg "Checksum verified"
		fi
	else
		msg "Warning: Could not download checksum file, skipping verification"
	fi

	chmod +x "$binary_path"

	mkdir -p "$INSTALL_DIR"
	cp "$binary_path" "${INSTALL_DIR}/tiny-agent"

	msg "Installed tiny-agent to ${INSTALL_DIR}/tiny-agent"

	if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
		msg ""
		msg "IMPORTANT: Add ${INSTALL_DIR} to your PATH:"
		msg ""
		echo "  # For bash:"
		echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
		echo ""
		echo "  # For zsh:"
		echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
	fi

	msg ""
	msg "Done! Run 'tiny-agent --help' to get started."
}

install
