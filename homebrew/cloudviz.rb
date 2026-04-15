class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.5.1"
  sha256 "7c4ade196d0fed60d1c3858acbc451eb6ffcb0b541a15f9a9c6a98c87b69936d"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.5.1/cloudviz_0.5.1_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
