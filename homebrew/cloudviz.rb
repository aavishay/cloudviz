class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.1.1"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.1.1/cloudviz_0.1.1_darwin_arm64.tar.gz"
      sha256 "190aa5c0ca6e15f0f4c58a96bf599b1f854dea1cc396a0b2fb6e68037d3c49d9"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.1.1/cloudviz_0.1.1_darwin_amd64.tar.gz"
      sha256 "21278aa00e0b25f400afc4c451eb710ae82477ad338a7de77b82e3829f62efe4"
    end
  end

  def install
    # The tar extracts to cloudviz/ directory with binary and dist/ inside
    bin.install Dir["cloudviz/cloudviz"].first => "cloudviz"
  end

  def post_install
    puts "CloudViz installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
