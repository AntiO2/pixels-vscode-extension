# Release package decisions

The generic VSIX includes `examples/customer.pxl` so a new user has a small real file to open immediately. The 21,632-byte example compresses to 4,409 bytes in the VSIX. Release screenshots stay in the repository for README and Marketplace HTTPS rendering and are intentionally excluded from the extension payload.

The current local release candidate is 376.51 KiB compressed with 20 members. This exceeds the 300 KiB review threshold because the portable Core WASM contributes 141,244 compressed bytes and the Webview bundle contributes 104,048 compressed bytes. The customer example adds about 1.2% of the compressed package and is retained because it directly supports first-use evaluation. No native binary, JVM artifact, service, or platform-specific payload is included.

## Marketplace automation

Publishing uses `.github/workflows/publish-marketplace.yml`. A published GitHub Release always runs the workflow. A manual run requires an exact `v<package.json version>` tag and explicit pre-release choice; the tag must already have a non-draft GitHub Release whose pre-release state matches that choice. Its `publish` switch defaults to off so the identity can be bootstrapped and the audited artifact inspected without changing the Marketplace. A deliberate retry of an existing release enables `publish`. The workflow never increments or rewrites `package.json` and accepts only an exact `v<major>.<minor>.<patch>` tag whose commit matches the checkout.

The workflow builds one generic, platform-neutral VSIX because the extension runs its portable Core as WebAssembly and has no native runtime payload. `npm run package:vsix` performs the existing package audit with `PIXELS_RELEASE_REF` fixed to the release tag and the VSIX pre-release marker fixed to the matching release state. The exact audited file is uploaded as a workflow artifact before the pinned local `@vscode/vsce` 3.9.2 publishes that same path with `--azure-credential` and `--skip-duplicate`. It passes `--pre-release` during both packaging and publication only when the GitHub Release or manual input is marked as a pre-release. Do not replace this with six target-specific packages.

### One-time Microsoft Entra setup

1. Create a Microsoft Entra app registration and its service principal. No Azure subscription is required by this workflow.
2. Add a federated identity credential for the publishing environment with issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and immutable subject `repo:AntiO2@46259425/pixels-vscode-extension@1317385145:environment:vscode-marketplace`. The GitHub owner ID is `46259425` and the repository ID is `1317385145`; the Environment value is `vscode-marketplace`, while the credential's display name may be `github-vscode-marketplace`.
3. Create the protected GitHub Environment `vscode-marketplace`. Add environment variables `AZURE_CLIENT_ID` for the app registration and `AZURE_TENANT_ID` for its tenant. These identifiers are not credentials; configure no client secret or PAT. Apply the environment's reviewer and branch/tag protection rules appropriate for releases.
4. Keep the empty Azure DevOps organization `antio2-marketplace` connected to tenant `8ac5ced3-d5a9-41a1-bd76-517fe48afc4a`. Add the service principal `pixels-vscode-marketplace-publisher` under Organization settings > Users with Basic access and no project or group assignment. This one-time registration creates the Visual Studio Services profile required by the Marketplace backend. Do not create an Azure DevOps project, repository, pipeline, or service connection.
5. Run the workflow manually with `publish` disabled. GitHub OIDC and `azure/login` exchange the job identity for a short-lived Microsoft Entra token. The workflow calls the Visual Studio Marketplace profile endpoint and records its profile ID in both the log and job summary. The configured publishing identity currently resolves to `035e1961-de6c-6364-86a1-29a0fb88a290`.
6. Create publisher `AntiO2` if it does not exist, then add that exact profile ID under Members with the Contributor role. Publication fails until this authorization exists.
7. Run the manual workflow again with `publish` enabled to publish or retry the selected immutable tag. Normal future GitHub Releases publish automatically after any configured environment approval.

`vsce --azure-credential` obtains the Marketplace token from the authenticated Azure CLI session for resource `499b84ac-1321-427f-aa17-267ca6975798/.default`. The job requires only `contents: read` and `id-token: write`; it stores no long-lived credential. The empty Azure DevOps organization exists only to register the service principal with the Marketplace identity backend. Do not create an Azure DevOps Pipeline, project, repository, service connection, Azure DevOps PAT, or Marketplace PAT for this flow. Microsoft retires Azure DevOps global PATs on December 1, 2026, and this workload-identity design already avoids that migration risk.

## Publishing a new version

Prepare the next exact three-part version without creating a tag automatically. For example, to prepare the stable `0.2.0` release:

```sh
npm version 0.2.0 --no-git-tag-version
```

Run the complete local gate, commit both version files, push the release commit, and wait for the push CI to succeed:

```sh
npm run check
git add package.json package-lock.json
git commit -m "chore(release): prepare v0.2.0"
git push origin master
```

Create the GitHub Release from the exact reviewed commit. Publishing the non-draft Release triggers `.github/workflows/publish-marketplace.yml`, which rebuilds and audits one generic VSIX before publishing that exact artifact to the Marketplace:

```sh
release_commit="$(git rev-parse HEAD)"
gh release create v0.2.0 --target "$release_commit" --title "v0.2.0" --generate-notes
```

The package version, tag, and GitHub Release must match exactly: `0.2.0`, `v0.2.0`, and `v0.2.0`. Do not publish the Release until the release commit's CI is green. A draft Release does not publish to the Marketplace until it is published.

For a Marketplace pre-release, keep the same three-part version format, create the matching `v<major>.<minor>.<patch>` tag, and mark the GitHub Release as a pre-release. Do not use a suffix such as `-beta.1`; the release workflow intentionally rejects it. Marketplace pre-release and stable packages cannot reuse the same version, so reserve a distinct version for the later stable release.

If automatic publication must be retried for an existing non-draft GitHub Release, manually run `Publish to VS Code Marketplace` with the exact tag and matching pre-release state, then explicitly enable `publish`. Leave `publish` disabled for identity or package dry runs.
