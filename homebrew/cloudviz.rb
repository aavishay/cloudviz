class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "AGPL-3.0"
  version "1.14.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "5355a0cc31115b4bd96ec6783adb002da6a7124a917186480818aed46ba6b29c"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "11da9a19318f3b992ec296009a0d1eaadec84141f0e3d761b8a12d67b3a83a32"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "af14b6605c815020857b8ab5fc3c3ad7ed435c4a4f602c4e50421633145e709e"
    end
  end

  def install
    bin.install "cloudviz/cloudviz" => "cloudviz"
  end

  def post_install
    puts "CloudViz v1.14.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
