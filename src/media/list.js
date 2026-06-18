import ora from 'ora';

import {
	listCampaignMedia,
	listOrganisationMedia,
} from '../actions/media.js';
import { loadConfig } from '../config.js';
import { getCredentials, NotAuthenticatedError } from '../credentials.js';
import { error } from '../helpers.js';

export default async function mediaList(options = {}) {
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

	const isTTY = process.stdout.isTTY && !options.json;
	const loader = isTTY ? ora('Loading media...').start() : null;

	let response;
	try {
		response = organisation
			? await listOrganisationMedia({ organisation })
			: await listCampaignMedia({ campaign });
		if (loader) loader.succeed();
	} catch (e) {
		error(e, loader);
		return;
	}

	const items = response.data ?? [];

	if (!isTTY) {
		console.log(JSON.stringify(items, null, 2));
		return;
	}

	if (items.length === 0) {
		console.log('No media items found.');
		return;
	}

	const uuidW = Math.max(
		'uuid'.length,
		...items.map((i) => (i.uuid ?? '').length)
	);
	const fileW = Math.max(
		'file'.length,
		...items.map((i) => (i.file ?? '').length)
	);
	const typeW = Math.max(
		'type'.length,
		...items.map((i) => (i.type ?? '').length)
	);

	console.log(
		`${'uuid'.padEnd(uuidW)}  ${'file'.padEnd(fileW)}  ${'type'.padEnd(typeW)}  url`
	);
	console.log(
		`${'-'.repeat(uuidW)}  ${'-'.repeat(fileW)}  ${'-'.repeat(typeW)}  ---`
	);
	for (const item of items) {
		console.log(
			`${(item.uuid ?? '').padEnd(uuidW)}  ${(item.file ?? '').padEnd(fileW)}  ${(item.type ?? '').padEnd(typeW)}  ${item.url ?? ''}`
		);
	}
	console.log('');
	console.log(`${items.length} item${items.length === 1 ? '' : 's'}`);
}
