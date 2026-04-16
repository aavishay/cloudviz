class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.8.0"
  sha256 "6b138f16ebf4a2a2a6b8f7759de0dc75fd59f6b7c40b2ef4ddbe2fde0295c2e1"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.8.0/cloudviz_0.8.0_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
