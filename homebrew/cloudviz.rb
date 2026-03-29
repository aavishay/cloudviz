class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "0.3.0"
  sha256 "e948180002497cd4f1b614b2cafc23a67cfb676ddd4a199af324af3861bf3047"

  url "https://github.com/aavishay/cloudviz/releases/download/v0.3.0/cloudviz_0.3.0_darwin_arm64.tar.gz"

  def install
    bin.install "cloudviz"
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
