<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-icon">
          <el-icon :size="40"><Tools /></el-icon>
        </div>
        <h1>航空发动机孔探缺陷工单流转系统</h1>
        <p>Borescope Defect Workflow Management</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="large"
        @submit.prevent="handleLogin"
      >
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
            autocomplete="username"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            show-password
            autocomplete="current-password"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-button
          type="primary"
          class="submit-btn"
          :loading="loading"
          @click="handleLogin"
        >
          登 录 系 统
        </el-button>
      </el-form>

      <div class="quick-login">
        <div class="label">快速登录测试账号：</div>
        <div class="accounts">
          <el-tag
            v-for="a in testAccounts"
            :key="a.role"
            :type="a.tagType"
            class="account-tag"
            @click="fillForm(a)"
            effect="plain"
          >
            {{ a.label }} ({{ a.username }} / {{ a.password }})
          </el-tag>
        </div>
      </div>
    </div>

    <div class="version-info">
      <span>v1.0.0 · Aviation Maintenance © 2026</span>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Tools, User, Lock } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const route = useRoute();
const router = useRouter();

const formRef = ref(null);
const loading = ref(false);

const form = reactive({
  username: '',
  password: ''
});

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur', min: 6 }]
};

const testAccounts = [
  { username: 'admin', password: 'admin123', role: 'ADMIN', label: '管理员', tagType: 'danger' },
  { username: 'inspector', password: 'inspector123', role: 'INSPECTOR', label: '判读员', tagType: 'primary' },
  { username: 'reviewer', password: 'reviewer123', role: 'REVIEWER', label: '复核员', tagType: 'warning' },
  { username: 'releaser', password: 'releaser123', role: 'RELEASER', label: '放行工程师', tagType: 'success' }
];

function fillForm(a) {
  form.username = a.username;
  form.password = a.password;
}

async function handleLogin() {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    loading.value = true;
    try {
      await userStore.login(form.username, form.password);
      ElMessage.success(`欢迎回来，${userStore.currentUser.displayName}！`);
      const redirect = route.query.redirect || '/';
      router.replace(redirect);
    } catch (e) {
      // error handled by interceptor
    } finally {
      loading.value = false;
    }
  });
}
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.15), transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(8, 145, 178, 0.15), transparent 50%),
    linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%);
}

.login-card {
  width: 100%;
  max-width: 460px;
  background: #fff;
  padding: 40px 40px 28px;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
}

.brand {
  text-align: center;
  margin-bottom: 32px;

  .brand-icon {
    display: inline-flex;
    width: 72px;
    height: 72px;
    background: linear-gradient(135deg, #1e40af, #0891b2);
    color: #fff;
    border-radius: 20px;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    box-shadow: 0 8px 24px rgba(30, 64, 175, 0.3);
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 6px;
  }
  p {
    color: #94a3b8;
    font-size: 12px;
    margin: 0;
    letter-spacing: 0.5px;
  }
}

.submit-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 2px;
  margin-top: 8px;
  border-radius: 10px;
}

.quick-login {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px dashed #e2e8f0;

  .label {
    font-size: 12px;
    color: #94a3b8;
    margin-bottom: 10px;
  }
  .accounts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .account-tag {
    cursor: pointer;
    transition: transform 0.15s;
    &:hover { transform: translateY(-1px); }
  }
}

.version-info {
  margin-top: 28px;
  color: #94a3b8;
  font-size: 12px;
}
</style>
