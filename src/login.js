import inquirer from "inquirer";
import ora from "ora";
import { login } from "./actions/auth";

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

	const loginBody = await login(
		{
			...credentials,
			requestAdminToken: true
		},
		{ apiUrl: program.api }
	);
	const { token, user } = loginBody;
	loginLoader.succeed();

	return { user, token };
}

export default function loginAction(program) {
	program.command("login").action(async (dir, cmd) => {
		try {
			const { token, user } = await doLogin(ora)
			await updateConfig({
				token,
				organisationUuid: user.organisationUuid,
			});
		} catch (e) {
			return error(e, loginLoader);
		}
	});
}
