# 自定义音源串行实测报告（安卓移植版）

- 测试时间：2026-10-07
- 测试台：`_srcTest/`（Node vm 复刻**安卓版** preload 的 `lx` 环境：`env='mobile'`、无 `lx.utils.zlib`、
  `md5(encodeURIComponent(s))`、请求默认超时 13s、`resp.body` 自动 JSON.parse、禁 eval/Function）
- 测试歌曲：周杰伦《晴天》等真实 musicInfo，**先过 `utils/index.ts` 的 `toOldMusicInfo()` 转成脚本实际收到的旧格式**
  （`songmid / hash / strMediaMid / songId / copyrightId`）—— 不转换会得出完全错误的结论
- 每个平台两次调用：真 id 一次 + **假 id 一次**；假 id 返回同一个地址 = 占位音频
- 拿到地址后再 `Range: bytes=0-2047` 实取，确认是音频流；并核对文件总长是否与该平台 320k 的真实体积一致
  （"能取到音频字节"不等于"是这首歌"，好几个源解析失败时返回一段**固定的占位音频**或 24 秒试听片段）
- 全程**串行**、一次一个源（上游按 IP 风控）

## 结论：内置这 5 个（`src/harmony/builtinSources/`）

| 源 | 为什么选 |
|---|---|
| HYWmusic_beta_公益测试 vv0.74.0 | 默认源：唯一 tx 走 QQ 官方 CDN 且是完整曲目的全平台源 |
| 星海音乐源 vv3.2.15 | 全走各平台官方 CDN、体积与正版 320k 一致、最快（0.3~0.9s）；tx 失败 |
| lx-玉宁熙-Pro vv1.2.2 | 与星海同一批平台、另一套后端（互为备份） |
| 屿溪-终章 v0.0.0 | 机制不同：本平台失败就换平台搜同名曲，兜底用 |
| 𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ v260809 | tx 的第二个真源（官方 CDN） |

## 全部候选（36 个）实测结果

标记：`[OK]` = 拿到链接且实取到音频字节、体积与该平台 320k 相符；`[占位]` = 占位音频（忽略 id 参数）；`[失败]` = 失败。

| 源 | 版本 | init | 各平台结果 |
|---|---|---|---|
| 墨澜聚合音源 | 2.0.0 | [OK] | kw:[OK](791ms) kg:[OK](488ms) tx:[OK](2611ms) wy:[OK](6103ms) mg:[OK](1368ms) |
| 星澜聚合音源 (StellarWave) | v3.1.1.1 | [OK] | kw:[OK](544ms) kg:[OK](8484ms) tx:[OK](2781ms) wy:[OK](9534ms) mg:[OK](810ms) |
| 屿溪-终章 | 0.0.0 | [OK] | kw:[OK](898ms) kg:[OK](657ms) tx:[OK](1011ms) wy:[OK](667ms) mg:[OK](562ms) |
| HYWmusic_公益版 | v1.0.3 | [OK] | kw:[OK](10620ms) kg:[OK](2419ms) tx:[OK](250ms) wy:[OK](670ms) mg:[OK](11551ms) |
| HYWmusic_beta_公益测试 | v0.74.0 | [OK] | kw:[OK](6777ms) kg:[OK](648ms) tx:[OK](272ms) wy:[OK](3633ms) mg:[OK](1960ms) |
| 星海音乐源 | v3.2.15 | [OK] | kw:[OK](878ms) kg:[OK](292ms) tx:[失败]({}) wy:[OK](712ms) mg:[OK](286ms) |
| lx-玉宁熙-Pro | v1.2.2 | [OK] | kw:[OK](456ms) kg:[OK](1332ms) tx:[失败]({}) wy:[OK](795ms) mg:[OK](476ms) |
| 聚合API接口 (CF) | 3 | [OK] | kw:[OK](413ms) kg:[失败]({}) tx:[OK](488ms) wy:[OK](1307ms) mg:[失败](返回值不是字符串: undefined) |
| 𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ | 260809 | [OK] | kw:[失败](undefined) kg:[失败](undefined) tx:[OK](799ms) wy:[OK](461ms) mg:[OK](389ms) |
| 聚合API接口 (CF) | 3 | [OK] | kw:[OK](379ms) kg:[失败]({}) tx:[OK](518ms) wy:[失败]({}) mg:[失败](返回值不是字符串: undefined) |
| 念心音源 | 1.0.2 | [OK] | kw:[OK](1ms) kg:[失败](取流失败) tx:[失败](取流失败) wy:[失败](取流失败) mg:[OK](1ms) |
| 全豆要[聚合音源] | v4.1 | [OK] | kw:[占位] kg:[OK](378ms) tx:[失败](取流失败) wy:[OK](390ms) mg:[失败](取流失败) |
| 收集の聚合接口(LX版) | 1.0.0-beta | [OK] | kw:[失败](fetch failed) tx:[OK](356ms) wy:[OK](1921ms) |
| 西瓜聚合源 | v1.40 | [OK] | kw:[占位] kg:[失败]({}) tx:[OK](1375ms) wy:[OK](606ms) mg:[失败]({}) |
| gdstudio音乐源 | 1.0.1 | [OK] | kw:[失败]({}) kg:[OK](1499ms) tx:[失败]({}) wy:[OK](1238ms) mg:[失败]({}) |
| Hei Music聚合源 | v1.3.1 | [OK] | kw:[失败](取流失败) kg:[失败](取流失败) tx:[OK](1242ms) wy:[OK](471ms) mg:[失败]({}) |
| Huibq_lxmusic源 | v1.2.0 | [OK] | kw:[OK](952ms) kg:[占位] tx:[占位] wy:[OK](551ms) mg:[占位] |
| 👖裤佬SVIP音源 | ✈️TG频道https://t.me/stymei | [OK] | kw:[占位] kg:[占位] tx:[占位] wy:[OK](414ms) mg:[占位] |
| 非常刀 | v5 | [OK] | kw:[占位] kg:[失败]({}) tx:[失败]({}) wy:[OK](464ms) mg:[失败]({}) |
| 溯音音源 | v1 | [OK] | kw:[占位] tx:[失败]({}) wy:[OK](484ms) mg:[失败]({}) |
| 统一音乐源 | 1.0.0 | [OK] | kw:[失败]({}) wy:[OK](454ms) |
| 稳定版音源 v1.0.3 | 1.0.3 | [OK] | kw:[失败](fetch failed) tx:[OK](304ms) wy:[失败](获取链接失败，可能是该歌曲无版权或接口维护) |
| K×H测试 | 1.7.17 | [OK] | kw:[占位] kg:[OK](420ms) tx:[失败]({}) wy:[占位] mg:[失败]({}) |
| [独家音源] | 4 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| 独家音源 | 6 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| 肥猫不肥 | 肥猫不肥 | [OK] | kw:[失败]({}) kg:[失败]({}) tx:[失败]({}) wy:[失败]({}) mg:[失败]({}) |
| 小熊猫 | v1.1.1 | [OK] | kw:[失败]({}) kg:[失败]({}) tx:[失败]({}) wy:[失败](error:1C80006B:Provider routines::wrong ) mg:[失败]({}) |
| 野草🌾 | 1.0.0 | [OK] | kw:[失败](fetch failed) |
| 野花🌷 | 1.0.0 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| 梓澄公益音源 | v1.0.1 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| 梓澄公益音源二代 | 1.2.3.4.5 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| Free listen | v1.1.2 | [OK] | kw:[失败]({}) kg:[失败]({}) tx:[失败]({}) wy:[失败](error:1C80006B:Provider routines::wrong ) mg:[失败]({}) |
| Huibq_lxmusic源 | v1.2.0 | [OK] | kw:[失败](timeout(13000ms)) kg:[失败]({}) tx:[失败]({}) wy:[失败]({}) mg:[失败]({}) |
| ikun公益音源 | v103 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |
| ikun音源 | v22 | [OK] | kw:[失败](fetch failed) wy:[失败](fetch failed) |
| ikun音源（中国香港服务器) | v1.0.1 | [OK] | kw:[失败](fetch failed) kg:[失败](fetch failed) tx:[失败](fetch failed) wy:[失败](fetch failed) mg:[失败](fetch failed) |

## 特别记录

- **Huibq_lxmusic源（此前唯一的内置源）**：kw/wy 真可播，**kg/tx/mg 返回占位音频**
  （假 id 与真 id 拿到同一个 `panspace.kuwo.cn/.../2149972737147268278.mp3`）。
  上一轮实测判它「kw/kg/wy 可用」就是被这个占位文件骗的 —— 它也能拿到 `HTTP 206 audio/mpeg`。
  所以这版把它**移出了内置清单**（已装到用户设备上的那份保留，不删用户数据）。
- **墨澜聚合音源 / 星澜聚合音源**：五个平台都"能播"，但 tx 只有 0.9MB（约 24 秒试听片段）→ 不收。
- **聚合API接口 (CF)**：只有 1KB 却能出 kw/tx/wy，但 tx 同样是试听片段 → 不收。
- **六音音源**（1.3MB 混淆脚本）、ikun、梓澄、無名、示例音源、独家音源、小熊猫、肥猫不肥、野花/野草：
  服务端已停或脚本崩溃。
