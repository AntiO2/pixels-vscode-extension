# Release package decisions

The generic VSIX includes `examples/customer.pxl` so a new user has a small real file to open immediately. The 21,632-byte example compresses to 4,409 bytes in the VSIX. Release screenshots stay in the repository for README and Marketplace HTTPS rendering and are intentionally excluded from the extension payload.

The current local release candidate is 375.79 KiB compressed with 20 members. This exceeds the 300 KiB review threshold because the portable Core WASM contributes 141,244 compressed bytes and the Webview bundle contributes 103,462 compressed bytes. The customer example adds about 1.2% of the compressed package and is retained because it directly supports first-use evaluation. No native binary, JVM artifact, service, or platform-specific payload is included.
