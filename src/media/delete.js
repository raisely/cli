import ora from 'ora';

import {
	deleteCampaignMedia,
	deleteOrganisationMedia,
} from '../actions/media.js';
import { loadConfig } from '../config.js';
import { getCredentials, NotAuthenticatedError } from '../credentials.js';
import { error } from '../helpers.js';

export default async function mediaDelete(uuid, options = {}) {
	try {
		await getCredentials({ allowPrompt: false });
	} catch (e) {
		if (e instanceof NotAuthenticatedError) {
			error(e);
			return;
		}
		throw e;
	}

	let { campaign, organisation } = options;

	if (!campaign && !organisation) {
		const config = await loadConfig({ allowEmpty: true });
		campaign = config.campaigns?.[0];
	}

	if (!campaign && !organisation) {
		error('Provide --campaign <slug> or --organisation <uuid>');
		return;
	}

	const loader = process.stdout.isTTY && !options.json
		? ora(`Deleting media ${uuid}...`).start()
		: null;

	try {
		if (organisation) {
			await deleteOrganisationMedia({ organisation, uuid });
		} else {
			await deleteCampaignMedia({ campaign, uuid });
		}

		if (loader) {
			loader.succeed(`Deleted ${uuid}`);
		} else {
			console.log(JSON.stringify({ success: true }));
		}
	} catch (e) {
		error(e, loader);
	}
}
