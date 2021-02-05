import ora from "ora";
import path from "path";
import fs from "fs";

import api from "./api";
import { error } from "../helpers";

export async function syncStyles(config, workDir) {
	const directory = path.join(workDir, "stylesheets");
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora("Downloading campaign stylesheets...").start();
	try {
		for (const uuid of config.campaigns) {
			const campaign = await api(
				{
					path: `/campaigns/${uuid}?private=true`,
					auth: {
						bearer: config.token
					}
				},
				config.apiUrl
			);

			const campaignDir = path.join(directory, campaign.data.path);

			if (!fs.existsSync(campaignDir)) {
				fs.mkdirSync(campaignDir);
			}

			if (campaign.data.config.css.files) {
				const files = campaign.data.config.css.files;

				for (const file of Object.keys(
					campaign.data.config.css.files
				)) {
					const fileFolder = file
						.split(path.sep)
						.filter(f => !f.includes("."));
					const fileName = file
						.split(path.sep)
						.filter(f => f.includes("."))
						.join("");
					const fileDir = path.join(campaignDir, ...fileFolder);

					if (!fs.existsSync(fileDir)) {
						fs.mkdirSync(fileDir, { recursive: true });
					}

					fs.writeFileSync(path.join(fileDir, fileName), files[file]);
				}
			}

			fs.writeFileSync(
				path.join(campaignDir, `${campaign.data.path}.scss`),
				campaign.data.config.css.custom_css
			);
		}
		loader.succeed();
	} catch (e) {
		return error(e, loader);
	}
}

export async function syncComponents(config, workDir, filter) {
	const directory = path.join(workDir, "components");
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora(
		filter ? `Downloading ${filter}...` : "Downloading custom components..."
	).start();
	try {
		const components = await api(
			{
				path: `/components`,
				qs: {
					private: 1,
					limit: 100
				},
				auth: {
					bearer: config.token
				}
			},
			config.apiUrl
		);

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
						uuid: component.uuid
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

export async function syncPages(config, workDir) {
	const directory = path.join(workDir, "pages");
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora("Downloading campaign pages...").start();
	try {
		for (const uuid of config.campaigns) {
			const campaign = await api(
				{
					path: `/campaigns/${uuid}?private=true`,
					auth: {
						bearer: config.token
					}
				},
				config.apiUrl
			);

			const campaignDir = path.join(directory, campaign.data.path);

			if (!fs.existsSync(campaignDir)) {
				fs.mkdirSync(campaignDir);
			}

			const pages = await api(
				{
					path: `/campaigns/${uuid}/pages`,
					qs: {
						private: 1,
						limit: 100
					},
					auth: {
						bearer: config.token
					}
				},
				config.apiUrl
			);

			for (const page of pages.data) {
				fs.writeFileSync(
					path.join(campaignDir, `${page.internalTitle}.json`),
					JSON.stringify(
						{
							uuid: page.uuid,
							data: { // these are the editable page fields
								title: page.title,
								internalTitle: page.internalTitle,
								body: page.body,
								path: page.path,
								status: page.status,
								provider: page.provider,
								condition: page.condition,
								image: page.image,
								metaTitle: page.metaTitle,
								metaDescription: page.metaDescription,
								socialTitle: page.socialTitle,
								socialDescription: page.socialDescription
							}
						},
						null,
						4
					)
				);
			}

		}

		loader.succeed();
	} catch (e) {
		console.log(e);
		return error(e, loader);
	}

}