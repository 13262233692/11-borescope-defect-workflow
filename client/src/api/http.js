import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';
import { useUserStore } from '@/stores/user';

const service = axios.create({
  baseURL: '/api',
  timeout: 60000
});

service.interceptors.request.use(
  (config) => {
    const userStore = useUserStore();
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

service.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data && data.success === false) {
      const err = data.error || {};
      ElMessage.error(err.message || '请求失败');
      return Promise.reject(new Error(err.message));
    }
    return data.data;
  },
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;

    if (status === 401) {
      const userStore = useUserStore();
      userStore.logout();
      ElMessage.error(message || '登录已过期，请重新登录');
      router.push('/login');
    } else if (status === 403) {
      ElMessage.error(message || '无权限执行此操作');
    } else if (status === 404) {
      ElMessage.warning(message || '资源不存在');
    } else if (status === 409) {
      ElMessage.warning(message || '数据冲突，请刷新后重试');
    } else if (status === 400) {
      ElMessage.warning(message || '请求参数错误');
    } else if (status && status >= 500) {
      ElMessage.error(message || '服务器错误，请稍后重试');
    }

    return Promise.reject({
      status,
      message,
      code: error.response?.data?.error?.code,
      details: error.response?.data?.error?.details,
      raw: error
    });
  }
);

service.download = function downloadFile(url, params = {}) {
  const userStore = useUserStore();
  const qs = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const full = (url.startsWith('/') ? '' : '/') + url + (qs ? `?${qs}` : '');
  const base = service.defaults.baseURL || '';

  const headers = { Authorization: `Bearer ${userStore.token}` };
  return fetch(base + full, { headers })
    .then(async (res) => {
      if (!res.ok) {
        const ct = res.headers.get('content-type');
        if (ct?.includes('application/json')) {
          const data = await res.json();
          const msg = data?.error?.message || `下载失败 (${res.status})`;
          ElMessage.error(msg);
        } else {
          ElMessage.error(`下载失败 (${res.status})`);
        }
        throw new Error(res.status);
      }
      const blob = await res.blob();
      const disp = res.headers.get('content-disposition') || '';
      let filename = '';
      const utf8Match = disp.match(/filename\*=UTF-8''([^;]+)/);
      const asciiMatch = disp.match(/filename="?([^";]+)"?/);
      if (utf8Match) filename = decodeURIComponent(utf8Match[1]);
      else if (asciiMatch) filename = asciiMatch[1];
      else filename = `download-${Date.now()}.tar.gz`;

      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      return { ok: true, filename, size: blob.size };
    });
};

export default service;
