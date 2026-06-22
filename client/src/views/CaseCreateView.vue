<template>
  <div>
    <div class="page-header">
      <h2>🆕 创建孔探工单</h2>
      <el-button @click="$router.back()">取消</el-button>
    </div>

    <div class="card form-card">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="120px"
        label-position="right"
        style="max-width: 800px"
      >
        <el-divider content-position="left">基础信息</el-divider>

        <el-form-item label="工单编号" prop="caseNumber">
          <el-input v-model="form.caseNumber" placeholder="自动生成或手动输入" style="width: 320px">
            <template #append>
              <el-button :icon="MagicStick" @click="generateNumber">自动</el-button>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="发动机" prop="engineId">
          <el-select
            v-model="form.engineId"
            filterable
            placeholder="选择或搜索发动机"
            style="width: 480px"
            @change="onEngineChange"
          >
            <el-option
              v-for="e in engineList"
              :key="e.id"
              :label="`${e.engineSerial} — ${e.model} (${e.aircraftRegistration || '未分配'})`"
              :value="e.id"
            />
          </el-select>
          <el-button type="primary" link class="ml-8" :icon="Plus" @click="showNewEngine = true">
            新增发动机
          </el-button>
        </el-form-item>

        <el-form-item label="判读员" prop="inspectorId">
          <el-select v-model="form.inspectorId" filterable placeholder="选择判读员" style="width: 320px">
            <el-option
              v-for="u in inspectors"
              :key="u.id"
              :label="`${u.displayName} (${u.badgeNumber || u.username})`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">检测信息</el-divider>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="检测日期" prop="inspectionDate">
              <el-date-picker v-model="form.inspectionDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="检测类型" prop="inspectionType">
              <el-select v-model="form.inspectionType" style="width: 100%">
                <el-option label="A检孔探" value="A检孔探" />
                <el-option label="C检孔探" value="C检孔探" />
                <el-option label="D检孔探" value="D检孔探" />
                <el-option label="故障孔探" value="故障孔探" />
                <el-option label="专项检查" value="专项检查" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="检测部位" prop="section">
              <el-select v-model="form.section" filterable allow-create style="width: 100%">
                <el-option label="风扇(FAN)" value="风扇(FAN)" />
                <el-option label="低压压气机(LPC)" value="低压压气机(LPC)" />
                <el-option label="高压压气机(HPC)" value="高压压气机(HPC)" />
                <el-option label="燃烧室(CCOMB)" value="燃烧室(CCOMB)" />
                <el-option label="高压涡轮(HPT)" value="高压涡轮(HPT)" />
                <el-option label="低压涡轮(LPT)" value="低压涡轮(LPT)" />
                <el-option label="加力燃烧室(AB)" value="加力燃烧室(AB)" />
                <el-option label="尾喷管(NOZ)" value="尾喷管(NOZ)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="级/段">
              <el-input v-model="form.stage" placeholder="例如: 第2级" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="具体位置">
          <el-input v-model="form.location" placeholder="例如: 导向叶片#5, 11点方向" />
        </el-form-item>

        <el-form-item label="孔探仪型号">
          <el-input v-model="form.borescopeModel" placeholder="例如: Olympus IPLEX NX" />
        </el-form-item>

        <el-form-item label="判读摘要">
          <el-input v-model="form.summary" type="textarea" :rows="4" placeholder="简要描述本次孔探检测的情况..." />
        </el-form-item>

        <el-divider />

        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" @click="submit">
            创建并继续
          </el-button>
          <el-button size="large" @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-dialog v-model="showNewEngine" title="新增发动机" width="560px">
      <el-form :model="engineForm" label-width="110px">
        <el-form-item label="序列号" required>
          <el-input v-model="engineForm.engineSerial" />
        </el-form-item>
        <el-form-item label="型号" required>
          <el-input v-model="engineForm.model" placeholder="例如: CFM56-7B26" />
        </el-form-item>
        <el-form-item label="制造商">
          <el-input v-model="engineForm.manufacturer" />
        </el-form-item>
        <el-form-item label="飞机注册号">
          <el-input v-model="engineForm.aircraftRegistration" placeholder="例如: B-1234" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewEngine = false">取消</el-button>
        <el-button type="primary" @click="createEngine">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { MagicStick, Plus } from '@element-plus/icons-vue';
import { caseApi } from '@/api/case';
import { engineApi } from '@/api/engine';
import { authApi } from '@/api/auth';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref(null);
const submitting = ref(false);

const form = reactive({
  caseNumber: '',
  engineId: '',
  inspectorId: userStore.currentUser?.id || '',
  inspectionDate: new Date().toISOString().slice(0, 10),
  inspectionType: 'A检孔探',
  borescopeModel: '',
  section: '',
  stage: '',
  location: '',
  summary: ''
});

const rules = {
  caseNumber: [{ required: true, message: '请输入工单号', trigger: 'blur' }],
  engineId: [{ required: true, message: '请选择发动机', trigger: 'change' }],
  inspectorId: [{ required: true, message: '请选择判读员', trigger: 'change' }],
  inspectionDate: [{ required: true, message: '请选择检测日期', trigger: 'change' }],
  inspectionType: [{ required: true, message: '请选择检测类型', trigger: 'change' }],
  section: [{ required: true, message: '请选择检测部位', trigger: 'change' }]
};

const engineList = ref([]);
const inspectors = ref([]);
const showNewEngine = ref(false);
const engineForm = reactive({});

function generateNumber() {
  const y = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  form.caseNumber = `BS-${y}-${seq}`;
}

function onEngineChange(id) {
  const e = engineList.value.find(x => x.id === id);
  if (e && !form.summary) {
    form.summary = `${e.model} ${form.section || ''}例行孔探检查`;
  }
}

async function createEngine() {
  if (!engineForm.engineSerial || !engineForm.model) {
    return ElMessage.warning('请填写序列号和型号');
  }
  try {
    const newEngine = await engineApi.create(engineForm);
    engineList.value.unshift(newEngine);
    form.engineId = newEngine.id;
    showNewEngine.value = false;
    Object.keys(engineForm).forEach(k => delete engineForm[k]);
    ElMessage.success('发动机已添加');
  } catch (e) {}
}

async function submit() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return;
    submitting.value = true;
    try {
      const newCase = await caseApi.create(form);
      ElMessage.success('工单创建成功');
      router.replace(`/cases/${newCase.id}`);
    } catch (e) {
    } finally {
      submitting.value = false;
    }
  });
}

onMounted(async () => {
  if (!form.caseNumber) generateNumber();
  try {
    const [{ items }, users] = await Promise.all([
      engineApi.list({ limit: 100 }),
      authApi.listUsers({ role: 'INSPECTOR' })
    ]);
    engineList.value = items;
    inspectors.value = users;
    if (!form.inspectorId && userStore.isInspector) {
      form.inspectorId = userStore.currentUser.id;
    }
  } catch (e) {
    console.warn(e);
  }
});
</script>

<style lang="scss" scoped>
.form-card { max-width: 900px; }
.ml-8 { margin-left: 8px; }
</style>
