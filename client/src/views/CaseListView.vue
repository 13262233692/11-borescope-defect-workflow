<template>
  <div>
    <div class="page-header">
      <h2>📋 工单管理</h2>
      <div class="btn-group">
        <el-button v-if="canCreate" type="primary" :icon="Plus" @click="$router.push('/cases/new')">
          新建工单
        </el-button>
        <el-button :icon="Refresh" @click="loadData">刷新</el-button>
      </div>
    </div>

    <div class="card filter-card">
      <el-form :inline="true" :model="filters" @submit.prevent>
        <el-form-item label="工单号">
          <el-input v-model="filters.search" placeholder="BS-2026-0001" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="(l, k) in STATUS_LABELS" :key="k" :label="l" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="loadData">查询</el-button>
          <el-button :icon="Close" @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <el-table :data="cases" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="工单号" width="150" fixed>
          <template #default="{ row }">
            <el-link type="primary" @click="openDetail(row.id)">
              <el-icon><Document /></el-icon> {{ row.caseNumber }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column prop="engineSerial" label="发动机编号" width="180" />
        <el-table-column prop="engineModel" label="型号" width="120" show-overflow-tooltip />
        <el-table-column prop="aircraftRegistration" label="飞机注册号" width="120" />
        <el-table-column label="部位">
          <template #default="{ row }">
            {{ [row.section, row.stage].filter(Boolean).join(' · ') }}
          </template>
        </el-table-column>
        <el-table-column prop="inspectionDate" label="检测日期" width="110" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="light" :class="statusClass(row.status)">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="inspectorName" label="判读员" width="100" />
        <el-table-column prop="reviewerName" label="复核员" width="100" />
        <el-table-column prop="defectCount" label="缺陷数" width="70" align="center" />
        <el-table-column prop="imageCount" label="图片数" width="70" align="center" />
        <el-table-column label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          @current-change="p => { page = p; loadData(); }"
          @size-change="s => { pageSize = s; page = 1; loadData(); }"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh, Search, Close, Document } from '@element-plus/icons-vue';
import { caseApi } from '@/api/case';
import { useUserStore } from '@/stores/user';
import { STATUS_LABELS, STATUS_CLASS } from '@/utils/format';

const router = useRouter();
const userStore = useUserStore();
const canCreate = userStore.can('case:create');

const filters = reactive({
  search: '',
  status: '',
  dateFrom: '',
  dateTo: ''
});
const dateRange = ref([]);
const cases = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusClass(s) { return STATUS_CLASS[s] || ''; }
function openDetail(id) { router.push(`/cases/${id}`); }

function resetFilters() {
  filters.search = '';
  filters.status = '';
  filters.dateFrom = '';
  filters.dateTo = '';
  dateRange.value = [];
  page.value = 1;
  loadData();
}

async function loadData() {
  if (dateRange.value?.length === 2) {
    filters.dateFrom = dateRange.value[0];
    filters.dateTo = dateRange.value[1];
  }
  loading.value = true;
  try {
    const params = {
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      search: filters.search,
      status: filters.status,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo
    };
    const result = await caseApi.list(params);
    cases.value = result.items;
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
.pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
