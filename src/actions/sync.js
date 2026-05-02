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

function pageFileName(page) {
	const base =
		page.name ||
		(page.path && page.path !== '/'
			? page.path.replace(/^\//, '').replace(/\//g, '-')
			: 'home');
	return `${base.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
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

			for (const page of pages.data) {
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
					path.join(pagesDir, pageFileName(page)),
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
