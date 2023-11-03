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

function checkUpdate() {
	const pkg = getPackageInfo();
	if (!updatePromise && pkg.version) {
		const url = `https://registry.npmjs.org/-/package/${pkg.name}/dist-tags`;
		updatePromise = fetch(url)
			.then((result) => result.json())
			.then((result) => {
				latestVersion = result.latest;
			})
			.catch((e) => {
				// noop
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
	const organisation = authData.data.organisation;
	if (!organisation.private || !organisation.private.localDevelopment) {
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

export function requiresMfa(e) {
	return e.subcode && e.subcode.startsWith('MFA required');
}

export function getMfaStrategy(e) {
	// Extract if it's authy or authenticator
	const subcodeArray = e.subcode.split(':');
	const authType = subcodeArray[1];

	return {
		mfaType: authType,
		// if authenticator, we need to know whether to offer authy as alternative
		hasAuthy:  Boolean(
			authType === 'AUTHY' ||
				(subcodeArray.length === 3 &&
					subcodeArray[2] === 'hasAuthy')
			)
	}
}