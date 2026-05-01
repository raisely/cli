import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import glob from 'glob-promise';

import { welcome, log, br, informUpdate } from './helpers.js';
import { uploadStyles, getCampaign } from './actions/campaigns.js';
import {
	updateComponentFile,
	updateComponentConfig,
} from './actions/components.js';
import { uploadPage } from './actions/pages.js';
import { loadConfig } from './config.js';
import { getToken } from './actions/auth.js';

export default async function deploy(options = {}) {
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
		`You will overwrite the styles, components, and pages in your campaign.`,
		'white'
	);
	br();

	if (!config.cli && !options.force) {
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
			await uploadStyles(campaign.data.path);
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
	}

	// upload pages
	const pageFiles = await glob('campaigns/*/pages/**/*.json', {
		cwd: process.cwd(),
	});

	const pageTasks = [];
	for (const file of pageFiles) {
		const fullPath = path.join(process.cwd(), file);
		const pageData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
		if (!pageData.uuid) {
			continue;
		}
		if (
			pageData.campaignUuid &&
			!config.campaigns.includes(pageData.campaignUuid)
		) {
			continue;
		}
		pageTasks.push(limit(() => uploadPage(pageData)));
	}

	let pageRejected = [];
	if (pageTasks.length > 0) {
		const pageLoader = ora(`Uploading pages`).start();
		const pageResults = await Promise.allSettled(pageTasks);

		pageRejected = pageResults
			.filter((result) => result.status === 'rejected')
			.map((result) => result.reason);

		if (pageRejected.length > 0) {
			pageLoader.warn(
				'The following errors occured while uploading pages:'
			);
			pageRejected.forEach((err) => {
				log(err, 'red');
			});
		} else {
			pageLoader.succeed();
		}
	}

	if (rejected.length === 0 && pageRejected.length === 0) {
		await informUpdate();
	}
	br();
	log(`All done!`, 'green');
}
