<template>
  <div>
    <div class="page-header">
      <h2>🛫 发动机台账</h2>
      <div class="btn-group">
        <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="showDialog = true">新增发动机</el-button>
        <el-button :icon="Refresh" @click="loadData">刷新</el-button>
      </div>
    </div>

    <div class="card filter-card">
      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input v-model="search" placeholder="序列号/型号" clearable style="width: 240px" :prefix-icon="Search" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <el-table :data="engines" v-loading="loading" stripe>
        <el-table-column prop="engineSerial" label="序列号" width="180" fixed />
        <el-table-column prop="model" label="型号" width="140" />
        <el-table-column prop="manufacturer" label="制造商" width="160" />
        <el-table-column prop="operator" label="航司" width="120" />
        <el-table-column prop="aircraftRegistration" label="注册号" width="120" />
        <el-table-column label="TSN/CSN (h)" width="160" align="center">
          <template #default="{ row }">
            <div class="text-sm">
              <div>TSN: <strong>{{ row.tsn?.toLocaleString() }}</strong></div>
              <div>CSN: <strong>{{ row.csn?.toLocaleString() }}</strong></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="caseCount" label="工单" width="70" align="center" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewCases(row)">工单</el-button>
            <el-button link v-if="isAdmin" @click="editEngine(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :current-page="page"
          @current-change="p => { page = p; loadData(); }"
        />
      </div>
    </div>

    <el-dialog v-model="showDialog" :title="editingId ? '编辑发动机' : '新增发动机'" width="560px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="序列号" required>
          <el-input v-model="form.engineSerial" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="型号" required>
          <el-input v-model="form.model" />
        </el-form-item>
        <el-form-item label="制造商">
          <el-input v-model="form.manufacturer" />
        </el-form-item>
        <el-form-item label="航司">
          <el-input v-model="form.operator" />
        </el-form-item>
        <el-form-item label="注册号">
          <el-input v-model="form.aircraftRegistration" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="TSN (h)">
              <el-input-number v-model="form.tsn" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="CSN (h)">
              <el-input-number v-model="form.csn" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEngine">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { engineApi } from '@/api/engine';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const isAdmin = computed(() => userStore.isAdmin);

const engines = ref([]);
const total = ref(0);
const page = ref(1);
const search = ref('');
const loading = ref(false);

const showDialog = ref(false);
const editingId = ref('');
const form = reactive({});

function editEngine(row) {
  editingId.value = row.id;
  Object.assign(form, row);
  showDialog.value = true;
}

function viewCases(row) {
  router.push({ path: '/cases', query: { engineId: row.id } });
}

async function saveEngine() {
  if (!form.engineSerial || !form.model) {
    return ElMessage.warning('请填写必填项');
  }
  try {
    if (editingId.value) {
      await engineApi.update(editingId.value, form);
      ElMessage.success('已更新');
    } else {
      await engineApi.create(form);
      ElMessage.success('已添加');
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
    const result = await engineApi.list({
      search: search.value,
      limit: 50,
      offset: (page.value - 1) * 50
    });
    engines.value = result.items;
    total.value = result.total;
  } catch (e) {
    console.warn(e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style lang="scss" scoped>
.filter-card { margin-bottom: 16px; }
.pagination { margin-top: 16px; display: flex; justify-content: flex-end; }
.text-sm { font-size: 12px; line-height: 1.6; }
</style>
