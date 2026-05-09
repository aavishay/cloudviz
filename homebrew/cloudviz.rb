class Cloudviz < Formula
  desc "Azure cloud infrastructure visualization and cost management dashboard"
  homepage "https://github.com/aavishay/cloudviz"
  license "AGPL-3.0"
  version "1.15.0"

  on_macos do
    on_arm do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_arm64.tar.gz"
      sha256 "7caa6cc696f396a801b116a78959342967e02eb38a14f8bf4fd9f398225f0398"
    end
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_darwin_amd64.tar.gz"
      sha256 "ceccb3a1c57417b7740644b3431b4dfdd144e299818557005f1b39cd0e0c2256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/aavishay/cloudviz/releases/download/v#{version}/cloudviz_#{version}_linux_amd64.tar.gz"
      sha256 "6734efd6fdf87b6e7ee1a1b937f9c8f7a524c45b24e348b7823f1ab278f6c7f9"
    end
  end

  def install
    bin.install "cloudviz"
  end

  def post_install
    puts "CloudViz v1.15.0 installed!"
    puts "Run 'cloudviz serve' to start the server."
    puts "Run 'cloudviz --help' for all available commands."
  end

  test do
    system "#{bin}/cloudviz", "--help"
  end
end
