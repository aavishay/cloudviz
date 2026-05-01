class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.3.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "6c326e8a1da1bd5ce136eadaf6b7d5e93a5e5d49be2160f49fdde21d1cf3161c"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "0ed108f3ebac23a5fe525092984bae93e6f05cbe937a43ff734f2071adf07216"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "ff85cf6ca0f677aaae37ecaab0eef29f75a17cba17ee4c98715eeeacec509ad5"
    end
  end

  def install
    bin.install "cloudviz/cloudviz" => "cloudviz"
  end

  def post_install
    puts "CloudViz v1.3.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
