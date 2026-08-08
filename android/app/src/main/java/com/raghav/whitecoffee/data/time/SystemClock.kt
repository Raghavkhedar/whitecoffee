package com.raghav.whitecoffee.data.time

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The device clock. Bound to [Clock] in [com.raghav.whitecoffee.di.DataSourceModule].
 *
 * Reads the date on **every** call — never caches it. Caching is the bug this whole seam exists
 * to prevent: one read held for the life of a flow or a ViewModel is what let an app resumed the
 * next morning still believe it was yesterday.
 *
 * The device's local zone is the right zone here: employees, their shifts and the payroll window
 * are all IST, and the punch itself is stamped server-side.
 */
@Singleton
class SystemClock @Inject constructor() : Clock {

    override fun today(): String = LocalDate.now().format(FORMATTER)

    private companion object {
        val FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    }
}
