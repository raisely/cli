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

function createDeployDependencies(overrides = {}) {
	return {
		loadConfigFn: overrides.loadConfigFn || loadConfig,
		getTokenFn: overrides.getTokenFn || getToken,
		getCampaignFn: overrides.getCampaignFn || getCampaign,
		uploadStylesFn: overrides.uploadStylesFn || uploadStyles,
		updateComponentConfigFn:
			overrides.updateComponentConfigFn || updateComponentConfig,
		updateComponentFileFn: overrides.updateComponentFileFn || updateComponentFile,
		uploadPageFn: overrides.uploadPageFn || uploadPage,
		validateCampaignSassFn:
			overrides.validateCampaignSassFn || validateCampaignSass,
		validateComponentFn: overrides.validateComponentFn || validateComponent,
		globFn: overrides.globFn || glob,
		fsModule: overrides.fsModule || fs,
		pathModule: overrides.pathModule || path,
		logFn: overrides.logFn || log,
		brFn: overrides.brFn || br,
		welcomeFn: overrides.welcomeFn || welcome,
		informUpdateFn: overrides.informUpdateFn || informUpdate,
		loaderFactory: overrides.loaderFactory || ora,
		consoleRef: overrides.consoleRef || console,
		cwd: overrides.cwd || process.cwd,
		setExitCode:
			overrides.setExitCode ||
			((code) => {
				process.exitCode = code;
			}),
	};
}

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

function getComponentNames({ fsModule, pathModule, cwd }) {
	const componentsDir = pathModule.join(cwd(), 'components');
	if (!fsModule.existsSync(componentsDir)) {
		return [];
	}

	return fsModule
		.readdirSync(componentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

async function runPreflightValidation({ config }, dependencies) {
	const deps = createDeployDependencies(dependencies);
	const loader = deps.loaderFactory('Validating campaigns and components').start();
	const campaigns = await Promise.all(
		config.campaigns.map(async (campaignUuid) => {
			const campaign = await deps.getCampaignFn({ uuid: campaignUuid });
			return {
				uuid: campaign.data.uuid,
				path: campaign.data.path,
			};
		})
	);
	const componentNames = getComponentNames(deps);

	const validationTasks = [
		...campaigns.map(async (campaign) => {
			const rawResult = await deps.validateCampaignSassFn({
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
		}),
		...componentNames.map(async (name) => {
			const rawResult = await deps.validateComponentFn({ name });
			const result = normalizeValidationResult(
				rawResult,
				'Component validator returned an invalid response.'
			);
			return {
				ok: result.ok,
				context: `Component ${name}`,
				error: result.error,
			};
		}),
	];

	const results = await Promise.all(validationTasks);
	const failed = results.filter((result) => !result.ok);

	if (failed.length > 0) {
		loader.fail('Deploy validation failed');
		formatValidationErrors(failed).forEach((message) => {
			deps.logFn(message, 'red');
		});
		return false;
	}

	loader.succeed('Validation passed');
	return true;
}

export default async function deploy(options = {}, dependencies = {}) {
	const deps = createDeployDependencies(dependencies);
	const cwd = deps.cwd();
	const layout = detectLayout(cwd);
	if (shouldRefuseLayoutForCommand('deploy', layout)) {
		deps.brFn();
		deps.logFn(getLegacyLayoutRefusalMessage('deploy', layout), 'red');
		deps.setExitCode(1);
		return;
	}

	// load config
	let config = await deps.loadConfigFn();
	config.token = await deps.getTokenFn(program, config);

	deps.welcomeFn();
	deps.logFn(`You are about to deploy your local directly to Raisely`, 'white');
	deps.brFn();
	deps.consoleRef.log(`    ${chalk.inverse(`${cwd}`)}`);
	deps.brFn();
	if (config.apiUrl) {
		deps.brFn();
		deps.consoleRef.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
		deps.brFn();
	}
	deps.logFn(
		`You will overwrite the styles, components, and pages in your campaign.`,
		'white'
	);
	deps.brFn();

	if (!config.cli && !options.force) {
		const response = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirm',
				message: 'Are you sure you want to continue?',
			},
		]);

		if (!response.confirm) {
			deps.brFn();
			return deps.logFn('Deploy aborted', 'red');
		}
	}

	if (options.validate !== false) {
		const validationPassed = await runPreflightValidation({ config }, deps);
		if (!validationPassed) {
			deps.brFn();
			deps.setExitCode(1);
			return;
		}
	} else {
		deps.logFn('Skipping validation due to --no-validate flag.', 'yellow');
	}

	// upload campaign stylesheets
	for (const campaignUuid of config.campaigns) {
		const loader = deps.loaderFactory(`Uploading styles for ${campaignUuid}`).start();

		const campaign = await deps.getCampaignFn({ uuid: campaignUuid });

		try {
			await deps.uploadStylesFn(campaign.data.path);
		} catch (e) {
			loader.fail(`Failed to upload styles for ${campaignUuid}`);
			deps.brFn();
			deps.consoleRef.error(e);
			deps.setExitCode(1);
			return;
		}

		loader.succeed();
	}

	// upload custom components
	const limit = pLimit(5);
	const components = [];

	const componentsDir = deps.pathModule.join(cwd, 'components');
	for (const file of deps.fsModule.readdirSync(componentsDir)) {
		const data = {
			file: deps.fsModule.readFileSync(
				deps.pathModule.join(componentsDir, file, `${file}.js`),
				'utf8'
			),
			config: JSON.parse(
				deps.fsModule.readFileSync(
					deps.pathModule.join(componentsDir, file, `${file}.json`),
					'utf8'
				)
			),
		};

		components.push(limit(() => deps.updateComponentConfigFn(data)));
		components.push(limit(() => deps.updateComponentFileFn(data)));
	}

	// Start loading all the components
	const loader = deps.loaderFactory(`Uploading components`).start();
	const deployResult = await Promise.allSettled(components);

	const rejected = deployResult
		.filter((result) => result.status === 'rejected')
		.map((result) => result.reason);

	if (rejected.length > 0) {
		loader.warn('The following errors occured while uploading components:');
		rejected.forEach((error) => {
			deps.logFn(error, 'red');
		});
	} else {
		loader.succeed();
	}

	// upload pages
	const pageFiles = await deps.globFn('campaigns/*/pages/**/*.json', {
		cwd,
	});

	const pageTasks = [];
	for (const file of pageFiles) {
		const fullPath = deps.pathModule.join(cwd, file);
		const pageData = JSON.parse(deps.fsModule.readFileSync(fullPath, 'utf8'));
		if (!pageData.uuid) {
			continue;
		}
		if (
			pageData.campaignUuid &&
			!config.campaigns.includes(pageData.campaignUuid)
		) {
			continue;
		}
		pageTasks.push(limit(() => deps.uploadPageFn(pageData)));
	}

	let pageRejected = [];
	if (pageTasks.length > 0) {
		const pageLoader = deps.loaderFactory(`Uploading pages`).start();
		const pageResults = await Promise.allSettled(pageTasks);

		pageRejected = pageResults
			.filter((result) => result.status === 'rejected')
			.map((result) => result.reason);

		if (pageRejected.length > 0) {
			pageLoader.warn(
				'The following errors occured while uploading pages:'
			);
			pageRejected.forEach((err) => {
				deps.logFn(err, 'red');
			});
		} else {
			pageLoader.succeed();
		}
	}

	if (rejected.length === 0 && pageRejected.length === 0) {
		await deps.informUpdateFn();
	}
	deps.brFn();
	deps.logFn(`All done!`, 'green');
}
