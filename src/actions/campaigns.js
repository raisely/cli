import glob from 'glob-promise';
import fs from 'fs';
import api from './api.js';
import { resolveCampaignPaths } from './layout.js';

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

export async function fetchStyles({ campaign }) {
	const { stylesheetsDir, mainScss } = resolveCampaignPaths(
		process.cwd(),
		campaign
	);

	const files = await glob(`${stylesheetsDir}/**/*.scss`);

	const configFiles = {};
	for (const file of files) {
		const fileName = file
			// `glob` returns paths with forward slashes only,
			// so normalise Windows-style back slashes before stripping the prefix.
			.replace(`${stylesheetsDir.replace(/\\/g, '/')}/`, '');

		if (fileName === 'main.scss') continue;

		configFiles[fileName] = fs.readFileSync(file, 'utf8');
	}

	return {
		configFiles,
		css: fs.readFileSync(mainScss, 'utf8'),
	};
}

export async function processStyles({ campaign }) {
	const { configFiles, css } = await fetchStyles({ campaign });

	let output = css;

	for (const file of Object.keys(configFiles).sort()) {
		output += configFiles[file];
	}

	return output;
}

export async function uploadStyles(campaignPath) {
	const campaign = await api({
		path: `/campaigns/${campaignPath}?private=1`,
		method: 'GET',
	});

	const { configFiles, css } = await fetchStyles({ campaign: campaignPath });

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
