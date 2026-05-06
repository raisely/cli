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

export async function handleCampaignChange(
	filenameRaw,
	{
		campaignsDir,
		token,
		uploadStylesFn = uploadStyles,
		validateCampaignSassFn = validateCampaignSass,
		oraFn = ora,
	} = {}
) {
	const relative = path.relative(campaignsDir, filenameRaw);
	const parts = relative.split(path.sep);
	// Only handle stylesheet changes: <campaign-path>/stylesheets/...
	if (parts.length < 3 || parts[1] !== 'stylesheets') return;
	const campaignPath = parts[0];
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
				uploadStylesFn: dependencies.uploadStylesFn,
				validateCampaignSassFn: dependencies.validateCampaignSassFn,
				oraFn: dependencies.oraFn,
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
