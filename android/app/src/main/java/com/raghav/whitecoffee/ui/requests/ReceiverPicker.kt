package com.raghav.whitecoffee.ui.requests

import android.app.AlertDialog
import android.content.Context
import com.raghav.whitecoffee.data.model.Employee

// shortcut: a plain scrolling list; add search when the staff list gets long to scroll.
fun showReceiverPicker(context: Context, employees: List<Employee>?, onPick: (Employee) -> Unit) {
    val dialog = AlertDialog.Builder(context).setTitle("Received by")
    if (employees.isNullOrEmpty()) {
        dialog.setMessage(
            if (employees == null) "The employee list is still loading. Tap again in a moment."
            else "Employee list not available. Connect to the internet and tap again."
        )
            .setPositiveButton("OK", null)
    } else {
        val labels = employees.map { "${it.name} (${it.employeeId})" }.toTypedArray()
        dialog.setItems(labels) { _, i -> onPick(employees[i]) }
    }
    dialog.show()
}
