package cn.toside.music.mobile;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;

import com.reactnativenavigation.NavigationActivity;

import cn.toside.music.mobile.utils.TidePrefs;

public class MainActivity extends NavigationActivity {

  /**
   * 启动窗口的底色跟着用户选的界面主题走。
   *
   * 底色由 Web 界面通过 UtilsModule.setBootBackground 写进 SharedPreferences，
   * 这里读出来铺到窗口上。不这么做的话，浅色主题的用户会先看到一段深色
   * （AppTheme 里那个固定的 tide_boot_bg）再翻过去，反过来也一样。
   *
   * super.onCreate 前后各铺一次：前面那次盖住系统启动窗口到 RN 内容视图之间的空档，
   * 后面那次防止 RNN 初始化时把窗口背景重置回主题默认值。
   *
   * 「跟随系统」时**不覆盖**：AppTheme 的 windowBackground 本身就带 values-night，
   * 已经是当前系统的颜色了。而且这种情况下存下来的那份颜色可能已经过期
   * （用户关机时切了系统深色），照它铺反而会闪一下 —— 见 TidePrefs.BOOT_BG_MODE。
   *
   * 整段包 try：启动窗口什么颜色只是观感问题，不该拦住启动。
   *
   * 另：这里试过在 onCreate 里先建一个 1x1 透明 WebView 预热 Chromium
   * （provider + 渲染进程），实测反而更慢：模拟器只有 4 个 vCPU，
   * WebView 初始化与 RN 自己的启动互相抢 CPU，TotalTime 从 ~0.6s 涨到 ~2.0s。
   * 已在 TIDE-ANDROID.md 记下，别再加回来。
   */
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    applyBootBackground();
    super.onCreate(savedInstanceState);
    applyBootBackground();
  }

  private void applyBootBackground() {
    try {
      String mode = getSharedPreferences(TidePrefs.NAME, MODE_PRIVATE)
        .getString(TidePrefs.BOOT_BG_MODE, TidePrefs.DEFAULT_BOOT_BG_MODE);
      if (TidePrefs.DEFAULT_BOOT_BG_MODE.equals(TidePrefs.normalizeMode(mode))) return;

      String stored = getSharedPreferences(TidePrefs.NAME, MODE_PRIVATE)
        .getString(TidePrefs.BOOT_BACKGROUND, TidePrefs.DEFAULT_BOOT_BACKGROUND);
      getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor(TidePrefs.normalize(stored))));
    } catch (Exception ignored) {
      // 颜色串坏了就保持 AppTheme 里的默认底色
    }
  }
}
