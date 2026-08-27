import ora from 'ora';
import path from 'path';
import fs from 'fs';

import api from './api.js';
import { error } from '../helpers.js';
import { loadConfig } from '../config.js';
import { resolveCampaignPaths } from './layout.js';

export async function syncStyles() {
	const config = await loadConfig();

	const loader = ora('Downloading campaign stylesheets...').start();
	try {
		for (const uuid of config.campaigns) {
			const campaign = await api({
				path: `/campaigns/${uuid}?private=1`,
			});

			const { stylesheetsDir, mainScss } = resolveCampaignPaths(
				process.cwd(),
				campaign.data.path
			);

			if (!fs.existsSync(stylesheetsDir)) {
				fs.mkdirSync(stylesheetsDir, { recursive: true });
			}

			if (campaign.data.config.css.files) {
				const files = campaign.data.config.css.files;

				for (const file of Object.keys(files)) {
					const fileFolder = file
						.split('/')
						.filter((f) => !f.includes('.'));
					const fileName = file
						.split('/')
						.filter((f) => f.includes('.'))
						.join('');
					const fileDir = path.join(stylesheetsDir, ...fileFolder);

					if (!fs.existsSync(fileDir)) {
						fs.mkdirSync(fileDir, { recursive: true });
					}

					fs.writeFileSync(path.join(fileDir, fileName), files[file]);
				}
			}

			fs.writeFileSync(mainScss, campaign.data.config.css.custom_css);
		}
		loader.succeed();
	} catch (e) {
		return error(e, loader);
	}
}

function pagePathBase(page) {
	return page.path && page.path !== '/'
		? page.path.replace(/^\//, '').replace(/\//g, '-')
		: 'home';
}

/**
 * Compute a unique local file name for every page in a campaign.
 *
 * `page.name` is only unique for template pages — every custom
 * (page-builder) page shares the name "legacy", so naming files by
 * `page.name` alone makes all custom pages overwrite each other into a
 * single legacy.json. Whenever a name is shared by more than one page,
 * fall back to the page's path instead.
 *
 * @param {Array<object>} pages Pages belonging to one campaign
 * @returns {string[]} File name for each page, in the same order
 */
export function pageFileNames(pages) {
	const nameCounts = new Map();
	for (const page of pages) {
		if (page.name) {
			nameCounts.set(page.name, (nameCounts.get(page.name) || 0) + 1);
		}
	}

	const used = new Set();
	return pages.map((page) => {
		const nameIsUnique = page.name && nameCounts.get(page.name) === 1;
		const base = nameIsUnique ? page.name : pagePathBase(page);
		let fileName = `${base.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
		if (used.has(fileName) && page.uuid) {
			fileName = fileName.replace(/\.json$/, `-${page.uuid.slice(0, 8)}.json`);
		}
		used.add(fileName);
		return fileName;
	});
}

export async function syncPages() {
	const config = await loadConfig();

	const loader = ora('Downloading campaign pages...').start();
	try {
		for (const uuid of config.campaigns) {
			const campaign = await api({
				path: `/campaigns/${uuid}?private=1`,
			});

			const { pagesDir } = resolveCampaignPaths(
				process.cwd(),
				campaign.data.path
			);

			if (!fs.existsSync(pagesDir)) {
				fs.mkdirSync(pagesDir, { recursive: true });
			}

			const pages = await api({
				path: `/campaigns/${uuid}/pages?private=1&includeBody=1&limit=999`,
			});

			const fileNames = pageFileNames(pages.data);
			for (const [index, page] of pages.data.entries()) {
				const out = {
					uuid: page.uuid,
					path: page.path,
					title: page.title,
					internalTitle: page.internalTitle,
					name: page.name,
					status: page.status,
					body: page.body,
					provider: page.provider,
					condition: page.condition,
					image: page.image,
					metaDescription: page.metaDescription,
					socialTitle: page.socialTitle,
					socialDescription: page.socialDescription,
					protected: page.protected,
					campaignUuid: uuid,
				};

				fs.writeFileSync(
					path.join(pagesDir, fileNames[index]),
					JSON.stringify(out, null, 4)
				);
			}
		}
		loader.succeed();
	} catch (e) {
		return error(e, loader);
	}
}

export async function syncComponents(filter) {
	const directory = path.join(process.cwd(), 'components');
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora(
		filter ? `Downloading ${filter}...` : 'Downloading custom components...'
	).start();
	try {
		const components = await api({
			path: `/components?private=1&limit=100`,
		});

		for (const component of components.data) {
			if (filter && component.name !== filter) continue;

			// make component directory
			const componentDir = path.join(directory, component.name);
			if (!fs.existsSync(componentDir)) {
				fs.mkdirSync(componentDir);
			}

			// save the files
			fs.writeFileSync(
				path.join(componentDir, `${component.name}.js`),
				component.latestHtml
			);
			fs.writeFileSync(
				path.join(componentDir, `${component.name}.json`),
				JSON.stringify(
					{
						fields: component.latestSchema.data.editable,
						uuid: component.uuid,
					},
					null,
					4
				)
			);
		}

		loader.succeed();
	} catch (e) {
		return error(e, loader);
	}
}
