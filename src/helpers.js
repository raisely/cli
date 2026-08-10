import chalk from 'chalk';
import _ from 'lodash';
import fetch from 'node-fetch';
import fs from 'fs';
import inquirer from 'inquirer';

import api from './actions/api.js';

let updatePromise;
let latestVersion;

export function getPackageInfo() {
	if (!fs.existsSync(new URL('../package.json', import.meta.url), 'utf8')) {
		return {
			name: '@raisely/cli',
			version: null,
		};
	}
	const pkg = JSON.parse(
		fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
	);
	return {
		name: pkg.name,
		version: pkg.version,
	};
}

const NPM_DIST_TAGS_TIMEOUT_MS = 10_000;

function checkUpdate() {
	const pkg = getPackageInfo();
	if (!updatePromise && pkg.version) {
		const url = `https://registry.npmjs.org/-/package/${pkg.name}/dist-tags`;
		const signal = AbortSignal.timeout(NPM_DIST_TAGS_TIMEOUT_MS);
		updatePromise = fetch(url, { signal })
			.then((result) => result.json())
			.then((result) => {
				latestVersion = result.latest;
			})
			.catch(() => {
				// offline, blocked registry, or slow network; ignore
			});
	}
}

export function log(message, color) {
	console.log(chalk[color || 'white'](message));
}

export function br() {
	return console.log('');
}

export function welcome() {
	const pkg = getPackageInfo();
	checkUpdate();
	log(
		`
******************************
Raisely CLI (${pkg.version})
******************************
        `,
		'magenta'
	);
}

export async function informUpdate() {
	const pkg = getPackageInfo();
	if (updatePromise && pkg.version) {
		await updatePromise;
		if (latestVersion > pkg.version) {
			log(
				`
A new version of the Raisely cli is available (${latestVersion}),
See changes at: https://github.com/raisely/cli/blob/master/CHANGELOG.md
To update, run:
		npm update @raisely/cli
`,

				'white'
			);
		}
	}
}

export async function informLocalDev(config) {
	const authData = await api({
		path: '/authenticate',
	});
	// /authenticate carries identity flat at the top level but no organisation
	// record, so the localDevelopment flag has to be read from the org itself.
	const organisationUuid =
		config?.organisationUuid || authData?.organisationUuid;

	let organisation;
	if (organisationUuid) {
		try {
			const orgResponse = await api({
				path: `/organisations/${organisationUuid}?private=1`,
			});
			organisation = orgResponse?.data;
		} catch (e) {
			// No OAuth app scope grants reading an organisation record, so this
			// is a 403 for any CLI login and only succeeds for admin tokens
			// supplied via RAISELY_TOKEN. The flag is advisory, so skip the
			// warning rather than blocking the command.
		}
	}

	if (!organisation?.private?.localDevelopment) {
		// this is fine, we can continue without warning
		return true;
	}

	log(
		`This Raisely account is set up to require local development, which usually means that you are required to use version control.`,
		'white'
	);
	br();
	log(
		`If you continue, your changes may be overwritten by a future deployment.`,
		'white'
	);
	br();
	// collect login details
	const response = await inquirer.prompt([
		{
			type: 'confirm',
			name: 'confirm',
			message: 'Are you sure you want to continue?',
		},
	]);

	if (!response.confirm) {
		br();
		log('Command aborted', 'red');
		return false;
	}

	return true;
}

export function error(e, loader) {
	const message =
		_.get(e, 'response.body.errors[0].message') || e.message || e;
	if (loader) {
		loader.fail(message);
	} else {
		console.log(`${chalk.bgRed('Error:')} ${chalk.red(message)}`);
	}
}
