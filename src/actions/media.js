import fs from 'fs/promises';
import path from 'path';

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

function buildMultipartBody(data, filename, mimeType) {
	const boundary = `----RaiselyFormBoundary${Date.now().toString(16)}`;
	const CRLF = '\r\n';
	const head = Buffer.from(
		`--${boundary}${CRLF}` +
			`Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
			`Content-Type: ${mimeType}${CRLF}` +
			CRLF
	);
	const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
	return {
		body: Buffer.concat([head, data, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
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
	const { body, contentType } = buildMultipartBody(
		data,
		path.basename(file),
		mimeTypeForFile(file)
	);
	return await api({
		path: `/campaigns/${campaign}/media`,
		method: 'POST',
		rawBody: body,
		headers: { 'Content-Type': contentType },
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
	const { body, contentType } = buildMultipartBody(
		data,
		path.basename(file),
		mimeTypeForFile(file)
	);
	return await api({
		path: `/organisations/${organisation}/media`,
		method: 'POST',
		rawBody: body,
		headers: { 'Content-Type': contentType },
	});
}
