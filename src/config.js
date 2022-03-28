import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";

import { br, log, error } from "./helpers.js";

const CONFIG_FILE = ".raisely.json";
export const defaults = {
	apiUrl: process.env.RAISELY_API_URL || "https://api.raisely.com",
};

async function legacyLoad() {
	const legacyConfig = "raisely.json";
	const config = readConfig(legacyConfig);
	// move to new config file
	br();
	log(`@raisely/cli now uses ${chalk.bold.white(CONFIG_FILE)}`);
	const response = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirm",
			message: `Would you like to rename your old config (${chalk.underline(
				legacyConfig
			)}) to ${chalk.underline(CONFIG_FILE)} now?`,
		},
	]);
	if (response.confirm) {
		fs.renameSync(legacyConfig, CONFIG_FILE);
		await hideFile();
	}

	return config;
}

function readConfig(filename) {
	const configJson = fs.readFileSync(path.join(process.cwd(), filename));
	const config = JSON.parse(configJson);
	return config;
}

async function hideFile() {
	const cwdFiles = fs.readdirSync(process.cwd());
	if (cwdFiles.find((n) => n === ".git")) {
		let isIgnored;
		try {
			const lines = fs.readFileSync(".gitignore", "utf8");
			isIgnored = lines.split("\n").find((n) => n === CONFIG_FILE);
		} catch (e) {
			// Assume that an error means the file doesn't exist
		}
		if (!isIgnored) {
			log("You appear to be in a git repository.");
			log(
				`To keep credentials out of source control, ${chalk.bold.white(
					CONFIG_FILE
				)} should be added to your .gitignore file`,
				"white"
			);
			const response = await inquirer.prompt([
				{
					type: "confirm",
					name: "confirm",
					message: `Would you like to add ${chalk.underline(
						CONFIG_FILE
					)} to your .gitignore now?`,
				},
			]);

			if (response.confirm) {
				const lineToAdd = "\n" + CONFIG_FILE + "\n";
				fs.appendFileSync(".gitignore", lineToAdd);
				return log(
					`${chalk.white.underline(CONFIG_FILE)} added to .gitignore`
				);
			}
		}
	}
}

export async function loadConfig({ allowEmpty = false } = {}) {
	let config = {};

	if (process.env.RAISELY_TOKEN) {
		log("RAISELY_TOKEN found, using environment variables");
		return Object.assign({}, defaults, {
			token: process.env.RAISELY_TOKEN,
			cli: true,
			apiUrl: process.env.RAISELY_API_URL || defaults.apiUrl,
			campaigns: process.env.RAISELY_CAMPAIGNS.split(","),
			$tokenFromEnv: true,
		});
	}

	try {
		config = readConfig(CONFIG_FILE);
	} catch (e) {
		try {
			config = await legacyLoad();
		} catch (e2) {
			if (!allowEmpty) {
				return error(
					`No raisely.json found. Run ${chalk.bold.underline.white(
						"raisely init"
					)} to start.`
				);
			}
		}
	}
	return Object.assign({}, defaults, config);
}

export async function saveConfig(config) {
	// write the raisely.json config file
	const configLoader = ora(`Saving settings to ${CONFIG_FILE}...`).start();
	fs.writeFileSync(
		path.join(process.cwd(), CONFIG_FILE),
		JSON.stringify(Object.assign({}, defaults, config), null, 4)
	);
	configLoader.succeed();
	await hideFile();
}

export async function updateConfig(updates) {
	// write the raisely.json config file
	const configLoader = ora(`Updating settings in ${CONFIG_FILE}...`).start();
	let config = await loadConfig();
	const newConfig = {
		...config,
		...updates,
	};
	fs.writeFileSync(
		path.join(process.cwd(), CONFIG_FILE),
		JSON.stringify(newConfig, null, 4)
	);
	configLoader.succeed();
	await hideFile();
}
