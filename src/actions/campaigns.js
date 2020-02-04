import api from "./api";

export async function getCampaigns({ organisationId }, token, opts = {}) {
	return await api(
		{
			path: "/campaigns",
			method: "GET",
			auth: {
				bearer: token
			}
		},
		opts.apiUrl
	);
}

export async function updateStyles({ path, files, css }, config) {
	const campaign = await api(
		{
			path: `/campaigns/${path}`,
			qs: { private: 1 },
			method: "GET",
			auth: {
				bearer: config.token
			}
		},
		config.apiUrl
	);

	const data = Object.assign({}, campaign.data.config.css, {
		files,
		custom_css: css
	});

	return await api(
		{
			path: `/campaigns/${path}/config/css`,
			qs: { private: 1 },
			method: "PATCH",
			json: {
				data
			},
			auth: {
				bearer: config.token
			}
		},
		config.apiUrl
	);
}
