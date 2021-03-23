import inquirer from "inquirer";
import ora from "ora";
import { login } from "./actions/auth";

import { updateConfig } from "./config";
import { log, error, informUpdate } from "./helpers";

export async function doLogin(program, message) {
	if (message) log(message, "white");

	// collect login details
	const credentials = await inquirer.prompt([
		{
			type: "input",
			name: "username",
			message: "Enter your email address",
			validate: (value) =>
				value.length ? true : "Please enter your email address",
		},
		{
			type: "password",
			message: "Enter your password",
			name: "password",
			validate: (value) =>
				value.length ? true : "Please enter a password",
		},
	]);

	// log the user in
	const loginLoader = ora("Logging you in...").start();

	try {
		const loginBody = await login(
			{
				...credentials,
				requestAdminToken: true,
			},
			{ apiUrl: program.api }
		);
		const { token, data: user } = loginBody;
		loginLoader.succeed();
		return { user, token };
	} catch (e) {
		error(e, loginLoader);
		return false;
	}
}

export default function loginAction(program) {
	program.command("login").action(async (dir, cmd) => {
		const result = await doLogin(program);
		if (!result) return;
		const { token, user } = result;
		await updateConfig({
			token,
		});
		await informUpdate();
	});
}
