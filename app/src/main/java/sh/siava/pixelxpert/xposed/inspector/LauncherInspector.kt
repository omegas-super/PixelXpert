package sh.siava.pixelxpert.xposed.inspector

import sh.siava.pixelxpert.Constants
import sh.siava.pixelxpert.ui.debug.model.ModuleAuditResult
import sh.siava.pixelxpert.ui.debug.model.ProcessAuditReport
import sh.siava.pixelxpert.ui.debug.model.TargetAuditItem
import sh.siava.pixelxpert.xposed.XPLauncher

/**
 * Single-pass reflection inspector for the launcher process.
 *
 * Covers both launchers the module can be injected into: Pixel Launcher
 * (`com.google.android.apps.nexuslauncher`) and Trebuchet
 * (`com.android.launcher3`). Both are built on the AOSP Launcher3 base, which is
 * where the launcher packs' hook targets live, so the same checks apply. The
 * report names whichever package the module is actually running in.
 *
 * CRITICAL CONSTRAINT: Exactly one attempt per target. Once a check fails,
 * it records the failure and moves on. Never loops, retries, or polls.
 */
object LauncherInspector {

	fun inspect(classLoader: ClassLoader?): ProcessAuditReport {
		val launcherItems = mutableListOf<TargetAuditItem>()

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.quickstep.views.OverviewActionsView",
				"OverviewActionsView (Clear All Button)",
				utilized = true,
			),
		)

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.launcher3.icons.IconProvider",
				"IconProvider (Themed Icons)",
				utilized = true,
			),
		)

		var launcherClass = InspectionUtils.checkClass(
			classLoader,
			"com.android.launcher3.Launcher",
			"Launcher (Base Launcher)",
			utilized = true,
		)
		if (launcherClass.status != sh.siava.pixelxpert.ui.debug.model.AuditStatus.PRESENT) {
			val nexusFallback = InspectionUtils.checkClass(
				classLoader,
				"com.google.android.apps.nexuslauncher.NexusLauncherActivity",
				"NexusLauncherActivity",
				utilized = true,
			)
			if (nexusFallback.status == sh.siava.pixelxpert.ui.debug.model.AuditStatus.PRESENT) {
				launcherClass = nexusFallback
			}
		}
		launcherItems.add(launcherClass)

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.launcher3.taskbar.TaskbarActivityContext",
				"TaskbarActivityContext (Taskbar Activator)",
				utilized = true,
			),
		)

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.launcher3.taskbar.NavbarButtonsViewController",
				"NavbarButtonsViewController (Gesture Navbar)",
				utilized = true,
			),
		)

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.quickstep.OverviewCommandHelper",
				"OverviewCommandHelper (Custom Nav Gestures)",
				utilized = true,
			),
		)

		launcherItems.add(
			InspectionUtils.checkClass(
				classLoader,
				"com.android.launcher3.BaseDraggingActivity",
				"BaseDraggingActivity (Hide Navigation Insets)",
				utilized = true,
			),
		)

		// The report names the process it actually ran in. A ROM whose launcher is
		// Trebuchet has no Pixel Launcher package, so hardcoding the Pixel name
		// here made every Trebuchet audit describe a package that is not installed.
		val runningPackage = XPLauncher.processName.takeIf { it.isNotEmpty() }
			?: Constants.LAUNCHER_PACKAGE

		val modules = listOf(
			ModuleAuditResult(
				moduleName = "Launcher",
				packageName = runningPackage,
				pipelineSummary = "Quickstep & Taskbar Integration",
				items = launcherItems,
			),
		)

		return ProcessAuditReport(
			packageName = runningPackage,
			processName = runningPackage,
			modules = modules,
		)
	}
}
