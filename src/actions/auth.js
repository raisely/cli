import inquirer from 'inquirer';
import ora from 'ora';

import api from './api.js';
import { error, log } from '../helpers.js';
import { updateConfig } from '../config.js';
import { getCredentials } from '../credentials.js';

async function checkCorrectOrganisation(orgUuid, opts) {
	let organisationUuid = orgUuid;
	if (!organisationUuid) {
		const permChecker = ora('Checking campaign permissions...').start();
		try {
			const campaignUuid = opts.campaigns[0];
			const campaign = await api({
				path: `/campaigns/${campaignUuid}?private=1`,
			});
			({ organisationUuid } = campaign.data);

			permChecker.succeed();
			await updateConfig({ organisationUuid });
		} catch (e) {
			error(e, permChecker);
			console.error(
				'Could not retrieve the campaign. Are you switched into the correct organisation?'
			);

			process.exit(-1);
		}
	}

	if (organisationUuid) {
		const authData = await api({
			path: '/authenticate',
		});
		// /authenticate returns identity flat at the top level. It also has a
		// `data` key, but that holds OAuth authorization metadata
		// (type/scopes/appUuid/authorizationUuid), not identity, so it must not
		// be treated as a response envelope.
		const authBody = authData ?? {};
		if (authBody.organisationUuid !== organisationUuid) {
			log(
				`This configuration is for organisation ${organisationUuid} but you are currently in organisation ${authBody.organisationUuid}`,
				'white'
			);
			const response = await inquirer.prompt([
				{
					type: 'confirm',
					name: 'confirm',
					message: `Would you like to switch your account to ${organisationUuid} now?`,
				},
			]);
			if (response.confirm) {
				// Continuing here would run the command against the
				// organisation the user just declined, so abort rather than
				// returning.
				if (!authBody.userUuid) {
					log(
						'Your session does not identify a user, so the CLI cannot switch organisations for you. Switch organisation in the Raisely admin, then run raisely init again.',
						'red'
					);
					process.exit(-1);
				}
				const loader = ora(
					'Switching to correct organisation ...'
				).start();
				try {
					await api({
						path: `/users/${authBody.userUuid}/move`,
						method: 'PUT',
						json: {
							data: {
								organisationUuid,
							},
						},
					});
					loader.succeed();
				} catch (e) {
					error(e, loader);
					process.exit(-1);
				}
			}
		}
	}
}

export async function getToken(program, opts, warnEarly) {
	if (opts.$tokenFromEnv) {
		const { token } = await getCredentials({ allowPrompt: false });
		opts.token = token;
		return token;
	}
	const { token } = await getCredentials();
	opts.token = token;
	await checkCorrectOrganisation(opts.organisationUuid, opts);
	return token;
}
