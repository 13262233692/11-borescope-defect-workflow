<template>
  <div class="workflow-panel card">
    <div class="panel-title">
      <el-icon><Timer /></el-icon>
      工作流状态
    </div>

    <div class="status-bar">
      <div
        v-for="(s, i) in statusSteps"
        :key="s.key"
        class="step"
        :class="{
          active: s.key === caseDetail.status,
          done: isStepDone(s.key, i),
          error: caseDetail.status === 'REPAIR' && s.key === 'REPAIR'
        }"
      >
        <div class="step-dot">
          <el-icon v-if="isStepDone(s.key, i)"><CircleCheck /></el-icon>
          <span v-else>{{ i + 1 }}</span>
        </div>
        <div class="step-label">{{ s.label }}</div>
      </div>
    </div>

    <div class="current-status">
      <el-tag size="large" :class="statusClass(caseDetail.status)" effect="light">
        当前状态：{{ statusLabel(caseDetail.status) }}
      </el-tag>
      <span class="version">版本 v{{ caseDetail.version }}</span>
    </div>

    <el-divider />

    <div class="actions">
      <div class="action-title">
        <el-icon><Operation /></el-icon>
        执行操作
      </div>

      <div class="action-list">
        <template v-if="caseDetail.status === 'PENDING'">
          <el-button
            v-if="canSubmit"
            type="primary"
            :icon="Select"
            @click="submitCase"
          >
            提交判读 → 待复核
          </el-button>
        </template>

        <template v-else-if="caseDetail.status === 'REVIEWING'">
          <el-button
            v-if="canReview"
            type="success"
            :icon="CircleCheck"
            @click="reviewDecision('CLEAR')"
          >
            判定可放行
          </el-button>
          <el-button
            v-if="canReview"
            type="warning"
            :icon="Warning"
            @click="reviewDecision('REPAIR')"
          >
            判定需维修
          </el-button>
          <el-button
            v-if="canReview"
            type="info"
            :icon="RefreshLeft"
            @click="rejectReview"
          >
            退回重判
          </el-button>
        </template>

        <template v-else-if="caseDetail.status === 'REPAIR'">
          <el-button
            v-if="canSubmit"
            type="primary"
            :icon="RefreshRight"
            @click="reopenCase"
          >
            维修完成 · 重新提交
          </el-button>
          <el-button
            v-if="canRelease"
            type="danger"
            :icon="SwitchButton"
            @click="closeCase"
          >
            关闭工单
          </el-button>
        </template>

        <template v-else-if="caseDetail.status === 'CLEAR'">
          <el-button
            v-if="canRelease"
            type="success"
            :icon="Medal"
            @click="releaseCase"
          >
            签发适航放行证书
          </el-button>
        </template>

        <template v-else-if="caseDetail.status === 'CLOSED'">
          <el-tag type="info" effect="light">
            <el-icon><Lock /></el-icon>
            工单已关闭，不可操作
          </el-tag>
        </template>

        <el-button
          v-if="isAdmin && caseDetail.status !== 'CLOSED'"
          type="danger"
          plain
          :icon="CloseBold"
          @click="forceClose"
        >
          管理员强制关闭
        </el-button>
      </div>
    </div>

    <el-divider />

    <div class="people">
      <div class="people-item">
        <span class="label">判读员：</span>
        <el-avatar :size="24" style="background:#2563eb">
          {{ caseDetail.inspectorName?.[0] }}
        </el-avatar>
        <span>{{ caseDetail.inspectorName || '未指定' }}</span>
      </div>
      <div class="people-item">
        <span class="label">复核员：</span>
        <el-avatar :size="24" style="background:#7c3aed">
          {{ caseDetail.reviewerName?.[0] }}
        </el-avatar>
        <span>{{ caseDetail.reviewerName || '-' }}</span>
      </div>
      <div class="people-item">
        <span class="label">放行：</span>
        <el-avatar :size="24" style="background:#059669">
          {{ caseDetail.releaserName?.[0] }}
        </el-avatar>
        <span>{{ caseDetail.releaserName || '-' }}</span>
      </div>
    </div>

    <el-dialog v-model="commentDialog" title="操作说明" width="460px">
      <el-input
        v-model="commentText"
        type="textarea"
        :rows="4"
        :placeholder="dialogPlaceholder"
      />
      <el-form v-if="dialogMode === 'RELEASE'" label-width="120px" style="margin-top:12px">
        <el-form-item label="证书编号">
          <el-input v-model="certificateNo" placeholder="例如: REL-2026-0001" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="commentDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmAction">确认执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Timer, CircleCheck, Operation, Select, Warning, RefreshLeft,
  RefreshRight, Medal, Lock, CloseBold
} from '@element-plus/icons-vue';
import { caseApi } from '@/api/case';
import { STATUS_LABELS, STATUS_CLASS } from '@/utils/format';
import { useUserStore } from '@/stores/user';

const props = defineProps({ caseDetail: Object });
const emit = defineEmits(['refresh']);

const userStore = useUserStore();
const canSubmit = computed(() => props.caseDetail.inspectorId === userStore.currentUser?.id || userStore.isAdmin);
const canReview = computed(() => userStore.isReviewer || userStore.isAdmin);
const canRelease = computed(() => userStore.isReleaser || userStore.isAdmin);
const isAdmin = computed(() => userStore.isAdmin);

const statusSteps = [
  { key: 'PENDING', label: '待判读' },
  { key: 'REVIEWING', label: '待复核' },
  { key: 'DECISION', label: '判定' },
  { key: 'CLOSED', label: '已关闭' }
];

const statusOrder = ['PENDING', 'REVIEWING', 'REPAIR', 'CLEAR', 'CLOSED'];
const currentIndex = computed(() => statusOrder.indexOf(props.caseDetail.status));
function isStepDone(key, idx) {
  const stepMap = [0, 1, [2, 3], 4];
  const target = stepMap[idx];
  if (Array.isArray(target)) return target.some(t => t <= currentIndex.value);
  return target <= currentIndex.value;
}

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusClass(s) { return STATUS_CLASS[s] || ''; }

const commentDialog = ref(false);
const dialogMode = ref('');
const commentText = ref('');
const certificateNo = ref('');

const dialogPlaceholder = computed(() => ({
  SUBMIT: '请输入判读结论摘要...',
  REVIEW_CLEAR: '请输入放行判定说明...',
  REVIEW_REPAIR: '请输入维修判定说明...',
  REJECT: '请输入退回原因...',
  REOPEN: '请输入维修情况说明...',
  RELEASE: '请输入放行意见...',
  CLOSE: '请输入关闭原因...'
}[dialogMode.value] || ''));

function submitCase() {
  dialogMode.value = 'SUBMIT';
  commentDialog.value = true;
}
function reviewDecision(d) {
  dialogMode.value = d === 'CLEAR' ? 'REVIEW_CLEAR' : 'REVIEW_REPAIR';
  commentDialog.value = true;
  commentText.value = d === 'CLEAR' ? '无影响飞行安全缺陷' : '发现超标缺陷';
}
function rejectReview() {
  dialogMode.value = 'REJECT';
  commentDialog.value = true;
}
function reopenCase() {
  dialogMode.value = 'REOPEN';
  commentDialog.value = true;
}
function releaseCase() {
  dialogMode.value = 'RELEASE';
  commentDialog.value = true;
  certificateNo.value = `REL-${new Date().getFullYear()}-${Math.floor(Math.random()*9000+1000)}`;
}
function closeCase() {
  dialogMode.value = 'CLOSE';
  commentDialog.value = true;
}
async function forceClose() {
  try {
    await ElMessageBox.confirm('管理员强制关闭此工单？', '⚠️ 强制操作');
    await caseApi.close(props.caseDetail.id, { comment: '管理员强制关闭' });
    ElMessage.success('工单已关闭');
    emit('refresh');
  } catch (e) {}
}

async function confirmAction() {
  try {
    const id = props.caseDetail.id;
    if (dialogMode.value === 'SUBMIT')
      await caseApi.submit(id, { summary: commentText.value });
    else if (dialogMode.value === 'REVIEW_CLEAR')
      await caseApi.review(id, { decision: 'CLEAR', comment: commentText.value });
    else if (dialogMode.value === 'REVIEW_REPAIR')
      await caseApi.review(id, { decision: 'REPAIR', comment: commentText.value });
    else if (dialogMode.value === 'REJECT')
      await caseApi.review(id, { decision: 'REJECT', comment: commentText.value });
    else if (dialogMode.value === 'REOPEN')
      await caseApi.reopen(id, { comment: commentText.value });
    else if (dialogMode.value === 'RELEASE')
      await caseApi.release(id, { certificateNo: certificateNo.value, comment: commentText.value });
    else if (dialogMode.value === 'CLOSE')
      await caseApi.close(id, { comment: commentText.value });

    ElMessage.success('操作已执行');
    commentDialog.value = false;
    commentText.value = '';
    certificateNo.value = '';
    emit('refresh');
  } catch (e) {}
}
</script>

<style lang="scss" scoped>
.panel-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; font-size: 14px; color: #1e293b;
  margin-bottom: 16px;
}

.status-bar {
  display: flex;
  margin: 8px 0 20px;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 16px; left: 10%; right: 10%;
    height: 2px;
    background: #e2e8f0;
    z-index: 0;
  }

  .step {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 1;

    .step-dot {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: #e2e8f0;
      color: #94a3b8;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 12px;
      border: 2px solid #fff;
      transition: all 0.3s;
    }
    .step-label { font-size: 11px; color: #94a3b8; }

    &.active .step-dot {
      background: #3b82f6; color: #fff;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
    }
    &.active .step-label { color: #1e40af; font-weight: 600; }

    &.done .step-dot {
      background: #10b981; color: #fff;
    }
    &.done .step-label { color: #059669; }

    &.error .step-dot {
      background: #ef4444; color: #fff;
    }
    &.error .step-label { color: #dc2626; font-weight: 600; }
  }
}

.current-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  .version { font-size: 12px; color: #94a3b8; }
}

.action-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; margin-bottom: 12px;
  color: #475569;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  .el-button { justify-content: center; }
}

.people {
  display: flex;
  flex-direction: column;
  gap: 10px;
  .people-item {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; color: #475569;
    .label { color: #94a3b8; width: 60px; }
  }
}
</style>
