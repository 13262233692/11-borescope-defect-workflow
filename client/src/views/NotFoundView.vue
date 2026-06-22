<template>
  <div class="not-found">
    <div class="code">404</div>
    <div class="message">抱歉，您访问的页面不存在</div>
    <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
  </div>
</template>

<script setup>
</script>

<style lang="scss" scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
}
.code {
  font-size: 120px;
  font-weight: 800;
  background: linear-gradient(135deg, #1e40af, #0891b2);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
}
.message {
  color: #64748b;
  margin: 20px 0 28px;
  font-size: 16px;
}
</style>
