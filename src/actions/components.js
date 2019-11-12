import api from './api';

async function getComponent(uuid, opts = {}) {
    return await api({
        path: `/components/${uuid}`,
        qs: { private: 1 },
        method: 'GET',
        auth: {
            bearer: opts.token
        }
    }, opts.apiUrl)
}

export async function createComponent({ name, apiUrl }, token) {
    // fetch the organisation ID
    const user = await api({
        path: '/users/me',
        auth: {
            bearer: token
        }
    }, apiUrl);
    return await api({
        path: `/components`,
        qs: { private: 1 },
        method: 'POST',
        json: {
            data: {
                name,
                organisationUuid: user.data.organisationUuid
            }
        },
        auth: {
            bearer: token
        }
    }, apiUrl)
}

export async function updateComponentConfig({ file, config }, opts = {}) {
    const component = await getComponent(config.uuid, opts);
    return await api({
        path: `/components/${config.uuid}`,
        qs: { private: 1 },
        method: 'PATCH',
        json: {
            data: {
                latestSchema: {
                    ...component.data.latestSchema,
                    data: {
                        ...component.data.latestSchema.data,
                        editable: config.fields
                    }
                },
                latestVersion: component.data.latestVersion + 1
            }
        },
        auth: {
            bearer: opts.token
        }
    }, opts.apiUrl)
}

export async function updateComponentFile({ file, config }, opts = {}) {
    const component = await getComponent(config.uuid, opts);
    return await api({
        path: `/components/${config.uuid}`,
        qs: { private: 1 },
        method: 'PATCH',
        json: {
            data: {
                latestHtml: file,
                latestSchema: {
                    ...component.data.latestSchema,
                    data: {
                        ...component.data.latestSchema.data,
                        editable: config.fields
                    }
                },
                latestVersion: component.data.latestVersion + 1
            }
        },
        auth: {
            bearer: opts.token
        }
    }, opts.apiUrl)
}