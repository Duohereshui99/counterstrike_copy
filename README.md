# 红隼行动 · Operation Kestrel

网页版单机警匪回合制射击游戏。你和电脑队友一起对抗电脑对手，玩法参考老式的单机反恐射击游戏：爆破、人质营救、每回合用赚来的钱买枪买子弹。打开网页就能玩，不需要安装。

> 本项目与 Valve 公司及《Counter-Strike》没有任何关联。游戏名、地图、武器名和音效都是原创的，人物模型来自微软开源的 Rocketbox 人物库（MIT 许可）。

## 怎么玩

- **直接玩**：下载仓库里的 [`kestrel.html`](kestrel.html)，用 Chrome、Edge 或 Firefox 打开。第一次打开需要联网，用来加载 3D 引擎 three.js。
- **在线玩（GitHub Pages）**：在仓库的 Settings → Pages 里选 “Deploy from a branch”，分支选 `main`，目录选 `/ (root)`。保存后访问 `https://duohereshui99.github.io/counterstrike_copy/kestrel.html`。
- 手机也能玩，需要横屏。左下角摇杆移动，右侧滑动瞄准。

## 游戏内容

- **两种模式**
  - 爆破：匪方把炸弹送到 A 或 B 包点安放，炸弹 35 秒后爆炸；警方守点或者拆弹。
  - 人质营救：警方找到 4 名人质，按 E 让他们跟着走，带回南边的营救区。
- **开局设置**：可以选阵营和人物（每边 4 套），每队 3、5 或 8 人，电脑难度三档，比赛可以不限回合，也可以先胜 8 局或 16 局。
- **老式经济**
  - 开局 $800，最多 $16000，击杀奖励 $300。
  - 新买的枪只带一个弹匣，子弹要另外买。
  - 带走人质 +$150，救出人质 +$1000，误杀人质 −$1500。
- **20 多把原创武器**：可装卸消音器的手枪和卡宾枪、三连发、双持手枪、瞄准镜步枪、狙击枪、连发狙击枪、轻机枪，还有手雷、闪光弹、烟雾弹。
- **防爆盾**：警方专用，配手枪使用。右键举盾可以挡住正面的子弹。
- **商店**：按 B 打开，用鼠标点击购买，也保留了老式的数字键操作。
- **无线电**：按 Z、X、C 打开，可以指挥电脑队友（跟我来、守住这里、冲上去……），队友会回话并照做。
- **真人人物**：人物有贴图，动作来自真人动作捕捉。人物会真的端枪，身体和头跟着瞄准方向转，走、跑、后退、蹲着走都有动作。第一人称看到的手臂就是你所选人物的手臂。

## 操作

| 按键 | 作用 |
| --- | --- |
| W A S D | 移动（Shift 静步，Ctrl 蹲下） |
| 空格 | 跳跃，可以跳上木箱 |
| 鼠标左键 | 开火 |
| 鼠标右键 | 开镜、装卸消音器、切换三连发、举起或放低防爆盾 |
| 1 2 3 4 5 / 滚轮 | 主武器、手枪、匕首、投掷物、炸弹 |
| R / Q / G | 换弹 / 上一把武器 / 丢弃武器 |
| E | 安放或拆除炸弹、带走人质、捡枪 |
| B | 商店（鼠标点击购买，数字键也能选） |
| , 和 . | 快速购买主武器子弹、副武器子弹 |
| Z X C | 无线电菜单 |
| M / Tab / Esc | 更换阵营 / 计分板 / 暂停 |

## 开发

不需要安装任何依赖，Node.js 18 以上就能打包：

```bash
node build.js
```

这一步会把 `src/` 里的代码和 `assets/` 里的人物素材合成一个文件 `kestrel.html`。同时生成的 `dist/artifact.html` 是不带 html/head/body 外壳的嵌入用版本，已被 `.gitignore` 忽略。

```
kestrel.html          打包好的游戏（由 build.js 生成）
build.js              打包脚本
src/index.html        页面结构和界面样式
src/js/core.js        工具函数、设置
src/js/map.js         地图、碰撞、寻路
src/js/audio.js       合成音效
src/js/textures.js    程序生成的贴图
src/js/render.js      渲染、特效、第一人称视角
src/js/models.js      枪械、防爆盾、木箱和集装箱等模型
src/js/avatars.js     真人人物：动作混合、IK 持枪、瞄准姿态
src/js/weapons.js     武器数据、命中判定
src/js/agents.js      人物移动和伤害
src/js/bots.js        电脑 AI
src/js/game.js        规则、回合、经济、人质、无线电
src/js/hud.js         界面、商店、计分板
src/js/main.js        输入、镜头、菜单、主循环
assets/               转换好的人物模型、贴图和动作数据
tools/avatars/        人物素材的下载和转换脚本
```

### 重新生成人物素材（可选）

`assets/` 已经包含转换好的文件，平时不需要这一步。如果想换人物或动作，先改 `tools/avatars/selection.js`，再运行：

```bash
npm install
npx playwright install chromium
pip install pillow
npm run assets:fetch     # 下载约 700 MB 原始 FBX 和贴图到 tools/avatars/.cache
npm run assets:convert   # 转换成 assets/ 里的压缩格式
npm run build
```

转换脚本会在无头 Chromium 里用 three.js 的 FBXLoader 解析 FBX，把网格合并顶点、量化压缩，再把贴图缩小成 WebP。游戏里用的 11 个人物和 5 段动作全部打包后约 2.8 MB。

## 致谢与许可

- 人物模型和动作捕捉数据：[Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)，MIT 许可，许可全文见 [`assets/ROCKETBOX-LICENSE.md`](assets/ROCKETBOX-LICENSE.md)。
- 3D 引擎：[three.js](https://threejs.org/) r128（MIT 许可），运行时从 cdnjs 加载。
- 字体：Google Fonts 的 Chakra Petch 和 Noto Sans SC（SIL Open Font License）。
- 其余的地图、枪械模型、贴图和音效都由代码程序生成，属于本项目原创内容。
