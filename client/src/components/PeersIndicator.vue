<template>
  <div class="peers-indicator" v-if="peers.length">
    <el-tooltip placement="left">
      <template #content>
        <div class="peer-tip">
          <div class="tip-title">实时协作者 ({{ peers.length }})</div>
          <div v-for="p in peers" :key="p.id" class="peer-item">
            <el-avatar :size="20" style="background:#2563eb">{{ p.displayName?.[0] }}</el-avatar>
            <span>{{ p.displayName }}</span>
            <el-tag size="small" effect="plain">{{ roleLabel(p.role) }}</el-tag>
          </div>
        </div>
      </template>
      <div class="peers-wrap">
        <el-avatar
          v-for="(p, i) in displayPeers"
          :key="p.id"
          :size="28"
          :style="{ background: peerColors[i], zIndex: 10 - i, marginLeft: i > 0 ? '-8px' : 0 }"
        >
          {{ p.displayName?.[0] }}
        </el-avatar>
        <div v-if="peers.length > 3" class="more-count">+{{ peers.length - 3 }}</div>
        <span class="online-dot"></span>
      </div>
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ROLE_LABELS } from '@/utils/format';

const props = defineProps({ peers: Array });

const peerColors = ['#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706'];
const displayPeers = computed(() => props.peers.slice(0, 3));
function roleLabel(r) { return ROLE_LABELS[r] || r; }
</script>

<style lang="scss" scoped>
.peers-indicator {
  position: fixed;
  top: 80px;
  right: 24px;
  z-index: 999;
}

.peers-wrap {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 6px 12px;
  padding-right: 30px;
  border-radius: 30px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  cursor: pointer;
  position: relative;

  .more-count {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: #f1f5f9;
    color: #64748b;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px;
    font-weight: 600;
    border: 2px solid #fff;
    margin-left: -8px;
    z-index: 6;
  }
  .online-dot {
    position: absolute;
    right: 10px; top: 50%;
    transform: translateY(-50%);
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
}

.peer-tip {
  min-width: 200px;

  .tip-title {
    font-weight: 600;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 12px;
    color: #1e293b;
  }

  .peer-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    color: #475569;
  }
}
</style>
