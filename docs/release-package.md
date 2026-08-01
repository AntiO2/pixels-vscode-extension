# Release package decisions

The generic VSIX includes `examples/customer.pxl` so a new user has a small real file to open immediately. The 21,632-byte example compresses to 4,409 bytes in the VSIX. Release screenshots stay in the repository for README and Marketplace HTTPS rendering and are intentionally excluded from the extension payload.

The current local release candidate is 376.51 KiB compressed with 20 members. This exceeds the 300 KiB review threshold because the portable Core WASM contributes 141,244 compressed bytes and the Webview bundle contributes 104,048 compressed bytes. The customer example adds about 1.2% of the compressed package and is retained because it directly supports first-use evaluation. No native binary, JVM artifact, service, or platform-specific payload is included.

## Marketplace automation

Publishing uses `.github/workflows/publish-marketplace.yml`. A published GitHub Release always runs the workflow. A manual run requires an exact `v<package.json version>` tag and explicit pre-release choice; the tag must already have a non-draft GitHub Release whose pre-release state matches that choice. Its `publish` switch defaults to off so the identity can be bootstrapped and the audited artifact inspected without changing the Marketplace. A deliberate retry of an existing release enables `publish`. The workflow never increments or rewrites `package.json` and accepts only an exact `v<major>.<minor>.<patch>` tag whose commit matches the checkout.

The workflow builds one generic, platform-neutral VSIX because the extension runs its portable Core as WebAssembly and has no native runtime payload. `npm run package:vsix` performs the existing package audit with `PIXELS_RELEASE_REF` fixed to the release tag and the VSIX pre-release marker fixed to the matching release state. The exact audited file is uploaded as a workflow artifact before the pinned local `@vscode/vsce` 3.9.2 publishes that same path with `--azure-credential` and `--skip-duplicate`. It passes `--pre-release` during both packaging and publication only when the GitHub Release or manual input is marked as a pre-release. Do not replace this with six target-specific packages.

### One-time Microsoft Entra setup

1. Create a Microsoft Entra app registration and its service principal. No Azure subscription is required by this workflow.
2. Add a federated identity credential for the publishing environment with issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject `repo:AntiO2/pixels-vscode-extension:environment:vscode-marketplace`.
3. Create the protected GitHub Environment `vscode-marketplace`. Add environment variables `AZURE_CLIENT_ID` for the app registration and `AZURE_TENANT_ID` for its tenant. These identifiers are not credentials; configure no client secret or PAT. Apply the environment's reviewer and branch/tag protection rules appropriate for releases.
4. Run the workflow manually with `publish` disabled. GitHub OIDC and `azure/login` exchange the job identity for a short-lived Microsoft Entra token. The workflow calls the Visual Studio Marketplace profile endpoint and records its profile ID in both the log and job summary.
5. In the Visual Studio Marketplace publisher management page, add that exact profile ID to publisher `AntiO2` with the Contributor role. Publication will fail until this authorization exists.
6. Run the manual workflow again with `publish` enabled to publish or retry the selected immutable tag. Normal future GitHub Releases publish automatically after any configured environment approval.

`vsce --azure-credential` obtains the Marketplace token from the authenticated Azure CLI session for resource `499b84ac-1321-427f-aa17-267ca6975798/.default`. The job requires only `contents: read` and `id-token: write`; it stores no long-lived credential. Do not create an Azure DevOps Pipeline, project, organization, service connection, Azure DevOps PAT, or Marketplace PAT for this flow. Microsoft retires Azure DevOps global PATs on December 1, 2026, and this workload-identity design already avoids that migration risk.
