import jsonDeocde from 'json-decode';

import api from "./api";
import { loadConfig } from "../config";

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
			const decoded = jsonDeocde(token);
			tokenExpiresAt = new Date(decoded.exp * 1000);
		} catch (e) {
			console.warn("Could not decode token, is it a JWT?");
		}
	}
}

async function checkCorrectOrganisation(organisationUuid) {
	if (organisationUuid) {
		const authData = await api(
			{
				path: "/authenticate",
				method: "GET",
			},
			opts.apiUrl
		);
		if (authData.organisationUuid !== organisationUuid) {
			log(
				`This configuration is for organisation ${organisationUuid} but you are currently in organisation ${tokenOrganisationUuid}`,
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
				await api(
					{
						path: "/users/:user/move",
						method: "PUT",
						json: {
							data: {
								organisationUuid,
							}
						}
					},
					opts.apiUrl
				);
			}
		}
	}
}

export async function login(body, opts = {}) {
	return await api(
		{
			path: "/login",
			method: "POST",
			json: body
		},
		opts.apiUrl
	);
}

export async function getToken(warnEarly) {
	let isNewToken = false;
	if (!token) {
		({ token, organisationUuid }) = await loadConfig();
		setTokenExpiresAt();
		isNewToken = true;
	}
	if (isTokenExpired(warnEarly)) {
		({ token } = await doLogin('Your token has expired, please login again'));
		setTokenExpiresAt();
		await updateConfig({ token });
		isNewToken = true;
	}
	if (isNewToken) await checkCorrectOrganisation(organisationUuid);

	return token;
}
