<template>
  <div class="card annotations-panel">
    <div class="panel-title">
      <el-icon><Aim /></el-icon>
      缺陷标注
      <el-tag size="small" type="info" effect="plain" style="margin-left:auto">
        {{ annotations.length }} 处
      </el-tag>
    </div>

    <div class="stats">
      <div
        v-for="(c, s) in severityCounts"
        :key="s"
        class="stat-item"
        :class="`sev-${s.toLowerCase()}`"
      >
        <span class="dot"></span>
        {{ severityLabels[s] }}
        <strong>{{ c }}</strong>
      </div>
    </div>

    <el-divider style="margin:12px 0" />

    <div class="filter-row">
      <el-select v-model="filterSeverity" placeholder="按严重度" clearable size="small" style="width:100px">
        <el-option v-for="(l, k) in severityLabels" :key="k" :label="l" :value="k" />
      </el-select>
      <el-select v-model="filterType" placeholder="按类型" clearable size="small" style="width:100px">
        <el-option v-for="(l, k) in defectLabels" :key="k" :label="l" :value="k" />
      </el-select>
      <el-select v-model="filterImage" placeholder="按图片" clearable size="small" style="flex:1">
        <el-option v-for="img in images" :key="img.id" :label="img.fileName.slice(0,18)" :value="img.id" />
      </el-select>
    </div>

    <div class="list">
      <div
        v-for="ann in filteredList"
        :key="ann.id"
        class="annotation-item"
        :class="{
          selected: selectedId === ann.id,
          readonly: !canEdit(ann),
          conflict: conflictIds.includes(ann.id)
        }"
        @click="$emit('select', ann.id, ann.imageId)"
      >
        <div class="item-header">
          <span class="severity-tag" :class="`sev-${ann.severity.toLowerCase()}`">
            {{ severityLabels[ann.severity] }}
          </span>
          <span class="defect-type">{{ defectLabels[ann.defectType] }}</span>
          <span v-if="conflictIds.includes(ann.id)" class="conflict-tag" title="存在编辑冲突">
            ⚠ 冲突
          </span>
          <span v-if="ann.measurement" class="measure">
            {{ ann.measurement }}{{ ann.measurementUnit || 'mm' }}
          </span>
          <el-dropdown v-if="canEdit(ann)" @command="cmd => handleAction(cmd, ann)" trigger="click">
            <el-icon class="more" @click.stop><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <p class="desc" v-if="ann.description">{{ ann.description }}</p>
        <p class="desc empty" v-else>暂无描述</p>
        <div class="conflict-banner" v-if="conflictInfo(ann.id)">
          <strong>⚠ 冲突：</strong>
          由 <em>{{ conflictInfo(ann.id).updatedByName || '协作者' }}</em> 更新
          （v{{ conflictInfo(ann.id).currentVersion }}）
        </div>
        <div class="item-footer">
          <el-avatar :size="18" style="background:#64748b;font-size:10px">
            {{ ann.creatorName?.[0] }}
          </el-avatar>
          <span class="creator">{{ ann.creatorName }} · {{ formatRelative(ann.createdAt) }}</span>
          <span v-if="ann.version > 1" class="version">v{{ ann.version }}</span>
        </div>
      </div>

      <div v-if="filteredList.length === 0" class="empty-state">
        <el-icon :size="40" color="#cbd5e1"><Picture /></el-icon>
        <p>暂无缺陷标注</p>
        <p class="tip">在图像查看器上框选区域即可创建标注</p>
      </div>
    </div>

    <el-dialog v-model="editDialog" title="编辑标注" width="480px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="缺陷类型" required>
          <el-select v-model="editForm.defectType" style="width:100%">
            <el-option v-for="(l, k) in defectLabels" :key="k" :label="l" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度" required>
          <el-radio-group v-model="editForm.severity">
            <el-radio-button v-for="(l, k) in severityLabels" :key="k" :value="k">
              {{ l }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="测量值">
              <el-input-number v-model="editForm.measurement" :precision="4" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位">
              <el-input v-model="editForm.measurementUnit" placeholder="mm" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim, MoreFilled, Picture } from '@element-plus/icons-vue';
import { annotationApi } from '@/api/image';
import { SEVERITY_LABELS, DEFECT_TYPE_LABELS, formatRelative } from '@/utils/format';
import { useUserStore } from '@/stores/user';

const props = defineProps({
  caseId: String,
  annotations: Array,
  images: Array,
  selectedId: String,
  readonly: Boolean,
  conflicts: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['select', 'changed', 'resolve-conflict']);

const conflictIds = computed(() => Object.keys(props.conflicts || {}));
function conflictInfo(id) {
  return props.conflicts?.[id] || null;
}

const userStore = useUserStore();
const severityLabels = SEVERITY_LABELS;
const defectLabels = DEFECT_TYPE_LABELS;

const filterSeverity = ref('');
const filterType = ref('');
const filterImage = ref('');

const filteredList = computed(() =>
  props.annotations.filter(a =>
    (!filterSeverity.value || a.severity === filterSeverity.value) &&
    (!filterType.value || a.defectType === filterType.value) &&
    (!filterImage.value || a.imageId === filterImage.value)
  )
);

const severityCounts = computed(() => {
  const map = { MINOR: 0, MODERATE: 0, MAJOR: 0, CRITICAL: 0 };
  props.annotations.forEach(a => { if (map[a.severity] !== undefined) map[a.severity]++; });
  return map;
});

function canEdit(ann) {
  if (props.readonly) return false;
  if (userStore.isAdmin) return true;
  return userStore.isInspector && ann.createdBy === userStore.currentUser?.id;
}

const editDialog = ref(false);
const editForm = reactive({});
const editingId = ref('');

function handleAction(cmd, ann) {
  if (cmd === 'edit') {
    editingId.value = ann.id;
    Object.assign(editForm, ann);
    editDialog.value = true;
  } else if (cmd === 'delete') {
    ElMessageBox.confirm('确定删除此标注？此操作不可撤销。', '删除标注', { type: 'warning' })
      .then(async () => {
        await annotationApi.delete(props.caseId, ann.id);
        ElMessage.success('标注已删除');
        emit('changed');
      }).catch(() => {});
  }
}

async function saveEdit() {
  try {
    await annotationApi.update(props.caseId, editingId.value, editForm);
    ElMessage.success('标注已更新');
    editDialog.value = false;
    emit('changed');
  } catch (e) {}
}
</script>

<style lang="scss" scoped>
.panel-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; font-size: 14px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;

  .stat-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 11px;
    background: #f8fafc;

    .dot {
      width: 8px; height: 8px; border-radius: 50%;
    }
    strong { margin-left: auto; }

    &.sev-minor { color: #059669; .dot { background: #10b981; } }
    &.sev-moderate { color: #d97706; .dot { background: #f59e0b; } }
    &.sev-major { color: #ea580c; .dot { background: #f97316; } }
    &.sev-critical { color: #dc2626; .dot { background: #ef4444; } }
  }
}

.filter-row {
  display: flex; gap: 8px; margin-bottom: 12px;
}

.list {
  max-height: calc(100vh - 440px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .annotation-item {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover { border-color: #cbd5e1; background: #f8fafc; }
    &.selected {
      border-color: #3b82f6;
      background: #eff6ff;
      box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
    }
    &.readonly { opacity: 0.7; }
    &.conflict {
      border-color: #ef4444;
      background: #fef2f2;
      animation: conflictBg 1.2s ease-in-out infinite alternate;
    }

    .conflict-tag {
      font-size: 10px;
      color: #dc2626;
      font-weight: 700;
      background: #fee2e2;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .conflict-banner {
      margin: 6px 0 8px;
      padding: 6px 8px;
      background: #fef2f2;
      border-left: 3px solid #ef4444;
      font-size: 11px;
      color: #7f1d1d;
      border-radius: 4px;

      em { color: #dc2626; font-style: normal; font-weight: 600; }
    }

    .item-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px;

      .severity-tag {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;

        &.sev-minor { background: #d1fae5; color: #059669; }
        &.sev-moderate { background: #fef3c7; color: #d97706; }
        &.sev-major { background: #ffedd5; color: #ea580c; }
        &.sev-critical { background: #fee2e2; color: #dc2626; }
      }
      .defect-type {
        font-size: 12px;
        font-weight: 500;
        color: #475569;
      }
      .measure {
        margin-left: auto;
        font-size: 11px;
        color: #0891b2;
        background: #cffafe;
        padding: 1px 6px;
        border-radius: 3px;
      }
      .more {
        margin-left: 4px;
        color: #94a3b8;
        padding: 4px;
        &:hover { color: #475569; }
      }
    }

    .desc {
      margin: 4px 0 8px;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
      &.empty { color: #cbd5e1; font-style: italic; }
    }

    .item-footer {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px;
      color: #94a3b8;
      .version {
        margin-left: auto;
        background: #f1f5f9;
        padding: 0 6px;
        border-radius: 3px;
      }
    }
  }
}

.empty-state {
  padding: 30px 16px;
  text-align: center;
  color: #94a3b8;

  p { margin: 6px 0 0; font-size: 13px; }
  .tip { font-size: 11px; color: #cbd5e1; }
}

@keyframes conflictBg {
  from { box-shadow: 0 0 0 0 rgba(239,68,68,0); border-color: #ef4444; }
  to   { box-shadow: 0 0 0 4px rgba(239,68,68,0.2); border-color: #dc2626; }
}
</style>
