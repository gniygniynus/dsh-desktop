# 应用图标

`build/icon.ico` 已生成：DeepSeek 蓝鲸鱼（从 harness 自带官方 `favicon.svg` 提取并填色），16–256 多尺寸、透明背景。

重新生成或换色：

```powershell
node scripts\make-icon.mjs          # 默认 DeepSeek 蓝 #4D6BFE
node scripts\make-icon.mjs 4176E6   # 自定义颜色（不带 #）
```

> ⚠️ 商标提醒：DeepSeek 鲸鱼 logo 是 DeepSeek 的商标。本项目是**非官方**第三方增强，使用该图标前请确认符合 DeepSeek 品牌使用规范，或改用自有图标以免误导。
