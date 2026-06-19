import fs from 'fs/promises';
import path from 'path';

import inquirer from 'inquirer';
import ora from 'ora';

import {
	uploadCampaignMedia,
	uploadOrganisationMedia,
} from '../actions/media.js';
import { loadConfig } from '../config.js';
import { getCredentials, NotAuthenticatedError } from '../credentials.js';
import { error } from '../helpers.js';

export default async function mediaUpload(fileOrUrl, options = {}) {
	try {
		await getCredentials({ allowPrompt: false });
	} catch (e) {
		if (e instanceof NotAuthenticatedError) {
			error(e);
			return;
		}
		throw e;
	}

	let { campaign, organisation, force } = options;
	let campaignFromConfig = false;

	if (!campaign && !organisation) {
		const config = await loadConfig({ allowEmpty: true });
		campaign = config.campaigns?.[0];
		if (campaign) campaignFromConfig = true;
	}

	if (!campaign && !organisation) {
		error('Provide --campaign <slug> or --organisation <uuid>');
		return;
	}

	const isUrl =
		fileOrUrl.startsWith('http://') || fileOrUrl.startsWith('https://');

	if (!isUrl) {
		try {
			await fs.access(fileOrUrl);
		} catch {
			error(`File not found: ${fileOrUrl}`);
			return;
		}
	}

	if (!force && !options.json) {
		const label = isUrl ? fileOrUrl : path.basename(fileOrUrl);
		let target;
		if (organisation) {
			target = `organisation "${organisation}"`;
		} else if (campaignFromConfig) {
			target = `campaign "${campaign}" (from .raisely.json)`;
		} else {
			target = `campaign "${campaign}"`;
		}

		const { confirmed } = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirmed',
				message: `Uploading to ${target} — are you sure you want to upload "${label}"?`,
				default: false,
			},
		]);

		if (!confirmed) {
			console.log('Upload cancelled.');
			return;
		}
	}

	const isTTY = process.stdout.isTTY && !options.json;
	const loader = isTTY ? ora('Uploading...').start() : null;

	try {
		const payload = isUrl ? { url: fileOrUrl } : { file: fileOrUrl };
		const response = organisation
			? await uploadOrganisationMedia({ organisation, ...payload })
			: await uploadCampaignMedia({ campaign, ...payload });

		const mediaUrl = response?.data?.url ?? response?.url ?? '';

		if (loader) {
			if (mediaUrl) {
				loader.succeed(`Uploaded: ${mediaUrl}`);
			} else {
				loader.warn('Upload succeeded but no URL was returned.');
			}
		} else {
			console.log(JSON.stringify(response?.data ?? response, null, 2));
		}
	} catch (e) {
		error(e, loader);
	}
}
