class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.3.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.3.0/cloudviz_0.3.0_darwin_arm64.tar.gz"
      sha256 "80aa55a9a9cd10b09a0583ef2c229aeee7a5f94aab3490e15b3e5f3521669158"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.3.0/cloudviz_0.3.0_darwin_amd64.tar.gz"
      sha256 "5eae539985b81b64e99ca1d838813d8d635ec92a1554e74d5a0410061f87221c"
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
