<template>
  <el-config-provider :locale="locale">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </el-config-provider>
</template>

<script setup>
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { CollabConnection } from '@/utils/collab';

const locale = zhCn;
const userStore = useUserStore();

onMounted(async () => {
  if (localStorage.getItem('token')) {
    try {
      await userStore.fetchCurrentUser();
    } catch (e) {
      console.warn('自动登录失败', e);
    }
  }
});
</script>

<style lang="scss">
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
