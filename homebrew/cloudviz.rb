class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "AGPL-3.0"
  version "1.24.1"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "722eee91c0c9a3d3118fe17c839edc9085f290563be75cf5da7513a8fae80e03"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "542febf06318ebb7ad00a9e920ff797aaecbdfba09ed009c0af68e780a50d96a"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "40c78c95a286a994ac44625ed5887fbc760ec1efef103272e3f9785a653ce00f"
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
