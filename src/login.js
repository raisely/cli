import inquirer from "inquirer";
import ora from "ora";
import { login } from "./actions/auth.js";

import { updateConfig } from "./config.js";
import { log, error, informUpdate } from "./helpers.js";

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
	let loginLoader = ora("Logging you in...").start();

	try {
		let loginBody = await login({
			...credentials,
			requestAdminToken: true,
		});
		if (loginBody.data.requiresOtp) {
			loginLoader.info("Your account requires 2 factor authentication.");
			const response = await inquirer.prompt([
				{
					type: "input",
					message: "Please provide your one time password",
					name: "otp",
					validate: (value) =>
						value.length
							? true
							: "Please enter a one time password",
				},
			]);

			loginLoader = ora("Logging you in...").start();

			loginBody = await login({
				...credentials,
				otp: response.otp,
				requestAdminToken: true,
			});
		}
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
