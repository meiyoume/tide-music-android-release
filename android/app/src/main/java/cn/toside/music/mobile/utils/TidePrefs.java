package cn.toside.music.mobile.utils;

/**
 * 潮汐界面与原生之间共享的偏好。
 *
 * 目前只有一个「启动窗口底色」：界面把当前主题的底色写进来，
 * 下次启动时 MainActivity 在 super.onCreate 之前读出来给窗口上色，
 * 这样从系统启动窗口过渡到 RN 根视图这一段不会翻色。
 *
 * 为什么走 SharedPreferences 而不是 RN 的 AsyncStorage：
 * MainActivity 需要在 onCreate 里**同步**拿到它，AsyncStorage 是异步的，来不及。
 */
public final class TidePrefs {
  private TidePrefs() {}

  public static final String NAME = "tide_prefs";
  public static final String BOOT_BACKGROUND = "bootBackground";
  /**
   * 界面当前的主题模式：light / dark / system。
   *
   * 光记颜色不够：「跟随系统」时，用户关机时把手机切成深色，下次启动
   * 存下来的还是浅色底 —— 系统启动窗口已经是深色了，RN 根视图却用那份过期
   * 的浅色，屏幕上就是「深 → 浅 → 深」闪两下。知道模式就能在启动时重新判。
   */
  public static final String BOOT_BG_MODE = "bootBgMode";
  public static final String DEFAULT_BOOT_BG_MODE = "system";
  /** 潮汐界面默认主题（墨黑）的底色 */
  public static final String DEFAULT_BOOT_BACKGROUND = "#0A0B0F";

  /**
   * 把 "#RRGGBB" / "#RGB" 收敛成合法值。
   *
   * 颜色串是界面写进来的，可能是空串或脏数据；直接交给 Color.parseColor 会抛异常，
   * 这里统一兜到默认色，调用方就不用各自 try/catch 了。
   */
  public static String normalize(String color) {
    if (color == null) return DEFAULT_BOOT_BACKGROUND;
    String s = color.trim();
    if (s.matches("#[0-9a-fA-F]{6}")) return s.toUpperCase();
    if (s.matches("#[0-9a-fA-F]{3}")) {
      char r = s.charAt(1);
      char g = s.charAt(2);
      char b = s.charAt(3);
      return ("#" + r + r + g + g + b + b).toUpperCase();
    }
    return DEFAULT_BOOT_BACKGROUND;
  }

  /** 主题模式只认 light / dark，其余（含空、脏数据）都当「跟随系统」 */
  public static String normalizeMode(String mode) {
    if ("light".equals(mode) || "dark".equals(mode)) return mode;
    return DEFAULT_BOOT_BG_MODE;
  }
}
