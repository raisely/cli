import path from 'path';
import fs from 'fs';

import api from './api.js';
import { getBaseStyles, processStyles } from './campaigns.js';
import {
	getCredentials,
	refreshCredentialsForCurrentContext,
} from '../credentials.js';

const DEFAULT_TRANSPILER_URL = 'https://sass-transpiler.raisely.com/transpile';
const AUTH_FAILURE_ERROR = 'Authentication failed; run `raisely login`.';

let BabelAlreadyLoaded = false;

async function loadBabelCore() {
	const [
		{ default: Babel },
		{ default: presetEnv },
		{ default: presetReact },
		{ default: classProps },
	] = await Promise.all([
		import('@babel/core'),
		import('@babel/preset-env'),
		import('@babel/preset-react'),
		import('@babel/plugin-proposal-class-properties'),
	]);

	if (!BabelAlreadyLoaded) {
		Babel.createConfigItem(presetEnv);
		Babel.createConfigItem(presetReact);
		Babel.createConfigItem(classProps);
		BabelAlreadyLoaded = true;
	}

	return { Babel, presetEnv, presetReact, classProps };
}

function resolveTranspilerUrl(raw) {
	const fromEnv = raw?.trim();
	if (!fromEnv) return DEFAULT_TRANSPILER_URL;
	if (fromEnv.endsWith('/transpile')) return fromEnv;
	return `${fromEnv.replace(/\/$/, '')}/transpile`;
}

function toErrorMessage(error, fallback) {
	if (typeof error === 'string' && error.trim()) return error.trim();
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	if (error && typeof error.message === 'string' && error.message.trim()) {
		return error.message.trim();
	}
	return fallback;
}

function readResponseError(response, body) {
	const text = typeof body === 'string' ? body.trim() : '';
	if (text) return text;
	return `${response.status} ${response.statusText}`.trim();
}

async function resolveCampaignContext(campaign, deps) {
	if (!campaign) {
		throw new Error('A campaign path or campaign object is required');
	}

	if (typeof campaign === 'object' && campaign.uuid && campaign.path) {
		return { uuid: campaign.uuid, path: campaign.path };
	}

	if (typeof campaign === 'string') {
		const fetched = await deps.apiFn({
			path: `/campaigns/${campaign}?private=1`,
			method: 'GET',
		});
		return { uuid: fetched.data.uuid, path: fetched.data.path };
	}

	if (typeof campaign === 'object' && campaign.uuid) {
		const fetched = await deps.apiFn({
			path: `/campaigns/${campaign.uuid}?private=1`,
			method: 'GET',
		});
		return { uuid: fetched.data.uuid, path: fetched.data.path };
	}

	if (typeof campaign === 'object' && campaign.path) {
		const fetched = await deps.apiFn({
			path: `/campaigns/${campaign.path}?private=1`,
			method: 'GET',
		});
		return { uuid: fetched.data.uuid, path: fetched.data.path };
	}

	throw new Error('A campaign path or campaign object is required');
}

async function sendSassToTranspiler({ body, token, deps }) {
	const response = await deps.fetchImpl(deps.transpilerUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/scss',
			Authorization: `Bearer ${token}`,
		},
		body,
	});
	const responseText = await response.text();
	return { response, responseText };
}

function buildDeps(overrides = {}) {
	return {
		fetchImpl: overrides.fetchImpl || globalThis.fetch,
		apiFn: overrides.apiFn || api,
		getBaseStylesFn: overrides.getBaseStylesFn || getBaseStyles,
		processStylesFn: overrides.processStylesFn || processStyles,
		getCredentialsFn: overrides.getCredentialsFn || getCredentials,
		refreshCredentialsFn:
			overrides.refreshCredentialsFn || refreshCredentialsForCurrentContext,
		loadBabelCoreFn: overrides.loadBabelCoreFn || loadBabelCore,
		fsModule: overrides.fsModule || fs,
		cwd: overrides.cwd || process.cwd,
		transpilerUrl: resolveTranspilerUrl(
			overrides.transpilerUrl || process.env.SASS_TRANSPILER_URL
		),
	};
}

export async function validateCampaignSass(
	{ campaign, token } = {},
	dependencies = {}
) {
	const deps = buildDeps(dependencies);
	if (typeof deps.fetchImpl !== 'function') {
		return { ok: false, error: 'SASS validator fetch transport is not available.' };
	}

	try {
		const { uuid, path: campaignPath } = await resolveCampaignContext(
			campaign,
			deps
		);
		const [baseStyles, styles] = await Promise.all([
			deps.getBaseStylesFn({ uuid }),
			deps.processStylesFn({ campaign: campaignPath }),
		]);
		const payload = `${baseStyles}${styles}`;

		let activeToken = token;
		if (!activeToken) {
			const creds = await deps.getCredentialsFn({ allowPrompt: false });
			activeToken = creds.token;
		}

		try {
			const { response, responseText } = await sendSassToTranspiler({
				body: payload,
				token: activeToken,
				deps,
			});

			if (response.ok) {
				return { ok: true };
			}

			if (response.status !== 401) {
				return { ok: false, error: readResponseError(response, responseText) };
			}
		} catch (error) {
			return {
				ok: false,
				error: toErrorMessage(
					error,
					'Could not reach the SASS transpiler service.'
				),
			};
		}

		try {
			await deps.refreshCredentialsFn();
			const refreshed = await deps.getCredentialsFn({ allowPrompt: false });
			activeToken = refreshed.token;
		} catch {
			return { ok: false, error: AUTH_FAILURE_ERROR };
		}

		try {
			const { response, responseText } = await sendSassToTranspiler({
				body: payload,
				token: activeToken,
				deps,
			});

			if (response.ok) {
				return { ok: true };
			}

			if (response.status === 401) {
				return { ok: false, error: AUTH_FAILURE_ERROR };
			}

			return { ok: false, error: readResponseError(response, responseText) };
		} catch (error) {
			return {
				ok: false,
				error: toErrorMessage(error, 'Could not reach the SASS transpiler service.'),
			};
		}
	} catch (error) {
		return { ok: false, error: toErrorMessage(error, 'SASS validation failed.') };
	}
}

export async function validateComponent({ name } = {}, dependencies = {}) {
	const deps = buildDeps(dependencies);

	if (!name) {
		return { ok: false, error: 'Component name is required.' };
	}

	try {
		const sourcePath = path.join(deps.cwd(), 'components', name, `${name}.js`);
		const source = deps.fsModule.readFileSync(sourcePath, 'utf8');
		const { Babel, presetEnv, presetReact, classProps } =
			await deps.loadBabelCoreFn();

		await Babel.transformAsync(source, {
			presets: [presetEnv, presetReact],
			plugins: [classProps],
		});

		return { ok: true };
	} catch (error) {
		return { ok: false, error: toErrorMessage(error, 'Component validation failed.') };
	}
}
