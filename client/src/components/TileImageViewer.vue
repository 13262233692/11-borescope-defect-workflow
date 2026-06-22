<template>
  <div class="tile-viewer" ref="viewerEl">
    <div
      class="canvas-wrap"
      ref="wrapEl"
      @wheel.prevent="onWheel"
      @mousedown.left="onPanStart"
      @mousemove="onMouseMove"
      @mouseup="onPanEnd"
      @mouseleave="onPanEnd"
      @contextmenu.prevent
    >
      <div
        class="transform-layer"
        :style="layerStyle"
        ref="layerEl"
      >
        <div
          class="tile-container"
          :style="containerStyle"
        >
          <img
            v-for="tile in visibleTiles"
            :key="tile.key"
            class="tile"
            :style="tile.style"
            :src="tile.src"
            loading="lazy"
            @error="onTileError"
          />
        </div>

        <svg
          class="overlay-svg"
          :viewBox="`0 0 ${imageInfo?.width || 100} ${imageInfo?.height || 100}`"
          preserveAspectRatio="none"
          @mousedown.stop="onOverlayMouseDown"
        >
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
            </filter>
          </defs>

          <g v-for="ann in annotations" :key="ann.id">
            <rect
              :x="ann.x1 * (imageInfo?.width || 100)"
              :y="ann.y1 * (imageInfo?.height || 100)"
              :width="(ann.x2 - ann.x1) * (imageInfo?.width || 100)"
              :height="(ann.y2 - ann.y1) * (imageInfo?.height || 100)"
              :fill="`${severityColor(ann.severity)}22`"
              :stroke="conflictAnnotationIds?.includes(ann.id) ? '#ef4444' : severityColor(ann.severity)"
              :stroke-width="conflictAnnotationIds?.includes(ann.id)
                ? 6 / (zoom > 1 ? zoom : 1)
                : 3 / (zoom > 1 ? zoom : 1)"
              filter="url(#glow)"
              class="annotation-box"
              :class="{
                selected: selectedId === ann.id,
                readonly: readonly,
                conflict: conflictAnnotationIds?.includes(ann.id)
              }"
              @mousedown.stop="selectAnnotation(ann.id, $event)"
            />
            <rect
              :x="ann.x1 * (imageInfo?.width || 100)"
              :y="ann.y1 * (imageInfo?.height || 100) - 22"
              width="82"
              height="20"
              :fill="severityColor(ann.severity)"
              rx="3"
              style="pointer-events: none"
            />
            <text
              :x="ann.x1 * (imageInfo?.width || 100) + 6"
              :y="ann.y1 * (imageInfo?.height || 100) - 7"
              fill="#fff"
              font-size="11"
              font-weight="600"
              style="pointer-events: none"
            >
              {{ ann.severity.slice(0,3) }} · {{ ann.defectType.slice(0,4) }}
            </text>
          </g>

          <rect
            v-if="drawing"
            :x="Math.min(drawing.x1, drawing.x2) * (imageInfo?.width || 100)"
            :y="Math.min(drawing.y1, drawing.y2) * (imageInfo?.height || 100)"
            :width="Math.abs(drawing.x2 - drawing.x1) * (imageInfo?.width || 100)"
            :height="Math.abs(drawing.y2 - drawing.y1) * (imageInfo?.height || 100)"
            fill="rgba(37, 99, 235, 0.15)"
            stroke="#2563eb"
            stroke-width="2"
            stroke-dasharray="6 3"
          />

          <circle
            v-for="(c, k) in peerCursors"
            :key="k"
            :cx="c.x * (imageInfo?.width || 100)"
            :cy="c.y * (imageInfo?.height || 100)"
            r="6"
            fill="#f59e0b"
            stroke="#fff"
            stroke-width="2"
          >
            <title>{{ c.username }}</title>
          </circle>
        </svg>

        <div
          v-if="drawingMode"
          class="crosshair"
          :style="{
            left: crosshair.x + 'px',
            top: crosshair.y + 'px',
            display: crosshair.show ? 'block' : 'none'
          }"
        />
      </div>
    </div>

    <div class="controls">
      <div class="control-group">
        <el-button size="small" circle @click="zoomOut">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <div class="zoom-display">{{ zoomPercent }}%</div>
        <el-button size="small" circle @click="zoomIn">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
        <el-button size="small" circle @click="resetView">
          <el-icon><Aim /></el-icon>
        </el-button>
        <el-button size="small" circle @click="fitView">
          <el-icon><FullScreen /></el-icon>
        </el-button>
      </div>

      <div class="control-group" v-if="!readonly">
        <el-tooltip content="标注缺陷模式">
          <el-button
            size="small"
            :type="drawingMode ? 'primary' : 'default'"
            :icon="Pointer"
            @click="drawingMode = !drawingMode"
          />
        </el-tooltip>
        <el-tooltip content="拖动画布">
          <el-button
            size="small"
            :type="!drawingMode ? 'warning' : 'default'"
            :icon="Rank"
            @click="drawingMode = false"
          />
        </el-tooltip>
      </div>

      <div class="control-group info">
        <el-tag size="small" type="info">{{ imageInfo?.width }} × {{ imageInfo?.height }}</el-tag>
        <el-tag size="small">Zoom Level: {{ currentLevel }}</el-tag>
        <el-tag size="small" v-if="mouseCoords">X:{{ mouseCoords.x }} Y:{{ mouseCoords.y }}</el-tag>
      </div>
    </div>

    <div class="minimap">
      <div class="minimap-title">缩略图</div>
      <div class="minimap-viewport" :style="minimapViewportStyle"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import { ZoomIn, ZoomOut, Aim, FullScreen, Pointer, Rank } from '@element-plus/icons-vue';
import { clamp } from '@/utils/format';

const props = defineProps({
  caseId: { type: String, required: true },
  imageId: { type: String, required: true },
  imageInfo: { type: Object, default: null },
  annotations: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  peerCursors: { type: Array, default: () => [] },
  conflictAnnotationIds: { type: Array, default: () => [] },
  onCursorMove: { type: Function, default: null }
});

const emit = defineEmits([
  'select-annotation',
  'create-annotation',
  'cursor-move',
  'loaded'
]);

const collabState = inject('collabState', null);

const viewerEl = ref(null);
const wrapEl = ref(null);
const layerEl = ref(null);

const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const zoom = ref(1);
const tileSize = computed(() => props.imageInfo?.tileSize || 256);
const maxLevel = computed(() => props.imageInfo?.maxLevel || 0);
const currentLevel = computed(() => {
  if (!maxLevel.value) return 0;
  const level = Math.max(0, Math.min(maxLevel.value, Math.round(Math.log2(zoom.value) + maxLevel.value / 2)));
  return level;
});

const zoomPercent = computed(() => Math.round(zoom.value * 100));
const drawingMode = ref(false);
const drawing = reactive({ x1: 0, y1: 0, x2: 0, y2: 0, active: false });
const crosshair = reactive({ x: 0, y: 0, show: false });
const mouseCoords = ref('');
const panning = ref(false);
const panStart = reactive({ x: 0, y: 0, tx: 0, ty: 0 });
const loadedTiles = ref(new Set());

const layerStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${zoom.value})`,
  transformOrigin: '0 0',
  cursor: drawingMode.value ? 'crosshair' : (panning.value ? 'grabbing' : 'grab')
}));

const containerStyle = computed(() => {
  const w = props.imageInfo?.width || 800;
  const h = props.imageInfo?.height || 600;
  return {
    width: w + 'px',
    height: h + 'px',
    position: 'relative'
  };
});

const visibleTiles = computed(() => {
  if (!props.imageInfo || !wrapEl.value) return [];
  const imgW = props.imageInfo.width;
  const imgH = props.imageInfo.height;
  const rect = wrapEl.value.getBoundingClientRect();
  const level = currentLevel.value;
  const levelWidth = Math.ceil(imgW / Math.pow(2, maxLevel.value - level));
  const levelHeight = Math.ceil(imgH / Math.pow(2, maxLevel.value - level));
  const cols = Math.ceil(levelWidth / tileSize.value);
  const rows = Math.ceil(levelHeight / tileSize.value);

  const inverseTx = (-translateX.value) / zoom.value;
  const inverseTy = (-translateY.value) / zoom.value;
  const viewW = rect.width / zoom.value;
  const viewH = rect.height / zoom.value;

  const scaleRatio = imgW / levelWidth;
  const startCol = Math.max(0, Math.floor(inverseTx / (tileSize.value * scaleRatio)));
  const endCol = Math.min(cols - 1, Math.ceil((inverseTx + viewW) / (tileSize.value * scaleRatio)));
  const startRow = Math.max(0, Math.floor(inverseTy / (tileSize.value * scaleRatio)));
  const endRow = Math.min(rows - 1, Math.ceil((inverseTy + viewH) / (tileSize.value * scaleRatio)));

  const tiles = [];
  for (let y = startRow; y <= endRow; y++) {
    for (let x = startCol; x <= endCol; x++) {
      const key = `${level}-${x}-${y}`;
      const leftPx = (x * tileSize.value) * (imgW / levelWidth);
      const topPx = (y * tileSize.value) * (imgH / levelHeight);
      const wPx = tileSize.value * (imgW / levelWidth);
      const hPx = tileSize.value * (imgH / levelHeight);
      const src = `/api/cases/${props.caseId}/images/${props.imageId}/tiles/${level}/${x}/${y}.jpg`;

      tiles.push({
        key,
        src,
        style: {
          position: 'absolute',
          left: leftPx + 'px',
          top: topPx + 'px',
          width: Math.min(wPx, imgW - leftPx) + 'px',
          height: Math.min(hPx, imgH - topPx) + 'px'
        }
      });
    }
  }
  return tiles;
});

const minimapViewportStyle = computed(() => {
  if (!props.imageInfo || !wrapEl.value) return { display: 'none' };
  const imgW = props.imageInfo.width;
  const imgH = props.imageInfo.height;
  const rect = wrapEl.value.getBoundingClientRect();
  const miniW = 160, miniH = 120;
  const sx = miniW / imgW, sy = miniH / imgH;
  const s = Math.min(sx, sy);
  const vw = clamp((rect.width / zoom.value) * s, 10, miniW);
  const vh = clamp((rect.height / zoom.value) * s, 10, miniH);
  const vx = clamp((-translateX.value / zoom.value) * s, 0, miniW - vw);
  const vy = clamp((-translateY.value / zoom.value) * s, 0, miniH - vh);
  return {
    width: vw + 'px', height: vh + 'px',
    left: vx + 'px', top: vy + 'px'
  };
});

function severityColor(severity) {
  const map = {
    MINOR: '#10b981', MODERATE: '#f59e0b', MAJOR: '#ef4444', CRITICAL: '#991b1b'
  };
  return map[severity] || '#64748b';
}

function onWheel(e) {
  if (!props.imageInfo) return;
  const delta = -e.deltaY;
  const factor = delta > 0 ? 1.15 : 1 / 1.15;
  const rect = wrapEl.value.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const newZoom = clamp(zoom.value * factor, 0.1, 32);
  const scaleChange = newZoom / zoom.value;
  translateX.value = mx - (mx - translateX.value) * scaleChange;
  translateY.value = my - (my - translateY.value) * scaleChange;
  zoom.value = newZoom;

  if (props.onCursorMove) {
    const pct = screenToImage(mx, my);
    props.onCursorMove(pct.x, pct.y, zoom.value);
  }
}

function screenToImage(sx, sy) {
  const x = (sx - translateX.value) / zoom.value / (props.imageInfo?.width || 1);
  const y = (sy - translateY.value) / zoom.value / (props.imageInfo?.height || 1);
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function onPanStart(e) {
  if (drawingMode.value) return;
  panning.value = true;
  panStart.x = e.clientX;
  panStart.y = e.clientY;
  panStart.tx = translateX.value;
  panStart.ty = translateY.value;
  e.preventDefault();
}

function onPanEnd() {
  panning.value = false;
}

function onMouseMove(e) {
  if (!props.imageInfo) return;
  const rect = wrapEl.value.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const inBounds = mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height;
  crosshair.x = mx;
  crosshair.y = my;
  crosshair.show = drawingMode.value && inBounds;

  const pct = screenToImage(mx, my);
  mouseCoords.value = `${(pct.x * (props.imageInfo?.width || 0)).toFixed(0)}, ${(pct.y * (props.imageInfo?.height || 0)).toFixed(0)}`;

  if (props.onCursorMove && inBounds && !drawingMode.value) {
    props.onCursorMove(pct.x, pct.y, zoom.value);
  }

  if (panning.value) {
    translateX.value = panStart.tx + (e.clientX - panStart.x);
    translateY.value = panStart.ty + (e.clientY - panStart.y);
  }

  if (drawing.value.active) {
    const p = screenToImage(mx, my);
    drawing.x2 = p.x;
    drawing.y2 = p.y;
  }
}

function onOverlayMouseDown(e) {
  if (!drawingMode.value || props.readonly) return;
  const rect = wrapEl.value.getBoundingClientRect();
  const p = screenToImage(e.clientX - rect.left, e.clientY - rect.top);
  drawing.x1 = drawing.x2 = p.x;
  drawing.y1 = drawing.y2 = p.y;
  drawing.active = true;

  const onUp = (ev) => {
    document.removeEventListener('mouseup', onUp);
    drawing.active = false;
    const pct = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
    drawing.x2 = pct.x;
    drawing.y2 = pct.y;
    const w = Math.abs(drawing.x2 - drawing.x1);
    const h = Math.abs(drawing.y2 - drawing.y1);
    if (w > 0.005 && h > 0.005) {
      emit('create-annotation', {
        x1: Math.min(drawing.x1, drawing.x2),
        y1: Math.min(drawing.y1, drawing.y2),
        x2: Math.max(drawing.x1, drawing.x2),
        y2: Math.max(drawing.y1, drawing.y2)
      });
    }
    drawing.x1 = drawing.y1 = drawing.x2 = drawing.y2 = 0;
  };
  document.addEventListener('mouseup', onUp);
}

function selectAnnotation(id, e) {
  e.stopPropagation();
  emit('select-annotation', id);
}

function onTileError(e) {}

function zoomIn() { zoom.value = clamp(zoom.value * 1.25, 0.1, 32); centerAround(); }
function zoomOut() { zoom.value = clamp(zoom.value / 1.25, 0.1, 32); centerAround(); }
function centerAround() {
  if (!wrapEl.value || !props.imageInfo) return;
  const rect = wrapEl.value.getBoundingClientRect();
  translateX.value = (rect.width - props.imageInfo.width * zoom.value) / 2;
  translateY.value = (rect.height - props.imageInfo.height * zoom.value) / 2;
}

function resetView() {
  zoom.value = 1;
  translateX.value = 0;
  translateY.value = 0;
}

function fitView() {
  if (!wrapEl.value || !props.imageInfo) return;
  const rect = wrapEl.value.getBoundingClientRect();
  const sx = (rect.width - 24) / props.imageInfo.width;
  const sy = (rect.height - 24) / props.imageInfo.height;
  zoom.value = Math.min(sx, sy);
  centerAround();
}

function onResize() { fitView(); }

onMounted(async () => {
  await nextTick();
  fitView();
  emit('loaded');
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
});

watch(() => props.imageId, () => {
  nextTick(fitView);
});

defineExpose({ zoomIn, zoomOut, fitView, resetView });
</script>

<style lang="scss" scoped>
.tile-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0f172a;
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
}

.canvas-wrap {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.transform-layer {
  position: absolute;
  top: 0; left: 0;
  will-change: transform;
}

.tile-container {
  background: #1e293b;
  overflow: hidden;

  .tile {
    display: block;
    pointer-events: none;
    image-rendering: auto;
  }
}

.overlay-svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.annotation-box {
  cursor: pointer;
  transition: all 0.15s;

  &.selected {
    stroke-width: 4px;
    stroke-dasharray: 8 4;
    animation: dash 1s linear infinite;
  }
  &.readonly { cursor: default; }
  &:hover:not(.readonly) { filter: brightness(1.2); }
  &.conflict {
    stroke: #ef4444;
    animation: conflictBlink 0.8s ease-in-out infinite alternate;
    filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.9));
  }
}

@keyframes dash {
  to { stroke-dashoffset: -24; }
}

@keyframes conflictBlink {
  from { stroke-opacity: 1; stroke-width: 4px; }
  to   { stroke-opacity: 0.35; stroke-width: 8px; }
}

.crosshair {
  position: absolute;
  width: 20px; height: 20px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 100;

  &::before, &::after {
    content: '';
    position: absolute;
    background: #f59e0b;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
  }
  &::before { left: 9px; top: 0; width: 2px; height: 100%; }
  &::after { top: 9px; left: 0; height: 2px; width: 100%; }
}

.controls {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: center;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid #334155;
  padding: 8px 14px;
  border-radius: 10px;
  backdrop-filter: blur(8px);

  .control-group {
    display: flex;
    align-items: center;
    gap: 6px;

    &.info {
      gap: 6px;
      border-left: 1px solid #334155;
      padding-left: 12px;
    }
    .zoom-display {
      font-size: 12px;
      color: #e2e8f0;
      min-width: 54px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
  }
}

.minimap {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 160px;
  height: 140px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid #334155;
  border-radius: 8px;
  overflow: hidden;
  backdrop-filter: blur(8px);

  .minimap-title {
    font-size: 10px;
    color: #94a3b8;
    padding: 4px 8px;
    border-bottom: 1px solid #334155;
    background: rgba(0,0,0,0.2);
  }
  .minimap-viewport {
    position: absolute;
    top: 24px;
    left: 8px;
    border: 2px solid #f59e0b;
    border-radius: 2px;
    pointer-events: none;
    background: rgba(245, 158, 11, 0.15);
  }
}
</style>
