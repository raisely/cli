import fs from 'fs';
import path from 'path';
import os from 'os';

import { Entry } from '@napi-rs/keyring';

import { loadConfig, defaults } from './config.js';

export const KEYCHAIN_SERVICE = '@raisely/cli';
export const SESSION_DIR = path.join(os.homedir(), '.raisely');
export const SESSION_FILE = path.join(SESSION_DIR, 'session.json');

export const OAUTH_CLIENT_ID_PLACEHOLDER = 'dd351b20-3ab6-11f1-94a6-69c9c59c597d';

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** @type {Map<string, Promise<void>>} */
const refreshInFlight = new Map();

export class NotAuthenticatedError extends Error {
	constructor(message = 'Run `raisely login` to authenticate') {
		super(message);
		this.name = 'NotAuthenticatedError';
	}
}

export function getOAuthClientId() {
	return process.env.RAISELY_OAUTH_CLIENT_ID || OAUTH_CLIENT_ID_PLACEHOLDER;
}

export function getOAuthScopes() {
	return (
		process.env.RAISELY_OAUTH_SCOPES ||
		'campaigns:read campaigns:update pages:read components:read components:update'
	);
}

export function getHost(apiUrl) {
	return new URL(apiUrl).host;
}

export function getAccountKey({ apiUrl, organisationUuid }) {
	if (!apiUrl || !organisationUuid) {
		throw new Error('apiUrl and organisationUuid are required for keychain key');
	}
	return `${getHost(apiUrl)}:${organisationUuid}`;
}

export function readSessionPointer() {
	try {
		const raw = fs.readFileSync(SESSION_FILE, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function writeSessionPointer({ host, organisationUuid }) {
	fs.mkdirSync(SESSION_DIR, { recursive: true });
	fs.writeFileSync(
		SESSION_FILE,
		JSON.stringify({ host, organisationUuid }, null, 2)
	);
}

export function clearSessionPointerIfMatches(host, organisationUuid) {
	const s = readSessionPointer();
	if (
		s &&
		s.host === host &&
		s.organisationUuid === organisationUuid
	) {
		try {
			fs.unlinkSync(SESSION_FILE);
		} catch {
			// noop
		}
	}
}

/**
 * Resolve apiUrl + organisationUuid from project config, then ~/.raisely/session.json.
 */
export async function resolveOrganisationContext() {
	const config = await loadConfig({ allowEmpty: true });
	const apiUrl = config.apiUrl || defaults.apiUrl;
	let organisationUuid = config.organisationUuid;

	if (!organisationUuid) {
		const session = readSessionPointer();
		const host = getHost(apiUrl);
		if (session && session.host === host && session.organisationUuid) {
			organisationUuid = session.organisationUuid;
		}
	}

	if (!organisationUuid) {
		return null;
	}
	return { apiUrl, organisationUuid };
}

export function getKeychainEntry(accountKey) {
	return new Entry(KEYCHAIN_SERVICE, accountKey);
}

/**
 * Node's fetch often throws TypeError "fetch failed" with the real reason on `cause`
 * (e.g. TLS errors to local HTTPS). Surface that so token exchange failures are diagnosable.
 */
function rethrowFetchFailure(fetchUrl, e) {
	const c = e && typeof e === 'object' && 'cause' in e ? e.cause : null;
	const detail = c && typeof c === 'object' && 'message' in c ? c.message : e.message;
	const code = c && typeof c === 'object' && 'code' in c ? c.code : '';
	const parts = [`Request to ${fetchUrl} failed: ${detail}`];
	if (code) parts.push(`(${code})`);
	let msg = parts.join(' ');
	if (
		code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
		code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
		code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
		code === 'CERT_HAS_EXPIRED'
	) {
		msg +=
			' Local HTTPS often needs NODE_EXTRA_CA_CERTS pointing at your dev CA, or NODE_TLS_REJECT_UNAUTHORIZED=0 for development only.';
	}
	const err = new Error(msg);
	err.cause = c || e;
	throw err;
}

/**
 * POST /v1/oauth/token (no Authorization header).
 */
export async function oauthRequestToken(apiUrl, body) {
	const base = apiUrl.replace(/\/$/, '');
	const fetchUrl = `${base}/v1/oauth/token`;
	let response;
	try {
		response = await fetch(fetchUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	} catch (e) {
		rethrowFetchFailure(fetchUrl, e);
	}

	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		const err = new Error(
			`Token endpoint returned non-JSON (${response.status}): ${text.slice(0, 200)}`
		);
		err.status = response.status;
		throw err;
	}

	if (!response.ok) {
		const err = new Error(
			json.error_description || json.error || response.statusText || 'Token request failed'
		);
		err.code = json.error;
		err.status = response.status;
		throw err;
	}
	return json;
}

function needsProactiveRefresh(stored) {
	if (!stored.expires_at) return true;
	return stored.expires_at - Date.now() < REFRESH_WINDOW_MS;
}

/**
 * @param {{ apiUrl: string, organisation_uuid: string, access_token: string, refresh_token?: string, expires_in: number }} params
 */
export async function saveCredentials({
	apiUrl,
	organisation_uuid,
	access_token,
	refresh_token,
	expires_in,
}) {
	const accountKey = getAccountKey({ apiUrl, organisationUuid: organisation_uuid });
	const expires_at = Date.now() + expires_in * 1000;
	const payload = {
		access_token,
		refresh_token,
		expires_at,
		organisation_uuid,
	};
	const entry = getKeychainEntry(accountKey);
	entry.setPassword(JSON.stringify(payload));
	writeSessionPointer({
		host: getHost(apiUrl),
		organisationUuid: organisation_uuid,
	});
}

/**
 * Merge token response into stored credentials (e.g. after refresh).
 */
async function persistAfterRefresh(
	accountKey,
	apiUrl,
	organisation_uuid,
	data
) {
	const expires_in = data.expires_in;
	const expires_at = Date.now() + expires_in * 1000;
	const entry = getKeychainEntry(accountKey);
	let refresh_token = data.refresh_token;
	if (!refresh_token) {
		const prev = entry.getPassword();
		if (prev) {
			try {
				refresh_token = JSON.parse(prev).refresh_token;
			} catch {
				// noop
			}
		}
	}
	const payload = {
		access_token: data.access_token,
		refresh_token,
		expires_at,
		organisation_uuid: data.organisation_uuid || organisation_uuid,
	};
	entry.setPassword(JSON.stringify(payload));
	writeSessionPointer({
		host: getHost(apiUrl),
		organisationUuid: payload.organisation_uuid,
	});
}

export async function refreshAccessToken(accountKey, apiUrl) {
	const entry = getKeychainEntry(accountKey);
	const raw = entry.getPassword();
	if (!raw) {
		throw new NotAuthenticatedError();
	}
	let stored;
	try {
		stored = JSON.parse(raw);
	} catch {
		throw new NotAuthenticatedError('Stored credentials are corrupted');
	}
	if (!stored.refresh_token) {
		throw new NotAuthenticatedError('No refresh token stored; run `raisely login`');
	}

	const clientId = getOAuthClientId();
	if (refreshInFlight.has(accountKey)) {
		await refreshInFlight.get(accountKey);
		return;
	}

	const refreshPromise = (async () => {
		try {
			const data = await oauthRequestToken(apiUrl, {
				grant_type: 'refresh_token',
				client_id: clientId,
				refresh_token: stored.refresh_token,
			});
			await persistAfterRefresh(
				accountKey,
				apiUrl,
				stored.organisation_uuid,
				data
			);
		} catch (e) {
			if (
				e.code === 'invalid_grant' ||
				e.status === 401 ||
				e.status === 400
			) {
				clearCredentials({ apiUrl, organisationUuid: stored.organisation_uuid });
			}
			throw e;
		}
	})();

	refreshInFlight.set(accountKey, refreshPromise);
	try {
		await refreshPromise;
	} finally {
		refreshInFlight.delete(accountKey);
	}
}

/**
 * Refresh stored keychain tokens for the current org context (401 recovery).
 */
export async function refreshCredentialsForCurrentContext() {
	const ctx = await resolveOrganisationContext();
	if (!ctx) {
		throw new NotAuthenticatedError();
	}
	const accountKey = getAccountKey(ctx);
	await refreshAccessToken(accountKey, ctx.apiUrl);
}

export function clearCredentials({ apiUrl, organisationUuid }) {
	const accountKey = getAccountKey({ apiUrl, organisationUuid });
	const entry = getKeychainEntry(accountKey);
	try {
		entry.deletePassword();
	} catch {
		// noop
	}
	clearSessionPointerIfMatches(getHost(apiUrl), organisationUuid);
}

/**
 * @returns {Promise<{ token: string, source: 'env' | 'keyring' | 'config' }>}
 */
export async function getCredentials({ allowPrompt = true } = {}) {
	if (process.env.RAISELY_TOKEN) {
		return {
			token: process.env.RAISELY_TOKEN,
			source: 'env',
		};
	}

	const config = await loadConfig({ allowEmpty: true });
	const ctx = await resolveOrganisationContext();

	if (ctx) {
		const accountKey = getAccountKey(ctx);
		const entry = getKeychainEntry(accountKey);
		const raw = entry.getPassword();
		if (raw) {
			let stored;
			try {
				stored = JSON.parse(raw);
			} catch {
				throw new NotAuthenticatedError('Stored credentials are corrupted');
			}
			if (needsProactiveRefresh(stored)) {
				try {
					await refreshAccessToken(accountKey, ctx.apiUrl);
					const updated = getKeychainEntry(accountKey).getPassword();
					if (updated) {
						stored = JSON.parse(updated);
					}
				} catch (e) {
					if (e instanceof NotAuthenticatedError) throw e;
					throw new NotAuthenticatedError(
						e.message || 'Session expired; run `raisely login`'
					);
				}
			}
			const latest = getKeychainEntry(accountKey).getPassword();
			const parsed = latest ? JSON.parse(latest) : stored;
			return {
				token: parsed.access_token,
				source: 'keyring',
			};
		}
	}

	if (config.token) {
		return { token: config.token, source: 'config' };
	}

	if (!allowPrompt) {
		throw new NotAuthenticatedError();
	}
	throw new NotAuthenticatedError();
}
