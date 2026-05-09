class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.13.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "5c3218e7706c6342cb391659c2a08df6fa5a1a2d6caff1fdc0a4e959d444681f"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "d4665978d59a64c40824c59cda5a0c06dec1fa721e4c3377fafa846a51b70dee"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "2c009924fa9c82c8bdd2342fa7490f4ab33e069cbead19f781074593e15cb334"
    end
  end

  def install
    bin.install "cloudviz/cloudviz" => "cloudviz"
  end

  def post_install
    puts "CloudViz v1.13.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
