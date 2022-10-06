import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';

import { welcome, log, br, informUpdate } from './helpers.js';
import { uploadStyles, getCampaign } from './actions/campaigns.js';
import {
	updateComponentFile,
	updateComponentConfig,
} from './actions/components.js';
import { loadConfig } from './config.js';
import { getToken } from './actions/auth.js';

export default async function deploy() {
	// load config
	let config = await loadConfig();
	await getToken(program, config);

	welcome();
	log(`You are about to deploy your local directly to Raisely`, 'white');
	br();
	console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
	br();
	if (config.apiUrl) {
		br();
		console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
		br();
	}
	log(
		`You will overwrite the styles and components in your campaign.`,
		'white'
	);
	br();

	if (!config.cli) {
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
			return log('Deploy aborted', 'red');
		}
	}

	// upload campaign stylesheets
	for (const campaignUuid of config.campaigns) {
		const loader = ora(`Uploading styles for ${campaignUuid}`).start();

		const campaign = await getCampaign({ uuid: campaignUuid });

		try {
			await uploadStyles(
				`${campaign.data.path}${path.sep}${campaign.data.path}.scss`
			);
		} catch (e) {
			br();
			console.error(e);
			process.exit(1);
		}

		loader.succeed();
	}

	// upload custom components
	const limit = pLimit(5);
	const components = [];

	const componentsDir = path.join(process.cwd(), 'components');
	for (const file of fs.readdirSync(componentsDir)) {
		const data = {
			file: fs.readFileSync(
				path.join(componentsDir, file, `${file}.js`),
				'utf8'
			),
			config: JSON.parse(
				fs.readFileSync(
					path.join(componentsDir, file, `${file}.json`),
					'utf8'
				)
			),
		};

		components.push(limit(() => updateComponentConfig(data)));
		components.push(limit(() => updateComponentFile(data)));
	}

	// Start loading all the components
	const loader = ora(`Uploading components`).start();
	const deployResult = await Promise.allSettled(components);

	const rejected = deployResult
		.filter((result) => result.status === 'rejected')
		.map((result) => result.reason);

	if (rejected.length > 0) {
		loader.warn('The following errors occured while uploading components:');
		rejected.forEach((error) => {
			log(error, 'red');
		});
	} else {
		loader.succeed();
		await informUpdate();
	}
	br();
	log(`All done!`, 'green');
}
