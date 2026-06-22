import http from './http';

export const authApi = {
  login: (username, password) =>
    http.post('/auth/login', { username, password }),

  me: () =>
    http.get('/auth/me'),

  listUsers: (params) =>
    http.get('/auth/users', { params }),

  createUser: (data) =>
    http.post('/auth/users', data),

  updateUser: (id, data) =>
    http.put(`/auth/users/${id}`, data)
};
