class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "MIT"
  version "1.11.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "c1bb2858c1e603ec6dff7a3438ad9b47b1b9d7ed61d6c6f990cb9ba94685c469"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "0ad9b085976f47a24126d23f604d96775bf84ce424e78cc4eab55c84fcdebb94"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "b40ea946911ae18ae4057c3b3d4010ea53711df64b121611fbeaaafb33b783e0"
    end
  end

  def install
    bin.install "cloudviz/cloudviz" => "cloudviz"
  end

  def post_install
    puts "CloudViz v1.11.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
