import jwtDecode from "jwt-decode";
import inquirer from "inquirer";
import ora from "ora";

import api from "./api.js";
import { error, log } from "../helpers.js";
import { doLogin } from "../login.js";
import { updateConfig } from "../config.js";

let token = null;
let tokenExpiresAt = null;

/**
 * Return true if a token has an exp and it's in the past
 * or (if warnEarly is set) in the next 24 hours
 * (easier to update password at the start of the session than notice it needs
 * updating 10 minutes in)
 * @param {boolean} warnEarly If true, a token will be considered expired if it expires in the next 24 hours
 * @returns {boolean}
 */
function isTokenExpired(warnEarly) {
	if (tokenExpiresAt) {
		let expiresThreshold = new Date().getTime();
		if (warnEarly) {
			const window = 24 * 60 * 60 * 1000;
			expiresThreshold += window;
		}
		return tokenExpiresAt.getTime() < expiresThreshold;
	}
	return false;
}

function setTokenExpiresAt() {
	if (tokenExpiresAt === null) {
		tokenExpiresAt = false;
		try {
			const decoded = jwtDecode(token);
			tokenExpiresAt = new Date(decoded.exp * 1000);
		} catch (e) {
			console.warn("Could not decode token, is it a JWT?");
		}
	}
}

async function checkCorrectOrganisation(orgUuid, opts, currentOrganisation) {
	let organisationUuid = orgUuid;
	if (!organisationUuid) {
		const permChecker = ora("Checking campaign permissions...").start();
		try {
			const campaignUuid = opts.campaigns[0];
			const campaign = await api({
				path: `/campaigns/${campaignUuid}?private=1`,
			});
			({ organisationUuid } = campaign.data);

			permChecker.succeed();
			await updateConfig({ organisationUuid });
		} catch (e) {
			error(e, permChecker);
			console.error(
				"Could not retrieve the campaign. Are you switched into the correct organisation?"
			);

			// A bit hacky, but saves a lot of conditional code all over or
			// a stacktrace if we rethrow
			process.exit(-1);
		}
	}

	if (organisationUuid) {
		const authData = await api({
			path: "/authenticate",
		});
		if (authData.organisationUuid !== organisationUuid) {
			log(
				`This configuration is for organisation ${organisationUuid} but you are currently in organisation ${authData.organisationUuid}`,
				"white"
			);
			const response = await inquirer.prompt([
				{
					type: "confirm",
					name: "confirm",
					message: `Would you like to switch your account to ${organisationUuid} now?`,
				},
			]);
			if (response.confirm) {
				const loader = ora(
					"Switching to correct organisation ..."
				).start();
				try {
					await api({
						path: `/users/${authData.userUuid}/move`,
						method: "PUT",
						json: {
							data: {
								organisationUuid,
							},
						},
					});
					loader.succeed();
				} catch (e) {
					error(e, loader);
					throw e;
				}
			}
		}
	}
}

export async function login(body, opts = {}) {
	return await api({
		path: "/login",
		method: "POST",
		json: body,
	});
}

export async function getToken(program, opts, warnEarly) {
	if (opts.$tokenFromEnv) return;
	let isNewToken = false;
	let organisationUuid;
	if (!token) {
		({ token, organisationUuid } = opts);
		setTokenExpiresAt();
		isNewToken = true;
	}
	if (isTokenExpired(warnEarly)) {
		({ token } = await doLogin(
			program,
			"Your token has expired, please login again"
		));
		setTokenExpiresAt();
		await updateConfig({ token });
		isNewToken = true;
	}
	opts.token = token;
	if (isNewToken) await checkCorrectOrganisation(organisationUuid, opts);

	return token;
}
