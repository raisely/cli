import api from "./api";
import jsonDeocde from 'json-decode';

let token = null;
let tokenExpiresAt = null;

/**
 * Return true if a token has an exp and it's in the past or the next 24 hours
 * (easier to update password at the start of the session than notice it needs
 * updating 10 minutes in)
 * @returns {boolean}
 */
function tokenExpiresSoon() {
	if (tokenExpiresAt) {
		const window = 24 * 60 * 60 * 1000;
		const expiresWindow = new Date().getTime() + window;
		return tokenExpiresAt.getTime() < expiresWindow;
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

export async function getToken() {
	if (!token) ({ token }) = loadConfig();
	setTokenExpiresAt();
	if (tokenExpiresSoon()) {
		({ token } = await doLogin('Your token has expired, please login again'));
		setTokenExpiresAt();
		await updateConfig({ token });
	}

	return token;
}
