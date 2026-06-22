import http from './http';

export const imageApi = {
  upload: (caseId, files, onProgress) => {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));

    return http.post(`/cases/${caseId}/images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      }
    });
  },

  list: (caseId) =>
    http.get(`/cases/${caseId}/images`),

  get: (caseId, imageId) =>
    http.get(`/cases/${caseId}/images/${imageId}`),

  remove: (caseId, imageId) =>
    http.delete(`/cases/${caseId}/images/${imageId}`),

  getTileInfo: (caseId, imageId) =>
    http.get(`/cases/${caseId}/images/${imageId}/tiles/info`),

  getTileUrl: (caseId, imageId, level, x, y) =>
    `/api/cases/${caseId}/images/${imageId}/tiles/${level}/${x}/${y}.jpg`,

  getRawUrl: (caseId, imageId) =>
    `/api/cases/${caseId}/images/${imageId}/raw`
};

export const archiveApi = {
  list: (caseId) =>
    http.get(`/cases/${caseId}/archives`),

  create: (caseId, data) =>
    http.post(`/cases/${caseId}/archives`, data),

  get: (caseId, archiveId) =>
    http.get(`/cases/${caseId}/archives/${archiveId}`),

  retry: (caseId, archiveId) =>
    http.post(`/cases/${caseId}/archives/${archiveId}/retry`),

  downloadUrl: (caseId, archiveId) =>
    `${getBaseURL()}/cases/${caseId}/archives/${archiveId}/download`,

  download: (caseId, archiveId) =>
    http.download(`/cases/${caseId}/archives/${archiveId}/download`)
};

export const annotationApi = {
  create: (caseId, data) =>
    http.post(`/cases/${caseId}/annotations`, data),

  update: (caseId, annotationId, data) =>
    http.put(`/cases/${caseId}/annotations/${annotationId}`, data),

  delete: (caseId, annotationId) =>
    http.delete(`/cases/${caseId}/annotations/${annotationId}`),

  sync: (caseId, payload) =>
    http.post(`/cases/${caseId}/annotations/sync`, payload)
};
