# AWSL Weibo Header Capture

Chrome 浏览器扩展，自动捕获微博 API 请求的 headers（含 Cookie）并上传到 AWSL 服务器。

## 功能

- 每天在配置的时间段内随机选取一个时间，自动打开微博页面
- 拦截 `/ajax/statuses/mymblog` 请求，捕获完整 request headers
- 通过 `PUT /admin/wb_headers` 上传到 AWSL API
- Popup 界面配置时间范围、微博页面 URL、上传地址、API Token
- 实时日志显示运行状态
- 支持手动触发执行

## 安装

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目目录

## 配置

点击扩展图标打开 Popup：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| 启用自动捕获 | 开关 | 启用 |
| 时间范围 | 每日执行的时间窗口 | 08:00 ~ 22:00 |
| 微博页面 | 打开的微博用户主页 URL | `https://weibo.com/u/1260797924` |
| 上传地址 | AWSL API 端点 | `https://awsl.api.awsl.icu/admin/wb_headers` |
| API Token | Bearer token 认证 | （需手动填写） |

## 工作原理

```
定时触发 → 后台打开微博标签页 → webRequest 拦截 mymblog 请求
→ 提取所有 request headers（extraHeaders 获取 Cookie）
→ PUT 上传到 AWSL API → 等待 30~120s → 关闭标签页 → 调度次日
```

## 技术要点

- **Manifest V3** service worker 架构
- webRequest listener 在模块顶层同步注册（MV3 要求）
- `extraHeaders` 选项确保能捕获 Cookie 等敏感 headers
- `chrome.alarms` 替代 `setTimeout`，避免 service worker 休眠导致定时器丢失
- 状态持久化到 `chrome.storage.local`，service worker 重启后可恢复
