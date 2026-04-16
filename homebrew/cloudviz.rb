class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.7.0"
  sha256 "caf169d6b1cedb24fdd39e4601d6dd3f1b5a37570502660f6d11e46d3d25e9a0"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.7.0/cloudviz_0.7.0_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
