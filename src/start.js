import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

import {
	welcome,
	log,
	br,
	error,
	informUpdate,
	informLocalDev,
} from './helpers.js';
import watch from 'node-watch';
import {
	detectLayout,
	shouldRefuseLayoutForCommand,
	getLegacyLayoutRefusalMessage,
} from './actions/layout.js';

import { uploadStyles } from './actions/campaigns.js';
import { uploadPage } from './actions/pages.js';
import {
	updateComponentFile,
	updateComponentConfig,
} from './actions/components.js';
import { validateCampaignSass, validateComponent } from './actions/validate.js';
import { getToken } from './actions/auth.js';
import { loadConfig } from './config.js';

function startLoader(message, oraImpl = ora) {
	return oraImpl(message).start();
}

/**
 * Upload a single page JSON, applying the same guards as `raisely deploy`:
 * the page must have a uuid and belong to a configured campaign.
 */
async function uploadChangedPage(
	filenameRaw,
	relative,
	{ config, fsModule, uploadPageFn, oraFn, errorFn }
) {
	const loader = startLoader(`Saving ${relative}`, oraFn);

	let pageData;
	try {
		pageData = JSON.parse(fsModule.readFileSync(filenameRaw, 'utf8'));
	} catch (e) {
		loader.fail(`${relative} is not valid JSON, skipping upload`);
		return;
	}

	if (!pageData.uuid) {
		loader.fail(`${relative} has no uuid, skipping upload`);
		return;
	}

	const campaigns = config?.campaigns ?? [];
	if (
		!pageData.campaignUuid ||
		!campaigns.includes(pageData.campaignUuid)
	) {
		loader.fail(
			`${relative} does not belong to a configured campaign, skipping upload`
		);
		return;
	}

	try {
		await uploadPageFn(pageData);
		loader.succeed();
	} catch (e) {
		errorFn(e, loader);
	}
}

export async function handleCampaignChange(
	filenameRaw,
	{
		campaignsDir,
		token,
		config,
		fsModule = fs,
		uploadStylesFn = uploadStyles,
		uploadPageFn = uploadPage,
		validateCampaignSassFn = validateCampaignSass,
		oraFn = ora,
		errorFn = error,
	} = {}
) {
	const relative = path.relative(campaignsDir, filenameRaw);
	const parts = relative.split(path.sep);
	if (parts.length < 3) return;
	const campaignPath = parts[0];

	if (parts[1] === 'pages' && relative.endsWith('.json')) {
		return await uploadChangedPage(filenameRaw, relative, {
			config,
			fsModule,
			uploadPageFn,
			oraFn,
			errorFn,
		});
	}

	// Anything else under a campaign other than stylesheets is not uploaded
	if (parts[1] !== 'stylesheets') return;
	const loader = startLoader(`Saving ${relative}`, oraFn);
	const validation = await validateCampaignSassFn({
		campaign: campaignPath,
		token,
	});
	if (!validation.ok) {
		loader.fail(validation.error);
		return;
	}
	await uploadStylesFn(campaignPath);
	loader.succeed();
}

export async function handleComponentChange(
	filenameRaw,
	{
		componentsDir,
		config,
		fsModule = fs,
		pathModule = path,
		updateComponentFileFn = updateComponentFile,
		updateComponentConfigFn = updateComponentConfig,
		validateComponentFn = validateComponent,
		oraFn = ora,
		errorFn = error,
	} = {}
) {
	const filename = pathModule.relative(componentsDir, filenameRaw);
	const componentName = filename.split(pathModule.sep)[0];
	if (!componentName) return;
	const loader = startLoader(`Saving ${filename}`, oraFn);
	const validation = await validateComponentFn({ name: componentName });
	if (!validation.ok) {
		loader.fail(validation.error);
		return;
	}

	try {
		if (filename.includes('.json')) {
			await updateComponentConfigFn(
				{
					filename,
					file: fsModule.readFileSync(
						pathModule.join(
							componentsDir,
							filename.replace('.json', '.js')
						),
						'utf8'
					),
					config: JSON.parse(
						fsModule.readFileSync(pathModule.join(componentsDir, filename), 'utf8')
					),
				},
				config
			);
		} else {
			await updateComponentFileFn(
				{
					filename,
					file: fsModule.readFileSync(pathModule.join(componentsDir, filename), 'utf8'),
					config: JSON.parse(
						fsModule.readFileSync(
							pathModule.join(
								componentsDir,
								filename.replace('.js', '.json')
							),
							'utf8'
						)
					),
				},
				config
			);
		}
	} catch (e) {
		return errorFn(e, loader);
	}

	loader.succeed();
}

export function registerStartWatchers(
	{
		campaignsDir,
		componentsDir,
		config,
		watchFn = watch,
	} = {},
	dependencies = {}
) {
	const campaignWatcher = watchFn(
		campaignsDir,
		{ encoding: 'utf8', recursive: true },
		async (eventType, filenameRaw) => {
			await handleCampaignChange(filenameRaw, {
				campaignsDir,
				token: config.token,
				config,
				uploadStylesFn: dependencies.uploadStylesFn,
				uploadPageFn: dependencies.uploadPageFn,
				validateCampaignSassFn: dependencies.validateCampaignSassFn,
				oraFn: dependencies.oraFn,
				errorFn: dependencies.errorFn,
			});
		}
	);

	const componentWatcher = watchFn(
		componentsDir,
		{ encoding: 'utf8', recursive: true },
		async (eventType, filenameRaw) => {
			await handleComponentChange(filenameRaw, {
				componentsDir,
				config,
				fsModule: dependencies.fsModule,
				pathModule: dependencies.pathModule,
				updateComponentFileFn: dependencies.updateComponentFileFn,
				updateComponentConfigFn: dependencies.updateComponentConfigFn,
				validateComponentFn: dependencies.validateComponentFn,
				oraFn: dependencies.oraFn,
				errorFn: dependencies.errorFn,
			});
		}
	);

	return { campaignWatcher, componentWatcher };
}

export default async function start() {
	const layout = detectLayout(process.cwd());
	if (shouldRefuseLayoutForCommand('start', layout)) {
		br();
		log(getLegacyLayoutRefusalMessage('start', layout), 'red');
		process.exitCode = 1;
		return;
	}

	welcome();

	// load config
	const config = await loadConfig();
	// Load token, which will prompt a login if the token is expired
	config.token = await getToken(program, config, true);

	await informUpdate();
	if (!(await informLocalDev(config))) return;

	log(`Watching and uploading changes in this directory`, 'white');
	br();
	console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
	br();
	if (config.apiUrl) {
		br();
		console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
		br();
	}
	log(`Use CTRL + C to stop`, 'white');

	// watch folders
	const campaignsDir = path.join(process.cwd(), 'campaigns');
	const componentsDir = path.join(process.cwd(), 'components');
	registerStartWatchers({ campaignsDir, componentsDir, config });
}
