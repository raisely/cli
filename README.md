# Raisely CLI

![Raisely logo](https://raisely-images.imgix.net/www/uploads/lockup-default-svg-d0b31f.svg?fit=max&w=300&auto=format&q=62)

The Raisely CLI is used to power local development of Raisely themes, syncing custom components, campaign styles, and campaign pages to your local machine.

For more about Raisely, see <https://raisely.com>

## Overview

The Raisely CLI allows for fast and easy development on the Raisely platform. The CLI allows you to connect a directory on your local computer to a Raisely account. With the CLI you can update campaign stylesheets, edit and create custom React components, and edit page layout JSON under `pages/`.

The CLI is built on Node.js, so you'll need Node.js installed to use it.

For an intro and an explainer on local development in Raisely, read our [Raisely Developers Quickstart](https://developers.raisely.com/docs/developer-quickstart).

## Issues

For problems directly related to the CLI, [add an issue on GitHub](https://github.com/raisely/cli/issues/new).

For other issues, [submit a support ticket](mailto:support@raisely.com).

## Getting Started

1. Install the CLI globally: `npm install @raisely/cli -g`
2. Go into your working directory and run: `raisely init`

## Commands

-   `raisely init` - start a new Raisely project and sync your campaigns
-   `raisely list` - list every campaign (Name, Uuid), sorted A-Z; prints a padded table in a terminal, TSV when stdout is piped (`raisely list | cut -f2`), and `--json` / `--tsv` force a format
-   `raisely login` - sign in with OAuth (opens your browser); stores access and refresh tokens in the OS keychain
-   `raisely logout` - revoke the current access token when possible and clear keychain storage for this org
-   `raisely update` - update local copies of styles, components, and pages from the API
-   `raisely create [name]` - create a new custom component, optionally add the component name to the command (otherwise you will be asked for one)
-   `raisely start` - starts watching for and uploading changes to styles and components
-   `raisely deploy` - deploy your local code to Raisely (styles, components, and pages)
-   `raisely local` - work locally on a Raisely campaign without syncing changes up (includes local page JSON overrides when `pages/` is present)

### Custom public host (`raisely local`)

By default, `raisely local` proxies to `https://{campaign.path}.raisely.com`. If the site people visit is on another host (for example `https://{campaign.path}.raiselysite.com`), add **`proxyUrl`** to `.raisely.json` with the bare domain (no campaign subdomain):

```json
{
	"proxyUrl": "https://raiselysite.com"
}
```

The CLI turns that into `https://{campaign.path}.raiselysite.com` so the proxy matches production.

## Authentication

Interactive use relies on **OAuth 2.0 with PKCE** against `https://api.raisely.com/v1/oauth/authorize` and `/v1/oauth/token` (or your `RAISELY_API_URL` host for staging, for example `https://api.raisely.io`).

1. Register a **NATIVE** app in Raisely admin (Settings → Apps), add loopback redirect URIs such as `http://127.0.0.1:8765/callback` (and 8766, 8767), and note the app `client_id` (UUID).
2. Set **`RAISELY_OAUTH_CLIENT_ID`** to that UUID before running `raisely login` or `raisely init`. The CLI ships with a placeholder `client_id` until you replace it in the package.
3. Optional: **`RAISELY_OAUTH_SCOPES`** overrides the default scopes (`campaigns:read campaigns:update pages:read`).

Tokens are stored in the OS keychain under service `@raisely/cli`, with account name `{api_host}:{organisation_uuid}` (for example `api.raisely.com:aaaaaaaa-...`). The file `~/.raisely/session.json` records the last successful login’s host and organisation so commands work before `.raisely.json` exists.

**Credential resolution order** for API calls:

1. `RAISELY_TOKEN` (personal access token / campaign key), if set
2. Keychain session for the current API host + `organisationUuid` (from `.raisely.json` or the session pointer)
3. Legacy `token` field in `.raisely.json`

## CI/CD Usage

Raisely CLI supports usage in a CI/CD environment for auto-deployment of styles and components. In this scenario you would use the CLI to deploy local code, and overwrite what is on a Raisely campaign or account.

Raisely CLI supports the following environment variables:

-   `RAISELY_TOKEN` – your API secret key (overrides keychain and `.raisely.json` token)
-   `RAISELY_CAMPAIGNS` - a comma-separated list of campaign uuids to sync (so you can be selective)
-   `RAISELY_OAUTH_CLIENT_ID` - OAuth NATIVE app client id (required for `raisely login` until a built-in id ships)
-   `RAISELY_OAUTH_SCOPES` - optional space-separated OAuth scopes
-   `RAISELY_API_URL` - API base URL (default `https://api.raisely.com`)

_Note: All components are always synced, when they're present in the directory your syncing_

With these environment variables set, run: `raisely deploy`. This will sync your local directory to the remote Raisely account, overwriting the styles, components, and pages on the destination campaign.

## Developing

Contributions are welcome. The project is built with `commander`, `inquirer` and `ora` with a basic module structure.
