.PHONY: build-lib
build-lib:
	cargo build -p tariorg --target wasm32-unknown-unknown --release

.PHONY: dev
dev:
	cd webui && node --experimental-wasm-modules node_modules/.bin/react-router dev
