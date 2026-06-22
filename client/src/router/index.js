import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false, title: '登录' }
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '工作概览', icon: 'DataAnalysis' }
      },
      {
        path: 'cases',
        name: 'CaseList',
        component: () => import('@/views/CaseListView.vue'),
        meta: { title: '工单管理', icon: 'Tickets', roles: ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'] }
      },
      {
        path: 'cases/new',
        name: 'CaseCreate',
        component: () => import('@/views/CaseCreateView.vue'),
        meta: { title: '创建工单', icon: 'Plus', roles: ['INSPECTOR', 'ADMIN'] }
      },
      {
        path: 'cases/:caseId',
        name: 'CaseDetail',
        component: () => import('@/views/CaseDetailView.vue'),
        meta: { title: '工单详情', icon: 'Document', roles: ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'] }
      },
      {
        path: 'engines',
        name: 'EngineList',
        component: () => import('@/views/EngineListView.vue'),
        meta: { title: '发动机台账', icon: 'Cpu', roles: ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'] }
      },
      {
        path: 'users',
        name: 'UserList',
        component: () => import('@/views/UserManagementView.vue'),
        meta: { title: '用户管理', icon: 'User', roles: ['ADMIN'] }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { requiresAuth: false, title: '404' }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to, from, next) => {
  const userStore = useUserStore();
  document.title = to.meta.title ? `${to.meta.title} - 孔探工单系统` : '孔探工单系统';

  if (to.meta.requiresAuth === false) {
    if (to.path === '/login' && userStore.isLoggedIn) {
      return next('/');
    }
    return next();
  }

  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录系统');
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }

  if (!userStore.currentUser) {
    try {
      await userStore.fetchCurrentUser();
    } catch (e) {
      userStore.logout();
      return next('/login');
    }
  }

  if (to.meta.roles && !to.meta.roles.includes(userStore.currentUser?.role)) {
    ElMessage.error('您没有权限访问此页面');
    return next(from.path || '/');
  }

  next();
});

export default router;
