# ECO 工具箱

面向《Emil Chronicle Online》(ECO) 的 **本地 Windows 工具箱**（当前版本 **v0.2.9**）。

| 功能 | 说明 |
|---|---|
| **NPC 实时翻译** | 在游戏原生对话框中显示中文，不改客户端文件 |
| **伤害统计** | 技能 / 普攻 / 宠物 / 受到伤害，总览与流水可开关 |
| **角色状态监控** | 增益、减益、异常、技能持续与 CD；独立透明悬浮窗 |
| **小雅助手** | 后台技能键与间隔配置（自研原生核心） |
| **外观定制** | 壁纸、强调色主题；悬浮窗背景可「跟随主窗口 / 纯色 / 自定义」 |

通过 Frida 在本地挂钩 `eco.exe` 网络收发，**不修改游戏文件**。仅供学习、研究与个人使用，请遵守服务器规则。

---

## 下载安装（推荐）

从 GitHub Releases 下载安装包：

**[ECO Toolbox v0.2.9](https://github.com/shaxiqaq/eco-npc-translator/releases/tag/v0.2.9)**  
安装文件：`ECO-Toolbox-Setup-0.2.9.exe`

安装版已内置 Python/Frida 后端与 `XiaoyaCore.exe`，**无需**再装 Python、Node.js 或 .NET Runtime。

- 翻译 API Key、自定义倒计时、壁纸等保存在当前用户的应用数据目录
- 支持应用内检查更新（`设置 → 软件更新`）

---

## 主界面一览

左侧菜单：

| 页面 | 内容 |
|---|---|
| **总览** | 服务启停、状态监控开关、战斗指标、最近伤害与日志 |
| **伤害统计** | 四类伤害筛选、流水、技能释放统计 |
| **状态监控** | 自定义持续/CD、本地技能库快捷添加、当前状态与变化记录 |
| **NPC 翻译** | 运行状态与翻译动态 |
| **小雅助手** | F1–F6 技能间隔、鼠标与延迟 |
| **运行日志** | 后端输出 |
| **设置** | 外观、翻译、悬浮窗、启动项、更新 |

### 使用提示

1. 先启动并登录 `eco.exe`，在顶部进程列表中选择目标窗口（支持多开）。
2. 按需开启「伤害采集」「状态监控」「NPC 翻译」「状态悬浮窗」。
3. **状态监控**可与伤害采集独立开关，二者可共用底层采集后端。
4. 在 **状态监控 → 自定义倒计时** 中配置技能持续/CD，并勾选「悬浮窗」后才会在 Overlay 显示。
5. **设置 → 悬浮窗 → 悬浮窗背景**：跟随主窗口 / 纯色 / 单独自定义壁纸。
6. 点击「调整状态悬浮窗」后可拖动位置、拖右下角改大小；平时鼠标穿透、置顶。

程序会从客户端缓存读取原版技能图标与英文技能名；到期闪烁秒数可在悬浮窗设置中配置（1–300 秒）。

---

## 目录结构

```text
batch/      批处理入口（旧版脚本）
data/       词库、配置与运行数据
src/        Python 与 Frida 脚本
electron/   图形界面桌面应用（推荐）
tests/      单元测试
docs/       说明与证据
logs/       运行日志
archive/    历史实验代码
```

---

## 从源码运行

### 环境

- Windows
- Python 3.8+
- Node.js 18+（开发 Electron 时）
- `pip install frida keyboard opencc`（以及构建安装包时的 `requirements-build.txt`）

### Electron 开发

```powershell
cd electron
npm.cmd install
npm.cmd start
```

演示界面（不接后端）：

```powershell
npm.cmd run dev
```

### 旧版命令行入口

| 脚本 | 用途 |
|---|---|
| `batch/配置翻译.cmd` | 翻译服务、API Key、热键 |
| `batch/启动NPC翻译.cmd` | NPC 原生对话框翻译 |
| `batch/启动伤害Overlay.cmd` | 旧版控制台 + Overlay |
| `batch/采集伤害包.cmd` | 战斗封包调试采集 |
| `batch/对齐词库.cmd` | 采集文本对齐缓存 |

Python 直接运行示例：

```powershell
python src/eco_npc_mitm.py
python src/eco_damage_overlay.py
python src/eco_damage_capture.py
```

### 测试

```powershell
python -m unittest discover -s tests -v
cd electron
npm.cmd test
```

### 打安装包

```powershell
cd electron
npm.cmd run dist
```

产物在 `electron/release/`（含 NSIS 安装包、`.blockmap`、`latest.yml`）。

### 发布到 GitHub Releases

1. 修改 `electron/package.json` 的 `version` 并提交
2. 打同名标签并推送：

```powershell
git tag v0.2.9
git push origin main
git push origin v0.2.9
```

`.github/workflows/release.yml` 会在 Windows Runner 上测试、构建，并创建 Release（标签必须与 `package.json` 版本一致，例如 `v0.2.9`）。

---

## 功能细节（简要）

### NPC 翻译

- 解密 → 替换文本 → 写回，由游戏原生 UI 渲染
- 本地缓存优先，未命中再调 API
- 支持 DeepSeek / OpenAI / OpenRouter / Gemini / Ollama / DeepL
- 可选共享词库同步

### 伤害统计

主要相关封包：`4001` 普攻、`5010` 技能、`540` HP 变化，以及宠物/怪物出现类消息。技能名、怪物名来自 `data/skill_names.json`、`data/mob_names.json`。

### 状态与技能计时

- 角色增益/减益/异常实时列表
- 自定义持续 + CD，支持本地技能库点选添加
- 悬浮窗仅显示勾选「悬浮窗」的技能计时项

### 小雅助手

自研 x86 原生核心向**明确选中**的 ECO 进程发送后台技能键/可选鼠标消息，不自动扫描其它进程。

---

## 已知限制

- 客户端更新后，若封包结构或密钥偏移变化，功能可能需重新适配
- 部分状态名称/持续时间依赖采样完善
- 宠物统计在缺少出现包时会行为推测，多人同目标时可能误判
- 大壁纸会在导入时压缩；超大原图请重新选择一次以生成优化文件

---

## 许可证与声明

本仓库代码仅供学习与个人研究。使用风险自负，请遵守游戏与服务器规定。
