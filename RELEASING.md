# Releasing

The CLI is published to npm as [`zark`](https://www.npmjs.com/package/zark) by `.github/workflows/release.yml` when a version tag is pushed.

1. Bump `version` in `packages/cli/package.json` (semver) on `main`, via a PR.
2. Tag and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. The workflow checks that the tag matches the version, runs typecheck, build and the full test suite, installs the packed tarball in an empty project and follows the README (`scripts/smoke-pack.mjs`), then publishes with provenance and creates a GitHub release.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token lives in the repository. One-time setup on npmjs.com: package `zark` → Settings → Trusted publisher → GitHub Actions, repository `yvanfreitas/zark`, workflow `release.yml`.

To check a release locally before tagging:

```sh
pnpm build
cd packages/cli && npm pack --ignore-scripts && cd ../..
node scripts/smoke-pack.mjs packages/cli/zark-*.tgz
```
