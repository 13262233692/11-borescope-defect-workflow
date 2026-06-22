<template>
  <div class="archive-panel card">
    <div class="panel-header">
      <div class="title">
        <el-icon><FolderChecked /></el-icon>
        适航证据归档
        <el-badge
          v-if="hasCompleted"
          :value="completedCount"
          type="success"
          class="badge"
        />
      </div>
      <el-button
        v-if="canCreate"
        type="primary"
        size="small"
        :icon="document"
        :loading="creating"
        @click="onCreate"
      >
        触发归档
      </el-button>
    </div>

    <el-empty v-if="!archives.length" description="暂无归档记录" :image-size="60" />

    <div v-else class="list">
      <div
        v-for="a in archives"
        :key="a.id"
        class="archive-item"
        :class="`status-${a.status.toLowerCase()}`"
      >
        <div class="item-head">
          <div class="status-row">
            <span class="status-tag" :class="`tag-${a.status.toLowerCase()}`">
              {{ statusLabel(a.status) }}
            </span>
            <span class="release-no" v-if="a.releaseNumber">
              {{ a.releaseNumber }}
            </span>
          </div>
          <div class="meta">
            <span class="creator">{{ a.createdByName }}</span>
            <span>{{ formatDateTime(a.createdAt) }}</span>
          </div>
        </div>

        <div class="info-grid" v-if="a.status === 'COMPLETED'">
          <div>
            <label>缺陷数</label>
            <b>{{ a.annotationCount }}</b>
          </div>
          <div>
            <label>图像数</label>
            <b>{{ a.imageCount }}</b>
          </div>
          <div>
            <label>审批记录</label>
            <b>{{ a.workflowCount }}</b>
          </div>
          <div>
            <label>归档包</label>
            <b>{{ formatBytes(a.packageSize) }}</b>
          </div>
        </div>

        <div class="info-grid" v-else-if="a.status === 'FAILED'">
          <div class="error-box" style="grid-column: 1/-1">
            <el-icon color="#dc2626"><Warning /></el-icon>
            <div>
              <strong>失败原因</strong>
              <pre>{{ a.lastError }}</pre>
            </div>
          </div>
          <div>
            <label>重试次数</label>
            <b>{{ a.retryCount }}/{{ a.maxRetries }}</b>
          </div>
        </div>

        <div class="info-grid" v-else>
          <div class="pending-box" style="grid-column: 1/-1">
            <el-icon class="spin"><Loading /></el-icon>
            <div>
              <strong v-if="a.status === 'PROCESSING'">正在打包证据...</strong>
              <strong v-else>排队中...</strong>
              <small>通常需要 5-60 秒，请稍候</small>
            </div>
          </div>
        </div>

        <div class="actions" v-if="['COMPLETED', 'FAILED'].includes(a.status)">
          <template v-if="a.status === 'COMPLETED'">
            <el-button size="small" :icon="download" @click="onDownload(a)">
              下载归档包
            </el-button>
            <el-button size="small" :icon="view" @click="onPreview(a)">
              证书信息
            </el-button>
          </template>
          <template v-if="a.status === 'FAILED'">
            <el-button
              size="small"
              type="primary"
              :icon="refreshRight"
              :disabled="a.retryCount >= a.maxRetries"
              @click="onRetry(a)"
            >
              {{ a.retryCount >= a.maxRetries ? '已达最大重试' : '重新归档' }}
            </el-button>
          </template>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      title="触发适航证据归档"
      width="520px"
    >
      <el-form :model="createForm" label-position="top">
        <el-alert
          type="info" show-icon :closable="false"
          title="适航放行归档将打包以下内容"
          style="margin-bottom:16px"
        >
          <ul>
            <li>defect.json — 缺陷标注与工单元数据</li>
            <li>workflow.csv — 完整审批记录流</li>
            <li>image_manifest.csv — 图像清单与校验</li>
            <li>release_note.pdf — 适航放行证书</li>
            <li>images/* — 原始孔探图像</li>
          </ul>
        </el-alert>
        <el-form-item label="放行结论文本（选填）">
          <el-input
            v-model="createForm.releaseNote"
            type="textarea" :rows="3"
            placeholder="简述本次放行结论、维修建议等..."
            maxlength="500" show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="submitCreate"
        >
          确认归档
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="certVisible" title="适航证书信息" width="500px">
      <div v-if="currentArchive" class="cert-info">
        <div class="row">
          <label>证书编号</label>
          <b style="color:#059669">{{ currentArchive.releaseNumber }}</b>
        </div>
        <div class="row"><label>归档完成时间</label>{{ formatDateTime(currentArchive.completedAt) }}</div>
        <div class="row"><label>创建人</label>{{ currentArchive.createdByName }}</div>
        <div class="row"><label>归档包</label>{{ currentArchive.packageName }}</div>
        <div class="row"><label>文件大小</label>{{ formatBytes(currentArchive.packageSize) }}</div>
        <div class="row monospaced">
          <label>SHA-256</label>
          <code style="word-break:break-all">{{ currentArchive.checksumSha256 || '-' }}</code>
        </div>
        <div v-if="currentArchive.releaseNoteText" class="note">
          <label>放行结论</label>
          <pre>{{ currentArchive.releaseNoteText }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  FolderChecked, Document as document, Download as download,
  View as view, RefreshRight as refreshRight, Warning, Loading
} from '@element-plus/icons-vue';

import { archiveApi } from '@/api/image';
import { useUserStore } from '@/stores/user';
import { formatDateTime, formatBytes } from '@/utils/format';

const props = defineProps({
  caseId: String,
  caseDetail: Object,
  archives: { type: Array, default: () => [] }
});
const emit = defineEmits(['refresh']);
const userStore = useUserStore();

const STATUS_LABELS = {
  PENDING:    { text: '排队中',   cls: '' },
  PROCESSING: { text: '归档中',   cls: '' },
  COMPLETED:  { text: '已完成',   cls: 'success' },
  FAILED:     { text: '失败',     cls: 'danger' }
};
function statusLabel(s) { return STATUS_LABELS[s]?.text || s; }

const hasCompleted = computed(() =>
  props.archives.some(a => a.status === 'COMPLETED')
);
const completedCount = computed(() =>
  props.archives.filter(a => a.status === 'COMPLETED').length
);
const canCreate = computed(() => {
  if (!props.caseDetail) return false;
  const allow = userStore.can('archive:create');
  if (!allow) return false;
  if (hasCompleted.value) return false;
  if (props.archives.some(a => a.status === 'PENDING' || a.status === 'PROCESSING')) return false;
  return ['CLEAR', 'CLOSED'].includes(props.caseDetail.status);
});

const creating = ref(false);
const dialogVisible = ref(false);
const certVisible = ref(false);
const currentArchive = ref(null);

const createForm = reactive({
  releaseNote: ''
});

function onCreate() {
  createForm.releaseNote = props.caseDetail?.releaseNote || '';
  dialogVisible.value = true;
}

async function submitCreate() {
  creating.value = true;
  try {
    await archiveApi.create(props.caseId, { releaseNote: createForm.releaseNote });
    ElMessage.success('归档任务已提交，后台处理中...');
    dialogVisible.value = false;
    emit('refresh');
  } finally {
    creating.value = false;
  }
}

function onPreview(a) {
  currentArchive.value = a;
  certVisible.value = true;
}

async function onRetry(a) {
  try {
    await ElMessageBox.confirm(
      `是否重试归档？(第 ${a.retryCount + 1}/${a.maxRetries} 次)`,
      '确认重试',
      { type: 'warning' }
    );
    await archiveApi.retry(props.caseId, a.id);
    ElMessage.success('已提交重试任务');
    emit('refresh');
  } catch { /* cancel */ }
}

async function onDownload(a) {
  try {
    await archiveApi.download(props.caseId, a.id);
    ElMessage.success('开始下载归档包');
  } catch (e) {
    ElMessage.error(e?.message || '下载失败');
  }
}
</script>

<style lang="scss" scoped>
.card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  padding: 12px 16px;
}

.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 12px;

  .title {
    display: inline-flex; align-items: center; gap: 6px;
    font-weight: 600; color: #1e293b;
  }
  .badge { margin-left: 4px; }
}

.list {
  display: flex; flex-direction: column; gap: 10px;
  max-height: 560px;
  overflow-y: auto;
}

.archive-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  transition: all 0.15s;

  &.status-completed {
    border-left: 3px solid #10b981;
    background: linear-gradient(180deg, #f0fdf4 0%, #fff 100%);
  }
  &.status-failed {
    border-left: 3px solid #ef4444;
    background: linear-gradient(180deg, #fef2f2 0%, #fff 100%);
  }
  &.status-processing {
    border-left: 3px solid #3b82f6;
    background: linear-gradient(180deg, #eff6ff 0%, #fff 100%);
  }
  &.status-pending {
    border-left: 3px solid #f59e0b;
    background: linear-gradient(180deg, #fffbeb 0%, #fff 100%);
  }
}

.item-head {
  margin-bottom: 8px;
  .status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .meta {
    display: flex; justify-content: space-between;
    color: #64748b; font-size: 12px;
  }
}

.status-tag {
  display: inline-block;
  font-size: 11px; padding: 1px 8px; border-radius: 4px;
  font-weight: 600;
  &.tag-completed  { background: #d1fae5; color: #065f46; }
  &.tag-failed     { background: #fee2e2; color: #7f1d1d; }
  &.tag-processing { background: #dbeafe; color: #1e40af; }
  &.tag-pending    { background: #fef3c7; color: #92400e; }
}
.release-no {
  font-family: monospace; color: #0f766e;
  background: #ccfbf1; padding: 1px 6px; border-radius: 4px; font-size: 11px;
}

.info-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px; margin: 8px 0 10px;
  font-size: 12px;
  label { display: block; color: #64748b; font-weight: 400; }
  b { color: #1e293b; }

  .error-box, .pending-box {
    display: flex; gap: 10px;
    padding: 8px 10px; border-radius: 6px;
    pre {
      margin: 4px 0 0; white-space: pre-wrap; word-break: break-all;
      background: transparent; color: #7f1d1d; font-size: 11px; font-family: monospace;
    }
    small { display: block; color: #64748b; margin-top: 2px; }
  }
  .error-box { background: #fef2f2; color: #7f1d1d; }
  .pending-box { align-items: center; background: #eff6ff; color: #1e3a8a; }
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.actions {
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
  display: flex; gap: 8px; flex-wrap: wrap;
}

.cert-info {
  .row {
    display: flex; justify-content: space-between;
    padding: 6px 0; border-bottom: 1px dashed #e2e8f0;
    label { color: #64748b; flex-shrink: 0; margin-right: 16px; }
    &.monospaced { flex-direction: column; gap: 4px; align-items: flex-start; }
    code {
      background: #f8fafc; padding: 4px 8px; border-radius: 4px;
      font-size: 11px;
    }
  }
  .note {
    margin-top: 8px;
    label { display: block; color: #64748b; margin-bottom: 4px; }
    pre {
      background: #f8fafc; padding: 8px 12px; border-radius: 6px;
      font-size: 12px; white-space: pre-wrap;
    }
  }
}
</style>
