class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.13.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "0a70e9503ef783e9073891aa25749f24ccd79aa408c3e67625094c3da3d19c0f"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "dce1276f8aa1985a12b25b9d8b531737c41c7b404e9e8865a3beffd223315f32"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "5fd07c0312616b597ab65d31b367de53255bfe17bb0e43e180068e903efe855c"
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
