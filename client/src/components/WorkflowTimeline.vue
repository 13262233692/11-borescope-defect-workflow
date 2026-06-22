<template>
  <div class="card timeline-panel">
    <div class="panel-title">
      <el-icon><DocumentCopy /></el-icon>
      审批记录 & 评论
      <el-button v-if="!readonly" size="small" style="margin-left:auto" :icon="Plus" @click="showCommentInput = !showCommentInput">
        添加评论
      </el-button>
    </div>

    <el-form v-if="showCommentInput && !readonly" :inline="true" style="margin-bottom:12px">
      <el-input
        v-model="newComment"
        type="textarea"
        :rows="2"
        placeholder="输入评论..."
        style="flex:1; min-width: 200px"
      />
      <el-button type="primary" :loading="commenting" @click="submitComment">发送</el-button>
    </el-form>

    <div class="timeline">
      <el-timeline>
        <el-timeline-item
          v-for="r in sortedRecords"
          :key="r.id"
          :timestamp="formatDateTime(r.createdAt)"
          :type="timelineType(r.action)"
          placement="top"
          :hollow="r.action === 'COMMENT'"
        >
          <div class="record-item" :class="`action-${r.action.toLowerCase()}`">
            <div class="record-header">
              <el-avatar :size="22" :style="{background: roleBg(r.actorRole)}">
                {{ r.actorName?.[0] }}
              </el-avatar>
              <span class="actor">{{ r.actorName }}</span>
              <el-tag size="small" effect="plain" :class="`role-${r.actorRole?.toLowerCase()}`">
                {{ roleLabel(r.actorRole) }}
              </el-tag>
              <span class="action-badge">
                <el-icon v-if="r.action === 'CREATE'"><Plus /></el-icon>
                <el-icon v-else-if="r.action === 'SUBMIT'"><Promotion /></el-icon>
                <el-icon v-else-if="r.action === 'REVIEW_PASS'"><CircleCheck /></el-icon>
                <el-icon v-else-if="r.action === 'REVIEW_REJECT'"><RefreshLeft /></el-icon>
                <el-icon v-else-if="r.action === 'RELEASE'"><Medal /></el-icon>
                <el-icon v-else-if="r.action === 'CLOSE'"><Lock /></el-icon>
                <el-icon v-else-if="r.action === 'COMMENT'"><ChatLineRound /></el-icon>
                <el-icon v-else><Edit /></el-icon>
                {{ actionLabel(r.action) }}
              </span>
            </div>

            <div v-if="r.fromStatus || r.toStatus" class="status-change">
              <el-tag size="small" effect="light" :class="statusClass(r.fromStatus)">
                {{ statusLabel(r.fromStatus) }}
              </el-tag>
              <el-icon><Right /></el-icon>
              <el-tag size="small" effect="dark" :class="statusClass(r.toStatus)">
                {{ statusLabel(r.toStatus) }}
              </el-tag>
            </div>

            <div v-if="r.comment" class="comment">{{ r.comment }}</div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  DocumentCopy, Plus, Promotion, CircleCheck, RefreshLeft, Medal,
  Lock, ChatLineRound, Edit, Right
} from '@element-plus/icons-vue';
import { caseApi } from '@/api/case';
import { STATUS_LABELS, STATUS_CLASS, ROLE_LABELS, formatDateTime } from '@/utils/format';

const props = defineProps({
  caseId: String,
  records: Array,
  readonly: Boolean
});

const emit = defineEmits(['refresh']);

const showCommentInput = ref(false);
const newComment = ref('');
const commenting = ref(false);

const sortedRecords = computed(() =>
  [...(props.records || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
);

function statusLabel(s) { return s ? STATUS_LABELS[s] : '-'; }
function statusClass(s) { return s ? STATUS_CLASS[s] : ''; }
function roleLabel(r) { return r ? ROLE_LABELS[r] : '-'; }

function roleBg(role) {
  return { ADMIN: '#dc2626', REVIEWER: '#7c3aed', RELEASER: '#059669' }[role] || '#2563eb';
}

function actionLabel(a) {
  return ({
    CREATE: '创建工单',
    SUBMIT: '提交判读',
    REVIEW_PASS: '复核判定',
    REVIEW_REJECT: '退回重判',
    RELEASE: '签发放行',
    CLOSE: '关闭工单',
    COMMENT: '发表评论',
    EDIT_ANNOTATION: '编辑标注'
  })[a] || a;
}

function timelineType(a) {
  return ({
    CREATE: 'primary',
    SUBMIT: 'primary',
    REVIEW_PASS: 'success',
    REVIEW_REJECT: 'warning',
    RELEASE: 'success',
    CLOSE: 'info',
    COMMENT: '',
    EDIT_ANNOTATION: 'warning'
  })[a] || '';
}

async function submitComment() {
  if (!newComment.value.trim()) return;
  commenting.value = true;
  try {
    await caseApi.addComment(props.caseId, newComment.value.trim());
    ElMessage.success('评论已发送');
    newComment.value = '';
    showCommentInput.value = false;
    emit('refresh');
  } catch (e) {
  } finally {
    commenting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.panel-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; font-size: 14px;
  margin-bottom: 16px;
}

.timeline {
  max-height: calc(100vh - 420px);
  overflow: auto;
  padding-right: 4px;
}

.record-item {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;

  .record-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;

    .actor { font-weight: 600; color: #1e293b; font-size: 13px; }
    .action-badge {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #64748b;
      background: #fff;
      border: 1px solid #e2e8f0;
      padding: 2px 8px;
      border-radius: 4px;
    }
  }

  .status-change {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .comment {
    background: #fff;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: #475569;
    line-height: 1.6;
    border-left: 3px solid #3b82f6;
    margin-top: 4px;
  }

  &.action-comment {
    background: #eff6ff;
    border-color: #bfdbfe;
  }
}

.role-inspector { color: #2563eb; }
.role-reviewer { color: #7c3aed; }
.role-releaser { color: #059669; }
.role-admin { color: #dc2626; }
</style>
