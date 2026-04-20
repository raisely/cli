import glob from 'glob-promise';
import path from 'path';
import fs from 'fs';
import api from './api.js';

export async function getCampaigns({ all = false } = {}) {
	if (!all) {
		return await api({
			path: '/campaigns',
			method: 'GET',
		});
	}

	const limit = 100;
	let offset = 0;
	const data = [];
	let pagination;

	while (true) {
		const page = await api({
			path: `/campaigns?limit=${limit}&offset=${offset}`,
			method: 'GET',
		});
		data.push(...page.data);
		pagination = page.pagination;
		if (page.data.length === 0) {
			break;
		}
		if (pagination?.total != null && data.length >= pagination.total) {
			break;
		}
		if (page.data.length < limit) {
			break;
		}
		offset += limit;
	}

	return { data, pagination };
}

export async function getCampaign({ uuid }) {
	return await api({
		path: `/campaigns/${uuid}`,
		method: 'GET',
	});
}

export async function getBaseStyles({ uuid }) {
	return await api({
		path: `/campaigns/${uuid}/base.css?asSass=1`,
		method: 'GET',
	});
}

export async function fetchStyles({ campaign, filename }) {
	const stylesDir = path.join(process.cwd(), 'stylesheets');
	const filePath = campaign || filename.split(path.sep)[0];

	const fullPath = path.join(stylesDir, filePath);
	const files = await glob(`${fullPath}/**/*.scss`);

	const configFiles = {};
	for (const file of files) {
		const fileName = file
			// `glob` above returns paths with forward slashes only,
			// so we need to replace potential Windows-style back slashes
			// before attempting to find and remove the full path.
			.replace(`${fullPath.replace(/\\/g, '/')}/`, '');

		// continue if this is the main stylesheet

		if (fileName === `${filePath}.scss`) continue;

		configFiles[fileName] = fs.readFileSync(file, 'utf8');
	}

	return {
		configFiles,
		css: fs.readFileSync(
			path.join(stylesDir, filePath, `${filePath}.scss`),
			'utf8'
		),
	};
}

export async function processStyles({ campaign, config }) {
	const { configFiles, css } = await fetchStyles({ campaign, config });

	let output = css;

	for (const file of Object.keys(configFiles).sort()) {
		output += configFiles[file];
	}

	return output;
}

export async function uploadStyles(filename) {
	// The filename will contain the relative campaign path (needs to be posix)
	const [campaignPath] = filename.split(path.sep);

	const campaign = await api({
		path: `/campaigns/${campaignPath}?private=1`,
		method: 'GET',
	});

	const { configFiles, css } = await fetchStyles({
		filename,
	});

	const data = Object.assign({}, campaign.data.config.css, {
		files: configFiles,
		custom_css: css,
	});

	return await api({
		path: `/campaigns/${campaignPath}/config/css?private=1`,
		method: 'PATCH',
		json: { data },
	});
}
