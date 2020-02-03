import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";

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
			{ encoding: "utf8" },
			async (eventType, filename) => {
				const loader = ora(`Saving ${filename}`).start();
				await updateStyles(
					{
						path: filename.replace(".scss", ""),
						css: fs.readFileSync(
							path.join(stylesDir, filename),
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
