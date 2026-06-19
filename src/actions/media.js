import fs from 'fs/promises';
import path from 'path';

import FormData from 'form-data';

import api from './api.js';

const MIME_TYPES = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
};

function mimeTypeForFile(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_TYPES[ext] ?? 'application/octet-stream';
}

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

export async function uploadCampaignMedia({ campaign, file, url }) {
	if (url) {
		return await api({
			path: `/campaigns/${campaign}/media`,
			method: 'POST',
			json: { url },
		});
	}
	const data = await fs.readFile(file);
	const form = new FormData();
	form.append('file', data, {
		filename: path.basename(file),
		contentType: mimeTypeForFile(file),
	});
	return await api({
		path: `/campaigns/${campaign}/media`,
		method: 'POST',
		rawBody: form,
		headers: { 'Content-Type': form.getHeaders()['content-type'] },
	});
}

export async function uploadOrganisationMedia({ organisation, file, url }) {
	if (url) {
		return await api({
			path: `/organisations/${organisation}/media`,
			method: 'POST',
			json: { url },
		});
	}
	const data = await fs.readFile(file);
	const form = new FormData();
	form.append('file', data, {
		filename: path.basename(file),
		contentType: mimeTypeForFile(file),
	});
	return await api({
		path: `/organisations/${organisation}/media`,
		method: 'POST',
		rawBody: form,
		headers: { 'Content-Type': form.getHeaders()['content-type'] },
	});
}
