import fetch from 'node-fetch';
import https from 'https';
import _ from 'lodash';
import { loadConfig } from '../config.js';
import {
	getCredentials,
	refreshCredentialsForCurrentContext,
	NotAuthenticatedError,
} from '../credentials.js';
import { sleep } from './sleep.js';

const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

function getResponseContentType(response) {
	const rawResponseContentType = response.headers.get('Content-Type');
	if (!rawResponseContentType) return '';
	const [contentType] = rawResponseContentType.split(';');
	return contentType;
}

export default async function api(options) {
	const config = await loadConfig({ allowEmpty: true });
	const isJson =
		!options.path.includes('.js') && !options.path.includes('.css');

	const fetchUrl = `${config.apiUrl}/v3${options.path}`;
	const retryConfig = { retry: 3, pause: 5000 };
	const skipAuth = options.skipAuth === true;

	while (retryConfig.retry > 0) {
		try {
			for (let attempt = 0; attempt < 2; attempt++) {
				let bearer = null;
				let tokenSource = 'config';

				if (!skipAuth) {
					const creds = await getCredentials({ allowPrompt: true });
					bearer = creds.token;
					tokenSource = creds.source;
				}

				const response = await fetch(fetchUrl, {
					method: options.method || 'GET',
					headers: {
						...(isJson && !options.formData
							? {
									'Content-Type': 'application/json',
							  }
							: {}),
						...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
						...options.headers,
						'x-raisely-client': 'cli',
					},
					body:
						options.method !== 'GET'
							? (options.rawBody ??
							  options.formData ??
							  (options.json
									? JSON.stringify(options.json)
									: undefined))
							: undefined,
					agent: config.apiUrl ? devHttpsAgent : undefined,
				});

				if (
					response.status === 401 &&
					!skipAuth &&
					tokenSource === 'keyring' &&
					attempt === 0
				) {
					await response.text();
					await refreshCredentialsForCurrentContext();
					continue;
				}

				const contentType = getResponseContentType(response);
				const responseIsJSON = contentType === 'application/json';

				const parseFormat = responseIsJSON ? 'json' : 'text';
				const formatted = await response[parseFormat]();

				if (response.status < 399) return formatted;

				const err = {
					message: `${fetchUrl} (${
						response.status
					}) failed with message: ${
						(responseIsJSON && formatted.detail) ||
						response.statusText
					}`,
					status: response.status,
				};

				if (responseIsJSON && formatted) {
					const subcode = _.get(formatted, 'errors[0].subcode');
					if (subcode) {
						err.subcode = subcode;
					}
				}

				throw err;
			}
		} catch (e) {
			if (e instanceof NotAuthenticatedError) {
				throw e.message;
			}

			retryConfig.retry--;

			if (e.subcode && e.subcode.startsWith('MFA required')) {
				throw e;
			}

			if (e.status <= 500 && e.status !== 408) {
				throw e.message;
			}

			if (retryConfig.retry === 0) {
				throw e.message;
			}

			console.error('');
			console.error(`An error occured, retrying... `);
			console.error(`${e.message}`);
			await sleep(retryConfig.pause);
		}
	}
}
