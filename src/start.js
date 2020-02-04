import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import glob from "glob-promise";

import { welcome, log, br, error } from "./helpers";
import { updateStyles } from "./actions/campaigns";
import {
	updateComponentFile,
	updateComponentConfig
} from "./actions/components";
import { loadConfig } from "./config";

export default function start(program) {
	program.command("start").action(async (dir, cmd) => {
		welcome();

		// load config
		const config = await loadConfig();

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
		fs.watch(
			stylesDir,
			{ encoding: "utf8", recursive: true },
			async (eventType, filename) => {
				const loader = ora(`Saving ${filename}`).start();

				const filePath = filename.split("/")[0];

				const files = await glob(
					`${path.join(stylesDir, filePath)}/**/*.scss`
				);

				const configFiles = {};
				for (const file of files) {
					const fileName = file
						.replace(`${stylesDir}/`, "")
						.replace(`${filePath}/`, "");

					// continue if this is the main stylesheet
					if (fileName === `${filePath}.scss`) continue;

					configFiles[
						file
							.replace(`${stylesDir}/`, "")
							.replace(`${filePath}/`, "")
					] = fs.readFileSync(file, "utf8");
				}

				await updateStyles(
					{
						path: filePath,
						files: configFiles,
						css: fs.readFileSync(
							path.join(stylesDir, filePath, `${filePath}.scss`),
							"utf8"
						)
					},
					config
				);

				loader.succeed();
			}
		);

		fs.watch(
			componentsDir,
			{ encoding: "utf8", recursive: true },
			async (eventType, filename) => {
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
								)
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
								)
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
