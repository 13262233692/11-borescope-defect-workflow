import http from './http';

export const caseApi = {
  list: (params) =>
    http.get('/cases', { params }),

  get: (id) =>
    http.get(`/cases/${id}`),

  create: (data) =>
    http.post('/cases', data),

  submit: (id, data = {}) =>
    http.post(`/cases/${id}/submit`, data),

  review: (id, data) =>
    http.post(`/cases/${id}/review`, data),

  release: (id, data) =>
    http.post(`/cases/${id}/release`, data),

  close: (id, data = {}) =>
    http.post(`/cases/${id}/close`, data),

  reopen: (id, data = {}) =>
    http.post(`/cases/${id}/reopen`, data),

  addComment: (id, comment) =>
    http.post(`/cases/${id}/comments`, { comment }),

  listAnnotations: (caseId, params) =>
    http.get(`/cases/${caseId}/annotations`, { params })
};
