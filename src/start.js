import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import glob from "glob-promise";

import { welcome, log, br, error, informUpdate } from "./helpers.js";
import watch from "node-watch";

import { updateStyles, uploadStyles } from "./actions/campaigns.js";
import {
	updateComponentFile,
	updateComponentConfig,
} from "./actions/components.js";
import { getToken } from "./actions/auth.js";
import { loadConfig } from "./config.js";

export default function start(program) {
	program.command("start").action(async (dir, cmd) => {
		welcome();

		// load config
		const config = await loadConfig();
		// Load token, which will prompt a login if the token is expired
		config.token = await getToken(program, config, true);

		await informUpdate();

		log(`Watching and uploading changes in this directory`, "white");
		br();
		console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
		br();
		if (config.apiUrl) {
			br();
			console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
			br();
		}
		log(`Use CTRL + C to stop`, "white");

		// watch folders
		const stylesDir = path.join(process.cwd(), "stylesheets");
		const componentsDir = path.join(process.cwd(), "components");
		watch(
			stylesDir,
			{ encoding: "utf8", recursive: true },
			async (eventType, filenameRaw) => {
				const filename = path.relative(stylesDir, filenameRaw);
				const loader = ora(`Saving ${filename}`).start();

				await uploadStyles(filename, config);

				loader.succeed();
			}
		);

		watch(
			componentsDir,
			{ encoding: "utf8", recursive: true },
			async (eventType, filenameRaw) => {
				const filename = path.relative(componentsDir, filenameRaw);
				const loader = ora(`Saving ${filename}`).start();

				try {
					if (filename.includes(".json")) {
						await updateComponentConfig(
							{
								filename,
								file: fs.readFileSync(
									path.join(
										componentsDir,
										filename.replace(".json", ".js")
									),
									"utf8"
								),
								config: JSON.parse(
									fs.readFileSync(
										path.join(componentsDir, filename),
										"utf8"
									)
								),
							},
							config
						);
					} else {
						const result = await updateComponentFile(
							{
								filename,
								file: fs.readFileSync(
									path.join(componentsDir, filename),
									"utf8"
								),
								config: JSON.parse(
									fs.readFileSync(
										path.join(
											componentsDir,
											filename.replace(".js", ".json")
										),
										"utf8"
									)
								),
							},
							config
						);
					}
				} catch (e) {
					return error(e, loader);
				}

				loader.succeed();
			}
		);
	});
}
