class TinyAgent < Formula
  desc "A lightweight, extensible coding agent built in TypeScript"
  homepage "https://github.com/jellydn/tiny-coding-agent"
  license "MIT"

  version "0.1.0"

  on_macos do
    on_intel do
      url "https://github.com/jellydn/tiny-coding-agent/releases/download/v#{version}/tiny-agent-macos-x64"
      sha256 "f953633cb167779114a23c46bc3cea753ff8fe9284469846c50462ed1404b26f"
    end
    on_arm do
      url "https://github.com/jellydn/tiny-coding-agent/releases/download/v#{version}/tiny-agent-macos-arm64"
      sha256 "REPLACE_WITH_ACTUAL_MACOS_ARM64_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jellydn/tiny-coding-agent/releases/download/v#{version}/tiny-agent-linux-x64"
      sha256 "REPLACE_WITH_ACTUAL_LINUX_X64_SHA256"
    end
    on_arm do
      url "https://github.com/jellydn/tiny-coding-agent/releases/download/v#{version}/tiny-agent-linux-arm64"
      sha256 "REPLACE_WITH_ACTUAL_LINUX_ARM64_SHA256"
    end
  end

  def install
    bin.install "tiny-agent"
  end

  def caveats
    <<~EOS
      tiny-agent has been installed to: #{bin}/tiny-agent

      Add to your PATH:
        echo 'export PATH="#{opt_bin}:$PATH"' >> ~/.zshrc && source ~/.zshrc
    EOS
  end

  test do
    system "#{bin}/tiny-agent", "--help"
  end
end
