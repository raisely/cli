import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";

import { welcome, log, br, error } from "./helpers";
import { login } from "./actions/auth";
import { getCampaigns } from "./actions/campaigns";
import { syncStyles, syncComponents } from "./actions/sync";
import { saveConfig } from "./config";
import { doLogin } from "./login";

export default function init(program) {
	program.command("init").action(async (dir, cmd) => {
		const data = {};

		welcome();
		log(
			`You're about to initialize a Raisely campaign in this directory`,
			"white"
		);
		br();
		console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
		br();
		log(`Log in to your Raisely account to start:`, "white");
		br();

		try {
			const { user, token } = await doLogin();
		} catch (e) {
			return error(e, loginLoader);
		}

		// load the campaigns
		const campaignsLoader = ora("Loading your campaigns...").start();
		try {
			data.campaigns = await getCampaigns({}, data.token, {
				apiUrl: program.api
			});
			campaignsLoader.succeed();
		} catch (e) {
			return error(e, campaignsLoader);
		}

		// select the campaigns to sync
		const campaigns = await inquirer.prompt([
			{
				type: "checkbox",
				name: "campaigns",
				message: "Select the campaigns to sync:",
				choices: data.campaigns.data.map(c => ({
					name: `${c.name} (${c.path})`,
					value: c.uuid,
					short: c.path
				}))
			}
		]);

		const config = {
			token,
			campaigns: campaigns.campaigns
		};
		if (program.api) config.apiUrl = program.api;
		await saveConfig(config);

		// sync down campaign stylesheets
		await syncStyles(config, process.cwd());

		// sync down custom components
		await syncComponents(config, process.cwd());

		br();
		log("All done! You can start development by running:", "green");
		br();
		log("raisely start", "inverse");
		br();
		log("To update your local files run:", "green");
		br();
		log("raisely update", "inverse");
		br();
	});
}
