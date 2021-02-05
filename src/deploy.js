import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import fs from "fs";
import path from "path";

import { welcome, log, br, error } from "./helpers";
import { buildStyles, getCampaign, updatePage } from "./actions/campaigns";
import {
	updateComponentFile,
	updateComponentConfig
} from "./actions/components";
import { loadConfig } from "./config";

export default function deploy(program) {
	program.command("deploy").action(async (dir, cmd) => {
		// load config
		let config = await loadConfig();

		welcome();
		log(`You are about to deploy your local directly to Raisely`, "white");
		br();
		console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
		br();
		if (config.apiUrl) {
			br();
			console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
			br();
		}
		log(
			`You will overwrite the styles, components and pages in your campaign.`,
			"white"
		);
		br();

		if (!config.cli) {
			// collect login details
			const response = await inquirer.prompt([
				{
					type: "confirm",
					name: "confirm",
					message: "Are you sure you want to continue?"
				}
			]);

			if (!response.confirm) {
				br();
				return log("Deploy aborted", "red");
			}
		}

		// upload campaign stylesheets
		for (const campaignUuid of config.campaigns) {
			const loader = ora(`Uploading styles for ${campaignUuid}`).start();
			const campaign = await getCampaign(
				{ uuid: campaignUuid },
				config.token,
				config
			);

			try {
				await buildStyles(
					`${campaign.data.path}/${campaign.data.path}.scss`,
					config
				);
			} catch (e) {
				console.error(e.stack);
				process.exit(1);
			}

			loader.succeed();
		}

		// upload custom components
		const componentsDir = path.join(process.cwd(), "components");
		for (const file of fs.readdirSync(componentsDir)) {
			const loader = ora(`Uploading component ${file}`).start();
			const data = {
				file,
				file: fs.readFileSync(
					path.join(componentsDir, file, `${file}.js`),
					"utf8"
				),
				config: JSON.parse(
					fs.readFileSync(
						path.join(componentsDir, file, `${file}.json`),
						"utf8"
					)
				)
			};

			await updateComponentConfig(data, config);
			await updateComponentFile(data, config);
			loader.succeed();
		}

		// upload campaign pages
		for (const campaignUuid of config.campaigns) {
			const loader = ora(`Uploading pages for ${campaignUuid}`).start();
			const campaign = await getCampaign(
				{ uuid: campaignUuid },
				config.token,
				config
			);

			const pagesDir = path.join(process.cwd(), "pages");
			const campaignDir = path.join(pagesDir, `${campaign.data.path}`);

			for (const file of fs.readdirSync(campaignDir)) {
				const pageData = JSON.parse(fs.readFileSync(
					path.join(campaignDir, file),
					"utf8"
				))
				await updatePage(pageData, config);
			}
			loader.succeed();
		}

		br();
		log(`All done!`);
	});
}
