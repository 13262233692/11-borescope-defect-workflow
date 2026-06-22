import http from './http';

export const engineApi = {
  list: (params) =>
    http.get('/engines', { params }),

  get: (id) =>
    http.get(`/engines/${id}`),

  create: (data) =>
    http.post('/engines', data),

  update: (id, data) =>
    http.put(`/engines/${id}`, data)
};
