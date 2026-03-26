class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.1.2"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.1.2/cloudviz_0.1.2_darwin_arm64.tar.gz"
      sha256 "89665c5f9882ebcb0605157557ee05d4a70855f55ba2ea9531f8fa9168f46ba9"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.1.2/cloudviz_0.1.2_darwin_amd64.tar.gz"
      sha256 "236148ca0b27fd6b125dbf5d4367f4ca344d7bfbcaeddc88d4389370301c0ec6"
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
