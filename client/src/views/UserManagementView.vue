<template>
  <div>
    <div class="page-header">
      <h2>👥 用户管理</h2>
      <el-button type="primary" :icon="Plus" @click="showDialog = true">新增用户</el-button>
    </div>

    <div class="card">
      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column label="用户名" prop="username" width="140" />
        <el-table-column label="姓名" prop="displayName" width="120" />
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <el-tag :class="roleClass(row.role)" effect="light">
              {{ roleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工号" prop="badgeNumber" width="120" />
        <el-table-column label="邮箱" prop="email" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isActive ? 'success' : 'danger'">
              {{ row.isActive ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="170">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link @click="editUser(row)">编辑</el-button>
            <el-button type="danger" link @click="toggleActive(row)">
              {{ row.isActive ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showDialog" :title="editingId ? '编辑用户' : '新增用户'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="密码" :required="!editingId">
          <el-input v-model="form.password" type="password" show-password :placeholder="editingId ? '留空则不修改' : '6位以上'" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.displayName" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="(l, k) in ROLE_LABELS" :key="k" :label="l" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="工号">
          <el-input v-model="form.badgeNumber" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { authApi } from '@/api/auth';
import { ROLE_LABELS, ROLE_CLASS, formatDateTime } from '@/utils/format';

const users = ref([]);
const loading = ref(false);

const showDialog = ref(false);
const editingId = ref('');
const form = reactive({});

function roleLabel(r) { return ROLE_LABELS[r] || r; }
function roleClass(r) { return ROLE_CLASS[r] || ''; }

function editUser(row) {
  editingId.value = row.id;
  Object.assign(form, row);
  delete form.password;
  showDialog.value = true;
}

async function toggleActive(row) {
  try {
    await ElMessageBox.confirm(`确定要${row.isActive ? '禁用' : '启用'}用户 ${row.displayName}?`, '提示');
    await authApi.updateUser(row.id, { isActive: !row.isActive });
    ElMessage.success('已更新');
    loadData();
  } catch (e) { if (e !== 'cancel') {} }
}

async function save() {
  if (!editingId.value && (!form.username || !form.password || !form.displayName || !form.role)) {
    return ElMessage.warning('请填写必填项');
  }
  try {
    if (editingId.value) {
      await authApi.updateUser(editingId.value, form);
      ElMessage.success('用户已更新');
    } else {
      await authApi.createUser(form);
      ElMessage.success('用户已创建');
    }
    showDialog.value = false;
    editingId.value = '';
    Object.keys(form).forEach(k => delete form[k]);
    loadData();
  } catch (e) {}
}

async function loadData() {
  loading.value = true;
  try {
    users.value = await authApi.listUsers();
  } catch (e) { console.warn(e); }
  finally { loading.value = false; }
}

onMounted(loadData);
</script>
