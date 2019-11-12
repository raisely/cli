import api from './api';

export async function getCampaigns({ organisationId }, token) {
    return await api({
        path: '/campaigns',
        method: 'GET',
        auth: {
            bearer: token
        }
    }, config.apiUrl)
}

export async function updateStyles({ path, css }, token) {
    const campaign = await api({
        path: `/campaigns/${path}`,
        qs: { private: 1 },
        method: 'GET',
        auth: {
            bearer: token
        }
    }, config.apiUrl);
    return await api({
        path: `/campaigns/${path}/config/css`,
        qs: { private: 1 },
        method: 'PATCH',
        json: {
            data: Object.assign(campaign.data.config.css, {
                custom_css: css
            })
        },
        auth: {
            bearer: token
        }
    }, config.apiUrl)
}