import fs from 'fs';
import path from 'path';
import https from 'https';
import ora from 'ora';
import { jwtDecode } from 'jwt-decode';
import fetch from 'node-fetch';

import { loadConfig, defaults, CONFIG_FILE, updateConfig } from './config.js';
import {
	clearCredentials,
	getAccountKey,
	getKeychainEntry,
	resolveOrganisationContext,
} from './credentials.js';

const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

async function deleteJwtToken(accountKey) {
	const entry = getKeychainEntry(accountKey);
	const raw = entry.getPassword();

	if (!raw) return;
	let stored;

	try {
		stored = JSON.parse(raw);
	} catch {
		return;
	}

	if (!stored?.access_token) return;

	const config = await loadConfig({ allowEmpty: true });
	const apiUrl = config.apiUrl || defaults.apiUrl;
	const token = stored.access_token;
	const looksJwt =
		typeof token === 'string' && token.split('.').length === 3;

	if (!looksJwt) return;

	try {
		const decoded = jwtDecode(token);
		const tokenUuid =
			decoded.uuid || decoded.jti || decoded.sub;
		if (!tokenUuid) return;

		const base = apiUrl.replace(/\/$/, '');
		await fetch(`${base}/v3/tokens/${tokenUuid}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${token}`,
				'x-raisely-client': 'cli',
			},
			agent: devHttpsAgent,
		});
	} catch {
		// best-effort revoke
	}
}

/**
 * Best-effort revoke of the current access token, then clear keychain + session pointer.
 */
export default async function logoutAction() {
	const logoutLoader = ora('Signing you out...').start();

	try {
		const ctx = await resolveOrganisationContext();

		if (!ctx) return;
		const accountKey = getAccountKey(ctx);
		deleteJwtToken(accountKey);
		clearCredentials({ apiUrl: ctx.apiUrl, organisationUuid: ctx.organisationUuid });
	} catch {
		// continue to local cleanup
	} finally {
		const configPath = path.join(process.cwd(), CONFIG_FILE);
		if (fs.existsSync(configPath)) {
			try {
				await updateConfig({ token: null });
			} catch {
				// noop
			}
		}
		logoutLoader.succeed('You are signed out.');
	}
}
