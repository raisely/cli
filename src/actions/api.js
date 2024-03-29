import fetch from 'node-fetch';
import https from 'https';
import _ from 'lodash';
import { loadConfig, defaults } from '../config.js';

const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

function getResponseContentType(response) {
	const rawResponseContentType = response.headers.get('Content-Type');
	const [contentType] = rawResponseContentType.split(';');
	return contentType;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function api(options) {
	const config = await loadConfig({ allowEmpty: true });
	const isJson =
		!options.path.includes('.js') && !options.path.includes('.css');

	const fetchUrl = `${config.apiUrl}/v3${options.path}`;
	const retryConfig = { retry: 3, pause: 5000 };

	while (retryConfig.retry > 0) {
		try {
			const response = await fetch(
				fetchUrl,
				Object.assign(options, {
					headers: {
						...(isJson
							? {
									'Content-Type': 'application/json',
							  }
							: {}),
						...(config.token
							? { Authorization: `Bearer ${config.token}` }
							: {}),
						...options.headers,
						'x-raisely-cli': true,
					},
					body:
						options.method !== 'GET' && options.json
							? JSON.stringify(options.json)
							: undefined,
					agent: config.apiUrl ? devHttpsAgent : undefined,
				})
			);

			const contentType = getResponseContentType(response);
			const responseIsJSON = contentType === 'application/json';

			const parseFormat = responseIsJSON ? 'json' : 'text';
			const formatted = await response[parseFormat]();

			if (response.status >= 399) {
				const error = {
					message: `${fetchUrl} (${
						response.status
					}) failed with message: ${
						(responseIsJSON && formatted.detail) ||
						response.statusText
					}`,
					status: response.status,
				};

				if (responseIsJSON && formatted) {
					// if subcode, add this to error
					const subcode = _.get(formatted, 'errors[0].subcode');
					if (subcode) {
						error.subcode = subcode;
					}
				}

				throw error;
			}
			return formatted;
		} catch (e) {
			retryConfig.retry--;

			// Handle MFA error
			if (e.subcode && e.subcode.startsWith('MFA required')) {
				throw e;
			}

			// Skip hard failures, except a timeout
			if (e.status <= 500 && e.status !== 408) {
				throw e.message;
			}

			// Retries exceeeded
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
