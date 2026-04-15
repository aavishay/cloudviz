class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.4.0"
  sha256 "938e4c26541240f6118663926b4777ca6f44d6b5bffd4a43f24bd69e55d3887a"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.4.0/cloudviz_0.4.0_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
