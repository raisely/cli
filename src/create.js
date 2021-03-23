import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";

import { welcome, log, br, error, informUpdate } from "./helpers";
import { syncComponents } from "./actions/sync";
import { createComponent } from "./actions/components";
import { loadConfig } from "./config";
import { getToken } from "./actions/auth";

export default function create(program) {
	program
		.command("create [name]")
		.description("create a new custom component")
		.action(async (name, cmd) => {
			welcome();

			// load config
			let config = await loadConfig();
			await getToken(program, config);

			log(
				`You are creating a new custom component${
					name ? ` called ${name}` : ""
				}. The component will be downloaded to:`,
				"white"
			);
			br();
			console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
			br();

			// get component name
			if (!name) {
				const response = await inquirer.prompt([
					{
						type: "input",
						name: "name",
						message: "Name of your component",
						validate: (value) => {
							return value && /^[a-z0-9-]+$/.test(value)
								? true
								: 'Name can only use lowercase letters, "-" and numbers';
						},
					},
				]);
				name = response.name;
			}

			// save component
			const componentLoader = ora(
				`Creating custom component called "${name}"...`
			);
			try {
				await createComponent({ name }, config);
				componentLoader.succeed();
			} catch (e) {
				return error(e, componentLoader);
			}

			// sync down custom components
			await syncComponents(config, process.cwd(), name);

			br();
			log(
				`All done! Run ${chalk.bold.underline.white(
					"raisely start"
				)} to begin.`,
				"green"
			);
			await informUpdate();
		});
}
