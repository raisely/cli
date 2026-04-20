import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';

import { welcome, log, br, error, informUpdate } from './helpers.js';
import { getCampaigns, getCampaign } from './actions/campaigns.js';
import { syncStyles, syncComponents, syncPages } from './actions/sync.js';
import { saveConfig } from './config.js';
import {
	resolveOrganisationContext,
	getCredentials,
} from './credentials.js';
import { runOAuthLogin } from './login.js';

export default async function init(options = {}) {
	welcome();
	log(
		`You're about to initialize a Raisely campaign in this directory`,
		'white'
	);
	br();
	console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
	br();

	let organisationUuid;
	const ctx = await resolveOrganisationContext();
	if (ctx) {
		try {
			await getCredentials({ allowPrompt: false });
			organisationUuid = ctx.organisationUuid;
			log(`Already signed in for this API. Skipping browser login.`, 'white');
			br();
		} catch {
			// No valid stored session for this host; run OAuth below.
		}
	}

	if (!organisationUuid) {
		log(`Sign in to your Raisely account to start:`, 'white');
		br();
		const tokenResponse = await runOAuthLogin();
		organisationUuid = tokenResponse.organisation_uuid;
	}

	let selectedCampaigns;

	if (options.uuid) {
		const loader = ora(`Loading campaign ${options.uuid}...`).start();
		try {
			const { data: campaign } = await getCampaign({ uuid: options.uuid });
			loader.succeed(`Using campaign: ${campaign.name} (${campaign.path})`);
			selectedCampaigns = [campaign.uuid];
		} catch (e) {
			return error(e, loader);
		}
	} else {
		const campaignsLoader = ora('Loading your campaigns...').start();
		let data;
		try {
			data = await getCampaigns();
			campaignsLoader.succeed();
		} catch (e) {
			return error(e, campaignsLoader);
		}

		const campaigns = await inquirer.prompt([
			{
				type: 'checkbox',
				name: 'campaigns',
				message: 'Select the campaigns to sync:',
				choices: data.data.map((c) => ({
					name: `${c.name} (${c.path})`,
					value: c.uuid,
					short: c.path,
				})),
			},
		]);

		selectedCampaigns = campaigns.campaigns;
	}

	const config = {
		campaigns: selectedCampaigns,
		organisationUuid,
	};
	if (program.api) config.apiUrl = program.api;
	await saveConfig(config);

	// sync down campaign stylesheets
	await syncStyles();

	// sync down custom components
	await syncComponents();

	// sync down campaign pages (v3 body JSON)
	await syncPages();

	br();
	log('All done! You can start development by running:', 'green');
	br();
	log('raisely start', 'inverse');
	br();
	log('To update your local files run:', 'green');
	br();
	log('raisely update', 'inverse');
	br();
	await informUpdate();
}
