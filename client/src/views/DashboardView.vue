<template>
  <div>
    <div class="page-header">
      <h2>📊 工作概览</h2>
      <div class="date-info">{{ today }}</div>
    </div>

    <el-row :gutter="16" class="stats-row mb-20">
      <el-col :span="6" v-for="(s, i) in stats" :key="i">
        <div class="stat-card" :class="`stat-${i}`">
          <div class="stat-icon">
            <el-icon :size="22"><component :is="s.icon" /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-label">{{ s.label }}</div>
            <div class="stat-value">{{ s.value }}</div>
          </div>
          <div class="stat-trend" v-if="s.trend">
            <el-icon><TrendCharts /></el-icon> {{ s.trend }}
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="14">
        <div class="card">
          <div class="card-header">
            <h3>⏳ 我的待办工单</h3>
            <el-button link type="primary" @click="$router.push('/cases')">查看全部</el-button>
          </div>
          <el-table :data="todoCases" stripe style="width: 100%">
            <el-table-column prop="caseNumber" label="工单号" width="140" />
            <el-table-column prop="engineSerial" label="发动机" width="150" />
            <el-table-column prop="section" label="部位" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag size="small" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="defectCount" label="缺陷" width="60" align="center" />
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button type="primary" link @click="openCase(row.id)">处理</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="card mt-16">
          <div class="card-header">
            <h3>📈 工单状态分布</h3>
          </div>
          <div class="status-distribution">
            <div v-for="(d, k) in statusDistribution" :key="k" class="dist-item">
              <div class="dist-label">
                <span class="dot" :class="`status-${k.toLowerCase()}`"></span>
                {{ d.label }}
              </div>
              <div class="dist-bar">
                <div class="dist-fill" :class="`status-${k.toLowerCase()}`"
                     :style="{ width: d.percent + '%' }"></div>
              </div>
              <div class="dist-count">{{ d.count }}</div>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :span="10">
        <div class="card">
          <div class="card-header">
            <h3>🔥 近期活动</h3>
          </div>
          <el-timeline>
            <el-timeline-item
              v-for="(a, i) in recentActivities"
              :key="i"
              :type="a.type"
              :timestamp="a.time"
              placement="top"
            >
              <div class="activity-item">
                <strong>{{ a.user }}</strong>
                <span class="text-muted">{{ a.action }}</span>
                <el-tag size="small" effect="plain">{{ a.target }}</el-tag>
              </div>
            </el-timeline-item>
          </el-timeline>
        </div>

        <div class="card mt-16">
          <div class="card-header">
            <h3>⚡ 快捷操作</h3>
          </div>
          <div class="quick-actions">
            <div class="action-item" @click="$router.push('/cases/new')" v-if="canCreate">
              <el-icon :size="24" color="#2563eb"><Plus /></el-icon>
              <span>新建工单</span>
            </div>
            <div class="action-item" @click="$router.push('/engines')">
              <el-icon :size="24" color="#0891b2"><Cpu /></el-icon>
              <span>发动机台账</span>
            </div>
            <div class="action-item" @click="$router.push('/cases')">
              <el-icon :size="24" color="#7c3aed"><Tickets /></el-icon>
              <span>全部工单</span>
            </div>
            <div class="action-item" @click="exportTip">
              <el-icon :size="24" color="#059669"><Download /></el-icon>
              <span>导出报表</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  Tickets, CircleCheck, Warning, Check, TrendCharts,
  Plus, Cpu, Download
} from '@element-plus/icons-vue';
import { caseApi } from '@/api/case';
import { useUserStore } from '@/stores/user';
import { STATUS_LABELS, STATUS_CLASS, formatDateTime } from '@/utils/format';

const router = useRouter();
const userStore = useUserStore();

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
});

const canCreate = computed(() => userStore.can('case:create'));

const allCases = ref([]);
const todoCases = ref([]);
const recentActivities = ref([]);

const stats = ref([
  { label: '待判读', value: 0, icon: Tickets, trend: '+3 本周', color: '#64748b' },
  { label: '待复核', value: 0, icon: Warning, trend: '待处理', color: '#2563eb' },
  { label: '已放行', value: 0, icon: Check, trend: '+5 本月', color: '#059669' },
  { label: '需维修', value: 0, icon: CircleCheck, trend: '紧急 2 项', color: '#dc2626' }
]);

const statusDistribution = computed(() => {
  const map = {};
  Object.entries(STATUS_LABELS).forEach(([k, v]) => {
    map[k] = { label: v, count: 0, percent: 0 };
  });
  allCases.value.forEach(c => {
    if (map[c.status]) map[c.status].count++;
  });
  const total = allCases.value.length || 1;
  Object.values(map).forEach(v => v.percent = Math.round((v.count / total) * 100));
  return map;
});

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusClass(s) { return STATUS_CLASS[s] || ''; }

function openCase(id) { router.push(`/cases/${id}`); }
function exportTip() { ElMessage.info('报表导出功能开发中...'); }

onMounted(async () => {
  try {
    const { items } = await caseApi.list({ limit: 50 });
    allCases.value = items;

    const pending = items.filter(c => c.status === 'PENDING').length;
    const reviewing = items.filter(c => c.status === 'REVIEWING').length;
    const clear = items.filter(c => c.status === 'CLEAR' || c.status === 'CLOSED').length;
    const repair = items.filter(c => c.status === 'REPAIR').length;

    stats.value[0].value = pending;
    stats.value[1].value = reviewing;
    stats.value[2].value = clear;
    stats.value[3].value = repair;

    todoCases.value = items
      .filter(c => ['PENDING', 'REVIEWING', 'REPAIR'].includes(c.status))
      .slice(0, 8);

    recentActivities.value = [
      { user: '张判读', action: '创建工单', target: 'BS-2026-0004', type: 'primary', time: '10 分钟前' },
      { user: '王复核', action: '复核通过，判定可放行', target: 'BS-2026-0003', type: 'success', time: '45 分钟前' },
      { user: '李判读', action: '添加 3 处缺陷标注', target: 'BS-2026-0005', type: 'warning', time: '2 小时前' },
      { user: '赵放行', action: '签发适航放行证书', target: 'BS-2026-0002', type: 'success', time: '昨天 17:30' },
      { user: '张判读', action: '退回重新判读', target: 'BS-2026-0001', type: 'info', time: '昨天 14:20' }
    ];
  } catch (e) {
    console.warn(e);
  }
});
</script>

<style lang="scss" scoped>
.stats-row { .stat-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  position: relative;

  .stat-icon {
    width: 44px; height: 44px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
  }
  &.stat-0 .stat-icon { background: linear-gradient(135deg, #64748b, #475569); }
  &.stat-1 .stat-icon { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
  &.stat-2 .stat-icon { background: linear-gradient(135deg, #10b981, #059669); }
  &.stat-3 .stat-icon { background: linear-gradient(135deg, #ef4444, #dc2626); }

  .stat-info {
    flex: 1;
    .stat-label { font-size: 12px; color: #94a3b8; margin-bottom: 2px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1e293b; }
  }
  .stat-trend {
    position: absolute;
    bottom: 8px; right: 12px;
    font-size: 11px;
    color: #64748b;
  }
}}

.card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    h3 { margin: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
  }
}

.status-distribution {
  .dist-item {
    display: grid;
    grid-template-columns: 90px 1fr 50px;
    align-items: center;
    gap: 12px;
    padding: 8px 0;

    .dist-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; color: #475569;
      .dot {
        width: 10px; height: 10px; border-radius: 50%;
      }
    }
    .dist-bar {
      height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;
      .dist-fill { height: 100%; transition: width 0.5s ease; }
    }
    .dist-count { text-align: right; font-weight: 600; color: #1e293b; }
  }
}

.status-pending { background: #94a3b8; }
.status-reviewing { background: #3b82f6; }
.status-repair { background: #ef4444; }
.status-clear { background: #10b981; }
.status-closed { background: #cbd5e1; }

.activity-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;

  .action-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.06);
      border-color: #cbd5e1;
    }
    span { font-size: 13px; font-weight: 500; color: #334155; }
  }
}

.mt-16 { margin-top: 16px; }
.mb-20 { margin-bottom: 20px; }
</style>
