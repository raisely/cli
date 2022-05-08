import fetch from "node-fetch";
import https from "https";
import { loadConfig, defaults } from "../config.js";

const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

function getResponseContentType(response) {
	const rawResponseContentType = response.headers.get('Content-Type');
	const [contentType] = rawResponseContentType.split(';');
	return contentType;
}

export default async function api(options) {
	const config = await loadConfig({ allowEmpty: true });
	const isJson =
		!options.path.includes(".js") && !options.path.includes(".css");

	const fetchUrl = `${config.apiUrl}/v3${options.path}`;

	const response = await fetch(
		fetchUrl,
		Object.assign(options, {
			headers: {
				...(isJson
					? {
							"Content-Type": "application/json",
					  }
					: {}),
				...(config.token
					? { Authorization: `Bearer ${config.token}` }
					: {}),
				...options.headers,
				"x-raisely-cli": true,
			},
			body:
				options.method !== "GET" && options.json
					? JSON.stringify(options.json)
					: undefined,
			agent: config.apiUrl ? devHttpsAgent : undefined,
		})
	);

	// Use the actual response type header, don't just guess
	const contentType = getResponseContentType(response);
	const responseIsJSON = contentType === 'application/json';

	const parseFormat = responseIsJSON ? 'json' : 'text';
	const formatted = await response[parseFormat]();

	if (response.status > 399) {
		// Add extra line break before throwing error - for better visual grep
		console.error('');

		const formattedError =
			`${fetchUrl} (${response.status}) failed with message: ${
				(responseIsJSON && formatted.detail) || response.statusText}`;

		throw new Error(formattedError);
	}

	return formatted;
}
