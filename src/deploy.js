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
	detectLayout,
	shouldRefuseLayoutForCommand,
	getLegacyLayoutRefusalMessage,
} from './actions/layout.js';
import {
	updateComponentFile,
	updateComponentConfig,
} from './actions/components.js';
import { uploadPage } from './actions/pages.js';
import { loadConfig } from './config.js';
import { getToken } from './actions/auth.js';
import {
	validateCampaignSass,
	validateComponent,
} from './actions/validate.js';

function formatValidationErrors(errors) {
	return errors.map(({ context, error }) => `${context}: ${error}`);
}

function normalizeValidationResult(result, fallbackError) {
	if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
		return {
			ok: result.ok,
			error:
				typeof result.error === 'string' && result.error.trim()
					? result.error
					: fallbackError,
		};
	}

	return {
		ok: false,
		error: fallbackError,
	};
}

function getComponentNames() {
	const componentsDir = path.join(process.cwd(), 'components');
	if (!fs.existsSync(componentsDir)) {
		return [];
	}

	return fs
		.readdirSync(componentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

async function runPreflightValidation({ config }) {
	const validationLimit = pLimit(4);
	const loader = ora('Validating campaigns and components').start();
	const campaigns = await Promise.all(
		config.campaigns.map(async (campaignUuid) => {
			const campaign = await getCampaign({ uuid: campaignUuid });
			return {
				uuid: campaign.data.uuid,
				path: campaign.data.path,
			};
		})
	);
	const componentNames = getComponentNames();

	const validationTasks = [
		...campaigns.map((campaign) =>
			validationLimit(async () => {
				const rawResult = await validateCampaignSass({
					campaign,
					token: config.token,
				});
				const result = normalizeValidationResult(
					rawResult,
					'SASS validator returned an invalid response.'
				);
				return {
					ok: result.ok,
					context: `Campaign ${campaign.path}`,
					error: result.error,
				};
			})
		),
		...componentNames.map((name) =>
			validationLimit(async () => {
				const rawResult = await validateComponent({ name });
				const result = normalizeValidationResult(
					rawResult,
					'Component validator returned an invalid response.'
				);
				return {
					ok: result.ok,
					context: `Component ${name}`,
					error: result.error,
				};
			})
		),
	];

	const results = await Promise.all(validationTasks);
	const failed = results.filter((result) => !result.ok);

	if (failed.length > 0) {
		loader.fail('Deploy validation failed');
		formatValidationErrors(failed).forEach((message) => {
			log(message, 'red');
		});
		return false;
	}

	loader.succeed('Validation passed');
	return true;
}

export default async function deploy(options = {}) {
	const cwd = process.cwd();
	const layout = detectLayout(cwd);
	if (shouldRefuseLayoutForCommand('deploy', layout)) {
		br();
		log(getLegacyLayoutRefusalMessage('deploy', layout), 'red');
		process.exitCode = 1;
		return;
	}

	// load config
	let config = await loadConfig();
	config.token = await getToken(program, config);

	welcome();
	log(`You are about to deploy your local directly to Raisely`, 'white');
	br();
	console.log(`    ${chalk.inverse(`${cwd}`)}`);
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

	if (options.validate !== false) {
		const validationPassed = await runPreflightValidation({ config });
		if (!validationPassed) {
			br();
			process.exitCode = 1;
			return;
		}
	} else {
		log('Skipping validation due to --no-validate flag.', 'yellow');
	}

	// upload campaign stylesheets
	for (const campaignUuid of config.campaigns) {
		const loader = ora(`Uploading styles for ${campaignUuid}`).start();

		const campaign = await getCampaign({ uuid: campaignUuid });

		try {
			await uploadStyles(campaign.data.path);
		} catch (e) {
			loader.fail(`Failed to upload styles for ${campaignUuid}`);
			br();
			console.error(e);
			process.exitCode = 1;
			return;
		}

		loader.succeed();
	}

	// upload custom components
	const limit = pLimit(5);
	const components = [];

	const componentsDir = path.join(cwd, 'components');
	if (fs.existsSync(componentsDir)) {
		for (const file of fs.readdirSync(componentsDir)) {
			const data = {
				file: fs.readFileSync(path.join(componentsDir, file, `${file}.js`), 'utf8'),
				config: JSON.parse(
					fs.readFileSync(path.join(componentsDir, file, `${file}.json`), 'utf8')
				),
			};

			components.push(limit(() => updateComponentConfig(data)));
			components.push(limit(() => updateComponentFile(data)));
		}
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
		cwd,
	});

	const pageTasks = [];
	for (const file of pageFiles) {
		const fullPath = path.join(cwd, file);
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
