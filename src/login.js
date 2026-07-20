import { program } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { login } from './actions/auth.js';

import { updateConfig } from './config.js';
import { log, error, informUpdate, requiresMfa, getMfaStrategy } from './helpers.js';

export async function doLogin(message) {
	if (message) log(message, 'white');

	const debugCreds = {
		username: process.env.DEBUG_USERNAME,
		password: process.env.DEBUG_PASSWORD,
	}

	let credentials = {};
	if (debugCreds.username && debugCreds.password) {
		credentials = debugCreds;
	} else {
		// collect login details
		credentials = await inquirer.prompt([
			{
				type: 'input',
				name: 'username',
				message: 'Enter your email address',
				validate: (value) =>
					value.length ? true : 'Please enter your email address',
			},
			{
				type: 'password',
				message: 'Enter your password',
				name: 'password',
				validate: (value) =>
					value.length ? true : 'Please enter a password',
			},
		]);
	}

	// log the user in
	let loginLoader = ora('Logging you in...').start();

	try {
		let loginBody = await login({
			...credentials,
			requestAdminToken: true,
		});
		return loginSucceed(loginLoader, loginBody);
	} catch (e) {
		if (requiresMfa(e)) {
			const mfaStrategy = getMfaStrategy(e)
			return await loginWith2FA(loginLoader, credentials, mfaStrategy);
		} else {
			error(e, loginLoader);
			return false;
		}
	}
}

async function loginWith2FA(loginLoader, credentials, mfaStrategy) {
	loginLoader.info(`Your account requires 2 factor authentication`);
	let mfaType = mfaStrategy.mfaType;

	// FIXME: This is legacy. We don't support Authy anymore.
	if (mfaType === 'AUTHENTICATOR_APP' && mfaStrategy.hasAuthy) {
		const choiceMfa = await selectMfaType();
		mfaType = choiceMfa.mfaType;
		if (mfaType === 'AUTHY') {
			// trigger login again with mfaType to send the prompt
			try {
				await login({
					...credentials,
					mfaType,
					requestAdminToken: true,
				});
			} catch (e) {
				// don't throw error if just an error about missing MFA
				if (!requiresMfa(e)) {
					error(e, loginLoader);
					return false;
				}
			}
		}
	}

	let twoFactorId = mfaStrategy.twoFactorId;
	let otpMethod = undefined;

	if (mfaStrategy.moreOtpMethods) {
		const choiceOtpMethod = await selectOtpMethod(mfaStrategy.moreOtpMethods);
		otpMethod = choiceOtpMethod.otpMethod;

		try {
			await login({
				...credentials,
				mfaType,
				otpMethod, // forces an specific OTP method
				requestAdminToken: true,
			});
		} catch (e) {
			if (requiresMfa(e)) {
				const mfaStrategy = getMfaStrategy(e)
				twoFactorId = mfaStrategy.twoFactorId;
			} else {
				error(e, loginLoader);
				return false;
			}
		}
	}

	try {
		const response = await inquirer.prompt([
			{
				type: 'input',
				message: 'Please provide your one time password',
				name: 'otp',
				validate: (value) =>
					value.length
						? true
						: 'Please enter a one time password',
			},
		]);

		loginLoader.info('Logging you in...');

		const loginBody = await login({
			...credentials,
			mfaType,
			otp: response.otp,
			requestAdminToken: true,
			twoFactorId,
			otpMethod,
		});
		return loginSucceed(loginLoader, loginBody);
	} catch (e) {
		error(e, loginLoader);
		return false;
	}
}

async function selectOtpMethod(moreOtpMethods) {
	const selectedOtpMethod = await inquirer.prompt([
		{
			type: 'list',
			message: 'Select your preferred OTP method',
			name: 'otpMethod',
			choices: moreOtpMethods.map(method => ({
				name: method,
				value: method,
			})),
		},
	]);
	return selectedOtpMethod;
}

async function selectMfaType() {
	const selectedMfa = await inquirer.prompt([
		{
			type: 'list',
			message: 'Select your preferred MFA',
			name: 'mfaType',
			choices:  [
				{
					name: 'Authenticator App',
					value: 'AUTHENTICATOR_APP'
				},
				{
					name: 'SMS/Legacy',
					value: 'AUTHY'
				}
			],
			validate: (value) =>
				value.length
					? true
					: 'Please choose your preferred MFA',
		},
	]);
	return selectedMfa;
}

async function loginSucceed(loginLoader, loginBody) {
	const { token, data: user } = loginBody;
	loginLoader.succeed();
	return { user, token };
}

export default async function loginAction() {
	const result = await doLogin();
	if (!result) return;
	const { token, user } = result;
	await updateConfig({
		token,
	});
	await informUpdate();
}
