import api from './api';

async function getComponent(uuid, token) {
    return await api({
        path: `/components/${uuid}`,
        qs: { private: 1 },
        method: 'GET',
        auth: {
            bearer: token
        }
    }, config.apiUrl)
}

export async function createComponent({ name }, token) {
    // fetch the organisation ID
    const user = await api({
        path: '/users/me',
        auth: {
            bearer: token
        }
    }, config.apiUrl);
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
    }, config.apiUrl)
}

export async function updateComponentConfig({ file, config }, token) {
    const component = await getComponent(config.uuid, token);
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
            bearer: token
        }
    }, config.apiUrl)
}

export async function updateComponentFile({ file, config }, token) {
    const component = await getComponent(config.uuid, token);
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
            bearer: token
        }
    }, config.apiUrl)
}