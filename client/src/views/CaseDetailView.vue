<template>
  <div v-if="caseDetail" class="case-detail">
    <div class="detail-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div>
          <div class="case-title">
            <h2>{{ caseDetail.caseNumber }}</h2>
            <el-tag :class="statusClass(caseDetail.status)" effect="light" size="large">
              {{ statusLabel(caseDetail.status) }}
            </el-tag>
          </div>
          <div class="case-meta">
            <span>
              <el-icon><Cpu /></el-icon>
              {{ caseDetail.engineSerial }} · {{ caseDetail.engineModel }}
            </span>
            <span>
              <el-icon><Aim /></el-icon>
              {{ caseDetail.section }}<template v-if="caseDetail.stage"> · {{ caseDetail.stage }}</template>
              <template v-if="caseDetail.location"> · {{ caseDetail.location }}</template>
            </span>
            <span>
              <el-icon><Calendar /></el-icon>
              {{ formatDate(caseDetail.inspectionDate) }}
            </span>
          </div>
        </div>
      </div>

      <div class="header-right">
        <PeersIndicator :peers="peers" />
        <el-button :icon="RefreshRight" @click="loadDetail">刷新</el-button>
      </div>
    </div>

    <div class="detail-content">
      <div class="viewer-pane">
        <div class="viewer-toolbar">
          <div class="title">
            <el-icon><PictureFilled /></el-icon>
            孔探图像查看器
            <template v-if="currentImage">
              — {{ currentImage.fileName }}
              <span class="resolution">
                ({{ currentImage.width }}×{{ currentImage.height }},
                MaxLevel: {{ currentImage.maxLevel }})
              </span>
            </template>
          </div>
        </div>

        <div class="viewer-area">
          <TileImageViewer
            v-if="currentImage && currentImageInfo"
            ref="viewerRef"
            :case-id="caseId"
            :image-id="currentImageId"
            :image-info="currentImageInfo"
            :annotations="currentAnnotations"
            :selected-id="selectedAnnotationId"
            :readonly="!canAnnotate"
            :peer-cursors="peerCursors"
            @select-annotation="selectAnnotation"
            @create-annotation="handleCreateBox"
            @cursor-move="sendCursor"
            @loaded="onViewerLoaded"
          />

          <div v-else-if="images.length === 0" class="no-image">
            <el-empty description="本工单暂未上传孔探图像">
              <el-button
                v-if="canAnnotate"
                type="primary"
                @click="scrollToGallery"
              >
                上传图像开始判读
              </el-button>
            </el-empty>
          </div>

          <div v-else class="select-image">
            <el-empty description="请从左侧选择一张图像" />
          </div>
        </div>

        <div class="gallery-wrap">
          <ImageGallery
            :case-id="caseId"
            :images="images"
            :annotations="annotations"
            :current-image-id="currentImageId"
            :pending-box="pendingBox"
            @select="selectImage"
            @changed="loadDetail"
            @create-annotation="v => pendingBox = v"
            ref="galleryRef"
          />
        </div>
      </div>

      <div class="right-pane">
        <WorkflowPanel
          :case-detail="caseDetail"
          @refresh="loadDetail"
        />

        <AnnotationsPanel
          ref="annPanelRef"
          :case-id="caseId"
          :annotations="annotations"
          :images="images"
          :selected-id="selectedAnnotationId"
          :readonly="!canAnnotate"
          @select="onAnnotationSelect"
          @changed="loadDetail"
        />

        <WorkflowTimeline
          :case-id="caseId"
          :records="workflow"
          :readonly="!caseDetail || caseDetail.status === 'CLOSED'"
          @refresh="loadDetail"
        />
      </div>
    </div>
  </div>

  <div v-else class="loading-wrap">
    <el-icon class="loading-spin" :size="40"><Loading /></el-icon>
    <p>加载工单详情中...</p>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft, RefreshRight, Cpu, Aim, Calendar, PictureFilled, Loading
} from '@element-plus/icons-vue';

import { caseApi } from '@/api/case';
import { imageApi } from '@/api/image';
import { useUserStore } from '@/stores/user';
import { STATUS_LABELS, STATUS_CLASS, formatDate } from '@/utils/format';
import { CollabConnection } from '@/utils/collab';

import TileImageViewer from '@/components/TileImageViewer.vue';
import ImageGallery from '@/components/ImageGallery.vue';
import AnnotationsPanel from '@/components/AnnotationsPanel.vue';
import WorkflowPanel from '@/components/WorkflowPanel.vue';
import WorkflowTimeline from '@/components/WorkflowTimeline.vue';
import PeersIndicator from '@/components/PeersIndicator.vue';

const route = useRoute();
const caseId = computed(() => route.params.caseId);
const userStore = useUserStore();
const collabState = inject('collabState', null);

const caseDetail = ref(null);
const images = ref([]);
const annotations = ref([]);
const workflow = ref([]);

const currentImageId = ref('');
const currentImage = computed(() => images.value.find(i => i.id === currentImageId.value));
const currentImageInfo = ref(null);
const currentAnnotations = computed(() =>
  annotations.value.filter(a => a.imageId === currentImageId.value)
);

const selectedAnnotationId = ref('');
const pendingBox = ref(null);

const peers = ref([]);
const peerCursors = computed(() => _peerCursors.filter(c => c.imageId === currentImageId.value));
const _peerCursors = reactive([]);
const collab = ref(null);

const viewerRef = ref(null);
const galleryRef = ref(null);

const canAnnotate = computed(() =>
  caseDetail.value &&
  caseDetail.value.status === 'PENDING' &&
  userStore.can('annotation:create')
);

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusClass(s) { return STATUS_CLASS[s] || ''; }

async function selectImage(id) {
  currentImageId.value = id;
  selectedAnnotationId.value = '';
  try {
    await nextTick();
    currentImageInfo.value = await imageApi.getTileInfo(caseId.value, id);
  } catch (e) {
    currentImageInfo.value = currentImage.value;
  }
}

function selectAnnotation(id, imageId) {
  if (imageId && imageId !== currentImageId.value) {
    selectImage(imageId);
    setTimeout(() => {
      selectedAnnotationId.value = id;
    }, 200);
  } else {
    selectedAnnotationId.value = id;
  }
}

function onAnnotationSelect(id, imageId) {
  selectAnnotation(id, imageId);
}

function handleCreateBox(box) {
  pendingBox.value = box;
}

async function loadDetail() {
  try {
    const detail = await caseApi.get(caseId.value);
    caseDetail.value = detail;
    images.value = detail.images;
    annotations.value = detail.annotations;
    workflow.value = detail.workflow;

    if (!currentImageId.value && images.value.length > 0) {
      const firstWithAnn = images.value.find(i =>
        annotations.value.some(a => a.imageId === i.id)
      );
      await selectImage(firstWithAnn?.id || images.value[0].id);
    }
  } catch (e) {
    console.warn(e);
  }
}

function scrollToGallery() {
  galleryRef.value?.$el?.scrollIntoView({ behavior: 'smooth' });
}

function onViewerLoaded() {}

function sendCursor(x, y, zoom) {
  if (!collab.value) return;
  collab.value.sendCursor(currentImageId.value, x, y, zoom);
  const idx = _peerCursors.findIndex(c => c.id === 'self');
  const data = { id: 'self', imageId: currentImageId.value, x, y };
  if (idx >= 0) _peerCursors.splice(idx, 1, data);
  else _peerCursors.push(data);
}

function setupCollab() {
  collab.value = new CollabConnection(caseId.value, userStore.token, {
    onJoinAck: (payload) => {
      peers.value = payload.peers || [];
      collabState?.setConnected(true);
      collabState?.setPeerCount(peers.value.length);
    },
    onPeersChanged: (list) => {
      peers.value = list;
      collabState?.setPeerCount(list.length);
    },
    onPeerJoined: (peer) => {
      ElMessage.info(`${peer.displayName} 加入协作`);
    },
    onPeerLeft: (peerId) => {
      const idx = _peerCursors.findIndex(c => c.peerId === peerId);
      if (idx >= 0) _peerCursors.splice(idx, 1);
    },
    onDisconnected: () => {
      collabState?.setConnected(false);
    },
    onAnnotationCreated: ({ annotation, by }) => {
      if (by?.id === userStore.currentUser?.id) return;
      if (!annotations.value.find(a => a.id === annotation.id)) {
        annotations.value.push(annotation);
        ElMessage.success(`${by?.displayName} 新增了标注`);
      }
    },
    onAnnotationUpdated: ({ annotation, by }) => {
      if (by?.id === userStore.currentUser?.id) return;
      const idx = annotations.value.findIndex(a => a.id === annotation.id);
      if (idx >= 0) {
        annotations.value.splice(idx, 1, annotation);
      }
    },
    onAnnotationDeleted: ({ annotationId, by }) => {
      if (by?.id === userStore.currentUser?.id) return;
      annotations.value = annotations.value.filter(a => a.id !== annotationId);
    },
    onCursorUpdate: (payload) => {
      if (!payload || payload.peerId === collab.value?.wsId) return;
      const idx = _peerCursors.findIndex(c => c.id === payload.peerId);
      const data = {
        id: payload.peerId,
        username: payload.username,
        displayName: payload.displayName,
        imageId: payload.imageId,
        x: payload.x,
        y: payload.y
      };
      if (idx >= 0) _peerCursors.splice(idx, 1, data);
      else _peerCursors.push(data);
    },
    onCaseStatusChanged: () => {
      loadDetail();
    },
    onNewComment: () => {
      loadDetail();
    }
  });
  collab.value.connect();
}

onMounted(async () => {
  await loadDetail();
  if (userStore.token) setupCollab();
});

onBeforeUnmount(() => {
  collab.value?.disconnect();
  collabState?.setConnected(false);
  collabState?.setPeerCount(0);
});
</script>

<style lang="scss" scoped>
.loading-wrap {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #64748b;
}
.loading-spin {
  animation: spin 1s linear infinite;
  color: #3b82f6;
}
@keyframes spin { to { transform: rotate(360deg); } }

.case-detail { height: calc(100vh - 100px); display: flex; flex-direction: column; }

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 16px;

  .header-left { display: flex; gap: 16px; align-items: center; }

  .case-title {
    display: flex; align-items: center; gap: 12px; margin-bottom: 6px;
    h2 { margin: 0; font-size: 20px; font-weight: 700; color: #1e293b; }
  }

  .case-meta {
    display: flex; gap: 18px; flex-wrap: wrap;
    color: #64748b; font-size: 13px;

    span {
      display: inline-flex; align-items: center; gap: 4px;
    }
  }

  .header-right {
    display: flex; gap: 12px; align-items: center;
  }
}

.detail-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 16px;
  min-height: 0;
}

.viewer-pane {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .viewer-toolbar {
    padding: 10px 16px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;

    .title {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 14px;
      color: #1e293b;

      .resolution {
        font-size: 11px;
        color: #94a3b8;
        font-weight: 400;
        margin-left: 8px;
      }
    }
  }

  .viewer-area {
    flex: 1;
    min-height: 400px;
    position: relative;

    .no-image, .select-image {
      height: 100%;
      display: flex; align-items: center; justify-content: center;
    }
  }

  .gallery-wrap {
    max-height: 320px;
    border-top: 1px solid #e2e8f0;
    padding: 12px 16px;
    background: #fff;
    overflow: auto;
  }
}

.right-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 1280px) {
  .detail-content {
    grid-template-columns: 1fr;
  }
}
</style>
