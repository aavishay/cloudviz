class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "AGPL-3.0"
  version "2.1.11"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "598e04b5400d39796788a7c6c66347915629982b313e156f7b444c5233147192"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "316e6d6193b2f58d687ced17d0689b5271bf116ccbc855a7bffdd0d1fc728af5"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "db1df2d07e261ebbdf34677a24ba85bc654ae3b7c90cb4d9cacfa10d61288a4c"
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
