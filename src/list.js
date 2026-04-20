import ora from 'ora';

import { getCampaigns } from './actions/campaigns.js';
import { error } from './helpers.js';
import {
	getCredentials,
	NotAuthenticatedError,
} from './credentials.js';

function sanitizeForTsv(value) {
	return String(value).replace(/[\t\n\r]+/g, ' ');
}

export default async function list(options = {}) {
	let format;
	if (options.json) {
		format = 'json';
	} else if (options.tsv) {
		format = 'tsv';
	} else if (process.stdout.isTTY) {
		format = 'table';
	} else {
		format = 'tsv';
	}

	try {
		await getCredentials({ allowPrompt: false });
	} catch (e) {
		if (e instanceof NotAuthenticatedError) {
			error(e);
			return;
		}
		throw e;
	}

	let loader;
	if (format === 'table') {
		loader = ora('Loading campaigns...').start();
	}

	let response;
	try {
		response = await getCampaigns({ all: true });
		if (loader) {
			loader.succeed();
		}
	} catch (e) {
		error(e, loader);
		return;
	}

	const campaigns = [...response.data].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
	);

	if (format === 'json') {
		console.log(
			JSON.stringify(
				campaigns.map((c) => ({ name: c.name, uuid: c.uuid })),
				null,
				2
			)
		);
		return;
	}

	if (format === 'tsv') {
		console.log('Name\tUuid');
		for (const c of campaigns) {
			console.log(`${sanitizeForTsv(c.name)}\t${c.uuid}`);
		}
		return;
	}

	const nameWidth = Math.max(
		'Name'.length,
		...campaigns.map((c) => c.name.length)
	);
	const uuidWidth = Math.max(
		'Uuid'.length,
		...campaigns.map((c) => String(c.uuid).length)
	);

	console.log(`${'Name'.padEnd(nameWidth)}  Uuid`);
	console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(uuidWidth)}`);
	for (const c of campaigns) {
		console.log(`${c.name.padEnd(nameWidth)}  ${c.uuid}`);
	}
	console.log('');
	const n = campaigns.length;
	console.log(`${n} campaign${n === 1 ? '' : 's'}`);
}
