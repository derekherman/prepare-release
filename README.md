# Prepare Release (GitHub Action)

[![CI/CD Pipeline](https://github.com/derekherman/prepare-release/workflows/CI/CD%20Pipeline/badge.svg?branch=develop)](https://github.com/derekherman/prepare-release/actions?query=workflow%3A%22CI%2FCD+Pipeline%22)

@todo

## Usage

```yaml
- name: Prepare Release
  id: prepare-release
  continue-on-error: true
  uses: derekherman/prepare-release@main
  with:
    baseRef: ${{ github.base_ref }}
    headRef: ${{ github.head_ref }}
    tagRef: ${{ steps.package-version.outputs.current-version }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Create Release
    uses: actions/create-release@v1
    if: steps.prepare-release.outcome == 'success' && steps.prepare-release.conclusion == 'success'
    with:
      tag_name: ${{ steps.package-version.outputs.current-version }}
      release_name: ${{ steps.package-version.outputs.current-version }}
      body: |
        ${{ steps.prepare-release.outputs.changelog }}
        ${{ steps.prepare-release.outputs.props }}
      prerelease: ${{ contains(github.ref, '-rc') || contains(github.ref, '-b') || contains(github.ref, '-a') }}
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

See the [actions tab](https://github.com/derekherman/prepare-release/actions) for runs of this action! :rocket:
