import fetch from 'node-fetch';
import https from 'https';

import { loadConfig } from './config.js';
import { getCredentials, resolveOrganisationContext } from './credentials.js';
import { getPackageInfo } from './helpers.js';

const pending = new Set();
const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});
const TELEMETRY_REQUEST_TIMEOUT_MS = 10_000;

let cachedMetadata;
let metadataPromise;

function telemetryDisabled() {
	const raw = process.env.RAISELY_NO_TELEMETRY;
	if (!raw) return false;
	const normalized = String(raw).trim().toLowerCase();
	return normalized === '1' || normalized === 'true';
}

function parseAuthenticateResponse(payload) {
	if (!payload || typeof payload !== 'object') {
		return {};
	}
	const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
	return {
		userUuid: data.userUuid,
		organisationUuid: data.organisationUuid,
	};
}

async function fetchAuthenticateContext({ apiUrl, token }) {
	if (!apiUrl || !token) {
		return {};
	}
	try {
		const signal = AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT_MS);
		const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v3/authenticate`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				'x-raisely-cli': 'true',
			},
			signal,
			agent: devHttpsAgent,
		});
		if (!response.ok) {
			return {};
		}
		const payload = await response.json();
		return parseAuthenticateResponse(payload);
	} catch {
		return {};
	}
}

async function resolveTelemetryMetadata() {
	if (cachedMetadata) {
		return cachedMetadata;
	}
	if (!metadataPromise) {
		metadataPromise = (async () => {
			const config = await loadConfig({ allowEmpty: true });
			const campaignIds = Array.isArray(config.campaigns)
				? config.campaigns.filter(Boolean)
				: [];
			const ctx = await resolveOrganisationContext();
			const organisationUuid = ctx?.organisationUuid || config.organisationUuid;
			const apiUrl = ctx?.apiUrl || config.apiUrl;

			let token;
			try {
				const credentials = await getCredentials({ allowPrompt: false });
				token = credentials.token;
			} catch {
				token = null;
			}

			const authContext = await fetchAuthenticateContext({ apiUrl, token });
			const pkg = getPackageInfo();
			return {
				apiUrl,
				token,
				campaignIds,
				organisationUuid:
					authContext.organisationUuid || organisationUuid || undefined,
				userUuid: authContext.userUuid || undefined,
				cliVersion: pkg.version || undefined,
				nodeVersion: process.version,
				platform: process.platform,
			};
		})();
	}
	try {
		cachedMetadata = await metadataPromise;
	} catch {
		cachedMetadata = {
			campaignIds: [],
			nodeVersion: process.version,
			platform: process.platform,
		};
	}
	return cachedMetadata;
}

async function sendPayload(eventName, traits = {}) {
	const metadata = await resolveTelemetryMetadata();
	if (!metadata.apiUrl) {
		return;
	}

	const payload = {
		e: eventName,
		...(metadata.organisationUuid ? { o: metadata.organisationUuid } : {}),
		...(metadata.userUuid ? { u: metadata.userUuid } : {}),
		...(metadata.campaignIds[0] ? { c: metadata.campaignIds[0] } : {}),
		t: {
			outcome: traits.outcome,
			durationMs: traits.durationMs,
			errorCode: traits.errorCode,
			...traits,
			campaignIds: metadata.campaignIds,
			cliVersion: metadata.cliVersion,
			nodeVersion: metadata.nodeVersion,
			platform: metadata.platform,
		},
	};

	const signal = AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT_MS);
	await fetch(`${metadata.apiUrl.replace(/\/$/, '')}/v3/t`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-raisely-cli': 'true',
			...(metadata.token ? { Authorization: `Bearer ${metadata.token}` } : {}),
		},
		body: JSON.stringify(payload),
		signal,
		agent: devHttpsAgent,
	});
}

export function trackEvent(eventName, traits = {}) {
	if (telemetryDisabled()) {
		return;
	}
	const promise = sendPayload(eventName, traits).catch(() => {});
	pending.add(promise);
	promise.finally(() => {
		pending.delete(promise);
	});
}

export async function flushTelemetry() {
	if (pending.size === 0) {
		return;
	}
	await Promise.allSettled([...pending]);
}

export function __resetTelemetryForTests() {
	pending.clear();
	cachedMetadata = undefined;
	metadataPromise = undefined;
}
