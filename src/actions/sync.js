import ora from "ora";
import path from "path";
import fs from "fs";

import api from "./api.js";
import { error } from "../helpers.js";
import { loadConfig } from "../config.js";

export async function syncStyles() {
	const config = await loadConfig();

	const directory = path.join(process.cwd(), "stylesheets");
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora("Downloading campaign stylesheets...").start();
	try {
		for (const uuid of config.campaigns) {
			const campaign = await api({
				path: `/campaigns/${uuid}?private=1`,
			});

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
						.split("/")
						.filter((f) => !f.includes("."));
					const fileName = file
						.split("/")
						.filter((f) => f.includes("."))
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

export async function syncComponents(filter) {
	const directory = path.join(process.cwd(), "components");
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory);
	}

	const loader = ora(
		filter ? `Downloading ${filter}...` : "Downloading custom components..."
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
