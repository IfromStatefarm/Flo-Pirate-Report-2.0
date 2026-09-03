# Stabilization baseline

## Captured source state

- Date: 2026-09-03
- Branch: `codex-refractor`
- HEAD: `77bb89e5b9000b61d15b5a53a8c0d6cf859b3477`
- Snapshot type: full working tree excluding `.git` and the `stabilization` directory
- Tracked-change backup: binary Git patch generated against the HEAD above

The baseline contained these modified tracked files:

```text
README.md
background/main.js
background/services/reporting_workflow.js
clippy.js
content_autofill.js
content_scraper.js
events_config.json
manifest.json
options.html
options/main.js
popup/main.js
services/sheet_scanner.js
sidepanel.html
sidepanel/main.js
utils/google_api.js
utils/platform_catalog.js
utils/platforms.js
```

It also contained these untracked files:

```text
ACCESS_CONTROL_OUTLINE.md
services/access_registry.js
utils/access_control.js
```

## Recovery artifacts

| Artifact | Purpose | SHA-256 |
| --- | --- | --- |
| `stabilization/snapshots/Flo-Pirate-Report-2.0-pre-white-label-2026-09-03.tar.gz` | Complete tracked and untracked working tree | `ab77eee5d26b7cb731a10c94dc11f1aa7834dc2c1e9d1d951507dac4edbf3e5e` |
| `stabilization/snapshots/pre-white-label-tracked-changes-2026-09-03.patch` | Tracked changes only, suitable for review or application to the captured HEAD | `b5a4eeb357fc51ad04608ee7639b9753229bd1f8364e4c5f6ba9cf90dacc8c2c` |

The archive passed `gzip -t` and its contents were listed successfully. The patch passed `git apply --check` against a clean export of the captured HEAD. Applying it directly to the already-modified working tree is expected to fail because those changes are already present.

## Safe recovery

Restore into a new empty directory rather than extracting over the live repository:

```bash
mkdir -p /private/tmp/flo-pre-white-label-restore
tar -xzf stabilization/snapshots/Flo-Pirate-Report-2.0-pre-white-label-2026-09-03.tar.gz \
  -C /private/tmp/flo-pre-white-label-restore
```

To reproduce only tracked changes, check out commit `77bb89e5b9000b61d15b5a53a8c0d6cf859b3477` in a separate working directory and run:

```bash
git apply --binary /absolute/path/to/stabilization/snapshots/pre-white-label-tracked-changes-2026-09-03.patch
```

Use the full archive to recover the three untracked access-control files.

## Baseline observations

- This is a plain Manifest V3 extension without an existing package/test runner in the repository.
- `popup.html` references `style.css`, but that file is not present in the working tree.
- `utils/clippy_assets.js` references `images/clippy talking.gif`, but that file is not present.
- The working tree already contains a large access-control implementation. Future changes must build on it or deliberately replace it; they must not assume the repository matches HEAD.
- The runtime code was not edited during this baseline step.
