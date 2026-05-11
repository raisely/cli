
# 2.0.0
- Breaking layout change: per-campaign content now lives in `campaigns/<campaign-path>/`, the entry SCSS file is now `main.scss`, and shared components remain at the repo root.
- Added `raisely migrate` to upgrade existing repositories from the v1 layout to the v2 layout.
- Added SCSS and component validation for `raisely deploy` (with `--no-validate`) and per-save validation for `raisely start`.
- Improved `raisely local` resilience by serving the last successful CSS when compilation fails, removing the 5-second retry loop, and removing process exit on transpiler 401 responses.
- Removed v1 compatibility read paths; v2 commands now require the v2 layout.

# 1.8.3
- Fix redirects for `raisely local`

# 1.8.2
- Updates CLI to support Raisely's expanded MFA options

# 1.8.1
- Fixes bug with logging in using MFA

# 1.7.0
- Now requires node v14+ LTS (esm no longer required)
- Added better command-line experience (more logs)
- Updated commander.js
- Implemented dynamic imports for commands (faster, only load modules when needed for each command)
- Applied code formatting to match internal development standards

# 1.6.5

- Fixed win32 filesystem handling
- Fixed performance issue with Babel loading in before component deploy (causing long pauses)
- Some minor dead code removal
- Fixed api layer to use correct error handling (based on response headers), instead of relying on original payload

# 1.6.2

- Fixed a bug where `raisely local` was failing due to socket errors on file changes.
- Better error handling for local style and component compiling

# 1.6.1

- Fix: Deploy was uploading blank files

# 1.6.0

- Allow multiple developers to work on the one Raisely website with local compiling of components and styles.
- Support for GitHub Actions and version managed workflows.

# 1.5.2

- Fix style watching/compiling on Windows

# 1.5.1

- Add support for 2 factor authentication

# 1.5.0

- Fix style sync compatibility issues on Windows

# 1.4.1

- Gracefully handle expired tokens and offer to log user in
- Add `raisely login` command to manually change login
- Offer to switch user to the correct account if they are logged into another
- Notify the user when updates to the cli are available

# 1.4.0

- Add support for [CI/CD](https://github.com/raisely/cli#cicd-usage) with `raisely deploy`

# 1.3.0

- Add support for folders and multiple SCSS files
