import { defineStore } from 'pinia';
import { authApi } from '@/api/auth';
import router from '@/router';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    currentUser: null,
    loginLoading: false
  }),

  getters: {
    isLoggedIn: (state) => !!state.token,
    userRole: (state) => state.currentUser?.role || '',
    isInspector: (state) => state.currentUser?.role === 'INSPECTOR',
    isReviewer: (state) => state.currentUser?.role === 'REVIEWER',
    isReleaser: (state) => state.currentUser?.role === 'RELEASER',
    isAdmin: (state) => state.currentUser?.role === 'ADMIN',
    can: (state) => (action) => {
      const role = state.currentUser?.role;
      if (!role) return false;
      if (role === 'ADMIN') return true;
      const matrix = {
        INSPECTOR: ['case:create', 'case:submit', 'annotation:create', 'annotation:update', 'annotation:delete', 'image:upload'],
        REVIEWER:  ['case:approve', 'case:reject', 'annotation:read', 'workflow:comment'],
        RELEASER:  ['case:release', 'case:close', 'certificate:generate', 'workflow:comment']
      };
      return matrix[role]?.includes(action) || false;
    }
  },

  actions: {
    async login(username, password) {
      this.loginLoading = true;
      try {
        const { token, user } = await authApi.login(username, password);
        this.token = token;
        this.currentUser = user;
        localStorage.setItem('token', token);
        return { success: true };
      } finally {
        this.loginLoading = false;
      }
    },

    async fetchCurrentUser() {
      try {
        const user = await authApi.me();
        this.currentUser = user;
        return user;
      } catch (e) {
        this.logout();
        throw e;
      }
    },

    logout() {
      this.token = '';
      this.currentUser = null;
      localStorage.removeItem('token');
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login');
      }
    }
  }
});
