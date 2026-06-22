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

export default service;
