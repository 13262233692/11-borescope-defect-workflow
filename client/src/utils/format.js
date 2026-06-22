import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export const formatDate = (d, fmt = 'YYYY-MM-DD') =>
  d ? dayjs(d).format(fmt) : '-';

export const formatDateTime = (d) =>
  d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '-';

export const formatRelative = (d) =>
  d ? dayjs(d).fromNow() : '-';

export const formatFileSize = (bytes) => {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
};

export const STATUS_LABELS = {
  PENDING: '待判读',
  REVIEWING: '待复核',
  REPAIR: '需维修',
  CLEAR: '可放行',
  CLOSED: '已关闭'
};

export const STATUS_CLASS = {
  PENDING: 'status-pending',
  REVIEWING: 'status-reviewing',
  REPAIR: 'status-repair',
  CLEAR: 'status-clear',
  CLOSED: 'status-closed'
};

export const SEVERITY_LABELS = {
  MINOR: '轻微',
  MODERATE: '中等',
  MAJOR: '严重',
  CRITICAL: '极严重'
};

export const SEVERITY_CLASS = {
  MINOR: 'severity-minor',
  MODERATE: 'severity-moderate',
  MAJOR: 'severity-major',
  CRITICAL: 'severity-critical'
};

export const DEFECT_TYPE_LABELS = {
  CRACK: '裂纹',
  CORROSION: '腐蚀',
  DEFORMATION: '变形',
  DEBRIS: '异物',
  BURN: '烧蚀',
  WEAR: '磨损',
  OTHER: '其他'
};

export const ROLE_LABELS = {
  INSPECTOR: '判读员',
  REVIEWER: '复核员',
  RELEASER: '放行工程师',
  ADMIN: '管理员'
};

export const ROLE_CLASS = {
  INSPECTOR: 'role-inspector',
  REVIEWER: 'role-reviewer',
  RELEASER: 'role-releaser',
  ADMIN: 'role-admin'
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const generateRandomColor = () => {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

export { dayjs };
