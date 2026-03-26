.PHONY: build build-darwin-arm64 build-darwin-amd64 build-linux release clean test

BINARY_NAME=cloudviz
VERSION?=0.1.1
DIST_DIR=dist
BACKEND_DIR=backend
DARWIN_ARM64_DIR=$(DIST_DIR)/darwin_arm64
DARWIN_AMD64_DIR=$(DIST_DIR)/darwin_amd64
LINUX_AMD64_DIR=$(DIST_DIR)/linux_amd64

build-darwin-arm64:
	mkdir -p $(DARWIN_ARM64_DIR)/cloudviz
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(DARWIN_ARM64_DIR)/cloudviz/$(BINARY_NAME) main.go azure.go db.go types.go
	cp -r $(BACKEND_DIR)/dist $(DARWIN_ARM64_DIR)/
	cd $(DARWIN_ARM64_DIR) && tar -czf $(BINARY_NAME)_$(VERSION)_darwin_arm64.tar.gz cloudviz dist
	@echo "SHA256: $$(shasum -a 256 $(DARWIN_ARM64_DIR)/$(BINARY_NAME)_$(VERSION)_darwin_arm64.tar.gz)"

build-darwin-amd64:
	mkdir -p $(DARWIN_AMD64_DIR)/cloudviz
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(DARWIN_AMD64_DIR)/cloudviz/$(BINARY_NAME) main.go azure.go db.go types.go
	cp -r $(BACKEND_DIR)/dist $(DARWIN_AMD64_DIR)/
	cd $(DARWIN_AMD64_DIR) && tar -czf $(BINARY_NAME)_$(VERSION)_darwin_amd64.tar.gz cloudviz dist
	@echo "SHA256: $$(shasum -a 256 $(DARWIN_AMD64_DIR)/$(BINARY_NAME)_$(VERSION)_darwin_amd64.tar.gz)"

build-linux:
	mkdir -p $(LINUX_AMD64_DIR)/cloudviz
	cd $(BACKEND_DIR) && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(LINUX_AMD64_DIR)/cloudviz/$(BINARY_NAME) main.go azure.go db.go types.go
	cp -r $(BACKEND_DIR)/dist $(LINUX_AMD64_DIR)/
	cd $(LINUX_AMD64_DIR) && tar -czf $(BINARY_NAME)_$(VERSION)_linux_amd64.tar.gz cloudviz dist
	@echo "SHA256: $$(shasum -a 256 $(LINUX_AMD64_DIR)/$(BINARY_NAME)_$(VERSION)_linux_amd64.tar.gz)"

build: build-darwin-arm64 build-darwin-amd64 build-linux

release: build
	@echo "Release artifacts ready in $(DIST_DIR)/"

clean:
	rm -rf $(DIST_DIR)

test:
	cd $(BACKEND_DIR) && go test ./...
