import request from 'request-promise-native';

export default async function api(options) {
    return await request(Object.assign(options, {
        url: `https://api.raisely.com/v3${options.path}`,
        json: options.json || true
    }))
}