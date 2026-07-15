# ECO 工具箱：NPC 实时翻译 + 伤害 Overlay

这是一个面向《Emil Chronicle Online》(ECO) 客户端的本地工具箱，主要包含两类功能：

- **NPC 实时翻译**：把 NPC 对话和选项菜单替换成中文，并显示在游戏原生对话框里。
- **伤害 Overlay / 控制台统计**：抓取战斗封包，显示自己造成的伤害、受到的伤害、技能伤害、普通攻击伤害，以及宠物造成的伤害。

工具通过 Frida 只在本地挂钩 `eco.exe` 的网络收发函数，不修改游戏文件。请仅用于学习、研究和个人使用，并遵守对应服务器规则。

## 快速使用

### 图形界面安装版（推荐）

运行安装包：

```text
electron/release/ECO-Toolbox-Setup-0.2.1.exe
```

安装后的主界面使用左侧菜单组织全部功能：

- `总览`：启动或停止伤害采集、NPC 翻译和透明悬浮窗。
- `总览`与`伤害统计`：均可单独开关技能造成、普通攻击造成、宠物造成和受到伤害四类采集，两页开关实时同步。关闭后，对应的新伤害不会进入统计、流水或 Overlay，开关状态会自动保存。
- 顶部游戏进程选择器会列出全部 `eco.exe`。多开游戏时，先停止采集与翻译，刷新列表并选择目标 PID，再启动服务；伤害采集和 NPC 翻译会连接到同一个所选进程。
- `NPC 翻译`：查看翻译运行状态和实时日志。
- `运行日志`：集中查看两个后端的输出。
- `设置`：配置翻译服务、Overlay 样式、位置、自动启动行为和软件更新。

Overlay 已改为 Electron 透明窗口。平时保持置顶和鼠标穿透；在主界面点击`调整悬浮窗`后可以拖动，点击`完成调整`会保存位置。

安装版已经内置 Python 运行环境和 Frida 后端，使用者不需要另外安装 Python 或 Node.js。翻译 API Key 和运行配置保存在当前 Windows 用户的应用数据目录，不会写入安装目录。

### 软件更新

安装版默认在启动后检查 GitHub Releases，但不会自动下载。发现新版本时，用户可以查看更新说明并点击`下载更新`；下载完成后点击`重启并安装`即可升级。关闭“启动时检查更新”后，仍可在`设置 → 软件更新`中手动检查。

自动更新需要 Release 同时包含安装包、`.blockmap` 和 `latest.yml`。`v0.2.0` 尚未内置更新功能，因此需要手动安装一次 `v0.2.1`；从 `v0.2.1` 开始可以使用程序内更新。

### 旧版脚本

先启动游戏并登录角色，再根据用途双击对应脚本。

| 脚本 | 用途 |
|---|---|
| `配置翻译.cmd` | 配置翻译服务、API Key、语言、热键和共享词库 |
| `启动NPC翻译.cmd` | 启动 NPC 原生对话框翻译 |
| `采集NPC.cmd` | 只读采集 NPC 英文文本和 eventid |
| `对齐词库.cmd` | 将采集文本对齐到中文缓存/共享词库 |
| `启动伤害Overlay.cmd` | 启动透明悬浮窗和控制台伤害统计 |
| `采集伤害包.cmd` | 只读采集战斗相关封包，便于调试伤害解析 |

## 伤害 Overlay

双击 `启动伤害Overlay.cmd` 后，会同时打开：

- 一个透明、置顶、鼠标穿透的 Overlay。
- 一个 CMD 控制台，显示完整伤害明细。

当前统计内容：

- 技能造成
- 普通攻击造成
- 对我造成
- 对我造成中的技能/普通攻击拆分
- 宠物造成
- 宠物造成中的技能/普通攻击拆分
- 技能造成流水
- 技能受到流水
- 普通攻击造成流水
- 普通攻击受到流水
- 宠物造成流水

Overlay 顶部会显示技能、普攻、宠物和受到伤害。伤害浮字颜色：

- 黄色：自己造成
- 红色：自己受到
- 绿色：宠物造成

快捷键：

| 快捷键 | 功能 |
|---|---|
| `F8` | 清空当前伤害统计 |
| `F10` | 测试游戏聊天注入 |
| `Ctrl+C` | 停止控制台程序 |
| `Ctrl+Alt+方向键` | 移动 Overlay 并保存位置 |
| `Ctrl+Alt+Home` | 重新跟随游戏窗口 |

### 伤害识别说明

伤害统计主要读取这些封包：

- `4001`：普通攻击结果
- `5010`：技能结果
- `540`：HP/MP/SP 变化，用于辅助判断
- `4640/4645`：怪物出现/删除
- `4655/4660`：宠物出现/删除

技能名称来自 `skill_names.json`，怪物名称来自 `mob_names.json`。如果游戏没有发出完整的宠物出现包，程序会用“非怪物对象持续攻击你正在攻击的目标”来推测宠物，因此在多人一起打同一个目标时可能存在少量误判。

## NPC 实时翻译

`启动NPC翻译.cmd` 会启动 `eco_npc_mitm.py`，通过 Frida 解密收到的 NPC 对话封包，将文本替换成中文后再写回给游戏渲染。

特点：

- 中文显示在游戏原生对话框里。
- 支持 NPC 对话和选项菜单。
- 优先读取本地缓存，未命中时调用翻译 API。
- 支持玩家名模板化，避免把角色名写死到词库。
- 支持共享词库同步，越用缓存越完整。

第一次使用建议：

1. 双击 `配置翻译.cmd`。
2. 选择翻译服务商，填写 API Key。
3. 设置目标语言和角色名。
4. 保存后启动 `启动NPC翻译.cmd`。
5. 进游戏和 NPC 对话测试。

## 采集和词库

NPC 相关：

- `eco_harvester.py` / `采集NPC.cmd`：只读采集 NPC 文本和 eventid。
- `align_repo.py` / `对齐词库.cmd`：将采集结果对齐到中文缓存。
- `pretranslate.py`：离线批量预翻译缓存。
- `cache_sync.py`：同步共享词库。

伤害相关：

- `eco_damage_capture.py` / `采集伤害包.cmd`：采集战斗封包。
- `eco_damage_meter.py`：控制台伤害统计核心。
- `eco_damage_overlay.py` / `启动伤害Overlay.cmd`：透明 Overlay。
- `import_sagaeco_skills.py`：从 SagaECO 资料导入技能名称。
- `translate_mob_names_local.py`：辅助翻译/整理怪物名称。

## 主要文件

| 文件 | 说明 |
|---|---|
| `_mitm.js` | NPC 翻译用 Frida 脚本 |
| `_harvest.js` | NPC 采集用 Frida 脚本 |
| `_damage_capture.js` | 伤害采集/Overlay 用 Frida 脚本 |
| `eco_npc_mitm.py` | NPC 实时翻译主程序 |
| `eco_settings.py` | 翻译配置图形界面 |
| `eco_damage_capture.py` | 战斗封包采集器 |
| `eco_damage_meter.py` | 伤害统计核心 |
| `eco_damage_overlay.py` | 透明 Overlay |
| `skill_names.json` | 技能 ID 到中文名 |
| `mob_names.json` | 怪物 ID 到中文名 |
| `npc_cache.json` | NPC 原文到译文缓存 |
| `sync_config.json` | 共享词库配置 |

## 从源码运行

环境：

- Windows
- Python 3.8+
- `pip install frida keyboard opencc`

常用命令：

```powershell
python eco_npc_mitm.py
python eco_settings.py
python eco_harvester.py
python align_repo.py
python eco_damage_overlay.py
python eco_damage_capture.py
```

Electron 开发版：

```powershell
cd electron
npm.cmd install
npm.cmd start
```

运行回归测试：

```powershell
python -m unittest discover -s tests -v
cd electron
npm.cmd test
```

生成 Windows 安装包：

```powershell
cd electron
npm.cmd run dist
```

构建完成后，安装包位于 `electron/release/`。构建脚本会先用 PyInstaller 打包伤害采集和 NPC 翻译后端，再生成 NSIS 安装程序。

发布新版本时，先修改 `electron/package.json` 中的版本号并提交，然后创建同名标签：

```powershell
git tag v0.2.1
git push origin main
git push origin v0.2.1
```

`.github/workflows/release.yml` 会在 Windows Runner 上运行测试、构建安装包，并自动创建 GitHub Release，上传 `.exe`、`.blockmap` 和 `latest.yml`。标签版本必须与 `electron/package.json` 完全一致，否则工作流会停止发布。

## 已知限制

- 客户端更新后，如果封包结构或 AES key 偏移变化，相关功能可能需要重新定位。
- 伤害 Overlay 依赖当前已解析的封包格式，个别技能或特殊伤害可能需要继续采样修正。
- 宠物统计优先使用宠物出现包；缺失时使用行为推测，可能误判其他玩家或召唤物。
- 怪物名称依赖本地 `mob_names.json`，未识别对象会显示为对象编号。

## 仓库简介建议

`ECO 本地工具箱：NPC 原生对话框实时翻译、共享词库、战斗伤害 Overlay、技能/普攻/受到/宠物伤害统计。`
