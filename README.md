# tide-music-android-release
TideMusic Android releases (phone / tablet) and in-app update source

## 源码

本仓库同时存放潮汐音乐安卓版的完整源码（WebView 界面 + 洛雪内核移植），
当前版本 v1.9.32。先读 `TIDE-ANDROID.md`，构建说明见其中「怎么用」一节。

- 签名密钥 `android/app/lxmusic.keystore` 与 `android/keystore.properties` **不在仓库里**；
  本地打包请把 `android/keystore.properties.example` 复制成 `android/keystore.properties` 并填自己的值。
- 安装包仍在 Releases 页：每个版本手机 / 平板各一个 arm64 APK。
