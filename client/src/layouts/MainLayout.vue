<template>
  <el-container class="main-layout">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon :size="28" color="#fff"><Tools /></el-icon>
        <span>孔探工单系统</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#1e293b"
        text-color="#cbd5e1"
        active-text-color="#38bdf8"
        class="menu"
      >
        <template v-for="item in menuItems" :key="item.path">
          <el-menu-item :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="breadcrumb-wrapper">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-for="c in breadcrumbTrail" :key="c.path">
              {{ c.label }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="header-right">
          <el-tooltip :content="collabStatusText" placement="bottom">
            <div class="collab-status">
              <el-icon :class="{ online: collabConnected, offline: !collabConnected }">
                <Connection />
              </el-icon>
              <span v-if="peerCount > 0" class="peer-count">{{ peerCount }} 人在线</span>
            </div>
          </el-tooltip>

          <el-dropdown trigger="click" @command="handleCommand">
            <div class="user-info">
              <el-avatar :size="32" :style="{ background: avatarBg }">
                {{ currentUser?.displayName?.[0] || 'U' }}
              </el-avatar>
              <div class="user-text">
                <div class="user-name">{{ currentUser?.displayName }}</div>
                <div class="user-role" :class="roleClass">{{ roleLabel }}</div>
              </div>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  <el-icon><User /></el-icon> {{ currentUser?.username }}
                </el-dropdown-item>
                <el-dropdown-item disabled>
                  <el-icon><Postcard /></el-icon> {{ currentUser?.badgeNumber }}
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon> 退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, provide, reactive, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import {
  Tools, DataAnalysis, Tickets, Plus, Document, Cpu, User,
  ArrowDown, SwitchButton, Connection, Postcard
} from '@element-plus/icons-vue';
import { ROLE_LABELS, ROLE_CLASS } from '@/utils/format';

const userStore = useUserStore();
const route = useRoute();
const router = useRouter();

const collabConnected = ref(false);
const peerCount = ref(0);

provide('collabState', reactive({
  setConnected: (v) => collabConnected.value = v,
  setPeerCount: (n) => peerCount.value = n
}));

const currentUser = computed(() => userStore.currentUser);
const roleLabel = computed(() => ROLE_LABELS[currentUser.value?.role] || '-');
const roleClass = computed(() => ROLE_CLASS[currentUser.value?.role] || '');

const avatarBg = computed(() => {
  const colors = {
    INSPECTOR: '#2563eb',
    REVIEWER: '#7c3aed',
    RELEASER: '#059669',
    ADMIN: '#dc2626'
  };
  return colors[currentUser.value?.role] || '#64748b';
});

const collabStatusText = computed(() =>
  collabConnected.value
    ? `协作通道已连接 (${peerCount.value} 位协作者)`
    : '协作通道未连接'
);

const menuItems = computed(() => {
  const role = currentUser.value?.role;
  const items = [
    { path: '/', label: '工作概览', icon: 'DataAnalysis' },
    { path: '/cases', label: '工单管理', icon: 'Tickets', roles: ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'] },
    { path: '/cases/new', label: '创建工单', icon: 'Plus', roles: ['INSPECTOR', 'ADMIN'] },
    { path: '/engines', label: '发动机台账', icon: 'Cpu', roles: ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'] },
    { path: '/users', label: '用户管理', icon: 'User', roles: ['ADMIN'] }
  ];
  return items.filter(m => !m.roles || m.roles.includes(role));
});

const activeMenu = computed(() => {
  if (route.path.startsWith('/cases/') && !route.path.includes('new')) {
    return '/cases';
  }
  return route.path;
});

const breadcrumbTrail = computed(() => {
  const trail = [];
  if (route.name === 'CaseDetail') {
    trail.push({ path: '/cases', label: '工单管理' });
    trail.push({ path: route.path, label: `工单 #${route.params.caseId?.slice(0, 8)}` });
  } else if (route.name === 'CaseCreate') {
    trail.push({ path: '/cases', label: '工单管理' });
    trail.push({ path: route.path, label: '创建工单' });
  } else if (route.meta?.title) {
    trail.push({ path: route.path, label: route.meta.title });
  }
  return trail;
});

function handleCommand(cmd) {
  if (cmd === 'logout') {
    userStore.logout();
  }
}
</script>

<style lang="scss" scoped>
.main-layout { height: 100vh; }

.sidebar {
  background: #1e293b;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #334155;

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 20px 18px;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    border-bottom: 1px solid #334155;
    letter-spacing: 0.5px;
  }
  .menu {
    flex: 1;
    border-right: none;
    padding-top: 8px;

    :deep(.el-menu-item) {
      height: 46px;
      line-height: 46px;
      margin: 2px 8px;
      border-radius: 6px;

      &.is-active {
        background: #1e3a8a;
      }
      &:hover:not(.is-active) {
        background: #334155;
      }
    }
  }
}

.header {
  height: 60px !important;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.breadcrumb-wrapper { flex: 1; }

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.collab-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 16px;
  background: #f1f5f9;
  color: #64748b;

  & .online { color: #059669; }
  & .offline { color: #94a3b8; }
  .peer-count { font-weight: 500; }
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px 4px 4px;
  border-radius: 22px;
  background: #f8fafc;
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: #f1f5f9; }

  .user-text {
    line-height: 1.2;

    .user-name {
      font-size: 13px;
      font-weight: 500;
      color: #1e293b;
    }
    .user-role {
      font-size: 11px;
      margin-top: 2px;
      font-weight: 500;
    }
  }
}

.main-content {
  background: #f8fafc;
  padding: 20px 24px;
  overflow: auto;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.25s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
