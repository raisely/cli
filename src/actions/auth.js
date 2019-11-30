import api from './api';

export async function login({ username, password }, opts = {}) {
    return await api({
        path: '/login',
        method: 'POST',
        json: {
            username, password
        }
    }, opts.apiUrl)
}