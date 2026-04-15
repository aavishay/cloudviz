class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.4.0"
  sha256 "84c171089b1d5a0afa5e6a2a3e86f9c5e45c43dab2a4e74c7d0599be694279c2"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.4.0/cloudviz_0.4.0_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
