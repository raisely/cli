import api from './api.js';

export async function listCampaignMedia({ campaign }) {
	return await api({
		path: `/campaigns/${campaign}/media`,
		method: 'GET',
	});
}

export async function listOrganisationMedia({ organisation }) {
	return await api({
		path: `/organisations/${organisation}/media`,
		method: 'GET',
	});
}

export async function deleteCampaignMedia({ campaign, uuid }) {
	return await api({
		path: `/campaigns/${campaign}/media/${uuid}`,
		method: 'DELETE',
	});
}

export async function deleteOrganisationMedia({ organisation, uuid }) {
	return await api({
		path: `/organisations/${organisation}/media/${uuid}`,
		method: 'DELETE',
	});
}
