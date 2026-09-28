<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
  width?: string;
}>();
const emit = defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <div v-if="show" class="dialog-mask" @click.self="emit('close')">
    <div class="dialog" :style="{ maxWidth: width ?? '560px' }">
      <div class="dialog-head">
        <h3>{{ title }}</h3>
        <button type="button" class="dialog-close" @click="emit('close')">×</button>
      </div>
      <div class="dialog-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="dialog-foot">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 32, 51, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.dialog {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(23, 32, 51, 0.25);
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e3eaf3;
}
.dialog-head h3 { margin: 0; font-size: 17px; }
.dialog-close {
  background: transparent;
  color: #69758c;
  font-size: 22px;
  line-height: 1;
  padding: 2px 8px;
}
.dialog-body {
  padding: 18px 20px;
  overflow-y: auto;
}
.dialog-foot {
  padding: 12px 20px;
  border-top: 1px solid #e3eaf3;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
