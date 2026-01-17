class TinyAgent < Formula
  desc "A lightweight, extensible coding agent built in TypeScript"
  homepage "https://github.com/jellydn/tiny-coding-agent"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jellydn/tiny-coding-agent/releases/latest/download/tiny-agent-darwin-arm64"
    end

    on_intel do
      url "https://github.com/jellydn/tiny-coding-agent/releases/latest/download/tiny-agent-darwin-x64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/jellydn/tiny-coding-agent/releases/latest/download/tiny-agent-linux-arm64"
    end

    on_intel do
      url "https://github.com/jellydn/tiny-coding-agent/releases/latest/download/tiny-agent-linux-x64"
    end
  end

  def install
    os = OS.mac? ? "darwin" : "linux"
    arch = Hardware::CPU.arm? ? "arm64" : "x64"
    bin.install "tiny-agent-#{os}-#{arch}" => "tiny-agent"
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
