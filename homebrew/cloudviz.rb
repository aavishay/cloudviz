class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.2.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.2.0/cloudviz_0.2.0_darwin_arm64.tar.gz"
      sha256 "df25c13746a26964bfd0c785c39716dd8a38c1564645744e63113f5aab92ae21"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v0.2.0/cloudviz_0.2.0_darwin_amd64.tar.gz"
      sha256 "2b46c967310891352f77a15d00a5aa5210b92b0e23cfbb239aa7ed55d6b0c483"
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
