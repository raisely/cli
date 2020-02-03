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

export async function updateStyles({ path, css }, config) {
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
	return await api(
		{
			path: `/campaigns/${path}/config/css`,
			qs: { private: 1 },
			method: "PATCH",
			json: {
				data: Object.assign(campaign.data.config.css, {
					custom_css: css
				})
			},
			auth: {
				bearer: config.token
			}
		},
		config.apiUrl
	);
}
