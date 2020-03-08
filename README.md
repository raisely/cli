# Raisely CLI

![Raisely logo](https://raisely-themes.imgix.net/raisely/brand.raisely.svg)

The Raisely CLI is used to power local development of Raisely themes, syncing custom components and campaign styles to your local machine.

For more about Raisely, see <https://raisely.com>

## Overview

The Raisely CLI allows for fast and easy development on the Raisely platform. The CLI allows you to connect a directory on your local computer to a Raisely account. With the CLI you can update campaign stylesheets, and edit and create custom React components.

The CLI is built on Node.js, so you'll need Node.js installed to use it.

## Issues

For problems directly related to the CLI, [add an issue on GitHub](https://github.com/raisely/cli/issues/new).

For other issues, [submit a support ticket](mailto:support@raisely.com).

## Getting Started

1. Install the CLI globally: `npm install @raisely/cli -g`
2. Go into your working directory and run: `raisely init`

## Commands

-   `raisely init` - start a new Raisely project, authenticate and sync your campaigns
-   `raisely update` - update local copies of styles and components from the API
-   `raisely create [name]` - create a new custom component, optionally add the component name to the command (otherwise you will be asked for one)
-   `raisely start` - starts watching for and uploading changes to styles and components

## CI/CD Usage

Raisely CLI supports usage in a CI/CD environment for auto-deployment of styles and components. In this scenario you would use the CLI to deploy local code, and overwrite what is on a Raisely campaign or account.

Raisely CLI supports the following environment variables:

-   `RAISELY_TOKEN` – your API secret key
-   `RAISELY_CAMPAIGNS` - a comma-separated list of campaign uuids to sync (so you can be selective)

_Note: All components are always synced, when they're present in the directory your syncing_

With these environment variables set, run: `raisely deploy`. This will sync your local directory to the remote Raisely account, overwriting the styles and components on the destination campaign.

## Developing

Contributions are welcome. The project is built with `commander`, `inquirer` and `ora` with a basic module structure.
