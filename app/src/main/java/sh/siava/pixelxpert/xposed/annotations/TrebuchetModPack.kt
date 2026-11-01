package sh.siava.pixelxpert.xposed.annotations

import sh.siava.pixelxpert.Constants
import sh.siava.pixelxpert.annotations.BaseModPack

/**
 * Applies to Trebuchet, the default launcher on LineageOS and other AOSP-based
 * ROMs.
 *
 * This exists because `@LauncherModPack` targets
 * `com.google.android.apps.nexuslauncher`, which is only present when a Google
 * apps package has installed Pixel Launcher. A ROM using Trebuchet has no such
 * package, so the launcher packs had no process to run in at all.
 *
 * Trebuchet's manifest declares `package="com.android.launcher3"`, and the
 * launcher packs hook `com.android.launcher3.*` and `com.android.quickstep.*`
 * classes rather than anything Pixel-specific. The only thing that was missing
 * for a Trebuchet build is this target, so the same implementations can be
 * registered for both launchers by carrying both annotations.
 *
 * This carries [@BaseModPack][BaseModPack], which is how :modPackProcessor
 * finds every class annotated with this one and registers it for that package.
 */
@Retention(AnnotationRetention.SOURCE)
@Target(AnnotationTarget.CLASS)
@BaseModPack(targetPackage = Constants.TREBUCHET_PACKAGE)
annotation class TrebuchetModPack
