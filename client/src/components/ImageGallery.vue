<template>
  <div class="image-gallery">
    <div class="gallery-header">
      <span class="title">
        <el-icon><Picture /></el-icon>
        孔探图像 ({{ images.length }})
      </span>
      <el-upload
        v-if="canUpload"
        :show-file-list="false"
        :multiple="true"
        accept="image/*"
        :before-upload="handleBeforeUpload"
        :http-request="handleUpload"
      >
        <el-button size="small" type="primary" :icon="Upload" :loading="uploading">
          {{ uploading ? `上传中 ${uploadProgress}%` : '上传图像' }}
        </el-button>
      </el-upload>
    </div>

    <div class="gallery-list">
      <div
        v-for="(img, idx) in images"
        :key="img.id"
        class="thumb-card"
        :class="{ active: currentImageId === img.id }"
        @click="$emit('select', img.id)"
      >
        <div class="thumb-wrap">
          <img :src="img.thumbnailPath || img.originalPath" loading="lazy" />
          <div v-if="!img.hasTiles" class="tiles-loading">
            <el-icon class="spinning"><Loading /></el-icon>
            瓦片生成中
          </div>
          <div class="idx-badge">{{ idx + 1 }}</div>
          <div
            v-if="annotationCounts[img.id] > 0"
            class="ann-badge"
            :class="badgeClass(img.id)"
          >
            <el-icon><Aim /></el-icon>
            {{ annotationCounts[img.id] }}
          </div>
        </div>
        <div class="thumb-info">
          <div class="name" :title="img.fileName">{{ truncate(img.fileName, 18) }}</div>
          <div class="meta">
            {{ img.width }}×{{ img.height }}
            <span v-if="img.hasTiles" class="tile-ready">瓦片已就绪</span>
          </div>
        </div>
      </div>

      <div v-if="images.length === 0" class="empty-gallery">
        <el-icon :size="48" color="#cbd5e1"><PictureFilled /></el-icon>
        <p>暂无图像</p>
        <p class="tip">支持JPG/PNG/TIFF，单张不超过100MB</p>
      </div>
    </div>

    <el-dialog v-model="showNewAnnotation" title="新建缺陷标注" width="480px">
      <el-alert
        title="已在图像上框选区域，请填写标注信息"
        type="info" show-icon :closable="false"
        style="margin-bottom:16px"
      />
      <el-form :model="newForm" label-width="90px">
        <el-form-item label="所属图像">
          <el-tag type="info">{{ currentImage?.fileName?.slice(0, 24) }}</el-tag>
        </el-form-item>
        <el-form-item label="缺陷类型" required>
          <el-select v-model="newForm.defectType" style="width:100%">
            <el-option v-for="(l, k) in DEFECT_TYPE_LABELS" :key="k" :label="l" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度" required>
          <el-radio-group v-model="newForm.severity">
            <el-radio-button
              v-for="(l, k) in SEVERITY_LABELS"
              :key="k"
              :value="k"
            >{{ l }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newForm.description" type="textarea" :rows="3" placeholder="请描述缺陷位置、形态等" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="尺寸测量">
              <el-input-number v-model="newForm.measurement" :precision="4" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位">
              <el-select v-model="newForm.measurementUnit" style="width:100%">
                <el-option label="毫米 (mm)" value="mm" />
                <el-option label="英寸 (in)" value="in" />
                <el-option label="百分比 (%)" value="%" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="cancelNewAnnotation">取消</el-button>
        <el-button type="primary" @click="confirmNewAnnotation">创建标注</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Picture, Upload, Loading, Aim, PictureFilled
} from '@element-plus/icons-vue';
import { imageApi, annotationApi } from '@/api/image';
import { SEVERITY_LABELS, DEFECT_TYPE_LABELS } from '@/utils/format';
import { useUserStore } from '@/stores/user';

const props = defineProps({
  caseId: String,
  images: Array,
  annotations: Array,
  currentImageId: String,
  pendingBox: Object
});

const emit = defineEmits(['select', 'changed', 'create-annotation']);

const userStore = useUserStore();
const canUpload = computed(() => userStore.can('image:upload'));
const currentImage = computed(() => props.images.find(i => i.id === props.currentImageId));

const uploading = ref(false);
const uploadProgress = ref(0);

const showNewAnnotation = ref(false);
const newForm = reactive({
  defectType: '',
  severity: 'MODERATE',
  description: '',
  measurement: null,
  measurementUnit: 'mm'
});

const annotationCounts = computed(() => {
  const map = {};
  props.annotations.forEach(a => {
    map[a.imageId] = (map[a.imageId] || 0) + 1;
  });
  return map;
});

function badgeClass(imageId) {
  const forImage = props.annotations.filter(a => a.imageId === imageId);
  const worst = forImage.reduce((acc, a) => {
    const order = { MINOR: 1, MODERATE: 2, MAJOR: 3, CRITICAL: 4 };
    return Math.max(acc, order[a.severity] || 0);
  }, 0);
  return ['', 'sev-minor', 'sev-moderate', 'sev-major', 'sev-critical'][worst];
}

function truncate(s, n) {
  return s?.length > n ? s.slice(0, n) + '…' : s;
}

function handleBeforeUpload(file) {
  if (!file.type.startsWith('image/')) {
    ElMessage.error('仅支持图片文件');
    return false;
  }
  return true;
}

async function handleUpload({ file }) {
  uploading.value = true;
  try {
    await imageApi.upload(props.caseId, [file], (p) => {
      uploadProgress.value = p;
    });
    ElMessage.success('图像上传成功');
    emit('changed');
  } catch (e) {
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
  }
}

watch(() => props.pendingBox, (box) => {
  if (box) {
    Object.assign(newForm, {
      defectType: newForm.defectType || 'CRACK',
      severity: 'MODERATE',
      description: '',
      measurement: null,
      measurementUnit: 'mm'
    });
    newForm._box = box;
    showNewAnnotation.value = true;
  }
}, { deep: true });

function cancelNewAnnotation() {
  showNewAnnotation.value = false;
  emit('create-annotation', null);
}

async function confirmNewAnnotation() {
  if (!newForm.defectType || !newForm.severity) {
    return ElMessage.warning('请选择缺陷类型和严重程度');
  }
  try {
    const box = newForm._box;
    await annotationApi.create(props.caseId, {
      caseId: props.caseId,
      imageId: props.currentImageId,
      defectType: newForm.defectType,
      severity: newForm.severity,
      description: newForm.description,
      x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2,
      measurement: newForm.measurement,
      measurementUnit: newForm.measurementUnit
    });
    ElMessage.success('标注已创建');
    showNewAnnotation.value = false;
    emit('create-annotation', null);
    emit('changed');
  } catch (e) {}
}
</script>

<style lang="scss" scoped>
.gallery-header {
  display: flex; align-items: center;
  justify-content: space-between;
  padding: 4px 2px 12px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 12px;

  .title {
    display: flex; align-items: center; gap: 6px;
    font-weight: 600; font-size: 14px; color: #1e293b;
  }
}

.gallery-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  max-height: calc(100vh - 500px);
  overflow-y: auto;
  padding-right: 4px;
}

.thumb-card {
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s;
  background: #fff;

  &:hover { border-color: #cbd5e1; transform: translateY(-1px); }
  &.active {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
  }

  .thumb-wrap {
    position: relative;
    aspect-ratio: 4/3;
    background: #1e293b;

    img {
      width: 100%; height: 100%;
      object-fit: cover;
    }

    .tiles-loading {
      position: absolute;
      inset: 0;
      background: rgba(15,23,42,0.75);
      color: #fbbf24;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 6px;
      font-size: 11px;
    }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .idx-badge {
      position: absolute; top: 6px; left: 6px;
      background: rgba(0,0,0,0.7);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 10px;
    }

    .ann-badge {
      position: absolute; bottom: 6px; right: 6px;
      display: inline-flex; align-items: center; gap: 2px;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;

      &.sev-minor { background: #10b981; }
      &.sev-moderate { background: #f59e0b; }
      &.sev-major { background: #f97316; }
      &.sev-critical { background: #ef4444; }
    }
  }

  .thumb-info {
    padding: 6px 8px;
    font-size: 11px;
    background: #f8fafc;

    .name { font-weight: 500; color: #334155; margin-bottom: 2px; }
    .meta { color: #94a3b8; display: flex; gap: 8px; }
    .tile-ready { color: #059669; font-weight: 500; }
  }
}

.empty-gallery {
  grid-column: span 2;
  padding: 40px 20px;
  text-align: center;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 8px;
  border: 2px dashed #e2e8f0;

  p { margin: 6px 0 0; font-size: 13px; }
  .tip { font-size: 11px; color: #cbd5e1; }
}
</style>
