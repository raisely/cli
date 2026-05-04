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
import { getToken } from './actions/auth.js';
import { loadConfig } from './config.js';

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
	watch(
		campaignsDir,
		{ encoding: 'utf8', recursive: true },
		async (eventType, filenameRaw) => {
			const relative = path.relative(campaignsDir, filenameRaw);
			const parts = relative.split(path.sep);
			// Only handle stylesheet changes: <campaign-path>/stylesheets/...
			if (parts.length < 3 || parts[1] !== 'stylesheets') return;
			const campaignPath = parts[0];
			const loader = ora(`Saving ${relative}`).start();

			await uploadStyles(campaignPath);

			loader.succeed();
		}
	);

	watch(
		componentsDir,
		{ encoding: 'utf8', recursive: true },
		async (eventType, filenameRaw) => {
			const filename = path.relative(componentsDir, filenameRaw);
			const loader = ora(`Saving ${filename}`).start();

			try {
				if (filename.includes('.json')) {
					await updateComponentConfig(
						{
							filename,
							file: fs.readFileSync(
								path.join(
									componentsDir,
									filename.replace('.json', '.js')
								),
								'utf8'
							),
							config: JSON.parse(
								fs.readFileSync(
									path.join(componentsDir, filename),
									'utf8'
								)
							),
						},
						config
					);
				} else {
					const result = await updateComponentFile(
						{
							filename,
							file: fs.readFileSync(
								path.join(componentsDir, filename),
								'utf8'
							),
							config: JSON.parse(
								fs.readFileSync(
									path.join(
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
				return error(e, loader);
			}

			loader.succeed();
		}
	);
}
