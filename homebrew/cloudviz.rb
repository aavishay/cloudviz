class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.2.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "45efa90a0b8575eece7af8e5fd8d052f66f01a3a91076384af0023d9b3652f2c"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "c3f2512006966a282b7b2dd7549318f88c59d1b2107ec1cf6efec2923777afc7"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "657c65dcace1c4a96805c93fdadbedaffc9d72f5a7c156573e23ded6a28aef6b"
    end
  end

  def install
    bin.install "cloudviz"
  end

  def post_install
    puts "CloudViz v1.2.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
