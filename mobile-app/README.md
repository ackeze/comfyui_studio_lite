# Comfy Studio Lite Android

局域网工作台的 Android 外壳，包含服务发现和原生文件保存。1.0.1 的下载按钮会打开系统保存窗口；图片、视频、对话与场景导出均可保存，取消时不创建下载成功提示。

使用 Node.js、JDK 17 和 Android SDK 34，在本目录运行：

```sh
npm ci
npx cap sync android
cd android
```

Windows 执行 `gradlew.bat assembleDebug`，其他系统执行 `./gradlew assembleDebug`。APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。首次构建需安装 Gradle 配置所指定的依赖；`android/local.properties` 配置本机 SDK 路径，不上传此文件。

手机需安装新版 APK，同时电脑更新插件网页。视频从当前连接的工作台流式保存；本地 Blob 导出文件上限 32 MiB。
