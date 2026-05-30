class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.34.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "5880b978f52c3e6c6496aa30c49b88c904de1cbedeeaa0deeff4a9c2f68c4cfa"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "5ec721e87d182d306a8664adcb77bd0836606fd45072e818ffa13a9fde8c8806"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "c878227e26fac504fa893cc5d32f90f8e59a9b9f8b3b5016553b00cd80477426"
    end
  end

  def install
    bin.install "cloudviz"
  end

  def post_install
    puts "CloudViz v#{version} installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
