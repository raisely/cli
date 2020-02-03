import api from "./api";

export async function login(body, opts = {}) {
	return await api(
		{
			path: "/login",
			method: "POST",
			json: body
		},
		opts.apiUrl
	);
}
