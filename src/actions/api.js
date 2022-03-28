import fetch from "node-fetch";
import https from "https";
import { loadConfig, defaults } from "../config.js";

const devHttpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

export default async function api(options, apiUrl) {
	const config = await loadConfig({ allowEmpty: true });
	const isJson =
		!options.path.includes(".js") && !options.path.includes(".css");

	const response = await fetch(
		`${config.apiUrl}/v3${options.path}`,
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
			},
			body:
				options.method !== "GET" && options.json
					? JSON.stringify(options.json)
					: undefined,
			agent: config.apiUrl ? devHttpsAgent : undefined,
		})
	);

	const formatted = isJson ? await response.json() : await response.text();

	if (response.status > 399) {
		throw new Error(formatted.detail);
	}

	return formatted;
}
