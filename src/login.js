import inquirer from "inquirer";
import ora from "ora";

import { updateConfig } from "./config";

export async function doLogin(message) {
	if (message) log(message, "white");

	// collect login details
	const credentials = await inquirer.prompt([
		{
			type: "input",
			name: "username",
			message: "Enter your email address",
			validate: value =>
				value.length ? true : "Please enter your email address"
		},
		{
			type: "password",
			message: "Enter your password",
			name: "password",
			validate: value =>
				value.length ? true : "Please enter a password"
		}
	]);

	// log the user in
	const loginLoader = ora("Logging you in...").start();

	const user = await login(
		{
			...credentials,
			requestAdminToken: true
		},
		{ apiUrl: program.api }
	);
	const { token } = data.user;
	loginLoader.succeed();

	return { user, token };
}

export default function login(program) {
	program.command("login").action(async (dir, cmd) => {
		try {
			await doLogin(ora)
		} catch (e) {
			return error(e, loginLoader);
		}
		await updateConfig({
			token,
		});
	});
}
